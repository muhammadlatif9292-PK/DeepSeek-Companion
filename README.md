# DeepSeek Companion Pro (v6.0.0)

> **Smart Code Vault, Binary-Safe ZIP Patcher, Zone Range Scoping, Lexical Send Engine v5 (Auto-Proceed), and Multi-Format Chat Exporter for [chat.deepseek.com](https://chat.deepseek.com).**

DeepSeek Companion Pro is a lightweight, zero-external-API Chrome Extension (**Manifest V3**) tailored specifically to DeepSeek's real React / Lexical DOM structure (`.ds-message`, `.ds-markdown`, `.md-code-block`).

---

## Key Features

### Smart Code Vault & Line-1 Path Extraction
- **Fast Deep Scan (`requestAnimationFrame` + `IntersectionObserver`)**: Automatically collects lazy-loaded code blocks across long DeepSeek sessions while staying responsive.
- **6-Level Filename & Path Detection**: Detects paths from Line-1 comments (`// src/app/page.tsx`, `# scripts/setup.sh`, `/* styles.css */`, `<!-- index.html -->`), surrounding markdown context, language tags, and content heuristics.
- **Version Resolution & Junk Filtering**: Keeps only the **latest occurrence** of each file path when DeepSeek revises a file across replies, deduplicates anonymous snippets by content fingerprint, and filters out trivial terminal commands (`ls`, `cd`, `npm run`, build logs).
- **Per-Block & Floating Message Toolbars**: Injects one-click file download buttons directly into DeepSeek's `.md-code-block-banner-wrap` headers plus hover toolbars (`Code`, `PDF`, `MD`) on each message.

### Binary-Safe ZIP Patcher (`engines/zip-patcher.js`)
- Upload an existing project `.zip` archive and merge updated/new files from the Code Vault.
- Copies untouched ZIP entries as raw `uint8array` bytes so images, fonts, binaries, and compression metadata remain intact without UTF-8 corruption.
- Produces a granular patch diff report (`added`, `replaced`, `unchanged`, `skipped`).

### Zone Selector (`🎯 Zone`)
- Restricts scanning, Vault indexing, ZIP creation, and chat exports (`Last response only` or `Entire conversation`) to an explicit `[START -> END]` message range via click-to-select, manual 1-based numbering, or quick presets (`Last 5/10/20`, `First 10`).

### Send Engine v5 & Auto-Proceed (`PROCEED` Watcher)
- **Lexical/React Input Injection**: Dispatches the proper `focus -> selectionchange -> beforeinput -> execCommand('insertText') -> Range fallback -> input/change/keyup` sequence required by DeepSeek's `[contenteditable="true"]` editor, paired with proximity send-button discovery, pointer/mouse dispatch, streaming verification, and 3x retry.
- **Auto Continue**: Monitors completed assistant replies for a trailing `PROCEED` marker and automatically submits `"continue"` across multi-wave code generations.
- **Built-in DSC Prompt Templates & Quick Prompts**: One-click insertion of Full / Short / Rules prompts plus 12 developer quick-action prompts (`Code Review`, `Write Tests`, `Refactor`, `To TypeScript`, etc.).

### Multi-Format Export (`PDF`, `DOCX`, `Markdown`, `Plain Text`, `ZIP`)
- **PDF (`engines/pdf-engine.js`)**: Themes (*DeepBlue*, *Obsidian*, *Scholar*, *Emerald*), cover page, automatic table of contents, callouts, tables, code blocks, and page footers via `jsPDF`.
- **DOCX (`engines/docx-engine.js`)**: Pure OpenXML `.docx` archive compilation with styled headings, bullet/numbered lists, callouts, dark-styled code blocks, and tables.
- **Markdown & Text**: Clean Markdown frontmatter export and HTML-stripped plain text export.

---

## Repository Structure

```text
DeepSeek-Companion/
├── .github/workflows/ci.yml      # Automated CI verification workflow
├── assets/
│   ├── icons/                    # 16px, 48px, 128px PNG icons
│   └── logo.svg                  # Vector logo
├── docs/                         # Build & fix notes (FIXES_APPLIED, FINAL_FIXES, SEND_FIX_v5)
├── engines/
│   ├── code-extractor.js         # Code extraction and banner download button injection
│   ├── docx-engine.js            # Pure OpenXML DOCX compiler
│   ├── filename-detector.js      # 6-level filename & path heuristic engine
│   ├── markdown-exporter.js      # Markdown frontmatter exporter
│   ├── pdf-engine.js             # jsPDF themed document compiler
│   ├── text-structurizer.js      # Markdown structure parser for PDF/DOCX
│   └── zip-patcher.js            # Raw uint8array binary-safe ZIP merger
├── help/
│   ├── DSC_PROMPT.md             # DeepSeek AI coding prompt reference
│   ├── help.css
│   └── help.html
├── libs/                         # Bundled client-side libraries (DOMPurify, jsPDF, JSZip, marked)
├── popup/                        # Toolbar popup showing DeepSeek status, Vault Files & Exports
├── settings/                     # Extension options page
├── sidebar/                      # Isolated iframe UI (Vault, Export, Patcher, Zone, Dev)
├── tests/
│   └── run-ci.mjs                # Automated MV3, unit & integration verification suite
├── utils/                        # DOM scanner, helpers, language registry, storage & toast UI
├── background.js                 # MV3 service worker (ZIP base64 data URI & PDF relay)
├── content.js                    # Content script (Send Engine v5, scanner, Zone, Auto-Proceed)
├── manifest.json                 # Chrome Extension Manifest V3 configuration
└── package.json                  # Test script entry (`npm test`)
```

---

## Installation & Verification

### Running Unpacked in Chromium Browsers

1. Clone the repository:
   ```bash
   git clone https://github.com/muhammadlatif9292-PK/DeepSeek-Companion.git
   ```
2. Open `chrome://extensions` (or `edge://extensions` / `brave://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the cloned `DeepSeek-Companion` directory.
5. Open [chat.deepseek.com](https://chat.deepseek.com).

### Running Automated Verification Tests

Requires Node.js >= 18 (zero external packages required):

```bash
npm test
```

The test suite validates Manifest V3 consistency, JavaScript syntax across all extension scripts, MV3 Service Worker `EXPORT_ZIP`/`EXPORT_PDF` execution (ensuring no `URL.createObjectURL` usage), DOM scanner & Code Extractor behavior, FilenameDetector heuristics, TextStructurizer parsing, binary-preserving ZipPatcher roundtrips, HTML/JS ID wiring, Send Engine v5 event ordering, and Sidebar/Content Export flows.

---

## Permissions Disclosure

- `storage`: Persists export history, settings, and popup summary counters in `chrome.storage.local`.
- `downloads`: Downloads generated `.zip`, `.pdf`, `.docx`, `.md`, and `.txt` files.
- `activeTab` / `scripting` / `tabs`: Allows popup sidebar toggle and opening help/settings tabs.
- `clipboardWrite`: Copies extracted code snippets, file trees, and AI prompts to clipboard.
- Host permission `https://chat.deepseek.com/*`: Enables DeepSeek Chat DOM integration.

---

## Attribution

Designed and maintained by **Muhammad Hamad Latif** (`muhammadlatif9292@gmail.com`).
