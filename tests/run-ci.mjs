// tests/run-ci.mjs — Comprehensive MV3, Unit, and Integration Verification Suite
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function collectFiles(dir, extFilter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, extFilter, out);
    } else if (!extFilter || extFilter(entry.name, full)) {
      out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

// ── Minimal, Faithful DOM Test Environment ───────────────────────────────────
function createDomEnv(options = {}) {
  let docRef = null;
  const NODE_FILTER = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.cancelable = !!init.cancelable;
      this.defaultPrevented = false;
      this.propagationStopped = false;
      this.target = null;
      this.currentTarget = null;
      Object.assign(this, init);
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
  }

  class FakeNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.childNodes = [];
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
      const idx = this.childNodes.indexOf(refNode);
      if (idx === -1) return this.appendChild(newNode);
      newNode.parentNode = this;
      this.childNodes.splice(idx, 0, newNode);
      return newNode;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
  }

  class FakeTextNode extends FakeNode {
    constructor(text) {
      super(3);
      this.textContent = String(text ?? '');
    }
  }

  function parseSimpleSelector(part) {
    let rest = part.trim();
    const checks = [];
    const tagM = rest.match(/^([a-zA-Z0-9_-]+)/);
    if (tagM) {
      const tag = tagM[1].toUpperCase();
      checks.push((el) => el.tagName === tag);
      rest = rest.slice(tagM[0].length);
    }
    while (rest.length > 0) {
      if (rest.startsWith('#')) {
        const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
        const idVal = m[1];
        checks.push((el) => el.id === idVal);
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('.')) {
        const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
        const cls = m[1];
        checks.push((el) => el.classList.contains(cls));
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('[')) {
        const m = rest.match(/^\[([a-zA-Z0-9_-]+)(?:([*^$]?=)["']?([^"'\]]*)["']?)?\]/);
        if (!m) break;
        const [, attr, op, val] = m;
        checks.push((el) => {
          const actual = el.getAttribute(attr);
          if (!op) return actual !== null;
          if (actual === null) return false;
          if (op === '=') return actual === val;
          if (op === '*=') return actual.includes(val);
          if (op === '^=') return actual.startsWith(val);
          if (op === '$=') return actual.endsWith(val);
          return false;
        });
        rest = rest.slice(m[0].length);
      } else {
        break;
      }
    }
    return (el) => checks.length > 0 && checks.every((fn) => fn(el));
  }

  function matchesSingleChain(el, selector) {
    const parts = selector.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    if (!parseSimpleSelector(parts[parts.length - 1])(el)) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      const fn = parseSimpleSelector(parts[i]);
      while (cur && !fn(cur)) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  function splitTopLevelCommas(sel) {
    const out = [];
    let cur = '';
    let bracket = 0;
    for (const ch of sel) {
      if (ch === '[') bracket++;
      else if (ch === ']') bracket--;
      if (ch === ',' && bracket === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  class FakeElement extends FakeNode {
    constructor(tagName) {
      super(1);
      this.tagName = tagName.toUpperCase();
      this._attrs = new Map();
      this._listeners = new Map();
      this._classSet = new Set();
      this.style = {};
      this.disabled = false;
      this.checked = false;
      this.value = '';
      this._rect = { left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40 };
      this._innerHTML = '';
      this._customText = null;
      this.scrollTop = 0;
      this.scrollHeight = 500;
      this.clientHeight = 500;

      const self = this;
      this.classList = {
        add(...names) {
          names.forEach((n) => self._classSet.add(n));
          self._attrs.set('class', Array.from(self._classSet).join(' '));
        },
        remove(...names) {
          names.forEach((n) => self._classSet.delete(n));
          self._attrs.set('class', Array.from(self._classSet).join(' '));
        },
        toggle(name, force) {
          const has = self._classSet.has(name);
          const enable = force !== undefined ? !!force : !has;
          if (enable) this.add(name);
          else this.remove(name);
          return enable;
        },
        contains(name) { return self._classSet.has(name); },
        [Symbol.iterator]() { return self._classSet.values(); }
      };

      this.dataset = new Proxy({}, {
        get(_, prop) {
          const k = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          const v = self.getAttribute(k);
          return v === null ? undefined : v;
        },
        set(_, prop, val) {
          const k = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          self.setAttribute(k, String(val));
          return true;
        },
        deleteProperty(_, prop) {
          const k = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
          self.removeAttribute(k);
          return true;
        }
      });
    }

    get id() { return this._attrs.get('id') || ''; }
    set id(v) { this.setAttribute('id', String(v)); }

    get className() { return this._attrs.get('class') || ''; }
    set className(v) {
      this._classSet = new Set(String(v || '').split(/\s+/).filter(Boolean));
      this._attrs.set('class', Array.from(this._classSet).join(' '));
    }

    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

    get previousElementSibling() {
      if (!this.parentNode) return null;
      const sibs = this.parentNode.children;
      const idx = sibs.indexOf(this);
      return idx > 0 ? sibs[idx - 1] : null;
    }

    get isContentEditable() {
      return this.getAttribute('contenteditable') === 'true';
    }

    get offsetParent() {
      return this.style.display === 'none' ? null : (this.parentElement || this);
    }

    setAttribute(name, value) {
      if (name === 'class') { this.className = value; return; }
      this._attrs.set(name, String(value));
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    hasAttribute(name) {
      return this._attrs.has(name);
    }
    removeAttribute(name) {
      this._attrs.delete(name);
      if (name === 'class') this._classSet.clear();
    }

    getBoundingClientRect() { return { ...this._rect }; }

    get textContent() {
      if (this._customText !== null && this.childNodes.length === 0) return this._customText;
      if (this.childNodes.length > 0) {
        return this.childNodes.map((c) => c.textContent).join('');
      }
      return this._customText || '';
    }
    set textContent(v) {
      this.childNodes = [];
      this._customText = String(v ?? '');
      if (this._customText) {
        this.appendChild(new FakeTextNode(this._customText));
      }
    }

    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(v) {
      this._innerHTML = String(v ?? '');
      if (v === '') {
        this.childNodes = [];
        this._customText = '';
      }
    }

    matches(selector) {
      return splitTopLevelCommas(selector).some((s) => matchesSingleChain(this, s));
    }

    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    querySelectorAll(selector) {
      const selectors = splitTopLevelCommas(selector);
      const out = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (selectors.some((s) => matchesSingleChain(child, s))) out.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return out;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }

    dispatchEvent(evt) {
      evt.target = this;
      let cur = this;
      while (cur) {
        evt.currentTarget = cur;
        const handlers = cur._listeners?.get(evt.type) || [];
        for (const fn of handlers) fn.call(cur, evt);
        if (!evt.bubbles || evt.propagationStopped) break;
        cur = cur.parentNode;
      }
      return !evt.defaultPrevented;
    }

    focus() {
      if (docRef) docRef.activeElement = this;
    }

    click() {
      this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    }

    compareDocumentPosition(other) {
      if (!docRef) return 0;
      const order = [];
      const dfs = (n) => {
        order.push(n);
        if (n.childNodes) n.childNodes.forEach(dfs);
      };
      dfs(docRef.documentElement);
      const ia = order.indexOf(this);
      const ib = order.indexOf(other);
      if (ia !== -1 && ib !== -1) {
        if (ia < ib) return 4; // DOCUMENT_POSITION_FOLLOWING
        if (ia > ib) return 2; // DOCUMENT_POSITION_PRECEDING
      }
      return 0;
    }
  }

  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const eventTrace = [];
  const doc = {
    documentElement,
    head,
    body,
    title: options.title || 'DeepSeek Chat',
    readyState: 'complete',
    activeElement: null,
    _listeners: new Map(),
    createElement(tag) {
      const el = new FakeElement(tag);
      if (tag.toLowerCase() === 'iframe') el.contentWindow = { postMessage() {} };
      return el;
    },
    createTextNode(txt) { return new FakeTextNode(txt); },
    createRange() {
      return {
        node: null,
        selectNodeContents(n) { this.node = n; },
        collapse() {},
        insertNode(txtNode) { if (this.node) this.node.appendChild(txtNode); }
      };
    },
    execCommand(cmd, _ui, val) {
      eventTrace.push(`execCommand:${cmd}`);
      if (!doc.activeElement) return false;
      if (cmd === 'selectAll') return true;
      if (cmd === 'delete') {
        doc.activeElement.textContent = '';
        return true;
      }
      if (cmd === 'insertText') {
        doc.activeElement.textContent = val;
        return true;
      }
      return false;
    },
    getElementById(id) { return documentElement.querySelector('#' + id); },
    querySelector(sel) { return documentElement.querySelector(sel); },
    querySelectorAll(sel) { return documentElement.querySelectorAll(sel); },
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      const list = this._listeners.get(evt.type) || [];
      list.forEach((fn) => fn(evt));
    },
    createTreeWalker(root, whatToShow) {
      const flat = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          const accept =
            (c.nodeType === 1 && (whatToShow & NODE_FILTER.SHOW_ELEMENT)) ||
            (c.nodeType === 3 && (whatToShow & NODE_FILTER.SHOW_TEXT));
          if (accept) flat.push(c);
          if (c.childNodes && c.childNodes.length) walk(c);
        }
      };
      walk(root);
      let idx = -1;
      return {
        nextNode() {
          idx++;
          return idx < flat.length ? flat[idx] : null;
        }
      };
    }
  };
  docRef = doc;

  return { doc, head, body, FakeEvent, NODE_FILTER, eventTrace };
}

function createWindowContext(domEnv, extra = {}) {
  const { doc, FakeEvent, NODE_FILTER, eventTrace } = domEnv;
  const winListeners = new Map();

  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: (...args) => { const t = setInterval(...args); t?.unref?.(); return t; },
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    Blob,
    document: doc,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 },
    NodeFilter: NODE_FILTER,
    Event: FakeEvent,
    FocusEvent: FakeEvent,
    InputEvent: class extends FakeEvent {
      constructor(type, init = {}) {
        super(type, init);
        eventTrace.push(`event:${type}`);
      }
    },
    MouseEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    location: { href: 'https://chat.deepseek.com/a/chat/s/abcdef123456', pathname: '/a/chat/s/abcdef123456' },
    history: { pushState() {}, replaceState() {} },
    sessionStorage: (() => {
      const m = new Map();
      return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
    })(),
    localStorage: (() => {
      const m = new Map();
      return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
    })(),
    navigator: { clipboard: { writeText: async () => {} } },
    innerWidth: 1280,
    innerHeight: 800,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    getComputedStyle: (el) => ({ display: el.style?.display || 'block', overflowY: el.style?.overflowY || 'visible' }),
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    URL: {
      _created: [],
      createObjectURL(blob) {
        const u = `blob:test/${this._created.length + 1}`;
        this._created.push({ url: u, blob });
        return u;
      },
      revokeObjectURL() {}
    },
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchWindowMessage(data) {
      const list = winListeners.get('message') || [];
      list.forEach((fn) => fn({ data }));
    },
    ...extra
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.HTMLTextAreaElement.prototype = {
    set value(v) { this._val = v; },
    get value() { return this._val || ''; }
  };
  vm.createContext(ctx);
  return ctx;
}

