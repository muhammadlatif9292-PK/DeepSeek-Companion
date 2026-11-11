
// ── DSC SEND ENGINE v5 ──────────────────────────────────────────────────────
// Fixes applied:
//   1. beforeinput fires BEFORE execCommand (Lexical/React requirement)
//   2. Send button scoped to editor container, rightmost enabled wins
//   3. Full pointer+mouse event chain for send button
//   4. Button-enabled polling (up to 2s) before clicking
//   5. Send verification: watches for empty editor / assistant streaming
//   6. Auto-retry up to 3 times on failure
// ────────────────────────────────────────────────────────────────────────────

function _dscSleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// Inject text into a Lexical/React contenteditable.
// CRITICAL ORDER: focus → selectionchange → beforeinput → execCommand → input → change
function _dscInjectText(editor, text) {
  console.log('[DSC INJECT] editor:', !!editor, 'CE:', editor && editor.isContentEditable);

  editor.focus();
  editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  editor.dispatchEvent(new Event('selectionchange', { bubbles: true }));

  // Place cursor at end
  var sel = window.getSelection();
  var rng = document.createRange();
  rng.selectNodeContents(editor);
  rng.collapse(false);
  sel.removeAllRanges();
  sel.addRange(rng);

  // Clear existing content
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  // beforeinput MUST fire BEFORE execCommand so Lexical can update EditorState
  editor.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true, cancelable: true, inputType: 'insertText', data: text
  }));

  // Primary insertion — triggers browser native input pipeline Lexical hooks into
  var inserted = document.execCommand('insertText', false, text);
  console.log('[DSC INJECT] execCommand result:', inserted, 'text:', (editor.textContent||'').trim());

  // Backup: if execCommand silently failed, use Range/Selection API
  if (!(editor.textContent || '').trim()) {
    var txtNode = document.createTextNode(text);
    var r2 = document.createRange();
    r2.selectNodeContents(editor);
    r2.collapse(false);
    r2.insertNode(txtNode);
    r2.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r2);
    console.log('[DSC INJECT] Range fallback used');
  }

  editor.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true, inputType: 'insertText', data: text
  }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  editor.dispatchEvent(new Event('keyup',  { bubbles: true }));

  console.log('[DSC INJECT] final text:', (editor.textContent||'').trim());
}

// Inject text into a plain <textarea> via React's native setter
function _dscInjectTextarea(ta, text) {
  ta.focus();
  var desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  if (desc && desc.set) { desc.set.call(ta, text); } else { ta.value = text; }
  ta.dispatchEvent(new Event('input',  { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[DSC INJECT] textarea:', ta.value);
}

// Find the rightmost visible ENABLED button with SVG, scoped near the editor
function _dscFindSendButton(editor) {
  // Strategy: find the button whose centre is closest to the
  // bottom-right corner of the editor box.
  // This works regardless of DOM nesting — DeepSeek's send button is a
  // sibling/cousin of the contenteditable, NOT necessarily inside the
  // same form or direct parent chain.

  var editorRect = editor ? editor.getBoundingClientRect() : null;

  // Anchor point = bottom-right of the editor input area
  var anchorX = editorRect ? editorRect.right  : window.innerWidth;
  var anchorY = editorRect ? editorRect.bottom : window.innerHeight;

  console.log('[DSC SEND BTN] anchor:', anchorX, anchorY);

  var allButtons = Array.from(document.querySelectorAll('button'));

  // Filter: visible, has SVG icon, not disabled, within 300px of anchor
  var candidates = allButtons.filter(function(btn) {
    var rect     = btn.getBoundingClientRect();
    var disabled = btn.disabled
      || btn.getAttribute('aria-disabled') === 'true'
      || btn.hasAttribute('disabled');

    if (disabled)           return false;
    if (!btn.querySelector('svg')) return false;
    if (rect.width  < 20)  return false;
    if (rect.height < 20)  return false;
    if (rect.bottom <= 0)  return false;
    if (rect.top >= window.innerHeight) return false;

    // Must be near the bottom-right of the editor, not far above it
    var btnCX = rect.left + rect.width  / 2;
    var btnCY = rect.top  + rect.height / 2;
    var dx    = btnCX - anchorX;
    var dy    = btnCY - anchorY;
    var dist  = Math.sqrt(dx * dx + dy * dy);

    // Button centre must be within 300px of the editor's bottom-right
    // AND must not be above the top of the editor (rules out toolbar btns)
    var aboveEditor = editorRect && rect.bottom < editorRect.top - 20;
    return dist < 300 && !aboveEditor;
  });

  console.log('[DSC SEND BTN] proximity candidates:', candidates.length);

  // If nothing found within 300px, fall back to any enabled SVG button
  // in the lower half of the screen (last resort)
  if (!candidates.length) {
    candidates = allButtons.filter(function(btn) {
      var rect     = btn.getBoundingClientRect();
      var disabled = btn.disabled
        || btn.getAttribute('aria-disabled') === 'true'
        || btn.hasAttribute('disabled');
      return !disabled && btn.querySelector('svg')
        && rect.width > 20 && rect.height > 20
        && rect.top > window.innerHeight * 0.5   // lower half only
        && rect.bottom > 0;
    });
    console.log('[DSC SEND BTN] fallback candidates:', candidates.length);
  }

  if (!candidates.length) return null;

  // Among candidates, pick the one closest to anchor
  candidates.sort(function(a, b) {
    var ra = a.getBoundingClientRect();
    var rb = b.getBoundingClientRect();
    var dxa = (ra.left + ra.width  / 2) - anchorX;
    var dya = (ra.top  + ra.height / 2) - anchorY;
    var dxb = (rb.left + rb.width  / 2) - anchorX;
    var dyb = (rb.top  + rb.height / 2) - anchorY;
    return (dxa*dxa + dya*dya) - (dxb*dxb + dyb*dyb);
  });

  var chosen = candidates[0];
  var cr = chosen.getBoundingClientRect();
  console.log('[DSC SEND BTN] chosen rect:', cr.left, cr.top, cr.right, cr.bottom,
    'text:', (chosen.innerText||'').trim(),
    'aria-label:', chosen.getAttribute('aria-label'));

  return chosen;
}

// Poll until send button is enabled (max maxWaitMs), then fire full event chain
async function _dscClickSendWhenReady(editor, maxWaitMs) {
  maxWaitMs = maxWaitMs || 2000;
  var waited = 0, interval = 100, btn = null;

  while (waited < maxWaitMs) {
    btn = _dscFindSendButton(editor);
    var disabled = !btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true';
    console.log('[DSC POLL] waited=' + waited + 'ms btn?', !!btn, 'disabled?', disabled);
    if (btn && !disabled) break;
    await _dscSleep(interval);
    waited += interval;
  }

  if (!btn) { console.log('[DSC POLL] button never found'); return false; }
  console.log('[DSC POLL] clicking button');

  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type) {
    btn.dispatchEvent(new MouseEvent(type, {
      view: window, bubbles: true, cancelable: true, buttons: 1
    }));
  });
  btn.click();
  return true;
}

// Verify send succeeded: editor empty OR streaming detected
async function _dscVerifySent(editor, timeoutMs) {
  timeoutMs = timeoutMs || 2500;
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await _dscSleep(300);
    var empty = !(editor.textContent || '').trim();
    var streaming = !!(
      document.querySelector('.ds-markdown--streaming') ||
      document.querySelector('[class*="streaming"]') ||
      document.querySelector('[class*="generating"]')
    );
    console.log('[DSC VERIFY] empty:', empty, 'streaming:', streaming);
    if (empty || streaming) return true;
  }
  console.log('[DSC VERIFY] not confirmed after', timeoutMs, 'ms');
  return false;
}

