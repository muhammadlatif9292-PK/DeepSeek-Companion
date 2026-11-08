// background.js — Service Worker
importScripts('libs/jszip.min.js', 'libs/xlsx.min.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EXPORT_ZIP':
      handleZipExport(message.blocks, sender.tab?.id);
      break;
    case 'EXPORT_PDF':
      handlePDFExport(message.text, message.title, sender.tab?.id);
      break;
    case 'EXPORT_XLSX':
      handleXLSXExport(message.tableHtml, sender.tab?.id);
      break;
    case 'OPEN_SETTINGS':
      chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
      break;
    case 'GET_STORAGE':
      chrome.storage.local.get(message.keys, (data) => sendResponse(data));
      return true;
    case 'SET_STORAGE':
      chrome.storage.local.set(message.data, () => sendResponse({ ok: true }));
      return true;
  }
});

async function handleZipExport(blocks, tabId) {
  try {
    const zip = new JSZip();
    const byLang = {};

    blocks.forEach((block, i) => {
      const ext = (block.filename || '').includes('.') ?
        block.filename.split('.').pop() : 'txt';

      // Organize by language/extension
      let folder = ext || 'misc';
      if (!byLang[folder]) byLang[folder] = 0;
      byLang[folder]++;

      // Use path structure if filename has /
      if (block.filename && block.filename.includes('/')) {
        zip.file(block.filename, block.code || '');
      } else {
        const name = block.filename || `code_block_${i + 1}.txt`;
        zip.file(folder + '/' + name, block.code || '');
      }
    });

    // README
    const readme = `# DeepSeek Companion Export\n\nExported on: ${new Date().toLocaleString()}\n\n## Files\n\n${blocks.map(b => `- ${b.filename}`).join('\n')}\n\nExported via DeepSeek Companion Extension`;
    zip.file('README.md', readme);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `deepseek-project-${Date.now()}.zip`,
      saveAs: false
    });
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'DSC_TOAST', msg: `✅ ZIP downloaded (${blocks.length} files)`, kind: 'success' });
    }
  } catch (e) {
    console.error('ZIP error:', e);
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'DSC_TOAST', msg: '❌ ZIP failed: ' + e.message, kind: 'error' });
    }
  }
}

async function handleXLSXExport(tableHtml, tabId) {
  try {
    // Parse table HTML manually since we're in service worker
    const wb = XLSX.utils.book_new();
    // We'll send data back to content script for processing
    // Instead, parse the HTML string simply
    const rows = [];
    const trMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    trMatches.forEach((tr, i) => {
      const cells = [];
      const tdMatches = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
      tdMatches.forEach(td => {
        cells.push(td.replace(/<[^>]+>/g, '').trim());
      });
      rows.push(cells);
    });

    if (rows.length === 0) return;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'DeepSeek Data');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const url = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;
    await chrome.downloads.download({
      url,
      filename: `table-export-${Date.now()}.xlsx`,
      saveAs: false
    });
  } catch (e) {
    console.error('XLSX error:', e);
  }
}

async function handlePDFExport(text, title, tabId) {
  // PDF generation happens in sidebar (has access to jsPDF)
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'DSC_GENERATE_PDF',
      text,
      title: title || 'DeepSeek Export'
    });
  }
}
