// utils/dom-scanner.js — FIXED v1.0.2 (DeepSeek real DOM structure)
//
// ACTUAL DeepSeek structure (confirmed by diagnostic):
//   div.md-code-block.md-code-block-light
//     ├── div.md-code-block-banner-wrap   ← language label + copy button
//     ├── pre                             ← RAW code text, NO <code> child!
//     └── svg
//
//   div._4f9bf79._43c05b5                 ← outer wrapper
//     └── div.ds-message._63c77b1         ← message container  ✓ USE THIS
//           └── div.ds-markdown           ← markdown content
//                 └── div.md-code-block   ← code block
//
//   NOTE: DeepSeek has NO <main> element and NO data-message-id attributes.

window.DOMScanner = {

  getRootContainer() {
    return document.getElementById('root') || document.body;
  },

  getMainScrollArea() {
    // DeepSeek has NO <main> element — skip that check entirely.
    // Find the chat scroll container by DeepSeek-specific structure first.
    const dsRoot = document.getElementById('root');
    if (dsRoot) {
      // Largest scrollable div inside #root
      const divs = Array.from(dsRoot.querySelectorAll('div'));
      let best = null, bestH = 0;
      divs.forEach(d => {
        const st = window.getComputedStyle(d);
        if ((st.overflowY === 'scroll' || st.overflowY === 'auto') && d.clientHeight > bestH) {
          bestH = d.clientHeight;
          best = d;
        }
      });
      if (best) return best;
    }
    // Generic fallback
    const divs = Array.from(document.querySelectorAll('div'));
    let best = null, bestH = 0;
    divs.forEach(d => {
      const st = window.getComputedStyle(d);
      if ((st.overflowY === 'scroll' || st.overflowY === 'auto') && d.clientHeight > bestH) {
        bestH = d.clientHeight;
        best = d;
      }
    });
    return best || document.body;
  },

  // ── CORE: Extract code blocks using DeepSeek's real DOM structure ──────────
  getCodeBlocks(messageEl) {
    const root = messageEl || document;

    // PRIMARY PATH: DeepSeek's .md-code-block containers
    // Structure: .md-code-block > [.md-code-block-banner-wrap, pre, svg]
    // The <pre> has raw code text DIRECTLY — there is NO <code> child element.
    const codeBlockDivs = Array.from(root.querySelectorAll('.md-code-block'));

    if (codeBlockDivs.length > 0) {
      return codeBlockDivs.map(block => {
        const pre = block.querySelector('pre');
        if (!pre) return null;

        const code = pre.textContent || pre.innerText || '';
        if (!code.trim()) return null;

        // Language is in the banner-wrap (the prevSibling of <pre>)
        let lang = '';
        const banner = block.querySelector('.md-code-block-banner-wrap');
        if (banner) {
          // Banner typically has: [language-span] [copy-btn] [other-btns]
          // Get the first text node / span that looks like a language name
          const allEls = Array.from(banner.querySelectorAll('*'));
          for (const el of allEls) {
            // Skip elements that contain buttons or have many children (they're toolbars)
            if (el.querySelector('button, svg') || el.children.length > 2) continue;
            const txt = el.textContent.trim().toLowerCase();
            if (txt && /^[a-z0-9+#._-]+$/.test(txt) && txt.length >= 1 && txt.length <= 20) {
              lang = txt;
              break;
            }
          }
          // Fallback: scan text nodes in banner directly
          if (!lang) {
            const walker = document.createTreeWalker(banner, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              const txt = node.textContent.trim().toLowerCase();
              if (txt && /^[a-z0-9+#._-]+$/.test(txt) && txt.length >= 1 && txt.length <= 20) {
                lang = txt;
                break;
              }
            }
          }
        }

        const precedingText = DOMScanner.getPrecedingText(pre);
        return { pre, codeEl: null, lang, code, precedingText, blockDiv: block };
      }).filter(Boolean);
    }

    // FALLBACK PATH: standard <pre><code> for other sites / future-proofing
    return Array.from(root.querySelectorAll('pre')).map(pre => {
      const codeEl = pre.querySelector('code');
      const code = codeEl ? (codeEl.textContent || '') : (pre.textContent || '');
      if (!code.trim()) return null;

      let lang = '';
      if (codeEl) {
        const cls = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
        if (cls) lang = cls.replace('language-', '');
      }
      if (!lang) {
        const cls = Array.from(pre.classList).find(c => c.startsWith('language-'));
        if (cls) lang = cls.replace('language-', '');
      }
      const precedingText = DOMScanner.getPrecedingText(pre);
      return { pre, codeEl, lang, code, precedingText, blockDiv: null };
    }).filter(Boolean);
  },

  getPrecedingText(preEl) {
    const parent = preEl.closest('.ds-message') ||
                   preEl.closest('[data-message-id]') ||
                   preEl.parentElement;
    if (!parent) return '';
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let texts = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node === preEl || preEl.contains(node)) break;
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        texts.push(node.textContent.trim());
      }
    }
    return texts.slice(-5).join(' ');
  },

  // Returns all DeepSeek message containers
  getMessageBlocks() {
    // DeepSeek uses .ds-message as the message container class
    const msgs = Array.from(document.querySelectorAll('.ds-message'));
    if (msgs.length > 0) return msgs;
    // Fallback
    return Array.from(document.querySelectorAll('[data-message-id]'));
  },

  isAssistantMessage(el) {
    // DeepSeek assistant messages contain .ds-markdown
    if (el.querySelector('.ds-markdown')) return true;
    const hasActionBar = el.querySelector('button[aria-label="Copy"]') ||
      Array.from(el.querySelectorAll('button')).some(b =>
        b.textContent.trim() === 'Copy' || b.getAttribute('aria-label') === 'Regenerate');
    return hasActionBar;
  },

  getInputTextarea() {
    return document.querySelector('textarea[placeholder*="Message"]') ||
           document.querySelector('textarea[placeholder*="message"]') ||
           document.querySelector('textarea') ||
           document.querySelector('[contenteditable="true"]');
  },

  getTables(messageEl) {
    return Array.from((messageEl || document).querySelectorAll('table'));
  },

  isStreamingMessage() {
    // Exact match only + visibility check to avoid false positives
    const ariaStop = document.querySelector(
      '[aria-label="Stop generating"], [aria-label="Stop"], [data-testid="stop-button"]'
    );
    if (ariaStop && ariaStop.offsetParent !== null) return true;

    for (const btn of document.querySelectorAll('button')) {
      const text = btn.textContent.trim();
      if ((text === 'Stop' || text === 'Stop generating') && btn.offsetParent !== null) {
        return true;
      }
    }
    return false;
  },

  getAllAssistantMessages() {
    return Array.from(document.querySelectorAll('.ds-message')).filter(
      el => el.querySelector('.ds-markdown, pre, p')
    );
  }
};
