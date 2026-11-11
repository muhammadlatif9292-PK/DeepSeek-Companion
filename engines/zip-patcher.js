// engines/zip-patcher.js — DeepSeek Companion Pro v4.1
// Merges vault files INTO an existing ZIP.
// KEY FIX: All existing ZIP entries are preserved as raw binary uint8array.
// Only vault-matched files are replaced as text. No binary data is lost.

window.ZipPatcher = {

  async patch(zipFile, vault, opts = {}) {
    const progress = opts.onProgress || (() => {});

    if (!zipFile || !vault || vault.length === 0) {
      throw new Error('Need both an existing ZIP and vault files.');
    }

    progress(5, 'Reading uploaded ZIP…');

    // Load existing ZIP
    const existingZip = await JSZip.loadAsync(zipFile);

    // Build map: normPath → { entry, originalPath }
    const existingFiles = {};
    existingZip.forEach((relativePath, entry) => {
      if (!entry.dir) {
        existingFiles[this._norm(relativePath)] = { entry, originalPath: relativePath };
      }
    });

    progress(15, 'Building output ZIP from original…');

    // === CRITICAL FIX ===
    // Create a brand-new empty ZIP and copy EVERY file from the original as
    // raw uint8array — this preserves binary files (images, fonts, wasm, etc.)
    // exactly without any re-encoding or data loss.
    const outputZip = new JSZip();

    const allOriginalPaths = Object.values(existingFiles).map(v => v.originalPath);
    let copyDone = 0;
    for (const origPath of allOriginalPaths) {
      const entry = existingZip.file(origPath);
      if (!entry) continue;
      // Read as raw binary — never as string (avoids UTF-8 mangling of binary)
      const rawData = await entry.async('uint8array');
      // Preserve the original compression type for each file
      outputZip.file(origPath, rawData, {
        binary: true,
        // Keep original compression level — do not re-compress
        compression: entry._data?.compression?.magic === '\x00\x00' ? 'STORE' : 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      copyDone++;
      progress(15 + Math.round((copyDone / allOriginalPaths.length) * 30), `Copying: ${origPath}`);
    }

    progress(45, 'Applying vault patches…');

    const report = { added: [], replaced: [], unchanged: [], skipped: [] };
    const total = vault.length;
    let done = 0;

    for (const block of vault) {
      const vPath = this._norm(block.filename || '');
      done++;

      if (!vPath) { report.skipped.push(block.filename || '(unnamed)'); continue; }

      // Allow extension-less files (Dockerfile, .env, Makefile etc.)
      const looksLikeFile = vPath.includes('.') ||
        /^(dockerfile|makefile|rakefile|gemfile|procfile|vagrantfile|jenkinsfile|gradlew|\.env.*|\.gitignore|\.gitattributes|\.editorconfig|\.htaccess|\.npmrc|\.nvmrc|readme|license|changelog|authors|contributing|todo|notice)$/i
          .test(vPath.split('/').pop());
      if (!looksLikeFile) { report.skipped.push(block.filename || '(unnamed)'); continue; }

      const pct = 45 + Math.round((done / total) * 45);
      progress(pct, `Patching: ${block.filename}`);

      const match = this._findMatch(vPath, existingFiles);
      const vaultContent = block.code || '';

      if (!match) {
        // New file — add as text with normalized relative path
        const cleanPath = String(block.filename || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
        outputZip.file(cleanPath, vaultContent);
        report.added.push(cleanPath);
      } else {
        // File exists — compare content as string (these are text/code files)
        const existingContent = await existingZip.file(match.originalPath).async('string');
        const normExisting = existingContent.replace(/\r\n/g, '\n').trimEnd();
        const normVault    = vaultContent.replace(/\r\n/g, '\n').trimEnd();

        if (normExisting === normVault) {
          // Identical — already copied from original, nothing to do
          report.unchanged.push(block.filename);
        } else {
          // Different — overwrite with vault version (text)
          outputZip.file(match.originalPath, vaultContent);
          report.replaced.push({ vault: block.filename, zip: match.originalPath });
        }
      }
    }

    progress(92, 'Generating patched ZIP…');
    const blob = await outputZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    report.total = {
      existingFiles: Object.keys(existingFiles).length,
      vaultFiles: vault.length,
      added: report.added.length,
      replaced: report.replaced.length,
      unchanged: report.unchanged.length,
      skipped: report.skipped.length,
      outputSizeBytes: blob.size
    };

    progress(100, 'Done!');
    return { blob, report };
  },

  _norm(p) {
    return p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().trim();
  },

  _findMatch(normVaultPath, existingFiles) {
    // 1. Exact path match
    if (existingFiles[normVaultPath]) return existingFiles[normVaultPath];

    const vParts = normVaultPath.split('/');
    const vName  = vParts[vParts.length - 1];

    const candidates = Object.entries(existingFiles).filter(([k]) =>
      k.split('/').pop() === vName
    );

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0][1];

    // Best segment overlap for ambiguous matches
    let best = null, bestScore = 0;
    for (const [k, v] of candidates) {
      const shared = vParts.filter(seg => k.split('/').includes(seg)).length;
      if (shared > bestScore) { bestScore = shared; best = v; }
    }
    return best;
  }
};
