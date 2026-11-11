// engines/code-extractor.js — FIXED v1.0.2 (DeepSeek real DOM structure)
window.CodeExtractor = {

  extract(messageEl) {
    const blocks = DOMScanner.getCodeBlocks(messageEl);
    return blocks.map((block, idx) => {
      const fileInfo = FilenameDetector.detect(block.precedingText, block.lang, block.code);
      return {
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
        // preEl and blockDiv are DOM elements — kept for button injection only,
        // MUST be stripped before postMessage (done in syncSidebar via spread omit)
        preEl: block.pre,
        blockDiv: block.blockDiv || null
      };
    });
  },

  injectDownloadButton(preEl, fileInfo, code) {
    // Guard: don't inject twice
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
      'background:#2f81f7', 'color:white', 'border:none', 'border-radius:4px',
      'padding:3px 8px', 'cursor:pointer', 'display:inline-flex', 'align-items:center',
      'gap:4px', 'font-size:12px', 'margin-left:6px', 'transition:background 0.15s',
      'vertical-align:middle', 'flex-shrink:0'
    ].join(';');
    btn.addEventListener('mouseenter', () => btn.style.background = '#1a6cd4');
    btn.addEventListener('mouseleave', () => btn.style.background = '#2f81f7');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      DSHelpers.downloadBlob(code, fileInfo.filename, fileInfo.mimeType);
      DSToast('✅ Downloaded: ' + fileInfo.filename, 'success');
    });

    // FIXED: DeepSeek puts the banner (with language label + copy button)
    // in .md-code-block-banner-wrap, which is the previousElementSibling of <pre>.
    // Inject our button there, NOT inside <pre>.
    const bannerWrap = preEl.previousElementSibling;
    if (bannerWrap && bannerWrap.classList.contains('md-code-block-banner-wrap')) {
      bannerWrap.style.display = bannerWrap.style.display || 'flex';
      bannerWrap.style.alignItems = 'center';
      bannerWrap.appendChild(btn);
      return;
    }

    // Fallback: look for any header-like element inside the parent block div
    const blockDiv = preEl.closest('.md-code-block');
    if (blockDiv) {
      const header = blockDiv.querySelector('[class*="banner"], [class*="header"], [class*="toolbar"]');
      if (header) { header.appendChild(btn); return; }
    }

    // Last resort: insert a wrapper bar above <pre>
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;padding:4px 8px;background:rgba(47,129,247,0.08);border-radius:4px 4px 0 0;';
    wrapper.appendChild(btn);
    preEl.parentNode.insertBefore(wrapper, preEl);
  }
};
