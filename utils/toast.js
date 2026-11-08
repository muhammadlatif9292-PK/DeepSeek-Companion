// utils/toast.js
(function() {
  const TOAST_CSS = `
    #dsc-toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .dsc-toast {
      background: #161b22;
      color: #e6edf3;
      border-radius: 8px;
      padding: 10px 16px;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      border-left: 3px solid #2f81f7;
      animation: dscToastIn 0.25s ease;
      pointer-events: all;
      max-width: 320px;
      word-break: break-word;
    }
    .dsc-toast.success { border-left-color: #3fb950; }
    .dsc-toast.error { border-left-color: #f85149; }
    .dsc-toast.warning { border-left-color: #d29922; }
    .dsc-toast.out { animation: dscToastOut 0.25s ease forwards; }
    @keyframes dscToastIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes dscToastOut {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(20px); opacity: 0; }
    }
  `;

  function ensureContainer() {
    let c = document.getElementById('dsc-toast-container');
    if (!c) {
      const style = document.createElement('style');
      style.textContent = TOAST_CSS;
      document.head.appendChild(style);
      c = document.createElement('div');
      c.id = 'dsc-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  window.DSToast = function(message, type = 'info', duration = 3000) {
    const container = ensureContainer();
    const toast = document.createElement('div');
    toast.className = `dsc-toast ${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };
})();
