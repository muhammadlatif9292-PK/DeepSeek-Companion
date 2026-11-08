// engines/filename-detector.js — King Edition v3.0.0
// KEY FIX: Better filename detection, prevents generic "script.sh" / "output.txt" naming
window.FilenameDetector = {

  // Counter to make generic fallback names unique
  _genericCount: {},

  detect(precedingText, lang, code) {
    // Level 1: Explicit filename in preceding text (highest confidence)
    let filename = this._detectFromText(precedingText);
    if (filename) {
      const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
      const langInfo = LANGUAGE_MAP[lang] || {};
      return {
        filename,
        extension: ext,
        mimeType: langInfo.mime || 'text/plain',
        language: lang,
        confidence: 'high'
      };
    }

    // Level 2: Try to infer filename from first comment line in code
    filename = this._detectFromCodeComment(code, lang);
    if (filename) {
      const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
      const langInfo = LANGUAGE_MAP[lang] || {};
      return {
        filename,
        extension: ext,
        mimeType: langInfo.mime || 'text/plain',
        language: lang,
        confidence: 'high'
      };
    }

    // Level 3: Language tag → use language default
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

    // Level 4: Content analysis
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

    // Level 5: Fallback
    return {
      filename: 'code_block.txt',
      extension: '.txt',
      mimeType: 'text/plain',
      language: 'text',
      confidence: 'guessed'
    };
  },

  // Detect filename from comment on first line: // filename.ts  OR  # filename.sh
  _detectFromCodeComment(code, lang) {
    if (!code) return null;
    const firstLine = code.split('\n')[0].trim();

    // Patterns: // path/to/file.ts  OR  # path/to/file.sh  OR  /* file.css */
    const patterns = [
      /^\/\/\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,6})\s*$/,         // // filename.ts
      /^\/\/\s+.*?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,6})\s*[-–—]/, // // path/file.ts — description
      /^#\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,6})\s*$/,             // # filename.sh
      /^\/\*\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,6})\s*\*\//,       // /* file.css */
    ];

    for (const pat of patterns) {
      const m = firstLine.match(pat);
      if (m && m[1] && m[1].length < 80 && m[1].includes('.')) {
        // Make sure it looks like a real file, not a URL or comment
        if (!m[1].includes('://') && !m[1].startsWith('www.')) {
          return m[1];
        }
      }
    }
    return null;
  },

  _detectFromText(text) {
    if (!text) return null;
    const patterns = [
      /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/,
      /"([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)"/,
      /'([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)'/,
      /(?:save as|create|file called|named|called|create a file called|create file|filename:|file:)\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i,
      /\*\*([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)\*\*/,
      /(?:^|\s)(\.\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/m,
      /(?:^|\s)([a-zA-Z0-9_][a-zA-Z0-9_\-.]*\.[a-zA-Z]{1,6})(?:\s|$)/m,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1] && m[1].length < 80) return m[1];
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
    if (/^---\n/.test(t) || /^\w+:\s+\S/.test(t)) return 'yaml';
    if (/^\[[\w\s]+\]/.test(t)) return 'ini';
    if (t.startsWith('#!')) return 'bash';
    return null;
  }
};
