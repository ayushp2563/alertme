/**
 * Alert Me — background service worker.
 * Handles alarm scheduling, page fetching, change detection, notifications,
 * and cross-device sync via the browser account.
 */

importScripts('../lib/browser.js', '../lib/storage.js', '../lib/diff.js', '../lib/sync.js');

const ALARM_NAME = 'alert-me-check';
const BADGE_COLOR = '#E85D04';

browserAPI.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    await removeLegacyTestSite();
  }
  await scheduleNextCheck();
  await SyncManager.mergeWatchListFromSync();
});

browserAPI.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await runAllChecks();
    await scheduleNextCheck();
  }
});

browserAPI.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('alert-me-sync-')) {
    const eventId = notificationId.replace('alert-me-sync-', '');
    const url = await SyncManager.getSyncClickUrl(eventId);
    if (url) {
      await browserAPI.tabs.create({ url });
      const sites = await StorageManager.getSites();
      const site = sites.find((s) => s.url === url);
      if (site) await StorageManager.markRead(site.id);
      await updateBadge();
    }
    return;
  }

  const siteId = notificationId.replace('alert-me-', '');
  const site = await StorageManager.getSite(siteId);
  if (site) {
    await browserAPI.tabs.create({ url: site.url });
    await StorageManager.markRead(siteId);
    await updateBadge();
  }
});

browserAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

SyncManager.initSyncListener(async () => {
  await SyncManager.mergeWatchListFromSync();
  await SyncManager.processIncomingEvents(showCrossDeviceNotification);
  await scheduleNextCheck();
  await updateBadge();
});

async function handleMessage(message) {
  switch (message.type) {
    case 'CHECK_NOW':
      await runAllChecks({ force: true });
      return { ok: true };
    case 'WATCH_PAGE':
      return watchPage(message.payload);
    case 'UNWATCH_PAGE':
      await StorageManager.removeSite(message.siteId);
      await syncWatchList();
      await scheduleNextCheck();
      return { ok: true };
    case 'GET_SITES':
      return StorageManager.getSites();
    case 'GET_CURRENT_TAB':
      return getCurrentTabInfo();
    case 'MARK_READ':
      await StorageManager.markRead(message.siteId);
      await updateBadge();
      return { ok: true };
    case 'MARK_ALL_READ':
      await StorageManager.markAllRead();
      await updateBadge();
      return { ok: true };
    case 'UPDATE_SITE':
      await StorageManager.updateSite(message.siteId, message.updates);
      await syncWatchList();
      await scheduleNextCheck();
      return { ok: true };
    case 'SNOOZE_SITE':
      await StorageManager.snoozeSite(message.siteId, message.hours);
      await syncWatchList();
      return { ok: true };
    case 'SYNC_WATCH_LIST':
      await syncWatchList();
      return { ok: true };
    case 'START_PICKER':
      return startPickerOnTab(message.tabId);
    default:
      return { error: 'Unknown message type' };
  }
}

async function getCurrentTabInfo() {
  const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension://')) {
    return { error: 'Cannot watch this page' };
  }
  const site = await StorageManager.findSiteByUrl(tab.url, null);
  return {
    url: tab.url,
    title: tab.title,
    favicon: tab.favIconUrl || '',
    isWatched: !!site,
    siteId: site?.id || null,
  };
}

async function watchPage(payload) {
  const site = await StorageManager.addSite({
    url: payload.url,
    title: payload.title,
    favicon: payload.favicon,
    selector: payload.selector || null,
    frequency: payload.frequency || StorageManager.DEFAULT_FREQUENCY,
  });
  await syncWatchList();
  await scheduleNextCheck();
  await checkSite(site);
  return site;
}

async function syncWatchList() {
  const sites = await StorageManager.getSites();
  await SyncManager.pushWatchList(sites);
}

async function startPickerOnTab(tabId) {
  await browserAPI.tabs.sendMessage(tabId, { type: 'START_PICKER' });
  return { ok: true };
}

async function scheduleNextCheck() {
  const sites = await StorageManager.getSites();
  const activeSites = sites.filter((s) => !s.paused && !StorageManager.isSnoozed(s));

  if (activeSites.length === 0) {
    await browserAPI.alarms.clear(ALARM_NAME);
    return;
  }

  const minFrequency = Math.min(...activeSites.map((s) => s.frequency || StorageManager.DEFAULT_FREQUENCY));
  const delayMinutes = Math.max(1, minFrequency);

  await browserAPI.alarms.create(ALARM_NAME, { delayInMinutes: delayMinutes });
}

