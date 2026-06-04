/* ============================================================
   TRAPICO — Shared Mock Data & Utility Functions
   Used by: civilian.js, dispatch.js, field.js
   ============================================================ */

'use strict';

/* ── MOCK DATA ─────────────────────────────────────────────── */

const COMPLAINTS = [
  { id:'TRAPICO-2026-03-000016', cat:'Traffic Obstruction', brgy:'Commonwealth', priority:'urgent', status:'submitted',    date:'2026-03-24 10:42', user:'jdoe',    anon:true,  desc:'Large truck blocking the intersection at Commonwealth Ave. corner Don Fabian.',                          lat:14.6760, lng:121.0437 },
  { id:'TRAPICO-2026-03-000015', cat:'Illegal Parking',     brgy:'Batasan Hills', priority:'high',   status:'verified',    date:'2026-03-24 10:15', user:'rcruz',   anon:false, desc:'Multiple vehicles illegally parked along the service road near SM Fairview.',                           lat:14.6915, lng:121.0507, duplicate:true },
  { id:'TRAPICO-2026-03-000014', cat:'Road Damage',         brgy:'Central',       priority:'medium', status:'in_progress', date:'2026-03-24 09:30', user:'mjose',   anon:false, desc:'Large pothole near Timog Ave. causing traffic slowdown and vehicle damage risk.',                        lat:14.6390, lng:121.0100 },
  { id:'TRAPICO-2026-03-000013', cat:'Signal Malfunction',  brgy:'Sto. Cristo',   priority:'high',   status:'assigned',    date:'2026-03-24 08:55', user:'agarcia', anon:false, desc:'Traffic light at the intersection has been flashing red since 7am.',                                    lat:14.6280, lng:120.9872 },
  { id:'TRAPICO-2026-03-000012', cat:'Accident',            brgy:'Commonwealth',  priority:'urgent', status:'resolved',    date:'2026-03-24 07:20', user:'jdoe',    anon:false, desc:'Minor collision between a jeepney and motorcycle. Road partially blocked.',                             lat:14.6780, lng:121.0456 },
  { id:'TRAPICO-2026-03-000011', cat:'Traffic Violation',   brgy:'Batasan Hills', priority:'low',    status:'closed',      date:'2026-03-23 16:40', user:'jdoe',    anon:false, desc:'Motorcycles using the sidewalk as a shortcut near Batasan Hills National HS.',                          lat:14.6888, lng:121.0497 },
  { id:'TRAPICO-2026-03-000010', cat:'Road Damage',         brgy:'Commonwealth',  priority:'medium', status:'closed',      date:'2026-03-22 14:10', user:'jdoe',    anon:false, desc:'Cracked road surface near Philcoa causing vehicles to swerve.',                                         lat:14.6700, lng:121.0350 },
  { id:'TRAPICO-2026-03-000009', cat:'Illegal Parking',     brgy:'Central',       priority:'low',    status:'cancelled',   date:'2026-03-21 11:05', user:'jdoe',    anon:false, desc:'Reported in error.',                                                                                      lat:14.6390, lng:121.0100 },
];

const OFFICERS = [
  { id:'OFF-001', name:'Ofc. Ramon Reyes',     initials:'RR', brgy:'Commonwealth',  active:2, onTime:94, status:'available',   distance:'0.3 km' },
  { id:'OFF-002', name:'Ofc. Liza Mendoza',    initials:'LM', brgy:'Batasan Hills',  active:4, onTime:87, status:'available',   distance:'1.1 km' },
  { id:'OFF-003', name:'Ofc. Carlo Bautista',  initials:'CB', brgy:'Central',        active:5, onTime:91, status:'at capacity', distance:'2.4 km' },
  { id:'OFF-004', name:'Ofc. Diana Tolentino', initials:'DT', brgy:'Commonwealth',   active:1, onTime:98, status:'available',   distance:'0.7 km' },
];

const BARANGAYS = ['Commonwealth', 'Batasan Hills', 'Central', 'Sto. Cristo'];

const CATEGORIES = [
  'Illegal Parking', 'Traffic Obstruction', 'Road Damage',
  'Accident', 'Signal Malfunction', 'Traffic Violation',
];

