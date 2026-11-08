// engines/zip-builder.js
window.ZipBuilder = {
  async build(blocks) {
    const zip = new JSZip();
    const usedNames = {};

    blocks.forEach((block, i) => {
      let filename = block.filename || `code_block_${i+1}.txt`;
      // Ensure unique names
      if (usedNames[filename]) {
        const parts = filename.split('.');
        const ext = parts.length > 1 ? '.' + parts.pop() : '';
        filename = parts.join('.') + `_${usedNames[filename]}${ext}`;
      }
      usedNames[block.filename || filename] = (usedNames[block.filename || filename] || 0) + 1;

      // Reconstruct path or organize by extension
      if (filename.includes('/')) {
        zip.file(filename, block.code || '');
      } else {
        const ext = filename.includes('.') ? filename.split('.').pop() : 'txt';
        zip.file(ext + '/' + filename, block.code || '');
      }
    });

    const readme = `# DeepSeek Export\n\nExported: ${new Date().toLocaleString()}\n\n## Files\n\n${blocks.map(b => `- ${b.filename}`).join('\n')}\n\nExported via DeepSeek Companion Extension`;
    zip.file('README.md', readme);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek-project-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
};
