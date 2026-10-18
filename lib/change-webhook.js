/**
 * POST page-change events to a user-configured webhook (for mobile push, etc.).
 * No third-party libraries — fetch only.
 */

const ChangeWebhook = (() => {
  const TOKEN_KEY = 'CHANGE_WEBHOOK_TOKEN';

  async function getToken() {
    const result = await browserAPI.storage.local.get(TOKEN_KEY);
    return result[TOKEN_KEY] || null;
  }

  async function setToken(token) {
    await browserAPI.storage.local.set({ [TOKEN_KEY]: token || '' });
  }

  function buildPayload(site, diff) {
    return {
      event: 'page_changed',
      timestamp: Date.now(),
      site: {
        id: site.id,
        url: site.url,
        title: site.title,
        favicon: site.favicon || null,
        selector: site.selector || null,
      },
      change: {
        summary: diff.summary || null,
        diffSnippet: diff.diffSnippet || null,
        changePercent: typeof diff.changePercent === 'number' ? diff.changePercent : null,
      },
    };
  }

  async function notifyChange(site, diff, settings) {
    if (settings.changeWebhookEnabled === false) return { skipped: 'disabled' };

    const url = (settings.changeWebhookUrl || '').trim();
    if (!url) {
      console.warn('[Change Webhook] No URL configured');
      return { skipped: 'no_url' };
    }

    const payload = buildPayload(site, diff);
    const headers = { 'Content-Type': 'application/json' };
    const token = await getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text.slice(0, 500) };
      }

      if (!res.ok) {
        console.error('[Change Webhook] Failed:', res.status, data);
        return { ok: false, status: res.status, data };
      }

      console.log('[Change Webhook] Delivered:', res.status, data);
      return { ok: true, status: res.status, data };
    } catch (err) {
      console.error('[Change Webhook] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }

  return {
    TOKEN_KEY,
    getToken,
    setToken,
    notifyChange,
    buildPayload,
  };
})();
