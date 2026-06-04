/* ============================================================
   TRAPICO — Dispatch frontend backend connector
   ============================================================ */

'use strict';

let DISPATCH_USER = null;
let QUEUE_DATA = [];
let FIELD_OFFICERS_DATA = [];
let DISPATCH_OFFICERS_DATA = [];
let OFFICERS_DATA = [];
let ACTIVE_CASES = [];
let dispatchSelectedOfficerId = null;
let dispatchNotifOpen = false;
let dispatchActiveQueueTab = 'submitted';
let activeChat = null;
let chatInterval = null;
let chatLastId = 0;
let officerChatAlertInterval = null;
let officerChatAlertMap = {};
let officerLastIncomingMap = {};
let officerUnreadCountMap = {};

/* ── Live Officer Map state ── */
let _dashMap = null;
let _dashMarkers = {};
let _officersMap = null;
let _officersMarkers = {};
let _mapRefreshInterval = null;

/* ── Active Case Maps state ── */
let _activeCaseMaps = {};
let _countdownTimers = {};

const BRGY_CENTERS = {
    'Commonwealth':  [14.6760, 121.0437],
    'Batasan Hills': [14.6915, 121.0507],
    'Central':       [14.6390, 121.0100],
    'Sto. Cristo':   [14.6280, 120.9872],
};

function _officerLatLng(o) {
    const lat = parseFloat(o.lat);
    const lng = parseFloat(o.lng);
    if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) return [lat, lng];
    const base = BRGY_CENTERS[o.brgy] || [14.6760, 121.0437];
    const id = parseInt(o.id || 0);
    const angle = (id * 47) % 360;
    const radius = 0.0012 + (id % 5) * 0.0004;
    return [
        base[0] + radius * Math.sin(angle * Math.PI / 180),
        base[1] + radius * Math.cos(angle * Math.PI / 180),
    ];
}

function _normalizeOfficerSets(resp = {}) {
  const field = Array.isArray(resp.field_officers) ? resp.field_officers : (Array.isArray(resp.officers) ? resp.officers : []);
  const dispatch = Array.isArray(resp.dispatch_officers) ? resp.dispatch_officers : [];
  const all = Array.isArray(resp.all_officers) ? resp.all_officers : [...field, ...dispatch];

  FIELD_OFFICERS_DATA = field;
  DISPATCH_OFFICERS_DATA = dispatch;
  OFFICERS_DATA = all;
}

function _badgeClassByStatus(status) {
  if (status === 'available' || status === 'on_duty') return 'badge-verified';
  if (status === 'offline') return 'badge-closed';
  return 'badge-assigned';
}

function _officerRoleLabel(officer) {
  return officer.officer_role === 'dispatch_officer' ? 'Dispatch' : 'Field';
}

function _chatReceiverRole(officer) {
    return officer?.officer_role === 'dispatch_officer' ? 'dispatch' : 'field';
}

function _chatPartnerKey(receiverRole, receiverId) {
    return `${String(receiverRole)}:${String(receiverId)}`;
}

function getOfficerUnreadTotal() {
  return Object.values(officerUnreadCountMap).reduce((sum, n) => sum + Number(n || 0), 0);
}

function updateOfficerNavBadge() {
  const badge = document.getElementById('badge-officers-msg');
  if (!badge) return;
  const total = getOfficerUnreadTotal();
  badge.textContent = String(total);
  badge.classList.toggle('hidden', total <= 0);
}

function clearOfficerMessageAlerts() {
  Object.keys(officerChatAlertMap).forEach(key => { officerChatAlertMap[key] = false; });
  Object.keys(officerUnreadCountMap).forEach(key => { officerUnreadCountMap[key] = 0; });
  refreshOfficerContactButtonStyles();
  updateOfficerNavBadge();
}

function _officerIcon(status) {
    const colors = {available: '#2A9D5C', busy: '#E63946', offline: '#8A8A8A'};
    const c = colors[status] || colors.offline;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 40'><path d='M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26S28 24.5 28 14C28 6.268 21.732 0 14 0z' fill='${c}'/><circle cx='14' cy='14' r='6' fill='white'/></svg>`;
    return L.divIcon({
        html: `<div style="width:28px;height:40px">${svg}</div>`,
        className: '',
        iconSize: [28, 40],
        iconAnchor: [14, 40],
        popupAnchor: [0, -40],
    });
}

function _buildOfficerPopup(o) {
    const statusLabel = {available: '● Available', busy: '● On Duty', offline: '○ Offline'};
    const statusColor = {available: '#2A9D5C', busy: '#E63946', offline: '#8A8A8A'};
    const s = o.status || 'offline';
    return `<div style="font-family:var(--font-body,sans-serif);min-width:160px">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px">${safeText(o.name)}</div>
      <div style="font-size:12px;color:#555;margin-bottom:4px">Brgy. ${safeText(o.brgy)}</div>
      <div style="font-size:12px;font-weight:600;color:${statusColor[s]}">${statusLabel[s] || s}</div>
      ${o.gps_last_updated ? `<div style="font-size:10px;color:#999;margin-top:4px">Updated: ${new Date(o.gps_last_updated).toLocaleTimeString()}</div>` : ''}
    </div>`;
}

function _syncMarkersToMap(mapInstance, markersObj, officers) {
    if (!mapInstance) return;
    const seen = new Set();
    for (const o of officers) {
    const key = `${o.officer_role || 'field_officer'}:${o.id}`;
        seen.add(key);
        const pos = _officerLatLng(o);
        if (markersObj[key]) {
            markersObj[key].setLatLng(pos);
            markersObj[key].setIcon(_officerIcon(o.status));
            markersObj[key].getPopup()?.setContent(_buildOfficerPopup(o));
        } else {
            const m = L.marker(pos, {icon: _officerIcon(o.status)})
                .bindPopup(_buildOfficerPopup(o))
                .addTo(mapInstance);
            markersObj[key] = m;
        }
    }
    for (const key of Object.keys(markersObj)) {
        if (!seen.has(key)) {
            markersObj[key].remove();
            delete markersObj[key];
        }
    }
}