function loadScriptInto(ctx, relPath) {
  vm.runInContext(readRepoFile(relPath), ctx, { filename: relPath });
}

// ── Test Runner ──────────────────────────────────────────────────────────────
const results = [];
async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error(`FAIL  ${name}\n  -> ${err?.stack || err}`);
  }
}

await runTest('1. Manifest V3 & File Asset Integrity', async () => {
  const manifest = JSON.parse(readRepoFile('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background?.service_worker);
  assert.ok(fs.existsSync(path.join(ROOT, manifest.background.service_worker)));
  assert.ok(fs.existsSync(path.join(ROOT, manifest.action.default_popup)));
  assert.ok(fs.existsSync(path.join(ROOT, manifest.options_page)));

  for (const iconPath of Object.values(manifest.icons || {})) {
    assert.ok(fs.existsSync(path.join(ROOT, iconPath)), `Missing icon: ${iconPath}`);
  }
  for (const cs of manifest.content_scripts || []) {
    for (const jsPath of cs.js || []) {
      assert.ok(fs.existsSync(path.join(ROOT, jsPath)), `Missing content script: ${jsPath}`);
    }
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const res of war.resources || []) {
      const clean = res.replace(/\/\*$/, '');
      assert.ok(fs.existsSync(path.join(ROOT, clean)), `Missing web_accessible_resource: ${res}`);
    }
  }

  // Secret scan across first-party files
  const allCodeFiles = collectFiles(ROOT, (n, full) => !full.includes('libs') && /\.(js|mjs|html|json|md)$/i.test(n));
  const secretRegex = /(AIza[0-9A-Za-z_-]{30,}|sk-[0-9A-Za-z]{20,}|ghp_[0-9A-Za-z]{20,})/;
  for (const rel of allCodeFiles) {
    const content = readRepoFile(rel);
    assert.ok(!secretRegex.test(content), `Potential hardcoded secret detected in ${rel}`);
  }
});

await runTest('2. JavaScript Syntax Validation (`node --check`)', async () => {
  const jsFiles = collectFiles(ROOT, (n) => n.endsWith('.js'));
  assert.ok(jsFiles.length >= 15, 'Expected extension JS files');
  for (const rel of jsFiles) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  }
});

