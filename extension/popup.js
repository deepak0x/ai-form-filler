const auto = document.getElementById('autoSubmit');
const status = document.getElementById('status');

// Restore + persist the auto-submit toggle.
chrome.storage.local.get('autoSubmit').then(c => (auto.checked = !!c.autoSubmit));
auto.addEventListener('change', () =>
  chrome.storage.local.set({ autoSubmit: auto.checked })
);

// Live bridge health check.
function setStatus(color, text) {
  status.innerHTML = `<span class="dot" style="background:${color}"></span>${text}`;
}
fetch('http://127.0.0.1:8731/health')
  .then(r => r.json())
  .then(() => setStatus('#2ecc71', 'Bridge: connected'))
  .catch(() => setStatus('#c0392b', 'Bridge: not running — start server.js'));

// Manual re-trigger: re-inject the content script into the active tab.
document.getElementById('fill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/docs\.google\.com\/forms\//.test(tab.url || '')) {
    setStatus('#e67e22', 'Open a Google Form first');
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  window.close();
});
