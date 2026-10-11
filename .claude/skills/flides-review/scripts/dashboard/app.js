// Flides review dashboard.
// It polls /api/state, shows the deck slide by slide in an iframe driven by
// frame.js, and turns feedback into tickets that the agent handles.
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STATUS = {
  open: 'Open',
  in_progress: 'Agent working',
  done: 'Awaiting your review',
  blocked: 'Question for you',
  closed: 'Accepted',
  cancelled: 'Cancelled',
};
const ACTIVE = ['open', 'in_progress', 'blocked', 'done'];

const S = {
  data: null,          // last state from the server
  key: '',             // fingerprint of the parts of the state that matter for rendering
  online: true,
  agent: null,
  serverNow: null,
  deckFile: 'index.html',
  stamp: null,
  slides: [],          // slides of the live deck
  versions: new Map(), // snapshot id -> Promise of parsed slides
  changes: new Map(),  // "T3:4:5" -> what ticket T3 changed between versions 4 and 5
  items: [],           // sidebar entries: live slides plus removed slides awaiting review
  current: null,       // key of the selected slide
  view: 'slides',
  compare: 'auto',
  revealAll: true,
  viewport: 'screen',  // which screen size the frames imitate (see VIEWPORTS)
  picking: false,
  target: null,
  filter: 'active',
  onlyFlagged: false,
  drafts: {},
  paneKey: '',
};

// ---------------------------------------------------------------------------
// Utilities

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

let toastTimer = null;
function toast(text, error = false) {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast' + (error ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6000 : 3000);
}

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Flides-Review': '1' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// ---------------------------------------------------------------------------
// Reading slides out of a deck's HTML

const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

// Slides that flides.js treats specially. It recognises the two overviews by
// their id, and leaves them and the backup slides out of the slide numbers.
const KINDS = {
  overview: {
    label: 'Final overview',
    help: 'Zooms out over the whole deck. It is usually the last slide, which Shift jumps to. Not numbered.',
  },
  partial: {
    label: 'Partial overview',
    help: 'Zooms out to show only the slides seen so far, then the talk goes on. Not numbered.',
  },
  backup: {
    label: 'Backup slide',
    help: 'Outside the main flow (data-fixed="1"): the arrow keys skip it, and it is reached through a link or a click. Not numbered.',
  },
};

function slideKind(el) {
  if (el.getAttribute('data-fixed') === '1') return 'backup';
  if (el.id === 'overview') return 'overview';
  if (el.id === 'overview_intermediate') return 'partial';
  return 'slide';
}

function slideTitle(el, kind) {
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6, h25');
  if (heading && clean(heading.textContent)) return clean(heading.textContent);
  const text = clean(el.textContent);
  if (text) return text.slice(0, 80);
  const media = el.querySelector('img, svg, object, embed, video, image');
  if (media) {
    const src = media.getAttribute('src') || media.getAttribute('data') || media.getAttribute('href') || media.getAttribute('xlink:href');
    return 'Figure: ' + (src ? src.split('/').pop() : media.tagName.toLowerCase());
  }
  return KINDS[kind] ? KINDS[kind].label : 'Empty slide';
}

function slideTags(el) {
  const tags = [];
  const reveals = el.querySelectorAll('.slide_step').length;
  if (reveals) tags.push(plural(reveals, 'reveal'));
  if (el.querySelector('.token')) tags.push('animation');
  if (el.closest('.part')) tags.push('in a part');
  return tags;
}

// Same rule as frame.js: slides are the .step elements under the closest
// ancestor of the first slide that has an id. Slides inside a .part are
// still slides, in document order, as for flides.js.
function parseSlides(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const first = doc.querySelector('.step');
  if (!first) return { title: doc.title, slides: [] };
  let root = first.parentElement;
  while (root && !root.id && root !== doc.body) root = root.parentElement;
  const counts = {};
  let number = 0;
  const slides = $$('.step', root || doc.body).map((el, index) => {
    const id = el.getAttribute('id') || '';
    const occ = id ? (counts[id] = (counts[id] ?? -1) + 1) : 0;
    const kind = slideKind(el);
    return {
      index,
      number: kind === 'slide' ? ++number : null,
      kind,
      id,
      occ,
      key: id ? (occ ? `${id}~${occ}` : id) : `@${index}`,
      title: slideTitle(el, kind),
      tags: slideTags(el),
      html: el.outerHTML,
      norm: clean(el.outerHTML),
    };
  });
  return { title: doc.title, slides };
}

