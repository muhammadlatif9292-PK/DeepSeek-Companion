// engines/markdown-exporter.js
window.MarkdownExporter = {
  export(text, title, options = {}) {
    const date = new Date().toISOString().split('T')[0];
    const frontMatter = `---\ntitle: "${title || 'DeepSeek Export'}"\ndate: "${date}"\nsource: "DeepSeek Chat"\nexported_by: "DeepSeek Companion Extension"\n---\n\n`;
    // Clean up the text
    let cleaned = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return frontMatter + cleaned;
  },
  exportMultiple(messages) {
    const parts = messages.map((msg, i) => {
      const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `## DeepSeek Response — ${time}\n\n${msg.text}`;
    });
    return parts.join('\n\n---\n\n');
  }
};
