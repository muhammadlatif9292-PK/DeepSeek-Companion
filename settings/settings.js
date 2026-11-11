// settings.js — DeepSeek Companion Pro v4.0
(function () {
  // ── NAVIGATION ─────────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('section-' + item.dataset.section)?.classList.add('active');
    });
  });

  // ── RANGE DISPLAY ──────────────────────────────────────────────────────────
  document.querySelectorAll('input[type="range"]').forEach(r => {
    const valEl = document.getElementById(r.id + '-val');
    if (valEl) {
      const fmt = v => r.id.includes('duration') ? v + 's' : v + 'pt';
      r.addEventListener('input', () => valEl.textContent = fmt(r.value));
      valEl.textContent = fmt(r.value);
    }
  });

  // ── THEME PICKER ───────────────────────────────────────────────────────────
  document.querySelectorAll('.theme-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      document.getElementById('s-pdf-theme').value = opt.dataset.theme;
    });
  });

  // ── SAVE ───────────────────────────────────────────────────────────────────
  document.getElementById('save-settings').addEventListener('click', saveAll);
  document.getElementById('open-help-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
  });
  document.getElementById('reset-all')?.addEventListener('click', () => {
    if (confirm('Reset all settings to defaults?')) {
      chrome.storage.local.clear(() => location.reload());
    }
  });
  document.getElementById('clear-export-history')?.addEventListener('click', () => {
    chrome.storage.local.remove('exportHistory', () => showStatus('✅ Export history cleared'));
  });

  // ── LOAD / SAVE ────────────────────────────────────────────────────────────
  function get(id) { return document.getElementById(id); }
  function radioVal(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
  function setRadio(name, val) {
    const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
  }

  function getAllSettings() {
    return {
      autorun:       get('s-autorun')?.checked,
      notifications: get('s-notifications')?.checked,
      notifDuration: get('s-notif-duration')?.value,
      mutation:      get('s-mutation')?.checked,
      codeDlbtn:     get('s-code-dlbtn')?.checked,
      codeJunk:      get('s-code-junk')?.checked,
      codeDefaultName: get('s-code-default-name')?.value,
      zipOrg:        radioVal('zip-org'),
      zipReadme:     get('s-zip-readme')?.checked,
      pdfTheme:      get('s-pdf-theme')?.value,
      pdfSize:       get('s-pdf-size')?.value,
      pdfBodyFs:     get('s-pdf-body-fs')?.value,
      pdfCodeFs:     get('s-pdf-code-fs')?.value,
      pdfCover:      get('s-pdf-cover')?.checked,
      pdfToc:        get('s-pdf-toc')?.checked,
      pdfPagenum:    get('s-pdf-pagenum')?.checked,
      pdfSyntax:     get('s-pdf-syntax')?.checked,
      pdfLineno:     get('s-pdf-lineno')?.checked,
      docxPrimary:   get('s-docx-primary')?.value,
      docxFont:      get('s-docx-font')?.value,
      docxMargins:   get('s-docx-margins')?.value,
      docxCode:      get('s-docx-code')?.checked,
      docxAutofit:   get('s-docx-autofit')?.checked,
      defFormat:     radioVal('def-format'),
      fnameDate:     get('s-fname-date')?.checked,
      fnameTitle:    get('s-fname-title')?.checked,
      sidebarWidth:  get('s-sidebar-width')?.value,
      accentColor:   get('s-accent-color')?.value,
      toolbarVis:    radioVal('toolbar-vis'),
    };
  }

  function applySettings(s) {
    if (!s) return;
    const cb = (id, val) => { const el = get(id); if (el && val != null) el.checked = val; };
    const sv = (id, val) => { const el = get(id); if (el && val != null) el.value = val; };
    cb('s-autorun',    s.autorun);
    cb('s-notifications', s.notifications);
    sv('s-notif-duration', s.notifDuration);
    cb('s-mutation',   s.mutation);
    cb('s-code-dlbtn', s.codeDlbtn);
    cb('s-code-junk',  s.codeJunk);
    sv('s-code-default-name', s.codeDefaultName);
    if (s.zipOrg) setRadio('zip-org', s.zipOrg);
    cb('s-zip-readme', s.zipReadme);
    sv('s-pdf-theme',  s.pdfTheme);
    sv('s-pdf-size',   s.pdfSize);
    sv('s-pdf-body-fs', s.pdfBodyFs);
    sv('s-pdf-code-fs', s.pdfCodeFs);
    cb('s-pdf-cover',  s.pdfCover);
    cb('s-pdf-toc',    s.pdfToc);
    cb('s-pdf-pagenum', s.pdfPagenum);
    cb('s-pdf-syntax', s.pdfSyntax);
    cb('s-pdf-lineno', s.pdfLineno);
    sv('s-docx-primary', s.docxPrimary);
    sv('s-docx-font',  s.docxFont);
    sv('s-docx-margins', s.docxMargins);
    cb('s-docx-code',  s.docxCode);
    cb('s-docx-autofit', s.docxAutofit);
    if (s.defFormat) setRadio('def-format', s.defFormat);
    cb('s-fname-date', s.fnameDate);
    cb('s-fname-title', s.fnameTitle);
    sv('s-sidebar-width', s.sidebarWidth);
    sv('s-accent-color', s.accentColor);
    if (s.toolbarVis) setRadio('toolbar-vis', s.toolbarVis);
    // Activate correct theme swatch
    if (s.pdfTheme) {
      document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
      document.querySelector(`.theme-opt[data-theme="${s.pdfTheme}"]`)?.classList.add('active');
    }
    // Update range displays
    document.querySelectorAll('input[type="range"]').forEach(r => {
      const valEl = document.getElementById(r.id + '-val');
      if (valEl) valEl.textContent = r.value + (r.id.includes('duration') ? 's' : 'pt');
    });
  }

  function saveAll() {
    const s = getAllSettings();
    chrome.storage.local.set({ dscSettings: s }, () => showStatus('✅ Saved!'));
  }

  function loadAll() {
    chrome.storage.local.get('dscSettings', d => applySettings(d.dscSettings));
  }

  function showStatus(msg) {
    const el = document.getElementById('save-status');
    if (el) { el.textContent = msg; setTimeout(() => el.textContent = '', 3000); }
  }

  loadAll();
})();
