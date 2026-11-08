# DeepSeek Companion — King Edition (v3.0.0)

> **The ultimate developer power tool for DeepSeek Chat: Smart Code Vault, AI-powered file management, Gemini Bridge, multi-format export, bookmarks, and productivity workflows.**

DeepSeek Companion is a feature-rich, high-performance browser extension built on Chrome Extension **Manifest V3**. It seamlessly integrates into [chat.deepseek.com](https://chat.deepseek.com) to automate code extraction, multi-format documentation exports, and AI-assisted workflows.

---

## 🚀 Key Features

### 🧠 Smart Code Vault & Instant Bulk Extractor
- **Instant Scan**: Scans DeepSeek conversations instantly to capture every code block without requiring slow manual scrolling.
- **Filename & Path Auto-Detection**: Intelligently detects filenames from code comments, Markdown titles, or code structure (e.g. `src/components/Header.tsx`).
- **Junk Filtering**: Automatically filters out ephemeral shell commands (`run.sh`, `output.txt`, single command prompts) to retain only meaningful production code.
- **Language Detection**: Robust language mapping across TypeScript, Python, Rust, Go, JavaScript, C++, Dart, SQL, and 40+ other languages.

### 📦 Multi-Format Export Engine
- **Structured Project ZIP**: Generates downloadable project zip files preserving folder hierarchies, complete with an auto-generated project `README.md`.
- **Publication-Ready PDF**: Compiles full chats or selected code blocks into clean PDFs with customizable themes (*Deep Blue*, *Midnight Dark*, *Minimalist Light*).
- **DOCX Word Documents**: Clean document layout compilation for reports and documentation sharing.
- **Markdown & Excel**: Exports conversation logs, prompt templates, and code catalogs into standard `.md` or `.xlsx` files.

### ⚡ Gemini AI Bridge
- Built-in integration with Google Gemini Flash models for instant in-context assistance:
  - **Reformat & Beautify**: Organizes complex answers into structured explanations with headings.
  - **Summarize**: Condenses lengthy technical explanations into 3–5 actionable bullet points.
  - **Code Debugger**: Analyzes generated snippets to detect edge cases and bug risks.
  - **Beginner Simplifier**: Explains complex algorithms in plain English.
  - **Language Translation**: Translates technical documentation into multiple languages.

### 🔖 Bookmarks & Prompt Templates
- **Conversation Bookmarks**: Save essential explanations, solutions, and reasoning chains.
- **Custom Prompt Library**: Save frequently used developer prompts and insert them directly into the DeepSeek prompt textarea with one click.

### 🎨 Seamless Injected Sidebar UI
- Isolated iframe architecture prevents styling conflicts with DeepSeek's native styles.
- Dark/Light theme synchronization, smooth glassmorphism design, and quick-toggle hotkeys.

---

## 📂 Repository Structure

```text
DeepSeek-Companion/
├── assets/                  # Icons and branding assets
│   ├── icons/               # 16px, 48px, 128px extension icons
│   └── logo.svg             # Vector logo
├── engines/                 # Export and analysis engines
│   ├── code-extractor.js    # Code block extraction and parsing
│   ├── docx-engine.js       # DOCX document compilation
│   ├── filename-detector.js # Heuristic filename inference
│   ├── markdown-exporter.js # Markdown export generator
│   ├── pdf-engine.js        # jsPDF layout and theme compiler
│   ├── text-structurizer.js # Content restructuring engine
│   └── zip-builder.js       # JSZip project bundler
├── help/                    # User manual and documentation
│   ├── help.html
│   └── help.css
├── libs/                    # Vendor libraries
│   ├── dompurify.min.js     # HTML sanitization
│   ├── highlight.min.js     # Syntax highlighting
│   ├── jspdf.umd.min.js     # Client-side PDF generation
│   ├── jspdf-autotable.min.js
│   ├── jszip.min.js         # Client-side ZIP generation
│   ├── marked.min.js        # Markdown parser
│   └── xlsx.min.js          # Excel spreadsheet generation
├── popup/                   # Extension toolbar popup
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── settings/                # Options and configuration page
│   ├── settings.html
│   ├── settings.css
│   └── settings.js
├── sidebar/                 # Injected companion sidebar
│   ├── sidebar.html
│   ├── sidebar.css
│   └── sidebar.js
├── utils/                   # Shared utility modules
│   ├── dom-scanner.js       # DOM traversal and message detection
│   ├── helpers.js           # String and clipboard utilities
│   ├── lang-map.js          # Programming language registry
│   ├── storage.js           # Chrome storage abstraction
│   └── toast.js             # In-app toast notifications
├── background.js            # Manifest V3 service worker
├── content.js               # Content script injected into DeepSeek
├── manifest.json            # Extension configuration (Manifest V3)
├── .gitignore               # Ignored build and archive artifacts
└── README.md                # Project documentation
```

---

## 🔧 Installation & Setup

### Running in Chrome / Edge / Brave

1. Clone or download this repository:
   ```bash
   git clone https://github.com/muhammadlatif9292-PK/DeepSeek-Companion.git
   ```
2. Open your Chromium-based browser and navigate to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `DeepSeek-Companion` folder.
5. Navigate to [chat.deepseek.com](https://chat.deepseek.com) — the companion sidebar toggle will appear automatically!

### Configuring Gemini AI Bridge (Optional)

1. Obtain a free API key from [Google AI Studio](https://aistudio.google.com/).
2. Open the DeepSeek Companion sidebar or Settings page.
3. Paste your Gemini API key in the API Key field and click **Verify & Save**.
4. The key is stored locally in your browser's private extension storage (`chrome.storage.local`) and is never sent to third-party servers.

---

## 🔒 Permissions Disclosure

- `storage`: Persists bookmarks, templates, user preferences, and Code Vault items locally.
- `downloads`: Saves exported ZIP, PDF, DOCX, and Markdown files to your device.
- `activeTab` / `scripting`: Injects the sidebar and extracts code blocks from active DeepSeek chats.
- `clipboardWrite`: Copies code snippets and prompts to your clipboard.
- Host permissions:
  - `https://chat.deepseek.com/*`: To run the companion on DeepSeek Chat.
  - `https://generativelanguage.googleapis.com/*`: To communicate directly with the Gemini API when AI features are invoked.

---

## 📄 License & Attribution

Designed and engineered by **Muhammad Hamad Latif** (`muhammadlatif9292@gmail.com`). All rights reserved.
