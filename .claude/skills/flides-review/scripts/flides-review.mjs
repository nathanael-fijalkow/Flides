#!/usr/bin/env node
// Flides review: a local dashboard server and the ticket CLI used by the agent.
// No dependencies beyond Node.js (version 18 or later).
//
// All state lives in <deck>/.flides-review/:
//   tickets/T<n>.json      one file per ticket
//   versions/<n>/          immutable snapshot of the deck folder
//   versions/<n>.json      manifest of that snapshot (file hashes, label, date)
//   server.json            port and pid of the running dashboard server
//   agent.json             what the agent is doing (listening, working on a ticket)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = path.join(HERE, 'dashboard');
const STORE = '.flides-review';
const SKIPPED = new Set([STORE, '.git', 'node_modules', '.DS_Store']);
const DEFAULT_PORT = 4180;
const OPEN_STATES = ['open', 'in_progress'];

// ---------------------------------------------------------------------------
// Small helpers

const now = () => new Date().toISOString();

function die(message) {
  console.error('flides-review: ' + message);
  process.exit(1);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temporary file then rename, so readers never see half a file.
function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s);
      if (inline !== undefined) flags[name] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
      else flags[name] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------------------------------------------------------------------------
// Deck and store

function resolveDeck(arg = '.') {
  const p = path.resolve(arg);
  if (!fs.existsSync(p)) die(`no such file or folder: ${arg}`);
  let dir = p;
  let file = 'index.html';
  if (fs.statSync(p).isFile()) {
    dir = path.dirname(p);
    file = path.basename(p);
  } else {
    const saved = readJSON(path.join(p, STORE, 'config.json'));
    if (saved && saved.deckFile) file = saved.deckFile;
  }
  if (!fs.existsSync(path.join(dir, file))) die(`no ${file} in ${dir}`);
  const deck = { dir, file, store: path.join(dir, STORE) };
  ensureStore(deck);
  return deck;
}

