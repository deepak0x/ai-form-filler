// Scans the current Google Form, asks the bridge for answers, fills the fields,
// shows a friendly progress panel, and prompts you inline for anything the AI
// couldn't decide. Targets stable ARIA roles to survive Google's CSS churn.

(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isEmpty = a =>
    a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0);

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

  /* ----------------------------- Form scanning ----------------------------- */
  async function waitForForm(timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector('div[role="listitem"]')) return true;
      await sleep(300);
    }
    return false;
  }

  function scanForm() {
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

  /* ----------------------------- Form filling ------------------------------ */
  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillOne(reg, ans) {
    if (!reg || isEmpty(ans)) return false;
    try {
      if (reg.kind === 'text' || reg.kind === 'textarea') {
        reg.el.focus();
        setNativeValue(reg.el, String(ans));
        return true;
      }
      if (reg.kind === 'radio') {
        const m = reg.els.find(
          r => (r.getAttribute('data-value') || r.getAttribute('aria-label')) === ans
        );
        if (m) { m.click(); return true; }
      } else if (reg.kind === 'checkbox') {
        let any = false;
        (Array.isArray(ans) ? ans : [ans]).forEach(a => {
          const m = reg.els.find(
            c => (c.getAttribute('data-answer-value') || c.getAttribute('aria-label')) === a
          );
          if (m) { m.click(); any = true; }
        });
        return any;
      } else if (reg.kind === 'dropdown') {
        reg.listbox.click();
        await sleep(250);
        const opt = [...reg.item.querySelectorAll('[role="option"]')].find(
          o => o.getAttribute('data-value') === ans
        );
        if (opt) { opt.click(); await sleep(120); return true; }
      }
    } catch (e) {
      console.warn('[form-filler] fill failed', e);
    }
    return false;
  }

  function clickSubmit() {
    const submit = [...document.querySelectorAll('div[role="button"]')].find(
      b => b.innerText && b.innerText.trim().toLowerCase() === 'submit'
    );
    if (submit) { submit.click(); return true; }
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
    setControl(/as the email to be included|record\s+\S+@\S+\s+as the email/i, true);
    setControl(/send me a copy/i, true);
  }

  /* --------------------- Inline prompt for unknown fields ------------------- */
  // Renders a small editor per undecided field; returns a getter for the values.
  function renderUnknowns(unknowns) {
    note(
      `I couldn't decide ${unknowns.length} field${unknowns.length > 1 ? 's' : ''} from your saved data. ` +
        `Fill what you can below, then click “Fill these in”.`,
      '#fef7e0'
    );
    const inputs = {};
    for (const f of unknowns) {
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
          row.append(cb, document.createTextNode(o));
          wrap.appendChild(row);
          boxes.push(cb);
        });
        inputs[f.id] = () => boxes.filter(b => b.checked).map(b => b.value);
      } else {
        const inp = document.createElement(f.type === 'paragraph' ? 'textarea' : 'input');
        inp.style.cssText = inStyle();
        inp.placeholder = 'Your answer';
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

      // Fill what the AI decided, updating the progress bar per field.
      const answers = resp.answers || {};
      let done = 0;
      UI.progress(0, total);
      for (const f of fields) {
        if (await fillOne(registry[f.id], answers[f.id])) {
          done++;
          UI.progress(done, total);
          UI.status(`Filling… ${done}/${total}`);
        }
      }
      ensureExtras();
      afterFill(answers, done, resp.resumePath);
    });

    function afterFill(answers, done, resumePath) {
      const unknowns = fields.filter(f => isEmpty(answers[f.id]));
      UI.clearList();
      UI.progress(done, total || 1);
      UI.status(`Filled ${done} of ${total} field${total === 1 ? '' : 's'}.`);

      if (fileFields.length) {
        note(
          `⬆ Resume upload is manual (Google Drive picker): click “Add File” → “Upload” tab → choose:\n${
            resumePath || 'your resume file'
          }`,
          '#fce8e6'
        );
      }

      const finishBtn = () => {
        button('Submit form', true, () => {
          if (!clickSubmit()) note('Could not find the Submit button.', '#fce8e6');
        });
      };

      if (unknowns.length) {
        const inputs = renderUnknowns(unknowns);
        button('Fill these in', true, async () => {
          let added = 0;
          for (const f of unknowns) {
            const val = inputs[f.id]();
            if (await fillOne(registry[f.id], val)) added++;
          }
          UI.clearList();
          UI.footer().innerHTML = '';
          UI.progress(done + added, total);
          UI.status(`Done — filled ${done + added} of ${total}. Review and submit.`);
          if (fileFields.length)
            note('Don’t forget the resume upload (click “Add File”).', '#fef7e0');
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