await runTest('3. HTML <-> JS Wiring, ID Parity & Message Contracts', async () => {
  const sidebarHtml = readRepoFile('sidebar/sidebar.html');
  const sidebarJs = readRepoFile('sidebar/sidebar.js');
  const settingsHtml = readRepoFile('settings/settings.html');
  const settingsJs = readRepoFile('settings/settings.js');
  const popupHtml = readRepoFile('popup/popup.html');
  const popupJs = readRepoFile('popup/popup.js');
  const bgJs = readRepoFile('background.js');
  const contentJs = readRepoFile('content.js');

  // Engine global name regressions from earlier builds must stay gone
  assert.ok(!/DSCPDFEngine|DSCDocxEngine|DSCMarkdownExporter/.test(sidebarJs), 'Stale engine names must not appear in sidebar.js');

  const checkIds = (html, js, ignoreIds, label) => {
    const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
    const jsIds = Array.from(js.matchAll(/(?:getElementById|get)\(['"]([^'"]+)['"]\)/g), (m) => m[1]);
    for (const id of jsIds) {
      if (ignoreIds.has(id)) continue;
      assert.ok(htmlIds.has(id), `${label}: JS references #${id} which is missing from HTML`);
    }
  };
  checkIds(sidebarHtml, sidebarJs, new Set(['dsc-toasts', 'dsc-toast-anim']), 'sidebar');
  checkIds(settingsHtml, settingsJs, new Set(), 'settings');
  checkIds(popupHtml, popupJs, new Set(['dsc-toggle-btn']), 'popup');

  // Script tags in sidebar.html must all exist on disk
  for (const m of sidebarHtml.matchAll(/<script\s+src="([^"]+)"/g)) {
    const resolved = path.resolve(ROOT, 'sidebar', m[1]);
    assert.ok(fs.existsSync(resolved), `sidebar.html missing script: ${m[1]}`);
  }

  // Message contracts
  const bgCases = new Set(Array.from(bgJs.matchAll(/case\s+'([^']+)'/g), (m) => m[1]));
  for (const src of [contentJs, sidebarJs]) {
    for (const m of src.matchAll(/chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*'([^']+)'/g)) {
      assert.ok(bgCases.has(m[1]), `Unhandled runtime message type ${m[1]} in background.js`);
    }
  }

  const contentCases = new Set(Array.from(contentJs.matchAll(/case\s+'([^']+)'/g), (m) => m[1]));
  for (const m of sidebarJs.matchAll(/window\.parent\.postMessage\(\s*\{\s*type:\s*'([^']+)'/g)) {
    assert.ok(contentCases.has(m[1]), `Unhandled parent postMessage type ${m[1]} in content.js`);
  }
});

await runTest('4. MV3 Service Worker Compliance & Runtime Execution (background.js)', async () => {
  const bgSrc = readRepoFile('background.js');
  const bgCodeOnly = bgSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/URL\.createObjectURL/.test(bgCodeOnly), 'MV3 Service Worker must never call URL.createObjectURL');

  let onMessageListener = null;
  const downloads = [];
  const tabMessages = [];
  const storage = {};

  const swCtx = {
    console, setTimeout, clearTimeout, Promise, Date, Set, Map, Array, Object, String, Number, Error, Uint8Array,
    importScripts(rel) {
      vm.runInContext(readRepoFile(rel), swCtx, { filename: rel });
    },
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { onMessageListener = fn; } },
        getURL: (p) => `chrome-extension://testid/${p}`
      },
      downloads: {
        async download(opts) { downloads.push(opts); return downloads.length; }
      },
      tabs: {
        create() {},
        async sendMessage(tabId, msg) { tabMessages.push({ tabId, msg }); }
      },
      storage: {
        local: {
          get(keys, cb) {
            const out = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => { out[k] = storage[k]; });
            cb(out);
          },
          set(data, cb) { Object.assign(storage, data); if (cb) cb(); }
        }
      }
    }
  };
  swCtx.self = swCtx;
  vm.createContext(swCtx);
  vm.runInContext(bgSrc, swCtx, { filename: 'background.js' });
  assert.ok(onMessageListener, 'Service worker must register runtime.onMessage listener');

  // Exercise EXPORT_ZIP with nested + duplicate paths
  await swCtx.handleZipExport([
    { filename: 'src/index.js', code: 'console.log(1);' },
    { filename: 'src/index.js', code: 'console.log(2);' },
    { filename: 'utils.py', code: 'print("ok")' }
  ], 42);

  assert.equal(downloads.length, 1);
  assert.ok(downloads[0].url.startsWith('data:application/zip;base64,'), 'Must download MV3 base64 ZIP data URI');
  const b64 = downloads[0].url.replace('data:application/zip;base64,', '');
  const loadedZip = await swCtx.JSZip.loadAsync(Buffer.from(b64, 'base64'));
  assert.equal(await loadedZip.file('src/index.js').async('string'), 'console.log(1);');
  assert.equal(await loadedZip.file('src/index_2.js').async('string'), 'console.log(2);');
  assert.equal(await loadedZip.file('py/utils.py').async('string'), 'print("ok")');
  assert.ok(loadedZip.file('README.md'));
  assert.equal(tabMessages[0].tabId, 42);
  assert.equal(tabMessages[0].msg.type, 'DSC_TOAST');
  assert.equal(tabMessages[0].msg.kind, 'success');

  // Exercise EXPORT_PDF relay
  onMessageListener({ type: 'EXPORT_PDF', text: '# Hello', title: 'Chat' }, { tab: { id: 99 } }, () => {});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(tabMessages[1].tabId, 99);
  assert.equal(tabMessages[1].msg.type, 'DSC_GENERATE_PDF');
  assert.equal(tabMessages[1].msg.text, '# Hello');
});

