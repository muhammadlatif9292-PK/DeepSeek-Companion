// utils/dom-scanner.js — v4.1 — Ground-truth selectors from real DeepSeek DOM
//
// CONFIRMED DeepSeek DOM structure (from diagnostic bash output):
//
//   div._4f9bf79._43c05b5                   ← outer turn wrapper
//     └── div.ds-message._63c77b1           ← message container (USE THIS)
//           └── div.ds-markdown             ← assistant markdown content
//                 └── div.md-code-block.md-code-block-light
//                       ├── div.md-code-block-banner-wrap  ← lang + buttons
//                       ├── pre                             ← code text directly
//                       └── svg
//
//   CONFIRMED FACTS:
//   - NO <main> element
//   - NO data-message-id attributes (count = 0)
//   - pre has NO <code> child — textContent lives directly in <pre>
//   - ds-message count = 11, ds-markdown count = 6
//   - Input box = div[contenteditable="true"] in DeepSeek

window.DOMScanner = {

  getRootContainer() {
    return document.getElementById('root') || document.body;
  },

  getMainScrollArea() {
    // DeepSeek has NO <main>. Find largest scrollable div in #root.
    const dsRoot = document.getElementById('root');
    const searchIn = dsRoot || document.body;
    const divs = Array.from(searchIn.querySelectorAll('div'));
    let best = null, bestH = 0;
    for (const d of divs) {
      if (d.scrollHeight <= d.clientHeight + 10) continue;
      const st = window.getComputedStyle(d);
      if ((st.overflowY === 'scroll' || st.overflowY === 'auto') && d.clientHeight > bestH) {
        bestH = d.clientHeight;
        best = d;
      }
    }
    return best || document.body;
  },

  // ── Code block extraction — uses CONFIRMED DeepSeek structure ──────────────
  getCodeBlocks(messageEl) {
    const root = messageEl || document;

    // PRIMARY: .md-code-block containers (confirmed real structure)
    const codeBlockDivs = Array.from(root.querySelectorAll('.md-code-block'));
    if (codeBlockDivs.length > 0) {
      return codeBlockDivs.map(block => {
        const pre = block.querySelector('pre');
        if (!pre) return null;
        const code = pre.textContent || '';
        if (!code.trim()) return null;

        // Language: in .md-code-block-banner-wrap, first short word-only text node
        let lang = '';
        const banner = block.querySelector('.md-code-block-banner-wrap');
        if (banner) {
          // Try direct text children of banner first
          for (const child of Array.from(banner.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
              const t = child.textContent.trim().toLowerCase();
              if (t && /^[a-z0-9+#._-]+$/.test(t) && t.length <= 20) { lang = t; break; }
            }
          }
          if (!lang) {
            // Try first span/div that has only text (no button/svg children)
            for (const el of Array.from(banner.querySelectorAll('span, div'))) {
              if (el.querySelector('button, svg, input')) continue;
              const t = el.textContent.trim().toLowerCase();
              if (t && /^[a-z0-9+#._-]+$/.test(t) && t.length >= 1 && t.length <= 20) {
                lang = t; break;
              }
            }
          }
        }

        const precedingText = DOMScanner.getPrecedingText(pre);
        return { pre, codeEl: null, lang, code, precedingText, blockDiv: block };
      }).filter(Boolean);
    }

    // FALLBACK: standard pre>code (other sites)
    return Array.from(root.querySelectorAll('pre')).map(pre => {
      const codeEl = pre.querySelector('code');
      const code = codeEl ? codeEl.textContent : pre.textContent;
      if (!code.trim()) return null;
      let lang = '';
      const cls = Array.from((codeEl || pre).classList).find(c => c.startsWith('language-'));
      if (cls) lang = cls.replace('language-', '');
      return { pre, codeEl, lang, code, precedingText: DOMScanner.getPrecedingText(pre), blockDiv: null };
    }).filter(Boolean);
  },

  getPrecedingText(preEl) {
    // Walk from message root, collect text that appears BEFORE preEl
    // Skip all code blocks (not just this one) to avoid polluting filename context
    const parent = preEl.closest('.ds-message') || preEl.parentElement;
    if (!parent) return '';
    const walker = document.createTreeWalker(
      parent,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node === preEl) return NodeFilter.FILTER_REJECT;
            if (node.tagName === 'PRE') return NodeFilter.FILTER_REJECT;
            if (node.classList && (
              node.classList.contains('md-code-block') ||
              node.classList.contains('md-code-block-banner-wrap')
            )) return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE && node === preEl) break;
      if (node.nodeType === Node.ELEMENT_NODE && preEl.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) break;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) texts.push(t);
      }
    }
    return texts.slice(-8).join(' ');
  },

  getMessageBlocks() {
    // Confirmed: DeepSeek uses .ds-message
    const msgs = Array.from(document.querySelectorAll('.ds-message'));
    if (msgs.length > 0) return msgs;
    return Array.from(document.querySelectorAll('[data-message-id]'));
  },

  isAssistantMessage(el) {
    // Assistant messages have .ds-markdown; user messages do not
    return !!el.querySelector('.ds-markdown');
  },

  // ── Input area — DeepSeek uses a contenteditable div ──────────────────────
  // The input box does NOT have a placeholder attribute directly on the
  // contenteditable element in some builds. Strategy: find visible
  // contenteditable that is NOT inside a code block.
  getInputTextarea() {
    // Strategy 1: contenteditable with common DeepSeek placeholder patterns
    const ce = document.querySelector(
      '[contenteditable="true"][placeholder*="Message"],' +
      '[contenteditable="true"][placeholder*="message"],' +
      '[contenteditable="true"][data-placeholder]'
    );
    if (ce && DOMScanner._isVisible(ce)) return ce;

    // Strategy 2: any visible contenteditable NOT inside .md-code-block
    const allCE = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    for (const el of allCE) {
      if (el.closest('.md-code-block')) continue;           // skip code blocks
      if (el.closest('.ds-message')) continue;              // skip message content
      if (!DOMScanner._isVisible(el)) continue;
      return el;
    }

    // Strategy 3: textarea (some DeepSeek builds)
    const ta = document.querySelector('textarea');
    if (ta && DOMScanner._isVisible(ta)) return ta;

    return null;
  },

  _isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0;
  },

  // ── Send button — found by position relative to input ─────────────────────
  // DeepSeek's send button: a round button containing an SVG, adjacent to the
  // input contenteditable, in the input toolbar area at the bottom of the page.
  // While generating: it becomes a "stop" square icon and may be the same button.
  findSendButton() {
    // FIX 1 (from analysis): search LOCAL to input area, not the whole viewport.
    // Searching the whole viewport hits DeepSeek's many other SVG buttons
    // (upload, voice, tools, stop, model-switch, attach) before the real send.
    //
    // Strategy:
    //   1. Find the input element
    //   2. Walk UP to find its container form/wrapper
    //   3. Search ONLY inside that container
    //   4. Pick the rightmost visible button with SVG (send is always rightmost)
    //   5. Fallback: bottom-right of viewport (if input not found)

    const input = DOMScanner.getInputTextarea();

    if (input) {
      // Walk up to find the input container — try several parent levels
      let container = input;
      for (let i = 0; i < 8; i++) {
        container = container.parentElement;
        if (!container) break;

        const btns = Array.from(container.querySelectorAll('button'));
        const visible = btns.filter(btn => {
          if (!DOMScanner._isVisible(btn)) return false;
          const r = btn.getBoundingClientRect();
          // Must be meaningful size and have an SVG child
          return r.width > 20 && r.height > 20 && btn.querySelector('svg');
        });

        // We want a small set — the input container has 2-5 buttons max
        // If we found 1-6 buttons, this is likely the right container level
        if (visible.length >= 1 && visible.length <= 8) {
          // Sort rightmost first — send button is always the rightmost
          visible.sort((a, b) =>
            b.getBoundingClientRect().right - a.getBoundingClientRect().right
          );
          return visible[0];
        }
        // Too many buttons = still too high up — keep walking up
      }
    }

    // Fallback: bottom 30% of viewport, rightmost SVG button
    const viewH = window.innerHeight;
    const all = Array.from(document.querySelectorAll('button')).filter(b => {
      if (!DOMScanner._isVisible(b)) return false;
      const r = b.getBoundingClientRect();
      return r.top > viewH * 0.70 && r.bottom <= viewH + 10 && b.querySelector('svg');
    });
    if (!all.length) return null;
    all.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    return all[0];
  },

  // ── Streaming detection — robust multi-method ─────────────────────────────
  isStreamingMessage() {
    // Method 1: aria-label (in case DeepSeek adds it)
    const ariaStop = document.querySelector('[aria-label="Stop generating"],[aria-label="Stop"]');
    if (ariaStop && DOMScanner._isVisible(ariaStop)) return true;

    // Method 2: send button disabled — DeepSeek disables it exactly while streaming
    // This is the most reliable signal we have from the real DOM structure.
    const sendBtn = DOMScanner.findSendButton();
    if (sendBtn && sendBtn.disabled) return true;

    // Method 3: explicit generating class indicators
    if (document.querySelector('.ds-generating,[data-generating="true"],[class*="generating"]')) return true;

    return false;
  },

  getAllAssistantMessages() {
    // Confirmed: assistant messages have .ds-markdown, user messages do not
    return Array.from(document.querySelectorAll('.ds-message')).filter(
      el => el.querySelector('.ds-markdown')
    );
  },

  getTables(messageEl) {
    return Array.from((messageEl || document).querySelectorAll('table'));
  }
};
