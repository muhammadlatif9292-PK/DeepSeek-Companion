// engines/docx-engine.js — Generates .docx using raw XML (no lib dependency)
window.DOCXEngine = {
  async generate(text, title) {
    const structured = typeof TextStructurizer !== 'undefined'
      ? TextStructurizer.parse(text)
      : { elements: [{ type: 'paragraph', text }] };

    const body = this._buildBody(structured, title);
    const docXml = this._wrapDocument(body, title);
    const blob = await this._buildDocxBlob(docXml);
    const filename = `${(title||'export').replace(/[^a-z0-9]/gi,'-').slice(0,30)}-${new Date().toISOString().slice(0,10)}.docx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  _buildBody(structured, title) {
    let body = '';

    // Title
    body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${this._esc(title||'DeepSeek Export')}</w:t></w:r></w:p>`;
    body += `<w:p><w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="18"/></w:rPr><w:t>Exported ${new Date().toLocaleString()}</w:t></w:r></w:p>`;
    body += '<w:p/>';

    (structured.elements || []).forEach(el => {
      switch (el.type) {
        case 'h1':
          body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${this._esc(el.text)}</w:t></w:r></w:p>`;
          break;
        case 'h2':
          body += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${this._esc(el.text)}</w:t></w:r></w:p>`;
          break;
        case 'h3': case 'h4': case 'h5':
          body += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>${this._esc(el.text)}</w:t></w:r></w:p>`;
          break;
        case 'paragraph':
          body += `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${this._esc(el.text)}</w:t></w:r></w:p>`;
          break;
        case 'code':
          if (el.language) {
            body += `<w:p><w:r><w:rPr><w:b/><w:color w:val="1a73e8"/><w:sz w:val="20"/></w:rPr><w:t>${this._esc(el.language.toUpperCase())}</w:t></w:r></w:p>`;
          }
          (el.code||'').split('\n').forEach(line => {
            body += `<w:p><w:pPr><w:shd w:val="clear" w:fill="1e1e2e"/><w:ind w:left="360"/></w:pPr>` +
              `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/><w:color w:val="cdd6f4"/></w:rPr>` +
              `<w:t xml:space="preserve">${this._esc(line||' ')}</w:t></w:r></w:p>`;
          });
          body += '<w:p/>';
          break;
        case 'list':
          (el.items||[]).forEach((item, i) => {
            const prefix = el.ordered ? `${i+1}.` : '•';
            body += `<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>` +
              `<w:r><w:t xml:space="preserve">${this._esc(prefix + ' ' + item)}</w:t></w:r></w:p>`;
          });
          body += '<w:p/>';
          break;
        case 'table':
          if (el.headers && el.rows) {
            body += '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>';
            // Header row
            body += '<w:tr>';
            el.headers.forEach(h => {
              body += `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="1a73e8"/></w:tcPr>` +
                `<w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t>${this._esc(h)}</w:t></w:r></w:p></w:tc>`;
            });
            body += '</w:tr>';
            // Data rows
            el.rows.forEach((row, ri) => {
              body += '<w:tr>';
              const fill = ri % 2 === 0 ? 'f8f8f8' : 'FFFFFF';
              (row || []).forEach(cell => {
                body += `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="${fill}"/></w:tcPr>` +
                  `<w:p><w:r><w:t>${this._esc(cell||'')}</w:t></w:r></w:p></w:tc>`;
              });
              body += '</w:tr>';
            });
            body += '</w:tbl><w:p/>';
          }
          break;
        case 'callout':
          body += `<w:p><w:pPr><w:shd w:val="clear" w:fill="e8f4fd"/><w:ind w:left="360"/></w:pPr>` +
            `<w:r><w:rPr><w:b/><w:color w:val="1a73e8"/></w:rPr><w:t>${this._esc((el.kind||'Note').toUpperCase() + ': ')}</w:t></w:r>` +
            `<w:r><w:t xml:space="preserve">${this._esc(el.text||'')}</w:t></w:r></w:p>`;
          break;
        case 'blockquote':
          body += `<w:p><w:pPr><w:ind w:left="720"/></w:pPr>` +
            `<w:r><w:rPr><w:i/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">${this._esc(el.text||'')}</w:t></w:r></w:p>`;
          break;
        case 'hr':
          body += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="cccccc"/></w:pBdr></w:pPr></w:p>`;
          break;
      }
    });
    return body;
  },

  _wrapDocument(body, title) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
  },

  async _buildDocxBlob(docXml) {
    const JSZip = window.JSZip || window.jszip;
    const zip = new JSZip();

    // [Content_Types].xml
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

    // _rels/.rels
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

    // word/_rels/document.xml.rels
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

    // word/styles.xml
    zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:color w:val="1a73e8"/><w:sz w:val="36"/></w:rPr>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:color w:val="1a73e8"/><w:sz w:val="28"/></w:rPr>
    <w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:color w:val="1a73e8"/><w:sz w:val="24"/></w:rPr>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/>
    <w:tblPr><w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="cccccc"/>
      <w:bottom w:val="single" w:sz="4" w:color="cccccc"/>
      <w:left w:val="single" w:sz="4" w:color="cccccc"/>
      <w:right w:val="single" w:sz="4" w:color="cccccc"/>
      <w:insideH w:val="single" w:sz="4" w:color="cccccc"/>
      <w:insideV w:val="single" w:sz="4" w:color="cccccc"/>
    </w:tblBorders></w:tblPr>
  </w:style>
</w:styles>`);

    // word/document.xml
    zip.file('word/document.xml', docXml);

    return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  },

  _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
};
