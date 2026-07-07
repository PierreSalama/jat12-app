// Action popup — FINDS the desktop app on the loopback, PAIRS (fetches + stores the token the SW uses),
// or offers the download. This is the "extension leads you to the app / newest version" flow: the app
// is the brain, the extension pairs to it automatically when it's running.
(function () {
  var PORTS = [7845, 7846]; // prod, then dev
  var RELEASES = 'https://github.com/PierreSalama/jat12-app/releases/latest';
  var TOKEN_KEY = 'jat12Token'; // MUST match sw.ts TOKEN_KEY

  var statusEl = document.getElementById('status');
  var verEl = document.getElementById('ver');
  var connectBtn = document.getElementById('connect');
  var downloadBtn = document.getElementById('download');

  function set(text, cls) { statusEl.textContent = text; statusEl.className = 'status ' + cls; }

  async function probe() {
    set('Looking for the app…', 'idle');
    if (downloadBtn) downloadBtn.hidden = true;
    if (connectBtn) connectBtn.hidden = true;

    for (var i = 0; i < PORTS.length; i++) {
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 900);
        var res = await fetch('http://127.0.0.1:' + PORTS[i] + '/api/pair/token', { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        var body = await res.json();
        if (body && body.token) {
          await chrome.storage.local.set({ [TOKEN_KEY]: body.token }); // the SW auto-connects on this change
          set('Paired — driving from the app', 'paired');
          if (verEl) verEl.textContent = (body.productName || 'JAT 12') + ' v' + (body.version || '') + (PORTS[i] === 7846 ? ' (dev)' : '');
          return true;
        }
      } catch (e) {
        /* try the next port */
      }
    }

    // not found on any loopback port → the app isn't running/installed
    set('JAT 12 app not found on this PC', 'unpaired');
    if (verEl) verEl.textContent = 'Start it if installed, or download the newest version:';
    if (connectBtn) connectBtn.hidden = false;
    if (downloadBtn) { downloadBtn.hidden = false; downloadBtn.setAttribute('href', RELEASES); }
    return false;
  }

  if (connectBtn) connectBtn.addEventListener('click', probe);
  if (typeof chrome !== 'undefined' && chrome.storage) probe();
  else set('Open this in the extension', 'idle');
})();
