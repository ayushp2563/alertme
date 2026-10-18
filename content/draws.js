/**
 * OINP / RCIP / FCIP draw extraction on official pages (live DOM).
 */
(function () {
  function extractDrawsFromDocument() {
    const html = document.documentElement.outerHTML;
    const url = location.href;
    if (typeof DrawParser === 'undefined') {
      return { draws: [], error: 'DrawParser not loaded' };
    }
    return { draws: DrawParser.extractDrawsFromHtml(html, url), url };
  }

  browserAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_DRAWS') {
      sendResponse(extractDrawsFromDocument());
      return;
    }
    if (message.type === 'RUN_DRAW_EXTRACTOR') {
      const result = extractDrawsFromDocument();
      if (result.draws?.length > 0) {
        browserAPI.runtime.sendMessage({ type: 'INGEST_DRAWS', draws: result.draws, url: result.url });
      }
      sendResponse(result);
      return;
    }
  });
})();
