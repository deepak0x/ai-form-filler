// Service worker: the only place allowed to fetch the http://127.0.0.1 bridge
// (an HTTPS form page can't, due to mixed-content rules).

const BRIDGE = 'http://127.0.0.1:8731';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FILL') {
    fetch(`${BRIDGE}/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: msg.fields })
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `bridge ${r.status}`);
        sendResponse({ ok: true, answers: data.answers, resumePath: data.resumePath });
      })
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // keep the message channel open for the async response
  }

  if (msg.type === 'RESUME') {
    fetch(`${BRIDGE}/resume`)
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `bridge ${r.status}`);
        }
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        sendResponse({
          ok: true,
          data: btoa(bin),
          mime: r.headers.get('Content-Type') || 'application/octet-stream'
        });
      })
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }

  if (msg.type === 'REMEMBER') {
    fetch(`${BRIDGE}/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: msg.items })
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `bridge ${r.status}`);
        sendResponse({ ok: true, saved: data.saved });
      })
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
});
