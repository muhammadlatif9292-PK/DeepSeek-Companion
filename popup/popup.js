(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // FIX: chrome.scripting.executeScript throws "Cannot access a chrome:// URL"
  // if the active tab is a chrome:// page (e.g. chrome://extensions).
  // Guard every tab operation with a URL check.
  const isDeepSeek = tab?.url?.includes('chat.deepseek.com');
  const isAccessible = tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://');

  const statusRow = document.getElementById('status-row');
  const statusText = document.getElementById('status-text');

  if (isDeepSeek) {
    statusRow.querySelector('.dot').className = 'dot dot-green';
    statusText.textContent = 'Active on DeepSeek';
  }

  // Load stats
  const data = await chrome.storage.local.get(['bookmarks', 'templates']);
  document.getElementById('stat-bookmarks').textContent = (data.bookmarks || []).length;
  document.getElementById('stat-templates').textContent = (data.templates || []).length;

  // Button handlers
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    if (tab?.id && isAccessible) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('dsc-toggle-btn');
          if (btn) btn.click();
        }
      }).catch(() => {}); // silently ignore if injection fails
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