const USERS = {
  jdoe:    { name:'Juan D. Oe',        role:'regular',  avatar:'JD', email:'jdoe@gmail.com',     phone:'+63 912 345 6789', brgy:'Commonwealth' },
  dispatch:{ name:'Cpt. Maria Reyes',  role:'dispatch', avatar:'MR', email:'mreyes@ttmd.gov.ph', phone:'+63 917 000 0001', brgy:'Commonwealth' },
  field:   { name:'Ofc. Ramon Reyes',  role:'field',    avatar:'RR', email:'rreyes@ttmd.gov.ph', phone:'+63 917 000 0002', brgy:'Commonwealth' },
};

/* ── TIMELINE STAGE BUILDER ────────────────────────────────── */
function buildTimeline(complaint) {
  const c = complaint;
  const done = (statuses) => statuses.includes(c.status);

  const stages = [
    { label:'Submitted',    time:'2026-03-24 10:42', done:true,                                                                     note:'Complaint received. Tracking ID generated.' },
    { label:'Verified',     time:'2026-03-24 10:55', done:done(['verified','assigned','in_progress','resolved','closed']),           note:'Dispatch Officer validated complaint details.' },
    { label:'Assigned',     time:'2026-03-24 11:02', done:done(['assigned','in_progress','resolved','closed']),                     note:'Assigned to Ofc. Ramon Reyes.' },
    { label:'En Route',     time:'2026-03-24 11:08', done:done(['in_progress','resolved','closed']),                                note:'Officer departed to incident site.' },
    { label:'In Progress',  time:'2026-03-24 11:20', done:done(['in_progress','resolved','closed']),                                note:'Officer checked in at incident site (GPS confirmed).' },
    { label:'Resolved',     time:'2026-03-24 11:45', done:done(['resolved','closed']),                                             note:'Resolution report submitted by officer.' },
    { label:'Validated',    time:'2026-03-24 12:00', done:c.status === 'closed',                                                   note:'Dispatch Officer confirmed resolution.' },
    { label:'Closed',       time:'—',                done:c.status === 'closed',                                                   note:'Case officially closed.' },
  ];

  if (c.status === 'rejected') {
    stages.splice(1, 7, { label:'Rejected', time:'2026-03-24 10:58', done:true, rejected:true, note:'Reason: Duplicate submission detected within 100m radius.' });
  }
  if (c.status === 'cancelled') {
    stages.splice(1, 7, { label:'Cancelled', time:'2026-03-24 11:05', done:true, cancelled:true, note:'Complaint cancelled by user.' });
  }
  return stages;
}

/* ── HTML HELPERS ──────────────────────────────────────────── */

function statusBadge(status) {
  const statusStr = String(status || 'submitted').toLowerCase().trim();
  const cssMap = {
    submitted:'submitted', verified:'verified', assigned:'assigned',
    in_progress:'progress', en_route:'assigned', resolved:'resolved',
    validated:'resolved', closed:'closed', rejected:'rejected', cancelled:'cancelled',
    pending:'submitted', unknown:'submitted',
  };
  const labelMap = {
    submitted:'Submitted', verified:'Verified', assigned:'Assigned',
    in_progress:'In Progress', en_route:'En Route', resolved:'Resolved',
    validated:'Validated', closed:'Closed', rejected:'Rejected', cancelled:'Cancelled',
    pending:'Pending', unknown:'Submitted',
  };
  const cssClass  = cssMap[statusStr]  || 'submitted';
  const labelText = labelMap[statusStr] || statusStr.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Submitted';
  return `<span class="badge badge-${cssClass}">${labelText}</span>`;
}

function priorityBadge(priority) {
  const cap = priority.charAt(0).toUpperCase() + priority.slice(1);
  return `<span class="badge badge-${priority}"><span class="priority-dot dot-${priority}"></span>${cap}</span>`;
}

function mapPlaceholder(height = 200, label = 'Leaflet.js + OpenStreetMap', lat, lng) {
  const coordLabel = (lat && lng) ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : label;
  return `
    <div class="map-placeholder" style="height:${height}px">
      <div class="map-icon"></div>
      <div class="map-label">${coordLabel}</div>
      <div class="map-sub">Nominatim geocoding · GPS auto-detect</div>
    </div>`;
}

function uploadBox(height, label = 'Drag &amp; drop or click to upload', sub = 'JPG, PNG, MP4 · Max 50MB') {
  return `
    <div class="upload-box"${height ? ` style="height:${height}px"` : ''}>
      <div class="upload-text">${label}</div>
      <div class="upload-sub">${sub}</div>
    </div>`;
}

