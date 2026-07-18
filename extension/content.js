// Injected on demand (when you click "Start" in the popup). Scans the form on the
// current page — Google Forms OR any ordinary HTML form — asks the bridge for
// answers, fills the fields, shows a progress panel, and prompts you inline for
// anything the AI couldn't decide.

(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isEmpty = a =>
    a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0);
  const clean = s =>
    String(s || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();

  /* ----------------------------- Progress panel ----------------------------- */
  const UI = (() => {
    let root, statusEl, bar, listEl, footEl;

    function build() {
      document.getElementById('__ff_panel')?.remove();
      root = document.createElement('div');
      root.id = '__ff_panel';
      root.style.cssText =
        'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:330px;' +
        'max-height:78vh;display:flex;flex-direction:column;background:#fff;color:#202124;' +
        'border:1px solid #dadce0;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);' +
        'font:13px/1.45 system-ui,-apple-system,sans-serif;overflow:hidden';

      const head = document.createElement('div');
      head.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:11px 13px;background:#2d6cdf;color:#fff';
      head.innerHTML =
        '<span style="font-size:15px">🪄</span>' +
        '<b style="flex:1;font-size:13px">AI Form Filler</b>';
      const close = document.createElement('span');
      close.textContent = '✕';
      close.title = 'Close';
      close.style.cssText = 'cursor:pointer;opacity:.85;font-size:13px';
      close.onclick = () => root.remove();
      head.appendChild(close);

      statusEl = document.createElement('div');
      statusEl.style.cssText = 'padding:11px 13px 6px;color:#3c4043';
      statusEl.textContent = 'Starting…';

      const barWrap = document.createElement('div');
      barWrap.style.cssText =
        'height:7px;margin:0 13px 11px;border-radius:6px;background:#e8eaed;overflow:hidden';
      bar = document.createElement('div');
      bar.style.cssText =
        'height:100%;width:0%;border-radius:6px;background:#2d6cdf;transition:width .35s ease';
      barWrap.appendChild(bar);

      listEl = document.createElement('div');
      listEl.style.cssText = 'padding:0 13px;overflow:auto;flex:1';

      footEl = document.createElement('div');
      footEl.style.cssText =
        'display:flex;gap:8px;flex-wrap:wrap;padding:11px 13px;border-top:1px solid #eee';

      root.append(head, statusEl, barWrap, listEl, footEl);
      document.body.appendChild(root);
    }

    function indeterminate(on) {
      if (!on) return;
      bar.style.width = '40%';
      bar.style.background =
        'repeating-linear-gradient(90deg,#2d6cdf 0 14px,#9bbcf2 14px 28px)';
      bar.animate(
        [{ transform: 'translateX(-40%)' }, { transform: 'translateX(250%)' }],
        { duration: 1100, iterations: Infinity }
      );
    }

    return {
      show: build,
      status: t => statusEl && (statusEl.textContent = t),
      progress(done, total) {
        bar.getAnimations?.().forEach(a => a.cancel());
        bar.style.background = '#2d6cdf';
        bar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
      },
      indeterminate,
      clearList: () => (listEl.innerHTML = ''),
      list: () => listEl,
      footer: () => footEl,
      remove: () => root?.remove()
    };
  })();

  function note(text, color) {
    const d = document.createElement('div');
    d.style.cssText =
      'padding:9px 10px;margin:8px 0;border-radius:8px;font-size:12.5px;' +
      `background:${color || '#f1f3f4'};color:#3c4043;white-space:pre-wrap`;
    d.textContent = text;
    UI.list().appendChild(d);
    return d;
  }

  function button(label, primary, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'flex:1;min-width:120px;padding:9px;border:0;border-radius:7px;cursor:pointer;' +
      'font-size:13px;font-weight:600;' +
      (primary ? 'background:#2d6cdf;color:#fff' : 'background:#e8eaed;color:#3c4043');
    b.onclick = onClick;
    UI.footer().appendChild(b);
    return b;
  }

  /* --------------------------- Form detection ------------------------------ */
  function isGoogleForm() {
    return (
      (location.hostname === 'docs.google.com' && location.pathname.startsWith('/forms')) ||
      !!document.querySelector('div[role="listitem"] [role="heading"]')
    );
  }

  function isScannable(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' &&
        ['hidden', 'submit', 'button', 'image', 'reset', 'password'].includes(type))
      return false;
    if (el.disabled || el.readOnly) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (type === 'radio' || type === 'checkbox')
      return el.offsetParent !== null || !!el.closest('label'); // often visually replaced
    if (tag === 'input' && type === 'file') return true;
    const r = el.getBoundingClientRect();
    return el.offsetParent !== null && r.width > 0 && r.height > 0;
  }

  function hasNativeFields() {
    return [...document.querySelectorAll('input,textarea,select')].some(isScannable);
  }

  async function waitForForm(timeout = 8000) {
    const start = Date.now();
    const ready = () =>
      document.querySelector('div[role="listitem"]') || hasNativeFields();
    while (Date.now() - start < timeout) {
      if (ready()) return true;
      await sleep(300);
    }
    return false;
  }

  /* -------------------- Label detection (generic forms) -------------------- */
  function nearbyQuestion(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node; depth++, node = node.parentElement) {
      let sib = node.previousElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
        const t = (sib.innerText || '').trim();
        if (t && t.length <= 200) return t;
      }
    }
    return '';
  }

  function getLabel(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.innerText.trim()) return clean(l.innerText);
    }
    const wrap = el.closest('label');
    if (wrap && wrap.innerText.trim()) return clean(wrap.innerText);
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return clean(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb
        .split(/\s+/)
        .map(id => document.getElementById(id)?.innerText || '')
        .join(' ')
        .trim();
      if (t) return clean(t);
    }
    if (el.placeholder && el.placeholder.trim()) return clean(el.placeholder);
    if (el.title && el.title.trim()) return clean(el.title);
    const near = nearbyQuestion(el);
    if (near) return clean(near);
    return clean(el.name || el.id || '');
  }

  function groupQuestion(inputs) {
    const fs = inputs[0].closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && lg.innerText.trim()) return clean(lg.innerText);
    }
    const q = nearbyQuestion(inputs[0]);
    if (q) return clean(q);
    return clean(inputs[0].name || 'field');
  }

  /* ------------------------ Scan: generic HTML form ------------------------ */
  function scanGeneric() {
    const fields = [];
    const fileFields = [];
    const registry = {};
    const all = [...document.querySelectorAll('input,textarea,select')].filter(isScannable);
    const handled = new Set();
    let idx = 0;
    const nextId = () => 'q' + idx++;

    for (const el of all) {
      if (handled.has(el)) continue;
      handled.add(el);
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      const id = nextId();

      if (tag === 'input' && type === 'file') {
        registry[id] = { kind: 'file-native', el };
        fileFields.push({ id, question: getLabel(el) || 'File upload' });
        continue;
      }

      if (type === 'radio' || type === 'checkbox') {
        const group = el.name
          ? all.filter(x => (x.type || '').toLowerCase() === type && x.name === el.name)
          : [el];
        group.forEach(g => handled.add(g));
        const options = group
          .map(g => ({ label: getLabel(g), el: g }))
          .filter(o => o.label);
        if (!options.length) continue;
        const question =
          group.length > 1 ? groupQuestion(group) : getLabel(el) || groupQuestion(group);
        const required = group.some(g => g.required);
        const labels = options.map(o => o.label);
        if (type === 'radio') {
          fields.push({ id, question, required, type: 'radio', options: labels });
          registry[id] = { kind: 'radio-native', options };
        } else {
          fields.push({ id, question, required, type: 'checkbox', options: labels });
          registry[id] = { kind: 'checkbox-native', options };
        }
        continue;
      }

      if (tag === 'select') {
        const options = [...el.options]
          .map(o => o.text.trim())
          .filter(t => t && !/^(select|choose|--|please)/i.test(t));
        const question = getLabel(el);
        if (!question) continue;
        fields.push({ id, question, required: el.required, type: 'dropdown', options });
        registry[id] = { kind: 'select-native', el };
        continue;
      }

      if (tag === 'textarea') {
        const question = getLabel(el);
        if (!question) continue;
        fields.push({ id, question, required: el.required, type: 'paragraph' });
        registry[id] = { kind: 'textarea', el };
        continue;
      }

      // text-like input (text/email/tel/number/url/date/search/…)
      const question = getLabel(el);
      if (!question) continue;
      fields.push({ id, question, required: el.required, type: 'text' });
      registry[id] = { kind: 'text', el };
    }

    return { fields, fileFields, registry };
  }

  /* ------------------------ Scan: Google Forms ----------------------------- */
  function scanGoogle() {
    const items = [...document.querySelectorAll('div[role="listitem"]')];
    const fields = [];
    const fileFields = [];
    const registry = {};

    items.forEach((item, i) => {
      const headingEl = item.querySelector('[role="heading"]');
      const rawHeading = headingEl ? headingEl.innerText : '';
      const question = rawHeading.replace(/\s*\*\s*$/, '').trim();
      if (!question) return;
      const required = /\*\s*$/.test(rawHeading);
      const id = 'q' + i;

      const fileBtn = [...item.querySelectorAll('[role="button"]')].find(b =>
        /add file/i.test(b.innerText || '')
      );
      if (fileBtn) {
        registry[id] = { kind: 'file', btn: fileBtn };
        fileFields.push({ id, question });
        return;
      }

      const textArea = item.querySelector('textarea');
      const radios = [...item.querySelectorAll('[role="radio"]')];
      const checks = [...item.querySelectorAll('[role="checkbox"]')];
      const listbox = item.querySelector('[role="listbox"]');
      const textInput = item.querySelector('input[type="text"]');

      let field;
      if (textArea) {
        field = { id, question, required, type: 'paragraph' };
        registry[id] = { kind: 'textarea', el: textArea };
      } else if (radios.length) {
        const options = radios
          .map(r => r.getAttribute('data-value') || r.getAttribute('aria-label'))
          .filter(Boolean);
        field = { id, question, required, type: 'radio', options };
        registry[id] = { kind: 'radio', els: radios };
      } else if (checks.length) {
        const options = checks
          .map(c => c.getAttribute('data-answer-value') || c.getAttribute('aria-label'))
          .filter(Boolean);
        field = { id, question, required, type: 'checkbox', options };
        registry[id] = { kind: 'checkbox', els: checks };
      } else if (listbox) {
        const options = [...listbox.querySelectorAll('[role="option"]')]
          .map(o => o.getAttribute('data-value'))
          .filter(v => v && v !== '');
        field = { id, question, required, type: 'dropdown', options };
        registry[id] = { kind: 'dropdown', listbox, item };
      } else if (textInput) {
        field = { id, question, required, type: 'text' };
        registry[id] = { kind: 'text', el: textInput };
      } else {
        return;
      }
      fields.push(field);
    });

    return { fields, fileFields, registry };
  }

  function scanForm() {
    return isGoogleForm() ? scanGoogle() : scanGeneric();
  }

  /* ----------------------------- Form filling ------------------------------ */
  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    el.focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setSelect(sel, ans) {
    const opts = [...sel.options];
    const want = String(ans);
    const m =
      opts.find(o => o.text.trim() === want) ||
      opts.find(o => o.value === want) ||
      opts.find(o => o.text.trim().toLowerCase() === want.toLowerCase());
    if (!m) return false;
    sel.value = m.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const eq = (a, b) => String(a) === String(b) ||
    String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  // Verify a field actually holds a value (so we never claim a silent failure as "filled").
  function isFilled(reg) {
    if (!reg) return false;
    switch (reg.kind) {
      case 'text':
      case 'textarea':
        return !!(reg.el.value || '').trim();
      case 'select-native':
        return !!(reg.el.value || '').trim();
      case 'radio-native':
      case 'checkbox-native':
        return reg.options.some(o => o.el.checked);
      case 'radio':
      case 'checkbox':
        return reg.els.some(e => e.getAttribute('aria-checked') === 'true');
      case 'dropdown': {
        const sel = reg.listbox.querySelector('[role="option"][aria-selected="true"]');
        return !!(sel && sel.getAttribute('data-value'));
      }
      default:
        return false;
    }
  }

  async function fillOne(reg, ans) {
    if (!reg || isEmpty(ans)) return false;
    try {
      switch (reg.kind) {
        case 'text':
        case 'textarea':
          reg.el.focus();
          setNativeValue(reg.el, String(ans));
          return true;

        case 'select-native':
          return setSelect(reg.el, ans);

        case 'radio-native': {
          const o = reg.options.find(o => eq(o.label, ans));
          if (o) {
            if (!o.el.checked) o.el.click();
            o.el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }

        case 'checkbox-native': {
          let any = false;
          (Array.isArray(ans) ? ans : [ans]).forEach(a => {
            const o = reg.options.find(o => eq(o.label, a));
            if (o) {
              if (!o.el.checked) o.el.click();
              o.el.dispatchEvent(new Event('change', { bubbles: true }));
              any = true;
            }
          });
          return any;
        }

        case 'radio': {
          const m = reg.els.find(
            r => (r.getAttribute('data-value') || r.getAttribute('aria-label')) === ans
          );
          if (m) { m.click(); return true; }
          return false;
        }

        case 'checkbox': {
          let any = false;
          (Array.isArray(ans) ? ans : [ans]).forEach(a => {
            const m = reg.els.find(
              c => (c.getAttribute('data-answer-value') || c.getAttribute('aria-label')) === a
            );
            if (m) { m.click(); any = true; }
          });
          return any;
        }

        case 'dropdown': {
          reg.listbox.click();
          await sleep(250);
          const opt = [...reg.item.querySelectorAll('[role="option"]')].find(
            o => o.getAttribute('data-value') === ans
          );
          if (opt) { opt.click(); await sleep(120); return true; }
          return false;
        }
      }
    } catch (e) {
      console.warn('[form-filler] fill failed', e);
    }
    return false;
  }

  function clickSubmit() {
    // Google Forms custom button
    const g = [...document.querySelectorAll('div[role="button"]')].find(
      b => b.innerText && b.innerText.trim().toLowerCase() === 'submit'
    );
    if (g) { g.click(); return true; }
    // Native submit
    const n = document.querySelector('button[type="submit"], input[type="submit"]');
    if (n) { n.click(); return true; }
    // Text-matched button fallback
    const t = [...document.querySelectorAll('button, [role="button"], input[type="button"]')].find(
      b => ['submit', 'send', 'save', 'continue'].includes(((b.innerText || b.value || '') + '').trim().toLowerCase())
    );
    if (t) { t.click(); return true; }
    return false;
  }

  // Built-in Google Forms extras that aren't normal questions.
  function labelTextOf(c) {
    const aria = c.getAttribute('aria-label') || '';
    let labelled = '';
    const lb = c.getAttribute('aria-labelledby');
    if (lb)
      labelled = lb.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
    const near = c.closest('label, div')?.innerText || '';
    return `${aria} ${labelled} ${near}`.toLowerCase();
  }
  function setControl(matchRe, wantChecked) {
    for (const c of document.querySelectorAll('[role="switch"], [role="checkbox"]')) {
      if (matchRe.test(labelTextOf(c))) {
        if ((c.getAttribute('aria-checked') === 'true') !== wantChecked) c.click();
        return;
      }
    }
  }
  function ensureExtras() {
    if (!isGoogleForm()) return;
    setControl(/as the email to be included|record\s+\S+@\S+\s+as the email/i, true);
    setControl(/send me a copy/i, true);
  }

  /* --------------------- Inline prompt for unknown fields ------------------- */
  // Renders a small editor per undecided field; returns a getter for the values.
  function renderUnknowns(unknowns, answers) {
    note(
      `I need your input on ${unknowns.length} field${unknowns.length > 1 ? 's' : ''} ` +
        `(couldn't decide, or the value didn't apply). Review/edit below, then click “Fill these in”. ` +
        `I'll remember what you enter for next time.`,
      '#fef7e0'
    );
    const inputs = {};
    for (const f of unknowns) {
      const pre = answers ? answers[f.id] : null;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:10px 0';
      const lab = document.createElement('div');
      lab.style.cssText = 'font-weight:600;margin-bottom:5px';
      lab.textContent = f.question + (f.required ? ' *' : '');
      wrap.appendChild(lab);

      if (f.type === 'radio' || f.type === 'dropdown') {
        const sel = document.createElement('select');
        sel.style.cssText = inStyle();
        sel.appendChild(new Option('— choose —', ''));
        (f.options || []).forEach(o => sel.appendChild(new Option(o, o)));
        if (typeof pre === 'string' && (f.options || []).includes(pre)) sel.value = pre;
        wrap.appendChild(sel);
        inputs[f.id] = () => sel.value || null;
      } else if (f.type === 'checkbox') {
        const boxes = [];
        (f.options || []).forEach(o => {
          const row = document.createElement('label');
          row.style.cssText = 'display:flex;gap:7px;align-items:center;margin:3px 0;font-weight:400';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = o;
          cb.checked = Array.isArray(pre) && pre.includes(o);
          row.append(cb, document.createTextNode(o));
          wrap.appendChild(row);
          boxes.push(cb);
        });
        inputs[f.id] = () => boxes.filter(b => b.checked).map(b => b.value);
      } else {
        const inp = document.createElement(f.type === 'paragraph' ? 'textarea' : 'input');
        inp.style.cssText = inStyle();
        inp.placeholder = 'Your answer';
        if (typeof pre === 'string') inp.value = pre;
        wrap.appendChild(inp);
        inputs[f.id] = () => inp.value.trim() || null;
      }
      UI.list().appendChild(wrap);
    }
    return inputs;
    function inStyle() {
      return 'width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #dadce0;border-radius:6px;font:13px system-ui';
    }
  }

  /* ------------------------------ File upload ------------------------------ */
  // Pull the resume bytes from the bridge (via the service worker — an HTTPS page
  // can't fetch http://127.0.0.1 itself) and rebuild a real File in the page.
  function fetchResumeFile(filename) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'RESUME' }, resp => {
        if (chrome.runtime.lastError || !resp || !resp.ok) return resolve(null);
        try {
          const bin = atob(resp.data);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new File([arr], filename, { type: resp.mime }));
        } catch (_) {
          resolve(null);
        }
      });
    });
  }

  // Attach a File to a native <input type="file"> the way a real drop/pick would.
  // (This is the only kind of upload a page script can drive — Google Drive's
  //  picker runs in a cross-origin frame and cannot be injected into.)
  function attachNativeFile(inputEl, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return inputEl.files.length > 0;
  }

  async function handleFileFields(fileFields, registry, resumePath) {
    const filename = (resumePath && resumePath.split('/').pop()) || 'resume.pdf';
    let needsCopyBtn = false;

    for (const ff of fileFields) {
      const reg = registry[ff.id];
      if (reg && reg.kind === 'file-native') {
        const file = await fetchResumeFile(filename);
        if (file && attachNativeFile(reg.el, file)) {
          note(`✓ Attached ${filename} to “${ff.question}”.`, '#e6f4ea');
          continue;
        }
        note(
          `Couldn't auto-attach the file for “${ff.question}”.\n` +
            `Upload manually: ${resumePath || 'your file'}`,
          '#fce8e6'
        );
      } else {
        // Google Forms / Google Drive picker — cannot be filled programmatically.
        needsCopyBtn = true;
        note(
          `⬆ “${ff.question}” uses Google Drive's uploader, which only accepts a real file pick.\n` +
            `Click “Copy resume path”, then in the upload dialog press Ctrl+L, paste, and hit Enter:\n` +
            `${resumePath || 'your file'}`,
          '#fef7e0'
        );
      }
    }

    if (needsCopyBtn && resumePath) {
      button('Copy resume path', false, async () => {
        try {
          await navigator.clipboard.writeText(resumePath);
          note('✓ Path copied. In the Browse dialog: Ctrl+L → paste → Enter.', '#e6f4ea');
        } catch (_) {
          note('Copy failed. Path:\n' + resumePath, '#fce8e6');
        }
      });
    }
  }

  /* --------------------------------- Main ---------------------------------- */
  async function main() {
    UI.show();
    UI.status('Scanning the form…');
    const ready = await waitForForm();
    if (!ready) { UI.status('No form found on this page.'); return; }

    const { fields, fileFields, registry } = scanForm();
    const total = fields.length;
    if (!total && !fileFields.length) { UI.status('No fillable fields found.'); return; }

    UI.status(`Found ${total} field${total === 1 ? '' : 's'}. Asking AI to match your data…`);
    UI.indeterminate(true);

    if (!total) { afterFill({}, 0); return; }

    chrome.runtime.sendMessage({ type: 'FILL', fields }, async resp => {
      if (chrome.runtime.lastError || !resp) {
        UI.status('Extension error: ' + (chrome.runtime.lastError?.message || 'no response'));
        return;
      }
      if (!resp.ok) {
        UI.progress(0, 1);
        note('Bridge not reachable. Start the local server:\nnode bridge/server.js', '#fce8e6');
        UI.status('Could not reach the AI bridge.');
        return;
      }

      // Fill what the AI decided, then VERIFY each field actually took the value.
      const answers = resp.answers || {};
      let done = 0;
      UI.progress(0, total);
      for (const f of fields) {
        const reg = registry[f.id];
        const ans = answers[f.id];
        if (!isEmpty(ans)) {
          await fillOne(reg, ans);
          await sleep(50);
          if (!isFilled(reg)) { await fillOne(reg, ans); await sleep(60); } // one retry
        }
        if (isFilled(reg)) done++;
        UI.progress(done, total);
        UI.status(`Filling… ${done}/${total}`);
      }
      ensureExtras();
      afterFill(answers, done, resp.resumePath);
    });

    async function afterFill(answers, done, resumePath) {
      const unknowns = fields.filter(f => !isFilled(registry[f.id]));
      UI.clearList();
      UI.progress(done, total || 1);
      UI.status(`Filled ${done} of ${total} field${total === 1 ? '' : 's'}.`);

      if (fileFields.length) {
        await handleFileFields(fileFields, registry, resumePath);
      }

      const finishBtn = () => {
        button('Submit form', true, () => {
          if (!clickSubmit()) note('Could not find the Submit button.', '#fce8e6');
        });
      };

      if (unknowns.length) {
        const inputs = renderUnknowns(unknowns, answers);
        button('Fill these in', true, async () => {
          let added = 0;
          const toRemember = [];
          for (const f of unknowns) {
            const val = inputs[f.id]();
            if (isEmpty(val)) continue;
            await fillOne(registry[f.id], val);
            await sleep(50);
            if (!isFilled(registry[f.id])) { await fillOne(registry[f.id], val); await sleep(60); }
            if (isFilled(registry[f.id])) {
              added++;
              toRemember.push({ question: f.question, answer: val });
            }
          }
          UI.clearList();
          UI.footer().innerHTML = '';
          UI.progress(done + added, total);
          UI.status(`Done — filled ${done + added} of ${total}. Review and submit.`);
          if (toRemember.length) {
            chrome.runtime.sendMessage({ type: 'REMEMBER', items: toRemember }, r => {
              if (r && r.ok)
                note(`✓ Saved ${r.saved} answer(s) — I'll reuse them on future forms.`, '#e6f4ea');
            });
          }
          if (fileFields.length)
            note('Don’t forget the file upload.', '#fef7e0');
          finishBtn();
        });
        button('Skip', false, () => {
          UI.clearList();
          UI.footer().innerHTML = '';
          UI.status(`Filled ${done} of ${total}. Some fields left blank.`);
          finishBtn();
        });
      } else {
        chrome.storage.local.get('autoSubmit').then(({ autoSubmit }) => {
          if (autoSubmit && !fileFields.length) {
            UI.status(`Filled all ${total}. Submitting…`);
            setTimeout(() => {
              if (!clickSubmit()) { UI.status('Filled. Couldn’t find Submit.'); finishBtn(); }
            }, 800);
          } else {
            UI.status(`Filled ${done} of ${total}. Review and submit.`);
            finishBtn();
          }
        });
      }
    }
  }

  main();
})();
