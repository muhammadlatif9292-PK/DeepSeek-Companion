// engines/code-extractor.js — King Edition v3.0.0
// KEY FIX: Filter out junk blocks (terminal commands, script outputs, tiny scripts)
window.CodeExtractor = {

  // Patterns that identify JUNK blocks to exclude from vault
  JUNK_PATTERNS: [
    // Very short bash/shell blocks that are terminal commands, not project files
    // A real project shell script has meaningful content (setup, build, deploy etc)
    // A junk script.sh is just 1-5 lines of `cd` / `ls` / `echo` / `cat` commands
    /^(cd |ls |cat |echo |pwd |mkdir |rm |cp |mv |touch |grep |find |tail |head |wc |curl |wget |chmod |chown )/m,
    // Output/log blocks (not code)
    /^(Output|Error|Result|---|\$\s)/m,
  ],

  // Content that is definitely a junk terminal snippet, not a project file
  isJunkBlock(lang, code, precedingText) {
    const trimmed = code.trim();
    const lines = trimmed.split('\n').filter(l => l.trim()).length;

    // Rule 1: bash/shell with ≤5 lines AND only terminal commands = junk
    if ((lang === 'bash' || lang === 'sh' || lang === 'shell') && lines <= 5) {
      const isOnlyCommands = trimmed.split('\n').every(line => {
        const l = line.trim();
        if (!l || l.startsWith('#')) return true;
        // These are terminal commands, not script content worth saving as a file
        return /^(cd |ls |cat |echo |pwd |mkdir |rm |cp |mv |touch |grep |find |tail |head |wc |curl |wget |chmod |chown |unzip |zip |npm |yarn |pip |python |node |npx |git |docker |sudo |export |source |\.\/|bash |sh )/.test(l);
      });
      if (isOnlyCommands) return true;
    }

    // Rule 2: output/log content that got detected as code
    if (!lang || lang === 'text' || lang === 'plaintext') {
      // If it looks like terminal output (starts with paths, errors, listing)
      if (/^(\/tmp\/|Output\s*$|Error:|Warning:|  inflating:|  adding:|  creating:)/m.test(trimmed)) return true;
    }

    // Rule 3: single-line trivial bash (e.g. just "echo done" or "ls -la")
    if (lines === 1 && (lang === 'bash' || lang === 'sh')) return true;

    return false;
  },

  extract(messageEl) {
    const blocks = DOMScanner.getCodeBlocks(messageEl);
    const seen = new Set(); // dedup identical code
    const result = [];

    blocks.forEach((block, idx) => {
      // Skip junk blocks
      if (this.isJunkBlock(block.lang, block.code, block.precedingText)) return;

      // Skip empty blocks
      if (!block.code || block.code.trim().length < 5) return;

      // Dedup exact content
      const codeHash = block.code.trim().slice(0, 200);
      if (seen.has(codeHash)) return;
      seen.add(codeHash);

      const fileInfo = FilenameDetector.detect(block.precedingText, block.lang, block.code);

      result.push({
        id: DSHelpers.generateId(),
        index: idx,
        lang: block.lang,
        code: block.code,
        filename: fileInfo.filename,
        extension: fileInfo.extension,
        mimeType: fileInfo.mimeType,
        confidence: fileInfo.confidence,
        lineCount: DSHelpers.countLines(block.code),
        size: new Blob([block.code]).size,
        timestamp: Date.now(),
        preEl: block.pre,
        blockDiv: block.blockDiv || null
      });
    });

    return result;
  },

  injectDownloadButton(preEl, fileInfo, code) {
    if (preEl.dataset.dscBtn) return;
    preEl.dataset.dscBtn = '1';

    const btn = document.createElement('button');
    btn.className = 'dsc-download-btn';
    btn.title = 'Download: ' + fileInfo.filename;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`;
    btn.style.cssText = [
      'background:#2f81f7','color:white','border:none','border-radius:4px',
      'padding:3px 8px','cursor:pointer','display:inline-flex','align-items:center',
      'gap:4px','font-size:12px','margin-left:6px','transition:background 0.15s',
      'vertical-align:middle','flex-shrink:0'
    ].join(';');
    btn.addEventListener('mouseenter', () => btn.style.background = '#1a6cd4');
    btn.addEventListener('mouseleave', () => btn.style.background = '#2f81f7');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      DSHelpers.downloadBlob(code, fileInfo.filename, fileInfo.mimeType);
      DSToast('✅ Downloaded: ' + fileInfo.filename, 'success');
    });

    const bannerWrap = preEl.previousElementSibling;
    if (bannerWrap && bannerWrap.classList.contains('md-code-block-banner-wrap')) {
      bannerWrap.style.display = bannerWrap.style.display || 'flex';
      bannerWrap.style.alignItems = 'center';
      bannerWrap.appendChild(btn);
      return;
    }

    const blockDiv = preEl.closest('.md-code-block');
    if (blockDiv) {
      const header = blockDiv.querySelector('[class*="banner"], [class*="header"], [class*="toolbar"]');
      if (header) { header.appendChild(btn); return; }
    }

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;padding:4px 8px;background:rgba(47,129,247,0.08);border-radius:4px 4px 0 0;';
    wrapper.appendChild(btn);
    preEl.parentNode.insertBefore(wrapper, preEl);
  }
};