await runTest('5. FilenameDetector 6-Level Heuristics', async () => {
  const ctx = createWindowContext(createDomEnv());
  loadScriptInto(ctx, 'utils/lang-map.js');
  loadScriptInto(ctx, 'engines/filename-detector.js');

  const d1 = ctx.FilenameDetector.detect('', 'typescript', '// src/components/Button.tsx\nexport const B = 1;');
  assert.equal(d1.filename, 'src/components/Button.tsx');
  assert.equal(d1.confidence, 'high');

  const d2 = ctx.FilenameDetector.detect('Here is `config/app.json` updated:', 'json', '{"a":1}');
  assert.equal(d2.filename, 'config/app.json');
  assert.equal(d2.confidence, 'high');

  const d3 = ctx.FilenameDetector.detect('Look at server/routes/auth.ts below', 'typescript', 'const x = 1;');
  assert.equal(d3.filename, 'server/routes/auth.ts');

  const d4 = ctx.FilenameDetector.detect('', 'python', 'x = 1');
  assert.equal(d4.filename, 'script.py');
  assert.equal(d4.confidence, 'medium');

  const d5 = ctx.FilenameDetector.detect('', '', '<!doctype html><html><body>hi</body></html>');
  assert.equal(d5.filename, 'index.html');
  assert.equal(d5.confidence, 'low');

  const d6 = ctx.FilenameDetector.detect('', '', 'plain unhinted content 123');
  assert.equal(d6.filename, 'code_block.txt');
  assert.equal(d6.confidence, 'guessed');
});

