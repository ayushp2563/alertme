/**
 * Storage utility for Alert Me watched sites.
 * Schema per site:
 * { id, url, title, favicon, selector, frequency, lastChecked,
 *   lastHash, status, paused, unread, history: [{timestamp, summary, diffSnippet}] }
 */

const StorageManager = (() => {
  const SITES_KEY = 'watchedSites';
  const SETTINGS_KEY = 'settings';
  const MAX_HISTORY = 20;
  const DEFAULT_FREQUENCY = 45; // minutes
  const DEFAULT_SIGNIFICANCE = 2; // percent

  const DEFAULT_SETTINGS = {
    significanceThreshold: DEFAULT_SIGNIFICANCE,
    globalCheckEnabled: true,
  };

  function generateId() {
    return `site_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  async function getSettings() {
    const result = await browserAPI.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  }

  async function setSettings(settings) {
    const current = await getSettings();
    await browserAPI.storage.local.set({
      [SETTINGS_KEY]: { ...current, ...settings },
    });
  }

  async function getSites() {
    const result = await browserAPI.storage.local.get(SITES_KEY);
    return result[SITES_KEY] || [];
  }

  async function saveSites(sites) {
    await browserAPI.storage.local.set({ [SITES_KEY]: sites });
  }

  async function getSite(id) {
    const sites = await getSites();
    return sites.find((s) => s.id === id) || null;
  }

  async function addSite(siteData) {
    const sites = await getSites();
    const existing = sites.find((s) => s.url === siteData.url && s.selector === (siteData.selector || null));
    if (existing) {
      return existing;
    }

    const site = {
      id: generateId(),
      url: siteData.url,
      title: siteData.title || siteData.url,
      favicon: siteData.favicon || '',
      selector: siteData.selector || null,
      frequency: siteData.frequency || DEFAULT_FREQUENCY,
      lastChecked: null,
      lastHash: null,
      status: 'pending',
      paused: false,
      unread: false,
      history: [],
      createdAt: Date.now(),
    };

    sites.push(site);
    await saveSites(sites);
    return site;
  }

  async function updateSite(id, updates) {
    const sites = await getSites();
    const index = sites.findIndex((s) => s.id === id);
    if (index === -1) return null;

    sites[index] = { ...sites[index], ...updates };
    await saveSites(sites);
    return sites[index];
  }

  async function removeSite(id) {
    const sites = await getSites();
    await saveSites(sites.filter((s) => s.id !== id));
  }

  async function addHistoryEntry(id, entry) {
    const sites = await getSites();
    const index = sites.findIndex((s) => s.id === id);
    if (index === -1) return null;

    const history = [entry, ...(sites[index].history || [])].slice(0, MAX_HISTORY);
    sites[index].history = history;
    await saveSites(sites);
    return sites[index];
  }

  async function markRead(id) {
    return updateSite(id, { unread: false });
  }

  async function markAllRead() {
    const sites = await getSites();
    const updated = sites.map((s) => ({ ...s, unread: false }));
    await saveSites(updated);
  }

  async function getUnreadCount() {
    const sites = await getSites();
    return sites.filter((s) => s.unread).length;
  }

  async function findSiteByUrl(url, selector = null) {
    const sites = await getSites();
    return sites.find((s) => s.url === url && s.selector === selector) || null;
  }

  return {
    SITES_KEY,
    SETTINGS_KEY,
    MAX_HISTORY,
    DEFAULT_FREQUENCY,
    DEFAULT_SIGNIFICANCE,
    getSettings,
    setSettings,
    getSites,
    saveSites,
    getSite,
    addSite,
    updateSite,
    removeSite,
    addHistoryEntry,
    markRead,
    markAllRead,
    getUnreadCount,
    findSiteByUrl,
  };
})();
