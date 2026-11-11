// sidebar.js — DeepSeek Companion Pro v6.0
// Tabs: Vault · Export · Patcher · Zone · Dev
(function () {
  'use strict';

  // ── STATE ──────────────────────────────────────────────────────────────────
  let codeVault    = [];
  let exportHistory = [];
  let lastContent  = '';
  let pendingContentResolvers = [];
  let zoneStart    = null;
  let zoneEnd      = null;
  let totalMsgs    = 0;
  let patchZipFile = null;   // the user-uploaded ZIP file for patching

  // ── INIT ───────────────────────────────────────────────────────────────────
  async function init() {
    setupTabs();
    setupVault();
    setupExport();
    setupPatcher();
    setupZone();
    setupDev();
    setupPreviewModal();
    await loadLocalData();
    renderVault();
    renderExportHistory();
    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'DSC_REQUEST_SYNC' }, '*');
  }

  // ── MESSAGE BUS ────────────────────────────────────────────────────────────
  function handleMessage(e) {
    if (!e.data || !e.data.type) return;
    switch (e.data.type) {
      case 'DSC_SYNC':
        if (e.data.codeVault) { codeVault = e.data.codeVault; renderVault(); updateStats(); updatePatcherVaultStatus(); }
        if (e.data.totalMsgs != null) totalMsgs = e.data.totalMsgs;
        if (e.data.bndStart  != null) zoneStart = e.data.bndStart;
        else if ('bndStart' in e.data && e.data.bndStart === null) { zoneStart = null; zoneEnd = null; }
        if (e.data.bndEnd != null) zoneEnd = e.data.bndEnd;
        updateZoneUI();
        break;

      case 'DSC_AUTOPROCEED_STATE':
        updateAutoProceedUI(e.data.enabled);
        break;

      case 'DSC_AUTOPROCEED_FIRED':
        logAutoProceed('⚡ Signal detected — sending "continue"');
        break;
      case 'DSC_CONTENT':
        lastContent = e.data.content || '';
        while (pendingContentResolvers.length) {
          const resolve = pendingContentResolvers.shift();
          resolve(lastContent);
        }
        break;
      case 'DSC_GENERATE_PDF':
        generateFloatingToolbarPDF(e.data.text || '', e.data.title || 'DeepSeek Export');
        break;
      case 'DSC_SCAN_PROGRESS':
        handleScanProgress(e.data.status, e.data.pct, e.data.count);
        break;
      case 'DSC_TOAST':
        toast(e.data.msg, e.data.kind || 'info');
        break;
    }
  }

  // ── TABS ───────────────────────────────────────────────────────────────────
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('tab-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
        if (btn.dataset.tab === 'dev') updateStats();
      });
    });
  }

  // ── LOCAL DATA ─────────────────────────────────────────────────────────────
  async function loadLocalData() {
    const d = await chrome.storage.local.get(['exportHistory']);
    exportHistory = d.exportHistory || [];
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VAULT TAB
  // ══════════════════════════════════════════════════════════════════════════
  function setupVault() {
    document.getElementById('btn-close').addEventListener('click', () =>
      window.parent.postMessage({ type: 'DSC_CLOSE' }, '*'));
    document.getElementById('btn-settings').addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }));
    document.getElementById('btn-help').addEventListener('click', () =>
      chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') }));

    document.getElementById('dsc-scan-all-btn').addEventListener('click', () => {
      window.parent.postMessage({ type: 'DSC_DEEP_SCAN' }, '*');
    });
    document.getElementById('vault-download-all').addEventListener('click', downloadVaultZip);

    // Search filter
    document.getElementById('vault-search').addEventListener('input', renderVault);

    // Lang filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderVault();
      });
    });
  }

  function renderVault() {
    const list    = document.getElementById('vault-list');
    const countEl = document.getElementById('vault-count');
    const zoneBadge = document.getElementById('vault-zone-badge');
    const searchQ = (document.getElementById('vault-search')?.value || '').toLowerCase().trim();
    const activeLang = document.querySelector('.filter-chip.active')?.dataset.lang || 'all';

    let filtered = codeVault.filter(b => {
      const matchLang   = activeLang === 'all' || (b.lang || '').toLowerCase().includes(activeLang);
      const matchSearch = !searchQ || (b.filename || '').toLowerCase().includes(searchQ) || (b.lang || '').toLowerCase().includes(searchQ);
      return matchLang && matchSearch;
    });

    countEl.textContent = filtered.length + ' file' + (filtered.length !== 1 ? 's' : '');
    if (zoneBadge) zoneBadge.classList.toggle('hidden', zoneStart === null);

    if (filtered.length === 0) {
      list.innerHTML = codeVault.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">📂</div>No code blocks detected yet.<br>Open a DeepSeek conversation, then click <b>Scan</b>.</div>`
        : `<div class="empty-state"><div class="empty-state-icon">🔍</div>No files match your filter.</div>`;
      return;
    }

    list.innerHTML = '';
    filtered.forEach((block, i) => {
      const icon = getFileIcon(block.filename, block.lang);
      const dir  = block.filename.includes('/') ? block.filename.replace(/\/[^/]+$/, '') + '/' : '';
      const name = block.filename.split('/').pop() || block.filename;
      const card = document.createElement('div');
      card.className = 'code-card';
      card.innerHTML = `
        <div class="code-card-header">
          <span class="code-card-icon">${icon}</span>
          <div class="code-card-name-wrap">
            <span class="code-card-name" contenteditable="true" data-orig="${escHtml(block.filename)}" title="${escHtml(block.filename)}">${escHtml(name)}</span>
            ${dir ? `<div class="code-card-path">${escHtml(dir)}</div>` : ''}
          </div>
          <span class="code-card-lang">${block.lang || 'text'}</span>
        </div>
        <div class="code-card-meta">${block.lineCount || 0} lines · ${fmtBytes(block.size || 0)} · ${fmtDate(block.timestamp)}</div>
        <div class="code-card-actions">
          <button class="btn-primary btn-sm"   data-action="dl"      data-idx="${i}">⬇ Download</button>
          <button class="btn-secondary btn-sm" data-action="preview" data-idx="${i}">👁 Preview</button>
          <button class="btn-secondary btn-sm" data-action="copy"    data-idx="${i}">📋 Copy</button>
          <button class="btn-danger btn-sm"    data-action="remove"  data-idx="${i}">🗑</button>
        </div>`;

      // Rename on blur
      card.querySelector('.code-card-name').addEventListener('blur', e => {
        const newName = e.target.textContent.trim();
        if (newName) block.filename = dir + newName;
        renderVault();
      });

      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const b = filtered[parseInt(btn.dataset.idx)];
          if (!b) return;
          if (btn.dataset.action === 'dl') {
            window.parent.postMessage({ type: 'DSC_DOWNLOAD_FILE', code: b.code, filename: b.filename, mimeType: b.mimeType || 'text/plain' }, '*');
            toast('⬇ Downloaded: ' + b.filename, 'success');
          } else if (btn.dataset.action === 'preview') {
            showCodePreview(b);
          } else if (btn.dataset.action === 'copy') {
            navigator.clipboard.writeText(b.code).then(() => toast('📋 Copied!', 'success'));
          } else if (btn.dataset.action === 'remove') {
            const vi = codeVault.indexOf(b);
            if (vi !== -1) codeVault.splice(vi, 1);
            renderVault(); updateStats(); updatePatcherVaultStatus();
          }
        });
      });
      list.appendChild(card);
    });
  }

  function handleScanProgress(status, pct, count) {
    const btn = document.getElementById('dsc-scan-all-btn');
    if (status === 'start') {
      if (btn) { btn.textContent = '⏳ 0%'; btn.disabled = true; }
    } else if (status === 'progress') {
      if (btn) btn.textContent = `⏳ ${pct || 0}%`;
      const el = document.getElementById('vault-count');
      if (el && count > 0) el.textContent = count + ' files';
    } else if (status === 'done') {
      if (btn) { btn.textContent = '🔍 Scan'; btn.disabled = false; }
      renderVault(); updateStats(); updatePatcherVaultStatus();
      toast(`✅ Scan complete — ${codeVault.length} clean files`, 'success');
    }
  }

  async function downloadVaultZip() {
    if (codeVault.length === 0) { toast('No files in vault', 'warning'); return; }
    try {
      const zip = new JSZip();
      codeVault.forEach((b, i) => {
        const name = b.filename || `code_block_${i + 1}.txt`;
        if (name.includes('/')) zip.file(name, b.code || '');
        else {
          const ext = name.includes('.') ? name.split('.').pop() : 'txt';
          zip.file(ext + '/' + name, b.code || '');
        }
      });
      const readme = `# DeepSeek Companion Export\n\nExported: ${new Date().toLocaleString()}\n\n## Files (${codeVault.length})\n\n${codeVault.map(b => `- ${b.filename}`).join('\n')}\n\nExported via DeepSeek Companion Pro v4.0`;
      zip.file('README.md', readme);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      triggerDownload(blob, `deepseek-project-${Date.now()}.zip`);
      addExportHistory('ZIP', codeVault.length + ' files');
      toast(`📦 ZIP downloaded (${codeVault.length} files)`, 'success');
    } catch (e) { toast('ZIP error: ' + e.message, 'error'); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORT TAB
  // ══════════════════════════════════════════════════════════════════════════
  function setupExport() {
    document.getElementById('exp-pdf').addEventListener('click',  () => runExport('pdf'));
    document.getElementById('exp-docx').addEventListener('click', () => runExport('docx'));
    document.getElementById('exp-md').addEventListener('click',   () => runExport('md'));
    document.getElementById('exp-txt').addEventListener('click',  () => runExport('txt'));
  }

  function getPdfOptions() {
    return {
      theme: document.getElementById('pdf-theme')?.value || 'deepblue',
      cover: document.getElementById('pdf-cover')?.checked !== false,
      toc: document.getElementById('pdf-toc')?.checked !== false,
      pageNumbers: document.getElementById('pdf-pagenum')?.checked !== false,
      syntaxHighlight: document.getElementById('pdf-syntax')?.checked !== false,
    };
  }

  function requestExportContent(scope) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = pendingContentResolvers.indexOf(onReply);
        if (idx !== -1) pendingContentResolvers.splice(idx, 1);
        resolve(lastContent);
      }, 1200);

      function onReply(content) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(content);
      }

      pendingContentResolvers.push(onReply);
      window.parent.postMessage({ type: 'DSC_REQUEST_CONTENT', scope }, '*');
    });
  }

  async function generateFloatingToolbarPDF(text, title) {
    if (!text) { toast('No message content to export as PDF.', 'warning'); return; }
    try {
      if (typeof PDFEngine === 'undefined') throw new Error('PDF engine not loaded');
      await PDFEngine.generate(text, title, { ...getPdfOptions(), useExtensionDownload: true });
      addExportHistory('PDF', 'message');
      toast('📄 PDF exported', 'success');
    } catch (e) {
      toast('❌ PDF error: ' + e.message, 'error');
    }
  }

  async function runExport(format) {
    const scope = document.querySelector('input[name="exp-scope"]:checked')?.value || 'all';
    const content = await requestExportContent(scope);
    if (!content && format !== 'zip') {
      toast('No content to export. Open a DeepSeek chat with messages first.', 'warning');
      return;
    }

    try {
      if (format === 'pdf') {
        const opts = getPdfOptions();
        if (typeof PDFEngine === 'undefined') throw new Error('PDF engine not loaded');
        await PDFEngine.generate(content, 'DeepSeek Chat Export', opts);
        addExportHistory('PDF', scope);
        toast('📄 PDF exported', 'success');
      } else if (format === 'docx') {
        if (typeof DOCXEngine === 'undefined') throw new Error('DOCX engine not loaded');
        await DOCXEngine.generate(content, 'DeepSeek Chat Export');
        addExportHistory('DOCX', scope);
        toast('📝 DOCX exported', 'success');
      } else if (format === 'md') {
        const md = typeof MarkdownExporter !== 'undefined'
          ? MarkdownExporter.export(content, 'DeepSeek Chat Export')
          : content;
        downloadText(md, 'deepseek-export.md', 'text/markdown');
        addExportHistory('Markdown', scope);
        toast('🗒 Markdown exported', 'success');
      } else if (format === 'txt') {
        const plain = content.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
        downloadText(plain, 'deepseek-export.txt', 'text/plain');
        addExportHistory('Text', scope);
        toast('📋 Text exported', 'success');
      }
    } catch (e) {
      toast('❌ Export failed: ' + e.message, 'error');
    }
  }

  function addExportHistory(format, detail) {
    exportHistory.unshift({ format, detail, time: Date.now() });
    if (exportHistory.length > 8) exportHistory.pop();
    chrome.storage.local.set({ exportHistory });
    renderExportHistory();
  }

  function renderExportHistory() {
    const el = document.getElementById('export-history');
    if (!el) return;
    if (exportHistory.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:14px;">No exports yet.</div>';
      return;
    }
    const icons = { PDF:'📄', DOCX:'📝', Markdown:'🗒', Text:'📋', ZIP:'📦' };
    el.innerHTML = exportHistory.map(h => `
      <div class="export-history-item">
        <span>${icons[h.format] || '📄'}</span>
        <span class="exp-name">${h.format} · ${h.detail}</span>
        <span style="font-size:10px;color:var(--text-3);flex-shrink:0;">${fmtDate(h.time)}</span>
      </div>`).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZIP PATCHER TAB
  // ══════════════════════════════════════════════════════════════════════════
  function setupPatcher() {
    const dropzone   = document.getElementById('patch-dropzone');
    const fileInput  = document.getElementById('patch-file-input');
    const fileLoaded = document.getElementById('patch-file-loaded');
    const fileClear  = document.getElementById('patch-file-clear');
    const runBtn     = document.getElementById('patch-run-btn');
    const againBtn   = document.getElementById('patch-again-btn');

    // Click to browse
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) setPatchFile(e.target.files[0]);
    });

    // Drag & drop
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.name.endsWith('.zip')) setPatchFile(f);
      else toast('Please drop a .zip file', 'warning');
    });

    fileClear.addEventListener('click', () => clearPatchFile());
    runBtn.addEventListener('click', runPatch);
    againBtn.addEventListener('click', resetPatcher);

    updatePatcherVaultStatus();
  }

  function setPatchFile(file) {
    patchZipFile = file;
    document.getElementById('patch-dropzone').classList.add('hidden');
    const loaded = document.getElementById('patch-file-loaded');
    loaded.classList.remove('hidden');
    document.getElementById('patch-file-name').textContent = file.name + ' (' + fmtBytes(file.size) + ')';
    updateRunBtn();
  }

  function clearPatchFile() {
    patchZipFile = null;
    document.getElementById('patch-dropzone').classList.remove('hidden');
    document.getElementById('patch-file-loaded').classList.add('hidden');
    document.getElementById('patch-file-input').value = '';
    updateRunBtn();
  }

  function updateRunBtn() {
    const runBtn = document.getElementById('patch-run-btn');
    runBtn.disabled = !(patchZipFile && codeVault.length > 0);
  }

  function updatePatcherVaultStatus() {
    const badge = document.getElementById('patcher-vault-count');
    const info  = document.getElementById('patcher-vault-info');
    if (badge) badge.textContent = codeVault.length + ' vault file' + (codeVault.length !== 1 ? 's' : '');
    if (info) {
      if (codeVault.length === 0) {
        info.textContent = 'Vault is empty. Scan the chat first to populate it.';
      } else {
        info.innerHTML = `<b style="color:var(--green);">${codeVault.length} files</b> ready to merge from Vault.`;
      }
    }
    updateRunBtn();
  }

  async function runPatch() {
    if (!patchZipFile || codeVault.length === 0) return;

    const runBtn   = document.getElementById('patch-run-btn');
    const spinner  = document.getElementById('patch-spinner');
    const btnText  = document.getElementById('patch-btn-text');
    const progress = document.getElementById('patch-progress');
    const progBar  = document.getElementById('patch-progress-bar');
    const progText = document.getElementById('patch-progress-text');
    const report   = document.getElementById('patch-report');

    // UI: start
    runBtn.disabled = true;
    spinner.classList.remove('hidden');
    btnText.textContent = 'Working…';
    progress.classList.remove('hidden');
    report.classList.add('hidden');

    try {
      const result = await ZipPatcher.patch(patchZipFile, codeVault, {
        onProgress(pct, msg) {
          progBar.style.width = pct + '%';
          progText.textContent = msg;
        }
      });

      // Trigger download
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outName = patchZipFile.name.replace(/\.zip$/i, '') + '-patched-' + ts + '.zip';
      triggerDownload(result.blob, outName);

      // Show report
      const r = result.report;
      document.getElementById('rpt-existing').textContent  = r.total.existingFiles;
      document.getElementById('rpt-added').textContent     = r.total.added;
      document.getElementById('rpt-replaced').textContent  = r.total.replaced;
      document.getElementById('rpt-unchanged').textContent = r.total.unchanged;

      // Added detail
      const addedSec = document.getElementById('rpt-detail-added');
      const addedList = document.getElementById('rpt-list-added');
      if (r.added.length > 0) {
        addedSec.classList.remove('hidden');
        addedList.innerHTML = r.added.map(f => `
          <div class="patch-detail-item">
            <div class="patch-status-dot" style="background:var(--green);"></div>
            <span>${escHtml(f)}</span>
          </div>`).join('');
      } else {
        addedSec.classList.add('hidden');
      }

      // Replaced detail
      const repSec  = document.getElementById('rpt-detail-replaced');
      const repList = document.getElementById('rpt-list-replaced');
      if (r.replaced.length > 0) {
        repSec.classList.remove('hidden');
        repList.innerHTML = r.replaced.map(f => `
          <div class="patch-detail-item">
            <div class="patch-status-dot" style="background:var(--yellow);"></div>
            <span>${escHtml(typeof f === 'string' ? f : f.vault)}</span>
          </div>`).join('');
      } else {
        repSec.classList.add('hidden');
      }

      report.classList.remove('hidden');
      progress.classList.add('hidden');
      addExportHistory('ZIP Patch', r.total.added + ' added · ' + r.total.replaced + ' updated');
      toast(`✅ Patched ZIP downloaded — ${r.total.added} added, ${r.total.replaced} updated`, 'success');

    } catch (err) {
      toast('❌ Patch error: ' + err.message, 'error');
      progress.classList.add('hidden');
    } finally {
      runBtn.disabled = false;
      spinner.classList.add('hidden');
      btnText.textContent = '🔧 Patch & Download ZIP';
    }
  }

  function resetPatcher() {
    clearPatchFile();
    document.getElementById('patch-report').classList.add('hidden');
    document.getElementById('patch-progress').classList.add('hidden');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZONE TAB
  // ══════════════════════════════════════════════════════════════════════════
  function setupZone() {
    document.getElementById('zone-btn-start').addEventListener('click', () => {
      window.parent.postMessage({ type: 'DSC_BND_SET_START' }, '*');
      toast('Click the FIRST message on the page to set start', 'info');
    });
    document.getElementById('zone-btn-end').addEventListener('click', () => {
      window.parent.postMessage({ type: 'DSC_BND_SET_END' }, '*');
      toast('Click the LAST message of your range to set end', 'info');
    });
    document.getElementById('zone-btn-clear').addEventListener('click', () => {
      window.parent.postMessage({ type: 'DSC_BND_CLEAR' }, '*');
      zoneStart = null; zoneEnd = null; updateZoneUI();
    });
    document.getElementById('zone-btn-apply').addEventListener('click', () => {
      const s  = parseInt(document.getElementById('zone-input-start').value);
      const en = parseInt(document.getElementById('zone-input-end').value);
      if (isNaN(s) || s < 1) { toast('Enter a valid start number', 'warning'); return; }
      zoneStart = s - 1;
      zoneEnd   = (isNaN(en) || en < 1) ? null : en - 1;
      window.parent.postMessage({ type: 'DSC_BND_MANUAL', start: zoneStart, end: zoneEnd }, '*');
      updateZoneUI();
      toast('Zone applied: msg ' + s + (zoneEnd != null ? ' → ' + (zoneEnd + 1) : ''), 'success');
    });
    document.getElementById('zone-btn-scan').addEventListener('click', () => {
      window.parent.postMessage({ type: 'DSC_BND_SCAN' }, '*');
      toast(zoneStart !== null
        ? 'Scanning zone (msgs ' + (zoneStart + 1) + '–' + ((zoneEnd != null ? zoneEnd : zoneStart) + 1) + ')…'
        : 'Scanning full chat…', 'info');
    });
    document.querySelectorAll('.zone-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        const total  = totalMsgs || 1;
        let s, en;
        if (preset === 'last5')   { s = Math.max(0, total - 5);  en = total - 1; }
        if (preset === 'last10')  { s = Math.max(0, total - 10); en = total - 1; }
        if (preset === 'last20')  { s = Math.max(0, total - 20); en = total - 1; }
        if (preset === 'first10') { s = 0; en = Math.min(9, total - 1); }
        if (s == null) return;
        zoneStart = s; zoneEnd = en;
        window.parent.postMessage({ type: 'DSC_BND_MANUAL', start: zoneStart, end: zoneEnd }, '*');
        updateZoneUI();
        // Display as 1-based human numbers
        toast('Zone: msgs ' + (s + 1) + ' → ' + (en + 1) + ' of ' + total, 'success');
      });
    });
  }

  function updateZoneUI() {
    const active   = zoneStart !== null;
    const badge    = document.getElementById('zone-status-badge');
    const label    = document.getElementById('zone-range-label');
    const stats    = document.getElementById('zone-range-stats');
    const totEl    = document.getElementById('zone-total');
    const inS      = document.getElementById('zone-input-start');
    const inE      = document.getElementById('zone-input-end');
    const expNote  = document.getElementById('exp-zone-notice');
    const vBadge   = document.getElementById('vault-zone-badge');

    if (totEl) {
      totEl.textContent = totalMsgs || 0;
      // Show hint if total looks low (scan hasn't run yet)
      const hintEl = document.getElementById('zone-total-hint');
      if (hintEl) hintEl.style.display = (totalMsgs < 3) ? 'inline' : 'none';
    }

    // Always display range as low→high regardless of which end was clicked first
    const lo = (active && zoneEnd !== null) ? Math.min(zoneStart, zoneEnd) : zoneStart;
    const hi = (active && zoneEnd !== null) ? Math.max(zoneStart, zoneEnd) : null;

    if (badge) {
      badge.textContent = active
        ? 'Msgs ' + (lo + 1) + (hi !== null ? '–' + (hi + 1) : '')
        : 'Full Chat';
      badge.style.background  = active ? 'rgba(163,113,247,0.2)' : '';
      badge.style.borderColor = active ? 'rgba(163,113,247,0.5)' : '';
      badge.style.color       = active ? 'var(--purple)' : '';
    }
    if (label) {
      label.textContent = active
        ? 'Messages ' + (lo + 1) + (hi !== null ? ' → ' + (hi + 1) : ' (single)')
        : 'No zone — scanning full chat';
      label.style.color = active ? 'var(--blue)' : 'var(--text-2)';
    }
    if (stats) {
      const count = (active && hi !== null) ? hi - lo + 1 : (active ? 1 : totalMsgs);
      stats.textContent = count + (active ? ' messages in zone' : ' total messages') + ' · ' + codeVault.length + ' files';
    }
    if (inS && active) inS.value = lo + 1;
    if (inE && active && hi !== null) inE.value = hi + 1;
    if (expNote) expNote.classList.toggle('hidden', !active);
    if (vBadge)  vBadge.classList.toggle('hidden', !active);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DEV TOOLS TAB
  // ══════════════════════════════════════════════════════════════════════════
  function setupDev() {
    // Auto-Proceed toggle
    const apToggle = document.getElementById('autoproceed-toggle');
    apToggle?.addEventListener('change', () => {
      const enabled = apToggle.checked;
      window.parent.postMessage({ type: 'DSC_AUTOPROCEED_TOGGLE', enabled }, '*');
      updateAutoProceedUI(enabled);
      toast(enabled ? '⚡ Auto-proceed ON — watching for PROCEED signal' : '⏸ Auto-proceed OFF', enabled ? 'success' : 'info');
    });
    // Quick prompts
    document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.dataset.prompt) return;
        window.parent.postMessage({ type: 'DSC_INSERT_TEMPLATE', text: btn.dataset.prompt }, '*');
        toast('⚡ Prompt inserted!', 'success');
      });
    });

    document.getElementById('dev-copy-all').addEventListener('click', () => {
      const all = codeVault.map(b => `// === ${b.filename} ===\n${b.code}`).join('\n\n');
      navigator.clipboard.writeText(all).then(() => toast('📋 All code copied (' + codeVault.length + ' files)', 'success'));
    });
    document.getElementById('dev-copy-names').addEventListener('click', () =>
      navigator.clipboard.writeText(codeVault.map(b => b.filename).join('\n'))
        .then(() => toast('📋 Filenames copied', 'success')));
    document.getElementById('dev-copy-tree').addEventListener('click', () =>
      navigator.clipboard.writeText(buildFileTree(codeVault.map(b => b.filename)))
        .then(() => toast('📋 File tree copied', 'success')));
    document.getElementById('dev-export-json').addEventListener('click', () => {
      const data = JSON.stringify(codeVault.map(b => ({ filename: b.filename, lang: b.lang, lines: b.lineCount, code: b.code })), null, 2);
      downloadText(data, 'vault.json', 'application/json');
      toast('💾 JSON exported', 'success');
    });
    document.getElementById('dev-copy-prompt').addEventListener('click', () => {
      const txt = getActivePrompt();
      navigator.clipboard.writeText(txt)
        .then(() => toast('📋 Prompt copied! Paste it at the start of your DeepSeek session.', 'success'));
    });
    document.getElementById('dev-insert-prompt').addEventListener('click', () => {
      const txt = getActivePrompt();
      window.parent.postMessage({ type: 'DSC_INSERT_TEMPLATE', text: txt }, '*');
      toast('⚡ Prompt inserted into DeepSeek input!', 'success');
    });

    // Prompt tab switching
    document.querySelectorAll('.prompt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.prompt-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderPromptPreview();
      });
    });
    renderPromptPreview();
  }

  function updateStats() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const langs = new Set(codeVault.map(b => b.lang).filter(Boolean));
    set('stat-total', codeVault.length);
    set('stat-size',  fmtBytes(codeVault.reduce((a, b) => a + (b.size || 0), 0)));
    set('stat-lines', codeVault.reduce((a, b) => a + (b.lineCount || 0), 0).toLocaleString());
    set('stat-langs', langs.size);
  }

  function updateAutoProceedUI(enabled) {
    const toggle = document.getElementById('autoproceed-toggle');
    const status = document.getElementById('autoproceed-status');
    const dot    = document.getElementById('ap-status-dot');
    const text   = document.getElementById('ap-status-text');
    if (toggle) toggle.checked = !!enabled;
    if (status) {
      status.className = 'autoproceed-status ' + (enabled ? 'ap-active' : 'ap-idle');
    }
    if (text) text.textContent = enabled
      ? 'Watching — fires when last line is PROCEED'
      : 'Disabled — enable to activate';
  }

  function logAutoProceed(msg) {
    const log = document.getElementById('autoproceed-log');
    if (!log) return;
    log.classList.remove('hidden');
    const entry = document.createElement('span');
    entry.className = 'ap-log-entry';
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="ap-time">[${now}]</span> <span class="ap-msg">${escHtml(msg)}</span>`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    // Update status dot to fired state briefly
    const status = document.getElementById('autoproceed-status');
    if (status) {
      status.className = 'autoproceed-status ap-fired';
      const text = document.getElementById('ap-status-text');
      if (text) text.textContent = msg;
      setTimeout(() => {
        const enabled = document.getElementById('autoproceed-toggle')?.checked;
        updateAutoProceedUI(enabled);
      }, 4000);
    }
  }

  function buildFileTree(filenames) {
    const tree = {};
    filenames.forEach(name => {
      const parts = String(name || '').split('/').filter(Boolean);
      let node = tree;
      parts.forEach((p, i) => {
        const isLeaf = i === parts.length - 1;
        if (isLeaf) {
          if (!(p in node)) node[p] = null;
        } else {
          if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
          node = node[p];
        }
      });
    });
    function render(node, prefix = '') {
      return Object.entries(node).map(([k, v], i, arr) => {
        const last = i === arr.length - 1;
        return prefix + (last ? '└── ' : '├── ') + k +
          (v !== null ? '\n' + render(v, prefix + (last ? '    ' : '│   ')) : '');
      }).join('\n');
    }
    return render(tree);
  }

  // ── AI CODING PROMPT SYSTEM ─────────────────────────────────────────────
  function getActivePrompt() {
    const tab = document.querySelector('.prompt-tab.active')?.dataset.ptab || 'full';
    return PROMPTS[tab] || PROMPTS.full;
  }

  function renderPromptPreview() {
    const box = document.getElementById('prompt-preview-box');
    if (!box) return;
    const tab = document.querySelector('.prompt-tab.active')?.dataset.ptab || 'full';
    const txt = PROMPTS[tab] || PROMPTS.full;
    // Simple syntax highlighting: headings in blue, rule keywords in green, comments in grey
    const html = txt
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/(#{1,3} .+)/g, '<span class="ph">$1</span>')
      .replace(/(\bRULE \d\b[^\n]*)/g, '<span class="pk">$1</span>')
      .replace(/(\/\/ src\/[^\n]+)/g, '<span class="pk">$1</span>')
      .replace(/(# [^\n]+\.(?:py|sh|yml))/g, '<span class="pk">$1</span>')
      .replace(/(CORRECT:|WRONG:)/g, '<span class="pc">$1</span>');
    box.innerHTML = html;
  }

  const PROMPTS = {
    full: [
      'You are an expert software engineer and my dedicated coding assistant.',
      'I am using the DeepSeek Companion Pro extension which automatically extracts,',
      'organizes, and downloads every file you produce. Follow ALL rules below precisely.',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '## CRITICAL OUTPUT RULES — follow ALL for every code file:',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '### RULE 1 — FILE PATH ON LINE 1 (most important)',
      'Every code block MUST begin with the FULL file path as a comment on LINE 1.',
      '',
      '  TypeScript/JS:   // src/app/component.tsx',
      '  Python:          # src/utils/helpers.py',
      '  CSS/SCSS:        /* src/styles/global.css */',
      '  HTML:            <!-- src/index.html -->',
      '  Shell/YAML:      # scripts/setup.sh',
      '  Rust:            // src/main.rs',
      '',
      'CORRECT ✅',
      '```typescript',
      '// src/app/component.tsx',
      'export function MyComponent() { return <div />; }',
      '```',
      '',
      'WRONG ❌ (extension cannot detect filename — do NOT do this)',
      '```typescript',
      'export function MyComponent() { return <div />; }',
      '```',
      '',
      '### RULE 2 — ONE FILE PER CODE BLOCK',
      'Each file = exactly one fenced code block. Never put two files in one block.',
      '',
      '### RULE 3 — COMPLETE FILES ONLY',
      'Always write the ENTIRE file. Never write:',
      '  ❌ "// ...rest stays the same"',
      '  ❌ "// ... (existing code)"',
      '  ❌ "// unchanged"',
      'Write the full file every time, even if most of it did not change.',
      '',
      '### RULE 4 — CONSISTENT PATHS',
      'Use the EXACT SAME path every time for the same file across the whole conversation.',
      'Never rename a file mid-conversation unless explicitly asked.',
      '',
      '### RULE 5 — UPDATING FILES',
      'When fixing or updating a file, first write:',
      '  "Updating src/path/file.ts"',
      'Then write the COMPLETE new version of that file.',
      'The extension keeps only the latest version of each file path automatically.',
      '',
      '### RULE 6 — FILE HEADER for config files (JSON / TOML / YAML)',
      'For file types where line-1 comments are invalid syntax, write the filename',
      'as a bold markdown label immediately ABOVE the code block:',
      '',
      '  **`package.json`**',
      '  ```json',
      '  { "name": "my-app" }',
      '  ```',
      '',
      '### RULE 7 — PROCEED SIGNAL (most important for multi-wave generation)',
      'When you are generating files in multiple waves or batches, you MUST signal',
      'whether the generation is complete or not.',
      '',
      'If MORE FILES remain to be generated after this response:',
      '  → End your ENTIRE response with this exact word on its own line:',
      '',
      '  PROCEED',
      '',
      'If ALL requested files have been generated and nothing remains:',
      '  → Do NOT write PROCEED. End normally.',
      '  → You may write a summary like "All N files complete." instead.',
      '',
      'WHY: The extension reads the last line of each response. If it sees PROCEED,',
      'it automatically types "continue" and submits it so you can keep generating',
      'the next wave without the user needing to do anything.',
      '',
      'PROCEED must be:',
      '  ✅ Uppercase: PROCEED',
      '  ✅ On its own line at the very end',
      '  ✅ No punctuation after it (not "PROCEED." or "PROCEED!")',
      '  ❌ Do NOT write PROCEED if all files are done',
      '  ❌ Do NOT write PROCEED in the middle of a response',
      '',
      'EXAMPLE of correct wave ending when more files remain:',
      '  Wave 3 complete (10/24 files). Next: authentication module.',
      '',
      '  PROCEED',
      '',
      'EXAMPLE of correct final ending:',
      '  All 24 files generated. Project is complete.',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n'),

    short: [
      'You are an expert software engineer and coding assistant.',
      'I am using the DeepSeek Companion Pro extension. Follow these rules exactly:',
      '',
      '1. LINE 1 = full path comment: `// src/path/file.ts` or `# path/file.py`',
      '2. One file per code block. Never combine files.',
      '3. Always write the COMPLETE file — no truncation, no "...unchanged".',
      '4. Same path for same file throughout the entire conversation.',
      '5. When updating: write "Updating src/path/file.ts" then the full new file.',
      '6. JSON/YAML: write filename as bold label above the block.',
      '7. PROCEED SIGNAL:',
      '   • If more files remain → end response with PROCEED (alone, last line)',
      '   • If all files done → do NOT write PROCEED, end normally',
      '   The extension auto-sends "continue" when it sees PROCEED.',
    ].join('\n'),

    rules: [
      'EXTENSION RULES — paste before your coding request:',
      '',
      '• Line 1 of every code block = file path comment: // src/file.ts',
      '• One file = one code block, never combined',
      '• Complete files only — no "...rest unchanged"',
      '• Same path every time for the same file',
      '• PROCEED (last line, alone) = more files coming',
      '• No PROCEED at end = generation complete',
    ].join('\n'),
  };

  // ── PREVIEW MODAL ──────────────────────────────────────────────────────────
  function setupPreviewModal() {
    document.getElementById('close-preview').addEventListener('click', () =>
      document.getElementById('code-preview-modal').classList.add('hidden'));
    document.getElementById('preview-copy-btn').addEventListener('click', () =>
      navigator.clipboard.writeText(document.getElementById('preview-code').textContent)
        .then(() => toast('📋 Copied!', 'success')));
    document.getElementById('preview-dl-btn').addEventListener('click', () => {
      const code = document.getElementById('preview-code').textContent;
      const name = document.getElementById('preview-filename').textContent;
      downloadText(code, name, 'text/plain');
    });
  }

  function showCodePreview(block) {
    document.getElementById('preview-filename').textContent = block.filename || 'preview';
    document.getElementById('preview-code').textContent     = block.code || '';
    document.getElementById('code-preview-modal').classList.remove('hidden');
  }

  // ── UTILITIES ───────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtBytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function getFileIcon(filename, lang) {
    const ext = (filename || '').split('.').pop()?.toLowerCase();
    const map = { ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️', py: '🐍', html: '🌐', css: '🎨', scss: '🎨', json: '📋', sh: '🖥️', md: '📝', yml: '⚙️', yaml: '⚙️', sql: '🗄️', txt: '📄', rs: '🦀', go: '🐹', java: '☕', php: '🐘', rb: '💎', swift: '🍎', kt: '🟣', dart: '🎯', vue: '💚', svelte: '🔥' };
    return map[ext] || map[lang] || '📄';
  }
  function downloadText(data, filename, mime) {
    const blob = new Blob([data], { type: mime });
    triggerDownload(blob, filename);
  }
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── TOAST ───────────────────────────────────────────────────────────────────
  function toast(msg, type = 'info') {
    let c = document.getElementById('dsc-toasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'dsc-toasts';
      c.style.cssText = 'position:fixed;bottom:12px;left:8px;right:8px;z-index:9999;display:flex;flex-direction:column;gap:5px;pointer-events:none;';
      document.body.appendChild(c);
    }
    const colors = { success: '#3fb950', error: '#f85149', warning: '#d29922', info: '#2f81f7' };
    if (!document.getElementById('dsc-toast-anim')) {
      const s = document.createElement('style'); s.id = 'dsc-toast-anim';
      s.textContent = '@keyframes _ti{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}';
      document.head.appendChild(s);
    }
    const t = document.createElement('div');
    t.style.cssText = `background:#1c2128;color:#e6edf3;border-left:3px solid ${colors[type] || colors.info};border:1px solid #30363d;border-left-width:3px;border-left-color:${colors[type] || colors.info};border-radius:7px;padding:9px 13px;font-size:12px;animation:_ti 0.18s ease;box-shadow:0 4px 16px rgba(0,0,0,0.45);pointer-events:all;line-height:1.4;`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.2s'; setTimeout(() => t.remove(), 200); }, 3200);
  }
  window.DSToast = toast;

  init().catch(console.error);
})();
