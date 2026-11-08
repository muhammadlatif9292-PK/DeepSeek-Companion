// content.js — DeepSeek Companion King Edition v3.1.0
// NEW STRATEGY: Instant bulk extraction — no slow scrolling
(function() {
  'use strict';

  const GEMINI_API_KEY = ''; // Set your Gemini API key in Settings or Extension Storage
  const VERSION = '3.1.0';

  let codeVault = [];
  let bookmarks = [];
  let templates = [];
  let sidebarFrame = null;
  let sidebarOpen = false;
  let lastUrl = location.href;
  let scanInProgress = false;

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    await loadBookmarks();
    await loadTemplates();
    injectSidebarToggle();
    injectSidebarFrame();
    injectGlobalStyles();
    startObserver();
    watchUrlChanges();
    window.__DSC_GEMINI_KEY = GEMINI_API_KEY;
    // Initial scan after page settles
    setTimeout(() => quickScan(), 1200);
    setTimeout(() => quickScan(), 3000);
    console.log('[DSC King] v' + VERSION + ' ready');
  }

  // ── GLOBAL STYLES ─────────────────────────────────────────────────────────
  function injectGlobalStyles() {
    if (document.getElementById('dsc-global-styles')) return;
    const s = document.createElement('style');
    s.id = 'dsc-global-styles';
    s.textContent = `
      #dsc-toggle-btn {
        position:fixed;right:0;top:50%;transform:translateY(-50%);
        z-index:2147483640;background:#161b22;border:1px solid #30363d;
        border-right:none;color:#e6edf3;width:28px;height:64px;
        border-radius:8px 0 0 8px;cursor:pointer;display:flex;
        align-items:center;justify-content:center;font-size:16px;
        transition:background 0.2s;box-shadow:-2px 0 12px rgba(0,0,0,0.3);
      }
      #dsc-toggle-btn:hover{background:#21262d;}
      #dsc-sidebar-frame {
        position:fixed;right:0;top:0;width:380px;height:100vh;
        z-index:2147483639;border:none;border-left:1px solid #30363d;
        transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);
        box-shadow:-4px 0 20px rgba(0,0,0,0.4);
      }
      #dsc-sidebar-frame.open{transform:translateX(0);}
      .dsc-floating-toolbar {
        position:absolute;top:-36px;right:8px;
        background:#161b22;border:1px solid #30363d;
        border-radius:20px;padding:4px 8px;
        display:flex;gap:4px;z-index:100;
        box-shadow:0 2px 12px rgba(0,0,0,0.3);
        opacity:0;transition:opacity 0.15s;pointer-events:none;
      }
      .dsc-message-wrapper:hover .dsc-floating-toolbar{opacity:1;pointer-events:all;}
      .dsc-toolbar-btn {
        background:none;border:none;color:#8b949e;cursor:pointer;
        padding:3px 6px;border-radius:12px;font-size:12px;white-space:nowrap;
        transition:color 0.15s,background 0.15s;
      }
      .dsc-toolbar-btn:hover{color:#e6edf3;background:#21262d;}
      .dsc-bookmark-icon {
        position:absolute;top:6px;right:6px;cursor:pointer;
        font-size:16px;opacity:0;transition:opacity 0.15s;z-index:10;
      }
      .dsc-message-wrapper:hover .dsc-bookmark-icon{opacity:1;}
      .dsc-bookmarked{border-left:3px solid #2f81f7!important;}
    `;
    document.head.appendChild(s);
  }

  // ── SIDEBAR ───────────────────────────────────────────────────────────────
  function injectSidebarToggle() {
    if (document.getElementById('dsc-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'dsc-toggle-btn';
    btn.title = 'DeepSeek Companion King';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>`;
    btn.addEventListener('click', toggleSidebar);
    document.body.appendChild(btn);
  }

  function injectSidebarFrame() {
    if (document.getElementById('dsc-sidebar-frame')) return;
    sidebarFrame = document.createElement('iframe');
    sidebarFrame.id = 'dsc-sidebar-frame';
    sidebarFrame.src = chrome.runtime.getURL('sidebar/sidebar.html');
    document.body.appendChild(sidebarFrame);
    sidebarFrame.addEventListener('load', () => setTimeout(() => syncSidebar(), 400));
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    sidebarFrame.classList.toggle('open', sidebarOpen);
    document.getElementById('dsc-toggle-btn').style.right = sidebarOpen ? '380px' : '0';
    if (sidebarOpen) syncSidebar();
  }

  // ── VAULT DEDUP: keep only LAST version of each filename ──────────────────
  function deduplicateVault() {
    const byName = new Map();
    codeVault.forEach(b => byName.set((b.filename || '').toLowerCase().trim(), b));
    codeVault = Array.from(byName.values());
  }

  function syncSidebar() {
    if (!sidebarFrame || !sidebarFrame.contentWindow) return;
    deduplicateVault();
    const safe = codeVault.map(({ preEl, blockDiv, ...rest }) => rest);
    sidebarFrame.contentWindow.postMessage({
      type: 'DSC_SYNC',
      codeVault: safe,
      bookmarks,
      templates,
      geminiKey: GEMINI_API_KEY,
      conversationId: DSHelpers.getConversationId()
    }, '*');
  }

  // ── NEW FAST SCAN STRATEGY ────────────────────────────────────────────────
  // Strategy: query ALL .md-code-block in document at once (O(1) DOM query).
  // No scrolling needed for visible blocks. For virtual-scrolled hidden blocks,
  // use the chat's own scroll with requestAnimationFrame batching (non-blocking).

  function quickScan() {
    // Grab every code block currently in DOM — this is instant
    const allBlocks = Array.from(document.querySelectorAll('.md-code-block'));
    if (allBlocks.length === 0) return;

    let changed = false;
    const existingCodes = new Set(codeVault.map(b => b.code.trim().slice(0, 100)));

    allBlocks.forEach(blockDiv => {
      const pre = blockDiv.querySelector('pre');
      if (!pre || !pre.textContent.trim()) return;

      const code = pre.textContent;
      const fingerprint = code.trim().slice(0, 100);
      if (existingCodes.has(fingerprint)) return; // already in vault

      // Get language
      const lang = getLang(blockDiv);

      // Get preceding text for filename detection
      const preceding = getPrecedingText(pre);

      // Check if junk (terminal command snippets, output logs)
      if (isJunk(lang, code)) return;

      const fileInfo = FilenameDetector.detect(preceding, lang, code);

      const block = {
        id: DSHelpers.generateId(),
        lang,
        code,
        filename: fileInfo.filename,
        extension: fileInfo.extension,
        mimeType: fileInfo.mimeType,
        confidence: fileInfo.confidence,
        lineCount: DSHelpers.countLines(code),
        size: new Blob([code]).size,
        timestamp: Date.now(),
        preEl: pre,
        blockDiv
      };

      codeVault.push(block);
      existingCodes.add(fingerprint);
      changed = true;

      // Inject download button
      injectDownloadBtn(pre, fileInfo, code);
    });

    // Wrap messages for floating toolbar
    document.querySelectorAll('.ds-message:not([data-dsc-wrapped])').forEach(msg => {
      wrapMessageForUI(msg);
    });

    // Inject table download buttons
    document.querySelectorAll('table:not([data-dsc-table])').forEach(t => injectTableBtn(t));

    if (changed) syncSidebar();
  }

  // ── DEEP SCAN: fast scroll using RAF batching (non-blocking) ──────────────
  async function deepScan() {
    if (scanInProgress) return;
    scanInProgress = true;

    postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'start' });

    const scroller = getScroller();
    if (!scroller) {
      scanInProgress = false;
      postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'done', count: codeVault.length });
      return;
    }

    const originalTop = scroller.scrollTop;
    const totalHeight = scroller.scrollHeight;
    const viewHeight = scroller.clientHeight;

    // Step 1: snap to top
    scroller.scrollTop = 0;
    await raf_wait(4); // wait 4 animation frames (~67ms) for React to render

    // Step 2: scroll in large jumps (viewHeight * 1.5 per step)
    // Each step waits only 3 RAF frames — much faster than 250ms setTimeout
    const STEP = Math.max(viewHeight * 1.2, 500);
    let prev = -1;
    let iters = 0;
    const MAX = 200;

    while (iters++ < MAX) {
      const cur = scroller.scrollTop;
      if (Math.abs(cur - prev) < 2 && iters > 2) break; // stuck = done
      prev = cur;

      quickScan(); // instant DOM scan of currently visible blocks

      // Update progress to sidebar
      const pct = Math.min(99, Math.round((cur / totalHeight) * 100));
      postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'progress', pct, count: codeVault.length });

      const atBottom = cur + viewHeight >= scroller.scrollHeight - 5;
      if (atBottom) break;

      scroller.scrollTop += STEP;
      await raf_wait(3); // 3 frames ≈ 50ms — fast but gives React time to render
    }

    // Step 3: final scan at bottom
    quickScan();

    // Step 4: restore position
    scroller.scrollTop = originalTop;
    await raf_wait(2);

    scanInProgress = false;
    deduplicateVault();
    syncSidebar();

    postToSidebar({ type: 'DSC_SCAN_PROGRESS', status: 'done', count: codeVault.length });
    DSToast(`✅ Scan complete — ${codeVault.length} files found`, 'success');
  }

  // Wait N animation frames (non-blocking, doesn't freeze UI)
  function raf_wait(frames) {
    return new Promise(resolve => {
      let count = 0;
      function tick() {
        if (++count >= frames) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function getScroller() {
    // Try DeepSeek-specific scroll container first
    const candidates = Array.from(document.querySelectorAll('div')).filter(d => {
      const st = window.getComputedStyle(d);
      return (st.overflowY === 'scroll' || st.overflowY === 'auto') &&
             d.scrollHeight > d.clientHeight + 50 &&
             d.clientHeight > 200;
    });
    if (candidates.length === 0) return document.body;
    // Pick the one with the most scrollable content
    return candidates.reduce((a, b) => b.scrollHeight > a.scrollHeight ? b : a);
  }

  // ── JUNK FILTER ────────────────────────────────────────────────────────────
  function isJunk(lang, code) {
    const trimmed = code.trim();
    const lines = trimmed.split('\n').filter(l => l.trim()).length;
    const isBash = lang === 'bash' || lang === 'sh' || lang === 'shell';

    if (isBash && lines <= 5) {
      const terminalCmds = /^(cd |ls |cat |echo |pwd |mkdir |rm |cp |mv |touch |grep |find |tail |head |wc |curl |wget |chmod |unzip |zip |npm run|yarn |pip |python |node |npx |git |docker |sudo |export |source |\.\/|bash |sh )/;
      const onlyTerminal = trimmed.split('\n').every(l => {
        const t = l.trim();
        return !t || t.startsWith('#') || terminalCmds.test(t);
      });
      if (onlyTerminal) return true;
    }

    // Single line bash always junk
    if (isBash && lines === 1) return true;

    // Output/log content
    if (!lang || lang === 'text' || lang === 'plaintext') {
      if (/^(Output\s*$|Error:|  inflating:|  adding:|  creating:)/m.test(trimmed)) return true;
    }

    return false;
  }

  // ── LANGUAGE DETECTION ─────────────────────────────────────────────────────
  function getLang(blockDiv) {
    let lang = '';
    const banner = blockDiv.querySelector('.md-code-block-banner-wrap');
    if (banner) {
      const walker = document.createTreeWalker(banner, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim().toLowerCase();
        if (t && /^[a-z0-9+#._-]+$/.test(t) && t.length >= 1 && t.length <= 20) {
          lang = t; break;
        }
      }
    }
    return lang;
  }

  // ── PRECEDING TEXT FOR FILENAME DETECTION ─────────────────────────────────
  function getPrecedingText(preEl) {
    const container = preEl.closest('.ds-message') || preEl.closest('.ds-markdown') || preEl.parentElement;
    if (!container) return '';
    const texts = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (preEl.contains(node)) break;
      const t = node.textContent.trim();
      if (t) texts.push(t);
    }
    return texts.slice(-8).join(' ');
  }

  // ── DOWNLOAD BUTTON INJECTION ──────────────────────────────────────────────
  function injectDownloadBtn(pre, fileInfo, code) {
    if (pre.dataset.dscBtn) return;
    pre.dataset.dscBtn = '1';

    const btn = document.createElement('button');
    btn.className = 'dsc-dl-btn';
    btn.title = '⬇ ' + fileInfo.filename;
    btn.textContent = '⬇ ' + fileInfo.filename;
    btn.style.cssText = 'background:#2f81f7;color:white;border:none;border-radius:4px;' +
      'padding:3px 10px;cursor:pointer;font-size:11px;margin-left:6px;' +
      'transition:background 0.15s;flex-shrink:0;font-family:monospace;max-width:200px;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;';
    btn.addEventListener('mouseenter', () => btn.style.background = '#1a6cd4');
    btn.addEventListener('mouseleave', () => btn.style.background = '#2f81f7');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      DSHelpers.downloadBlob(code, fileInfo.filename, fileInfo.mimeType || 'text/plain');
      DSToast('✅ ' + fileInfo.filename, 'success');
    });

    const blockDiv = pre.closest('.md-code-block');
    if (blockDiv) {
      const banner = blockDiv.querySelector('.md-code-block-banner-wrap');
      if (banner) {
        banner.style.cssText += ';display:flex;align-items:center;flex-wrap:wrap;gap:4px;';
        banner.appendChild(btn);
        return;
      }
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;justify-content:flex-end;padding:3px 6px;background:rgba(47,129,247,0.1);';
    wrap.appendChild(btn);
    pre.parentNode.insertBefore(wrap, pre);
  }

  // ── MESSAGE UI WRAPPING ────────────────────────────────────────────────────
  function wrapMessageForUI(msgEl) {
    if (!msgEl || msgEl.dataset.dscWrapped) return;
    msgEl.dataset.dscWrapped = '1';
    msgEl.style.position = 'relative';
    msgEl.classList.add('dsc-message-wrapper');

    const toolbar = document.createElement('div');
    toolbar.className = 'dsc-floating-toolbar';

    const hasCode = msgEl.querySelector('pre') !== null;
    if (hasCode) toolbar.appendChild(mkBtn('⬇ Code', () => downloadAllCode(msgEl)));
    toolbar.appendChild(mkBtn('📄 PDF', () => exportToPDF(msgEl)));
    toolbar.appendChild(mkBtn('🗒 MD', () => exportToMD(msgEl)));
    toolbar.appendChild(mkBtn('🔖', () => toggleBookmark(msgEl)));
    toolbar.appendChild(mkBtn('✨ AI', () => sendToGemini(msgEl)));

    msgEl.appendChild(toolbar);

    const bkIcon = document.createElement('span');
    bkIcon.className = 'dsc-bookmark-icon';
    bkIcon.textContent = '🔖';
    bkIcon.addEventListener('click', () => toggleBookmark(msgEl));
    msgEl.appendChild(bkIcon);
  }

  function mkBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'dsc-toolbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    return btn;
  }

  function injectTableBtn(tableEl) {
    if (tableEl.dataset.dscTable) return;
    tableEl.dataset.dscTable = '1';
    const btn = document.createElement('button');
    btn.textContent = '📊 Excel';
    btn.style.cssText = 'background:#1a6cd4;color:white;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;margin-bottom:6px;display:block;';
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'EXPORT_XLSX', tableHtml: tableEl.outerHTML });
      DSToast('📊 Excel download started', 'success');
    });
    tableEl.parentNode.insertBefore(btn, tableEl);
  }

  // ── EXPORTS ────────────────────────────────────────────────────────────────
  function downloadAllCode(msgEl) {
    const blocks = Array.from(msgEl.querySelectorAll('.md-code-block'))
      .map(bd => ({ pre: bd.querySelector('pre'), lang: getLang(bd) }))
      .filter(b => b.pre && b.pre.textContent.trim())
      .map(b => ({ code: b.pre.textContent, filename: FilenameDetector.detect(getPrecedingText(b.pre), b.lang, b.pre.textContent).filename, mimeType: 'text/plain' }));
    if (blocks.length === 0) { DSToast('No code blocks found', 'warning'); return; }
    if (blocks.length === 1) { DSHelpers.downloadBlob(blocks[0].code, blocks[0].filename, blocks[0].mimeType); DSToast('✅ ' + blocks[0].filename, 'success'); }
    else { chrome.runtime.sendMessage({ type: 'EXPORT_ZIP', blocks }); DSToast(`📦 ZIP with ${blocks.length} files...`, 'info'); }
  }

  function exportToPDF(msgEl) {
    chrome.runtime.sendMessage({ type: 'EXPORT_PDF', text: msgEl.innerText, title: document.title });
    DSToast('📄 Generating PDF...', 'info');
  }

  function exportToMD(msgEl) {
    const md = `---\ntitle: "DeepSeek Export"\ndate: "${new Date().toISOString().split('T')[0]}"\n---\n\n${msgEl.innerText}`;
    DSHelpers.downloadBlob(md, 'deepseek-export.md', 'text/markdown');
    DSToast('🗒 Markdown downloaded', 'success');
  }

  // ── BOOKMARKS ──────────────────────────────────────────────────────────────
  async function loadBookmarks() { bookmarks = (await DSStorage.get('bm_' + DSHelpers.getConversationId())) || []; }
  async function saveBookmarks() { await DSStorage.set('bm_' + DSHelpers.getConversationId(), bookmarks); }

  function toggleBookmark(msgEl) {
    const id = msgEl.id || DSHelpers.generateId();
    const idx = bookmarks.findIndex(b => b.id === id);
    if (idx >= 0) { bookmarks.splice(idx, 1); msgEl.classList.remove('dsc-bookmarked'); DSToast('Removed', 'info'); }
    else { bookmarks.push({ id, text: DSHelpers.truncate(msgEl.innerText, 200), timestamp: Date.now(), label: '🔵 Code Snippet' }); msgEl.classList.add('dsc-bookmarked'); DSToast('🔖 Bookmarked!', 'success'); }
    saveBookmarks();
    syncSidebar();
  }

  // ── TEMPLATES ──────────────────────────────────────────────────────────────
  async function loadTemplates() { templates = (await DSStorage.get('templates')) || defaultTemplates(); }
  function defaultTemplates() {
    return [
      { id: '1', name: 'Code Review', category: 'Development', text: 'Review this code for bugs and security issues:\n\n{{code}}', variables: ['code'], usageCount: 0 },
      { id: '2', name: 'Explain Code', category: 'Development', text: 'Explain this code step by step:\n\n{{code}}', variables: ['code'], usageCount: 0 },
      { id: '3', name: 'Write Tests', category: 'Debugging', text: 'Write unit tests for:\n\n{{code}}', variables: ['code'], usageCount: 0 },
    ];
  }

  // ── GEMINI ─────────────────────────────────────────────────────────────────
  async function sendToGemini(msgEl) {
    const text = msgEl.innerText;
    if (!text.trim()) { DSToast('No content', 'warning'); return; }
    DSToast('✨ Sending to Gemini...', 'info');
    try {
      const result = await callGemini('Reformat and beautify this content:\n\n' + text);
      postToSidebar({ type: 'DSC_GEMINI_RESULT', result });
      if (!sidebarOpen) toggleSidebar();
    } catch (e) { DSToast('Gemini error: ' + e.message, 'error'); }
  }

  async function callGemini(prompt) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // ── OBSERVER: watch for new messages as AI responds ───────────────────────
  function startObserver() {
    let timer = null;
    const rescan = () => {
      clearTimeout(timer);
      timer = setTimeout(() => quickScan(), 600);
    };
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.addedNodes.length > 0) { rescan(); break; }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function watchUrlChanges() {
    const wrap = fn => function() { fn.apply(this, arguments); onNav(); };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener('popstate', onNav);
  }

  function onNav() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    codeVault = [];
    setTimeout(() => { loadBookmarks(); quickScan(); syncSidebar(); }, 1000);
  }

  // ── HELPERS ────────────────────────────────────────────────────────────────
  function postToSidebar(msg) {
    if (sidebarFrame && sidebarFrame.contentWindow) sidebarFrame.contentWindow.postMessage(msg, '*');
  }

  // ── MESSAGES FROM SIDEBAR ─────────────────────────────────────────────────
  window.addEventListener('message', e => {
    if (!e.data || !e.data.type) return;
    const d = e.data;
    switch (d.type) {
      case 'DSC_REQUEST_SYNC': syncSidebar(); break;
      case 'DSC_DEEP_SCAN': deepScan(); break;
      case 'DSC_DOWNLOAD_FILE': DSHelpers.downloadBlob(d.code, d.filename, d.mimeType); break;
      case 'DSC_DOWNLOAD_ZIP': chrome.runtime.sendMessage({ type: 'EXPORT_ZIP', blocks: d.blocks }); break;
      case 'DSC_INSERT_TEMPLATE': {
        const ta = DOMScanner.getInputTextarea();
        if (ta) { ta.value = d.text; ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true })); }
        break;
      }
      case 'DSC_CALL_GEMINI':
        callGemini(d.prompt)
          .then(result => postToSidebar({ type: 'DSC_GEMINI_RESULT', result }))
          .catch(err => postToSidebar({ type: 'DSC_GEMINI_ERROR', error: err.message }));
        break;
      case 'DSC_RESIZE':
        if (sidebarFrame && d.width) {
          sidebarFrame.style.width = d.width + 'px';
          document.getElementById('dsc-toggle-btn').style.right = sidebarOpen ? d.width + 'px' : '0';
          chrome.storage.local.set({ sidebarWidth: d.width });
        }
        break;
      case 'DSC_GET_CONTENT': {
        const scope = d.scope || 'last';
        const all = Array.from(document.querySelectorAll('.ds-markdown'));
        const text = scope === 'last' ? (all[all.length - 1]?.innerText || '') : all.map(m => m.innerText).join('\n\n---\n\n');
        postToSidebar({ type: 'DSC_CONTENT', content: text });
        break;
      }
    }
  });

  // ── START ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