await runTest('6. TextStructurizer & MarkdownExporter', async () => {
  const ctx = createWindowContext(createDomEnv());
  loadScriptInto(ctx, 'engines/text-structurizer.js');
  loadScriptInto(ctx, 'engines/markdown-exporter.js');

  const sample = [
    '# Project Plan',
    '',
    'Warning: Keep secrets out of git.',
    '',
    '## Architecture',
    '| Layer | File |',
    '| --- | --- |',
    '| Core | src/index.ts |',
    '',
    '```ts',
    'export const ok = true;',
    '```',
    '',
    '- Step A',
    '- Step B',
    '> Quote line',
    '---',
    'Final paragraph.'
  ].join('\n');

  const parsed = ctx.TextStructurizer.parse(sample);
  assert.equal(parsed.title, 'Project Plan');
  assert.equal(parsed.hasTable, true);
  assert.equal(parsed.codeBlockCount, 1);
  assert.ok(parsed.elements.some((e) => e.type === 'callout' && e.kind === 'warning'));
  assert.ok(parsed.elements.some((e) => e.type === 'list' && e.items.length === 2));
  assert.ok(parsed.elements.some((e) => e.type === 'blockquote'));
  assert.ok(parsed.elements.some((e) => e.type === 'hr'));

  const md = ctx.MarkdownExporter.export('Line 1\n\n\n\nLine 2', 'My Chat');
  assert.ok(md.startsWith('---\ntitle: "My Chat"'));
  assert.ok(!md.includes('\n\n\n'));
});

await runTest('7. DOMScanner & CodeExtractor (DeepSeek Real DOM & Path Extraction)', async () => {
  const domEnv = createDomEnv();
  const { doc, body } = domEnv;
  const ctx = createWindowContext(domEnv);
  loadScriptInto(ctx, 'utils/lang-map.js');
  loadScriptInto(ctx, 'utils/helpers.js');
  loadScriptInto(ctx, 'utils/toast.js');
  loadScriptInto(ctx, 'utils/dom-scanner.js');
  loadScriptInto(ctx, 'engines/filename-detector.js');
  loadScriptInto(ctx, 'engines/code-extractor.js');

  // Construct user message + assistant message with DeepSeek .md-code-block
  const userMsg = doc.createElement('div');
  userMsg.className = 'ds-message _63c77b1';
  userMsg.textContent = 'Build foo.ts';
  body.appendChild(userMsg);

  const asstMsg = doc.createElement('div');
  asstMsg.className = 'ds-message _63c77b1';
  const mdDiv = doc.createElement('div');
  mdDiv.className = 'ds-markdown';

  const blockWrap = doc.createElement('div');
  blockWrap.className = 'md-code-block md-code-block-light';
  const banner = doc.createElement('div');
  banner.className = 'md-code-block-banner-wrap';
  const langSpan = doc.createElement('span');
  langSpan.textContent = 'typescript';
  banner.appendChild(langSpan);
  const pre = doc.createElement('pre');
  pre.textContent = '// src/app.ts\nexport function greet() { return "hi"; }';
  blockWrap.appendChild(banner);
  blockWrap.appendChild(pre);
  mdDiv.appendChild(blockWrap);

  // Add trivial 1-line bash block that should be filtered as junk
  const junkWrap = doc.createElement('div');
  junkWrap.className = 'md-code-block';
  const jBanner = doc.createElement('div');
  jBanner.className = 'md-code-block-banner-wrap';
  const jLang = doc.createElement('span');
  jLang.textContent = 'bash';
  jBanner.appendChild(jLang);
  const jPre = doc.createElement('pre');
  jPre.textContent = 'npm run build';
  junkWrap.appendChild(jBanner);
  junkWrap.appendChild(jPre);
  mdDiv.appendChild(junkWrap);

  asstMsg.appendChild(mdDiv);
  body.appendChild(asstMsg);

  assert.equal(ctx.DOMScanner.isAssistantMessage(userMsg), false);
  assert.equal(ctx.DOMScanner.isAssistantMessage(asstMsg), true);

  const blocks = ctx.CodeExtractor.extract(asstMsg);
  assert.equal(blocks.length, 2, 'CodeExtractor extracts raw blocks (vault junk filtering happens in content.js)');
  assert.equal(blocks[0].lang, 'typescript');
  assert.equal(blocks[0].filename, 'src/app.ts');
  assert.equal(blocks[1].lang, 'bash');

  ctx.CodeExtractor.injectDownloadButton(blocks[0].preEl, { filename: 'src/app.ts' }, blocks[0].code);
  assert.ok(banner.querySelector('.dsc-download-btn'), 'Download button should inject into banner-wrap');
});