function loadVersion(id) {
  if (!S.versions.has(id)) {
    const p = fetch(`/v/${id}/${encodePath(S.deckFile)}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => parseSlides(html).slides);
    S.versions.set(id, p);
  }
  return S.versions.get(id);
}

const versionMeta = (id) => (S.data.versions || []).find((v) => v.id === id) || null;

// ---------------------------------------------------------------------------
// What each ticket awaiting review changed

// A ticket may have several rounds (it is reopened, the agent works again) and
// other tickets may land in between, so only the rounds of the ticket count.
const roundsOf = (t) => (t.rounds || []).filter((r) => r.before && r.after);
const changeKey = (t) => `${t.id}:${roundsOf(t).map((r) => `${r.before}-${r.after}`).join(',')}`;
const changesOf = (t) => S.changes.get(changeKey(t)) || null;

async function computeChanges() {
  const waiting = S.data.tickets.filter((t) => t.status === 'done' && roundsOf(t).length && !S.changes.has(changeKey(t)));
  await Promise.all(waiting.map(async (t) => {
    const status = new Map(); // slide key -> { kind, version, slides }
    const files = new Set();
    for (const r of roundsOf(t)) {
      const [a, b] = await Promise.all([loadVersion(r.before), loadVersion(r.after)]);
      const A = new Map(a.map((s) => [s.key, s]));
      const B = new Map(b.map((s) => [s.key, s]));
      for (const [k, s] of B) {
        const was = status.get(k);
        if (!A.has(k)) status.set(k, { kind: was && was.kind === 'removed' ? 'changed' : 'added' });
        else if (A.get(k).norm !== s.norm) status.set(k, { kind: was && was.kind === 'added' ? 'added' : 'changed' });
      }
      for (const k of A.keys()) {
        if (B.has(k)) continue;
        if (status.get(k) && status.get(k).kind === 'added') status.delete(k);
        else status.set(k, { kind: 'removed', version: r.before, slides: a });
      }
      const fa = (versionMeta(r.before) || {}).files || {};
      const fb = (versionMeta(r.after) || {}).files || {};
      for (const f of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
        if (f !== S.deckFile && fa[f] !== fb[f]) files.add(f);
      }
    }
    const keys = (kind) => [...status].filter(([, v]) => v.kind === kind).map(([k]) => k);
    const touched = new Set(status.keys());
    if (t.slide && t.slide.key) touched.add(t.slide.key);
    S.changes.set(changeKey(t), {
      changed: keys('changed'), added: keys('added'), removed: keys('removed'),
      files: [...files], touched, status,
    });
  }));
}

const pendingTickets = () => S.data.tickets.filter((t) => t.status === 'done' && changesOf(t));
const pendingFor = (key) => pendingTickets().filter((t) => changesOf(t).touched.has(key));
const ticketsOn = (key) => S.data.tickets.filter((t) => t.slide && t.slide.key === key);

// Live slides, plus slides removed by tickets that still await review, shown
// where they used to be.
function buildItems() {
  const items = S.slides.map((s) => ({ ...s, ghost: false }));
  for (const t of pendingTickets()) {
    const c = changesOf(t);
    for (const k of c.removed) {
      if (items.some((i) => i.key === k)) continue;
      const { version, slides } = c.status.get(k);
      const old = slides.find((s) => s.key === k);
      let pos = 0;
      for (let j = old.index - 1; j >= 0; j--) {
        const at = items.findIndex((i) => i.key === slides[j].key);
        if (at >= 0) { pos = at + 1; break; }
      }
      items.splice(pos, 0, { ...old, ghost: true, removedBy: t.id, version });
    }
  }
  // The list follows the talk: the main flow first, then the backup slides,
  // which the arrow keys of the deck never reach.
  S.items = [...items.filter((i) => i.kind !== 'backup'), ...items.filter((i) => i.kind === 'backup')];
}

const currentItem = () => S.items.find((i) => i.key === S.current) || null;

function itemFlags(item) {
  const on = ticketsOn(item.key);
  const flags = [];
  if (item.ghost) flags.push(['removed', 'removed']);
  else {
    const pend = pendingFor(item.key);
    if (pend.some((t) => changesOf(t).added.includes(item.key))) flags.push(['new', 'new']);
    else if (pend.length) flags.push(['updated', 'updated']);
  }
  if (on.some((t) => t.status === 'blocked')) flags.push(['blocked', 'question']);
  else if (on.some((t) => t.status === 'in_progress')) flags.push(['in_progress', 'working']);
  const open = on.filter((t) => t.status === 'open').length;
  if (open) flags.push(['open', `${open} open`]);
  return flags;
}

const needsAttention = (item) => itemFlags(item).some(([cls]) => ['removed', 'new', 'updated', 'blocked'].includes(cls));

// ---------------------------------------------------------------------------
// Slide frames

const frames = {
  now: { el: $('#frame-now'), pane: $('#pane-now'), src: '', ready: false, want: null, message: null, timer: null },
  before: { el: $('#frame-before'), pane: $('#pane-before'), src: '', ready: false, want: null, message: null, timer: null },
};

// A deck sizes itself from its window, and flides.js caps its zoom, so a deck
// in a small window is not a shrunk copy of the deck on a real screen: slides
// would overflow. The frames therefore get the size of a real screen, and the
// picture is shrunk to fit the pane with a CSS transform.
function screenSize() {
  const w = window.screen.width;
  const h = window.screen.height;
  return w >= 640 && h >= 480 ? [w, h] : [1440, 900];
}

const VIEWPORTS = [
  { id: 'screen', label: `This screen (${screenSize().join(' × ')})`, size: screenSize() },
  { id: 'fullhd', label: 'Full HD projector (1920 × 1080)', size: [1920, 1080] },
  { id: 'hd', label: 'HD projector (1280 × 720)', size: [1280, 720] },
  { id: 'xga', label: '4:3 projector (1024 × 768)', size: [1024, 768] },
];

const viewportSize = () => (VIEWPORTS.find((v) => v.id === S.viewport) || VIEWPORTS[0]).size;

function fitFrames() {
  const [w] = viewportSize();
  for (const f of Object.values(frames)) {
    const box = f.el.parentElement;
    if (box.clientWidth) f.el.style.transform = `scale(${box.clientWidth / w})`;
  }
}

function applyViewport() {
  const [w, h] = viewportSize();
  $('#stage').style.setProperty('--aspect', String(w / h));
  for (const f of Object.values(frames)) {
    f.el.style.width = `${w}px`;
    f.el.style.height = `${h}px`;
  }
  fitFrames();
}

const resizeObserver = new ResizeObserver(fitFrames);
for (const f of Object.values(frames)) resizeObserver.observe(f.el.parentElement);

function overlay(name, text, cls = '') {
  const el = $('.frame-overlay', frames[name].pane);
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'frame-overlay' + (cls ? ' ' + cls : '');
}

function setFrame(name, src) {
  const f = frames[name];
  if (f.src === src) return;
  f.src = src;
  f.ready = false;
  f.el.src = src;
  clearTimeout(f.timer);
  f.timer = setTimeout(() => {
    if (!f.ready && !f.message) overlay(name, 'The deck did not start in review mode. Open it in a new tab to check for errors.');
  }, 15000);
}

function frameGoto(name) {
  const f = frames[name];
  const r = f.el.contentWindow && f.el.contentWindow.__review;
  if (!r) return;
  r.setRevealAll(S.revealAll);
  if (!r.goto(f.want)) overlay(name, 'This slide could not be found in the deck.');
  else overlay(name, null);
}

function showPane(name, { src, index, message }) {
  const f = frames[name];
  f.message = message || null;
  f.want = message ? null : index;
  if (src) setFrame(name, src);
  if (f.message) overlay(name, f.message);
  else if (f.ready) frameGoto(name);
  else overlay(name, 'Loading the deck...', 'loading');
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.source !== 'flides-review') return;
  const name = Object.keys(frames).find((n) => frames[n].el.contentWindow === e.source);
  if (!name) return;
  const f = frames[name];
  const msg = e.data;
  if (msg.type === 'ready') {
    f.ready = true;
    clearTimeout(f.timer);
    if (f.message) overlay(name, f.message);
    else if (f.want != null) frameGoto(name);
    else overlay(name, null);
    if (name === 'now' && S.picking) setPicking(true);
  } else if (msg.type === 'error') {
    clearTimeout(f.timer);
    overlay(name, msg.message);
  } else if (msg.type === 'stepenter' && name === 'now') {
    // The reviewer navigated inside the deck itself: follow along.
    const item = S.items.find((i) => !i.ghost && i.index === msg.index);
    if (item && item.key !== S.current) select(item.key);
  } else if (msg.type === 'pick-cancelled') {
    setPicking(false);
  }
});

function compareVersion(item) {
  if (item.ghost) return item.version;
  if (S.compare === 'off') return null;
  if (S.compare === 'auto') {
    const pend = pendingFor(item.key);
    return pend.length ? Math.min(...pend.map((t) => t.before)) : null;
  }
  return Number(S.compare);
}

async function updatePanes(force = false) {
  const item = currentItem();
  if (!item) return;
  const version = compareVersion(item);
  const key = JSON.stringify([item.key, item.ghost, version, S.stamp, S.revealAll]);
  if (!force && key === S.paneKey) return;
  S.paneKey = key;

  const stage = $('#stage');
  stage.classList.toggle('compare', version != null);
  frames.before.pane.hidden = version == null;

  const nowSrc = `/deck/${encodePath(S.deckFile)}?review=1&t=${S.stamp}`;
  if (item.ghost) {
    showPane('now', { src: nowSrc, message: `Removed by ${item.removedBy}. Accept the ticket to confirm, or reopen it to bring the slide back.` });
    $('#now-caption').textContent = 'current deck';
  } else {
    showPane('now', { src: nowSrc, index: item.index });
    $('#now-caption').textContent = version != null ? 'current deck, with the changes' : 'current deck';
  }

  if (version != null) {
    const meta = versionMeta(version);
    $('#before-caption').textContent = `version ${version}${meta ? ' · ' + meta.label : ''}`;
    const old = (await loadVersion(version)).find((s) => s.key === item.key);
    if (key !== S.paneKey) return;
    const src = `/v/${version}/${encodePath(S.deckFile)}?review=1`;
    if (old) showPane('before', { src, index: old.index });
    else showPane('before', { src, message: 'This slide did not exist in that version.' });
  }
}

// ---------------------------------------------------------------------------
// Pointing at an element of the slide

function setPicking(on) {
  S.picking = on;
  $('#point').classList.toggle('on', on);
  $('#point').textContent = on ? 'Click an element (Esc to stop)' : 'Point at element';
  frames.now.pane.classList.toggle('pointing', on);
  const r = frames.now.ready && frames.now.el.contentWindow.__review;
  if (!r) return;
  if (on) {
    r.pick((target) => {
      S.target = JSON.parse(JSON.stringify(target));
      setPicking(false);
      renderTarget();
      $('#feedback').focus();
    });
  } else {
    r.cancelPick();
  }
}

function describeTarget(g) {
  const name = `<${g.tag}${g.id ? '#' + g.id : ''}>`;
  return g.text ? `${name} "${g.text.slice(0, 80)}"` : `${name} ${g.path}`;
}

function renderTarget() {
  $('#target-chip').hidden = !S.target;
  if (S.target) $('#target-text').textContent = describeTarget(S.target);
  markTarget(S.target);
}

function markTarget(g) {
  const r = frames.now.ready && frames.now.el.contentWindow.__review;
  if (!r) return;
  if (g) r.mark(g.path);
  else r.clearMarks();
}

// ---------------------------------------------------------------------------
// Actions

async function sendFeedback(kind) {
  const item = currentItem();
  if (!item || item.ghost) return;
  const text = $('#feedback').value.trim();
  if (kind === 'text' && !text) {
    toast('Write some feedback first.');
    $('#feedback').focus();
    return;
  }
  const slide = {
    key: item.key, id: item.id, occurrence: item.occ, index: item.index,
    number: item.number, kind: item.kind, title: item.title, html: item.html,
  };
  try {
    const [w, h] = viewportSize();
    const t = await post('/api/tickets', { kind, text, slide, target: S.target, viewport: { width: w, height: h } });
    $('#feedback').value = '';
    S.target = null;
    renderTarget();
    toast(kind === 'remove' ? `${t.id}: removal requested. You can cancel it while it is open.` : `${t.id} created.`);
    refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

async function ticketAction(id, action, text = '') {
  try {
    await post(`/api/tickets/${id}/action`, { action, text });
    delete S.drafts[id];
    const done = { accept: `${id} accepted.`, reopen: `${id} reopened.`, reply: 'Answer sent.', cancel: `${id} cancelled.` };
    toast(done[action] || 'Done.');
    refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

function select(key) {
  if (key === S.current) return;
  S.current = key;
  if (S.picking) setPicking(false);
  S.target = null;
  renderTarget();
  history.replaceState(null, '', '#slide=' + encodeURIComponent(key));
  render();
}

function visibleItems() {
  return S.onlyFlagged ? S.items.filter((i) => i.key === S.current || itemFlags(i).length) : S.items;
}

function stepSlide(delta) {
  const list = visibleItems();
  const at = list.findIndex((i) => i.key === S.current);
  const next = list[Math.min(list.length - 1, Math.max(0, at + delta))];
  if (next) select(next.key);
}

function nextToReview() {
  const n = S.items.length;
  const at = S.items.findIndex((i) => i.key === S.current);
  for (let d = 1; d <= n; d++) {
    const item = S.items[(at + d + n) % n];
    if (needsAttention(item)) {
      S.compare = 'auto';
      showView('slides');
      select(item.key);
      return;
    }
  }
}

function goToTicket(t, compare = false) {
  showView('slides');
  if (compare && t.before) S.compare = String(t.before);
  const key = t.slide && t.slide.key;
  if (key && S.items.some((i) => i.key === key)) select(key);
  else toast('That slide is no longer in the deck.');
  render();
}

function showView(view) {
  S.view = view;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-slides').hidden = view !== 'slides';
  $('#view-tickets').hidden = view !== 'tickets';
  render();
}

// ---------------------------------------------------------------------------
// Rendering

function renderAgent() {
  const el = $('#agent');
  const a = S.agent;
  const age = a && S.serverNow ? (Date.parse(S.serverNow) - Date.parse(a.at)) / 1000 : Infinity;
  let cls = 'offline';
  let label = 'Agent not listening (tickets will wait)';
  if (!S.online) label = 'Review server stopped';
  else if (a && a.state === 'working' && age < 3600) { cls = 'working'; label = `Agent working on ${a.ticket}`; }
  else if (a && a.state === 'busy' && age < 300) { cls = 'working'; label = 'Agent picking up tickets'; }
  else if (a && a.state === 'listening' && age < 20) { cls = 'listening'; label = 'Agent listening'; }
  el.className = 'agent-status ' + cls;
  $('.agent-label', el).textContent = label;
  el.title = label;
}

function renderHeader() {
  $('#deck-title').textContent = S.data.deck.title;
  document.title = `Review: ${S.data.deck.title}`;
  const attention = S.data.tickets.filter((t) => t.status === 'done' || t.status === 'blocked').length;
  $('#tab-count').textContent = attention ? String(attention) : '';
  $('#next-review').hidden = !S.items.some(needsAttention);
}

// Final overview: every square filled. Partial overview: only the slides seen
// so far. Backup slide: off to the side of the flow.
const ICONS = {
  overview: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect class="fill" x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect class="fill" x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect class="fill" x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect class="fill" x="9" y="9" width="5.5" height="5.5" rx="1"/></svg>',
  partial: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect class="fill" x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect class="fill" x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect x="9" y="9" width="5.5" height="5.5" rx="1"/></svg>',
  backup: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 8 8"/><path d="M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5"/></svg>',
};

const numberedCount = () => S.slides.filter((s) => s.kind === 'slide').length;

function slideLabel(item) {
  if (item.kind === 'slide') return `Slide ${item.number}`;
  return KINDS[item.kind].label;
}

function itemRow(item) {
  const kind = KINDS[item.kind];
  const num = item.ghost ? '' : kind ? `<span class="kind-icon">${ICONS[item.kind]}</span>` : item.number;
  const sub = [kind && item.title !== kind.label ? kind.label.toLowerCase() : '', item.id ? `#${item.id}` : 'no id']
    .filter(Boolean).join(' \u00b7 ');
  const badges = itemFlags(item).map(([cls, label]) => `<span class="badge ${cls}">${esc(label)}</span>`).join('');
  const cls = ['slide-item', `kind-${item.kind}`, item.key === S.current ? 'current' : '', item.ghost ? 'ghost' : '']
    .filter(Boolean).join(' ');
  return `<li class="${cls}" data-key="${esc(item.key)}"${kind ? ` title="${esc(kind.label + ': ' + kind.help)}"` : ''}>
    <span class="slide-num">${num}</span>
    <span class="slide-text"><div class="slide-name">${esc(item.title)}</div><div class="slide-id">${esc(sub)}</div></span>
    <span class="slide-badges">${badges}</span>
  </li>`;
}

function renderSidebar() {
  const list = $('#slide-list');
  const items = visibleItems();
  const flow = items.filter((i) => i.kind !== 'backup');
  const backup = items.filter((i) => i.kind === 'backup');
  const backups = S.slides.filter((s) => s.kind === 'backup').length;
  $('#slide-count').textContent = plural(numberedCount(), 'slide') + (backups ? ` + ${backups} backup` : '');
  let html = '';
  if (backup.length) html += '<li class="group-head">Main flow<span>in the order of the talk</span></li>';
  html += flow.map(itemRow).join('');
  if (backup.length) {
    html += `<li class="group-head backup" title="${esc(KINDS.backup.help)}">Backup slides<span>outside the main flow, reached through links</span></li>`;
    html += backup.map(itemRow).join('');
  }
  list.innerHTML = html;
  const cur = $('.slide-item.current', list);
  if (cur && S.lastScrolled !== S.current) {
    cur.scrollIntoView({ block: 'nearest' });
    S.lastScrolled = S.current;
  }
}

function renderCompareSelect(item) {
  const sel = $('#compare');
  const versions = [...(S.data.versions || [])].reverse();
  const auto = item && !item.ghost && pendingFor(item.key).length ? 'Auto (before pending changes)' : 'Auto (when something changed)';
  const opts = [`<option value="auto">${auto}</option>`, '<option value="off">Nothing</option>']
    .concat(versions.map((v) => `<option value="${v.id}">Version ${v.id} · ${esc(v.label)} · ${esc(ago(v.created))}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = S.compare;
  if (sel.value !== S.compare) { S.compare = 'auto'; sel.value = 'auto'; }
  sel.disabled = !!(item && item.ghost);
}

function renderSlideView() {
  const item = currentItem();
  if (!item) {
    $('#slide-title').textContent = 'No slides found';
    $('#slide-meta').textContent = 'The deck has no element with class "step".';
    return;
  }
  $('#slide-title').textContent = item.title;
  const kind = KINDS[item.kind];
  const meta = [];
  if (item.ghost) meta.push('removed slide');
  if (kind) meta.push(`<span class="kind-pill kind-${item.kind}">${ICONS[item.kind]}${esc(kind.label)}</span>`);
  else if (!item.ghost) meta.push(`slide ${item.number} of ${numberedCount()}`);
  meta.push(item.id ? `<code>#${esc(item.id)}</code>` : 'no id');
  for (const tag of item.tags) meta.push(esc(tag));
  $('#slide-meta').innerHTML = meta.map((m) => `<span>${m}</span>`).join('');
  $('#slide-help').textContent = kind ? kind.help : '';
  $('#slide-help').hidden = !kind;
  renderCompareSelect(item);
  const hash = item.id || `step-${item.index + 1}`;
  $('#open-deck').href = `/deck/${encodePath(S.deckFile)}#/${encodeURIComponent(hash)}`;
  $('#open-deck').hidden = item.ghost;
  $('#composer').classList.toggle('disabled', item.ghost);
  $('#prev').disabled = visibleItems()[0]?.key === S.current;
  $('#next').disabled = visibleItems().at(-1)?.key === S.current;

  const own = ticketsOn(item.key);
  const others = pendingFor(item.key).filter((t) => !own.includes(t));
  const order = (t) => ACTIVE.includes(t.status) ? 0 : 1;
  const tickets = [...own, ...others].sort((a, b) => order(a) - order(b) || numberOf(b) - numberOf(a));
  renderTickets($('#slide-tickets'), tickets, false, 'No tickets on this slide yet.');
  updatePanes();
}

const numberOf = (t) => Number(t.id.slice(1));

function renderTicketsView() {
  const f = S.filter;
  $$('#ticket-filter .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === f));
  const rank = { blocked: 0, done: 1, in_progress: 2, open: 3, closed: 4, cancelled: 5 };
  let list = S.data.tickets;
  if (f === 'active') list = list.filter((t) => ACTIVE.includes(t.status));
  if (f === 'review') list = list.filter((t) => t.status === 'done');
  if (f === 'blocked') list = list.filter((t) => t.status === 'blocked');
  list = [...list].sort((a, b) => (f === 'all' ? 0 : rank[a.status] - rank[b.status]) || numberOf(b) - numberOf(a));
  const empty = { active: 'Nothing in progress. Feedback you send appears here.', review: 'Nothing awaits your review.', blocked: 'The agent has no question for you.', all: 'No tickets yet.' };
  renderTickets($('#all-tickets'), list, true, empty[f]);
}

function whereLabel(t) {
  if (!t.slide) return 'whole deck';
  const item = S.items.find((i) => i.key === t.slide.key);
  if (!item) return `${t.slide.title || t.slide.id || 'slide'} (no longer in the deck)`;
  if (item.ghost) return `${item.title} (removed)`;
  return item.kind === 'slide' || item.title !== KINDS[item.kind].label ? `${slideLabel(item)} \u00b7 ${item.title}` : slideLabel(item);
}

function changesText(c) {
  const parts = [];
  if (c.changed.length) parts.push(`${plural(c.changed.length, 'slide')} changed`);
  if (c.added.length) parts.push(`${c.added.length} added`);
  if (c.removed.length) parts.push(`${c.removed.length} removed`);
  if (c.files.length) parts.push('other files: ' + c.files.join(', '));
  return parts.length ? parts.join(' · ') : 'The deck files did not change.';
}

function ticketHTML(t, showWhere) {
  const text = t.kind === 'remove'
    ? `<p class="ticket-text remove">Remove this slide${t.text ? '' : '.'}</p>${t.text ? `<p class="ticket-text">${esc(t.text)}</p>` : ''}`
    : `<p class="ticket-text">${esc(t.text)}</p>`;
  const target = t.target
    ? `<div class="ticket-target">Pointing at <code data-mark="${esc(t.target.path)}" title="${esc(t.target.html || t.target.path)}">${esc(describeTarget(t.target))}</code></div>`
    : '';
  const thread = t.thread.length
    ? `<ul class="thread">${t.thread.map((m) => `<li class="msg ${m.by}"><div class="msg-by">${m.by === 'agent' ? 'Agent' : 'You'}</div><div class="msg-text">${esc(m.text)}</div></li>`).join('')}</ul>`
    : '';
  const c = t.status === 'done' ? changesOf(t) : null;
  const changes = c ? `<div class="changes">${esc(changesText(c))}</div>` : '';
  const draft = esc(S.drafts[t.id] || '');
  let actions = '';
  if (t.status === 'open') {
    actions = `<button class="btn small" data-act="cancel">Cancel ticket</button>`;
  } else if (t.status === 'blocked') {
    actions = `<textarea data-draft="${t.id}" placeholder="Your answer">${draft}</textarea>
      <button class="btn small primary" data-act="reply">Send answer</button>
      <button class="btn small" data-act="cancel">Cancel ticket</button>`;
  } else if (t.status === 'done') {
    actions = `<textarea data-draft="${t.id}" placeholder="Not quite? Say what should change and reopen.">${draft}</textarea>
      <button class="btn small primary" data-act="accept">Accept</button>
      <button class="btn small" data-act="reopen">Reopen with comment</button>
      <button class="btn small" data-act="undo">Undo this change</button>
      ${t.before ? '<button class="link" data-act="compare">Compare with the version before</button>' : ''}`;
  } else if (t.status === 'in_progress') {
    actions = '<span class="hint">The agent is working on this ticket.</span>';
  }
  return `<article class="ticket ${t.status}" data-id="${t.id}">
    <div class="ticket-head">
      <span class="ticket-id">${t.id}</span>
      <span class="badge ${t.status}">${STATUS[t.status] || t.status}</span>
      ${showWhere ? `<span class="ticket-where"><button class="link" data-act="goto">${esc(whereLabel(t))}</button></span>` : ''}
      <span class="ticket-time" title="${esc(t.updated)}">${esc(ago(t.updated))}</span>
    </div>
    ${text}${target}${thread}${changes}
    ${actions ? `<div class="ticket-actions">${actions}</div>` : ''}
  </article>`;
}

function renderTickets(container, tickets, showWhere, emptyText) {
  container.innerHTML = tickets.length
    ? tickets.map((t) => ticketHTML(t, showWhere)).join('')
    : `<div class="empty">${esc(emptyText)}</div>`;
}

function render() {
  if (!S.data) return;
  // Keep the reviewer's place if they are typing in a ticket while we redraw.
  const active = document.activeElement;
  const draft = active && active.dataset && active.dataset.draft;
  const selection = draft ? [active.selectionStart, active.selectionEnd] : null;

  renderHeader();
  renderSidebar();
  if (S.view === 'slides') renderSlideView();
  else renderTicketsView();

  if (draft) {
    const view = S.view === 'slides' ? '#view-slides' : '#view-tickets';
    const el = $(`${view} [data-draft="${draft}"]`);
    if (el) {
      el.focus();
      el.setSelectionRange(selection[0], selection[1]);
    }
  }
}

// ---------------------------------------------------------------------------
// Polling the server

async function applyState(data) {
  const deckChanged = !S.data || data.deck.stamp !== S.data.deck.stamp;
  S.data = data;
  S.deckFile = data.deck.file;
  if (deckChanged) {
    const r = await fetch(`/deck/${encodePath(S.deckFile)}`, { cache: 'no-store' });
    S.slides = parseSlides(await r.text()).slides;
    S.stamp = data.deck.stamp;
  }
  await computeChanges();
  const previous = S.items.findIndex((i) => i.key === S.current);
  buildItems();
  if (!currentItem()) {
    const wanted = S.items[Math.max(0, Math.min(previous, S.items.length - 1))];
    S.current = wanted ? wanted.key : null;
  }
  render();
}

let pollTimer = null;
async function refresh() {
  clearTimeout(pollTimer);
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const data = await r.json();
    S.online = true;
    S.agent = data.agent;
    S.serverNow = data.now;
    const key = JSON.stringify([data.deck, data.tickets, data.versions]);
    if (key !== S.key) {
      S.key = key;
      await applyState(data);
    }
  } catch (e) {
    S.online = false;
  }
  renderAgent();
  pollTimer = setTimeout(refresh, 2000);
}

// ---------------------------------------------------------------------------
// Wiring

$('#slide-list').addEventListener('click', (e) => {
  const li = e.target.closest('.slide-item');
  if (li) select(li.dataset.key);
});
$('#prev').addEventListener('click', () => stepSlide(-1));
$('#next').addEventListener('click', () => stepSlide(1));
$('#next-review').addEventListener('click', nextToReview);
$$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('#ticket-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) { S.filter = chip.dataset.filter; render(); }
});
$('#only-flagged').addEventListener('change', (e) => { S.onlyFlagged = e.target.checked; render(); });
$('#compare').addEventListener('change', (e) => { S.compare = e.target.value; updatePanes(); });
$('#reveal').addEventListener('change', (e) => { S.revealAll = e.target.checked; updatePanes(true); });
$('#point').addEventListener('click', () => setPicking(!S.picking));
$('#target-clear').addEventListener('click', () => { S.target = null; renderTarget(); });
$('#remove').addEventListener('click', () => sendFeedback('remove'));
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendFeedback('text'); });

document.addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.draft) S.drafts[e.target.dataset.draft] = e.target.value;
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.ticket');
  const t = card && S.data.tickets.find((x) => x.id === card.dataset.id);
  if (!t) return;
  const text = (S.drafts[t.id] || '').trim();
  switch (btn.dataset.act) {
    case 'goto': return goToTicket(t);
    case 'compare': return goToTicket(t, true);
    case 'cancel': return ticketAction(t.id, 'cancel');
    case 'accept': return ticketAction(t.id, 'accept', text);
    case 'reply':
    case 'reopen':
      if (!text) { toast('Write a comment first.'); $(`[data-draft="${t.id}"]`, card)?.focus(); return; }
      return ticketAction(t.id, btn.dataset.act, text);
    case 'undo':
      return ticketAction(t.id, 'reopen', (text ? text + '\n\n' : '') +
        `Please undo this change: put the deck back as it was before this ticket (version ${t.before}).`);
  }
});

