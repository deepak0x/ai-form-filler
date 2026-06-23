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
});