// Master send: inject → poll button → click → verify → retry up to 3x
async function deepSeekRealSend(text) {
  var MAX = 3;
  for (var attempt = 1; attempt <= MAX; attempt++) {
    console.log('[DSC REAL SEND] attempt', attempt, '/', MAX);

    var editor =
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea');

    console.log('[DSC REAL SEND] editor found?', !!editor);

    if (!editor) { await _dscSleep(800); continue; }

    if (editor.isContentEditable || editor.getAttribute('contenteditable') === 'true') {
      _dscInjectText(editor, text);
    } else {
      _dscInjectTextarea(editor, text);
    }

    var clicked = await _dscClickSendWhenReady(editor, 2000);

    if (!clicked) {
      console.log('[DSC REAL SEND] button not ready; trying Enter');
      var opts = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true };
      editor.dispatchEvent(new KeyboardEvent('keydown',  opts));
      editor.dispatchEvent(new KeyboardEvent('keypress', opts));
      editor.dispatchEvent(new KeyboardEvent('keyup',    opts));
    }

    await _dscSleep(600);
    var sent = await _dscVerifySent(editor, 2500);
    if (sent) { console.log('[DSC REAL SEND] SUCCESS on attempt', attempt); return true; }

    console.log('[DSC REAL SEND] attempt', attempt, 'failed; retrying...');
    await _dscSleep(1000);
  }

  console.log('[DSC REAL SEND] all attempts exhausted');
  return false;
}
// ── END DSC SEND ENGINE v5 ──────────────────────────────────────────────────