function alertBox(type, icon, content) {
  return `<div class="alert alert-${type}"><span>${icon}</span><div>${content}</div></div>`;
}

function perfBar(label, value, unit = '%') {
  return `
    <div class="perf-bar-row">
      <div class="perf-bar-label">
        <span>${label}</span>
        <span class="mono">${value}${unit}</span>
      </div>
      <div class="perf-bar-track"><div class="perf-bar-fill" style="width:${value}%"></div></div>
    </div>`;
}

/* ── TOAST ─────────────────────────────────────────────────── */
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-visible'), 10);
  setTimeout(() => { t.classList.remove('toast-visible'); setTimeout(() => t.remove(), 300); }, 3500);
}

/* ── MODAL ─────────────────────────────────────────────────── */
function openModal(html) {
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = html;
}
function closeModal() {
  const container = document.getElementById('modal-container');
  if (container) container.innerHTML = '';
}

/* ── TIMELINE MODAL ────────────────────────────────────────── */
function showTimeline(complaintId) {
  const c = COMPLAINTS.find(x => x.id === complaintId);
  if (!c) return;
  const stages = buildTimeline(c);

  const stagesHtml = stages.map(s => `
    <div class="timeline-item">
      <div class="tl-dot ${s.done ? (s.rejected || s.cancelled ? 'rejected' : 'done') : ''}">
        ${s.done ? (s.rejected || s.cancelled ? '✕' : '✓') : '○'}
      </div>
      <div class="tl-content">
        <div class="tl-label">${s.label}</div>
        <div class="tl-time">${s.time}</div>
        ${s.done ? `<div class="tl-note">${s.note}</div>` : ''}
      </div>
    </div>`).join('');

  const ratingHtml = c.status === 'closed' ? `
    <div class="rating-section">
      <div class="section-title">Rate this Service</div>
      <div class="star-row" id="star-row">
        ${[1,2,3,4,5].map(n => `<span class="star${n <= 4 ? ' filled' : ''}" onclick="setRating(${n})">★</span>`).join('')}
      </div>
      <textarea class="form-input" rows="2" placeholder="Optional comment…" style="margin-top:10px"></textarea>
      <div style="text-align:right;margin-top:10px">
        <button class="btn-primary btn-sm" onclick="showToast('Rating submitted. Thank you!');closeModal()">Submit Rating</button>
      </div>
    </div>` : '';

  openModal(`
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-head">
          <div>
            <div class="modal-title">${c.id}</div>
            <div class="modal-subtitle">${c.cat} · Brgy. ${c.brgy}</div>
          </div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="badge-row">${statusBadge(c.status)} ${priorityBadge(c.priority)}</div>
          <div class="complaint-desc">${c.desc}</div>
          <div class="section-title" style="margin-bottom:16px">Transparency Timeline</div>
          <div class="timeline">${stagesHtml}</div>
          ${ratingHtml}
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>`);
}

function setRating(n) {
  document.querySelectorAll('.star').forEach((s, i) => {
    s.classList.toggle('filled', i < n);
  });
}

/* ── TOPBAR NAV HIGHLIGHT ──────────────────────────────────── */
function setActivePage(pageId) {
  if (typeof pageId !== 'string' || !pageId) {
    console.warn('setActivePage called with invalid pageId:', pageId);
    return;
  }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('nav-' + pageId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.page-section').forEach(el => el.classList.add('hidden'));
  const section = document.getElementById('page-' + pageId);
  if (section) section.classList.remove('hidden');

  const titleMap = {
    dash:'Dashboard', report:'File a Complaint', complaints:'My Complaints',
    profile:'My Profile', queue:'Complaint Queue', active:'Active Cases',
    citizens:'Citizen Records',
    officers:'Field Officers', analytics:'Analytics', assigned:'Assigned Cases',
    job:'Active Job', drafts:'Drafts', history:'Case History', performance:'My Performance',
    about:'About Us', messages:'Messages',
  };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = titleMap[pageId] || 'Dashboard';
  window.scrollTo(0, 0);

  /* Auto-close sidebar on mobile after navigation */
  if (typeof closeSidebar === 'function') {
    closeSidebar();
  } else {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      document.body.classList.remove('sidebar-open');
    }
  }
}

