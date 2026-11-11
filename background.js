// background.js — DeepSeek Companion Pro v6.0 (MV3 Service Worker)
importScripts('libs/jszip.min.js');

function sendTabMessageSafe(tabId, payload) {
  if (!tabId) return;
  try {
    const maybePromise = chrome.tabs.sendMessage(tabId, payload);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch {
    // Tab closed or content script not attached
  }
}

function deduplicateZipPath(rawName, used) {
  const normalized = String(rawName || 'code_block.txt').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const basePath = normalized.includes('/')
    ? normalized
    : (normalized.includes('.') ? normalized.split('.').pop() : 'txt') + '/' + normalized;

  if (!used.has(basePath)) {
    used.add(basePath);
    return basePath;
  }

  const slashIdx = basePath.lastIndexOf('/');
  const dir = slashIdx >= 0 ? basePath.slice(0, slashIdx + 1) : '';
  const leaf = slashIdx >= 0 ? basePath.slice(slashIdx + 1) : basePath;
  const dotIdx = leaf.lastIndexOf('.');
  const stem = dotIdx > 0 ? leaf.slice(0, dotIdx) : leaf;
  const ext = dotIdx > 0 ? leaf.slice(dotIdx) : '';

  let n = 2;
  let candidate = `${dir}${stem}_${n}${ext}`;
  while (used.has(candidate)) {
    n++;
    candidate = `${dir}${stem}_${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  switch (message.type) {
    case 'EXPORT_ZIP':
      handleZipExport(message.blocks || [], sender.tab?.id);
      break;
    case 'EXPORT_PDF':
      handlePDFExport(message.text || '', message.title, sender.tab?.id);
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
    if (!Array.isArray(blocks) || blocks.length === 0) {
      throw new Error('No code blocks to export');
    }

    const zip = new JSZip();
    const used = new Set();
    const manifestEntries = [];

    blocks.forEach((block, i) => {
      const rawName = block.filename || `code_block_${i + 1}.txt`;
      const targetPath = deduplicateZipPath(rawName, used);
      zip.file(targetPath, block.code || '');
      manifestEntries.push(targetPath);
    });

    const readme = `# DeepSeek Companion Export\n\nExported: ${new Date().toLocaleString()}\n\n## Files (${manifestEntries.length})\n\n${manifestEntries.map(f => `- ${f}`).join('\n')}\n\nExported via DeepSeek Companion Pro Extension`;
    if (!used.has('README.md')) {
      zip.file('README.md', readme);
    }

    // Service workers cannot call URL.createObjectURL — use base64 data URI for MV3 compliance
    const base64 = await zip.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    const url = 'data:application/zip;base64,' + base64;

    await chrome.downloads.download({
      url,
      filename: `deepseek-project-${Date.now()}.zip`,
      saveAs: false
    });

    sendTabMessageSafe(tabId, {
      type: 'DSC_TOAST',
      msg: `✅ ZIP downloaded (${blocks.length} files)`,
      kind: 'success'
    });
  } catch (e) {
    console.error('ZIP export error:', e);
    sendTabMessageSafe(tabId, {
      type: 'DSC_TOAST',
      msg: '❌ ZIP failed: ' + e.message,
      kind: 'error'
    });
  }
}

async function handlePDFExport(text, title, tabId) {
  sendTabMessageSafe(tabId, {
    type: 'DSC_GENERATE_PDF',
    text,
    title: title || 'DeepSeek Export'
  });
}
