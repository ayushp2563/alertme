const $ = (sel) => document.querySelector(sel);

async function init() {
  await loadCurrentPage();
  await loadSitesList();
  bindEvents();
}

async function loadCurrentPage() {
  const info = await browserAPI.runtime.sendMessage({ type: 'GET_CURRENT_TAB' });

  if (info.error) {
    $('#current-page').innerHTML = `<p class="error-msg">${info.error}</p>`;
    return;
  }

  $('#page-title').textContent = info.title || info.url;
  $('#page-url').textContent = info.url;

  if (info.favicon) {
    const favicon = $('#page-favicon');
    favicon.src = info.favicon;
    favicon.hidden = false;
  }

  if (info.isWatched) {
    $('#btn-watch').classList.add('hidden');
    $('#btn-watch-section').classList.add('hidden');
    $('#btn-unwatch').classList.remove('hidden');
    $('#btn-unwatch').dataset.siteId = info.siteId;
  }
}

async function loadSitesList() {
  const sites = await browserAPI.runtime.sendMessage({ type: 'GET_SITES' });
  const list = $('#sites-list');

  const unreadCount = sites.filter((s) => s.unread).length;
  const badge = $('#unread-badge');
  if (unreadCount > 0) {
    badge.textContent = unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (sites.length === 0) {
    list.innerHTML = '<li class="empty-state">No sites watched yet</li>';
    return;
  }

  list.innerHTML = sites.map(renderSiteItem).join('');
  list.querySelectorAll('.site-item').forEach((el) => {
    el.addEventListener('click', () => {
      browserAPI.tabs.create({ url: el.dataset.url });
    });
  });
}

function renderSiteItem(site) {
  const isSnoozed = site.snoozedUntil && site.snoozedUntil > Date.now();
  const statusClass = site.paused ? 'status-paused' : (isSnoozed ? 'status-paused' : `status-${site.status || 'pending'}`);
  const lastChecked = site.lastChecked
    ? formatRelativeTime(site.lastChecked)
    : 'Never checked';
  const snoozeNote = isSnoozed ? ' · snoozed' : '';

  return `
    <li class="site-item" data-url="${escapeHtml(site.url)}" data-id="${site.id}">
      ${site.favicon ? `<img class="favicon" src="${escapeHtml(site.favicon)}" alt="">` : '<span class="status-dot ' + statusClass + '"></span>'}
      <div class="site-details">
        <div class="site-name">${escapeHtml(site.title)}</div>
        <div class="site-meta">${lastChecked} · every ${site.frequency}m${snoozeNote}</div>
      </div>
      ${site.unread ? '<span class="unread-dot"></span>' : ''}
    </li>
  `;
}

function bindEvents() {
  $('#btn-watch').addEventListener('click', async () => {
    const info = await browserAPI.runtime.sendMessage({ type: 'GET_CURRENT_TAB' });
    if (info.error) return;

    await browserAPI.runtime.sendMessage({
      type: 'WATCH_PAGE',
      payload: {
        url: info.url,
        title: info.title,
        favicon: info.favicon,
      },
    });

    window.close();
  });

  $('#btn-watch-section').addEventListener('click', async () => {
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    await browserAPI.runtime.sendMessage({ type: 'START_PICKER', tabId: tab.id });
    window.close();
  });

  $('#btn-unwatch').addEventListener('click', async () => {
    const siteId = $('#btn-unwatch').dataset.siteId;
    await browserAPI.runtime.sendMessage({ type: 'UNWATCH_PAGE', siteId });
    window.close();
  });

  $('#btn-check-now').addEventListener('click', async () => {
    $('#btn-check-now').textContent = 'Checking…';
    await browserAPI.runtime.sendMessage({ type: 'CHECK_NOW' });
    await loadSitesList();
    $('#btn-check-now').textContent = 'Check now';
  });

  $('#btn-mark-all-read').addEventListener('click', async () => {
    await browserAPI.runtime.sendMessage({ type: 'MARK_ALL_READ' });
    await loadSitesList();
  });

  $('#link-dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    browserAPI.runtime.openOptionsPage();
  });

  $('#link-privacy').addEventListener('click', (e) => {
    e.preventDefault();
    browserAPI.tabs.create({ url: browserAPI.runtime.getURL('privacy.html') });
  });
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
