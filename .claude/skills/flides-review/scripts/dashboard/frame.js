// Injected by the review server into the deck page shown inside the dashboard.
// It exposes window.__review, which the dashboard (same origin) calls directly,
// and reports navigation inside the deck back to the dashboard.
(function () {
  'use strict';

  var RUNTIME_CLASSES = /^(active|seen|slide_step_visible|slide_step_hidden|token_visible|token_invisible_past|token_invisible_future|__review-.*)$/;
  var api = null;
  var gotoOriginal = null;
  var steps = [];
  var revealAll = true;
  var picking = null;
  var hovered = null;

  function post(msg) {
    msg.source = 'flides-review';
    try { window.parent.postMessage(msg, window.location.origin); } catch (e) {}
  }

  // The slides are the .step elements under the presentation root, which is
  // the closest ancestor with an id (the dashboard uses the same rule).
  function findRoot() {
    var first = document.querySelector('.step');
    if (!first) return null;
    var root = first.parentElement;
    while (root && !root.id && root !== document.body) root = root.parentElement;
    return root || document.body;
  }

  function activeStep() {
    return document.querySelector('.step.active');
  }

  function reveal() {
    var step = activeStep();
    if (!step) return;
    Array.prototype.forEach.call(step.querySelectorAll('.slide_step'), function (el) {
      el.classList.remove('slide_step_hidden');
      el.classList.add('slide_step_visible');
    });
  }

  function goto(index) {
    var el = steps[index];
    if (!el || !gotoOriginal) return false;
    gotoOriginal.call(api, el, 0);
    if (revealAll) reveal();
    return true;
  }

  // ---- Pointing at an element of the slide

  function addStyle() {
    var style = document.createElement('style');
    style.textContent =
      '.__review-hover{outline:4px solid #d9480f !important;outline-offset:3px;cursor:crosshair !important}' +
      '.__review-mark{outline:4px dashed #1971c2 !important;outline-offset:3px}' +
      'html.__review-picking, html.__review-picking *{cursor:crosshair !important}';
    document.head.appendChild(style);
  }

  // Map a raw event target to something meaningful to point at: a whole
  // formula rather than one of its glyphs, a whole SVG rather than a path.
  function pickable(el) {
    var step = activeStep();
    if (!step || !el || el === step || !step.contains(el)) return null;
    // Slide numbers are added by flides.js at runtime; they are not in the source.
    if (el.closest('.flides-slide-number')) return null;
    var math = el.closest && el.closest('.MathJax, .MathJax_Display, .MathJax_Preview, mjx-container');
    if (math && step.contains(math)) return math;
    var svg = el.ownerSVGElement ? el.closest('svg') : null;
    while (svg && svg.parentElement && svg.parentElement.closest('svg')) svg = svg.parentElement.closest('svg');
    if (svg && step.contains(svg)) return svg;
    return el;
  }

  function classesOf(el) {
    var list = el.classList ? Array.prototype.slice.call(el.classList) : [];
    return list.filter(function (c) { return !RUNTIME_CLASSES.test(c) && !/^(MathJax|CtxtMenu)/.test(c); });
  }

  function cssPath(el, stop) {
    var parts = [];
    while (el && el !== stop) {
      var tag = el.tagName.toLowerCase();
      if (el.id && !/^MathJax/.test(el.id)) { parts.unshift(tag + '#' + el.id); break; }
      var part = tag + classesOf(el).map(function (c) { return '.' + c; }).join('');
      var parent = el.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(' > ');
  }

  // The LaTeX source of a rendered formula, which is what the agent finds in
  // the deck file.
  function texSource(el) {
    if (!el.matches('.MathJax, .MathJax_Display, mjx-container')) return null;
    // MathJax 2 keeps it in a script right after the formula.
    var next = el.nextElementSibling;
    if (next && /math\/tex/.test(next.type || '')) return '$' + next.textContent + '$';
    // MathJax 3 keeps it on its math items.
    try {
      var items = window.MathJax.startup.document.getMathItemsWithin(el);
      if (items && items.length) return (items[0].display ? '$$' : '$') + items[0].math + (items[0].display ? '$$' : '$');
    } catch (e) {}
    return null;
  }

  function describe(el) {
    var step = activeStep();
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var html;
    var tex = texSource(el);
    if (tex) {
      text = tex;
      html = tex;
    } else {
      var clone = el.cloneNode(true);
      [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('[class]'))).forEach(function (n) {
        var keep = classesOf(n);
        if (keep.length) n.setAttribute('class', keep.join(' '));
        else n.removeAttribute('class');
      });
      html = clone.outerHTML;
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id && !/^MathJax/.test(el.id) ? el.id : '',
      path: cssPath(el, step),
      text: text.slice(0, 300),
      html: html.length > 1000 ? html.slice(0, 1000) + '...' : html,
    };
  }

  function setHover(el) {
    if (hovered) hovered.classList.remove('__review-hover');
    hovered = el;
    if (el) el.classList.add('__review-hover');
  }

  function stopPick() {
    picking = null;
    setHover(null);
    document.documentElement.classList.remove('__review-picking');
  }

  // Other slides (typically empty overview slides) often lie on top of the
  // active one, so look through every element under the pointer.
  function pickAt(e) {
    var under = document.elementsFromPoint(e.clientX, e.clientY);
    for (var i = 0; i < under.length; i++) {
      var el = pickable(under[i]);
      if (el) return el;
    }
    return null;
  }

  document.addEventListener('mousemove', function (e) {
    if (picking) setHover(pickAt(e));
  }, true);

  // Capture phase, so that Flides never sees the click while pointing.
  document.addEventListener('click', function (e) {
    if (!picking) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var el = pickAt(e);
    if (!el) return;
    var done = picking;
    stopPick();
    done(describe(el));
  }, true);

  document.addEventListener('keydown', function (e) {
    if (picking && e.key === 'Escape') {
      stopPick();
      post({ type: 'pick-cancelled' });
    }
  }, true);

  function clearMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('.__review-mark'), function (n) {
      n.classList.remove('__review-mark');
    });
  }

  function mark(path) {
    clearMarks();
    var step = activeStep();
    if (!step || !path) return false;
    var el = null;
    try { el = step.querySelector(':scope > ' + path); } catch (e) {}
    if (!el) { try { el = step.querySelector(path); } catch (e) {} }
    if (el) el.classList.add('__review-mark');
    return !!el;
  }

  // ---- Start

  function start() {
    var root = findRoot();
    if (!root || typeof window.flides !== 'function') {
      post({ type: 'error', message: 'This page does not look like a Flides deck.' });
      return;
    }
    api = window.flides(root.id);
    if (!api || typeof api.goto !== 'function' || !document.querySelector('.step.active')) {
      post({ type: 'error', message: 'Flides did not start in this page (is flides().init() called?).' });
      return;
    }
    steps = Array.prototype.slice.call(root.querySelectorAll('.step'));
    addStyle();

    // Flides calls api.goto on window resize and on clicks, which hides the
    // reveals again; reveal them after every such call.
    gotoOriginal = api.goto;
    api.goto = function () {
      var result = gotoOriginal.apply(this, arguments);
      if (revealAll) reveal();
      return result;
    };
    document.addEventListener('flides:stepenter', function (e) {
      if (revealAll) reveal();
      post({ type: 'stepenter', index: steps.indexOf(e.target) });
    });

    window.__review = {
      count: steps.length,
      goto: goto,
      setRevealAll: function (on) { revealAll = !!on; },
      pick: function (callback) {
        picking = callback;
        document.documentElement.classList.add('__review-picking');
      },
      cancelPick: stopPick,
      mark: mark,
      clearMarks: clearMarks,
    };
    post({ type: 'ready', count: steps.length });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
