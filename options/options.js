const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let selectedSiteId = null;

async function init() {
  await renderSitesTable();
  await loadSettings();
  bindEvents();
}

async function renderSitesTable() {
  const sites = await StorageManager.getSites();
  const container = $('#sites-table');

  if (sites.length === 0) {
    container.innerHTML = '<p class="empty-state">No sites being watched. Use the extension popup to add one.</p>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Site</th>
          <th>Status</th>
          <th>Frequency</th>
          <th>Last checked</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${sites.map(renderSiteRow).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', handleRowAction);
  });

  container.querySelectorAll('[data-site-id]').forEach((row) => {
    if (row.tagName === 'TR') {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        showSiteDetail(row.dataset.siteId);
      });
    }
  });
}

function renderSiteRow(site) {
  const status = site.paused ? 'paused' : (site.status || 'pending');
  const lastChecked = site.lastChecked ? formatDate(site.lastChecked) : 'Never';

  return `
    <tr data-site-id="${site.id}" style="cursor:pointer">
      <td>
        <div class="site-cell">
          ${site.favicon ? `<img src="${escapeHtml(site.favicon)}" alt="">` : ''}
          <div>
            <div class="title">${escapeHtml(site.title)}${site.unread ? ' ●' : ''}</div>
            <div class="url">${escapeHtml(truncate(site.url, 60))}</div>
          </div>
        </div>
      </td>
      <td><span class="status-badge status-${status}">${status}</span></td>
      <td>${site.frequency}m</td>
      <td>${lastChecked}</td>
      <td>
        <div class="row-actions">
          <button data-action="pause" data-site-id="${site.id}">${site.paused ? 'Resume' : 'Pause'}</button>
          <button data-action="check" data-site-id="${site.id}">Check</button>
          <button data-action="remove" data-site-id="${site.id}">Remove</button>
        </div>
      </td>
    </tr>
  `;
}

async function showSiteDetail(siteId) {
  selectedSiteId = siteId;
  const site = await StorageManager.getSite(siteId);
  if (!site) return;

  $('#sites-table').classList.add('hidden');
  $('#site-detail').classList.remove('hidden');

  const history = site.history || [];

  $('#detail-content').innerHTML = `
    <div class="detail-header">
      ${site.favicon ? `<img src="${escapeHtml(site.favicon)}" alt="">` : ''}
      <div>
        <h3>${escapeHtml(site.title)}</h3>
        <div class="url">${escapeHtml(site.url)}</div>
        ${site.selector ? `<div class="url">Selector: ${escapeHtml(site.selector)}</div>` : ''}
      </div>
    </div>

    <div class="detail-controls">
      <label>
        Check every
        <input type="number" class="frequency-input" id="edit-frequency" min="1" max="1440" value="${site.frequency}">
        minutes
      </label>
      <button class="btn btn-secondary" id="btn-save-frequency">Save</button>
      <button class="btn btn-danger" id="btn-remove-site">Remove site</button>
      ${site.unread ? '<button class="btn btn-secondary" id="btn-mark-read">Mark as read</button>' : ''}
    </div>

    <h4 style="margin-bottom:12px;font-size:14px;color:#888">Change history</h4>
    ${history.length === 0
      ? '<p class="empty-state" style="padding:20px">No changes detected yet</p>'
      : `<ul class="history-list">${history.map(renderHistoryItem).join('')}</ul>`
    }
  `;

  $('#btn-save-frequency')?.addEventListener('click', async () => {
    const freq = parseInt($('#edit-frequency').value, 10);
    if (freq >= 1) {
      await browserAPI.runtime.sendMessage({
        type: 'UPDATE_SITE',
        siteId,
        updates: { frequency: freq },
      });
      await showSiteDetail(siteId);
    }
  });

  $('#btn-remove-site')?.addEventListener('click', async () => {
    if (confirm('Remove this site from watching?')) {
      await browserAPI.runtime.sendMessage({ type: 'UNWATCH_PAGE', siteId });
      hideSiteDetail();
      await renderSitesTable();
    }
  });

  $('#btn-mark-read')?.addEventListener('click', async () => {
    await browserAPI.runtime.sendMessage({ type: 'MARK_READ', siteId });
    await showSiteDetail(siteId);
  });
}

function renderHistoryItem(entry) {
  return `
    <li class="history-item">
      <div class="history-time">${formatDate(entry.timestamp)} · ${entry.changePercent?.toFixed(1) || '?'}% changed</div>
      <div class="history-summary">${escapeHtml(entry.summary)}</div>
      <pre class="history-snippet">${escapeHtml(entry.diffSnippet)}</pre>
    </li>
  `;
}

function hideSiteDetail() {
  selectedSiteId = null;
  $('#site-detail').classList.add('hidden');
  $('#sites-table').classList.remove('hidden');
}

async function handleRowAction(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const siteId = btn.dataset.siteId;
  const action = btn.dataset.action;

  switch (action) {
    case 'pause': {
      const site = await StorageManager.getSite(siteId);
      await browserAPI.runtime.sendMessage({
        type: 'UPDATE_SITE',
        siteId,
        updates: { paused: !site.paused },
      });
      break;
    }
    case 'check':
      await browserAPI.runtime.sendMessage({ type: 'CHECK_NOW' });
      break;
    case 'remove':
      if (confirm('Remove this site?')) {
        await browserAPI.runtime.sendMessage({ type: 'UNWATCH_PAGE', siteId });
      }
      break;
  }

  await renderSitesTable();
}

async function loadSettings() {
  const settings = await StorageManager.getSettings();
  $('#significance-threshold').value = settings.significanceThreshold;
  $('#global-check-enabled').checked = settings.globalCheckEnabled;
}

function bindEvents() {
  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach((v) => v.classList.add('hidden'));
      $(`#view-${btn.dataset.view}`).classList.remove('hidden');
      if (btn.dataset.view === 'sites') hideSiteDetail();
    });
  });

  $('#btn-back').addEventListener('click', () => {
    hideSiteDetail();
    renderSitesTable();
  });

  $('#btn-check-all').addEventListener('click', async () => {
    $('#btn-check-all').textContent = 'Checking…';
    await browserAPI.runtime.sendMessage({ type: 'CHECK_NOW' });
    await renderSitesTable();
    $('#btn-check-all').textContent = 'Check all now';
  });

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await StorageManager.setSettings({
      significanceThreshold: parseFloat($('#significance-threshold').value),
      globalCheckEnabled: $('#global-check-enabled').checked,
    });
    const btn = e.target.querySelector('[type=submit]');
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save settings'; }, 1500);
  });

  $('#link-full-privacy').addEventListener('click', (e) => {
    e.preventDefault();
    browserAPI.tabs.create({ url: browserAPI.runtime.getURL('privacy.html') });
  });
}

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