// content.js — DeepSeek Companion Pro v6.0
(function () {
  'use strict';

  const VERSION = '6.0.0';

  // ── STATE ──────────────────────────────────────────────────────────────────
  let rawVaultAll    = [];
  let codeVault      = [];
  let sidebarFrame   = null;
  let sidebarLoaded  = false;
  let pendingSidebarMsgs = [];
  let sidebarOpen    = false;
  let lastUrl        = location.href;
  let scanInProgress = false;
  const seenFP       = new Set();
  let visObserver    = null;

  // Boundary zone
  let bndStart   = null;
  let bndEnd     = null;
  let bndSelMode = null;
  let bndOverlay = null;

  // ── INIT ───────────────────────────────────────────────────────────────────
  function init() {
    injectSidebarToggle();
    injectSidebarFrame();
    injectGlobalStyles();
    setupRuntimeListener();
    startMutationObserver();
    watchUrlChanges();
    startVisObs();
    scanAll();
    setTimeout(function () { scanAll(); startVisObs(); }, 1500);
    setTimeout(scanAll, 4000);
    setTimeout(scanAll, 9000);
    console.log('[DSC Pro] v' + VERSION + ' ready');
  }

  function setupRuntimeListener() {
    if (window.__dscRuntimeBound) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    window.__dscRuntimeBound = true;
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || !message.type) return;
      if (message.type === 'DSC_TOAST') {
        DSToast(message.msg || '', message.kind || 'info');
      } else if (message.type === 'DSC_GENERATE_PDF') {
        injectSidebarFrame();
        postToSidebar({
          type: 'DSC_GENERATE_PDF',
          text: message.text || '',
          title: message.title || document.title
        }, true);
      }
    });
  }

  // ── STYLES ─────────────────────────────────────────────────────────────────
  function injectGlobalStyles() {
    if (document.getElementById('dsc-global-styles')) return;
    var s = document.createElement('style');
    s.id = 'dsc-global-styles';
    s.textContent = [
      '#dsc-toggle-btn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483640;background:#161b22;border:1px solid #30363d;border-right:none;color:#e6edf3;width:28px;height:64px;border-radius:8px 0 0 8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:right 0.3s cubic-bezier(0.4,0,0.2,1),background 0.2s;box-shadow:-2px 0 12px rgba(0,0,0,0.3);}',
      '#dsc-toggle-btn:hover{background:#21262d;}',
      '#dsc-sidebar-frame{position:fixed;right:0;top:0;width:380px;height:100vh;z-index:2147483639;border:none;border-left:1px solid #30363d;transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);box-shadow:-4px 0 20px rgba(0,0,0,0.4);will-change:transform;}',
      '#dsc-sidebar-frame.open{transform:translateX(0);}',
      '.dsc-floating-toolbar{position:absolute;top:-34px;right:8px;background:#161b22;border:1px solid #30363d;border-radius:20px;padding:4px 8px;display:flex;gap:4px;z-index:100;box-shadow:0 2px 12px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.15s;pointer-events:none;}',
      '.dsc-message-wrapper:hover .dsc-floating-toolbar{opacity:1;pointer-events:all;}',
      '.dsc-toolbar-btn{background:none;border:none;color:#8b949e;cursor:pointer;padding:3px 7px;border-radius:12px;font-size:12px;white-space:nowrap;transition:color 0.15s,background 0.15s;}',
      '.dsc-toolbar-btn:hover{color:#e6edf3;background:#21262d;}',
      '@keyframes dscBndIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
      '#dsc-bnd-overlay{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#0d1117;border:1.5px solid #2f81f7;border-radius:10px;padding:10px 18px;z-index:2147483641;display:flex;align-items:center;gap:10px;color:#e6edf3;font-size:13px;font-weight:500;box-shadow:0 4px 24px rgba(47,129,247,0.35);animation:dscBndIn 0.2s ease;white-space:nowrap;}',
      '.dsc-bnd-sel [data-dsc-mi]{cursor:crosshair!important;}',
      '.dsc-bnd-sel [data-dsc-mi]:hover{outline:2px dashed #2f81f7!important;outline-offset:3px!important;background:rgba(47,129,247,0.06)!important;}',
      '[data-dsc-bnd="start"]{border-left:3px solid #3fb950!important;position:relative;}',
      '[data-dsc-bnd="end"]{border-left:3px solid #f85149!important;position:relative;}',
      '[data-dsc-bnd="in"]{border-left:3px solid #2f81f7!important;background:rgba(47,129,247,0.025)!important;}',
      '[data-dsc-bnd="start"]::before{content:"RANGE START";position:absolute;top:4px;left:8px;font-size:9px;font-weight:700;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:#3fb950;color:#0d1117;z-index:5;}',
      '[data-dsc-bnd="end"]::before{content:"RANGE END";position:absolute;top:4px;left:8px;font-size:9px;font-weight:700;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:#f85149;color:#fff;z-index:5;}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── SIDEBAR ────────────────────────────────────────────────────────────────
  function injectSidebarToggle() {
    if (document.getElementById('dsc-toggle-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'dsc-toggle-btn';
    btn.title = 'DeepSeek Companion Pro';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
    btn.addEventListener('click', toggleSidebar);
    document.body.appendChild(btn);
  }

  function injectSidebarFrame() {
    if (document.getElementById('dsc-sidebar-frame')) return;
    sidebarFrame = document.createElement('iframe');
    sidebarFrame.id = 'dsc-sidebar-frame';
    sidebarFrame.src = chrome.runtime.getURL('sidebar/sidebar.html');
    document.body.appendChild(sidebarFrame);
    sidebarFrame.addEventListener('load', function () {
      sidebarLoaded = true;
      setTimeout(function () {
        syncSidebar();
        while (pendingSidebarMsgs.length) {
          postToSidebar(pendingSidebarMsgs.shift());
        }
      }, 250);
    });
  }

  // Sidebar width — kept in one place so resize stays consistent
  var SIDEBAR_W = 380;

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    sidebarFrame.classList.toggle('open', sidebarOpen);
    // Use CSS `right` (which is transitioned in the stylesheet) instead of
    // jumping the button — this eliminates the position-jitter on scroll.
    document.getElementById('dsc-toggle-btn').style.right = sidebarOpen ? SIDEBAR_W + 'px' : '0';
  }

  // ── LINE-1 PATH EXTRACTION (fastest, highest confidence) ──────────────────
  function extractPathFromLine1(code) {
    if (!code) return null;
    var first = code.split(/\r?\n/)[0].trim();
    var patterns = [
      /^\/\/\s+([\w./\-]+\/[\w.\-]+\.[\w]{1,8})\s*$/,
      /^\/\/\s+(src\/[\w./\-]+\.[\w]{1,8})/,
      /^#\s+(src\/[\w./\-]+\.[\w]{1,8})/,
      /^\/\*\s*(src\/[\w./\-]+\.[\w]{1,8})\s*\*\//,
      /^<!--\s*(src\/[\w./\-]+\.[\w]{1,8})\s*-->/,
      /^\/\/\s+([\w][\w./\-]*\/[\w.\-]+\.[\w]{1,8})\s*(?:[-\u2013\u2014].*)?$/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = first.match(patterns[i]);
      if (m && m[1] && m[1].length < 150 && m[1].indexOf('://') === -1)
        return m[1].replace(/^\.\//, '');
    }
    return null;
  }

  var EXT_MIME = {
    jsx:'text/javascript', py:'text/x-python', css:'text/css',
    html:'text/html', json:'application/json', sh:'text/x-sh',
    md:'text/markdown', yml:'text/yaml', yaml:'text/yaml',
    sql:'text/sql', txt:'text/plain', rs:'text/x-rust',
    go:'text/x-go', java:'text/x-java', php:'text/x-php'
  };

  // ── SYNC ───────────────────────────────────────────────────────────────────
  function syncSidebar() {
    if (!sidebarFrame || !sidebarFrame.contentWindow) return;
    // Strip DOM references before postMessage — they can't cross frame boundary
    var safeClean = codeVault.map(function (b) {
      var r = Object.assign({}, b); delete r.preEl; delete r.blockDiv; return r;
    });
    var safeRaw = rawVaultAll.map(function (b) {
      var r = Object.assign({}, b); delete r.preEl; delete r.blockDiv; return r;
    });
    var totalMsgs = countAllMessages();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        dscStats: { vaultCount: safeClean.length, totalMsgs: totalMsgs, updatedAt: Date.now() }
      });
    }
    sidebarFrame.contentWindow.postMessage({
      type: 'DSC_SYNC',
      codeVault: safeClean,
      rawVault: safeRaw,
      conversationId: DSHelpers.getConversationId(),
      bndStart: bndStart,
      bndEnd: bndEnd,
      totalMsgs: totalMsgs
    }, '*');
  }

  // ── JUNK FILTER ────────────────────────────────────────────────────────────
  function isJunk(lang, code) {
    var lines = code.trim().split('\n').filter(function (l) { return l.trim(); }).length;
    var isSh = lang === 'bash' || lang === 'sh' || lang === 'shell';
    if (isSh && lines === 1) return true;
    if (isSh && lines <= 5) {
      var termRx = /^(cd |ls |cat |echo |pwd |mkdir |rm |cp |mv |touch |grep |find |tail |head |wc |curl |wget |chmod |unzip |zip |npm run|yarn |pip |python3? |node |npx |git |docker |sudo |export |source |\.\/|bash |sh )/;
      if (code.trim().split('\n').every(function (l) {
        return !l.trim() || l.trim().charAt(0) === '#' || termRx.test(l.trim());
      })) return true;
    }
    if (!lang || lang === 'text' || lang === 'plaintext') {
      if (/^(Output\s*$|Error:|  inflating:|  adding:|  creating:)/m.test(code.trim())) return true;
    }
    return false;
  }

  // ── BOUNDARY FILTER ────────────────────────────────────────────────────────
  function inBoundary(msgIdx) {
    if (bndStart === null) return true;
    var lo = bndEnd !== null ? Math.min(bndStart, bndEnd) : bndStart;
    var hi = bndEnd !== null ? Math.max(bndStart, bndEnd) : bndStart;
    return msgIdx >= lo && msgIdx <= hi;
  }

  // ── DOM-ORDER STABLE INDEXING ──────────────────────────────────────────────
  function reindexAll() {
    var els = Array.from(document.querySelectorAll('[data-dsc-root]'));
    els.sort(function (a, b) {
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    els.forEach(function (el, i) {
      el.dataset.dscMi = i;
      el.setAttribute('data-dsc-mi', String(i));
    });
    return els;
  }

  function fixBlockIndices() {
    reindexAll();
    rawVaultAll.forEach(function (b) {
      if (!b.preEl) return;
      var root = b.preEl.closest('[data-dsc-root]');
      if (root && root.dataset.dscMi != null) b.msgIdx = parseInt(root.dataset.dscMi);
    });
  }

  // ── VERSION RESOLUTION ─────────────────────────────────────────────────────
  // For path-keyed files: last DOM occurrence wins (= most recent version).
  // For anonymous blocks: deduplicate by lang+content fingerprint.
  function buildCleanVault() {
    fixBlockIndices();
    var source = rawVaultAll.filter(function (b) {
      return inBoundary(b.msgIdx != null ? b.msgIdx : 0);
    });

    // Pass 1: path-keyed — last occurrence overwrites earlier (latest wins)
    var byPath = new Map();
    source.forEach(function (b) {
      if (isJunk(b.lang, b.code)) return;
      var key = (b.filename || '').toLowerCase().trim();
      if (key && (key.indexOf('/') !== -1 || b.confidence === 'high')) {
        byPath.set(key, b);
      }
    });

    // Pass 2: anonymous — first unique content fingerprint only
    var byContent = new Map();
    source.forEach(function (b) {
      if (isJunk(b.lang, b.code)) return;
      var key = (b.filename || '').toLowerCase().trim();
      if (key && (key.indexOf('/') !== -1 || b.confidence === 'high')) return;
      var fp = b.lang + '::' + b.code.trim();
      if (!byContent.has(fp)) byContent.set(fp, b);
    });

    codeVault = Array.from(byPath.values()).concat(Array.from(byContent.values()));
  }

  // ── MESSAGE CONTAINERS — confirmed selectors from real DeepSeek DOM ────────
  // Outer wrapper: div._4f9bf79._43c05b5  (or with d7dc56a8 added for some msgs)
  // Message:       div.ds-message._63c77b1
  // Assistant:     has div.ds-markdown child
  function getMsgContainers() {
    var seen = new Set();
    var out = [];
    function push(el) {
      if (el && el.nodeType === 1 && !seen.has(el)) { seen.add(el); out.push(el); }
    }
    // Primary: confirmed real selector
    document.querySelectorAll('.ds-message').forEach(push);
    // Also get outer wrappers in case ds-message isn't the right level for some blocks
    document.querySelectorAll('[class*="_4f9bf79"]').forEach(function (el) {
      var inner = el.querySelector('.ds-message');
      if (inner) push(inner); else push(el);
    });
    // Fallback: walk up from any pre inside md-code-block
    document.querySelectorAll('.md-code-block pre').forEach(function (pre) {
      push(
        pre.closest('.ds-message') ||
        pre.closest('[class*="message"]') ||
        pre.parentElement
      );
    });
    out.forEach(function (el) { if (!el.dataset.dscRoot) el.dataset.dscRoot = '1'; });
    return out;
  }

  // ── REGISTER ───────────────────────────────────────────────────────────────
  function register(container) {
    if (!container || container.nodeType !== 1) return;
    container.dataset.dscRoot = '1';
    wrapMessageForUI(container);

    if (visObserver && !container.dataset.dscObserved) {
      visObserver.observe(container);
      container.dataset.dscObserved = '1';
    }

    var blocks = CodeExtractor.extract(container);
    if (!blocks.length) return;

    var changed = false;
    blocks.forEach(function (block) {
      var fp = block.lang + '::' + block.code.trim();
      if (seenFP.has(fp)) return;
      seenFP.add(fp);

      // Line-1 path detection — highest confidence override
      var p1 = extractPathFromLine1(block.code);
      if (p1) {
        block.filename = p1;
        var ext = p1.split('.').pop().toLowerCase();
        block.mimeType = EXT_MIME[ext] || block.mimeType || 'text/plain';
        block.confidence = 'high';
      }

      CodeExtractor.injectDownloadButton(
        block.preEl, { filename: block.filename, mimeType: block.mimeType }, block.code
      );

      block.msgIdx = container.dataset.dscMi != null ? parseInt(container.dataset.dscMi) : 0;
      rawVaultAll.push(block);
      changed = true;
    });

    if (changed) {
      fixBlockIndices();
      buildCleanVault();
      syncSidebar();
    }
  }

  function scanAll() {
    getMsgContainers().forEach(function (c) { register(c); });
  }

  // ── INTERSECTION OBSERVER ──────────────────────────────────────────────────
  function startVisObs() {
    if (visObserver) visObserver.disconnect();
    visObserver = new IntersectionObserver(function (entries) {
      var anyNew = false;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        CodeExtractor.extract(el).forEach(function (block) {
          var fp = block.lang + '::' + block.code.trim();
          if (seenFP.has(fp)) return;
          seenFP.add(fp);

          var p1 = extractPathFromLine1(block.code);
          if (p1) {
            block.filename = p1;
            var ext = p1.split('.').pop().toLowerCase();
            block.mimeType = EXT_MIME[ext] || block.mimeType || 'text/plain';
            block.confidence = 'high';
          }

          CodeExtractor.injectDownloadButton(
            block.preEl, { filename: block.filename, mimeType: block.mimeType }, block.code
          );

          var root = block.preEl && block.preEl.closest('[data-dsc-root]');
          block.msgIdx = (root && root.dataset.dscMi != null) ? parseInt(root.dataset.dscMi) : 0;
          rawVaultAll.push(block);
          anyNew = true;
        });
      });
      if (anyNew) { fixBlockIndices(); buildCleanVault(); syncSidebar(); }
    }, { threshold: 0.05 });

    document.querySelectorAll('[data-dsc-root]').forEach(function (el) {
      if (!el.dataset.dscObserved) { visObserver.observe(el); el.dataset.dscObserved = '1'; }
    });
  }

  // ── DEEP SCAN ──────────────────────────────────────────────────────────────
  // Strategy: scroll in large steps, use requestAnimationFrame to wait for
  // paint settle instead of fixed timers. This is ~3-4x faster than before.
  async function deepScan() {
    if (scanInProgress) return;
    scanInProgress = true;
    postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'start', count: rawVaultAll.length });

    var scroller = DOMScanner.getMainScrollArea();
    if (!scroller || scroller === document.body) {
      scanAll();
      scanInProgress = false;
      postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'done', count: rawVaultAll.length });
      DSToast('Scan done — ' + codeVault.length + ' files', 'success');
      return;
    }

    var savedTop   = scroller.scrollTop;
    var viewH      = scroller.clientHeight;
    var startPos   = 0;
    var endPos     = scroller.scrollHeight;

    // --- Zone boundary pre-pass ---
    if (bndStart !== null) {
      scroller.scrollTop = 0;
      await waitFrames(4);
      scanAll(); reindexAll();
      var startEl = document.querySelector('[data-dsc-mi="' + bndStart + '"]');
      if (startEl) startPos = Math.max(0, startEl.offsetTop - viewH * 0.15);
      if (bndEnd !== null) {
        var endEl = document.querySelector('[data-dsc-mi="' + bndEnd + '"]');
        if (endEl) endPos = Math.min(scroller.scrollHeight, endEl.offsetTop + endEl.offsetHeight + viewH * 0.25);
      }
    }

    scroller.scrollTop = startPos;
    await waitFrames(4);

    // Large steps: 80% of viewport = fewer iterations, still catches everything
    // DeepSeek renders code blocks eagerly (not lazy) so we don't need tiny steps.
    var STEP  = Math.floor(viewH * 0.80);
    var iters = 0;
    var MAX   = 600;

    while (iters++ < MAX) {
      scanAll();
      await waitFrames(2); // 2 frames ≈ 33ms at 60fps — enough for DOM paint

      var cur = scroller.scrollTop;
      var pct = Math.min(99, Math.round(((cur - startPos) / Math.max(1, endPos - startPos)) * 100));
      postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'progress', pct: pct, count: rawVaultAll.length });

      if (cur + viewH >= endPos - 4) break;
      scroller.scrollTop = cur + STEP;
      // Wait for scroll to actually settle (browser may clamp or lag)
      await waitForScrollSettle(scroller, cur + STEP, 80);
    }

    // Final passes: tail content + restore
    await waitFrames(3); scanAll();
    scroller.scrollTop = savedTop;
    await waitFrames(4); scanAll();

    scanInProgress = false;
    fixBlockIndices();
    buildCleanVault();
    syncSidebar();
    applyBndHighlights();

    postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'done', count: rawVaultAll.length });
    DSToast('Scan done — ' + rawVaultAll.length + ' raw / ' + codeVault.length + ' clean', 'success');
  }

  // Wait N animation frames — faster than setTimeout for paint-linked work
  function waitFrames(n) {
    return new Promise(function (resolve) {
      var count = 0;
      function tick() {
        if (++count >= n) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // Wait for scroll position to settle at target, with a max-wait fallback
  function waitForScrollSettle(el, target, maxMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + maxMs;
      function check() {
        var pos = el.scrollTop;
        // Settled: within 2px of target, OR target is beyond scroll limit
        if (Math.abs(pos - target) <= 2 || pos >= el.scrollHeight - el.clientHeight - 2) {
          resolve();
        } else if (Date.now() >= deadline) {
          resolve(); // give up and keep moving
        } else {
          requestAnimationFrame(check);
        }
      }
      requestAnimationFrame(check);
    });
  }

  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  // Count ALL messages in the DOM — DeepSeek-specific selectors first,
  // falls back to registered roots. This gives an accurate total even before
  // a full scan, so the Zone number inputs show the real message count.
  function countAllMessages() {
    // DeepSeek renders every turn (user + assistant) as a .ds-message
    var ds = document.querySelectorAll('.ds-message');
    if (ds.length > 0) return ds.length;
    // Fallback: use registered roots
    return document.querySelectorAll('[data-dsc-root]').length;
  }

  // ── PER-MESSAGE TOOLBAR ────────────────────────────────────────────────────
  function wrapMessageForUI(msgEl) {
    if (!msgEl || msgEl.dataset.dscWrapped) return;
    if (window.getComputedStyle(msgEl).display === 'none') return;
    msgEl.dataset.dscWrapped = '1';
    msgEl.style.position = 'relative';
    msgEl.classList.add('dsc-message-wrapper');

    var hasCode = !!msgEl.querySelector('pre');
    var toolbar = document.createElement('div');
    toolbar.className = 'dsc-floating-toolbar';
    if (hasCode) toolbar.appendChild(mkBtn('\u2B07 Code', function () { downloadAllCode(msgEl); }));
    toolbar.appendChild(mkBtn('\uD83D\uDCC4 PDF',  function () { exportToPDF(msgEl); }));
    toolbar.appendChild(mkBtn('\uD83D\uDDD2 MD',   function () { exportToMD(msgEl); }));
    msgEl.appendChild(toolbar);
  }

  function mkBtn(label, onClick) {
    var btn = document.createElement('button');
    btn.className = 'dsc-toolbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return btn;
  }

  function downloadAllCode(msgEl) {
    var blocks = CodeExtractor.extract(msgEl);
    if (!blocks.length) { DSToast('No code blocks in this message', 'warning'); return; }
    if (blocks.length === 1) {
      DSHelpers.downloadBlob(blocks[0].code, blocks[0].filename, blocks[0].mimeType);
      DSToast('\u2B07 Downloaded: ' + blocks[0].filename, 'success');
    } else {
      chrome.runtime.sendMessage({
        type: 'EXPORT_ZIP',
        blocks: blocks.map(function (b) { return { filename: b.filename, code: b.code }; })
      });
      DSToast('\uD83D\uDCE6 Zipping ' + blocks.length + ' files\u2026', 'info');
    }
  }

  function exportToPDF(msgEl) {
    chrome.runtime.sendMessage({ type: 'EXPORT_PDF', text: msgEl.innerText, title: document.title });
    DSToast('Generating PDF\u2026', 'info');
  }

  function exportToMD(msgEl) {
    var md = '---\ntitle: "DeepSeek Export"\ndate: "' + new Date().toISOString().split('T')[0] + '"\n---\n\n' + msgEl.innerText;
    DSHelpers.downloadBlob(md, 'deepseek-export.md', 'text/markdown');
    DSToast('\uD83D\uDDD2 Markdown downloaded', 'success');
  }

  // ── MUTATION OBSERVER ──────────────────────────────────────────────────────
  function startMutationObserver() {
    var streamTimer = null;
    var rescan = DSHelpers.debounce(function () {
      if (DOMScanner.isStreamingMessage()) {
        clearTimeout(streamTimer);
        streamTimer = setTimeout(function () {
          if (!DOMScanner.isStreamingMessage()) scanAll();
        }, 2000);
      } else {
        scanAll();
      }
    }, 700);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { rescan(); break; }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function watchUrlChanges() {
    var wrap = function (fn) {
      return function () { fn.apply(this, arguments); onNav(); };
    };
    history.pushState    = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', onNav);
  }

  function onNav() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    rawVaultAll = []; codeVault = []; seenFP.clear();
    bndStart = null; bndEnd = null;
    if (visObserver) { visObserver.disconnect(); visObserver = null; }
    setTimeout(function () { startVisObs(); scanAll(); syncSidebar(); }, 1000);
  }

  function postToSidebar(msg, queueIfUnloaded) {
    if (sidebarFrame && sidebarFrame.contentWindow && (sidebarLoaded || !queueIfUnloaded)) {
      sidebarFrame.contentWindow.postMessage(msg, '*');
    } else if (queueIfUnloaded) {
      pendingSidebarMsgs.push(msg);
    }
  }

  // ── BOUNDARY SYSTEM ────────────────────────────────────────────────────────
  function applyBndHighlights() {
    var els = reindexAll();
    var lo = bndEnd !== null ? Math.min(bndStart, bndEnd) : bndStart;
    var hi = bndEnd !== null ? Math.max(bndStart, bndEnd) : bndEnd;
    els.forEach(function (el) {
      var idx = parseInt(el.dataset.dscMi);
      el.removeAttribute('data-dsc-bnd');
      if (bndStart === null) return;
      if (idx === lo)                                el.setAttribute('data-dsc-bnd', 'start');
      else if (hi !== null && idx === hi)            el.setAttribute('data-dsc-bnd', 'end');
      else if (hi !== null && idx > lo && idx < hi)  el.setAttribute('data-dsc-bnd', 'in');
    });
  }

  function enterBndSelMode(which) {
    bndSelMode = which;
    document.body.classList.add('dsc-bnd-sel');
    showBndOverlay(
      which === 'start' ? 'Click the FIRST message of your range' : 'Click the LAST message of your range',
      true
    );
  }

  function showBndOverlay(text, withCancel) {
    removeBndOverlay();
    bndOverlay = document.createElement('div');
    bndOverlay.id = 'dsc-bnd-overlay';
    bndOverlay.innerHTML = '<span>' + text + '</span>' +
      (withCancel ? '<button id="dsc-bnd-cancel-btn" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;">Cancel</button>' : '');
    document.body.appendChild(bndOverlay);
    if (withCancel) {
      document.getElementById('dsc-bnd-cancel-btn').addEventListener('click', cancelBndSelMode);
    } else {
      setTimeout(removeBndOverlay, 2200);
    }
  }

  function removeBndOverlay() {
    if (bndOverlay) { bndOverlay.remove(); bndOverlay = null; }
  }

  function cancelBndSelMode() {
    bndSelMode = null;
    document.body.classList.remove('dsc-bnd-sel');
    removeBndOverlay();
  }

  function clearBoundary() {
    bndStart = null; bndEnd = null;
    applyBndHighlights();
    buildCleanVault();
    syncSidebar();
    DSToast('Zone cleared \u2014 showing full chat', 'info');
  }

  document.addEventListener('click', function (e) {
    if (!bndSelMode) return;
    var msgEl = e.target.closest('[data-dsc-mi]');
    if (!msgEl) {
      msgEl = e.target.closest('[data-dsc-root]') ||
              e.target.closest('.ds-message') ||
              e.target.closest('[data-message-id]') ||
              e.target.closest('[class*="message"]');
      if (msgEl) { msgEl.dataset.dscRoot = '1'; reindexAll(); }
    }
    if (!msgEl || msgEl.dataset.dscMi == null) return;
    e.stopPropagation();
    e.preventDefault();

    var idx = parseInt(msgEl.dataset.dscMi);
    if (bndSelMode === 'start') {
      bndStart = idx; bndEnd = null;
      applyBndHighlights();
      cancelBndSelMode();
      buildCleanVault(); syncSidebar();
      DSToast('START set at msg #' + (idx + 1) + ' \u2014 now click the last message', 'success');
      setTimeout(function () { enterBndSelMode('end'); }, 350);
    } else if (bndSelMode === 'end') {
      bndEnd = idx;
      applyBndHighlights();
      cancelBndSelMode();
      buildCleanVault(); syncSidebar();
      var lo = Math.min(bndStart, bndEnd);
      var hi = Math.max(bndStart, bndEnd);
      DSToast('Zone set: msgs ' + (lo + 1) + ' to ' + (hi + 1) + ' \u2014 ' + codeVault.length + ' files', 'success');
    }
  }, true);

  // ── AUTO-PROCEED ENGINE ────────────────────────────────────────────────────
  // When DeepSeek is instructed with RULE 7, it ends each wave response with
  // the exact word PROCEED (on its own line) when more files remain to be
  // generated. When the response has NO "PROCEED" at the end → generation is
  // complete and we stay silent.
  //
  // Flow:
  //   1. MutationObserver watches for a streaming→complete transition
  //   2. After stream stops, read the last assistant message's final line
  //   3. If that line is exactly "PROCEED" → type "continue" + press Enter
  //   4. If NOT → do nothing
  //
  // Safety guards:
  //   - Only fires when auto-proceed is ENABLED (user toggle in sidebar)
  //   - Never fires while a message is still streaming
  //   - 2-second cooldown after each fire to avoid rapid loops
  //   - Clears itself if user manually types in the input
  //   - Can be paused/resumed from the sidebar

  var autoProceedEnabled = false;
  var autoProceedCooldown = false;
  var autoProceedObserver = null;
  var autoProceedLastFiredAt = 0;

  function setAutoProceed(enabled) {
    autoProceedEnabled = enabled;
    if (enabled) startAutoProceedWatcher();
    else stopAutoProceedWatcher();
    postToSidebar({ type: 'DSC_AUTOPROCEED_STATE', enabled: enabled });
  }

  function startAutoProceedWatcher() {
    if (autoProceedObserver) autoProceedObserver.disconnect();

    // === RELIABLE STREAMING DETECTION ===
    // Problem: all previous methods (sendBtn.disabled, aria-label, classes)
    // require finding DOM elements that may not exist or have no stable selector.
    //
    // SOLUTION: Watch the count of assistant messages (.ds-message with .ds-markdown).
    // When DeepSeek finishes generating, a new assistant message becomes stable
    // (stops changing). We detect this by:
    //   1. Recording the count of assistant messages
    //   2. When count increases → a new response just arrived → check for PROCEED
    //
    // Secondary check: DOM mutation rate. While streaming, the DOM mutates rapidly.
    // When streaming stops, mutations drop to zero. We measure this.

    var lastMsgCount  = DOMScanner.getAllAssistantMessages().length;
    var lastMsgText   = '';
    var stableCount   = 0;
    // FIX 4 + early-fire fix: require 6 stable polls (3s) not 3 (1.5s)
    // DeepSeek sometimes pauses mid-stream for 1-2s before continuing.
    // 3s of no change is a reliable signal that generation truly stopped.
    var STABLE_NEEDED = 6;

    // FIX 6: MutationObserver tracks active DOM mutations alongside polling.
    // When mutations are happening → definitely still streaming.
    // We count mutations in a rolling 500ms window.
    var mutationCount = 0;
    var muObs = new MutationObserver(function () { mutationCount++; });
    muObs.observe(document.body, { childList: true, subtree: true, characterData: true });

    function poll() {
      if (!autoProceedEnabled) return;

      var msgs         = DOMScanner.getAllAssistantMessages();
      var currentCount = msgs.length;
      var currentText  = msgs.length ? (msgs[msgs.length - 1].innerText || '') : '';
      var activeMutations = mutationCount;
      mutationCount = 0; // reset for next window

      // Any DOM activity in the last 500ms → still likely streaming
      var domActive = activeMutations > 5;

      if (currentCount > lastMsgCount) {
        lastMsgCount = currentCount;
        lastMsgText  = currentText;
        stableCount  = 0;
        return;
      }

      if (currentCount > 0 && currentText === lastMsgText && lastMsgText !== '' && !domActive) {
        stableCount++;
        // FIX 4: add isStreamingMessage guard — don't fire if still streaming
        if (stableCount >= STABLE_NEEDED && !DOMScanner.isStreamingMessage()) {
          checkAndProceed();
          stableCount = 0; // reset so it doesn't keep re-firing
        }
      } else {
        stableCount = 0;
        lastMsgText = currentText;
      }
    }

    var pollHandle = setInterval(poll, 500);
    autoProceedObserver = {
      disconnect: function () {
        clearInterval(pollHandle);
        pollHandle = null;
        muObs.disconnect();
      }
    };
  }

  function stopAutoProceedWatcher() {
    if (autoProceedObserver) { autoProceedObserver.disconnect(); autoProceedObserver = null; }
  }

  var autoProceedLastFingerprint = ''; // fingerprint of last message we acted on

  function checkAndProceed() {
    if (!autoProceedEnabled) return;
    if (autoProceedCooldown) return;

    var now = Date.now();
    if (now - autoProceedLastFiredAt < 4000) return;

    var lastMsg = getLastAssistantText();
    if (!lastMsg) return;

    // Deduplicate: don't act on the same message twice
    var fp = lastMsg.slice(-200); // last 200 chars as fingerprint
    if (fp === autoProceedLastFingerprint) return;

    var lines = lastMsg.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var lastLine = lines[lines.length - 1] || '';

    // FIX 3: Lenient PROCEED detection — strip markdown noise first.
    // DeepSeek sometimes wraps PROCEED in backticks, bold (**), bullets, etc.
    // e.g. "PROCEED:", "PROCEED 🚀", "**PROCEED**", "`PROCEED`"
    var cleaned = lastLine
      .replace(/[`*_#>~\[\]]/g, '')  // strip markdown chars
      .replace(/:\s*$/, '')          // strip trailing colon
      .trim()
      .toUpperCase();

    var isProceedSignal = cleaned.startsWith('PROCEED') &&
                          cleaned.length <= 12; // "PROCEED" = 7 chars, allow small suffix

    
    console.log('[DSC AUTO DEBUG]', {
      lastLine: lastLine,
      cleaned: cleaned,
      proceed: isProceedSignal
    });

if (isProceedSignal) {
      autoProceedLastFiredAt = now;
      autoProceedLastFingerprint = fp;
      autoProceedCooldown = true;
      setTimeout(function () { autoProceedCooldown = false; }, 4000);

      postToSidebar({ type: 'DSC_AUTOPROCEED_FIRED', lastLine: lastLine });
      DSToast('\u26A1 Auto-proceed: PROCEED detected \u2014 sending "continue"\u2026', 'info');

      // Debug log — visible in Chrome → Extensions → Inspect Views → Console
      console.log('[DSC AUTO]', {
        lastLine: lastLine,
        cleaned: cleaned,
        isProceedSignal: isProceedSignal,
        streaming: DOMScanner.isStreamingMessage(),
        sendBtn: !!DOMScanner.findSendButton(),
        input: !!DOMScanner.getInputTextarea()
      });

      // FIX 5: use retry system instead of single one-shot attempt
      setTimeout(function () { autoContinueRetry(); }, 600);
    } else {
      // Did not detect PROCEED — visible in DevTools: Extensions → Inspect Views
      console.log('[DSC AUTO] no PROCEED signal', {
        lastLine: lastLine,
        cleaned: cleaned,
        streaming: DOMScanner.isStreamingMessage()
      });
    }
  }

  function getLastAssistantText() {
    var selectors = [
      '[data-role="assistant"]',
      '.assistant',
      '.message.assistant',
      '.ds-markdown',
      '[class*="assistant"]'
    ];

    var candidates = Array.from(
      document.querySelectorAll(selectors.join(','))
    );

    candidates = candidates.filter(function(el) {
      if (!el) return false;

      var txt = (el.innerText || '').trim();
      var rect = el.getBoundingClientRect();

      return (
        txt.length > 20 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

    if (!candidates.length) return '';

    var last = candidates[candidates.length - 1];

    return (last.innerText || '').trim();
  }

  // insertIntoEditor — delegates to the v5 engine helper
  function insertIntoEditor(el, text) {
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      _dscInjectText(el, text);
    } else {
      _dscInjectTextarea(el, text);
    }
  }

  // autoContinueRetry — delegates to deepSeekRealSend with retry built-in
  function autoContinueRetry() {
    deepSeekRealSend('continue').then(function(ok) {
      if (ok) {
        DSToast('\u2705 Auto-proceed: "continue" sent', 'success');
      } else {
        DSToast('\u274C Auto-proceed: send failed after 3 attempts', 'error');
      }
    });
  }

  // forceSendMessage — uses v5 engine helpers
  async function forceSendMessage(sendBtn, ta) {
    try {
      var editor = ta || document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      var clicked = await _dscClickSendWhenReady(editor, 1500);
      if (clicked) return true;
      // Enter fallback
      if (editor) {
        var opts = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true };
        editor.dispatchEvent(new KeyboardEvent('keydown',  opts));
        editor.dispatchEvent(new KeyboardEvent('keypress', opts));
        editor.dispatchEvent(new KeyboardEvent('keyup',    opts));
      }
      return false;
    } catch (e) {
      console.error('[DSC AUTO SEND ERROR]', e);
      return false;
    }
  }

// findSendButton — delegates to v5 engine (checks aria-disabled + scoped search)
  function findSendButton() {
    var input = DOMScanner.getInputTextarea();
    return _dscFindSendButton(input);
  }

  // ── END AUTO-PROCEED ENGINE ────────────────────────────────────────────────

  // ── MESSAGES FROM SIDEBAR ──────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.type) return;
    switch (e.data.type) {

      case 'DSC_REQUEST_SYNC': syncSidebar(); break;

      case 'DSC_DEEP_SCAN': deepScan(); break;

      case 'DSC_CLOSE':
        sidebarOpen = false;
        if (sidebarFrame) sidebarFrame.classList.remove('open');
        document.getElementById('dsc-toggle-btn').style.right = '0';
        break;

      case 'DSC_DOWNLOAD_FILE':
        DSHelpers.downloadBlob(e.data.code, e.data.filename, e.data.mimeType);
        break;

      case 'DSC_DOWNLOAD_ZIP':
        chrome.runtime.sendMessage({ type: 'EXPORT_ZIP', blocks: e.data.blocks });
        break;

      case 'DSC_INSERT_TEMPLATE': {
        var ta = DOMScanner.getInputTextarea();
        if (ta) {
          ta.click();
          // Use v5 injection helpers for proper Lexical/React event chain
          setTimeout(function () { insertIntoEditor(ta, e.data.text); }, 120);
        }
        break;
      }

      case 'DSC_REQUEST_CONTENT': {
        if (!document.querySelector('[data-dsc-mi]')) {
          getMsgContainers();
          reindexAll();
        }
        var allEls = Array.from(document.querySelectorAll('[data-dsc-mi]'));
        var scoped = allEls.filter(function (el) { return inBoundary(parseInt(el.dataset.dscMi)); });
        var assistantScoped = bndStart === null
          ? scoped.filter(function (el) { return el.matches('.ds-markdown') || (el.querySelector && el.querySelector('.ds-markdown')); })
          : scoped;
        var markdownFallback = Array.from(document.querySelectorAll('.ds-markdown'));
        var src = assistantScoped.length ? assistantScoped : (scoped.length ? scoped : markdownFallback);
        var getText = function (el) {
          if (!el) return '';
          var md = el.querySelector && el.querySelector('.ds-markdown');
          return (md || el).innerText || el.textContent || '';
        };
        var text = '';
        if (src.length) {
          text = e.data.scope === 'last'
            ? getText(src[src.length - 1])
            : src.map(getText).filter(Boolean).join('\n\n---\n\n');
        }
        postToSidebar({ type: 'DSC_CONTENT', content: text });
        break;
      }

      case 'DSC_BND_SET_START':  scanAll(); reindexAll(); enterBndSelMode('start'); break;
      case 'DSC_BND_SET_END':    scanAll(); reindexAll(); enterBndSelMode('end');   break;
      case 'DSC_BND_CLEAR':      clearBoundary(); break;

      case 'DSC_BND_MANUAL':
        if (e.data.start != null) bndStart = parseInt(e.data.start);
        if (e.data.end   != null) bndEnd   = parseInt(e.data.end);
        applyBndHighlights(); buildCleanVault(); syncSidebar();
        break;

      case 'DSC_BND_SCAN': deepScan(); break;

      case 'DSC_AUTOPROCEED_TOGGLE':
        setAutoProceed(!!e.data.enabled);
        break;
    }
  });

  // ── START ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();

})();
