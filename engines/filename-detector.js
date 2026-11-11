// engines/filename-detector.js — King Edition v3.3.0
// KEY UPGRADE: First-line comment detection + path context extraction
window.FilenameDetector = {

  detect(precedingText, lang, code) {
    // LEVEL 1: First-line comment in code — most reliable when using the DSC prompt
    // Detects: // src/components/Button.tsx  OR  # scripts/setup.sh  OR  /* styles.css */
    let filename = this._detectFromFirstLine(code);
    if (filename) {
      return this._build(filename, lang, 'high');
    }

    // LEVEL 2: Explicit filename in preceding markdown text
    filename = this._detectFromText(precedingText);
    if (filename) {
      return this._build(filename, lang, 'high');
    }

    // LEVEL 3: Path context — look for file path patterns in preceding text
    filename = this._detectFromPathContext(precedingText, lang);
    if (filename) {
      return this._build(filename, lang, 'medium');
    }

    // LEVEL 4: Language tag → language default name
    if (lang && LANGUAGE_MAP[lang]) {
      const info = LANGUAGE_MAP[lang];
      return {
        filename: info.default,
        extension: info.ext,
        mimeType: info.mime,
        language: lang,
        confidence: 'medium'
      };
    }

    // LEVEL 5: Content analysis
    const analyzed = this._analyzeContent(code);
    if (analyzed) {
      const info = LANGUAGE_MAP[analyzed] || {};
      return {
        filename: info.default || 'code_block.txt',
        extension: info.ext || '.txt',
        mimeType: info.mime || 'text/plain',
        language: analyzed,
        confidence: 'low'
      };
    }

    // LEVEL 6: Fallback
    return {
      filename: 'code_block.txt',
      extension: '.txt',
      mimeType: 'text/plain',
      language: 'text',
      confidence: 'guessed'
    };
  },

  _build(filename, lang, confidence) {
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const langInfo = (lang && LANGUAGE_MAP[lang]) ? LANGUAGE_MAP[lang] : {};
    return {
      filename,
      extension: ext,
      mimeType: langInfo.mime || this._mimeFromExt(ext),
      language: lang,
      confidence
    };
  },

  // Detect filename from FIRST LINE comment — works perfectly with the DSC prompt
  _detectFromFirstLine(code) {
    if (!code) return null;
    const first = code.split('\n')[0].trim();

    const patterns = [
      // // src/components/Button.tsx
      /^\/\/\s+([\w./\-]+\/[\w.\-]+\.[\w]{1,8})\s*$/,
      // // Button.tsx
      /^\/\/\s+([\w.\-]+\.[\w]{1,8})\s*$/,
      // // src/components/Button.tsx — Some description
      /^\/\/\s+([\w./\-]+\.[\w]{1,8})\s*[-–—]/,
      // # scripts/setup.sh
      /^#\s+([\w./\-]+\.[\w]{1,8})\s*$/,
      // /* styles/global.css */
      /^\/\*\s*([\w./\-]+\.[\w]{1,8})\s*\*\//,
      // <!-- index.html -->
      /^<!--\s*([\w./\-]+\.[\w]{1,8})\s*-->/,
    ];

    for (const pat of patterns) {
      const m = first.match(pat);
      if (m && m[1] && m[1].length < 120 && !m[1].includes('://')) {
        return m[1].replace(/^\.\//, '');
      }
    }
    return null;
  },

  // Look for filename patterns in preceding text (markdown around the block)
  _detectFromText(text) {
    if (!text) return null;
    const patterns = [
      // `src/components/Button.tsx`
      /`([\w./\-]+\.[\w]{1,8})`/,
      // **Button.tsx** or __Button.tsx__
      /\*\*([\w./\-]+\.[\w]{1,8})\*\*/,
      // "Button.tsx" or 'Button.tsx'
      /["']([\w./\-]+\.[\w]{1,8})["']/,
      // File: src/Button.tsx  or  Path: src/
      /(?:file|path|create|update|modify|edit|here is|here's|below is|following)[:\s]+[`"]?([\w./\-]+\.[\w]{1,8})/i,
      // ./src/Button.tsx  (starts with ./)
      /(?:^|\s)(\.\/[\w./\-]+\.[\w]{1,8})/m,
      // src/something/file.ts  (multi-segment path)
      /(?:^|\s)([\w][\w.\-]*\/[\w.\-]+\/[\w.\-]+\.[\w]{1,8})(?:\s|$)/m,
      // Simpler: anything.ext at word boundary
      /(?:^|\s)([\w][\w.\-]*\.(?:ts|tsx|js|jsx|py|css|html|json|sh|md|yml|yaml|sql|env|config|lock))(?:\s|$)/m,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1] && m[1].length < 120 && !m[1].includes('://')) {
        return m[1].replace(/^\.\//, '');
      }
    }
    return null;
  },

  // Extract path from context like "Wave 1 > src/engine/index.ts" or header text
  _detectFromPathContext(text, lang) {
    if (!text) return null;

    // Look for anything that looks like a file path with multiple segments
    const pathMatch = text.match(/(?:^|[\s>:])([a-zA-Z][\w.\-]*(?:\/[\w.\-]+){1,8}\.[\w]{1,8})(?:\s|$)/m);
    if (pathMatch && pathMatch[1] && pathMatch[1].length < 150) {
      return pathMatch[1];
    }

    return null;
  },

  _analyzeContent(code) {
    if (!code) return null;
    const t = code.trim();
    if (t.startsWith('{') || t.startsWith('[')) return 'json';
    if (t.toLowerCase().startsWith('<!doctype html') || (t.startsWith('<') && t.includes('<html'))) return 'html';
    if (t.startsWith('<') && t.includes('xmlns')) return 'xml';
    if (/^(def |import |from |class |print\()/.test(t)) return 'python';
    if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s/i.test(t)) return 'sql';
    if (/^(function|const |let |var |import |export |class )/.test(t)) return 'javascript';
    if (/^(interface |type |enum )/.test(t)) return 'typescript';
    if (/^---\n/.test(t) || /^\w+:\s+\S/.test(t)) return 'yaml';
    if (/^\[[\w\s]+\]/.test(t)) return 'ini';
    if (t.startsWith('#!')) return 'bash';
    return null;
  },

  _mimeFromExt(ext) {
    const m = { '.ts':'text/typescript', '.tsx':'text/typescript', '.js':'text/javascript', '.jsx':'text/javascript', '.py':'text/x-python', '.html':'text/html', '.css':'text/css', '.json':'application/json', '.sh':'text/x-sh', '.md':'text/markdown', '.yml':'text/yaml', '.yaml':'text/yaml' };
    return m[ext] || 'text/plain';
  }
};
