/**
 * POST extracted draw data to the Lovable ingest webhook.
 */

const DrawIngest = (() => {
  const ENDPOINT = 'https://id-preview--51a5cb45-d624-45a0-a8d9-8e823d3a5f49.lovable.app/api/public/draws/update';
  const TOKEN_KEY = 'DRAW_INGEST_TOKEN';

  async function getToken() {
    const result = await browserAPI.storage.local.get(TOKEN_KEY);
    return result[TOKEN_KEY] || null;
  }

  async function setToken(token) {
    await browserAPI.storage.local.set({ [TOKEN_KEY]: token || '' });
  }

  async function sendDraws(draws) {
    const normalized = (draws || []).map((d) => DrawParser.normalizeDraw(d))
      .filter((d) => d.draw_date && d.program);

    if (normalized.length === 0) {
      console.warn('[OINP Draws] No valid draws to send');
      return { ok: false, reason: 'no_draws' };
    }

    const token = await getToken();
    if (!token) {
      console.error('[OINP Draws] No ingest token configured (DRAW_INGEST_TOKEN)');
      return { ok: false, reason: 'no_token' };
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ draws: normalized }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('[OINP Draws] Ingest failed:', res.status, data);
      await notifyIngestResult(false, data, normalized.length);
      return { ok: false, status: res.status, data };
    }

    console.log('[OINP Draws] Ingested:', data);
    await notifyIngestResult(true, data, normalized.length);
    return { ok: true, data };
  }

  async function notifyIngestResult(success, data, sentCount) {
    const inserted = data?.inserted_count ?? 0;
    const skipped = data?.skipped?.length ?? 0;

    if (success) {
      await browserAPI.notifications.create(`draw-ingest-${Date.now()}`, {
        type: 'basic',
        iconUrl: browserAPI.runtime.getURL('icons/icon128.png'),
        title: 'Draw data ingested',
        message: `${inserted} draw(s) saved · ${sentCount} sent · ${skipped} skipped`,
      });
    } else {
      await browserAPI.notifications.create(`draw-ingest-err-${Date.now()}`, {
        type: 'basic',
        iconUrl: browserAPI.runtime.getURL('icons/icon128.png'),
        title: 'Draw ingest failed',
        message: typeof data === 'object' ? JSON.stringify(data).slice(0, 180) : 'Check service worker console',
      });
    }
  }

  return {
    ENDPOINT,
    TOKEN_KEY,
    getToken,
    setToken,
    sendDraws,
  };
})();
