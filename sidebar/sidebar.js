// sidebar.js — DeepSeek Companion King Edition v3.0.0
(function() {
  'use strict';

  const DEFAULT_GEMINI_KEY = ''; // Set your Gemini API key in Settings or the AI tab
  const GEMINI_MODEL = 'gemini-1.5-flash-latest';

  const GEMINI_PROMPTS = {
    reformat:  'Reformat this content into a clear, well-structured explanation with proper headings, bullet points, examples, and a summary:',
    summarize: 'Summarize this in 3-5 bullet points for quick review:',
    expand:    'Expand each point with more detail, examples, and real-world explanations:',
    simplify:  'Explain this as simply as possible, as if explaining to a complete beginner with no technical background:',
    keypoints: 'List only the most important facts, definitions, and actionable items from this content:',
    debug:     'You are an expert code reviewer. Find all bugs, errors, and issues in the following code and provide corrected version with explanations:',
    translate: 'Translate this content to',
    custom:    ''
  };

  let codeVault = [];
  let bookmarks = [];
  let templates = [];
  let exportHistory = [];
  let lastContent = '';
  let editingTemplateId = null;
  let geminiRunning = false;
  let vaultSortOrder = 'newest';
  let vaultSelectedIds = new Set();

  // Lab ZIP state
  let labFiles = {};       // { "path/to/file.ts": { content, improved, status } }
  let labFileKeys = [];    // ordered list of file paths
  let labImproveIdx = 0;

  // ── VAULT CLEANER: Remove junk files (terminal commands, outputs) ──────────
  function cleanVault(vault) {
    const JUNK_FILENAMES = new Set([
      'output.txt', 'script.sh', 'run.sh', 'install.sh', 'test.sh',
      'code_block.txt', 'code_block.sh', 'code_block.bash'
    ]);

    // Keep only the latest version of each unique filename
    const byName = new Map();
    vault.forEach(block => {
      const key = (block.filename || '').toLowerCase().trim();
      // Filter: skip generic junk filenames UNLESS the block has meaningful content
      if (JUNK_FILENAMES.has(key)) {
        // Only keep script.sh if it has real setup content (not just terminal commands)
        const lines = (block.code || '').split('\n').filter(l => l.trim()).length;
        const isSetupScript = lines > 5 && /npm|yarn|pip|docker|build|install|setup|deploy/i.test(block.code);
        if (!isSetupScript) return; // skip it
      }
      // Dedup: keep the latest (last occurrence in array = most recent in chat)
      byName.set(key, block);
    });
    return Array.from(byName.values());
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    setupTabs();
    setupButtons();
    setupGeminiTab();
    setupLabTab();
    setupDevTools();
    await loadLocalData();
    renderVault();
    renderBookmarks();
    renderTemplates();
    renderExportHistory();
    window.addEventListener('message', handleParentMessage);
    window.parent.postMessage({ type: 'DSC_REQUEST_SYNC' }, '*');
  }

  function handleParentMessage(e) {
    if (!e.data || !e.data.type) return;
    switch (e.data.type) {
      case 'DSC_SYNC':
        if (e.data.codeVault) {
          // Filter out any junk files that slipped through
          codeVault = cleanVault(e.data.codeVault);
          renderVault();
          updateDevStats();
        }
        if (e.data.bookmarks) { bookmarks = e.data.bookmarks; renderBookmarks(); }
        if (e.data.templates) { templates = e.data.templates; renderTemplates(); }
        if (e.data.lastContent) { lastContent = e.data.lastContent; }
        break;
      case 'DSC_CONTENT':
        lastContent = e.data.content || '';
        break;
      case 'DSC_SCAN_PROGRESS':
        handleScanProgress(e.data.status, e.data.pct, e.data.count);
        break;
      case 'DSC_GEMINI_RESULT':
        showGeminiResult(e.data.result);
        break;
      case 'DSC_GEMINI_ERROR':
        showGeminiError(e.data.error);
        break;
      case 'DSC_GENERATE_PDF':
        generateAndDownloadPDF(e.data.text, e.data.title);
        break;
      case 'DSC_TOAST':
        DSToast(e.data.msg, e.data.kind || 'info');
        break;
    }
  }

  // ── TABS ──────────────────────────────────────────────────────────────────
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('tab-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
        if (btn.dataset.tab === 'devtools') updateDevStats();
      });
    });
  }

  function switchToTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  // ── BUTTONS ──────────────────────────────────────────────────────────────
  function setupButtons() {
    // Header
    document.getElementById('btn-close').addEventListener('click', () =>
      window.parent.postMessage({ type: 'DSC_CLOSE' }, '*'));
    document.getElementById('btn-settings').addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }));
    document.getElementById('btn-help').addEventListener('click', () =>
      chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') }));

    // Vault
    document.getElementById('vault-download-all').addEventListener('click', downloadAllAsZip);
    document.getElementById('dsc-scan-all-btn').addEventListener('click', () =>
      window.parent.postMessage({ type: 'DSC_DEEP_SCAN' }, '*'));
    document.getElementById('vault-search').addEventListener('input', renderVault);
    document.getElementById('vault-lang-filter').addEventListener('change', renderVault);
    document.getElementById('vault-sort-btn').addEventListener('click', () => {
      vaultSortOrder = vaultSortOrder === 'newest' ? 'oldest' : 'newest';
      DSToast('Sort: ' + vaultSortOrder, 'info');
      renderVault();
    });
    document.getElementById('vault-clear-btn').addEventListener('click', () => {
      if (confirm('Clear all files from vault?')) { codeVault = []; renderVault(); updateDevStats(); }
    });
    document.getElementById('vault-download-selected').addEventListener('click', downloadSelectedAsZip);
    document.getElementById('vault-deselect-all').addEventListener('click', () => {
      vaultSelectedIds.clear();
      renderVault();
    });

    // Export
    document.getElementById('exp-pdf').addEventListener('click', () => exportContent('pdf'));
    document.getElementById('exp-docx').addEventListener('click', () => exportContent('docx'));
    document.getElementById('exp-md').addEventListener('click', () => exportContent('md'));
    document.getElementById('exp-txt').addEventListener('click', () => exportContent('txt'));
    document.getElementById('exp-html').addEventListener('click', () => exportContent('html'));
    document.getElementById('exp-json').addEventListener('click', () => exportContent('json'));

    // Bookmarks
    document.getElementById('bookmark-search').addEventListener('input', renderBookmarks);
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderBookmarks();
      });
    });
    document.getElementById('export-bookmarks-pdf').addEventListener('click', exportBookmarksPDF);
    document.getElementById('export-bookmarks-json').addEventListener('click', () => {
      downloadData(JSON.stringify(bookmarks, null, 2), 'bookmarks.json', 'application/json');
    });
    document.getElementById('clear-bookmarks').addEventListener('click', () => {
      if (confirm('Clear all bookmarks?')) { bookmarks = []; saveBookmarks(); renderBookmarks(); }
    });

    // Templates
    document.getElementById('add-template').addEventListener('click', () => openTemplateEditor(null));
    document.getElementById('template-search').addEventListener('input', renderTemplates);
    document.getElementById('template-cat').addEventListener('change', renderTemplates);
    document.getElementById('tpl-save').addEventListener('click', saveTemplate);
    document.getElementById('tpl-cancel').addEventListener('click', () => closeModal('template-editor'));
    document.getElementById('var-cancel').addEventListener('click', () => closeModal('var-modal'));
    document.getElementById('import-templates').addEventListener('click', importTemplates);
    document.getElementById('export-templates').addEventListener('click', () =>
      downloadData(JSON.stringify(templates, null, 2), 'templates.json', 'application/json'));

    // Settings
    document.getElementById('btn-open-full-settings').addEventListener('click', () =>
      window.open(chrome.runtime.getURL('settings/settings.html'), '_blank'));

    // Code preview modal
    document.getElementById('close-preview').addEventListener('click', () => closeModal('code-preview-modal'));
    document.getElementById('preview-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('preview-code').textContent)
        .then(() => DSToast('📋 Copied!', 'success'));
    });
    document.getElementById('preview-download-btn').addEventListener('click', () => {
      const code = document.getElementById('preview-code').textContent;
      const name = document.getElementById('preview-filename').textContent;
      downloadData(code, name, 'text/plain');
    });

    // Quick settings
    document.querySelectorAll('[id^="s-"]').forEach(input => input.addEventListener('change', saveQuickSettings));
    loadQuickSettings();

    // Sidebar width
    const wSlider = document.getElementById('sidebar-width-slider');
    if (wSlider) {
      wSlider.addEventListener('input', () => {
        const w = wSlider.value;
        document.getElementById('sidebar-width-label').textContent = w + 'px';
        window.parent.postMessage({ type: 'DSC_RESIZE', width: parseInt(w) }, '*');
      });
    }

    // Gemini API key save in AI tab
    document.getElementById('gemini-key-save').addEventListener('click', async () => {
      const key = document.getElementById('gemini-api-key-input').value.trim();
      if (key) {
        await chrome.storage.local.set({ userGeminiKey: key });
        DSToast('✅ API Key saved!', 'success');
      }
    });
  }

  // ── CODE VAULT ─────────────────────────────────────────────────────────────
  function handleScanProgress(status, pct, count) {
    const scanBtn = document.getElementById('dsc-scan-all-btn');
    const countEl = document.getElementById('vault-count');
    if (status === 'start') {
      if (scanBtn) { scanBtn.textContent = '⏳ 0%'; scanBtn.disabled = true; scanBtn.style.minWidth = '70px'; }
    } else if (status === 'progress') {
      if (scanBtn) scanBtn.textContent = `⏳ ${pct || 0}%`;
      if (countEl && count > 0) countEl.textContent = count + ' files';
      // Also live-refresh vault during scan so user sees files appearing
      if (count > 0) renderVault();
    } else if (status === 'done') {
      if (scanBtn) { scanBtn.textContent = '🔍 Scan All'; scanBtn.disabled = false; scanBtn.style.minWidth = ''; }
      renderVault();
      updateDevStats();
      DSToast(`✅ Found ${count} code file${count !== 1 ? 's' : ''}`, 'success');
    }
  }

  function renderVault() {
    const list = document.getElementById('vault-list');
    const countEl = document.getElementById('vault-count');
    const searchVal = (document.getElementById('vault-search')?.value || '').toLowerCase();
    const langFilter = document.getElementById('vault-lang-filter')?.value || 'all';

    let filtered = codeVault.filter(b => {
      const matchSearch = !searchVal || b.filename.toLowerCase().includes(searchVal) || b.lang?.toLowerCase().includes(searchVal);
      const matchLang = langFilter === 'all' || b.lang === langFilter;
      return matchSearch && matchLang;
    });

    if (vaultSortOrder === 'oldest') filtered = filtered.slice().reverse();

    countEl.textContent = codeVault.length + ' file' + (codeVault.length !== 1 ? 's' : '');

    const footerEl = document.getElementById('vault-footer');
    if (vaultSelectedIds.size > 0) {
      footerEl.style.display = 'flex';
      document.getElementById('vault-selected-count').textContent = `${vaultSelectedIds.size} selected`;
    } else {
      footerEl.style.display = 'none';
    }

    if (filtered.length === 0) {
      list.innerHTML = codeVault.length === 0
        ? '<div class="empty-state">No code blocks detected yet.<br>Open a conversation with code or click <b>Scan All</b>.</div>'
        : '<div class="empty-state">No files match your filter.</div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach((block, i) => {
      const realIdx = codeVault.indexOf(block);
      const langInfo = (typeof LANGUAGE_MAP !== 'undefined' && LANGUAGE_MAP[block.lang]) || {};
      const icon = langInfo.icon || getFileIcon(block.filename, block.lang);
      const selected = vaultSelectedIds.has(block.id);
      const card = document.createElement('div');
      card.className = 'code-card' + (selected ? ' code-card-selected' : '');
      card.innerHTML = `
        <div class="code-card-header">
          <input type="checkbox" class="card-checkbox" ${selected ? 'checked' : ''} title="Select for batch action">
          <span class="code-card-icon">${icon}</span>
          <span class="code-card-name" contenteditable="true" data-idx="${realIdx}" title="Click to rename">${escapeHtml(block.filename)}</span>
          <span class="code-card-lang">${block.lang || 'text'}</span>
        </div>
        <div class="code-card-meta">
          ${block.lineCount} lines · ${formatBytes(block.size)} · ${formatDate(block.timestamp)}
          ${block.confidence === 'high' ? ' · <span style="color:#3fb950;font-size:9px;">✓ named</span>' : block.confidence === 'guessed' ? ' · <span style="color:#d29922;font-size:9px;">⚠ guessed name</span>' : ''}
        </div>
        <div class="code-card-actions">
          <button class="btn-primary btn-sm" data-action="download" data-idx="${realIdx}">⬇ Download</button>
          <button class="btn-secondary btn-sm" data-action="preview" data-idx="${realIdx}">👁 Preview</button>
          <button class="btn-secondary btn-sm" data-action="copy" data-idx="${realIdx}">📋 Copy</button>
          <button class="btn-ghost btn-sm" data-action="tolab" data-idx="${realIdx}" title="Send to Lab ZIP">🧪</button>
          <button class="btn-danger btn-sm" data-action="remove" data-idx="${realIdx}">🗑</button>
        </div>
      `;

      // Checkbox select
      card.querySelector('.card-checkbox').addEventListener('change', (e) => {
        if (e.target.checked) vaultSelectedIds.add(block.id);
        else vaultSelectedIds.delete(block.id);
        const footer = document.getElementById('vault-footer');
        footer.style.display = vaultSelectedIds.size > 0 ? 'flex' : 'none';
        document.getElementById('vault-selected-count').textContent = `${vaultSelectedIds.size} selected`;
        card.classList.toggle('code-card-selected', e.target.checked);
      });

      // Filename rename
      card.querySelector('.code-card-name').addEventListener('blur', (ev) => {
        const idx = parseInt(ev.target.dataset.idx);
        codeVault[idx].filename = ev.target.textContent.trim();
      });

      // Action buttons
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          const b = codeVault[idx];
          const action = btn.dataset.action;
          if (action === 'download') {
            downloadData(b.code, b.filename, b.mimeType || 'text/plain');
            DSToast('✅ Downloaded: ' + b.filename, 'success');
          } else if (action === 'preview') {
            showCodePreview(b);
          } else if (action === 'copy') {
            navigator.clipboard.writeText(b.code).then(() => DSToast('📋 Copied!', 'success'));
          } else if (action === 'tolab') {
            labFiles[b.filename] = { content: b.code, improved: false, status: 'pending' };
            labFileKeys = Object.keys(labFiles);
            renderLabFileList();
            document.getElementById('lab-file-count').textContent = labFileKeys.length + ' files';
            document.getElementById('lab-files-section').classList.remove('hidden');
            switchToTab('lab');
            DSToast('🧪 Added to Lab: ' + b.filename, 'info');
          } else if (action === 'remove') {
            codeVault.splice(idx, 1);
            renderVault();
            updateDevStats();
          }
        });
      });

      list.appendChild(card);
    });
  }

  function getFileIcon(filename, lang) {
    if (!filename) return '📄';
    const ext = filename.split('.').pop()?.toLowerCase();
    const map = { ts:'🔷', tsx:'⚛️', js:'🟨', jsx:'⚛️', py:'🐍', html:'🌐', css:'🎨', json:'📋', sh:'🖥️', md:'📝', yml:'⚙️', yaml:'⚙️', sql:'🗄️', txt:'📄' };
    return map[ext] || map[lang] || '📄';
  }

  function showCodePreview(block) {
    document.getElementById('preview-filename').textContent = block.filename;
    document.getElementById('preview-code').textContent = block.code;
    openModal('code-preview-modal');
  }

  function downloadAllAsZip() {
    if (codeVault.length === 0) { DSToast('No files to zip', 'warning'); return; }
    buildAndDownloadZip(codeVault, 'deepseek-vault-all.zip');
  }

  function downloadSelectedAsZip() {
    const selected = codeVault.filter(b => vaultSelectedIds.has(b.id));
    if (selected.length === 0) { DSToast('No files selected', 'warning'); return; }
    buildAndDownloadZip(selected, 'deepseek-vault-selected.zip');
  }

  async function buildAndDownloadZip(blocks, zipname) {
    try {
      const zip = new JSZip();
      blocks.forEach(b => zip.file(b.filename, b.code));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = zipname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      DSToast(`📦 Downloaded ${zipname} (${blocks.length} files)`, 'success');
    } catch (e) {
      DSToast('❌ ZIP error: ' + e.message, 'error');
    }
  }

  // ── LAB ZIP BUILDER ────────────────────────────────────────────────────────
  function setupLabTab() {
    document.getElementById('lab-paste-chat-btn').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        document.getElementById('lab-chat-input').value = text;
        DSToast('📋 Pasted from clipboard', 'success');
      } catch { DSToast('Could not read clipboard. Paste manually with Ctrl+V.', 'warning'); }
    });

    document.getElementById('lab-analyze-btn').addEventListener('click', analyzeWithAI);
    document.getElementById('lab-scan-live-btn').addEventListener('click', labLiveScan);
    document.getElementById('lab-download-zip-btn').addEventListener('click', downloadLabZip);
    document.getElementById('lab-check-improve-btn').addEventListener('click', () => {
      document.getElementById('lab-improve-panel').classList.remove('hidden');
      labImproveIdx = 0;
      renderLabImprovePanel();
    });

    // Improve panel nav
    document.getElementById('lab-improve-close').addEventListener('click', () =>
      document.getElementById('lab-improve-panel').classList.add('hidden'));
    document.getElementById('lab-improve-prev').addEventListener('click', () => {
      if (labImproveIdx > 0) { labImproveIdx--; renderLabImprovePanel(); }
    });
    document.getElementById('lab-improve-next').addEventListener('click', () => {
      if (labImproveIdx < labFileKeys.length - 1) { labImproveIdx++; renderLabImprovePanel(); }
    });
    document.getElementById('lab-improve-run-btn').addEventListener('click', improveCurrentFile);
    document.getElementById('lab-improve-accept-btn').addEventListener('click', acceptImprovedFile);
    document.getElementById('lab-improve-copy-btn').addEventListener('click', () => {
      const code = document.getElementById('lab-improve-code').value;
      navigator.clipboard.writeText(code).then(() => DSToast('📋 Copied!', 'success'));
    });

    // Load saved key
    chrome.storage.local.get('labGeminiKey').then(data => {
      if (data.labGeminiKey) document.getElementById('lab-gemini-key').value = data.labGeminiKey;
    });

    document.getElementById('lab-gemini-key').addEventListener('change', () => {
      chrome.storage.local.set({ labGeminiKey: document.getElementById('lab-gemini-key').value.trim() });
    });
  }

  async function analyzeWithAI() {
    const chatText = document.getElementById('lab-chat-input').value.trim();
    if (!chatText) { DSToast('Please paste chat content first', 'warning'); return; }

    const apiKey = document.getElementById('lab-gemini-key').value.trim() || DEFAULT_GEMINI_KEY;

    setLabProgress(true, 'Sending to Gemini AI for file analysis...');

    const prompt = `You are a code analysis expert. Analyze the following chat transcript between a developer and an AI assistant.

TASK: Identify ALL code files that were created/discussed. Extract the FINAL/LATEST version of each file.

RULES:
- If a file appears multiple times, ALWAYS keep only the LAST/MOST RECENT version
- Infer the correct file path from context (e.g. "sidebar.js" → "sidebar/sidebar.js", "manifest.json" → "manifest.json")
- Only include actual code files, not script outputs or logs
- Maintain the exact correct relative paths needed for the project to work

OUTPUT FORMAT (JSON only, no markdown, no explanation):
{
  "files": [
    { "path": "relative/path/to/file.ext", "content": "full file content here" }
  ]
}

CHAT TRANSCRIPT:
${chatText.slice(0, 50000)}`;

    try {
      const result = await callGeminiAPI(apiKey, prompt, 8192);
      const parsed = parseJSONFromAI(result);

      if (!parsed || !parsed.files || !Array.isArray(parsed.files)) {
        throw new Error('AI did not return expected file list format. Try again.');
      }

      labFiles = {};
      parsed.files.forEach(f => {
        if (f.path && f.content) {
          labFiles[f.path] = { content: f.content, improved: false, status: 'pending' };
        }
      });
      labFileKeys = Object.keys(labFiles);

      document.getElementById('lab-file-count').textContent = labFileKeys.length + ' files';
      document.getElementById('lab-files-section').classList.remove('hidden');
      renderLabFileList();
      setLabProgress(false);
      DSToast(`✅ Found ${labFileKeys.length} files!`, 'success');
    } catch (e) {
      setLabProgress(false);
      DSToast('❌ Analysis error: ' + e.message, 'error');
    }
  }

  function labLiveScan() {
    // Add all vault files to lab
    if (codeVault.length === 0) { DSToast('No files in vault. Scan the chat first.', 'warning'); return; }
    codeVault.forEach(b => {
      labFiles[b.filename] = { content: b.code, improved: false, status: 'pending' };
    });
    labFileKeys = Object.keys(labFiles);
    document.getElementById('lab-file-count').textContent = labFileKeys.length + ' files';
    document.getElementById('lab-files-section').classList.remove('hidden');
    renderLabFileList();
    DSToast(`⚡ Added ${labFileKeys.length} vault files to Lab`, 'success');
  }

  function renderLabFileList() {
    const container = document.getElementById('lab-file-list');
    if (labFileKeys.length === 0) { container.innerHTML = '<div class="empty-state-sm">No files identified yet.</div>'; return; }

    container.innerHTML = labFileKeys.map((path, i) => {
      const f = labFiles[path];
      const lines = (f.content || '').split('\n').length;
      const size = new Blob([f.content || '']).size;
      const statusIcon = f.improved ? '✅' : '⏳';
      const statusColor = f.improved ? '#3fb950' : '#8b949e';
      return `
        <div class="lab-file-item" style="border-left:2px solid ${statusColor};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-family:monospace;font-size:11px;color:#e6edf3;flex:1;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(path)}</span>
            <span style="font-size:10px;color:#8b949e;margin-left:8px;">${statusIcon}</span>
          </div>
          <div style="font-size:10px;color:#8b949e;margin-top:2px;">${lines} lines · ${formatBytes(size)}</div>
          <div style="display:flex;gap:4px;margin-top:4px;">
            <button class="btn-ghost btn-sm" onclick="window._labEditFile(${i})">✏ Edit</button>
            <button class="btn-ghost btn-sm" onclick="window._labImproveFile(${i})">✨ Improve</button>
            <button class="btn-ghost btn-sm" onclick="window._labRemoveFile(${i})">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    // Expose functions for inline handlers
    window._labEditFile = (i) => {
      labImproveIdx = i;
      document.getElementById('lab-improve-panel').classList.remove('hidden');
      renderLabImprovePanel();
    };
    window._labImproveFile = async (i) => {
      labImproveIdx = i;
      document.getElementById('lab-improve-panel').classList.remove('hidden');
      renderLabImprovePanel();
      await improveCurrentFile();
    };
    window._labRemoveFile = (i) => {
      const key = labFileKeys[i];
      delete labFiles[key];
      labFileKeys = Object.keys(labFiles);
      renderLabFileList();
      document.getElementById('lab-file-count').textContent = labFileKeys.length + ' files';
    };
  }

  function renderLabImprovePanel() {
    if (labFileKeys.length === 0) return;
    const key = labFileKeys[labImproveIdx];
    const f = labFiles[key];
    document.getElementById('lab-improve-file-label').textContent = key;
    document.getElementById('lab-improve-code').value = f.content || '';
    document.getElementById('lab-improve-status').textContent =
      f.improved ? '✅ Verified & improved by AI' : '⏳ Not yet verified';
    document.getElementById('lab-improve-status').style.color = f.improved ? '#3fb950' : '#8b949e';
    document.getElementById('lab-improve-prev').disabled = labImproveIdx === 0;
    document.getElementById('lab-improve-next').disabled = labImproveIdx === labFileKeys.length - 1;
  }

  async function improveCurrentFile() {
    const key = labFileKeys[labImproveIdx];
    const f = labFiles[key];
    const apiKey = document.getElementById('lab-gemini-key').value.trim() || DEFAULT_GEMINI_KEY;

    document.getElementById('lab-improve-run-btn').textContent = '⏳ Verifying...';
    document.getElementById('lab-improve-run-btn').disabled = true;
    document.getElementById('lab-improve-status').textContent = 'Sending to Gemini AI...';

    const prompt = `You are an expert software engineer. Review and improve this file.

FILE PATH: ${key}
CURRENT CONTENT:
\`\`\`
${f.content}
\`\`\`

OTHER FILES IN PROJECT:
${labFileKeys.filter(k => k !== key).map(k => `- ${k}`).join('\n')}

TASK:
1. Fix ALL syntax errors, bugs, and issues
2. Fix any import paths that might be wrong based on the project structure
3. Improve code quality, remove unused code
4. Make sure the file is complete and production-ready
5. Return ONLY the corrected file content, no explanations, no markdown code fences, just the raw code.`;

    try {
      const result = await callGeminiAPI(apiKey, prompt, 4096);
      // Strip markdown fences if any
      const cleaned = result.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      document.getElementById('lab-improve-code').value = cleaned;
      document.getElementById('lab-improve-status').textContent = '✨ AI improved — review and click Accept';
      document.getElementById('lab-improve-status').style.color = '#d29922';
    } catch (e) {
      document.getElementById('lab-improve-status').textContent = '❌ Error: ' + e.message;
      DSToast('❌ ' + e.message, 'error');
    }
    document.getElementById('lab-improve-run-btn').textContent = '✨ Verify & Improve';
    document.getElementById('lab-improve-run-btn').disabled = false;
  }

  function acceptImprovedFile() {
    const key = labFileKeys[labImproveIdx];
    labFiles[key].content = document.getElementById('lab-improve-code').value;
    labFiles[key].improved = true;
    labFiles[key].status = 'done';
    renderLabFileList();
    document.getElementById('lab-improve-status').textContent = '✅ Accepted!';
    document.getElementById('lab-improve-status').style.color = '#3fb950';
    DSToast('✅ File accepted: ' + key, 'success');
    // Auto advance
    if (labImproveIdx < labFileKeys.length - 1) {
      setTimeout(() => { labImproveIdx++; renderLabImprovePanel(); }, 800);
    }
  }

  async function downloadLabZip() {
    if (labFileKeys.length === 0) { DSToast('No files in Lab. Analyze a chat first.', 'warning'); return; }
    try {
      const zip = new JSZip();
      labFileKeys.forEach(path => {
        zip.file(path, labFiles[path].content || '');
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'deepseek-lab-project.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      DSToast(`📦 Downloaded ZIP with ${labFileKeys.length} files!`, 'success');
    } catch (e) {
      DSToast('❌ ZIP error: ' + e.message, 'error');
    }
  }

  function setLabProgress(active, text) {
    const el = document.getElementById('lab-progress');
    const barEl = document.getElementById('lab-progress-bar');
    const textEl = document.getElementById('lab-progress-text');
    if (active) {
      el.classList.remove('hidden');
      textEl.textContent = text || 'Analyzing...';
      let pct = 0;
      const timer = setInterval(() => {
        pct = Math.min(pct + 5, 90);
        barEl.style.width = pct + '%';
        if (pct >= 90) clearInterval(timer);
      }, 300);
      el._timer = timer;
    } else {
      if (el._timer) clearInterval(el._timer);
      barEl.style.width = '100%';
      setTimeout(() => { el.classList.add('hidden'); barEl.style.width = '0%'; }, 800);
    }
  }

  // ── EXPORT CENTER ──────────────────────────────────────────────────────────
  async function exportContent(format) {
    window.parent.postMessage({ type: 'DSC_GET_CONTENT', scope: document.querySelector('input[name="scope"]:checked')?.value || 'last' }, '*');
    await new Promise(r => setTimeout(r, 300));
    const text = lastContent || 'Content not available.';
    const title = 'DeepSeek Chat Export';
    const dateStr = new Date().toISOString().slice(0,10);

    if (format === 'pdf') {
      DSToast('📄 Generating PDF...', 'info');
      await generateAndDownloadPDF(text, title);
    } else if (format === 'docx') {
      DSToast('📝 Generating DOCX...', 'info');
      await generateDOCX(text, title);
    } else if (format === 'md') {
      const md = (typeof MarkdownExporter !== 'undefined') ? MarkdownExporter.export(text, title) : `# ${title}\n\n${text}`;
      downloadData(md, `${sanitizeFilename(title)}-${dateStr}.md`, 'text/markdown');
      DSToast('🗒 Markdown downloaded', 'success');
    } else if (format === 'txt') {
      downloadData(text, `${sanitizeFilename(title)}-${dateStr}.txt`, 'text/plain');
      DSToast('📋 Text downloaded', 'success');
    } else if (format === 'html') {
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:20px;line-height:1.6;color:#333;}pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;}</style></head><body><h1>${escapeHtml(title)}</h1>${text.replace(/\n/g,'<br>')}</body></html>`;
      downloadData(html, `${sanitizeFilename(title)}-${dateStr}.html`, 'text/html');
      DSToast('🌐 HTML downloaded', 'success');
    } else if (format === 'json') {
      const json = JSON.stringify({ title, date: new Date().toISOString(), content: text, codeFiles: codeVault.map(b => ({ filename: b.filename, lang: b.lang, code: b.code })) }, null, 2);
      downloadData(json, `${sanitizeFilename(title)}-${dateStr}.json`, 'application/json');
      DSToast('💾 JSON downloaded', 'success');
    }

    addExportHistory(format, title);
    renderExportHistory();
  }

  async function generateAndDownloadPDF(text, title) {
    try {
      const theme = document.getElementById('pdf-theme')?.value || 'deepblue';
      const options = {
        cover: document.getElementById('pdf-cover')?.checked !== false,
        toc: document.getElementById('pdf-toc')?.checked !== false,
        pageNumbers: document.getElementById('pdf-pagenum')?.checked !== false,
        syntaxHighlight: document.getElementById('pdf-syntax')?.checked !== false,
        theme
      };
      if (typeof PDFEngine !== 'undefined') await PDFEngine.generate(text, title, options);
      else { downloadData(text, sanitizeFilename(title) + '.txt', 'text/plain'); }
      DSToast('✅ PDF downloaded!', 'success');
    } catch (e) {
      DSToast('❌ PDF error: ' + e.message, 'error');
    }
  }

  async function generateDOCX(text, title) {
    try {
      if (typeof DOCXEngine !== 'undefined') await DOCXEngine.generate(text, title);
      else downloadData(text, sanitizeFilename(title) + '.txt', 'text/plain');
      DSToast('✅ DOCX downloaded!', 'success');
    } catch (e) {
      DSToast('❌ DOCX error: ' + e.message, 'error');
    }
  }

  function addExportHistory(format, title) {
    exportHistory.unshift({ format, title, date: Date.now() });
    if (exportHistory.length > 10) exportHistory.pop();
    chrome.storage.local.set({ exportHistory });
  }

  function renderExportHistory() {
    const el = document.getElementById('export-history');
    if (exportHistory.length === 0) { el.innerHTML = '<div class="empty-state-sm">No exports yet.</div>'; return; }
    const icons = { pdf:'📄', docx:'📝', md:'🗒', txt:'📋', html:'🌐', json:'💾', zip:'📦' };
    el.innerHTML = exportHistory.slice(0, 5).map(h => `
      <div class="export-history-item">
        <span>${icons[h.format] || '📄'}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.title)}</span>
        <span style="color:var(--text-secondary)">${formatDate(h.date)}</span>
      </div>
    `).join('');
  }

  // ── BOOKMARKS ─────────────────────────────────────────────────────────────
  function renderBookmarks() {
    const list = document.getElementById('bookmark-list');
    const countEl = document.getElementById('bookmark-count');
    const search = document.getElementById('bookmark-search').value.toLowerCase();
    const activeLabel = document.querySelector('.chip.active')?.dataset.label || 'all';
    const filtered = bookmarks.filter(b => {
      const matchSearch = !search || b.text?.toLowerCase().includes(search);
      const matchLabel = activeLabel === 'all' || b.label?.includes(activeLabel);
      return matchSearch && matchLabel;
    });
    countEl.textContent = bookmarks.length;
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">No bookmarks yet.<br>Hover a message and click 🔖</div>';
      return;
    }
    list.innerHTML = '';
    filtered.forEach((bm, i) => {
      const card = document.createElement('div');
      card.className = 'bookmark-card';
      card.style.borderLeftColor = getLabelColor(bm.label);
      card.innerHTML = `
        <div class="bookmark-card-label">
          <select class="label-select" data-idx="${i}">
            <option value="🔴 Important" ${bm.label === '🔴 Important' ? 'selected' : ''}>🔴 Important</option>
            <option value="🟡 Review Later" ${bm.label === '🟡 Review Later' ? 'selected' : ''}>🟡 Review Later</option>
            <option value="🟢 Working Solution" ${bm.label === '🟢 Working Solution' ? 'selected' : ''}>🟢 Working Solution</option>
            <option value="🔵 Code Snippet" ${bm.label === '🔵 Code Snippet' ? 'selected' : ''}>🔵 Code Snippet</option>
          </select>
        </div>
        <div class="bookmark-card-text">${escapeHtml((bm.text || '').slice(0, 200))}</div>
        <div class="bookmark-card-meta">${formatDate(bm.timestamp)}</div>
        <div class="bookmark-card-actions">
          <button class="btn-danger btn-sm" data-action="remove" data-idx="${i}">🗑 Remove</button>
        </div>
      `;
      card.querySelector('.label-select').addEventListener('change', (e) => {
        bookmarks[i].label = e.target.value;
        card.style.borderLeftColor = getLabelColor(e.target.value);
        saveBookmarks();
      });
      card.querySelector('[data-action="remove"]').addEventListener('click', () => {
        bookmarks.splice(i, 1); saveBookmarks(); renderBookmarks();
      });
      list.appendChild(card);
    });
  }

  function getLabelColor(label) {
    const map = { '🔴': '#f85149', '🟡': '#d29922', '🟢': '#3fb950', '🔵': '#2f81f7' };
    for (const [k,v] of Object.entries(map)) { if (label && label.startsWith(k)) return v; }
    return '#2f81f7';
  }

  async function saveBookmarks() {
    await chrome.storage.local.set({ bookmarks });
    window.parent.postMessage({ type: 'DSC_BOOKMARKS_UPDATED', bookmarks }, '*');
  }

  async function exportBookmarksPDF() {
    const text = bookmarks.map((b,i) => `### Bookmark ${i+1}: ${b.label}\n${b.text}\n`).join('\n---\n\n');
    await generateAndDownloadPDF(text, 'Bookmarks Summary');
  }

  // ── TEMPLATES ─────────────────────────────────────────────────────────────
  function renderTemplates() {
    const list = document.getElementById('template-list');
    const search = document.getElementById('template-search').value.toLowerCase();
    const cat = document.getElementById('template-cat').value;
    const filtered = templates.filter(t =>
      (!search || t.name.toLowerCase().includes(search) || t.text.toLowerCase().includes(search)) &&
      (cat === 'all' || t.category === cat)
    );
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">No templates found.<br>Click "+ New" to create one.</div>';
      return;
    }
    list.innerHTML = '';
    filtered.forEach(tpl => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `
        <div class="template-card-header">
          <span class="template-card-name">📋 ${escapeHtml(tpl.name)}</span>
          <span class="template-card-cat">${tpl.category}</span>
        </div>
        <div class="template-card-usage">Used ${tpl.usageCount || 0}×</div>
        <div class="template-card-preview">${escapeHtml(tpl.text.slice(0, 80))}...</div>
        <div class="template-card-actions">
          <button class="btn-primary btn-sm" data-action="use">▶ Use</button>
          <button class="btn-secondary btn-sm" data-action="edit">✏ Edit</button>
          <button class="btn-danger btn-sm" data-action="delete">🗑</button>
        </div>
      `;
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.action === 'use') useTemplate(tpl);
          else if (btn.dataset.action === 'edit') openTemplateEditor(tpl);
          else if (btn.dataset.action === 'delete') deleteTemplate(tpl.id);
        });
      });
      list.appendChild(card);
    });
  }

  function useTemplate(tpl) {
    const vars = tpl.variables || extractVars(tpl.text);
    if (vars.length > 0) openVarModal(tpl, vars);
    else {
      window.parent.postMessage({ type: 'DSC_INSERT_TEMPLATE', text: tpl.text }, '*');
      tpl.usageCount = (tpl.usageCount || 0) + 1;
      saveTemplates();
      DSToast('📝 Template inserted!', 'success');
    }
  }

  function extractVars(text) {
    const matches = text.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.slice(2,-2)))];
  }

  function openVarModal(tpl, vars) {
    const fields = document.getElementById('var-fields');
    fields.innerHTML = vars.map(v => `<div class="form-group"><label class="form-label">${v}</label><input class="form-input" id="var-${v}" placeholder="Enter ${v}..."></div>`).join('');
    document.getElementById('var-insert').onclick = () => {
      let text = tpl.text;
      vars.forEach(v => { text = text.replaceAll('{{' + v + '}}', document.getElementById('var-' + v)?.value || ''); });
      window.parent.postMessage({ type: 'DSC_INSERT_TEMPLATE', text }, '*');
      tpl.usageCount = (tpl.usageCount || 0) + 1;
      saveTemplates();
      closeModal('var-modal');
      DSToast('📝 Template inserted!', 'success');
    };
    openModal('var-modal');
  }

  function openTemplateEditor(tpl) {
    editingTemplateId = tpl ? tpl.id : null;
    document.getElementById('template-editor-title').textContent = tpl ? 'Edit Template' : 'New Template';
    document.getElementById('tpl-name').value = tpl ? tpl.name : '';
    document.getElementById('tpl-cat').value = tpl ? tpl.category : 'Development';
    document.getElementById('tpl-text').value = tpl ? tpl.text : '';
    openModal('template-editor');
  }

  function saveTemplate() {
    const name = document.getElementById('tpl-name').value.trim();
    const category = document.getElementById('tpl-cat').value;
    const text = document.getElementById('tpl-text').value.trim();
    if (!name || !text) { DSToast('Please fill all fields', 'warning'); return; }
    if (editingTemplateId) {
      const idx = templates.findIndex(t => t.id === editingTemplateId);
      if (idx >= 0) templates[idx] = { ...templates[idx], name, category, text, variables: extractVars(text) };
    } else {
      templates.push({ id: Date.now().toString(36), name, category, text, variables: extractVars(text), usageCount: 0 });
    }
    saveTemplates(); renderTemplates(); closeModal('template-editor');
    DSToast('✅ Template saved!', 'success');
  }

  function deleteTemplate(id) { templates = templates.filter(t => t.id !== id); saveTemplates(); renderTemplates(); }
  async function saveTemplates() { await chrome.storage.local.set({ templates }); }

  function importTemplates() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        if (Array.isArray(imported)) {
          templates = [...templates, ...imported];
          await saveTemplates(); renderTemplates();
          DSToast(`✅ Imported ${imported.length} templates`, 'success');
        }
      } catch { DSToast('Invalid JSON file', 'error'); }
    });
    input.click();
  }

  // ── GEMINI AI BRIDGE ──────────────────────────────────────────────────────
  function setupGeminiTab() {
    document.querySelectorAll('input[name="gmode"]').forEach(r => {
      r.addEventListener('change', () => {
        document.getElementById('translate-options').classList.toggle('hidden', r.value !== 'translate');
        document.getElementById('custom-prompt-area').classList.toggle('hidden', r.value !== 'custom');
      });
    });
    document.querySelectorAll('input[name="gsource"]').forEach(r => {
      r.addEventListener('change', () => document.getElementById('paste-area').classList.toggle('hidden', r.value !== 'paste'));
    });
    document.getElementById('btn-run-gemini').addEventListener('click', runGemini);
    document.getElementById('gemini-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('gemini-result').textContent).then(() => DSToast('📋 Copied!', 'success'));
    });
    document.getElementById('gemini-export-pdf').addEventListener('click', () =>
      generateAndDownloadPDF(document.getElementById('gemini-result').textContent, 'Gemini AI Response'));
    document.getElementById('gemini-export-md').addEventListener('click', () =>
      downloadData(document.getElementById('gemini-result').textContent, 'gemini-response.md', 'text/markdown'));
  }

  async function runGemini() {
    if (geminiRunning) return;
    const mode = document.querySelector('input[name="gmode"]:checked')?.value || 'reformat';
    const source = document.querySelector('input[name="gsource"]:checked')?.value || 'last';

    let content = source === 'paste' ? document.getElementById('paste-text').value.trim() : (lastContent || '');
    if (!content) { DSToast('Please provide content to process', 'warning'); return; }

    let systemPrompt = GEMINI_PROMPTS[mode] || GEMINI_PROMPTS.reformat;
    if (mode === 'translate') systemPrompt = `Translate the following text to ${document.getElementById('translate-lang').value}:`;
    else if (mode === 'custom') {
      systemPrompt = document.getElementById('custom-prompt').value.trim();
      if (!systemPrompt) { DSToast('Please enter a custom prompt', 'warning'); return; }
    }

    geminiRunning = true;
    document.getElementById('gemini-btn-text').textContent = 'Processing...';
    document.getElementById('gemini-spinner').classList.remove('hidden');
    document.getElementById('btn-run-gemini').disabled = true;
    document.getElementById('gemini-status').textContent = 'Thinking...';
    document.getElementById('gemini-result-area').classList.add('hidden');

    // Get API key
    const stored = await chrome.storage.local.get('userGeminiKey');
    const apiKey = stored.userGeminiKey || DEFAULT_GEMINI_KEY;

    try {
      const result = await callGeminiAPI(apiKey, `${systemPrompt}\n\n---\n\n${content}`, 4096);
      showGeminiResult(result);
    } catch (e) {
      showGeminiError(e.message);
    }
  }

  function showGeminiResult(result) {
    geminiRunning = false;
    document.getElementById('gemini-btn-text').textContent = '✨ Run with Gemini';
    document.getElementById('gemini-spinner').classList.add('hidden');
    document.getElementById('btn-run-gemini').disabled = false;
    document.getElementById('gemini-status').textContent = 'Done';
    document.getElementById('gemini-status').style.background = '#3fb950';
    document.getElementById('gemini-result').textContent = result;
    document.getElementById('gemini-result-area').classList.remove('hidden');
    DSToast('✨ Gemini response ready!', 'success');
  }

  function showGeminiError(error) {
    geminiRunning = false;
    document.getElementById('gemini-btn-text').textContent = '✨ Run with Gemini';
    document.getElementById('gemini-spinner').classList.add('hidden');
    document.getElementById('btn-run-gemini').disabled = false;
    document.getElementById('gemini-status').textContent = 'Error';
    document.getElementById('gemini-status').style.background = '#f85149';
    DSToast('❌ Gemini error: ' + error, 'error');
  }

  // ── GEMINI API CALL ────────────────────────────────────────────────────────
  async function callGeminiAPI(apiKey, prompt, maxTokens = 4096) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
  }

  function parseJSONFromAI(text) {
    // Strip markdown
    const cleaned = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    try { return JSON.parse(cleaned); }
    catch {
      // Try to extract JSON object/array
      const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (match) { try { return JSON.parse(match[1]); } catch {} }
      return null;
    }
  }

  // ── DEV TOOLS ─────────────────────────────────────────────────────────────
  function setupDevTools() {
    // Quick prompt buttons
    document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        window.parent.postMessage({ type: 'DSC_INSERT_TEMPLATE', text: prompt }, '*');
        DSToast('⚡ Prompt inserted into chat!', 'success');
      });
    });

    // Search
    document.getElementById('devtools-search-btn').addEventListener('click', searchInVault);
    document.getElementById('devtools-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchInVault(); });

    // Clipboard tools
    document.getElementById('devtools-copy-all-code').addEventListener('click', () => {
      const all = codeVault.map(b => `// === ${b.filename} ===\n${b.code}`).join('\n\n');
      navigator.clipboard.writeText(all).then(() => DSToast(`📋 Copied all ${codeVault.length} files!`, 'success'));
    });
    document.getElementById('devtools-copy-filenames').addEventListener('click', () => {
      const names = codeVault.map(b => b.filename).join('\n');
      navigator.clipboard.writeText(names).then(() => DSToast('📋 File names copied!', 'success'));
    });
    document.getElementById('devtools-copy-structure').addEventListener('click', () => {
      const tree = buildFileTree(codeVault.map(b => b.filename));
      navigator.clipboard.writeText(tree).then(() => DSToast('📋 File tree copied!', 'success'));
    });
    document.getElementById('devtools-export-json').addEventListener('click', () => {
      const json = JSON.stringify(codeVault.map(b => ({ filename: b.filename, lang: b.lang, lines: b.lineCount, size: b.size, code: b.code })), null, 2);
      downloadData(json, 'vault-export.json', 'application/json');
      DSToast('💾 Vault exported as JSON', 'success');
    });
  }

  function updateDevStats() {
    const total = codeVault.length;
    const size = codeVault.reduce((a, b) => a + (b.size || 0), 0);
    const langs = new Set(codeVault.map(b => b.lang).filter(Boolean)).size;
    const lines = codeVault.reduce((a, b) => a + (b.lineCount || 0), 0);
    const safe = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    safe('stat-total', total);
    safe('stat-size', formatBytes(size));
    safe('stat-langs', langs);
    safe('stat-lines', lines);
  }

  function searchInVault() {
    const query = document.getElementById('devtools-search-input').value.toLowerCase().trim();
    const results = document.getElementById('devtools-search-results');
    if (!query) { results.classList.add('hidden'); return; }

    const matches = codeVault.filter(b =>
      b.code?.toLowerCase().includes(query) || b.filename?.toLowerCase().includes(query)
    );

    results.classList.remove('hidden');
    if (matches.length === 0) {
      results.innerHTML = '<div style="color:#8b949e;font-size:12px;padding:8px;">No matches found.</div>';
      return;
    }
    results.innerHTML = matches.slice(0, 10).map(b => {
      const idx = b.code?.toLowerCase().indexOf(query);
      const snippet = idx >= 0 ? '...' + b.code.slice(Math.max(0, idx-30), idx+50).replace(/\n/g,' ') + '...' : '';
      return `<div class="search-result-item" onclick="window._vaultPreview('${escapeHtml(b.filename)}')">
        <div style="font-family:monospace;font-size:11px;color:#2f81f7;">${escapeHtml(b.filename)}</div>
        <div style="font-size:11px;color:#8b949e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(snippet)}</div>
      </div>`;
    }).join('');

    window._vaultPreview = (filename) => {
      const b = codeVault.find(x => x.filename === filename);
      if (b) showCodePreview(b);
    };
  }

  function buildFileTree(filenames) {
    const tree = {};
    filenames.forEach(name => {
      const parts = name.split('/');
      let node = tree;
      parts.forEach((part, i) => {
        if (!node[part]) node[part] = i === parts.length - 1 ? null : {};
        node = node[part] || {};
      });
    });
    function render(node, prefix = '') {
      return Object.entries(node).map(([k, v], i, arr) => {
        const isLast = i === arr.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        return prefix + connector + k + (v !== null ? '\n' + render(v, childPrefix) : '');
      }).join('\n');
    }
    return render(tree);
  }

  // ── QUICK SETTINGS ─────────────────────────────────────────────────────────
  async function loadQuickSettings() {
    const stored = await chrome.storage.local.get('quickSettings');
    const qs = stored.quickSettings || {};
    Object.entries(qs).forEach(([k, v]) => { const el = document.getElementById('s-' + k); if (el) el.checked = v; });
  }

  async function saveQuickSettings() {
    const qs = {};
    ['autodetect','dlbtn','toolbar','tables','bookmarks','dark','autoscroll'].forEach(k => {
      const el = document.getElementById('s-' + k);
      if (el) qs[k] = el.checked;
    });
    await chrome.storage.local.set({ quickSettings: qs });
    window.parent.postMessage({ type: 'DSC_SETTINGS_UPDATED', settings: qs }, '*');
  }

  // ── LOCAL DATA ─────────────────────────────────────────────────────────────
  async function loadLocalData() {
    const data = await chrome.storage.local.get(['bookmarks','templates','exportHistory','defaultContent','userGeminiKey']);
    bookmarks = data.bookmarks || [];
    templates = data.templates || getDefaultTemplates();
    exportHistory = data.exportHistory || [];
    lastContent = data.defaultContent || '';
    if (data.userGeminiKey) document.getElementById('gemini-api-key-input').value = data.userGeminiKey;
  }

  function getDefaultTemplates() {
    return [
      { id:'t1', name:'Code Review', category:'Development', text:'Review this code for bugs, security vulnerabilities, and performance issues. Provide specific fixes:\n\n{{code}}', variables:['code'], usageCount:0 },
      { id:'t2', name:'Explain Code', category:'Development', text:'Explain this code step by step for a junior developer:\n\n{{code}}', variables:['code'], usageCount:0 },
      { id:'t3', name:'Write Unit Tests', category:'Debugging', text:'Write comprehensive unit tests for this function:\n\n{{code}}', variables:['code'], usageCount:0 },
      { id:'t4', name:'Summarize', category:'Writing', text:'Summarize the following in 3-5 bullet points:\n\n{{text}}', variables:['text'], usageCount:0 },
      { id:'t5', name:'Translate to Urdu', category:'Writing', text:'Translate the following to Urdu while preserving technical terms:\n\n{{text}}', variables:['text'], usageCount:0 },
      { id:'t6', name:'Docker Setup', category:'DevOps', text:'Create a Dockerfile and docker-compose.yml for this project:\n\n{{description}}', variables:['description'], usageCount:0 },
    ];
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
  function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }
  function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function formatBytes(b) { if (!b) return '0 B'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }
  function formatDate(ts) { if (!ts) return ''; const d = new Date(ts); return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
  function sanitizeFilename(s) { return (s||'export').replace(/[^a-z0-9\-_]/gi,'-').slice(0,40); }
  function downloadData(data, filename, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.DSToast = function(msg, type) {
    let c = document.getElementById('dsc-sidebar-toasts');
    if (!c) {
      c = document.createElement('div'); c.id = 'dsc-sidebar-toasts';
      c.style.cssText = 'position:fixed;bottom:12px;left:8px;right:8px;z-index:9999;display:flex;flex-direction:column;gap:5px;';
      document.body.appendChild(c);
    }
    const t = document.createElement('div');
    const colors = { success:'#3fb950', error:'#f85149', warning:'#d29922', info:'#2f81f7' };
    t.style.cssText = `background:#161b22;color:#e6edf3;border-left:3px solid ${colors[type]||colors.info};border-radius:6px;padding:8px 12px;font-size:12px;animation:toastIn 0.2s ease;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
    t.textContent = msg;
    if (!document.getElementById('dsc-toast-kf')) {
      const s = document.createElement('style'); s.id = 'dsc-toast-kf';
      s.textContent = '@keyframes toastIn{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}';
      document.head.appendChild(s);
    }
    c.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };

  init().catch(console.error);
})();