function openPage(pageId) {
  if (!pageId || typeof pageId !== 'string') {
    console.warn('openPage called with invalid pageId:', pageId);
    return;
  }
  if (typeof setActivePage === 'function' && document.getElementById('nav-' + pageId)) {
    setActivePage(pageId);
    return;
  }
  if (typeof navigateToPage === 'function') {
    navigateToPage(pageId);
    return;
  }
  console.warn('No routing handler found for pageId:', pageId);
}

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (hash && typeof setActivePage === 'function') {
    setActivePage(hash);
  }
});

async function logout() {
  try {
    await apiFetch('logout.php', {});
  } catch (error) {
    console.warn('Logout API error:', error.message);
  }
  /* Clear per-role user_id so next login is clean */
  try {
    ['regular', 'dispatch', 'field'].forEach(r => sessionStorage.removeItem('trapico_uid_' + r));
  } catch (_) {}
  const path = String(window.location.pathname || '').toLowerCase();
  const pathMatch = path.match(/\/(citizen|dispatch|field)\//i);
  const folder = pathMatch ? pathMatch[1].toUpperCase() : null;
  const pageRole = path.includes('civilian.html') ? 'CITIZEN'
    : path.includes('dispatch.html') ? 'DISPATCH'
    : path.includes('field.html') ? 'FIELD'
    : null;
  const roleKey = folder || pageRole;
  const loginMap = {
    CITIZEN: '/citizen-login.html',
    DISPATCH: '/dispatch-login.html',
    FIELD: '/field-login.html',
  };
  const loginPage = roleKey ? loginMap[roleKey] : '/index.html';
  window.location.href = loginPage;
}

function navigateToPage(pageId) {
  const pageMap = {
    dash:'dash', report:'report', complaints:'complaints', profile:'profile',
    queue:'queue', active:'active', officers:'officers', analytics:'analytics',
    assigned:'assigned', job:'job', drafts:'drafts', history:'history', performance:'performance',
  };

  if (pageMap[pageId] && typeof setActivePage === 'function' && document.getElementById('nav-' + pageId)) {
    setActivePage(pageId);
    return;
  }

  if (pageMap[pageId]) {
    const base = window.location.pathname.replace(/\/[^\/]*$/, '/');
    window.location.href = new URL(`dispatch.html#${pageId}`, window.location.origin + base).href;
    return;
  }

  const routeMap = { regular:'civilian.html', dispatch:'dispatch.html', field:'field.html' };
  const fallback = routeMap[pageId];
  if (fallback) {
    const base = window.location.pathname.replace(/\/[^\/]*$/, '/');
    window.location.href = new URL(fallback, window.location.origin + base).href;
  } else {
    console.warn('navigateToPage could not resolve pageId:', pageId);
  }
}

/* ── AI ANALYSIS PANEL ─────────────────────────────────────── */
function openAiModal(contactName, sendFn, clearFn) {
    const c = document.getElementById('ai-modal-container');
    if (!c) return;
    c.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)closeAiModal()">
        <div style="background:#fff;border-radius:16px;width:100%;max-width:560px;height:90vh;max-height:680px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e8ecf4;flex-shrink:0">
                <div style="display:flex;align-items:center;gap:10px">
                    <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#111,#555);display:flex;align-items:center;justify-content:center;font-size:16px">&#129302;</div>
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#111">AI Analysis</div>
                        <div style="font-size:11px;color:#888">${safeText(contactName)}</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                    <button onclick="${clearFn}()" style="border:1px solid #e0e0e0;background:#fff;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;color:#666;font-family:inherit">Clear</button>
                    <button onclick="closeAiModal()" style="border:none;background:#f4f4f4;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:14px;color:#666">&#x2715;</button>
                </div>
            </div>
            <div id="ai-history-body" style="flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px;background:#f9fafb">
                <div style="text-align:center;font-size:12px;color:#aaa;padding:24px">Loading&#8230;</div>
            </div>
            <div style="padding:12px 16px;border-top:1px solid #e8ecf4;background:#fff;flex-shrink:0;display:flex;gap:8px;align-items:flex-end">
                <textarea id="ai-msg-input" rows="2" placeholder="Ask AI about this conversation&#8230;" style="flex:1;border:1px solid #dde3f0;border-radius:10px;padding:9px 13px;font-size:13px;font-family:inherit;resize:none;outline:none;line-height:1.5" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();${sendFn}();}"></textarea>
                <button id="ai-ask-btn" onclick="${sendFn}()" style="background:#111;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;letter-spacing:0.04em;font-family:inherit">ASK</button>
            </div>
        </div>
    </div>`;
}

function closeAiModal() {
    const c = document.getElementById('ai-modal-container');
    if (c) c.innerHTML = '';
}

function renderAiHistory(history) {
    const body = document.getElementById('ai-history-body');
    if (!body) return;
    if (!history || !history.length) {
        body.innerHTML = `<div style="text-align:center;padding:32px 20px;font-size:12px;color:#aaa">
            <div style="font-size:32px;margin-bottom:10px">&#129302;</div>
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#555">TRAPICO AI Assistant</div>
            <div>Ask me anything about this conversation. I can summarize messages, identify priorities, and suggest action items.</div>
        </div>`;
        return;
    }
    const rows = history.map(h => {
        const isUser = h.role === 'user';
        const time = h.createdAt ? new Date(h.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
        if (isUser) {
            return `<div style="display:flex;justify-content:flex-end">
                <div style="max-width:75%">
                    <div style="background:#111;color:#fff;border-radius:14px;border-bottom-right-radius:4px;padding:10px 14px;font-size:13px;line-height:1.5">${safeText(h.text)}</div>
                    ${time ? `<div style="font-size:10px;color:#bbb;margin-top:3px;text-align:right;padding:0 4px">${safeText(time)}</div>` : ''}
                </div>
            </div>`;
        } else {
            return `<div style="display:flex;gap:8px;align-items:flex-start">
                <div style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#111,#555);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;margin-top:2px">&#129302;</div>
                <div style="max-width:82%">
                    <div style="background:#fff;border:1px solid #e8ecf4;border-radius:14px;border-bottom-left-radius:4px;padding:10px 14px;font-size:13px;line-height:1.6;color:#111;white-space:pre-wrap">${safeText(h.text)}</div>
                    ${time ? `<div style="font-size:10px;color:#bbb;margin-top:3px;padding:0 4px">${safeText(time)}</div>` : ''}
                </div>
            </div>`;
        }
    });
    body.innerHTML = rows.join('');
    body.scrollTop = body.scrollHeight;
}

function appendAiUserMsg(text) {
    const body = document.getElementById('ai-history-body');
    if (!body) return;
    const emptyEl = body.querySelector('[data-ai-empty]');
    if (emptyEl) emptyEl.remove();
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;justify-content:flex-end';
    div.innerHTML = `<div style="max-width:75%;background:#111;color:#fff;border-radius:14px;border-bottom-right-radius:4px;padding:10px 14px;font-size:13px;line-height:1.5">${safeText(text)}</div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

