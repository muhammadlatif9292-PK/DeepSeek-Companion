// engines/text-structurizer.js
window.TextStructurizer = {
  parse(text) {
    if (!text) return { title: null, elements: [], wordCount: 0, codeBlockCount: 0, hasTable: false };
    const lines = text.split('\n');
    const elements = [];
    let i = 0;
    let codeBlockCount = 0;
    let hasTable = false;

    while (i < lines.length) {
      const line = lines[i];

      // Code block
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        let code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          code.push(lines[i]);
          i++;
        }
        elements.push({ type: 'code', language: lang, code: code.join('\n') });
        codeBlockCount++;
        i++;
        continue;
      }

      // Heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        elements.push({ type: 'h' + level, text: headingMatch[2].trim() });
        i++;
        continue;
      }

      // Setext h1
      if (i + 1 < lines.length && lines[i + 1].match(/^={3,}$/)) {
        elements.push({ type: 'h1', text: line.trim() });
        i += 2;
        continue;
      }

      // Setext h2
      if (i + 1 < lines.length && lines[i + 1].match(/^-{3,}$/) && line.trim().length > 0) {
        elements.push({ type: 'h2', text: line.trim() });
        i += 2;
        continue;
      }

      // HR
      if (line.match(/^[-*_]{3,}$/) && line.trim().replace(/\s/g, '').length >= 3) {
        elements.push({ type: 'hr' });
        i++;
        continue;
      }

      // Table
      if (line.includes('|') && line.trim().startsWith('|')) {
        const tableLines = [];
        while (i < lines.length && lines[i].includes('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        const rows = tableLines.filter(l => !l.match(/^\|[\s\-:|]+\|[\s\-:|]*\|?$/));
        const parseRow = r => r.split('|').slice(1, -1).map(c => c.trim());
        if (rows.length > 0) {
          const headers = parseRow(rows[0]);
          const dataRows = rows.slice(1).map(parseRow);
          elements.push({ type: 'table', headers, rows: dataRows });
          hasTable = true;
        }
        continue;
      }

      // Blockquote
      if (line.startsWith('>')) {
        let text = [];
        while (i < lines.length && lines[i].startsWith('>')) {
          text.push(lines[i].slice(1).trim());
          i++;
        }
        elements.push({ type: 'blockquote', text: text.join(' ') });
        continue;
      }

      // List
      if (line.match(/^[\s]*[-*+]\s+/) || line.match(/^[\s]*\d+[.)]\s+/)) {
        const ordered = !!line.match(/^[\s]*\d+[.)]\s+/);
        const items = [];
        while (i < lines.length && (lines[i].match(/^[\s]*[-*+]\s+/) || lines[i].match(/^[\s]*\d+[.)]\s+/))) {
          items.push(lines[i].replace(/^[\s]*(?:[-*+]|\d+[.)])\s+/, '').trim());
          i++;
        }
        elements.push({ type: 'list', ordered, items });
        continue;
      }

      // Callout detection
      if (line.match(/^(?:Note|Warning|Important|Tip|Remember|Caution):/i)) {
        const kind = line.match(/^(\w+):/i)[1].toLowerCase();
        const text = line.replace(/^\w+:\s*/, '');
        elements.push({ type: 'callout', kind, text });
        i++;
        continue;
      }

      // Paragraph
      if (line.trim().length > 0) {
        let para = [];
        while (i < lines.length && lines[i].trim().length > 0 &&
               !lines[i].match(/^#{1,6}\s/) && !lines[i].startsWith('```') &&
               !lines[i].includes('|')) {
          para.push(lines[i].trim());
          i++;
        }
        if (para.length > 0) {
          elements.push({ type: 'paragraph', text: para.join(' ') });
        }
        continue;
      }

      i++;
    }

    const titleEl = elements.find(e => e.type === 'h1' || e.type === 'h2');
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return { title: titleEl ? titleEl.text : null, elements, wordCount, codeBlockCount, hasTable };
  }
};