await runTest('8. ZipPatcher Binary-Safe Roundtrip', async () => {
  const ctx = createWindowContext(createDomEnv());
  loadScriptInto(ctx, 'libs/jszip.min.js');
  loadScriptInto(ctx, 'engines/zip-patcher.js');

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0x00, 0xFE, 0x7F]);
  const orig = new ctx.JSZip();
  orig.file('assets/icon.png', pngBytes);
  orig.file('src/app.ts', 'const v = 1;\r\n');
  orig.file('styles/theme.css', 'body { color: red; }');
  const origBuf = await orig.generateAsync({ type: 'uint8array' });

  const { blob, report } = await ctx.ZipPatcher.patch(origBuf, [
    { filename: 'src/app.ts', code: 'const v = 1;\n' },          // unchanged after CRLF norm
    { filename: 'theme.css', code: 'body { color: blue; }' },    // updated via basename match
    { filename: '\\src\\new.ts', code: 'export const n = 1;' }   // newly added + path normalized
  ]);

  assert.equal(report.total.unchanged, 1);
  assert.equal(report.total.replaced, 1);
  assert.equal(report.total.added, 1);
  assert.deepEqual(Array.from(report.added), ['src/new.ts']);

  const outBytes = new Uint8Array(await blob.arrayBuffer());
  const patched = await ctx.JSZip.loadAsync(outBytes);
  const outPng = await patched.file('assets/icon.png').async('uint8array');
  assert.deepEqual(Array.from(outPng), Array.from(pngBytes), 'Binary asset bytes must survive identically');
  assert.equal(await patched.file('styles/theme.css').async('string'), 'body { color: blue; }');
  assert.equal(await patched.file('src/new.ts').async('string'), 'export const n = 1;');
});

await runTest('9. DOCXEngine & PDFEngine Compilation (Theme Fallback + Extension Download)', async () => {
  const domEnv = createDomEnv();
  const { doc } = domEnv;
  const downloads = [];
  const ctx = createWindowContext(domEnv, {
    chrome: {
      downloads: {
        async download(opts) { downloads.push(opts); return 1; }
      }
    }
  });
  loadScriptInto(ctx, 'libs/jszip.min.js');
  loadScriptInto(ctx, 'libs/jspdf.umd.min.js');
  loadScriptInto(ctx, 'libs/jspdf-autotable.min.js');
  loadScriptInto(ctx, 'engines/text-structurizer.js');
  loadScriptInto(ctx, 'engines/docx-engine.js');
  loadScriptInto(ctx, 'engines/pdf-engine.js');

  // Verify DOCX builds valid OOXML container
  const sampleMd = '# Report\n\nParagraph text.\n\n```js\nconsole.log(1);\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |';
  const origCreate = doc.createElement.bind(doc);
  let clickedHref = null;
  doc.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === 'a') {
      el.click = () => { clickedHref = el.href; };
    }
    return el;
  };

  await ctx.DOCXEngine.generate(sampleMd, 'Test Doc');
  assert.ok(clickedHref, 'DOCXEngine should trigger download blob URL');
  const docxRecord = ctx.URL._created.find((x) => x.url === clickedHref);
  const docxZip = await ctx.JSZip.loadAsync(new Uint8Array(await docxRecord.blob.arrayBuffer()));
  const docXml = await docxZip.file('word/document.xml').async('string');
  assert.ok(docXml.includes('<w:t>Report</w:t>'));
  assert.ok(docxZip.file('[Content_Types].xml'));

  // Verify PDFEngine handles unknown theme fallback + extension download URI
  const pdfName = await ctx.PDFEngine.generate(sampleMd, 'PDF Check', {
    theme: 'unknown-theme-guard',
    useExtensionDownload: true
  });
  assert.ok(pdfName.endsWith('.pdf'));
  assert.equal(downloads.length, 1);
  assert.ok(downloads[0].url.startsWith('data:application/pdf;'), 'Expected PDF data URI for extension download');
});

