// engines/pdf-engine.js
window.PDFEngine = {
  THEMES: {
    deepblue: { primary: '#1a73e8', accent: '#00c4cc', codeBg: '#1e1e2e', codeText: '#cdd6f4', body: '#1a1a2e', bg: '#ffffff', callout: '#e8f4fd' },
    obsidian: { primary: '#bb86fc', accent: '#03dac6', codeBg: '#121212', codeText: '#e0e0e0', body: '#e0e0e0', bg: '#1a1a1a', callout: '#2a2a3a' },
    scholar:  { primary: '#2c3e50', accent: '#e74c3c', codeBg: '#f8f8f2', codeText: '#333333', body: '#333333', bg: '#fefefe', callout: '#fff9e6' },
    emerald:  { primary: '#00897b', accent: '#ff6f00', codeBg: '#263238', codeText: '#eceff1', body: '#1a1a1a', bg: '#ffffff', callout: '#e8f5e9' },
  },

  hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return [r, g, b];
  },

  async generate(text, title, options = {}) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' });
    const theme = this.THEMES[options.theme || 'deepblue'] || this.THEMES.deepblue;
    const W = 210, ML = 15, MR = 15, pageW = W - ML - MR;
    let y = 20;
    let pageNum = 1;
    const pages = [];

    const hexRgb = (hex) => this.hexToRgb(hex);
    const primary = hexRgb(theme.primary);
    const accent = hexRgb(theme.accent);

    const addPage = () => {
      pages.push(pageNum);
      doc.addPage();
      pageNum++;
      y = 20;
    };

    const checkY = (needed) => { if (y + needed > 270) { addPage(); } };

    const setColor = (hex) => { const [r,g,b] = hexRgb(hex); doc.setTextColor(r,g,b); };
    const setFill = (hex) => { const [r,g,b] = hexRgb(hex); doc.setFillColor(r,g,b); };
    const setDraw = (hex) => { const [r,g,b] = hexRgb(hex); doc.setDrawColor(r,g,b); };

    // ── COVER PAGE ────────────────────────────────────────────────────────
    if (options.cover !== false) {
      // Background
      setFill(theme.bg);
      doc.rect(0, 0, 210, 297, 'F');

      // Gradient bar at bottom
      setFill(theme.primary);
      doc.rect(0, 270, 210, 27, 'F');

      // Title
      doc.setFontSize(26);
      doc.setFont('helvetica', 'bold');
      setColor(theme.primary);
      const titleLines = doc.splitTextToSize(title || 'DeepSeek Export', pageW);
      doc.text(titleLines, W/2, 120, { align: 'center' });

      // Subtitle
      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      setColor('#666666');
      doc.text('Exported from DeepSeek Chat', W/2, 140, { align: 'center' });

      // Date
      doc.setFontSize(11);
      setColor('#999999');
      doc.text(new Date().toLocaleString(), W/2, 152, { align: 'center' });

      // Bottom bar text
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255,255,255);
      doc.text('DeepSeek Companion Extension', W/2, 283, { align: 'center' });

      // Decorative circles
      doc.setDrawColor(200,200,200);
      doc.setFillColor(240,240,240);
      doc.circle(30, 40, 15, 'F');
      doc.circle(180, 250, 20, 'F');

      addPage();
      y = 20;
    }

    // ── PARSE CONTENT ─────────────────────────────────────────────────────
    const structured = typeof TextStructurizer !== 'undefined'
      ? TextStructurizer.parse(text)
      : { elements: [{ type: 'paragraph', text }] };

    // ── TABLE OF CONTENTS ─────────────────────────────────────────────────
    const headings = structured.elements.filter(e => e.type === 'h1' || e.type === 'h2');
    if (options.toc !== false && headings.length >= 2) {
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      setColor(theme.primary);
      doc.text('Table of Contents', ML, y);
      y += 12;

      // Underline
      setDraw(theme.primary);
      doc.setLineWidth(0.5);
      doc.line(ML, y, W - MR, y);
      y += 8;

      headings.forEach((h, i) => {
        checkY(8);
        doc.setFontSize(11);
        doc.setFont('helvetica', h.type === 'h1' ? 'bold' : 'normal');
        setColor(theme.body);
        const indent = h.type === 'h2' ? ML + 8 : ML;
        const label = `${i + 1}. ${h.text}`;
        doc.text(label, indent, y);
        // Dots
        setColor('#cccccc');
        doc.text('...........................', 130, y);
        y += 7;
      });

      y += 8;
      checkY(0);
    }

    // ── RENDER ELEMENTS ───────────────────────────────────────────────────
    structured.elements.forEach(el => {
      switch (el.type) {
        case 'h1': {
          checkY(18);
          // Full-width colored bar
          setFill(theme.primary);
          doc.rect(ML - 2, y - 5, pageW + 4, 12, 'F');
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255,255,255);
          doc.text(el.text || '', ML, y + 3);
          y += 16;
          break;
        }
        case 'h2': {
          checkY(14);
          setFill(theme.primary);
          doc.rect(ML - 2, y - 4, 3, 10, 'F');
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          setColor(theme.primary);
          doc.text(el.text || '', ML + 4, y + 3);
          y += 12;
          break;
        }
        case 'h3': case 'h4': case 'h5': case 'h6': {
          checkY(10);
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          setColor(theme.primary);
          doc.text(el.text || '', ML, y);
          y += 8;
          break;
        }
        case 'paragraph': {
          const lines = doc.splitTextToSize(el.text || '', pageW);
          lines.forEach(line => {
            checkY(6);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            setColor(theme.body);
            doc.text(line, ML, y);
            y += 5.5;
          });
          y += 3;
          break;
        }
        case 'code': {
          const lines = (el.code || '').split('\n');
          const blockH = Math.min(lines.length * 4.5 + 14, 100);
          checkY(blockH);

          // Dark background
          setFill(theme.codeBg);
          doc.rect(ML - 2, y - 2, pageW + 4, blockH, 'F');

          // Language badge
          if (el.language) {
            const langLabel = el.language.toUpperCase();
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            const [ar,ag,ab] = hexRgb(theme.accent);
            doc.setTextColor(ar,ag,ab);
            doc.text(langLabel, W - MR - 2, y + 4, { align: 'right' });
          }

          // Code lines
          doc.setFontSize(8);
          doc.setFont('courier', 'normal');
          const [cr,cg,cb] = hexRgb(theme.codeText);
          doc.setTextColor(cr,cg,cb);
          let cy = y + 8;
          const maxLines = Math.floor((blockH - 10) / 4.5);
          const visibleLines = lines.slice(0, maxLines);
          visibleLines.forEach((line, i) => {
            // Line numbers
            doc.setTextColor(100,100,100);
            doc.text(String(i + 1).padStart(3), ML, cy);
            doc.setTextColor(cr,cg,cb);
            const clamped = line.length > 90 ? line.slice(0, 87) + '...' : line;
            doc.text(clamped || ' ', ML + 8, cy);
            cy += 4.5;
          });
          if (lines.length > maxLines) {
            doc.setTextColor(150,150,150);
            doc.setFontSize(7);
            doc.text(`... ${lines.length - maxLines} more lines`, ML + 8, cy);
          }

          y += blockH + 5;
          break;
        }
        case 'list': {
          (el.items || []).forEach((item, i) => {
            const txt = (el.ordered ? `${i+1}.` : '•') + ' ' + item;
            const lines = doc.splitTextToSize(txt, pageW - 8);
            lines.forEach((line, li) => {
              checkY(6);
              doc.setFontSize(10);
              doc.setFont('helvetica', 'normal');
              setColor(theme.body);
              doc.text(line, ML + (li === 0 ? 0 : 6), y);
              y += 5.5;
            });
          });
          y += 3;
          break;
        }
        case 'table': {
          if (el.headers && el.rows && typeof doc.autoTable === 'function') {
            checkY(20);
            const [pr,pg,pb] = hexRgb(theme.primary);
            doc.autoTable({
              startY: y,
              head: [el.headers],
              body: el.rows,
              margin: { left: ML, right: MR },
              headStyles: { fillColor: [pr,pg,pb], textColor: [255,255,255], fontStyle: 'bold', fontSize: 9 },
              bodyStyles: { fontSize: 9, textColor: hexRgb(theme.body) },
              alternateRowStyles: { fillColor: [248,248,248] },
              tableLineColor: [200,200,200],
              tableLineWidth: 0.1,
            });
            y = doc.lastAutoTable.finalY + 8;
          }
          break;
        }
        case 'callout': {
          checkY(16);
          const calloutColors = { warning: '#d29922', important: '#f85149', tip: '#3fb950', note: '#2f81f7', remember: '#a371f7' };
          const cc = calloutColors[el.kind] || '#2f81f7';
          setFill(theme.callout);
          doc.rect(ML - 2, y - 4, pageW + 4, 14, 'F');
          const [lr,lg,lb] = hexRgb(cc);
          doc.setDrawColor(lr,lg,lb);
          doc.setLineWidth(2);
          doc.line(ML - 2, y - 4, ML - 2, y + 10);
          doc.setLineWidth(0.1);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(lr,lg,lb);
          doc.text((el.kind || 'Note').toUpperCase() + ':', ML + 2, y + 1);
          doc.setFont('helvetica', 'normal');
          setColor(theme.body);
          const calloutLines = doc.splitTextToSize(el.text || '', pageW - 30);
          doc.text(calloutLines[0] || '', ML + 22, y + 1);
          y += 14;
          break;
        }
        case 'blockquote': {
          checkY(12);
          doc.setDrawColor(150,150,150);
          doc.setLineWidth(1.5);
          doc.line(ML, y - 3, ML, y + 9);
          doc.setLineWidth(0.1);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'italic');
          setColor('#666666');
          const bqLines = doc.splitTextToSize(el.text || '', pageW - 8);
          bqLines.forEach(line => {
            doc.text(line, ML + 4, y);
            y += 5.5;
          });
          y += 3;
          break;
        }
        case 'hr': {
          checkY(8);
          doc.setDrawColor(200,200,200);
          doc.setLineWidth(0.3);
          doc.line(ML, y, W - MR, y);
          y += 6;
          break;
        }
      }
    });

    // ── FOOTERS ───────────────────────────────────────────────────────────
    if (options.pageNumbers !== false) {
      const total = doc.getNumberOfPages();
      for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        setColor('#999999');
        doc.text(title || 'DeepSeek Export', ML, 290);
        doc.text('DeepSeek Companion', W/2, 290, { align: 'center' });
        doc.text(`${p} / ${total}`, W - MR, 290, { align: 'right' });
        // Footer line
        doc.setDrawColor(220,220,220);
        doc.setLineWidth(0.2);
        doc.line(ML, 285, W - MR, 285);
      }
    }

    const filename = `${(title || 'deepseek-export').replace(/[^a-z0-9]/gi,'-').slice(0,30)}-${Date.now()}.pdf`;
    if (options.useExtensionDownload && typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      const dataUri = doc.output('datauristring');
      await chrome.downloads.download({ url: dataUri, filename, saveAs: false });
      return filename;
    }
    doc.save(filename);
    return filename;
  }
};