function ensureStore(deck) {
  fs.mkdirSync(path.join(deck.store, 'tickets'), { recursive: true });
  fs.mkdirSync(path.join(deck.store, 'versions'), { recursive: true });
  const ignore = path.join(deck.store, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# Review data of the flides-review skill\n*\n');
  const config = path.join(deck.store, 'config.json');
  const saved = readJSON(config, {});
  if (saved.deckFile !== deck.file) writeJSON(config, { ...saved, deckFile: deck.file });
}

// A lock file shared by the server and the CLI, so that ticket numbers and
// snapshots are never allocated twice.
function withLock(deck, fn) {
  const lock = path.join(deck.store, 'lock');
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 120000) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {}
      if (Date.now() - start > 30000) die(`could not acquire ${lock} (remove it if no review command is running)`);
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Tickets

const ticketFile = (deck, id) => path.join(deck.store, 'tickets', `${id}.json`);
const ticketNumber = (id) => Number(String(id).replace(/^T/i, ''));

function normalizeId(id) {
  const n = ticketNumber(id);
  if (!Number.isInteger(n) || n < 1) die(`not a ticket id: ${id}`);
  return `T${n}`;
}

function listTickets(deck) {
  const dir = path.join(deck.store, 'tickets');
  return fs.readdirSync(dir)
    .filter((f) => /^T\d+\.json$/.test(f))
    .map((f) => readJSON(path.join(dir, f)))
    .filter(Boolean)
    .sort((a, b) => ticketNumber(a.id) - ticketNumber(b.id));
}

function loadTicket(deck, id) {
  const t = readJSON(ticketFile(deck, normalizeId(id)));
  if (!t) die(`no ticket ${id}`);
  return t;
}

function saveTicket(deck, t) {
  t.updated = now();
  writeJSON(ticketFile(deck, t.id), t);
  return t;
}

function updateTicket(deck, id, fn) {
  return withLock(deck, () => {
    const t = loadTicket(deck, id);
    fn(t);
    return saveTicket(deck, t);
  });
}

function createTicket(deck, input) {
  return withLock(deck, () => {
    const last = listTickets(deck).reduce((m, t) => Math.max(m, ticketNumber(t.id)), 0);
    const t = {
      id: `T${last + 1}`,
      kind: input.kind,
      status: 'open',
      created: now(),
      updated: now(),
      text: input.text || '',
      slide: input.slide || null,
      target: input.target || null,
      viewport: input.viewport || null,
      thread: [],
      rounds: [],
      before: null,
      after: null,
    };
    return saveTicket(deck, t);
  });
}

// ---------------------------------------------------------------------------
// Snapshots

function walk(dir, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(dir, r, out);
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

const hashFile = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

function listVersions(deck) {
  const dir = path.join(deck.store, 'versions');
  return fs.readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => readJSON(path.join(dir, f)))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
}

// Copy the deck folder into versions/<n>/. Files unchanged since the previous
// snapshot are hard links to it, so snapshots are cheap. If nothing changed at
// all, the previous snapshot is returned instead of a new one.
function snapshot(deck, label) {
  return withLock(deck, () => {
    const versions = path.join(deck.store, 'versions');
    const last = listVersions(deck).pop() || null;
    const files = {};
    for (const rel of walk(deck.dir)) files[rel] = hashFile(path.join(deck.dir, rel));
    const same = last
      && Object.keys(files).length === Object.keys(last.files).length
      && Object.entries(files).every(([rel, h]) => last.files[rel] === h);
    if (same) return last;

    const id = last ? last.id + 1 : 1;
    const dest = path.join(versions, String(id));
    for (const [rel, h] of Object.entries(files)) {
      const target = path.join(dest, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (last && last.files[rel] === h) {
        try {
          fs.linkSync(path.join(versions, String(last.id), rel), target);
          continue;
        } catch {}
      }
      fs.copyFileSync(path.join(deck.dir, rel), target);
    }
    const manifest = { id, label, created: now(), files };
    writeJSON(path.join(versions, `${id}.json`), manifest);
    return manifest;
  });
}

// Cheap fingerprint of the live deck (paths, sizes, dates), used by the
// dashboard to notice that the agent changed something.
function deckStamp(deck) {
  const h = crypto.createHash('sha1');
  for (const rel of walk(deck.dir)) {
    try {
      const s = fs.statSync(path.join(deck.dir, rel));
      h.update(`${rel}:${s.size}:${s.mtimeMs}\n`);
    } catch {}
  }
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Locating slides in the source, so the agent gets exact line numbers

function attr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function locateSlides(source) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  // Blank out comments, scripts and styles, keeping offsets and line breaks.
  const clean = source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (m, open, tag, body, close) => open + blank(body) + close);
  const lineAt = (offset) => clean.slice(0, offset).split('\n').length;
  const slides = [];
  const counts = {};
  const open = /<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g;
  let m;
  while ((m = open.exec(clean))) {
    const attrs = m[2] || '';
    const cls = attr(attrs, 'class');
    if (!cls || !cls.split(/\s+/).includes('step')) continue;
    const tag = m[1].toLowerCase();
    const close = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    close.lastIndex = open.lastIndex;
    let depth = 1;
    let end = -1;
    let c;
    while ((c = close.exec(clean))) {
      if (c[0].endsWith('/>')) continue;
      depth += c[1] ? -1 : 1;
      if (depth === 0) { end = c.index + c[0].length; break; }
    }
    const closed = end >= 0;
    if (!closed) end = clean.length;
    const id = attr(attrs, 'id') || '';
    const occurrence = id ? (counts[id] = (counts[id] ?? -1) + 1) : 0;
    slides.push({
      index: slides.length,
      id,
      occurrence,
      classes: cls,
      fixed: attr(attrs, 'data-fixed') === '1',
      closed,
      startLine: lineAt(m.index),
      endLine: lineAt(end),
      html: source.slice(m.index, end),
    });
  }
  return slides;
}

function findSlide(slides, ref) {
  if (!ref) return null;
  if (ref.id) {
    const same = slides.filter((s) => s.id === ref.id);
    return same[ref.occurrence || 0] || same[0] || null;
  }
  const s = slides[ref.index];
  return s && !s.id ? s : null;
}

// Each issue has a key that does not depend on line numbers, so that `done`
// can report only the issues that the agent's change introduced.
function checkSource(source) {
  const slides = locateSlides(source);
  const issues = [];
  const snippet = (s) => s.html.split('\n')[0].trim().slice(0, 80);
  const ids = new Set();
  const dup = {};
  for (const s of slides) {
    if (!s.id) issues.push({ key: `noid:${snippet(s)}`, text: `slide ${s.index + 1} (line ${s.startLine}) has no id` });
    else if (ids.has(s.id)) dup[s.id] = (dup[s.id] || 1) + 1;
    ids.add(s.id);
  }
  for (const [id, n] of Object.entries(dup)) {
    issues.push({ key: `dup:${id}:${n}`, text: `id "${id}" is used by ${n} slides (fine for overview slides that share CSS, otherwise a mistake)` });
  }
  const clean = source.replace(/<!--[\s\S]*?-->/g, '');
  const allIds = new Set([...clean.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  for (const m of clean.matchAll(/href\s*=\s*["']#\/?([^"']+)["']/g)) {
    if (!allIds.has(m[1])) issues.push({ key: `link:${m[1]}`, text: `link to "#${m[1]}" points to no element` });
  }
  for (const s of slides) {
    if (!s.closed) issues.push({ key: `open:${snippet(s)}`, text: `slide ${s.index + 1} (line ${s.startLine}) is never closed` });
  }
  return { slides, issues };
}

function checkDeck(deck) {
  return checkSource(fs.readFileSync(path.join(deck.dir, deck.file), 'utf8'));
}

// ---------------------------------------------------------------------------
// Presenting tickets to the agent

function indent(text, pad = '    ') {
  return String(text).split('\n').map((l) => pad + l).join('\n');
}

function describeTicket(deck, t) {
  const lines = [];
  const kind = t.kind === 'remove' ? 'REMOVE SLIDE' : 'feedback';
  lines.push(`Ticket ${t.id} [${t.status}] ${kind}`);
  const s = t.slide;
  if (s) {
    const name = s.id ? `id="${s.id}"${s.occurrence ? ` (occurrence ${s.occurrence + 1})` : ''}` : 'no id';
    const kinds = {
      overview: 'final overview, which zooms out over the whole deck (not numbered)',
      partial: 'partial overview, which zooms out to show only the slides seen so far (not numbered)',
      backup: 'backup slide, outside the main flow because of data-fixed="1" (not numbered)',
    };
    lines.push(`Slide: "${s.title || ''}" (${name})`);
    lines.push(`Kind: ${kinds[s.kind] || (s.number ? `slide number ${s.number} of the deck` : 'slide')}`);
    const source = fs.readFileSync(path.join(deck.dir, deck.file), 'utf8');
    const found = findSlide(locateSlides(source), s);
    if (found) {
      lines.push(`Location now: ${path.join(deck.dir, deck.file)} lines ${found.startLine}-${found.endLine} (step ${found.index + 1} of the file)`);
    } else {
      lines.push('Location now: not found in the current deck (removed, renamed, or it had no id and slides moved)');
    }
  } else {
    lines.push('Slide: none (feedback on the whole deck)');
  }
  if (t.target) {
    const g = t.target;
    lines.push(`Points at: <${g.tag}${g.id ? `#${g.id}` : ''}> inside the slide, path "${g.path}"`);
    if (g.text) lines.push(`  text: "${g.text}"`);
    if (g.html) lines.push(`  html: ${g.html}`);
  }
  if (t.viewport) {
    lines.push(`Seen on: a ${t.viewport.width} x ${t.viewport.height} screen (what fits depends on it, see the reference on geometry)`);
  }
  lines.push('Feedback:');
  lines.push(indent(t.text || (t.kind === 'remove' ? 'Remove this slide.' : '(empty)')));
  if (t.thread.length) {
    lines.push('Conversation since (oldest first):');
    for (const m of t.thread) lines.push(indent(`[${m.by}, ${m.at.slice(0, 16).replace('T', ' ')}] ${m.text}`));
  }
  if (s && s.html) {
    lines.push('Slide HTML when the ticket was written:');
    lines.push(indent(s.html));
  }
  if (t.before) {
    lines.push(`Deck before this ticket: ${path.join(deck.store, 'versions', String(t.before), deck.file)}`);
  }
  return lines.join('\n');
}

function summary(t) {
  const where = t.slide ? (t.slide.id || `slide ${t.slide.index + 1}`) : 'deck';
  const text = [t.kind === 'remove' ? '[remove]' : '', (t.text || '').replace(/\s+/g, ' ')].filter(Boolean).join(' ');
  return `${t.id} [${t.status}] ${where}: ${text.slice(0, 100)}`;
}

// A round is one stretch of work on a ticket, from `next` to `done`, `block`
// or `release`. The dashboard shows the changes of all rounds of a ticket.
function endRound(t, after) {
  const round = t.rounds[t.rounds.length - 1];
  if (round && !round.after) { round.after = after.id; round.ended = now(); }
  t.after = after.id;
}

function setAgent(deck, state) {
  writeJSON(path.join(deck.store, 'agent.json'), { ...state, at: now() });
}

// ---------------------------------------------------------------------------
// HTTP server

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function serveFile(res, root, rel, { review = false, cache = 'no-store' } = {}) {
  const file = path.resolve(root, '.' + path.sep + rel);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  if (rel.split('/').includes(STORE)) return send(res, 403, 'Forbidden');
  let stat;
  try { stat = fs.statSync(file); } catch { return send(res, 404, 'Not found'); }
  if (stat.isDirectory()) return send(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  let body = fs.readFileSync(file);
  if (review && (ext === '.html' || ext === '.htm')) {
    // Inject the review helper that lets the dashboard drive the deck.
    const tag = '<script src="/__review/frame.js"></script>';
    const html = body.toString('utf8');
    const at = html.toLowerCase().lastIndexOf('</body>');
    body = at >= 0 ? html.slice(0, at) + tag + html.slice(at) : html + tag;
  }
  send(res, 200, body, type, { 'Cache-Control': cache });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) { reject(new Error('request too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function cleanSlideRef(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    key: clip(s.key, 300),
    id: clip(s.id, 300),
    occurrence: Number.isInteger(s.occurrence) ? s.occurrence : 0,
    index: Number.isInteger(s.index) ? s.index : 0,
    number: Number.isInteger(s.number) ? s.number : null,
    kind: ['slide', 'overview', 'partial', 'backup'].includes(s.kind) ? s.kind : 'slide',
    title: clip(s.title, 300),
    html: clip(s.html, 200000),
  };
}

function cleanViewport(v) {
  if (!v || !Number.isInteger(v.width) || !Number.isInteger(v.height)) return null;
  return { width: v.width, height: v.height };
}

function cleanTarget(g) {
  if (!g || typeof g !== 'object') return null;
  return { tag: clip(g.tag, 40), id: clip(g.id, 200), path: clip(g.path, 1000), text: clip(g.text, 400), html: clip(g.html, 1200) };
}

function state(deck) {
  const source = fs.readFileSync(path.join(deck.dir, deck.file), 'utf8');
  const title = (source.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || path.basename(deck.dir);
  return {
    deck: { title: title.trim(), file: deck.file, dir: deck.dir, stamp: deckStamp(deck) },
    tickets: listTickets(deck),
    versions: listVersions(deck),
    agent: readJSON(path.join(deck.store, 'agent.json'), null),
    now: now(),
  };
}

async function handleAction(deck, id, body) {
  const text = clip(body.text, 20000).trim();
  const note = (t) => text && t.thread.push({ by: 'user', at: now(), text });
  const t = loadTicket(deck, id);
  const action = body.action;
  const allowed = {
    accept: ['done'],
    reopen: ['done', 'closed'],
    reply: ['blocked', 'open'],
    cancel: ['open', 'blocked'],
  };
  if (!allowed[action]) throw new Error(`unknown action ${action}`);
  if (!allowed[action].includes(t.status)) throw new Error(`cannot ${action} a ticket that is ${t.status}`);
  if ((action === 'reopen' || action === 'reply') && !text) throw new Error('a comment is required');
  return updateTicket(deck, id, (t) => {
    note(t);
    if (action === 'accept') t.status = 'closed';
    if (action === 'reopen') t.status = 'open';
    if (action === 'reply') t.status = 'open';
    if (action === 'cancel') t.status = 'cancelled';
  });
}

function startServer(deck, port, tries = 20) {
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      // Refuse other host names (DNS rebinding) and cross-site writes: the agent
      // acts on ticket text, so only this dashboard may create tickets.
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return send(res, 403, 'Forbidden host');
      const url = new URL(req.url, `http://${host}`);
      const p = decodeURIComponent(url.pathname);

      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (req.headers['x-flides-review'] !== '1' || (origin && origin !== `http://${host}`)) {
          return send(res, 403, 'Forbidden');
        }
        const body = await readBody(req);
        if (p === '/api/tickets') {
          const kind = body.kind === 'remove' ? 'remove' : 'text';
          const text = clip(body.text, 20000).trim();
          if (kind === 'text' && !text) return sendJSON(res, 400, { error: 'feedback text is required' });
          const t = createTicket(deck, {
            kind, text, slide: cleanSlideRef(body.slide), target: cleanTarget(body.target), viewport: cleanViewport(body.viewport),
          });
          return sendJSON(res, 200, t);
        }
        const m = p.match(/^\/api\/tickets\/(T\d+)\/action$/);
        if (m) {
          try { return sendJSON(res, 200, await handleAction(deck, m[1], body)); }
          catch (e) { return sendJSON(res, 400, { error: e.message }); }
        }
        return send(res, 404, 'Not found');
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (p === '/' || p === '/index.html') return serveFile(res, DASHBOARD, 'index.html');
      if (p === '/api/state') return sendJSON(res, 200, state(deck));
      if (p.startsWith('/__review/')) return serveFile(res, DASHBOARD, p.slice('/__review/'.length));
      const review = url.searchParams.has('review');
      if (p.startsWith('/deck/')) return serveFile(res, deck.dir, p.slice('/deck/'.length), { review });
      const v = p.match(/^\/v\/(\d+)\/(.*)$/);
      if (v) {
        const root = path.join(deck.store, 'versions', v[1]);
        return serveFile(res, root, v[2], { review, cache: 'max-age=3600' });
      }
      return send(res, 404, 'Not found');
    } catch (e) {
      send(res, 500, String(e && e.message || e));
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) startServer(deck, port + 1, tries - 1);
    else die(e.message);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    writeJSON(path.join(deck.store, 'server.json'), { pid: process.pid, port, url, started: now() });
    const cleanup = () => {
      const info = readJSON(path.join(deck.store, 'server.json'));
      if (info && info.pid === process.pid) fs.rmSync(path.join(deck.store, 'server.json'), { force: true });
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    console.log(`Flides review dashboard: ${url}`);
    console.log(`Deck: ${path.join(deck.dir, deck.file)}`);
  });
}

async function runningServer(deck) {
  const info = readJSON(path.join(deck.store, 'server.json'));
  if (!info) return null;
  try { process.kill(info.pid, 0); } catch { return null; }
  try {
    const r = await fetch(`http://localhost:${info.port}/api/state`);
    return r.ok ? info : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Commands

const HELP = `Usage: flides-review <command> [deck] [options]

[deck] is the deck folder or its HTML file (default: current folder).

Dashboard
  serve [deck] [--port N]     Start the review dashboard (keep it running in the background)
  url [deck]                  Print the dashboard address if the server is running

Agent loop
  wait [deck] [--timeout S]   Block until a ticket is open, then print the open tickets
  next [deck]                 Claim the oldest open ticket (or resume one in progress) and print it
  show <id> [deck] [--json]   Print a ticket
  done <id> [deck] --note T   Mark a ticket as done, with a note for the reviewer [--force]
  block <id> [deck] --note T  Ask the reviewer a question; the ticket waits for an answer
  release <id> [deck]         Put a claimed ticket back in the queue

Other
  list [deck] [--all]         List tickets (open and pending ones unless --all)
  check [deck]                Look for missing ids, duplicate ids and broken links
  snapshot [deck] [--label T] Record the current deck as a version
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const withId = ['show', 'done', 'block', 'release'].includes(cmd);
  const id = withId ? positional.shift() : null;
  if (withId && !id) die(`${cmd} needs a ticket id`);

  switch (cmd) {
    case 'serve': {
      const deck = resolveDeck(positional[0]);
      const running = await runningServer(deck);
      if (running) {
        console.log(`Flides review dashboard already running: ${running.url}`);
        return;
      }
      const v = snapshot(deck, 'start of review session');
      console.log(`Current deck recorded as version ${v.id}.`);
      startServer(deck, Number(flags.port) || DEFAULT_PORT);
      return;
    }
    case 'url': {
      const deck = resolveDeck(positional[0]);
      const running = await runningServer(deck);
      console.log(running ? running.url : 'No dashboard running for this deck.');
      return;
    }
    case 'wait': {
      const deck = resolveDeck(positional[0]);
      const timeout = Number(flags.timeout) || 0;
      const start = Date.now();
      let beat = 0;
      for (;;) {
        const open = listTickets(deck).filter((t) => OPEN_STATES.includes(t.status));
        if (open.length) {
          setAgent(deck, { state: 'busy' });
          console.log(`${open.length} ticket(s) to handle:`);
          for (const t of open) console.log('  ' + summary(t));
          console.log('Run "next" to claim the first one.');
          return;
        }
        if (Date.now() - beat > 5000) { setAgent(deck, { state: 'listening' }); beat = Date.now(); }
        if (timeout && Date.now() - start > timeout * 1000) {
          console.log('No new ticket before the timeout.');
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    case 'next': {
      const deck = resolveDeck(positional[0]);
      const tickets = listTickets(deck);
      const t = tickets.find((x) => x.status === 'in_progress') || tickets.find((x) => x.status === 'open');
      if (!t) {
        setAgent(deck, { state: 'idle' });
        console.log('No open tickets. Run "wait" in the background to listen for new ones.');
        return;
      }
      const resumed = t.status === 'in_progress';
      const before = resumed ? null : snapshot(deck, `before ${t.id}`);
      const claimed = updateTicket(deck, t.id, (x) => {
        if (!resumed) {
          x.status = 'in_progress';
          if (!x.before) x.before = before.id;
          x.rounds.push({ before: before.id, after: null, claimed: now() });
        }
      });
      setAgent(deck, { state: 'working', ticket: t.id });
      if (resumed) console.log(`(Resuming ${t.id}, which was already in progress.)\n`);
      console.log(describeTicket(deck, claimed));
      const left = tickets.filter((x) => x.status === 'open' && x.id !== t.id).length;
      console.log(`\nWhen finished: done ${t.id} --note "..."   (${left} more ticket(s) waiting)`);
      return;
    }
    case 'show': {
      const deck = resolveDeck(positional[0]);
      const t = loadTicket(deck, id);
      console.log(flags.json ? JSON.stringify(t, null, 2) : describeTicket(deck, t));
      return;
    }
    case 'done': {
      const deck = resolveDeck(positional[0]);
      if (typeof flags.note !== 'string' || !flags.note.trim()) die('done needs --note "what you changed"');
      const t = loadTicket(deck, id);
      if (t.status !== 'in_progress') die(`${t.id} is ${t.status}, not in progress`);
      const round = t.rounds[t.rounds.length - 1];
      // Refuse to close the ticket if the change broke ids, links or nesting.
      const beforeFile = round && path.join(deck.store, 'versions', String(round.before), deck.file);
      const known = new Set(beforeFile && fs.existsSync(beforeFile)
        ? checkSource(fs.readFileSync(beforeFile, 'utf8')).issues.map((i) => i.key)
        : []);
      const fresh = checkDeck(deck).issues.filter((i) => !known.has(i.key));
      if (fresh.length && !flags.force) {
        console.log(`${t.id} is still in progress: the change introduced these problems.`);
        for (const i of fresh) console.log('  - ' + i.text);
        console.log('Fix them and run done again, or add --force if they are intended.');
        process.exit(1);
      }
      const after = snapshot(deck, `after ${t.id}`);
      const closed = updateTicket(deck, id, (x) => {
        x.status = 'done';
        endRound(x, after);
        x.thread.push({ by: 'agent', at: now(), text: flags.note.trim() });
      });
      setAgent(deck, { state: 'busy' });
      console.log(`${t.id} done. Deck recorded as version ${after.id}.`);
      if (closed.rounds.every((r) => r.before === r.after)) console.log('Note: the deck files did not change while working on this ticket.');
      return;
    }
    case 'block': {
      const deck = resolveDeck(positional[0]);
      if (typeof flags.note !== 'string' || !flags.note.trim()) die('block needs --note "your question"');
      if (loadTicket(deck, id).status !== 'in_progress') die(`${normalizeId(id)} is not in progress`);
      const after = snapshot(deck, `${normalizeId(id)} waiting for an answer`);
      const t = updateTicket(deck, id, (x) => {
        x.status = 'blocked';
        endRound(x, after);
        x.thread.push({ by: 'agent', at: now(), text: flags.note.trim() });
      });
      setAgent(deck, { state: 'busy' });
      console.log(`${t.id} is waiting for the reviewer's answer.`);
      return;
    }
    case 'release': {
      const deck = resolveDeck(positional[0]);
      if (loadTicket(deck, id).status !== 'in_progress') die(`${normalizeId(id)} is not in progress`);
      const after = snapshot(deck, `${normalizeId(id)} released`);
      const t = updateTicket(deck, id, (x) => {
        x.status = 'open';
        endRound(x, after);
      });
      setAgent(deck, { state: 'busy' });
      console.log(`${t.id} is open again.`);
      return;
    }
    case 'list': {
      const deck = resolveDeck(positional[0]);
      const tickets = listTickets(deck).filter((t) => flags.all || ['open', 'in_progress', 'blocked', 'done'].includes(t.status));
      if (!tickets.length) console.log('No tickets.');
      for (const t of tickets) console.log(summary(t));
      return;
    }
    case 'check': {
      const deck = resolveDeck(positional[0]);
      const { slides, issues } = checkDeck(deck);
      console.log(`${slides.length} slides in ${deck.file}.`);
      if (!issues.length) console.log('No issues found.');
      for (const i of issues) console.log('  - ' + i.text);
      return;
    }
    case 'snapshot': {
      const deck = resolveDeck(positional[0]);
      const v = snapshot(deck, typeof flags.label === 'string' ? flags.label : 'manual snapshot');
      console.log(`Deck recorded as version ${v.id}.`);
      return;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;
    default:
      die(`unknown command ${cmd}\n\n${HELP}`);
  }
}

main();