function appendAiThinking() {
    const body = document.getElementById('ai-history-body');
    if (!body) return;
    const div = document.createElement('div');
    div.setAttribute('data-ai-thinking', '1');
    div.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    div.innerHTML = `<div style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#111,#555);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;margin-top:2px">&#129302;</div>
        <div style="max-width:82%"><div style="background:#fff;border:1px solid #e8ecf4;border-radius:14px;border-bottom-left-radius:4px;padding:10px 14px;font-size:13px;color:#aaa;font-style:italic">Analyzing&#8230;</div></div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

function resolveAiThinking(responseText) {
    const body = document.getElementById('ai-history-body');
    if (!body) return;
    const thinking = body.querySelector('[data-ai-thinking]');
    if (thinking) {
        const inner = thinking.querySelector('div > div');
        if (inner) {
            inner.style.color = '#111';
            inner.style.fontStyle = 'normal';
            inner.style.whiteSpace = 'pre-wrap';
            inner.textContent = responseText;
        }
        thinking.removeAttribute('data-ai-thinking');
    } else {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
        div.innerHTML = `<div style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#111,#555);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;margin-top:2px">&#129302;</div>
            <div style="max-width:82%"><div style="background:#fff;border:1px solid #e8ecf4;border-radius:14px;border-bottom-left-radius:4px;padding:10px 14px;font-size:13px;line-height:1.6;color:#111;white-space:pre-wrap">${safeText(responseText)}</div></div>`;
        body.appendChild(div);
    }
    body.scrollTop = body.scrollHeight;
}

function setAiBusy(busy) {
    const btn   = document.getElementById('ai-ask-btn');
    const input = document.getElementById('ai-msg-input');
    if (btn)   { btn.disabled = busy; btn.textContent = busy ? '…' : 'ASK'; }
    if (input) input.disabled = busy;
}