// utils/helpers.js
window.DSHelpers = {
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },

  formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  formatDate(ts) {
    const d = new Date(ts || Date.now());
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  debounce(fn, delay) {
    let t;
    return function(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  countLines(str) {
    return (str.match(/\n/g) || []).length + 1;
  },

  truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  },

  getConversationId() {
    const match = window.location.pathname.match(/\/chat\/([^/]+)/);
    return match ? match[1] : 'default';
  },

  sanitize(html) {
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html);
    }
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }
};

// KING EDITION PATCH: Better conversation ID — prevents chat overwrite bug
// Override v4's basic getConversationId with our multi-pattern version
DSHelpers.getConversationId = function() {
  const path = window.location.pathname;
  const href = window.location.href;
  const patterns = [
    /\/chat\/s\/([a-zA-Z0-9_-]{8,})/,
    /\/chat\/([a-zA-Z0-9_-]{8,})/,
    /\/s\/([a-zA-Z0-9_-]{8,})/,
    /[?&]id=([a-zA-Z0-9_-]{8,})/,
  ];
  for (const pat of patterns) {
    const m = (path + '?' + href).match(pat);
    if (m && m[1] && m[1] !== 'chat') return 'conv_' + m[1];
  }
  if (path === '/' || path === '/chat' || path.length < 6) {
    let sessId = sessionStorage.getItem('dsc_session_id');
    if (!sessId) { sessId = 'sess_' + Date.now().toString(36); sessionStorage.setItem('dsc_session_id', sessId); }
    return sessId;
  }
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = ((hash << 5) - hash) + path.charCodeAt(i);
  return 'path_' + Math.abs(hash).toString(36);
};
