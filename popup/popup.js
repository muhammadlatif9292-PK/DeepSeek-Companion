// popup.js — DeepSeek Companion Pro v6.0
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isDeepSeek = tab?.url?.includes('chat.deepseek.com');
  const isAccessible = tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://');

  if (isDeepSeek) {
    document.getElementById('status-dot').className = 'dot dot-green';
    document.getElementById('status-text').textContent = 'Active on DeepSeek';
    document.getElementById('btn-toggle-sidebar').querySelector('span:last-child').textContent = 'Open Sidebar';
  }

  const data = await chrome.storage.local.get(['dscStats', 'exportHistory']);
  document.getElementById('stat-vault-files').textContent = data.dscStats?.vaultCount ?? 0;
  document.getElementById('stat-exports').textContent = (data.exportHistory || []).length;

  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    if (tab?.id && isAccessible) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { const btn = document.getElementById('dsc-toggle-btn'); if (btn) btn.click(); }
      }).catch(() => {});
    }
    window.close();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    window.close();
  });

  document.getElementById('btn-open-deepseek').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://chat.deepseek.com' });
    window.close();
  });

  document.getElementById('btn-help').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
    window.close();
  });
})();
