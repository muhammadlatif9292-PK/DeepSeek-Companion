(function() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('section-' + item.dataset.section)?.classList.add('active');
    });
  });

  // Range display
  document.querySelectorAll('input[type="range"]').forEach(r => {
    const valEl = document.getElementById(r.id + '-val');
    if (valEl) {
      r.addEventListener('input', () => { valEl.textContent = r.value + (r.id.includes('tokens') ? '' : (r.id.includes('duration') ? 's' : 'pt')); });
    }
  });

  // Theme picker
  document.querySelectorAll('.theme-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      document.getElementById('s-pdf-theme').value = opt.dataset.theme;
    });
  });
  document.querySelector('.theme-opt[data-theme="deepblue"]')?.classList.add('active');

  // Verify Gemini key
  document.getElementById('verify-gemini')?.addEventListener('click', async () => {
    const key = document.getElementById('s-gemini-key').value;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (r.ok) showStatus('✅ Gemini API key is valid!');
      else showStatus('❌ Invalid API key (HTTP ' + r.status + ')');
    } catch { showStatus('❌ Network error'); }
  });

  // Save settings
  document.getElementById('save-settings').addEventListener('click', saveAll);

  // Load settings
  loadAll();

  // Help
  document.getElementById('open-help-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
  });

  // Reset
  document.getElementById('reset-all')?.addEventListener('click', () => {
    if (confirm('Reset all settings to defaults?')) {
      chrome.storage.sync.clear(() => { chrome.storage.local.clear(() => { location.reload(); }); });
    }
  });

  // Export/clear buttons
  document.getElementById('export-bookmarks-btn')?.addEventListener('click', async () => {
    const d = await chrome.storage.local.get('bookmarks');
    downloadJSON(d.bookmarks || [], 'bookmarks.json');
  });
  document.getElementById('clear-bookmarks-btn')?.addEventListener('click', () => {
    if (confirm('Delete all bookmarks?')) chrome.storage.local.remove('bookmarks', () => showStatus('Bookmarks cleared'));
  });
  document.getElementById('export-templates-btn')?.addEventListener('click', async () => {
    const d = await chrome.storage.local.get('templates');
    downloadJSON(d.templates || [], 'templates.json');
  });
  document.getElementById('clear-templates-btn')?.addEventListener('click', () => {
    if (confirm('Delete all templates?')) chrome.storage.local.remove('templates', () => showStatus('Templates cleared'));
  });

  function getAllSettings() {
    const get = id => document.getElementById(id);
    const radioVal = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
    return {
      language: get('s-language')?.value,
      autorun: get('s-autorun')?.checked,
      notifications: get('s-notifications')?.checked,
      notifDuration: get('s-notif-duration')?.value,
      codeAutodetect: get('s-code-autodetect')?.checked,
      codeDlBtn: get('s-code-dlbtn')?.checked,
      codeDefaultName: get('s-code-default-name')?.value,
      fnameFallback: radioVal('fname-fallback'),
      zipOrg: radioVal('zip-org'),
      zipReadme: get('s-zip-readme')?.checked,
      pdfTheme: get('s-pdf-theme')?.value,
      pdfSize: get('s-pdf-size')?.value,
      pdfBodyFs: get('s-pdf-body-fs')?.value,
      pdfCodeFs: get('s-pdf-code-fs')?.value,
      pdfCover: get('s-pdf-cover')?.checked,
      pdfToc: get('s-pdf-toc')?.checked,
      pdfPagenum: get('s-pdf-pagenum')?.checked,
      pdfSyntax: get('s-pdf-syntax')?.checked,
      pdfLineno: get('s-pdf-lineno')?.checked,
      docxPrimary: get('s-docx-primary')?.value,
      docxFont: get('s-docx-font')?.value,
      docxMargins: get('s-docx-margins')?.value,
      docxCode: get('s-docx-code')?.checked,
      docxAutofit: get('s-docx-autofit')?.checked,
      defaultFormat: radioVal('def-format'),
      fnameTitle: get('s-fname-title')?.checked,
      fnameDate: get('s-fname-date')?.checked,
      bmHover: get('s-bm-hover')?.checked,
      bmBorder: get('s-bm-border')?.checked,
      bmAutocode: get('s-bm-autocode')?.checked,
      tplShow: get('s-tpl-show')?.checked,
      geminiMode: get('s-gemini-mode')?.value,
      maxTokens: get('s-max-tokens')?.value,
      panelTheme: radioVal('panel-theme'),
      accentColor: get('s-accent-color')?.value,
      toolbarVis: radioVal('toolbar-vis'),
      animSpeed: radioVal('anim-speed'),
    };
  }

  async function saveAll() {
    const settings = getAllSettings();
    await chrome.storage.sync.set({ settings });
    showStatus('✅ Settings saved!');
  }

  async function loadAll() {
    const d = await chrome.storage.sync.get('settings');
    const s = d.settings || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
    const setRadio = (name, val) => { const el = document.querySelector(`input[name="${name}"][value="${val}"]`); if (el) el.checked = true; };

    set('s-language', s.language); set('s-autorun', s.autorun); set('s-notifications', s.notifications);
    set('s-code-autodetect', s.codeAutodetect); set('s-code-dlbtn', s.codeDlBtn);
    set('s-pdf-theme', s.pdfTheme); set('s-pdf-size', s.pdfSize);
    set('s-pdf-cover', s.pdfCover); set('s-pdf-toc', s.pdfToc); set('s-pdf-pagenum', s.pdfPagenum);
    set('s-pdf-syntax', s.pdfSyntax); set('s-docx-code', s.docxCode);
    set('s-fname-title', s.fnameTitle); set('s-fname-date', s.fnameDate);
    set('s-accent-color', s.accentColor);

    if (s.pdfTheme) {
      document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
      document.querySelector(`.theme-opt[data-theme="${s.pdfTheme}"]`)?.classList.add('active');
    }
    if (s.fnameFallback) setRadio('fname-fallback', s.fnameFallback);
    if (s.defaultFormat) setRadio('def-format', s.defaultFormat);
    if (s.panelTheme) setRadio('panel-theme', s.panelTheme);
    if (s.toolbarVis) setRadio('toolbar-vis', s.toolbarVis);
    if (s.animSpeed) setRadio('anim-speed', s.animSpeed);
  }

  function showStatus(msg) {
    const el = document.getElementById('save-status');
    if (el) { el.textContent = msg; setTimeout(() => el.textContent = '', 3000); }
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