async function removeLegacyTestSite() {
  const sites = await StorageManager.getSites();
  const cleaned = sites.filter(
    (s) => !(s.url === 'https://example.com' && s.title === 'Example Domain (test)')
  );
  if (cleaned.length !== sites.length) {
    await StorageManager.saveSites(cleaned);
  }
}

async function runAllChecks({ force = false } = {}) {
  const settings = await StorageManager.getSettings();
  if (!settings.globalCheckEnabled) return;

  const sites = await StorageManager.getSites();
  const now = Date.now();

  for (const site of sites) {
    if (site.paused) continue;

    const frequencyMs = (site.frequency || StorageManager.DEFAULT_FREQUENCY) * 60 * 1000;
    const lastChecked = site.lastChecked || 0;

    if (force || now - lastChecked >= frequencyMs) {
      await checkSite(site);
    }
  }

  await updateBadge();
}

async function checkSite(site) {
  const settings = await StorageManager.getSettings();

  try {
    const html = await fetchPageHtml(site.url);
    const text = DiffUtil.extractTextFromHtml(html, site.selector);
    const hash = await DiffUtil.computeHash(text);

    const updates = {
      lastChecked: Date.now(),
      status: 'unchanged',
    };

    if (site.lastHash && site.lastHash !== hash) {
      const previousText = site._lastText || '';
      const diff = DiffUtil.computeDiff(previousText, text);

      if (DiffUtil.isSignificant(diff.changePercent, settings.significanceThreshold)) {
        updates.status = 'changed';
        updates.lastHash = hash;

        const historyEntry = {
          timestamp: Date.now(),
          summary: diff.summary,
          diffSnippet: diff.diffSnippet,
          changePercent: diff.changePercent,
        };

        await StorageManager.addHistoryEntry(site.id, historyEntry);

        const freshSite = { ...site, ...updates };
        if (StorageManager.shouldNotify(freshSite, settings)) {
          updates.unread = true;
          await sendChangeNotification(freshSite, diff);
          await SyncManager.broadcastChangeEvent(freshSite, diff);
        }
      } else {
        updates.lastHash = hash;
        updates.status = 'unchanged';
      }
    } else if (!site.lastHash) {
      updates.lastHash = hash;
      updates.status = 'unchanged';
    }

    updates._lastText = text.slice(0, 50000);

    await StorageManager.updateSite(site.id, updates);
  } catch (err) {
    console.error(`Check failed for ${site.url}:`, err);
    await StorageManager.updateSite(site.id, {
      lastChecked: Date.now(),
      status: 'error',
      lastError: err.message,
    });
  }
}

async function fetchPageHtml(url) {
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } catch (fetchErr) {
    return fetchViaHiddenTab(url);
  }
}

async function fetchViaHiddenTab(url) {
  let tab;
  try {
    tab = await browserAPI.tabs.create({ url, active: false });

    await waitForTabLoad(tab.id);

    const results = await browserAPI.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });

    return results[0]?.result || '';
  } finally {
    if (tab?.id) {
      await browserAPI.tabs.remove(tab.id).catch(() => {});
    }
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browserAPI.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        browserAPI.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1000);
      }
    }

    browserAPI.tabs.onUpdated.addListener(listener);
  });
}

async function sendChangeNotification(site, diff) {
  const notificationId = `alert-me-${site.id}`;

  await browserAPI.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: site.favicon || browserAPI.runtime.getURL('icons/icon128.png'),
    title: `${site.title} changed`,
    message: diff.summary,
    contextMessage: `${diff.diffSnippet.slice(0, 200)} — Click to visit`,
    priority: 2,
  });

  await updateBadge();
}

async function showCrossDeviceNotification(event, settings) {
  if (StorageManager.isQuietHours(settings)) return;

  const notificationId = `alert-me-sync-${event.eventId}`;
  await SyncManager.storeSyncClickUrl(event.eventId, event.url);

  await browserAPI.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: event.favicon || browserAPI.runtime.getURL('icons/icon128.png'),
    title: `${event.title} was updated`,
    message: event.summary || 'Content changed on a page you watch',
    contextMessage: 'Detected on another device — Click to visit',
    priority: 2,
  });

  await updateBadge();
}

async function updateBadge() {
  const count = await StorageManager.getUnreadCount();

  if (count > 0) {
    await browserAPI.action.setBadgeText({ text: String(count) });
    await browserAPI.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } else {
    await browserAPI.action.setBadgeText({ text: '' });
  }
}

// Process any pending cross-device events on startup
SyncManager.mergeWatchListFromSync()
  .then(() => SyncManager.processIncomingEvents(showCrossDeviceNotification))
  .then(updateBadge);

updateBadge();
