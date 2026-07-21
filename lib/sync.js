/**
 * Cross-device sync via browser account (chrome.storage.sync / browser.storage.sync).
 * Syncs watch lists and change notification events across devices on the same account.
 */

const SyncManager = (() => {
  const SYNC_SITES_KEY = 'syncedWatchList';
  const SYNC_EVENTS_KEY = 'crossDeviceEvents';
  const SYNC_META_KEY = 'syncMeta';
  const PROCESSED_EVENTS_KEY = 'processedEventIds';
  const DEVICE_ID_KEY = 'deviceId';
  const SYNC_CLICK_KEY = 'syncNotificationUrls';
  const MAX_SYNC_EVENTS = 15;
  const MAX_PROCESSED_IDS = 100;

  function makeSyncKey(url, selector = null) {
    return `${url}|${selector || ''}`;
  }

  async function getDeviceId() {
    const result = await browserAPI.storage.local.get(DEVICE_ID_KEY);
    if (result[DEVICE_ID_KEY]) return result[DEVICE_ID_KEY];

    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await browserAPI.storage.local.set({ [DEVICE_ID_KEY]: id });
    return id;
  }

  function compactSite(site) {
    return {
      syncKey: makeSyncKey(site.url, site.selector),
      url: site.url,
      title: site.title,
      favicon: site.favicon || '',
      selector: site.selector || null,
      frequency: site.frequency || StorageManager.DEFAULT_FREQUENCY,
      paused: !!site.paused,
      snoozedUntil: site.snoozedUntil || null,
      updatedAt: Date.now(),
    };
  }

  async function isSyncEnabled() {
    const settings = await StorageManager.getSettings();
    return settings.crossDeviceSync !== false;
  }

  async function pushWatchList(sites) {
    if (!(await isSyncEnabled())) return;

    const payload = {
      registryVersion: Date.now(),
      sites: sites.map(compactSite),
    };

    await browserAPI.storage.sync.set({
      [SYNC_SITES_KEY]: payload,
      [SYNC_META_KEY]: { lastPush: Date.now() },
    });
  }

  async function broadcastChangeEvent(site, diff) {
    if (!(await isSyncEnabled())) return;

    const settings = await StorageManager.getSettings();
    if (settings.crossDeviceNotifications === false) return;

    const deviceId = await getDeviceId();
    const eventsResult = await browserAPI.storage.sync.get(SYNC_EVENTS_KEY);
    const existing = eventsResult[SYNC_EVENTS_KEY] || [];

    const event = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      syncKey: makeSyncKey(site.url, site.selector),
      url: site.url,
      title: site.title,
      favicon: site.favicon || '',
      selector: site.selector || null,
      summary: diff.summary,
      diffSnippet: (diff.diffSnippet || '').slice(0, 300),
      timestamp: Date.now(),
      sourceDeviceId: deviceId,
    };

    const events = [event, ...existing.filter((e) => e.eventId !== event.eventId)].slice(0, MAX_SYNC_EVENTS);
    await browserAPI.storage.sync.set({ [SYNC_EVENTS_KEY]: events });
  }

  async function getProcessedEventIds() {
    const result = await browserAPI.storage.local.get(PROCESSED_EVENTS_KEY);
    return new Set(result[PROCESSED_EVENTS_KEY] || []);
  }

  async function markEventProcessed(eventId) {
    const processed = await getProcessedEventIds();
    processed.add(eventId);
    const list = [...processed].slice(-MAX_PROCESSED_IDS);
    await browserAPI.storage.local.set({ [PROCESSED_EVENTS_KEY]: list });
  }

  async function storeSyncClickUrl(eventId, url) {
    const result = await browserAPI.storage.local.get(SYNC_CLICK_KEY);
    const map = result[SYNC_CLICK_KEY] || {};
    map[eventId] = url;
    await browserAPI.storage.local.set({ [SYNC_CLICK_KEY]: map });
  }

  async function getSyncClickUrl(eventId) {
    const result = await browserAPI.storage.local.get(SYNC_CLICK_KEY);
    return result[SYNC_CLICK_KEY]?.[eventId] || null;
  }

  async function mergeWatchListFromSync() {
    if (!(await isSyncEnabled())) return;

    const syncResult = await browserAPI.storage.sync.get([SYNC_SITES_KEY, SYNC_META_KEY]);
    const payload = syncResult[SYNC_SITES_KEY];
    if (!payload?.sites) return;

    const localMeta = await browserAPI.storage.local.get('lastMergedRegistryVersion');
    if (payload.registryVersion <= (localMeta.lastMergedRegistryVersion || 0)) return;

    const localSites = await StorageManager.getSites();
    const localByKey = new Map(localSites.map((s) => [makeSyncKey(s.url, s.selector), s]));

    for (const synced of payload.sites) {
      const local = localByKey.get(synced.syncKey);
      if (!local) {
        await StorageManager.addSite({
          url: synced.url,
          title: synced.title,
          favicon: synced.favicon,
          selector: synced.selector,
          frequency: synced.frequency,
          paused: synced.paused,
          snoozedUntil: synced.snoozedUntil,
        });
      } else {
        await StorageManager.updateSite(local.id, {
          title: synced.title,
          favicon: synced.favicon,
          frequency: synced.frequency,
          paused: synced.paused,
          snoozedUntil: synced.snoozedUntil,
        });
      }
    }

    const syncedKeys = new Set(payload.sites.map((s) => s.syncKey));
    const toRemove = localSites.filter(
      (local) => !syncedKeys.has(makeSyncKey(local.url, local.selector))
    );
    for (const site of toRemove) {
      await StorageManager.removeSite(site.id);
    }

    await browserAPI.storage.local.set({ lastMergedRegistryVersion: payload.registryVersion });
  }

  async function processIncomingEvents(showNotification) {
    if (!(await isSyncEnabled())) return;

    const settings = await StorageManager.getSettings();
    if (settings.crossDeviceNotifications === false) return;

    const deviceId = await getDeviceId();
    const eventsResult = await browserAPI.storage.sync.get(SYNC_EVENTS_KEY);
    const events = eventsResult[SYNC_EVENTS_KEY] || [];
    const processed = await getProcessedEventIds();

    for (const event of events) {
      if (processed.has(event.eventId)) continue;
      if (event.sourceDeviceId === deviceId) {
        await markEventProcessed(event.eventId);
        continue;
      }

      await markEventProcessed(event.eventId);

      const localSite = await StorageManager.findSiteByUrl(event.url, event.selector ?? null);
      if (localSite) {
        await StorageManager.updateSite(localSite.id, { unread: true, status: 'changed' });
      }

      if (showNotification) {
        await showNotification(event, settings);
      }
    }
  }

  function initSyncListener(onSyncChange) {
    browserAPI.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes[SYNC_SITES_KEY] || changes[SYNC_EVENTS_KEY]) {
        onSyncChange(changes);
      }
    });
  }

  return {
    makeSyncKey,
    getDeviceId,
    pushWatchList,
    broadcastChangeEvent,
    mergeWatchListFromSync,
    processIncomingEvents,
    markEventProcessed,
    storeSyncClickUrl,
    getSyncClickUrl,
    initSyncListener,
    isSyncEnabled,
  };
})();