// Hovering the "Pointing at" line of a ticket outlines that element in the slide.
document.addEventListener('mouseover', (e) => {
  const code = e.target.closest && e.target.closest('code[data-mark]');
  if (code) markTarget({ path: code.dataset.mark });
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest && e.target.closest('code[data-mark]')) markTarget(S.target);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.picking) { setPicking(false); return; }
  const field = /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName);
  if (field) {
    if (e.target.id === 'feedback' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendFeedback('text');
    }
    return;
  }
  if (S.view !== 'slides' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepSlide(-1); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepSlide(1); }
});

try { S.viewport = localStorage.getItem('flides-review:viewport') || S.viewport; } catch {}
if (!VIEWPORTS.some((v) => v.id === S.viewport)) S.viewport = 'screen';
$('#viewport').innerHTML = VIEWPORTS.map((v) => `<option value="${v.id}">${esc(v.label)}</option>`).join('');
$('#viewport').value = S.viewport;
$('#viewport').addEventListener('change', (e) => {
  S.viewport = e.target.value;
  try { localStorage.setItem('flides-review:viewport', S.viewport); } catch {}
  applyViewport();
});
applyViewport();

const fromHash = decodeURIComponent((location.hash.match(/slide=([^&]+)/) || [])[1] || '');
if (fromHash) S.current = fromHash;
refresh();
