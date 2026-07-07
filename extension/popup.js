// Minimal action popup — reports pairing state only. Pairing itself happens in the desktop app, which
// writes the token into chrome.storage.local; the popup never mints or manages tokens (thin extension).
(function () {
  var el = document.getElementById('status');
  if (!el || typeof chrome === 'undefined' || !chrome.storage) return;
  chrome.storage.local.get('jat12Token', function (got) {
    var token = got && got.jat12Token;
    if (typeof token === 'string' && token.length > 0) {
      el.textContent = 'Paired — driving from the app';
      el.className = 'status paired';
    } else {
      el.textContent = 'Not paired — open the JAT 12 app';
      el.className = 'status unpaired';
    }
  });
})();