function initDashMap() {
    const el = document.getElementById('officer-live-map');
    if (!el || _dashMap) return;
    _dashMap = L.map('officer-live-map', {zoomControl: true, scrollWheelZoom: false})
        .setView([14.6760, 121.0437], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(_dashMap);
    _syncMarkersToMap(_dashMap, _dashMarkers, FIELD_OFFICERS_DATA);
}

function initOfficersPageMap() {
    const el = document.getElementById('officers-page-map');
    if (!el || _officersMap) return;
    _officersMap = L.map('officers-page-map', {zoomControl: true, scrollWheelZoom: false})
        .setView([14.6760, 121.0437], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(_officersMap);
    _syncMarkersToMap(_officersMap, _officersMarkers, FIELD_OFFICERS_DATA);
}

async function refreshOfficerMap() {
    try {
        const [officersResp, activeResp, dashResp] = await Promise.allSettled([
            apiFetch('dispatch.php', {action: 'officers'}),
            apiFetch('dispatch.php', {action: 'activeCases'}),
            apiFetch('dispatch.php', {action: 'dashboard'}),
        ]);

        if (officersResp.status === 'fulfilled') {
            _normalizeOfficerSets(officersResp.value);
            _syncMarkersToMap(_dashMap, _dashMarkers, FIELD_OFFICERS_DATA);
            _syncMarkersToMap(_officersMap, _officersMarkers, FIELD_OFFICERS_DATA);
            renderOfficers();
        }

        if (activeResp.status === 'fulfilled') {
            const newCases = activeResp.value.activeCases || [];
            const oldIds = ACTIVE_CASES.map(c => c.id + c.asgn_status).join(',');
            const newIds = newCases.map(c => c.id + c.asgn_status).join(',');
            ACTIVE_CASES = newCases;
            if (oldIds !== newIds) renderActiveCases();
        }

        if (dashResp.status === 'fulfilled') {
            window.dispatchCounts = dashResp.value.counts || window.dispatchCounts;
            renderDashboard();
        }

        const el = document.getElementById('map-last-updated');
        if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
        console.warn('Dispatch refresh failed:', e.message);
    }
}

function startMapPolling() {
    if (_mapRefreshInterval) clearInterval(_mapRefreshInterval);
    _mapRefreshInterval = setInterval(refreshOfficerMap, 15000);
}

window.addEventListener('DOMContentLoaded', initDispatch);

async function initDispatch() {
    const user = await requireLoginRedirect();
    if (!user) return;
    DISPATCH_USER = user;

    await loadDispatchData();
    renderDashboard();
    renderAnalytics();   /* async but fire-and-forget on init */
    renderProfile();
    renderProfileCard();
    renderQueueTable();
    renderActiveCases();
    renderOfficers();
    startOfficerChatAlertPolling();
    /* Init maps after first data load */
    initDashMap();
    startMapPolling();
}

async function loadDispatchData() {
  const [dashboardResp, queueResp, officersResp, activeResp] = await Promise.allSettled([
    apiFetch('dispatch.php', {action: 'dashboard'}),
    apiFetch('dispatch.php', {action: 'queue'}),
    apiFetch('dispatch.php', {action: 'officers'}),
    apiFetch('dispatch.php', {action: 'activeCases'}),
  ]);

  if (dashboardResp.status === 'fulfilled') {
    window.dispatchCounts = dashboardResp.value.counts || {pending: 0, dup_count: 0, active_cases: 0};
  } else {
    window.dispatchCounts = window.dispatchCounts || {pending: 0, dup_count: 0, active_cases: 0};
  }

  if (queueResp.status === 'fulfilled') {
    QUEUE_DATA = queueResp.value.complaints || [];
  }

  if (officersResp.status === 'fulfilled') {
    _normalizeOfficerSets(officersResp.value);
  }

  if (activeResp.status === 'fulfilled') {
    ACTIVE_CASES = activeResp.value.activeCases || [];
  }
}

function toggleNotif() {
    dispatchNotifOpen = !dispatchNotifOpen;
    document.getElementById('notif-panel').classList.toggle('hidden', !dispatchNotifOpen);
}

function showNotification(title, message) {
  const container = document.getElementById('notif-panel') || document.querySelector('.notif-panel');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'notif-item';
  item.innerHTML = `<div class="notif-dot-inline"></div><div><div class="notif-msg">${safeText(title)}</div><div class="notif-time">${safeText(message)}</div></div>`;

  const head = container.querySelector('.notif-head');
  if (head) {
    container.insertBefore(item, head.nextSibling);
  } else {
    container.insertBefore(item, container.firstChild);
  }

  const items = container.querySelectorAll('.notif-item');
  const maxItems = 20;
  if (items.length > maxItems) {
    for (let i = maxItems; i < items.length; i++) {
      items[i].remove();
    }
  }

  const notifDot = document.querySelector('#notif-btn .notif-dot');
  if (notifDot) notifDot.classList.remove('hidden');
}

document.addEventListener('click', e => {
    if (!e.target.closest('#notif-btn') && dispatchNotifOpen) {
        document.getElementById('notif-panel').classList.add('hidden');
        dispatchNotifOpen = false;
    }
});

function renderDashboard() {
    const counts = window.dispatchCounts || {pending: 0, dup_count: 0, active_cases: 0};
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('stat-pending', counts.pending ?? '—');
    setEl('stat-dups', counts.dup_count ?? '—');
    setEl('stat-active-count', counts.active_cases ?? '—');
    setEl('badge-queue', counts.pending ?? '0');
    setEl('badge-active', counts.active_cases ?? '0');
    /* Resolution rate from analytics if available */
    if (window.dispatchAnalytics) {
        const rate = window.dispatchAnalytics.rate;
        setEl('stat-resolution-rate', rate != null ? rate + '%' : '—');
    }

    const queueList = document.getElementById('dash-queue-list');
    if (queueList) {
        const submitted = QUEUE_DATA.filter(c => c.status === 'submitted');
        queueList.innerHTML = submitted.map(c => `
          <div class="queue-preview-item">
            <div class="queue-preview-body">
              <div class="queue-preview-id">${safeText(c.id)}</div>
              <div class="queue-preview-meta">${safeText(c.cat)} · ${safeText(c.brgy)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${priorityBadge(c.priority)}
              ${c.duplicate ? '<span class="dup-flag">Dup.</span>' : ''}
              ${statusBadge(c.status)}
            </div>
          </div>`).join('');
    }

    const officerList = document.getElementById('dash-officer-list');
    if (officerList) {
        officerList.innerHTML = OFFICERS_DATA.map(o => {
            const initials = String(o.name || 'FO').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0,2).toUpperCase();
            const statusLabel = o.status === 'available' ? 'AVAILABLE' : o.status === 'busy' ? 'BUSY' : o.status === 'on_duty' ? 'ON DUTY' : 'OFFLINE';
            return `
            <div class="officer-status-item">
              <div class="officer-initials">${initials}</div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${safeText(o.name)}</div>
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--mist)">${_officerRoleLabel(o)} · Brgy. ${safeText(o.brgy || 'N/A')}</div>
              </div>
              <span class="badge ${_badgeClassByStatus(o.status)}">${statusLabel}</span>
            </div>`;
        }).join('');
    }
}

function switchQueueTab(el) {
    document.querySelectorAll('#queue-tabs .tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    dispatchActiveQueueTab = el.dataset.tab;
    renderQueueTable();
}

function renderQueueTable() {
    const search = (document.getElementById('queue-search')?.value || '').toLowerCase();
    const priority = document.getElementById('queue-priority')?.value || '';
    const brgy = document.getElementById('queue-brgy')?.value || '';

  // De-duplicate by tracking ID to prevent join-expanded rows from rendering repeatedly.
  const deduped = [];
  const seen = new Set();
  for (const c of QUEUE_DATA) {
    const key = String(c.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  const submitted = deduped.filter(c => c.status === 'submitted');
  const verified = deduped.filter(c => c.status === 'verified');
  const resolved = deduped.filter(c => c.status === 'resolved');
  const closed = deduped.filter(c => c.status === 'closed');

    document.getElementById('tab-submitted-count').textContent = `(${submitted.length})`;
    document.getElementById('tab-verified-count').textContent = `(${verified.length})`;
    const resolvedCountEl = document.getElementById('tab-resolved-count');
    if (resolvedCountEl) resolvedCountEl.textContent = `(${resolved.length})`;
    const closedCountEl = document.getElementById('tab-closed-count');
    if (closedCountEl) closedCountEl.textContent = `(${closed.length})`;

    let list = submitted;
    if (dispatchActiveQueueTab === 'verified') {
      list = verified;
    } else if (dispatchActiveQueueTab === 'resolved') {
      list = resolved;
    } else if (dispatchActiveQueueTab === 'closed') {
      list = closed;
    }
    list = list.filter(c => {
      const id = String(c.id || '').toLowerCase();
      const cat = String(c.cat || '').toLowerCase();
      const ms = !search || id.includes(search) || cat.includes(search);
      const mp = !priority || String(c.priority || '') === priority;
      const mb = !brgy || String(c.brgy || '') === brgy;
        return ms && mp && mb;
    });

    const tbody = document.getElementById('queue-tbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-title">No complaints</div></div></td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(c => `
      <tr>
        <td class="track-id">${safeText(c.id)}</td>
        <td>${safeText(c.cat)}</td>
        <td class="mono" style="font-size:12px">${c.anon ? 'Anonymous' : safeText(c.user || 'Citizen')}</td>
        <td style="font-size:12px">${safeText(c.brgy)}</td>
        <td>${priorityBadge(c.priority)}</td>
        <td class="mono" style="font-size:12px">${formatDateTime(c.date)}</td>
        <td>${c.duplicate ? '<span class="dup-flag">Dup.</span>' : '—'}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-secondary btn-sm" onclick="openReviewModal('${safeText(c.id)}')">Review</button>
            ${c.status === 'resolved'
              ? `<button class="btn-success btn-sm" onclick="openCloseCaseModal('${safeText(c.id)}')">✓ Close Case</button>`
              : (c.status === 'closed'
                ? `<span class="badge badge-closed">Closed</span>`
                : `<button class="btn-success btn-sm" onclick="openVerifyModal('${safeText(c.id)}')">✓ Verify</button><button class="btn-danger btn-sm" onclick="openRejectModal('${safeText(c.id)}')">✗ Reject</button>`)}
          </div>
        </td>
      </tr>`).join('');
}

function openCloseCaseModal(id) {
    const c = QUEUE_DATA.find(x => x.id === id);
    if (!c) return;

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:560px">
          <div class="modal-head">
            <div>
              <div class="modal-title">Close Case</div>
              <div class="modal-subtitle">${safeText(c.id)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            ${alertBox('warn', '', 'This will finalize the resolved complaint and move it to closed status.')}
            <div class="form-group" style="margin-top:12px">
              <label>Final Dispatch Notes (optional)</label>
              <textarea class="form-input" id="close-case-feedback" rows="3" placeholder="Validation notes before closing..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn-success" onclick="submitCloseCase('${safeText(c.id)}')">✓ Confirm Close</button>
          </div>
        </div>
      </div>`);
}

async function submitCloseCase(id) {
    const feedback = document.getElementById('close-case-feedback')?.value.trim() || '';
    closeModal();
    try {
        await apiFetch('dispatch.php', {action: 'closeCase', id, feedback}, 'POST');
        showToast('Case closed successfully.');
        showNotification(`Case ${id} closed`, 'Resolved complaint finalized by dispatch');
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
        renderActiveCases();
    } catch (error) {
        showToast(error.message);
    }
}

function _cleanupActiveCaseMaps() {
    Object.values(_activeCaseMaps).forEach(m => { try { m.remove(); } catch (_) {} });
    _activeCaseMaps = {};
    Object.values(_countdownTimers).forEach(t => clearInterval(t));
    _countdownTimers = {};
}

function initActiveCaseMaps() {
    if (!window.L) return;
    ACTIVE_CASES.forEach(c => {
        const lat = Number.parseFloat(c.lat);
        const lng = Number.parseFloat(c.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const mapId = `case-map-${String(c.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        const el = document.getElementById(mapId);
        if (!el || _activeCaseMaps[c.id]) return;
        try {
            const map = L.map(mapId, {zoomControl: true, scrollWheelZoom: false}).setView([lat, lng], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 19,
            }).addTo(map);
            L.marker([lat, lng]).addTo(map)
                .bindPopup(`${safeText(c.id)}<br>${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 120);
            _activeCaseMaps[c.id] = map;
        } catch (_) {}
    });
}

function startAllCountdowns() {
    Object.values(_countdownTimers).forEach(t => clearInterval(t));
    _countdownTimers = {};

    ACTIVE_CASES.forEach(c => {
        if (!c.response_deadline) return;
        const deadline = new Date(c.response_deadline).getTime();
        if (isNaN(deadline)) return;

        const tick = () => {
            const el = document.getElementById(`timer-${c.id}`);
            if (!el) { clearInterval(_countdownTimers[c.id]); delete _countdownTimers[c.id]; return; }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                el.className = 'timer-badge failed';
                el.textContent = '⚠ TIME EXCEEDED';
                clearInterval(_countdownTimers[c.id]);
                delete _countdownTimers[c.id];
                const footerEl = document.getElementById(`case-footer-status-${String(c.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`);
                if (footerEl) { footerEl.className = 'officer-failed-label'; footerEl.textContent = '⚠ Assignment Failed — Time Exceeded'; }
                return;
            }
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            el.textContent = `⏱ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            el.className = remaining < 300000 ? 'timer-badge urgent' : 'timer-badge';
        };
        tick();
        _countdownTimers[c.id] = setInterval(tick, 1000);
    });
}

function renderActiveCases() {
    const activeCasesList = document.getElementById('active-cases-list');
    if (!activeCasesList) return;

    _cleanupActiveCaseMaps();

    if (!ACTIVE_CASES.length) {
        activeCasesList.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No active cases</div><div class="empty-sub">All cases are pending dispatch or completed.</div></div>`;
        return;
    }

    const now = Date.now();

    activeCasesList.innerHTML = ACTIVE_CASES.map(c => {
        const lat = Number.parseFloat(c.lat);
        const lng = Number.parseFloat(c.lng);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        const mapId = `case-map-${String(c.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        const footerStatusId = `case-footer-status-${String(c.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

        let timerHtml = '';
        let isTimerFailed = false;
        if (c.response_deadline) {
            const deadline = new Date(c.response_deadline).getTime();
            if (!isNaN(deadline)) {
                const remaining = deadline - now;
                if (remaining <= 0 || c.asgn_status === 'failed') {
                    isTimerFailed = true;
                    timerHtml = `<span class="timer-badge failed">⚠ TIME EXCEEDED</span>`;
                } else {
                    const mins = Math.floor(remaining / 60000);
                    const secs = Math.floor((remaining % 60000) / 1000);
                    timerHtml = `<span class="timer-badge" id="timer-${safeText(c.id)}">⏱ ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</span>`;
                }
            }
        } else if (c.asgn_status === 'failed') {
            isTimerFailed = true;
            timerHtml = `<span class="timer-badge failed">⚠ TIME EXCEEDED</span>`;
        }

        const officerName = safeText(c.officer_name || 'Field Officer');
        const officerBadge = c.officer_badge ? ` (${safeText(c.officer_badge)})` : '';
        const footerStatusClass = isTimerFailed ? 'officer-failed-label' : 'officer-en-route';
        const footerStatusText = isTimerFailed ? '⚠ Assignment Failed — Time Exceeded' : '● En route';
        const cardBorder = isTimerFailed ? 'border-left-color:#dc2626;' : '';

        return `
        <div class="active-case-card" style="${cardBorder}">
          <div class="active-case-header">
            <div>
              <div class="active-case-title-row">
                <span class="track-id">${safeText(c.id)}</span>
                ${statusBadge(c.status)}
                ${priorityBadge(c.priority)}
                ${timerHtml}
              </div>
              <div class="active-case-meta">${safeText(c.cat)} · Brgy. ${safeText(c.brgy)} · ${formatDateTime(c.date)}</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn-secondary btn-sm" onclick="openCaseTimelineModal('${safeText(c.id)}')">CASE TIMELINE</button>
              <button class="btn-danger btn-sm" onclick="reassignCase('${safeText(c.id)}')">Reassign</button>
            </div>
          </div>
          <div class="active-case-body">
            <div>
              <div class="active-case-desc-label">Description</div>
              <div class="active-case-desc">${safeText(c.desc || c.description || '')}</div>
            </div>
            <div class="active-case-map" id="${safeText(mapId)}">
              ${!hasCoords ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--mist);font-size:12px;font-family:var(--font-mono)">Location unavailable</div>` : ''}
            </div>
          </div>
          <div class="active-case-footer">
            <span class="officer-assigned-label">Assigned to:</span>
            <span class="officer-assigned-name">${officerName}${officerBadge}</span>
            <span class="${footerStatusClass}" id="${safeText(footerStatusId)}">${footerStatusText}</span>
          </div>
        </div>`;
    }).join('');

    requestAnimationFrame(() => {
        initActiveCaseMaps();
        startAllCountdowns();
    });
}

function buildCaseTimelineItems(currentStatus, timelineMap) {
    const statusOrder = ['submitted', 'verified', 'assigned', 'en_route', 'in_progress', 'resolved', 'validated', 'closed'];
    const titleMap = {
        submitted: 'Submitted',
        verified: 'Verified',
        assigned: 'Assigned',
        en_route: 'En Route',
        in_progress: 'In Progress',
        resolved: 'Resolved',
        validated: 'Validated',
        closed: 'Closed',
    };
    const fallbackNotes = {
        submitted: 'Complaint received. Tracking ID generated.',
        verified: 'Dispatch Officer validated complaint details.',
        assigned: 'Assigned to a Field Officer.',
        en_route: 'Officer departed to incident site.',
        in_progress: 'Officer checked in at incident site (GPS confirmed).',
        resolved: 'Resolution report submitted by officer.',
        validated: 'Dispatch Officer confirmed resolution.',
        closed: 'Case officially closed.',
    };

    const currentIdx = statusOrder.indexOf(String(currentStatus || '').toLowerCase());

    return statusOrder.map((status, idx) => {
        const reached = currentIdx >= 0 && idx <= currentIdx;
        const item = timelineMap[status] || null;
        const title = titleMap[status] || status;
        const timeText = item?.changed_at ? formatDateTime(item.changed_at) : '--';
        const noteText = item?.notes ? safeText(item.notes) : fallbackNotes[status];

        return `
          <div class="dispatch-timeline-item ${reached ? 'done' : 'pending'}">
            <div class="dispatch-timeline-dot"></div>
            <div class="dispatch-timeline-content">
              <div class="dispatch-timeline-title">${safeText(title)}</div>
              <div class="dispatch-timeline-time">${safeText(timeText)}</div>
              <div class="dispatch-timeline-note">${safeText(noteText)}</div>
            </div>
          </div>`;
    }).join('');
}

async function toggleCaseTimeline(id) {
    const c = ACTIVE_CASES.find(x => x.id === id) || QUEUE_DATA.find(x => x.id === id);
    if (!c) return;

    let timelineEntries = [];
    try {
        const resp = await apiFetch('dispatch.php', {action: 'caseTimeline', id});
        timelineEntries = Array.isArray(resp.timeline) ? resp.timeline : [];
    } catch (_) {
        timelineEntries = [];
    }

    const timelineMap = {};
    timelineEntries.forEach(entry => {
        const key = String(entry.status || '').toLowerCase();
        timelineMap[key] = entry;
    });

    if (!timelineMap.submitted && c?.date) {
        timelineMap.submitted = {
            status: 'submitted',
            changed_at: c.date,
            notes: 'Complaint received. Tracking ID generated.',
        };
    }

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal modal-lg">
          <div class="modal-head">
            <div>
              <div class="modal-title">Case Timeline</div>
              <div class="modal-subtitle">${safeText(c.id)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="dispatch-timeline-wrap">
              <div class="dispatch-timeline-heading">CASE TIMELINE</div>
              ${buildCaseTimelineItems(c.status, timelineMap)}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>`);
}

async function openCaseTimelineModal(id) {
    await toggleCaseTimeline(id);
}

function normalizePriorityValue(priority) {
  return String(priority || '').trim().toLowerCase();
}

function getPriorityLabel(priority) {
  const value = normalizePriorityValue(priority);
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Medium';
}

function priorityOptionsMarkup(selectedPriority) {
  const selected = normalizePriorityValue(selectedPriority) || 'medium';
  const levels = ['low', 'medium', 'high', 'urgent'];
  return levels.map(level => `<option value="${level}" ${selected === level ? 'selected' : ''}>${getPriorityLabel(level)}</option>`).join('');
}

function setComplaintPriorityLocally(id, priority) {
  const next = normalizePriorityValue(priority);
  QUEUE_DATA.forEach(c => {
    if (String(c.id) === String(id)) c.priority = next;
  });
  ACTIVE_CASES.forEach(c => {
    if (String(c.id) === String(id)) c.priority = next;
  });
}

async function updateComplaintPriority(id, priority) {
  const next = normalizePriorityValue(priority);
  if (!['low', 'medium', 'high', 'urgent'].includes(next)) {
    showToast('Invalid priority level selected.');
    return;
  }

  try {
    await apiFetch('dispatch.php', {action: 'updatePriority', id, priority: next}, 'POST');
    setComplaintPriorityLocally(id, next);

    const reviewBadgeWrap = document.getElementById(`review-priority-badge-${id}`);
    if (reviewBadgeWrap) reviewBadgeWrap.innerHTML = priorityBadge(next);

    const verifyBadgeWrap = document.getElementById(`verify-priority-badge-${id}`);
    if (verifyBadgeWrap) verifyBadgeWrap.innerHTML = priorityBadge(next);

    const reviewSelect = document.getElementById(`review-priority-select-${id}`);
    if (reviewSelect) reviewSelect.value = next;

    const verifySelect = document.getElementById(`verify-priority-select-${id}`);
    if (verifySelect) verifySelect.value = next;

    renderQueueTable();
    renderActiveCases();

    showNotification(`Priority updated: ${id}`, `Set to ${getPriorityLabel(next)}`);
    showToast(`Priority updated to ${getPriorityLabel(next)}.`);
  } catch (error) {
    showToast(error.message);
  }
}

function openReviewModal(id) {
  openReviewModalAsync(id);
}

let dispatchReviewMap = null;

function normalizeEvidenceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;

  const normalized = raw.replace(/^\.\//, '');
  if (normalized.startsWith('/')) {
    return `${window.location.origin}${normalized}`;
  }
  if (normalized.startsWith('uploads/')) {
    return new URL(`../${normalized}`, window.location.href).href;
  }
  if (normalized.startsWith('complaints/')) {
    return new URL(`../uploads/${normalized}`, window.location.href).href;
  }
  if (/^[^\/]+\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v|webm|3gp|3gpp)$/i.test(normalized)) {
    return new URL(`../uploads/${normalized}`, window.location.href).href;
  }

  try {
    return new URL(normalized, window.location.href).href;
  } catch (_) {
    return normalized;
  }
}

function openEvidenceViewerFromElement(el) {
  const encodedUrl = String(el?.dataset?.eurl || '');
  const mediaUrl = decodeURIComponent(encodedUrl || '');
  const mediaType = String(el?.dataset?.etype || 'photo');
  const mediaTitle = String(el?.dataset?.etitle || 'Evidence');
  openEvidenceViewer(mediaUrl, mediaType, mediaTitle);
}

function closeEvidenceViewer() {
  const existing = document.getElementById('evidence-viewer-overlay');
  if (existing) existing.remove();
}

function openEvidenceViewer(url, mediaType, title) {
  const mediaUrl = String(url || '').trim();
  if (!mediaUrl) {
    showToast('Evidence file URL is missing.');
    return;
  }

  closeEvidenceViewer();

  const overlay = document.createElement('div');
  overlay.id = 'evidence-viewer-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.92)';
  overlay.style.zIndex = '12000';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';

  const safeTitle = safeText(title || 'Evidence');
  const mediaNode = mediaType === 'video'
    ? `<video id="evidence-viewer-media" src="${safeText(mediaUrl)}" controls autoplay playsinline style="max-width:96vw;max-height:82vh;background:#000"></video>`
    : `<img id="evidence-viewer-media" src="${safeText(mediaUrl)}" alt="${safeTitle}" style="max-width:96vw;max-height:82vh;object-fit:contain;display:block" />`;

  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.14)">
      <div style="color:#fff;font-family:var(--font-head);font-size:18px;font-weight:700">${safeTitle}</div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary btn-sm" type="button" onclick="requestEvidenceFullscreen()">Fullscreen</button>
        <a class="btn-secondary btn-sm" href="${safeText(mediaUrl)}" target="_blank" rel="noopener">Open New Tab</a>
        <button class="btn-danger btn-sm" type="button" onclick="closeEvidenceViewer()">Close</button>
      </div>
    </div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:12px">${mediaNode}</div>
  `;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeEvidenceViewer();
  });

  document.body.appendChild(overlay);
}

function requestEvidenceFullscreen() {
  const media = document.getElementById('evidence-viewer-media');
  if (!media || typeof media.requestFullscreen !== 'function') {
    return;
  }
  media.requestFullscreen().catch(() => {});
}

function evidenceType(mediaRow) {
  const declared = String(mediaRow?.file_type || '').toLowerCase();
  if (declared === 'video') return 'video';
  const url = String(mediaRow?.file_url || '').toLowerCase();
  if (/\.(mp4|mov|m4v|webm|3gp|3gpp)(\?.*)?$/.test(url)) return 'video';
  return 'photo';
}

function renderEvidenceSection(mediaList) {
  const rows = Array.isArray(mediaList) ? mediaList : [];
  if (!rows.length) {
    return uploadBox(80, 'No uploaded evidence found', 'Citizen did not attach media for this complaint.');
  }

  const cards = rows.map((row, idx) => {
    const url = normalizeEvidenceUrl(row.file_url);
    if (!url) return '';

    const isVideo = evidenceType(row) === 'video';
    const stage = String(row?.evidence_stage || '').toLowerCase();
    const stageLabel = stage === 'before_proof'
      ? 'Field Before Photo'
      : (stage === 'after_proof' ? 'Field After Photo' : null);
    const title = stageLabel || (isVideo ? `Evidence Video ${idx + 1}` : `Evidence Photo ${idx + 1}`);
    const encodedUrl = encodeURIComponent(url);
    const mediaNode = isVideo
      ? `<video src="${safeText(url)}" preload="metadata" muted style="width:100%;height:100%;object-fit:cover;background:#000"></video>`
      : `<img src="${safeText(url)}" alt="${safeText(title)}" style="width:100%;height:100%;object-fit:cover;display:block" />`;

    return `
      <button type="button"
        data-eurl="${safeText(encodedUrl)}"
        data-etype="${isVideo ? 'video' : 'photo'}"
        data-etitle="${safeText(title)}"
        onclick="openEvidenceViewerFromElement(this)"
        title="Open ${safeText(title)}"
        style="display:block;width:100%;padding:0;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#f8f8f8;height:128px;cursor:pointer;position:relative">
        ${mediaNode}
        ${stageLabel ? `<span style="position:absolute;left:8px;top:8px;background:rgba(17,17,17,0.72);color:#fff;font-size:11px;padding:4px 6px;border-radius:6px">${safeText(stageLabel)}</span>` : ''}
        <span style="position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,0.65);color:#fff;font-size:11px;padding:4px 6px;border-radius:6px">View Fullscreen</span>
      </button>`;
  }).filter(Boolean).join('');

  if (!cards) {
    return uploadBox(80, 'No uploaded evidence found', 'Citizen did not attach media for this complaint.');
  }

  return `
    <div style="margin-top:12px">
    <div class="section-title">Uploaded Evidence</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">${cards}</div>
    </div>`;
}

function buildReviewMapPanel(mapId) {
  return `
    <div style="margin-top:12px">
    <div class="section-title">Live Map</div>
    <div id="${safeText(mapId)}" style="height:180px;border:1px solid var(--border);border-radius:8px;overflow:hidden"></div>
    </div>`;
}

function mountReviewMap(mapId, lat, lng) {
  const mapEl = document.getElementById(mapId);
  if (!mapEl) return;

  const pointLat = Number.parseFloat(lat);
  const pointLng = Number.parseFloat(lng);
  if (!Number.isFinite(pointLat) || !Number.isFinite(pointLng)) {
    mapEl.innerHTML = mapPlaceholder(180, 'Location unavailable');
    return;
  }
  if (!window.L) {
    mapEl.innerHTML = `<div class="map-placeholder" style="height:180px"><div class="map-icon"></div><div class="map-label">${safeText(pointLat.toFixed(5))}, ${safeText(pointLng.toFixed(5))}</div><div class="map-sub">Leaflet failed to load.</div></div>`;
    return;
  }

  if (dispatchReviewMap) {
    dispatchReviewMap.remove();
    dispatchReviewMap = null;
  }

  dispatchReviewMap = L.map(mapId, { zoomControl: true, scrollWheelZoom: false }).setView([pointLat, pointLng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(dispatchReviewMap);

  L.marker([pointLat, pointLng]).addTo(dispatchReviewMap)
    .bindPopup(`Complaint location<br>${safeText(pointLat.toFixed(5))}, ${safeText(pointLng.toFixed(5))}`)
    .openPopup();

  setTimeout(() => {
    if (dispatchReviewMap) dispatchReviewMap.invalidateSize();
  }, 0);
  setTimeout(() => {
    if (dispatchReviewMap) dispatchReviewMap.invalidateSize();
  }, 180);
}

async function openReviewModalAsync(id) {
  const c = QUEUE_DATA.find(x => x.id === id);
  if (!c) return;
  dispatchSelectedOfficerId = null;

  let detailComplaint = c;
  let detailMedia = [];
  try {
    const detailResp = await apiFetch('dispatch.php', {action: 'complaintDetail', id});
    if (detailResp?.complaint && typeof detailResp.complaint === 'object') {
      detailComplaint = {...c, ...detailResp.complaint};
    }
    if (Array.isArray(detailResp?.media)) {
      detailMedia = detailResp.media;
    }
  } catch (error) {
    detailComplaint = c;
    detailMedia = [];
    showToast(`Evidence load failed: ${error?.message || 'Unknown error'}`);
  }

  const mapId = `review-map-${String(detailComplaint.id || id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const evidenceHtml = renderEvidenceSection(detailMedia);

    const officerCards = FIELD_OFFICERS_DATA.map(o => {
        const blocked = o.status !== 'available';
        const statusLabel = blocked ? '⬤ On Assignment' : '● Available';
        const statusClass = blocked ? 'busy' : 'available';
        return `<div class="officer-card${blocked ? ' disabled' : ''}" id="ocard-${safeText(o.id)}" onclick="${blocked ? 'void(0)' : `selectOfficer('${safeText(o.id)}')`}">
        <div class="officer-name">${safeText(o.name)}</div>
        <div class="officer-meta">Badge: ${safeText(o.code)} · ${safeText(o.brgy)}</div>
        <div class="officer-status ${statusClass}">${statusLabel}</div>
      </div>`;
    }).join('');

    const canAction = ['submitted', 'verified'].includes(detailComplaint.status);
    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal modal-lg">
          <div class="modal-head">
            <div>
              <div class="modal-title">Complaint Review</div>
              <div class="modal-subtitle">${safeText(detailComplaint.id)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="badge-row">
              ${statusBadge(detailComplaint.status)} <span id="review-priority-badge-${safeText(detailComplaint.id)}">${priorityBadge(detailComplaint.priority)}</span>
              ${detailComplaint.duplicate ? '<span class="dup-flag">Potential Duplicate within 100m / 24hr window</span>' : ''}
            </div>
            <div class="detail-grid">
              <div class="detail-item"><label>Category</label><span>${safeText(detailComplaint.cat)}</span></div>
              <div class="detail-item"><label>Barangay</label><span>${safeText(detailComplaint.brgy)}</span></div>
              <div class="detail-item"><label>Reporter</label><span>${detailComplaint.anon ? 'Anonymous' : safeText(detailComplaint.user || 'Citizen')}</span></div>
              <div class="detail-item"><label>Date / Time</label><span>${formatDateTime(detailComplaint.date)}</span></div>
              <div class="detail-item"><label>Priority Level</label><span><select class="form-select" id="review-priority-select-${safeText(detailComplaint.id)}" onchange="updateComplaintPriority('${safeText(detailComplaint.id)}', this.value)">${priorityOptionsMarkup(detailComplaint.priority)}</select></span></div>
            </div>
            <div class="complaint-desc">${safeText(detailComplaint.desc || detailComplaint.description || '')}</div>
            ${buildReviewMapPanel(mapId)}
            ${evidenceHtml}
            ${canAction ? `
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
                <div class="section-title">Assign Field Officer</div>
                <div class="officer-grid">${officerCards}</div>
                <div class="reject-section">
                  <div class="form-group" style="margin-bottom:0">
                    <label>Rejection Reason (required if rejecting)</label>
                    <textarea class="form-input" id="reject-reason-inline" rows="2" placeholder="Enter reason for rejection…"></textarea>
                  </div>
                </div>
              </div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            ${canAction ? `
              <button class="btn-danger" onclick="confirmReject('${safeText(c.id)}')">✗ Reject</button>
              <button class="btn-success" onclick="confirmVerifyAssign('${safeText(c.id)}')">✓ Verify & Assign</button>` : ''}
          </div>
        </div>
      </div>`);

    mountReviewMap(mapId, detailComplaint.lat, detailComplaint.lng);
}

function selectOfficer(id) {
    document.querySelectorAll('.officer-card').forEach(c => c.classList.remove('selected'));
    const el = document.getElementById('ocard-' + id);
    if (el) el.classList.add('selected');
    dispatchSelectedOfficerId = id;
}

async function confirmVerifyAssign(id) {
    if (!dispatchSelectedOfficerId) {
        showToast('Please select a field officer before assigning.');
        return;
    }
    const officer = FIELD_OFFICERS_DATA.find(o => o.id === dispatchSelectedOfficerId);
    closeModal();
    try {
        await apiFetch('dispatch.php', {action: 'verifyAssign', id, officer_id: dispatchSelectedOfficerId}, 'POST');
        showToast(`✓ Complaint verified and assigned to ${safeText(officer?.name || 'officer')}.`);
      showNotification(`Complaint ${id} assigned`, `Assigned to ${officer?.name || 'officer'}`);
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
        renderActiveCases();
    } catch (error) {
        showToast(error.message);
    }
}

function openVerifyModal(id) {
    const c = QUEUE_DATA.find(x => x.id === id);
    if (!c) return;
    dispatchSelectedOfficerId = null;

    const officerCards = FIELD_OFFICERS_DATA.map(o => {
        const blocked = o.status !== 'available';
        const statusLabel = blocked ? '⬤ On Assignment' : '● Available';
        const statusClass = blocked ? 'busy' : 'available';
        return `<div class="officer-card${blocked ? ' disabled' : ''}" id="vocard-${safeText(o.id)}" onclick="${blocked ? 'void(0)' : `selectOfficerVerify('${safeText(o.id)}')`}">
        <div class="officer-name">${safeText(o.name)}</div>
        <div class="officer-meta">Badge: ${safeText(o.code)} · ${safeText(o.brgy)}</div>
        <div class="officer-status ${statusClass}">${statusLabel}</div>
      </div>`;
    }).join('');

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal">
          <div class="modal-head">
            <div>
              <div class="modal-title">Verify & Assign</div>
              <div class="modal-subtitle">${safeText(c.id)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="badge-row">${statusBadge(c.status)} <span id="verify-priority-badge-${safeText(c.id)}">${priorityBadge(c.priority)}</span></div>
            <div class="form-group" style="margin-top:10px">
              <label>Priority Level</label>
              <select class="form-select" id="verify-priority-select-${safeText(c.id)}" onchange="updateComplaintPriority('${safeText(c.id)}', this.value)">
                ${priorityOptionsMarkup(c.priority)}
              </select>
            </div>
            <div class="complaint-desc">${safeText(c.desc)}</div>
            <div class="section-title">Select Field Officer</div>
            <div class="officer-grid">${officerCards}</div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn-success" onclick="confirmVerifyModal('${safeText(c.id)}')">✓ Assign</button>
          </div>
        </div>
      </div>`);
}

function selectOfficerVerify(id) {
    document.querySelectorAll('.officer-card').forEach(c => c.classList.remove('selected'));
    const el = document.getElementById('vocard-' + id);
    if (el) el.classList.add('selected');
    dispatchSelectedOfficerId = id;
}

async function confirmVerifyModal(id) {
    if (!dispatchSelectedOfficerId) {
        showToast('Please select an officer first.');
        return;
    }
    const officer = FIELD_OFFICERS_DATA.find(o => o.id === dispatchSelectedOfficerId);
    closeModal();
    try {
        await apiFetch('dispatch.php', {action: 'verifyAssign', id, officer_id: dispatchSelectedOfficerId}, 'POST');
        showToast(`✓ Complaint verified and assigned to ${safeText(officer?.name || 'officer')}.`);
      showNotification(`Complaint ${id} assigned`, `Assigned to ${officer?.name || 'officer'}`);
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
        renderActiveCases();
    } catch (error) {
        showToast(error.message);
    }
}

function openRejectModal(id) {
    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:460px">
          <div class="modal-head">
            <div class="modal-title">Reject Complaint</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            ${alertBox('warn', '', 'A rejection reason is required and will be displayed to the commuter on their Transparency Timeline.')}
            <div class="form-group">
              <label>Rejection Reason *</label>
              <textarea class="form-input" id="stand-reject-reason" rows="4" placeholder="Provide a clear reason for rejection…"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn-danger" onclick="submitReject('${safeText(id)}')">Confirm Rejection</button>
          </div>
        </div>
      </div>`);
}

async function submitReject(id) {
    const reason = document.getElementById('stand-reject-reason')?.value.trim();
    if (!reason) {
        showToast('Please enter a rejection reason.');
        return;
    }
    closeModal();
    try {
        await apiFetch('dispatch.php', {action: 'reject', id, reason}, 'POST');
        showToast('Complaint rejected. Reason sent to user.');
      showNotification(`Complaint ${id} rejected`, 'Reason sent to reporting user');
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
    } catch (error) {
        showToast(error.message);
    }
}

    async function confirmReject(id) {
      const inlineReason = document.getElementById('reject-reason-inline')?.value.trim() || '';
      if (!inlineReason) {
        showToast('Please enter a rejection reason.');
        return;
      }

      closeModal();
      try {
        await apiFetch('dispatch.php', {action: 'reject', id, reason: inlineReason}, 'POST');
        showToast('Complaint rejected. Reason sent to user.');
        showNotification(`Complaint ${id} rejected`, 'Reason sent to reporting user');
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
        renderActiveCases();
      } catch (error) {
        showToast(error.message);
      }
    }

let _reassignSelectedOfficerId = null;

function selectReassignOfficer(officerId) {
    _reassignSelectedOfficerId = officerId;
    document.querySelectorAll('.reassign-officer-card').forEach(c => c.classList.remove('selected'));
    const el = document.getElementById(`reassign-ocard-${officerId}`);
    if (el) el.classList.add('selected');
}

async function submitReassignFromCard(id) {
    if (!_reassignSelectedOfficerId) {
        showToast('Please select an officer first.');
        return;
    }
    const officerId = _reassignSelectedOfficerId;
    const officer = FIELD_OFFICERS_DATA.find(o => String(o.id) === String(officerId));
    closeModal();
    try {
        await apiFetch('dispatch.php', {action: 'reassign', id, officer_id: officerId}, 'POST');
        showToast(`Case reassigned to ${safeText(officer?.name || 'officer')}.`);
        showNotification(`Complaint ${id} reassigned`, `Reassigned to ${officer?.name || 'officer'}`);
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
        renderActiveCases();
    } catch (error) {
        showToast(error.message);
    }
}

async function reassignCase(id) {
    _reassignSelectedOfficerId = null;
    const availableOfficers = FIELD_OFFICERS_DATA.filter(o => o.status === 'available');
    if (!availableOfficers.length) {
        showToast('No available field officers at this time. All are currently busy or offline.');
        return;
    }

    const officerCards = availableOfficers.map(o => {
        const active   = Number(o.active_count) || 0;
        const handled  = Number(o.cases_closed) || 0;
        const initials = String(o.name || 'FO').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
        return `
        <div class="officer-card reassign-officer-card" id="reassign-ocard-${safeText(o.id)}"
             onclick="selectReassignOfficer('${safeText(o.id)}')">
          <div class="officer-name">${safeText(o.name)}</div>
          <div class="officer-meta">Badge: ${safeText(o.code || '—')} · Brgy. ${safeText(o.brgy)}</div>
          <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;font-family:var(--font-mono);color:var(--mist)">
            <span>● Available</span>
            <span>${active} active</span>
            <span>${handled} handled</span>
          </div>
        </div>`;
    }).join('');

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:540px">
          <div class="modal-head">
            <div>
              <div class="modal-title">Reassign Case</div>
              <div class="modal-subtitle">${safeText(id)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="section-title" style="margin-bottom:12px">Select Available Field Officer</div>
            <div class="officer-grid">${officerCards}</div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn-success" onclick="submitReassignFromCard('${safeText(id)}')">Reassign</button>
          </div>
        </div>
      </div>`);
}

async function submitReassign(id) {
    const officerId = document.getElementById('reassign-officer')?.value;
    if (!officerId) {
        showToast('Please select an officer to reassign.');
        return;
    }
    closeModal();
    try {
        await apiFetch('dispatch.php', {action: 'reassign', id, officer_id: officerId}, 'POST');
        showToast('Case reassigned successfully.');
      showNotification(`Complaint ${id} reassigned`, 'Case reassigned to another officer');
        await loadDispatchData();
        renderDashboard();
        renderQueueTable();
        renderActiveCases();
    } catch (error) {
        showToast(error.message);
    }
}

function renderProfileCard() {
    /* profile-mini-card was removed; no-op */
}

async function renderProfile() {
    const user = DISPATCH_USER;
    if (!user) return;

    const initial = (user.name || 'D').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const setEl   = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

    /* ── Topbar & Sidebar ── */
    setEl('topbar-user-name', user.name || 'Dispatch');
    const topbarAvatar = document.getElementById('topbar-user-avatar');
    if (topbarAvatar) topbarAvatar.textContent = initial;
    setEl('dispatch-sb-name', user.name || 'Dispatch Officer');

    /* ── Personal info ── */
    setEl('prof-name-static', user.name || '—');
    setEl('prof-position-static', 'Dispatch Officer');
    setEl('prof-email-static', user.email || '—');
    setEl('prof-phone-static', user.phone || '—');
    setEl('prof-badgeid-static', user.badge_number || ('DISP-' + String(user.id || '001').padStart(4, '0')));
    setEl('prof-brgy-static', user.home_barangay || user.brgy || user.assigned_barangay || 'QC Command');
    setEl('prof-rank-static', 'Dispatch Officer');
    setEl('prof-dept-static', 'Traffic Management Division');
    const initialsEl = document.getElementById('prof-avatar-initials-static');
    if (initialsEl) initialsEl.textContent = initial;

    /* ── Edit form pre-fill ── */
    setInput('prof-name-input', user.name);
    setInput('prof-position-input', 'Dispatch Officer');
    setInput('prof-email-input', user.email);
    setInput('prof-phone-input', user.phone);
    setInput('prof-badgeid-input', user.badge_number || ('DISP-' + String(user.id || '001').padStart(4, '0')));
    setInput('prof-brgy-input', user.home_barangay || user.brgy || '');
    setInput('prof-rank-input', 'Dispatch Officer');
    setInput('prof-dept-input', 'Traffic Management Division');
    const editInitials = document.getElementById('prof-avatar-initials');
    if (editInitials) editInitials.textContent = initial;

    /* ── Restore saved avatar from localStorage ── */
    const savedAvatar = _loadDispatchAvatar();
    if (savedAvatar) _applyDispatchAvatar(savedAvatar);

    /* ── Fetch real profile stats from DB ── */
    try {
        const s = await apiFetch('dispatch.php', {action: 'dispatchProfile'});

        /* Performance & Statistics card */
        setEl('prof-cases',    String(s.processed ?? '—'));
        setEl('prof-closed',   String(s.closed    ?? '—'));
        setEl('prof-avgtime',  s.avg_hours != null ? parseFloat(s.avg_hours).toFixed(1) + 'h' : '—');
        setEl('prof-caseload', String(s.caseload ?? '—'));
        setEl('prof-officers-count', String(s.officers_managed ?? '—'));
        setEl('prof-active-brgy',    String(s.active_brgy ?? '—'));

        /* This Month's Performance boxes */
        const profRate = s.rate != null ? s.rate + '%' : '—';
        const profOnTime = s.on_time_rate != null ? s.on_time_rate + '%' : '—';
        const profEff = s.efficiency != null ? s.efficiency + '%' : '—';
        setEl('prof-resolution-rate', profRate);
        setEl('prof-on-time',         profOnTime);
        setEl('prof-efficiency',      profEff);
        setEl('prof-avg-rating', '—');

        /* Sub-labels explaining the context */
        const mClosed = s.closed ?? 0;
        const mTotal  = s.processed ?? 0;
        setEl('prof-resolution-sub',  mTotal > 0 ? `${mClosed} closed of ${mTotal} processed` : 'No cases processed yet');
        setEl('prof-ontime-sub',      (s.on_time_rate === 0 && mClosed === 0) ? 'Awaiting case completions' : '');
        setEl('prof-efficiency-sub',  profEff === '0%' ? 'Will update as cases close' : '');

        /* Also update the command center resolution rate card */
        if (s.rate != null) setEl('stat-resolution-rate', s.rate + '%');
    } catch (_) {
        /* Graceful fallback using in-memory data */
        setEl('prof-cases',    String(window.dispatchCounts?.active_cases ?? ACTIVE_CASES.length));
        setEl('prof-closed',   String(window.dispatchCounts?.closed_cases ?? 0));
        setEl('prof-caseload', String(ACTIVE_CASES.length));
        setEl('prof-officers-count', String(FIELD_OFFICERS_DATA.length));
        setEl('prof-active-brgy', '4');
    }
}

function renderOfficers() {
    const grid = document.getElementById('officers-grid');
    if (!grid) return;

    grid.innerHTML = OFFICERS_DATA.map(o => {
        const initials = String(o.name || 'FO').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0,2).toUpperCase();
        const handled  = Number(o.cases_closed) || 0;
        const rating   = Number(o.rating) || 0;
        const active   = Number(o.active_count) || 0;
        const workload = Math.round(Math.min(100, (active / 5) * 100));
        const statusLabel = o.status === 'available' ? 'AVAILABLE' : o.status === 'busy' ? 'BUSY' : 'OFFLINE';
        const chatKey  = _chatPartnerKey(_chatReceiverRole(o), o.user_id || o.id);
        const hasAlert = officerChatAlertMap[chatKey];

        return `
        <div class="officer-full-card">
          <div class="officer-full-header">
            <div class="officer-avatar-lg">${initials}</div>
            <div style="flex:1">
              <div class="officer-full-name">${safeText(o.name)}</div>
              <div class="officer-full-brgy">${_officerRoleLabel(o)} · Brgy. ${safeText(o.brgy || 'N/A')}</div>
            </div>
            <span class="badge ${_badgeClassByStatus(o.status)}">${statusLabel}</span>
          </div>
          <div class="officer-stats-row">
            <div class="officer-stat-box">
              <div class="officer-stat-val">${handled}</div>
              <div class="officer-stat-label">Handled</div>
            </div>
            <div class="officer-stat-box">
              <div class="officer-stat-val">${rating.toFixed(2)}</div>
              <div class="officer-stat-label">Score</div>
            </div>
            <div class="officer-stat-box">
              <div class="officer-stat-val">${_officerRoleLabel(o)}</div>
              <div class="officer-stat-label">Duty</div>
            </div>
          </div>
          ${perfBar(`Workload`, workload)}
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn-secondary btn-sm" style="flex:1" onclick="openOfficerCasesModal('${safeText(String(o.id))}','${safeText(o.name)}')">View Cases</button>
            <button id="contact-btn-${safeText(chatKey)}" class="${hasAlert ? 'btn-danger' : 'btn-secondary'} btn-sm" style="flex:1" onclick="openChatModal('${safeText(o.user_id || o.id)}','${safeText(o.name)}','${_chatReceiverRole(o)}')">Message</button>
          </div>
        </div>`;
    }).join('');
}

function switchOfficerCaseTab(el, targetId) {
    const tabsEl = el.closest('.officer-case-tabs');
    if (tabsEl) tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const body = el.closest('.modal-body');
    if (body) body.querySelectorAll('.officer-case-panel').forEach(p => { p.style.display = 'none'; });
    const target = document.getElementById(targetId);
    if (target) target.style.display = '';
}

async function openOfficerCasesModal(officerId, officerName) {
    let cases = [];
    try {
        const resp = await apiFetch('dispatch.php', {action: 'officerCases', officer_id: officerId});
        cases = Array.isArray(resp.cases) ? resp.cases : [];
    } catch (e) {
        showToast('Could not load officer cases.');
        return;
    }

    const activeCases   = cases.filter(c => ['assigned', 'in_progress'].includes(c.status));
    const resolvedCases = cases.filter(c => ['resolved', 'closed'].includes(c.status));
    const failedCases   = cases.filter(c => ['failed', 'reassigned'].includes(c.asgn_status));
    const allCases      = cases;

    const buildTable = (list) => {
        if (!list.length) {
            return `<div class="empty-state" style="padding:32px 0"><div class="empty-title">No cases in this category</div></div>`;
        }
        const rows = list.map(c => `
          <tr>
            <td class="track-id" style="font-size:11px;white-space:nowrap">${safeText(c.id)}</td>
            <td style="font-size:12px">${safeText(c.cat)}</td>
            <td style="font-size:12px">${safeText(c.brgy)}</td>
            <td>${priorityBadge(c.priority)}</td>
            <td>${statusBadge(c.status)}</td>
            <td class="mono" style="font-size:11px">${formatDateTime(c.date)}</td>
          </tr>`).join('');
        return `
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Tracking ID</th><th>Category</th><th>Barangay</th>
                <th>Priority</th><th>Status</th><th>Date Assigned</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
    };

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal modal-lg" style="max-width:820px">
          <div class="modal-head">
            <div>
              <div class="modal-title">Case Tracking</div>
              <div class="modal-subtitle">${safeText(officerName)} — ${allCases.length} case(s) on record</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body" style="padding:0">
            <div class="tabs officer-case-tabs" style="margin:0;padding:0 20px;border-bottom:2px solid var(--border)">
              <div class="tab active" onclick="switchOfficerCaseTab(this,'oct-active')">
                Active &nbsp;<span style="opacity:.6;font-size:11px">(${activeCases.length})</span>
              </div>
              <div class="tab" onclick="switchOfficerCaseTab(this,'oct-resolved')">
                Resolved / Closed &nbsp;<span style="opacity:.6;font-size:11px">(${resolvedCases.length})</span>
              </div>
              <div class="tab" onclick="switchOfficerCaseTab(this,'oct-failed')">
                Failed / Reassigned &nbsp;<span style="opacity:.6;font-size:11px">(${failedCases.length})</span>
              </div>
              <div class="tab" onclick="switchOfficerCaseTab(this,'oct-all')">
                All &nbsp;<span style="opacity:.6;font-size:11px">(${allCases.length})</span>
              </div>
            </div>
            <div id="oct-active"   class="officer-case-panel">${buildTable(activeCases)}</div>
            <div id="oct-resolved" class="officer-case-panel" style="display:none">${buildTable(resolvedCases)}</div>
            <div id="oct-failed"   class="officer-case-panel" style="display:none">${buildTable(failedCases)}</div>
            <div id="oct-all"      class="officer-case-panel" style="display:none">${buildTable(allCases)}</div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>`);
}

    function refreshOfficerContactButtonStyles() {
      OFFICERS_DATA.forEach(o => {
        const key = _chatPartnerKey(_chatReceiverRole(o), o.user_id || o.id);
        const btn = document.getElementById(`contact-btn-${key}`);
        if (!btn) return;
        btn.classList.remove('btn-secondary', 'btn-danger');
        btn.classList.add(officerChatAlertMap[key] ? 'btn-danger' : 'btn-secondary');
      });
      updateOfficerNavBadge();
    }

    async function refreshOfficerChatAlerts({baselineOnly = false} = {}) {
      if (!OFFICERS_DATA.length) return;

      const checks = OFFICERS_DATA.map(async o => {
        const receiverRole = _chatReceiverRole(o);
        const receiverId = String(o.user_id || o.id || '');
        if (!receiverId) return;

        const chatKey = _chatPartnerKey(receiverRole, receiverId);
        try {
          const resp = await apiFetch('messages.php', {action: 'thread', receiver_role: receiverRole, receiver_id: receiverId});
          const messages = Array.isArray(resp.messages) ? resp.messages : [];
          const incoming = messages.filter(m => String(m.senderRole || '') !== 'dispatch');
          const lastIncomingId = incoming.length ? Number(incoming[incoming.length - 1].id || 0) : 0;
          const prevIncomingId = Number(officerLastIncomingMap[chatKey] || 0);

          if (!Object.prototype.hasOwnProperty.call(officerLastIncomingMap, chatKey) || baselineOnly) {
            officerLastIncomingMap[chatKey] = lastIncomingId;
            officerUnreadCountMap[chatKey] = 0;
            return;
          }

          const newIncomingCount = incoming.filter(m => Number(m.id || 0) > prevIncomingId).length;
          if (newIncomingCount > 0) {
            officerUnreadCountMap[chatKey] = Number(officerUnreadCountMap[chatKey] || 0) + newIncomingCount;
            officerChatAlertMap[chatKey] = true;
            if (!(activeChat && String(activeChat.receiverRole) === String(receiverRole) && String(activeChat.receiverId) === String(receiverId))) {
              showNotification(`New message from ${o.name || 'Field Officer'}`, `${newIncomingCount} unread message(s)`);
            }
          }
          officerLastIncomingMap[chatKey] = Math.max(prevIncomingId, lastIncomingId);
        } catch (error) {
          console.warn('Unable to refresh officer chat alerts:', error.message);
        }
      });

      await Promise.all(checks);
      refreshOfficerContactButtonStyles();
    }

    function startOfficerChatAlertPolling() {
      if (officerChatAlertInterval) clearInterval(officerChatAlertInterval);
      refreshOfficerChatAlerts({baselineOnly: true});
      officerChatAlertInterval = setInterval(() => {
        refreshOfficerChatAlerts();
      }, 5000);
    }

/* ── SVG donut chart for status distribution ── */
function _buildDonutChart(statusData) {
    const STATUS_COLORS = {
        submitted: '#4F46E5', verified: '#10b981', assigned: '#f59e0b',
        in_progress: '#f97316', resolved: '#059669', closed: '#6b7280',
        rejected: '#ef4444', cancelled: '#9ca3af',
    };
    const data = (statusData || []).map(s => {
        const key = String(s.status || '').toLowerCase().trim();
        return { label: key || 'unknown', value: Number(s.cnt || 0), color: STATUS_COLORS[key] || '#aaa' };
    }).filter(d => d.value > 0);
    if (!data.length) return '<div style="color:var(--mist);font-size:13px;padding:12px">No complaint data yet.</div>';

    const total = data.reduce((s, d) => s + d.value, 0);
    const cx = 90, cy = 90, r = 72, inner = 44;
    const toXY = (angle) => {
        const rad = (angle - 90) * Math.PI / 180;
        return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };

    let paths = '', angle = 0;
    data.forEach(d => {
        const sweep = (d.value / total) * 360;
        const [x1, y1] = toXY(angle);
        const [x2, y2] = toXY(angle + sweep);
        paths += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${sweep > 180 ? 1 : 0},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${d.color}" opacity=".9"><title>${d.label}: ${d.value} (${Math.round(d.value/total*100)}%)</title></path>`;
        angle += sweep;
    });

    const legend = data.map(d => `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
            <div style="width:10px;height:10px;border-radius:2px;background:${d.color};flex-shrink:0"></div>
            <div style="flex:1;font-size:12px;text-transform:capitalize">${safeText(d.label)}</div>
            <div style="font-family:var(--font-mono);font-size:12px;font-weight:700">${d.value}</div>
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--mist);min-width:32px;text-align:right">${Math.round(d.value/total*100)}%</div>
        </div>`).join('');

    return `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div style="flex-shrink:0">
            <svg viewBox="0 0 180 180" width="170" height="170">
                ${paths}
                <circle cx="${cx}" cy="${cy}" r="${inner}" fill="white"/>
                <text x="${cx}" y="${cy - 7}" text-anchor="middle" font-size="24" font-weight="800" fill="#111">${total}</text>
                <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="10" fill="#888" letter-spacing="1">TOTAL</text>
            </svg>
        </div>
        <div style="flex:1;min-width:150px">${legend}</div>
    </div>`;
}

/* ── SVG bar chart for monthly trend ── */
function _buildMonthlyBarChart(monthlyData) {
    if (!monthlyData || !monthlyData.length) {
        return '<div style="color:var(--mist);font-size:13px">No trend data available.</div>';
    }
    const maxVal = Math.max(...monthlyData.map(m => Number(m.count || 0)), 1);
    const bw = 56, gap = 18, chartH = 140, paddingL = 10;
    const svgW = monthlyData.length * (bw + gap) - gap + paddingL * 2;

    const bars = monthlyData.map((m, i) => {
        const val = Number(m.count || 0);
        const barH = Math.max(2, Math.round((val / maxVal) * chartH));
        const x = paddingL + i * (bw + gap);
        const y = chartH - barH;
        return `
            <rect x="${x}" y="${y}" width="${bw}" height="${barH}" fill="#111" rx="4" opacity="${val ? 0.85 : 0.15}"/>
            ${val ? `<text x="${x + bw/2}" y="${y - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="#111">${val}</text>` : ''}
            <text x="${x + bw/2}" y="${chartH + 18}" text-anchor="middle" font-size="10" fill="#888">${safeText(m.label)}</text>`;
    }).join('');

    return `<div style="overflow-x:auto">
        <svg viewBox="0 0 ${svgW} ${chartH + 28}" style="min-width:${svgW}px;width:100%;height:${chartH + 28}px">${bars}</svg>
    </div>`;
}

async function renderAnalytics() {
    let d = null;
    try { d = await apiFetch('dispatch.php', {action: 'analytics'}); } catch (_) {}

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    /* ── KPI cards ── */
    if (d) {
        window.dispatchAnalytics = d;
        const total    = d.total    ?? 0;
        const resolved = d.resolved ?? 0;
        setEl('analytics-total',    String(total));
        setEl('analytics-rejected', d.rejected ?? '—');
        setEl('analytics-active',   d.active   ?? '—');

        const rateDisplay = d.rate != null ? d.rate + '%' : '—';
        setEl('analytics-rate',       rateDisplay);
        setEl('stat-resolution-rate', rateDisplay);

        /* Sub-labels with context */
        setEl('analytics-rate-sub',  `${resolved} of ${total} resolved`);
        setEl('analytics-avg-sub',   resolved > 0 ? 'Hours per closed case' : 'No closed cases yet');
        setEl('analytics-avg', d.avg_hours != null ? parseFloat(d.avg_hours).toFixed(1) + 'h' : '—');
    }

    /* ── Complaints by Category ── */
    const catEl = document.getElementById('cat-bars');
    if (catEl) {
        const cats = d?.categories || [];
        if (cats.length) {
            const maxC = Math.max(...cats.map(c => Number(c.cnt || 0)), 1);
            catEl.innerHTML = cats.map(c => perfBar(`${safeText(c.category)} (${c.cnt})`, Math.round(Number(c.cnt) / maxC * 100))).join('');
        } else {
            catEl.innerHTML = '<div style="color:var(--mist);font-size:13px">No category data this month.</div>';
        }
    }

    /* ── Status Donut Chart ── */
    const pieEl = document.getElementById('status-pie');
    if (pieEl) pieEl.innerHTML = _buildDonutChart(d?.status_dist || []);

    /* ── Priority Breakdown ── */
    const prioEl = document.getElementById('priority-bars');
    if (prioEl) {
        const PRIO_COLORS = { urgent: '#dc2626', high: '#f59e0b', medium: '#3b82f6', low: '#10b981' };
        const prios = d?.priority_stats || [];
        const totalP = prios.reduce((s, p) => s + Number(p.cnt || 0), 0) || 1;
        if (prios.length) {
            prioEl.innerHTML = prios.map(p => {
                const pct = Math.round(Number(p.cnt) / totalP * 100);
                const color = PRIO_COLORS[p.priority] || '#888';
                return `<div style="margin-bottom:14px">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
                        <span style="text-transform:capitalize;font-weight:600">${safeText(p.priority)}</span>
                        <span style="font-family:var(--font-mono);color:var(--mist)">${p.cnt} cases · ${pct}%</span>
                    </div>
                    <div style="height:9px;background:#f0f0f0;border-radius:5px;overflow:hidden">
                        <div style="height:100%;width:${pct}%;background:${color};border-radius:5px;transition:width .5s"></div>
                    </div>
                </div>`;
            }).join('');
        } else {
            prioEl.innerHTML = '<div style="color:var(--mist);font-size:13px">No priority data this month.</div>';
        }
    }

    /* ── Barangay Bars ── */
    const brgyEl = document.getElementById('barangay-bars');
    if (brgyEl) {
        const brgys = d?.barangay_stats || [];
        if (brgys.length) {
            const maxB = Math.max(...brgys.map(b => Number(b.cnt || 0)), 1);
            brgyEl.innerHTML = brgys.map(b => perfBar(`${safeText(b.brgy || 'Unknown')} (${b.cnt})`, Math.round(Number(b.cnt) / maxB * 100))).join('');
        } else {
            brgyEl.innerHTML = '<div style="color:var(--mist);font-size:13px">No barangay data this month.</div>';
        }
    }

    /* ── Monthly Trend ── */
    const trendEl = document.getElementById('monthly-trend-chart');
    if (trendEl) trendEl.innerHTML = _buildMonthlyBarChart(d?.monthly_trend || []);

    /* ── Officer Performance Table ── */
    const perfEl = document.getElementById('officer-perf-list');
    if (perfEl) {
        const officers = d?.officer_perf || [];
        if (officers.length) {
            const STATUS_CLS = { available: 'badge-verified', busy: 'badge-assigned', offline: 'badge-closed' };
            const rows = officers.map(o => {
                const initials = String(o.name || 'FO').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
                const rating   = parseFloat(o.avg_rating || 0);
                const stars    = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
                const sCls     = STATUS_CLS[o.status] || 'badge-closed';
                const sLabel   = o.status === 'available' ? 'AVAILABLE' : o.status === 'busy' ? 'BUSY' : 'OFFLINE';
                const ratingCount = Number(o.rating_count) || 0;
                return `<tr>
                    <td>
                        <div style="display:flex;align-items:center;gap:10px">
                            <div class="officer-initials" style="width:32px;height:32px;font-size:11px;flex-shrink:0">${initials}</div>
                            <div>
                                <div style="font-size:13px;font-weight:600">${safeText(o.name)}</div>
                                <div style="font-size:11px;color:var(--mist);font-family:var(--font-mono)">Brgy. ${safeText(o.brgy || '—')} · Badge: ${safeText(o.code || '—')}</div>
                            </div>
                        </div>
                    </td>
                    <td><span class="badge ${sCls}">${sLabel}</span></td>
                    <td style="text-align:center;font-family:var(--font-head);font-size:20px;font-weight:800;color:var(--ink)">${Number(o.resolved) || 0}</td>
                    <td style="text-align:center;font-family:var(--font-head);font-size:20px;font-weight:800;color:var(--amber)">${Number(o.active_count) || 0}</td>
                    <td>
                        <div style="font-size:13px;font-weight:700;color:var(--green)">${rating > 0 ? rating.toFixed(2) : '—'}</div>
                        <div style="font-size:11px;color:#f59e0b;letter-spacing:1px">${rating > 0 ? stars : 'No ratings yet'}</div>
                        ${ratingCount > 0 ? `<div style="font-size:10px;color:var(--mist)">${ratingCount} rating(s)</div>` : ''}
                    </td>
                    <td style="text-align:center">
                        <button class="btn-secondary btn-sm" onclick="printOfficerReport('${safeText(String(o.officer_id))}','${safeText(o.name)}')">&#128424; Print</button>
                    </td>
                </tr>`;
            }).join('');
            perfEl.innerHTML = `
            <div class="table-wrap">
                <table>
                    <thead><tr>
                        <th>Officer</th><th>Status</th>
                        <th style="text-align:center">Resolved</th>
                        <th style="text-align:center">Active</th>
                        <th>Citizen Rating</th>
                        <th style="text-align:center">Report</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        } else {
            perfEl.innerHTML = '<div style="padding:16px;color:var(--mist);font-size:13px">No officer data available.</div>';
        }
    }
}

/* ─────────────────────────────────────────────────────────────
   PRINT UTILITIES
   ───────────────────────────────────────────────────────────── */

const _PRINT_STYLES = `
  body{font-family:Arial,sans-serif;margin:40px;color:#111;font-size:13px}
  .logo{font-size:20px;font-weight:900;letter-spacing:-0.5px}
  .logo-sub{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em}
  h2{font-size:17px;margin:0 0 4px}
  .period-tag{display:inline-block;background:#111;color:#fff;font-size:11px;padding:2px 10px;border-radius:4px;margin-bottom:18px}
  .meta{font-size:12px;color:#555;margin-bottom:3px}
  .section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #111;padding-bottom:5px;margin:20px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#111;color:#fff;padding:7px 10px;text-align:left}
  td{border:1px solid #e5e5e5;padding:6px 10px}
  tr:nth-child(even) td{background:#f9f9f9}
  .stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
  .stat-box{border:1px solid #e5e5e5;padding:14px;border-radius:6px;text-align:center}
  .stat-val{font-size:26px;font-weight:900}
  .stat-label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-top:3px}
  .footer{margin-top:36px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:10px;color:#aaa}
  .avatar{width:56px;height:56px;background:#111;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;float:left;margin-right:16px}
  .header-info{overflow:hidden;padding-top:4px}
  @media print{body{margin:16px}}
`;

function _openPrintWindow(html) {
    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) { showToast('Please allow popups to print reports.'); return; }
    win.document.write(html);
    win.document.close();
}

function _printHeader(title, subtitle, dispatchName) {
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;border-bottom:2px solid #111;padding-bottom:14px">
        <div>
            <div class="logo">TRAPICO</div>
            <div class="logo-sub">Traffic Complaint &amp; Case Management System</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#888">
            Generated: ${new Date().toLocaleString()}<br>
            Dispatch: ${safeText(dispatchName || '—')}
        </div>
    </div>
    <h2>${safeText(title)}</h2>
    ${subtitle ? `<div class="meta">${safeText(subtitle)}</div>` : ''}`;
}

/* ── Officer Performance PDF ── */
async function printOfficerReport(officerId, officerName) {
    showToast('Preparing officer report…');
    const officer = [...FIELD_OFFICERS_DATA, ...OFFICERS_DATA].find(o => String(o.id) === String(officerId) || String(o.officer_id) === String(officerId));

    let cases = [];
    try {
        const resp = await apiFetch('dispatch.php', {action: 'officerCases', officer_id: officerId});
        cases = Array.isArray(resp.cases) ? resp.cases : [];
    } catch (_) {}

    const initials  = String(officerName || 'FO').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
    const handled   = Number(officer?.cases_closed) || 0;
    const active    = Number(officer?.active_count)  || 0;
    const rating    = parseFloat(officer?.rating || 0);
    const status    = officer?.status || 'offline';
    const badge     = officer?.code   || '—';
    const brgy      = officer?.brgy   || '—';

    const caseRows = cases.map(c => `<tr>
        <td style="font-size:11px;white-space:nowrap">${safeText(c.id)}</td>
        <td>${safeText(c.cat)}</td>
        <td>${safeText(c.brgy)}</td>
        <td style="text-transform:capitalize">${safeText(c.priority)}</td>
        <td style="text-transform:capitalize">${safeText(c.status)}</td>
        <td style="text-transform:capitalize">${safeText(c.asgn_status || '—')}</td>
        <td style="font-size:11px">${c.date ? new Date(c.date).toLocaleDateString('en-PH') : '—'}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Officer Report — ${safeText(officerName)}</title>
    <style>${_PRINT_STYLES}</style></head><body>
    ${_printHeader('Field Officer Report', '', DISPATCH_USER?.name)}
    <div style="overflow:hidden;margin-bottom:20px">
        <div class="avatar">${initials}</div>
        <div class="header-info">
            <div style="font-size:18px;font-weight:800">${safeText(officerName)}</div>
            <div class="meta">Badge: ${safeText(badge)} &nbsp;|&nbsp; Barangay: ${safeText(brgy)}</div>
            <div class="meta">Status: <strong style="text-transform:uppercase">${safeText(status)}</strong></div>
        </div>
    </div>
    <div class="stat-row">
        <div class="stat-box"><div class="stat-val" style="color:#111">${handled}</div><div class="stat-label">Resolved Cases</div></div>
        <div class="stat-box"><div class="stat-val" style="color:#f59e0b">${active}</div><div class="stat-label">Active Cases</div></div>
        <div class="stat-box"><div class="stat-val" style="color:#10b981">${rating > 0 ? rating.toFixed(2) : '—'}</div><div class="stat-label">Citizen Rating</div></div>
    </div>
    <div class="section-title">Case History (${cases.length} records)</div>
    ${cases.length ? `<table><thead><tr>
        <th>Tracking ID</th><th>Category</th><th>Barangay</th><th>Priority</th><th>Case Status</th><th>Assignment</th><th>Date</th>
    </tr></thead><tbody>${caseRows}</tbody></table>`
    : '<p style="color:#888">No case history on record for this officer.</p>'}
    <div class="footer">TRAPICO — Computer-generated document. All data sourced from live database.</div>
    <script>window.onload=()=>window.print();</script></body></html>`;

    _openPrintWindow(html);
}

/* ── Section Print — period picker modal ── */
function openPrintSectionModal(sectionKey, sectionTitle) {
    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:380px">
          <div class="modal-head">
            <div>
              <div class="modal-title">&#128424; Print Report</div>
              <div class="modal-subtitle">${safeText(sectionTitle)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="section-title" style="margin-bottom:14px">Select Time Period</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <button class="btn-secondary" onclick="printAnalyticsSection('${safeText(sectionKey)}','${safeText(sectionTitle)}','week');closeModal()">Weekly<br><span style="font-size:10px;color:var(--mist)">Last 7 days</span></button>
              <button class="btn-secondary" onclick="printAnalyticsSection('${safeText(sectionKey)}','${safeText(sectionTitle)}','month');closeModal()">Monthly<br><span style="font-size:10px;color:var(--mist)">This month</span></button>
              <button class="btn-secondary" onclick="printAnalyticsSection('${safeText(sectionKey)}','${safeText(sectionTitle)}','3month');closeModal()">3 Months<br><span style="font-size:10px;color:var(--mist)">Last 90 days</span></button>
              <button class="btn-secondary" onclick="printAnalyticsSection('${safeText(sectionKey)}','${safeText(sectionTitle)}','6month');closeModal()">6 Months<br><span style="font-size:10px;color:var(--mist)">Last 180 days</span></button>
              <button class="btn-secondary" style="grid-column:1/-1" onclick="printAnalyticsSection('${safeText(sectionKey)}','${safeText(sectionTitle)}','year');closeModal()">Yearly<br><span style="font-size:10px;color:var(--mist)">This calendar year</span></button>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
          </div>
        </div>
      </div>`);
}

/* ── Section Print — fetch + generate print window ── */
async function printAnalyticsSection(sectionKey, sectionTitle, period) {
    showToast('Loading data…');
    let d = null;
    try { d = await apiFetch('dispatch.php', {action: 'analytics', period}); } catch (_) {
        showToast('Could not load report data.');
        return;
    }

    const PERIOD_LABELS = {
        week: 'Last 7 Days', month: 'This Month',
        '3month': 'Last 3 Months', '6month': 'Last 6 Months', year: 'This Year',
    };
    const periodLabel = PERIOD_LABELS[period] || d?.period_label || period;

    let bodyHtml = '';
    const total = (d?.categories || []).reduce((s, c) => s + Number(c.cnt || 0), 0) || 1;

    if (sectionKey === 'category') {
        const cats = d?.categories || [];
        const maxC = Math.max(...cats.map(c => Number(c.cnt || 0)), 1);
        bodyHtml = cats.length ? `<table><thead><tr><th>Category</th><th>Count</th><th>% of Total</th></tr></thead><tbody>
            ${cats.map(c => `<tr><td>${safeText(c.category)}</td><td>${c.cnt}</td><td>${Math.round(Number(c.cnt)/maxC*100)}%</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:#888">No data for this period.</p>';

    } else if (sectionKey === 'status') {
        const stats = d?.status_dist || [];
        const tot   = stats.reduce((s, x) => s + Number(x.cnt), 0) || 1;
        bodyHtml = stats.length ? `<table><thead><tr><th>Status</th><th>Count</th><th>% of All</th></tr></thead><tbody>
            ${stats.map(s => `<tr><td style="text-transform:capitalize">${safeText(s.status)}</td><td>${s.cnt}</td><td>${Math.round(Number(s.cnt)/tot*100)}%</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:#888">No status data.</p>';

    } else if (sectionKey === 'priority') {
        const prios = d?.priority_stats || [];
        const tot   = prios.reduce((s, p) => s + Number(p.cnt), 0) || 1;
        bodyHtml = prios.length ? `<table><thead><tr><th>Priority</th><th>Count</th><th>%</th></tr></thead><tbody>
            ${prios.map(p => `<tr><td style="text-transform:capitalize">${safeText(p.priority)}</td><td>${p.cnt}</td><td>${Math.round(Number(p.cnt)/tot*100)}%</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:#888">No data for this period.</p>';

    } else if (sectionKey === 'barangay') {
        const brgys = d?.barangay_stats || [];
        const maxB  = Math.max(...brgys.map(b => Number(b.cnt || 0)), 1);
        bodyHtml = brgys.length ? `<table><thead><tr><th>Barangay</th><th>Count</th><th>Share</th></tr></thead><tbody>
            ${brgys.map(b => `<tr><td>${safeText(b.brgy || 'Unknown')}</td><td>${b.cnt}</td><td>${Math.round(Number(b.cnt)/maxB*100)}%</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:#888">No data for this period.</p>';

    } else if (sectionKey === 'trend') {
        const trend = d?.monthly_trend || [];
        bodyHtml = trend.length ? `<table><thead><tr><th>Month</th><th>Complaints</th></tr></thead><tbody>
            ${trend.map(m => `<tr><td>${safeText(m.label)}</td><td>${m.count}</td></tr>`).join('')}
        </tbody></table>` : '<p style="color:#888">No trend data.</p>';
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TRAPICO Analytics — ${safeText(sectionTitle)}</title>
    <style>${_PRINT_STYLES}</style></head><body>
    ${_printHeader('Analytics Report', sectionTitle, DISPATCH_USER?.name)}
    <div class="period-tag">Period: ${safeText(periodLabel)}</div>
    <div class="section-title">${safeText(sectionTitle)}</div>
    ${bodyHtml}
    <div class="footer">TRAPICO — Computer-generated analytics report. All data sourced from live database.</div>
    <script>window.onload=()=>window.print();</script></body></html>`;

    _openPrintWindow(html);
}

function editProfile() {
    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <div>
              <div class="modal-title">Edit Profile</div>
              <div class="modal-subtitle">Update dispatch officer details</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div style="text-align:center; margin-bottom:16px">
              <img id="edit-profile-photo-preview" src="https://i.pravatar.cc/120?img=68" style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:2px solid var(--border)" alt="Profile Photo" />
            </div>
            <div class="form-group">
              <label for="edit-profile-name">Full Name</label>
              <input id="edit-profile-name" class="form-input" type="text" value="${safeText(DISPATCH_USER.name)}" />
            </div>
            <div class="form-group">
              <label for="edit-profile-email">Email</label>
              <input id="edit-profile-email" class="form-input" type="email" value="${safeText(DISPATCH_USER.email)}" />
            </div>
            <div class="form-group">
              <label for="edit-profile-phone">Phone</label>
              <input id="edit-profile-phone" class="form-input" type="tel" value="${safeText(DISPATCH_USER.phone || '+63 ')}" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn-primary" onclick="submitProfileEdit()">Save Changes</button>
          </div>
        </div>
      </div>`);
}

async function submitProfileEdit() {
    const name = document.getElementById('edit-profile-name')?.value.trim();
    const email = document.getElementById('edit-profile-email')?.value.trim();
    const phone = document.getElementById('edit-profile-phone')?.value.trim();

    if (!name || !email || !phone) {
        showToast('All fields are required.');
        return;
    }

    try {
        await apiFetch('user.php', {action: 'updateProfile', name, email, phone}, 'POST');
        DISPATCH_USER.name = name;
        DISPATCH_USER.email = email;
        DISPATCH_USER.phone = phone;
        renderProfile();
        closeModal();
        showToast('Profile updated successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

function _passEyeField(id, label, placeholder) {
    return `<div class="form-group">
      <label>${label}</label>
      <div style="position:relative">
        <input id="${id}" class="form-input" type="password" placeholder="${placeholder}" style="padding-right:42px" />
        <button type="button" onclick="togglePassVis('${id}','eye-${id}')" id="eye-${id}"
          style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:18px;opacity:.45;transition:opacity .15s;line-height:1"
          title="Show / hide">&#128065;</button>
      </div>
    </div>`;
}

function togglePassVis(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(btnId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    if (btn) btn.style.opacity = input.type === 'text' ? '1' : '.45';
}

function changePassword() {
    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:450px">
          <div class="modal-head">
            <div class="modal-title">Change Password</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            ${_passEyeField('current-pass','Current Password','Enter current password')}
            ${_passEyeField('new-pass','New Password','Enter new password')}
            ${_passEyeField('confirm-pass','Confirm Password','Confirm new password')}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn-primary" onclick="submitPasswordChange()">✓ Change Password</button>
          </div>
        </div>
      </div>`);
}

async function submitPasswordChange() {
    const current = document.getElementById('current-pass')?.value.trim();
    const nw = document.getElementById('new-pass')?.value.trim();
    const confirm = document.getElementById('confirm-pass')?.value.trim();

    if (!current || !nw || !confirm) {
        showToast('Please fill in all password fields.');
        return;
    }
    if (nw !== confirm) {
        showToast('New passwords do not match.');
        return;
    }
    if (nw.length < 8) {
        showToast('Password must be at least 8 characters long.');
        return;
    }

    try {
        await apiFetch('user.php', {action: 'changePassword', currentPassword: current, newPassword: nw}, 'POST');
        closeModal();
        showToast('✓ Password changed successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

function viewActivityLog() {
    const activities = [
        {time: '2 min ago', action: 'Viewed complaint queue', detail: 'Accessed Complaint Queue page'},
        {time: '5 min ago', action: 'Assigned case to officer', detail: 'TRAPICO-2026-03-000014 → Officer'},
        {time: '12 min ago', action: 'Verified complaint', detail: 'TRAPICO-2026-03-000015 marked as verified'},
        {time: '18 min ago', action: 'Closed case', detail: 'TRAPICO-2026-03-000012 marked as closed'},
        {time: '25 min ago', action: 'Sent message to officer', detail: 'Message to available field officer'},
        {time: '42 min ago', action: 'Viewed analytics', detail: 'Accessed Analytics page'},
        {time: '1 hr ago', action: 'Logged in', detail: 'Session started'},
    ];

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="max-width:600px">
          <div class="modal-head">
            <div>
              <div class="modal-title">Activity Log</div>
              <div class="modal-subtitle">Your recent actions in TRAPICO</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body" style="padding:0">
            ${activities.map(a => `
              <div style="padding:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:start">
                <div style="flex:1">
                  <div style="font-weight:600;font-size:13px">${safeText(a.action)}</div>
                  <div style="font-size:12px;color:var(--mist);margin-top:4px">${safeText(a.detail)}</div>
                </div>
                <div style="font-size:12px;color:var(--mist);white-space:nowrap;margin-left:12px">${safeText(a.time)}</div>
              </div>`).join('')}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>`);
}

function openChatModal(officerId, officerName, receiverRole = 'field') {
    if (!officerId) {
        showToast('Officer ID is required for chat.');
        return;
    }
    const chatKey = _chatPartnerKey(receiverRole, officerId);
    officerChatAlertMap[chatKey] = false;
    officerUnreadCountMap[chatKey] = 0;
    refreshOfficerContactButtonStyles();
    activeChat = {receiverRole, receiverId: officerId, name: officerName};
    chatLastId = 0;

    const theirInitials = String(officerName || 'F').split(' ').filter(Boolean).map(p => p[0]).join('').slice(0,2).toUpperCase();

    openModal(`
      <div class="modal-overlay" onclick="if(event.target===this){closeModal();stopChatPolling();}">
        <div class="modal" style="max-width:580px;height:600px;padding:0;overflow:hidden;display:flex;flex-direction:column">
          <div class="modal-head" style="flex-shrink:0">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:38px;height:38px;border-radius:50%;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0">${safeText(theirInitials)}</div>
              <div>
                <div class="modal-title" style="font-size:15px">${safeText(officerName)}</div>
                <div class="modal-subtitle">Field Officer &mdash; Command Chat</div>
              </div>
            </div>
            <button class="modal-close" onclick="closeModal();stopChatPolling();">&#x2715;</button>
          </div>
          <div id="chat-body" style="flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:6px;background:#f2f4f8"></div>
          <div style="display:flex;gap:8px;padding:10px 14px;background:#fff;border-top:1px solid var(--border);flex-shrink:0;align-items:center">
            <input id="chat-input" class="form-input" style="flex:1;border-radius:999px;padding:8px 14px;font-size:13px" type="text" placeholder="Type a message…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage();}" />
            <button onclick="sendChatMessage()" style="border-radius:999px;padding:8px 16px;font-size:12px;font-weight:700;background:var(--ink);color:#fff;border:none;cursor:pointer;flex-shrink:0;letter-spacing:0.04em">SEND</button>
          </div>
        </div>
      </div>`);

    loadChatThread();
    startChatPolling();
}

async function loadChatThread() {
    if (!activeChat) return;
    try {
        const resp = await apiFetch('messages.php', {action: 'thread', receiver_role: activeChat.receiverRole, receiver_id: activeChat.receiverId});
        const messages = resp.messages || [];
        const chatKey = _chatPartnerKey(activeChat.receiverRole, activeChat.receiverId);
        const incoming = messages.filter(m => String(m.senderRole || '') !== 'dispatch');
        const lastIncomingId = incoming.length ? Number(incoming[incoming.length - 1].id || 0) : 0;
        officerLastIncomingMap[chatKey] = Math.max(Number(officerLastIncomingMap[chatKey] || 0), lastIncomingId);
        officerChatAlertMap[chatKey] = false;
        officerUnreadCountMap[chatKey] = 0;
        refreshOfficerContactButtonStyles();
        chatLastId = messages.length ? Number(messages[messages.length - 1].id) : 0;
        renderChatMessages(messages);
    } catch (error) {
        showToast(error.message);
    }
}

function renderChatMessages(messages) {
    const body = document.getElementById('chat-body');
    if (!body) return;
    const myUserId = DISPATCH_USER ? String(DISPATCH_USER.user_id || DISPATCH_USER.id || '') : '';

    if (!messages.length) {
        body.innerHTML = '<div style="text-align:center;font-size:12px;color:var(--mist);padding:24px">No messages yet. Send the first message.</div>';
        return;
    }

    let lastDate = '';
    const rows = [];
    for (const msg of messages) {
        const isMine = myUserId ? String(msg.senderId) === myUserId : String(msg.senderRole || '') === 'dispatch';
        const senderName = msg.senderName || (isMine ? 'Me' : (activeChat && activeChat.name) || 'Field Officer');
        const initials = String(senderName).split(' ').filter(Boolean).map(p => p[0]).join('').slice(0,2).toUpperCase() || '?';
        const sentAt = new Date(msg.sentAt);
        const dateStr = sentAt.toLocaleDateString();
        let dateDivider = '';
        if (dateStr !== lastDate) {
            lastDate = dateStr;
            dateDivider = `<div style="text-align:center;font-size:11px;color:var(--mist);padding:8px 0;font-family:var(--font-mono)">${safeText(dateStr)}</div>`;
        }
        const timeStr = sentAt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        const avatarColor = isMine ? '#111' : '#555';
        rows.push(`${dateDivider}
        <div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:4px;${isMine ? 'flex-direction:row-reverse' : ''}">
            <div style="width:28px;height:28px;border-radius:50%;background:${avatarColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${safeText(initials)}</div>
            <div style="max-width:72%;display:flex;flex-direction:column;${isMine ? 'align-items:flex-end' : 'align-items:flex-start'}">
                <div style="font-size:10px;font-weight:600;color:#888;margin-bottom:3px;padding:0 4px">${safeText(senderName)}</div>
                <div style="padding:9px 13px;border-radius:16px;font-size:13px;line-height:1.5;word-break:break-word;${isMine ? 'background:#111;color:#fff;border-bottom-right-radius:4px' : 'background:#fff;color:#111;border:1px solid #e0e5f0;border-bottom-left-radius:4px'}">${safeText(msg.message)}</div>
                <div style="font-size:10px;color:#aaa;margin-top:3px;padding:0 4px">${safeText(timeStr)}</div>
            </div>
        </div>`);
    }
    body.innerHTML = rows.join('');
    body.scrollTop = body.scrollHeight;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !activeChat) return;
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    try {
        await apiFetch('messages.php', {
            action: 'send',
            receiver_role: activeChat.receiverRole,
            receiver_id: activeChat.receiverId,
            message,
        }, 'POST');
        await loadChatThread();
    } catch (error) {
        showToast(error.message);
    }
}

function startChatPolling() {
    stopChatPolling();
    chatInterval = setInterval(async () => {
        if (!activeChat) return;
        try {
            const resp = await apiFetch('messages.php', {action: 'poll', receiver_role: activeChat.receiverRole, receiver_id: activeChat.receiverId, last_id: chatLastId});
            const newMsgs = resp.messages || [];
            if (newMsgs.length) {
                chatLastId = Number(newMsgs[newMsgs.length - 1].id);
                showNotification('New message from ' + (activeChat.name || 'Field Officer'), `${newMsgs.length} new message(s)`);
                await loadChatThread();
            }
        } catch (error) {
            console.warn('Chat polling error:', error.message);
        }
    }, 3000);
}

function stopChatPolling() {
    if (chatInterval) {
        clearInterval(chatInterval);
        chatInterval = null;
    }
}

/* ── Profile edit helpers ──────────────────────────────────── */
function showProfileEdit() {
    document.getElementById('profile-static').style.display = 'none';
    document.getElementById('profile-edit-form').style.display = '';
}

function cancelProfileEdit() {
    document.getElementById('profile-edit-form').style.display = 'none';
    document.getElementById('profile-static').style.display = '';
}

async function saveProfileEdit(event) {
    event.preventDefault();
    const name  = (document.getElementById('prof-name-input')?.value || '').trim();
    const email = (document.getElementById('prof-email-input')?.value || '').trim();
    const phone = (document.getElementById('prof-phone-input')?.value || '').trim();

    if (!name || !email) {
        showToast('Name and email are required.');
        return;
    }

    try {
        await apiFetch('user.php', {action: 'updateProfile', name, email, phone}, 'POST');
        DISPATCH_USER.name  = name;
        DISPATCH_USER.email = email;
        DISPATCH_USER.phone = phone;
        renderProfile();
        cancelProfileEdit();
        showToast('Profile updated successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

function _applyDispatchAvatar(dataUrl) {
    const imgStatic  = document.getElementById('prof-avatar-img-static');
    const initStatic = document.getElementById('prof-avatar-initials-static');
    if (imgStatic)  { imgStatic.src = dataUrl; imgStatic.style.display = 'block'; }
    if (initStatic) initStatic.style.display = 'none';
    /* Also update topbar avatar */
    const topbarAvatar = document.getElementById('topbar-user-avatar');
    if (topbarAvatar) {
        topbarAvatar.style.backgroundImage = `url('${dataUrl}')`;
        topbarAvatar.style.backgroundSize  = 'cover';
        topbarAvatar.textContent = '';
    }
}

function _saveDispatchAvatar(dataUrl) {
    try { localStorage.setItem('dispatch_avatar_' + (DISPATCH_USER?.id || 'default'), dataUrl); } catch (_) {}
}

function _loadDispatchAvatar() {
    try { return localStorage.getItem('dispatch_avatar_' + (DISPATCH_USER?.id || 'default')); } catch (_) { return null; }
}

function onProfileAvatarChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        _applyDispatchAvatar(e.target.result);
        _saveDispatchAvatar(e.target.result);
        showToast('Profile photo updated.');
    };
    reader.readAsDataURL(file);
}

/* ── CITIZEN RECORDS ────────────────────────────────────────── */
function _esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

let _citizenSearchTimer = null;

function debounceCitizenSearch() {
    clearTimeout(_citizenSearchTimer);
    _citizenSearchTimer = setTimeout(loadCitizens, 420);
}

async function loadCitizens() {
    const search = (document.getElementById('citizen-search')?.value || '').trim();
    const brgy   = document.getElementById('citizen-brgy')?.value || '';
    const tbody  = document.getElementById('citizen-tbody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:28px">
        <div class="empty-icon">&#9203;</div>
        <div class="empty-title">Loading citizens…</div>
      </div></td></tr>`;

    try {
        const params = new URLSearchParams({ action: 'citizens' });
        if (search) params.set('search', search);
        if (brgy)   params.set('brgy', brgy);

        const resp = await fetch('/api/dispatch.php?' + params.toString());
        const rawText = await resp.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (jsonErr) {
            /* Hostinger may inject content before/after the JSON.
               Extract the outermost {...} and try again. */
            const start = rawText.indexOf('{');
            const end   = rawText.lastIndexOf('}');
            if (start !== -1 && end > start) {
                try { data = JSON.parse(rawText.slice(start, end + 1)); }
                catch (e2) { throw new Error('Parse failed. Tail: ' + rawText.slice(-200)); }
            } else {
                throw new Error('No JSON found in response: ' + rawText.substring(0, 300));
            }
        }
        if (!data.success) throw new Error(data.error || data.message || 'Failed to load citizens');

        const list = data.citizens || [];
        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:28px">
                <div class="empty-icon">&#128100;</div>
                <div class="empty-title">No citizens found</div>
                <div class="empty-sub">Try a different search or barangay filter.</div>
              </div></td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(c => `
          <tr>
            <td style="font-weight:600">${_esc(c.full_name || '—')}</td>
            <td class="mono" style="font-size:12px">${_esc(c.email || '—')}</td>
            <td style="font-size:12px">${_esc(c.phone_number || '—')}</td>
            <td style="font-size:12px">${_esc(c.home_brgy || '—')}</td>
            <td style="text-align:center;font-weight:700">${c.total_cases || 0}</td>
            <td style="text-align:center;font-weight:700;color:var(--green)">${c.closed_cases || 0}</td>
            <td>
              <button class="btn-secondary btn-sm" onclick="printCitizenReport(${parseInt(c.user_id, 10)})">&#128424; Print PDF</button>
            </td>
          </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:28px">
            <div class="empty-icon">&#9888;</div>
            <div class="empty-title">Error loading citizens</div>
            <div class="empty-sub">${_esc(err.message)}</div>
          </div></td></tr>`;
    }
}

async function printCitizenReport(userId) {
    showToast('Preparing citizen report…');
    try {
        const resp = await fetch('/api/dispatch.php?action=citizenDetail&user_id=' + encodeURIComponent(userId));
        const data = await resp.json();
        if (!data.success) throw new Error(data.message || 'Could not load citizen data');

        const { citizen, cases } = data;
        const now = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });

        const casesRows = cases.length
            ? cases.map((c, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td><code>${_esc(c.tracking_id)}</code></td>
                  <td>${_esc(c.category)}</td>
                  <td>${_esc(c.brgy || '—')}</td>
                  <td>${_esc(c.priority || '—')}</td>
                  <td>${_esc(c.status)}</td>
                  <td>${c.submitted_at ? c.submitted_at.substring(0, 10) : '—'}</td>
                  <td>${_esc(c.description || '—')}</td>
                </tr>`).join('')
            : `<tr><td colspan="8" style="text-align:center;color:#888;padding:16px">No complaints on record</td></tr>`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Citizen Case Report — ${_esc(citizen.full_name)}</title>
<style>
  @page { margin: 18mm 14mm; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; background: #fff; }
  /* Header */
  .rpt-header { display: flex; justify-content: space-between; align-items: flex-start;
                border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
  .rpt-brand  { font-size: 24px; font-weight: 900; letter-spacing: -1px; }
  .rpt-brand-sub { font-size: 10px; color: #777; letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
  .rpt-meta   { text-align: right; font-size: 11px; color: #777; line-height: 1.6; }
  /* Section headings */
  h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
       border-bottom: 1.5px solid #ddd; padding-bottom: 5px; margin: 18px 0 10px; color: #333; }
  /* Info grid */
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; }
  .info-row  { display: flex; gap: 8px; align-items: baseline; }
  .info-lbl  { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
               color: #888; min-width: 96px; flex-shrink: 0; }
  .info-val  { font-weight: 600; font-size: 12px; }
  /* Table */
  table  { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
  thead tr { background: #111; color: #fff; }
  th  { padding: 7px 8px; text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; }
  td  { padding: 6px 8px; border-bottom: 1px solid #e8e8e8; vertical-align: top; }
  tr:nth-child(even) td { background: #f9f9f9; }
  code { font-family: monospace; font-size: 10px; background: #f0f0f0; padding: 1px 4px; border-radius: 2px; }
  /* Footer */
  .rpt-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ddd;
                font-size: 9.5px; color: #aaa; }
  @media print { @page { margin: 15mm 12mm; } }
</style>
</head>
<body>

<div class="rpt-header">
  <div>
    <div class="rpt-brand">TRAPICO</div>
    <div class="rpt-brand-sub">Traffic Complaint Information System</div>
    <div style="font-size:11px;color:#888;margin-top:6px">Quezon City — Barangay Traffic Management</div>
  </div>
  <div class="rpt-meta">
    <div style="font-size:12px;font-weight:700;color:#333">Citizen Case Report</div>
    <div>Printed: ${_esc(now)}</div>
    <div>Prepared by: Dispatch Command Center</div>
  </div>
</div>

<h2>Personal Information</h2>
<div class="info-grid">
  <div class="info-row"><span class="info-lbl">Full Name</span><span class="info-val">${_esc(citizen.full_name || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Middle Name</span><span class="info-val">${_esc(citizen.middle_name || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Email</span><span class="info-val">${_esc(citizen.email || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Phone</span><span class="info-val">${_esc(citizen.phone_number || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Sex</span><span class="info-val">${_esc(citizen.sex || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Birthdate</span><span class="info-val">${citizen.birthdate ? String(citizen.birthdate).substring(0,10) : '—'}</span></div>
  <div class="info-row"><span class="info-lbl">Barangay</span><span class="info-val">${_esc(citizen.barangay || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Street</span><span class="info-val">${_esc(citizen.street || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">City</span><span class="info-val">${_esc(citizen.city || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">Province</span><span class="info-val">${_esc(citizen.province || '—')}</span></div>
  <div class="info-row"><span class="info-lbl">ZIP Code</span><span class="info-val">${_esc(citizen.zip_code || '—')}</span></div>
</div>

<h2>Complaint History &mdash; ${cases.length} case${cases.length !== 1 ? 's' : ''} on record</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>Tracking ID</th><th>Category</th><th>Barangay</th>
      <th>Priority</th><th>Status</th><th>Date Filed</th><th>Description</th>
    </tr>
  </thead>
  <tbody>${casesRows}</tbody>
</table>

<div class="rpt-footer">
  <p>CONFIDENTIAL — For official use only. Generated by TRAPICO Dispatch Command Center on ${_esc(now)}.</p>
</div>

<script>
  window.onload = function () { window.print(); };
<\/script>
</body>
</html>`;

        const w = window.open('', '_blank', 'width=960,height=720,scrollbars=yes');
        if (!w) {
            showToast('Allow pop-ups in your browser to print the report.');
            return;
        }
        w.document.write(html);
        w.document.close();
    } catch (err) {
        showToast('Error: ' + (err.message || 'Could not generate report'));
    }
}

/* ── Page navigation hook: initialize/invalidate maps on page switch ── */
(function patchSetActivePage() {
    const _prev = typeof setActivePage === 'function' ? setActivePage : null;
    window.setActivePage = function setActivePage(pageId) {
        if (_prev) _prev(pageId);
        if (pageId === 'officers') {
          clearOfficerMessageAlerts();
            if (!_officersMap) {
                setTimeout(initOfficersPageMap, 50);
            } else {
                setTimeout(() => _officersMap.invalidateSize(), 50);
            }
        }
        if (pageId === 'dash' && _dashMap) {
            setTimeout(() => _dashMap.invalidateSize(), 50);
        }
        if (pageId === 'analytics') {
            renderAnalytics();
        }
        if (pageId === 'citizens') {
            loadCitizens();
        }
        if (pageId === 'active') {
            setTimeout(() => {
                Object.values(_activeCaseMaps).forEach(m => { try { m.invalidateSize(); } catch (_) {} });
            }, 80);
        }
    };
}());