await runTest('10. Content <-> Sidebar Integration (Send Engine v5, Request Content, Async Export Tab)', async () => {
  const domEnv = createDomEnv();
  const { doc, body, eventTrace } = domEnv;

  let runtimeListener = null;
  const toSidebarMessages = [];
  const downloads = [];
  const mockStorage = { exportHistory: [] };

  const contentCtx = createWindowContext(domEnv, {
    chrome: {
      runtime: {
        getURL: (p) => `chrome-extension://testid/${p}`,
        onMessage: { addListener(fn) { runtimeListener = fn; } },
        sendMessage() {}
      },
      storage: {
        local: {
          set(data) { Object.assign(mockStorage, data); }
        }
      }
    }
  });

  // Override iframe postMessage capture
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag.toLowerCase() === 'iframe') {
      el.contentWindow = { postMessage(msg) { toSidebarMessages.push(msg); } };
    }
    return el;
  };

  loadScriptInto(contentCtx, 'libs/dompurify.min.js');
  loadScriptInto(contentCtx, 'libs/marked.min.js');
  loadScriptInto(contentCtx, 'utils/lang-map.js');
  loadScriptInto(contentCtx, 'utils/helpers.js');
  loadScriptInto(contentCtx, 'utils/storage.js');
  loadScriptInto(contentCtx, 'utils/toast.js');
  loadScriptInto(contentCtx, 'utils/dom-scanner.js');
  loadScriptInto(contentCtx, 'engines/text-structurizer.js');
  loadScriptInto(contentCtx, 'engines/filename-detector.js');
  loadScriptInto(contentCtx, 'engines/code-extractor.js');
  loadScriptInto(contentCtx, 'content.js');

  // Empty chat must return '' for DSC_REQUEST_CONTENT (never document.body)
  body.appendChild(Object.assign(doc.createElement('div'), { textContent: 'UI Chrome Header' }));
  contentCtx.dispatchWindowMessage({ type: 'DSC_REQUEST_CONTENT', scope: 'last' });
  const emptyReply = toSidebarMessages.pop();
  assert.equal(emptyReply.type, 'DSC_CONTENT');
  assert.equal(emptyReply.content, '');

  // Build Lexical editor + proximity send button for Send Engine v5
  const editor = doc.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor._rect = { left: 100, top: 650, right: 600, bottom: 720, width: 500, height: 70 };
  body.appendChild(editor);

  const sendBtn = doc.createElement('button');
  sendBtn._rect = { left: 560, top: 680, right: 595, bottom: 715, width: 35, height: 35 };
  sendBtn.appendChild(doc.createElement('svg'));
  let sendBtnClicks = 0;
  sendBtn.addEventListener('click', () => { sendBtnClicks++; editor.textContent = ''; });
  body.appendChild(sendBtn);

  contentCtx.dispatchWindowMessage({ type: 'DSC_INSERT_TEMPLATE', text: 'Hello DeepSeek' });
  await new Promise((r) => setTimeout(r, 150));
  const beforeIdx = eventTrace.indexOf('event:beforeinput');
  const execIdx = eventTrace.indexOf('execCommand:insertText');
  assert.ok(beforeIdx !== -1 && execIdx !== -1 && beforeIdx < execIdx, 'Send Engine v5 must dispatch beforeinput BEFORE execCommand');

  // Add assistant message with trailing user message without .ds-markdown
  const asstMsg = doc.createElement('div');
  asstMsg.className = 'ds-message';
  const asstMd = doc.createElement('div');
  asstMd.className = 'ds-markdown';
  asstMd.textContent = '# Assistant Answer\n\nHere is your result.';
  asstMsg.appendChild(asstMd);
  body.appendChild(asstMsg);

  const trailingUser = doc.createElement('div');
  trailingUser.className = 'ds-message';
  trailingUser.textContent = 'Trailing User Prompt';
  body.appendChild(trailingUser);

  contentCtx.dispatchWindowMessage({ type: 'DSC_REQUEST_CONTENT', scope: 'last' });
  const lastReply = toSidebarMessages.pop();
  assert.equal(lastReply.content, '# Assistant Answer\n\nHere is your result.');

  // Verify runtime.onMessage forwards DSC_GENERATE_PDF (queues if sidebar iframe load event hasn't fired yet)
  assert.ok(runtimeListener, 'content.js must register chrome.runtime.onMessage');
  runtimeListener({ type: 'DSC_GENERATE_PDF', text: '# Toolbar PDF', title: 'Msg PDF' });
  const iframeEl = doc.getElementById('dsc-sidebar-frame');
  iframeEl.dispatchEvent(new domEnv.FakeEvent('load'));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(toSidebarMessages.some((m) => m.type === 'DSC_GENERATE_PDF' && m.text === '# Toolbar PDF'));

  // Test Sidebar Export Tab end-to-end handshake with sidebar.html IDs
  const sbEnv = createDomEnv();
  const sbDoc = sbEnv.doc;
  const sidebarHtml = readRepoFile('sidebar/sidebar.html');
  for (const m of sidebarHtml.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1];
    const tag = id.includes('input') || id.includes('search') ? 'input'
      : (id === 'pdf-theme' ? 'select' : (id.includes('btn') || id.startsWith('exp-') ? 'button' : 'div'));
    const el = sbDoc.createElement(tag);
    el.id = id;
    if (id.startsWith('pdf-') && id !== 'pdf-theme') el.checked = true;
    if (id === 'pdf-theme') el.value = 'deepblue';
    sbEnv.body.appendChild(el);
  }
  const radioLast = sbDoc.createElement('input');
  radioLast.setAttribute('name', 'exp-scope');
  radioLast.value = 'last';
  radioLast.checked = true;
  sbEnv.body.appendChild(radioLast);

  // Intercept anchor download in sidebar context
  const sbCreatedBlobs = [];
  const origSbCreate = sbDoc.createElement.bind(sbDoc);
  sbDoc.createElement = (tag) => {
    const el = origSbCreate(tag);
    if (tag === 'a') el.click = () => sbCreatedBlobs.push(el.download);
    return el;
  };

  let sidebarCtx;
  sidebarCtx = createWindowContext(sbEnv, {
    parent: {
      postMessage(msg) {
        if (msg.type === 'DSC_REQUEST_CONTENT') {
          setTimeout(() => {
            sidebarCtx.dispatchWindowMessage({ type: 'DSC_CONTENT', content: '# Live Chat\n\nBody text.' });
          }, 15);
        }
      }
    },
    chrome: {
      runtime: { sendMessage() {}, getURL: (p) => p },
      tabs: { create() {} },
      downloads: { async download(opts) { downloads.push(opts); return 1; } },
      storage: {
        local: {
          async get() { return { exportHistory: [] }; },
          set(d) { Object.assign(mockStorage, d); }
        }
      }
    }
  });

  loadScriptInto(sidebarCtx, 'libs/jszip.min.js');
  loadScriptInto(sidebarCtx, 'libs/jspdf.umd.min.js');
  loadScriptInto(sidebarCtx, 'libs/jspdf-autotable.min.js');
  loadScriptInto(sidebarCtx, 'engines/text-structurizer.js');
  loadScriptInto(sidebarCtx, 'engines/pdf-engine.js');
  loadScriptInto(sidebarCtx, 'engines/docx-engine.js');
  loadScriptInto(sidebarCtx, 'engines/markdown-exporter.js');
  loadScriptInto(sidebarCtx, 'engines/zip-patcher.js');
  loadScriptInto(sidebarCtx, 'sidebar/sidebar.js');

  await new Promise((r) => setTimeout(r, 20));
  sbDoc.getElementById('exp-md').click();
  await new Promise((r) => setTimeout(r, 50));
  sbDoc.getElementById('exp-txt').click();
  await new Promise((r) => setTimeout(r, 50));
  sbDoc.getElementById('exp-docx').click();
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && !sbCreatedBlobs.some((n) => String(n).endsWith('.docx'))) {
    await new Promise((r) => setTimeout(r, 25));
  }

  const toastErrs = sbDoc.getElementById('dsc-toasts')?.children?.map((c) => c.textContent).filter((t) => t.includes('❌')) || [];
  assert.deepEqual(toastErrs, [], `Unexpected sidebar error toasts: ${toastErrs.join('; ')}`);
  assert.ok(sbCreatedBlobs.includes('deepseek-export.md'), 'Markdown export should download deepseek-export.md');
  assert.ok(sbCreatedBlobs.includes('deepseek-export.txt'), 'Text export should download deepseek-export.txt');
  assert.ok(sbCreatedBlobs.some((n) => String(n).endsWith('.docx')), `DOCX export should download .docx (got: ${sbCreatedBlobs.join(', ')})`);
});

const failed = results.filter((r) => !r.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed.`);
process.exit(failed.length > 0 ? 1 : 0);
