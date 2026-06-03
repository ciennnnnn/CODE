// Robust setActivePage for navigation and dashboard buttons
window.setActivePage = function setActivePage(pageId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.classList.add('hidden'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const nav = document.getElementById('nav-' + pageId);
    if (nav) nav.classList.add('active');
    const titleMap = {
        dash: 'Dashboard', report: 'File a Complaint', complaints: 'My Complaints',
        profile: 'My Profile', about: 'About Us'
    };
    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle && titleMap[pageId]) topbarTitle.textContent = titleMap[pageId];
    window.scrollTo(0, 0);
    // Close sidebar on mobile after navigation
    if (typeof closeSidebar === 'function') {
        closeSidebar();
    } else {
        const sb = document.querySelector('.sidebar');
        if (sb) { sb.classList.remove('open'); document.body.classList.remove('sidebar-open'); }
        const bd = document.getElementById('sidebar-backdrop');
        if (bd) bd.style.display = 'none';
    }
}
/* ============================================================
   TRAPICO — Civilian frontend backend connector
   ============================================================ */

'use strict';

let CIVILIAN_USER = null;
let MY_COMPLAINTS = [];
let selectedPriority = 'medium';
let civilianBackendCurrentStep = 1;
let civilianNotifOpen = false;

/* map state */
let complaintMap = null;
let complaintMapMarker = null;
let pinnedLat = null;
let pinnedLng = null;
let latestEvidenceCapturedAt = null;
let timelineLocationMap = null;

function setPinnedLocation(lat, lng, zoom = 17, prefix = 'Pinned') {
    pinnedLat = Number(lat);
    pinnedLng = Number(lng);
    if (!Number.isFinite(pinnedLat) || !Number.isFinite(pinnedLng)) return;

    const latlng = L.latLng(pinnedLat, pinnedLng);
    if (!complaintMap) initComplaintMap();

    if (complaintMapMarker) {
        complaintMapMarker.setLatLng(latlng);
    } else {
        complaintMapMarker = L.marker(latlng).addTo(complaintMap);
    }

    complaintMap.setView(latlng, zoom);
    const label = document.getElementById('pin-coords-label');
    if (label) label.textContent = `Pinned ${prefix}: ${pinnedLat.toFixed(5)}, ${pinnedLng.toFixed(5)}`;
}

function buildAddressFromSearchResult(result, fallback = '') {
    const addr = result?.address || {};
    const streetLine = addr.house_number
        ? `${addr.house_number} ${addr.road || addr.pedestrian || addr.footway || ''}`.trim()
        : (addr.road || addr.pedestrian || addr.footway || '');
    const parts = [
        streetLine,
        addr.suburb || addr.neighbourhood || addr.quarter || addr.village || '',
        addr.city_district || addr.county || '',
        addr.city || addr.town || 'Quezon City',
        'Philippines',
    ].map(v => String(v || '').trim()).filter(Boolean);

    if (parts.length > 1) return parts.join(', ');
    return String(result?.display_name || fallback || '').trim();
}

async function fillAddressFromReverseGeocode(lat, lng) {
    const input = document.getElementById('f-address');
    if (!input) return;

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&addressdetails=1`;
        const res = await fetch(url, {headers: {'Accept': 'application/json'}});
        if (!res.ok) return;
        const data = await res.json();
        const addr = data?.address || {};
        const streetLine = addr.house_number
            ? `${addr.house_number} ${addr.road || addr.pedestrian || addr.footway || ''}`.trim()
            : (addr.road || addr.pedestrian || addr.footway || addr.path || '');
        const parts = [
            streetLine,
            addr.suburb || addr.neighbourhood || addr.village || '',
            addr.quarter || addr.city_district || '',
            addr.city || addr.town || 'Quezon City',
            'Philippines',
        ].map(x => String(x || '').trim()).filter(Boolean);
        const text = parts.length > 1 ? parts.join(', ') : String(data?.display_name || '').trim();
        if (text) input.value = text;
    } catch (_) {
        /* best effort */
    }
}

window.addEventListener('DOMContentLoaded', initCivilian);

async function initCivilian() {
    try {
        const user = await requireLoginRedirect();
        if (!user) {
            console.error('[TRAPICO] No user returned from requireLoginRedirect');
            return;
        }
        CIVILIAN_USER = user;
        const displayName = user.name || user.username || 'Citizen';
        if (document.getElementById('sb-name')) document.getElementById('sb-name').textContent = displayName;
        if (document.getElementById('topbar-username')) document.getElementById('topbar-username').textContent = displayName;
        const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const sbi = document.getElementById('sb-initials');
        if (sbi) sbi.textContent = initials;

        autoFillIncidentDateTime(new Date(), 'Defaults to now — update if different.');

        /* Set date constraints: max = today, min = 7 days ago */
        const _dateInput = document.getElementById('f-date');
        if (_dateInput) {
            const _now = new Date();
            const _sevenDaysAgo = new Date(_now);
            _sevenDaysAgo.setDate(_now.getDate() - 7);
            _dateInput.max = _now.toISOString().slice(0, 10);
            _dateInput.min = _sevenDaysAgo.toISOString().slice(0, 10);
            _dateInput.addEventListener('change', function() {
                const today = new Date().toISOString().slice(0, 10);
                if (this.value > today) {
                    this.value = today;
                    showToast('Incident date cannot be in the future.');
                }
                if (this.value < _sevenDaysAgo.toISOString().slice(0, 10)) {
                    this.value = _sevenDaysAgo.toISOString().slice(0, 10);
                    showToast('Incidents must be reported within 7 days of occurrence.');
                }
            });
        }
        const _timeInput = document.getElementById('f-time');
        if (_timeInput) {
            _timeInput.addEventListener('change', function() {
                const dateVal = document.getElementById('f-date')?.value;
                const today = new Date().toISOString().slice(0, 10);
                if (dateVal === today) {
                    const nowTime = new Date().toTimeString().slice(0, 5);
                    if (this.value > nowTime) {
                        this.value = nowTime;
                        showToast('Incident time cannot be in the future.');
                    }
                }
            });
        }

        /* wrap setActivePage to trigger map init when report page opens */
        const _base = window.setActivePage;
        window.setActivePage = function (pageId) {
            _base(pageId);
            if (pageId === 'report') setTimeout(initComplaintMap, 150);
        };

        await loadMyComplaints();
        renderDashboard();
        renderComplaintsTable();
        renderBrgyGrid();
        renderProfilePage();
        /* Initialize upload box handlers */
        initUploadBox();
    } catch (e) {
        console.error('[TRAPICO] Error initializing civilian dashboard:', e);
    }
}

async function loadMyComplaints() {
    const resp = await apiFetch('complaints.php', {action: 'list'});
    MY_COMPLAINTS = resp.complaints || [];
}

function getMyComplaints() {
    return MY_COMPLAINTS;
}

function toggleNotif() {
    civilianNotifOpen = !civilianNotifOpen;
    document.getElementById('notif-panel').classList.toggle('hidden', !civilianNotifOpen);
}

document.addEventListener('click', e => {
    if (!e.target.closest('#notif-btn') && civilianNotifOpen) {
        document.getElementById('notif-panel').classList.add('hidden');
        civilianNotifOpen = false;
    }
});

function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return Math.floor(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago';
    return Math.floor(diff / 86400000) + ' day(s) ago';
}

function renderNotifications() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const my = MY_COMPLAINTS || [];

    const statusMsg = {
        submitted:   c => `Complaint ${c.id} submitted — awaiting review.`,
        verified:    c => `Complaint ${c.id} has been verified by dispatch.`,
        assigned:    c => `Complaint ${c.id} has been assigned to a field officer.`,
        in_progress: c => `Complaint ${c.id} is now being addressed.`,
        en_route:    c => `Field officer is en route for complaint ${c.id}.`,
        resolved:    c => `Complaint ${c.id} has been resolved.`,
        validated:   c => `Complaint ${c.id} has been validated.`,
        closed:      c => `Complaint ${c.id} has been closed.`,
        rejected:    c => `Complaint ${c.id} was rejected by dispatch.`,
        cancelled:   c => `Complaint ${c.id} was cancelled.`,
    };

    const items = my
        .filter(c => c && c.id && c.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5)
        .map(c => ({
            msg:  (statusMsg[c.status] || (x => `Complaint ${x.id} — ${x.status}.`))(c),
            time: c.date,
        }));

    const hasNew = items.some(n => (Date.now() - new Date(n.time).getTime()) < 24 * 3600000);
    const dot = document.getElementById('notif-dot');
    if (dot) dot.style.display = hasNew ? '' : 'none';

    if (!items.length) {
        panel.innerHTML = '<div class="notif-head">Notifications</div><div style="padding:16px;color:var(--mist);font-size:13px;text-align:center">No notifications yet.</div>';
        return;
    }
    panel.innerHTML = '<div class="notif-head">Notifications</div>' + items.map(n => `
        <div class="notif-item">
            <div class="notif-dot-inline"></div>
            <div>
                <div class="notif-msg">${safeText(n.msg)}</div>
                <div class="notif-time">${formatTimeAgo(n.time)}</div>
            </div>
        </div>`).join('');
}

function renderBrgyGrid() {
    const grid = document.getElementById('brgy-grid');
    if (!grid) return;
    grid.innerHTML = ['Commonwealth', 'Batasan Hills', 'Central', 'Sto. Cristo'].map(b => `
      <div class="brgy-card">
        <div class="brgy-card-icon"></div>
        <div class="brgy-card-name">${safeText(b)}</div>
        <div class="brgy-card-label"><span class="brgy-card-dot"></span>Active</div>
      </div>`).join('');
}

function renderDashboard() {
        let my = [];
        try {
                my = getMyComplaints() || [];
        } catch (e) {
                console.error('[TRAPICO] Error getting complaints:', e);
                my = [];
        }
        const active = my.filter(c => c && c.status && !['closed','cancelled'].includes(c.status)).length;
        const resolved = my.filter(c => c && c.status && ['resolved','closed'].includes(c.status)).length;

        if (document.getElementById('stat-total')) document.getElementById('stat-total').textContent = my.length;
        if (document.getElementById('stat-active')) document.getElementById('stat-active').textContent = active;
        if (document.getElementById('stat-resolved')) document.getElementById('stat-resolved').textContent = resolved;
        if (document.getElementById('badge-complaints')) document.getElementById('badge-complaints').textContent = my.length || '';
        renderNotifications();

        /* update barangay label */
        const brgyEl = document.getElementById('user-brgy-label');
        if (brgyEl && typeof CIVILIAN_USER === 'object' && CIVILIAN_USER) {
                brgyEl.textContent = 'Barangay ' + (CIVILIAN_USER.home_barangay || 'your barangay') + ', Quezon City';
        }

        const tbody = document.getElementById('dash-recent-tbody');
        if (!tbody) return;
        if (!my.length) {
                tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-title">No complaints yet</div><div class="empty-sub">Click "File a Complaint" to get started.</div></div></td></tr>`;
                return;
        }
        tbody.innerHTML = my.slice(0, 5).map(c => {
            const canCancel = c?.status === 'submitted' && c?.date &&
                (Date.now() - new Date(c.date).getTime() < 30 * 60 * 1000);
            const minsLeft = canCancel ? (30 - Math.floor((Date.now() - new Date(c.date).getTime()) / 60000)) : 0;
            return `<tr>
                <td class="track-id">${safeText(c?.id || '')}</td>
                <td>${safeText(c?.cat || '')}</td>
                <td>${priorityBadge(c?.priority || 'medium')}</td>
                <td>${statusBadge(c?.status || '')}</td>
                <td class="mono" style="font-size:12px">${formatDateTime(c?.date || '')}</td>
                <td style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn-secondary btn-sm" onclick="showTimeline('${safeText(c?.id || '')}')">Track</button>
                    ${canCancel ? `<button class="btn-danger btn-sm" title="Cancel (${minsLeft} min remaining)" onclick="cancelComplaint('${safeText(c?.id || '')}')">Cancel</button>` : ''}
                </td>
            </tr>`;
        }).join('');
}

/* Maps raw DB status values to their displayed filter category so filtering is consistent
   with what the citizen sees in the badge (e.g. DB 'pending'/'unknown' both show as 'submitted'). */
function normalizeStatusForFilter(raw) {
    const map = { pending: 'submitted', unknown: 'submitted', en_route: 'assigned', validated: 'resolved' };
    return map[(raw || '').toLowerCase()] || (raw || '').toLowerCase();
}

function renderComplaintsTable() {
    const search = (document.getElementById('complaints-search')?.value || '').toLowerCase();
    const statusFil = document.getElementById('complaints-filter-status')?.value || '';
    const brgyFil = document.getElementById('complaints-filter-brgy')?.value || '';
    const my = getMyComplaints().filter(c => {
        const matchSearch = !search || c.id.toLowerCase().includes(search) || c.cat.toLowerCase().includes(search);
        const matchStatus = !statusFil || normalizeStatusForFilter(c.status) === statusFil;
        const matchBrgy = !brgyFil || (c.brgy || '').toLowerCase() === brgyFil.toLowerCase();
        return matchSearch && matchStatus && matchBrgy;
    });

    const tbody = document.getElementById('complaints-tbody');
    if (!tbody) return;

    if (!my.length) {
        tbody.innerHTML = `
          <tr><td colspan="7">
            <div class="empty-state">
              <div class="empty-icon"></div>
              <div class="empty-title">No complaints found</div>
              <div class="empty-sub">Try adjusting your search or filter.</div>
            </div>
          </td></tr>`;
        return;
    }

    tbody.innerHTML = my.map(c => {
        /* Show Cancel only for submitted complaints filed within the last 30 minutes */
        const canCancel = c.status === 'submitted' && c.date &&
            (Date.now() - new Date(c.date).getTime() < 30 * 60 * 1000);
        const minutesAgo = c.date ? Math.floor((Date.now() - new Date(c.date).getTime()) / 60000) : 999;
        const cancelTitle = canCancel ? `Cancel (${30 - minutesAgo} min remaining)` : '';
        return `<tr>
          <td class="track-id">${safeText(c.id)}</td>
          <td>${safeText(c.cat)}</td>
          <td style="font-size:12px">${safeText(c.brgy)}</td>
          <td>${priorityBadge(c.priority)}</td>
          <td>${statusBadge(c.status)}</td>
          <td class="mono" style="font-size:12px">${formatDateTime(c.date)}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-secondary btn-sm" onclick="showTimeline('${safeText(c.id)}')">Track</button>
            ${canCancel ? `<button class="btn-danger btn-sm" title="${safeText(cancelTitle)}" onclick="cancelComplaint('${safeText(c.id)}')">Cancel</button>` : ''}
          </td>
        </tr>`;
    }).join('');
}

async function cancelComplaint(id) {
    if (!confirm('Are you sure you want to cancel this complaint?')) {
        return;
    }
    try {
        await apiFetch('complaints.php', {action: 'cancel', id}, 'POST');
        await loadMyComplaints();
        renderComplaintsTable();
        renderDashboard();
        showToast('Complaint cancelled successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

function goToStep(step) {
    /* validate before advancing */
    if (step === 2) {
        const cat = document.getElementById('f-cat')?.value;
        const brgy = document.getElementById('f-brgy')?.value;
        const address = document.getElementById('f-address')?.value.trim();
        if (!cat) {
            showToast('Please select a complaint category before proceeding.');
            return;
        }
        if (!address) {
            showToast('Please enter an incident address before proceeding.');
            return;
        }
        // DO NOT require evidence here!
    }
    // Sign out: clear all form/session data and redirect to login
    function signOutCivilian() {
        try {
            localStorage.removeItem('trapico_civilian_form');
            sessionStorage.removeItem('trapico_user');
        } catch (e) {}
        window.location.href = '../CITIZEN/civilian.html';
    }
    if (step === 3) {
        const date = document.getElementById('f-date')?.value;
        const time = document.getElementById('f-time')?.value;
        const desc = document.getElementById('f-desc')?.value.trim() || '';
        if (!date || !time) {
            showToast('Please fill in the incident date and time.');
            return;
        }
        /* Frontend date validation */
        const incidentTs = new Date(date + 'T' + (time || '00:00')).getTime();
        const nowTs = Date.now();
        if (incidentTs > nowTs + 5 * 60 * 1000) {
            showToast('Incident date and time cannot be in the future.');
            return;
        }
        if (incidentTs < nowTs - 7 * 24 * 60 * 60 * 1000) {
            showToast('Incidents can only be reported within the last 7 days.');
            return;
        }
        if (desc.length < 50) {
            showToast('Description must be at least 50 characters (' + desc.length + ' so far).');
            return;
        }
    }

    [1, 2, 3].forEach(n => {
        const stepEl = document.getElementById('step-' + n);
        document.getElementById('form-step-' + n).classList.add('hidden');
        if (stepEl) {
            stepEl.classList.remove('active', 'done');
            if (n < step) stepEl.classList.add('done');
            if (n === step) stepEl.classList.add('active');
            stepEl.querySelector('.step-num').textContent = n < step ? '✓' : String(n);
        }
    });
    document.getElementById('form-step-' + step).classList.remove('hidden');
    civilianBackendCurrentStep = step;

    if (step === 1) setTimeout(initComplaintMap, 100);
    if (step === 3) buildReviewSummary();
    window.scrollTo(0, 0);
}

function updateCharCount(el) {
    const len = el.value.length;
    const countEl = document.getElementById('char-count');
    if (!countEl) return;
    countEl.textContent = `${len} / 50 min`;
    countEl.style.color = len >= 50 ? 'var(--green)' : 'var(--mist)';
}

function selectPriority(el) {
    document.querySelectorAll('.priority-pill').forEach(p => p.classList.remove('sel'));
    el.classList.add('sel');
    selectedPriority = el.dataset.p;
}

function toggleAnonWarning(checkbox) {
    document.getElementById('anon-warning').classList.toggle('hidden', !checkbox.checked);
}

function buildReviewSummary() {
    const cat = document.getElementById('f-cat')?.value || '—';
    const brgy = document.getElementById('f-brgy')?.value || '—';
    const address = document.getElementById('f-address')?.value || '—';
    const date = document.getElementById('f-date')?.value || '—';
    const time = document.getElementById('f-time')?.value || '—';
    const priority = selectedPriority.charAt(0).toUpperCase() + selectedPriority.slice(1);
    const anon = document.getElementById('anon-toggle')?.checked ? 'Yes' : 'No';
        const evidenceCount = uploadedFiles.length;

        // Show evidence file details
        let evidenceDetails = 'None';
        if (window.uploadedFiles && window.uploadedFiles.length) {
                const types = window.uploadedFiles.map(f => f.type && f.type.startsWith('video') ? 'video' : 'photo');
                const counts = types.reduce((acc, t) => { acc[t] = (acc[t]||0)+1; return acc; }, {});
                evidenceDetails = `${counts.photo||0} photo(s), ${counts.video||0} video(s)`;
        }
        document.getElementById('review-summary').innerHTML = `
            <div class="review-summary-title">Review Your Submission</div>
                        ${[['Category', cat], ['Barangay', brgy], ['Address', address], ['Date', date], ['Time', time], ['Priority', priority], ['Anonymous', anon], ['Evidence', evidenceDetails]].map(([l, v]) => `
                <div class="review-row">
                    <span class="review-label">${safeText(l)}:</span>
                    <span class="review-value">${safeText(v)}</span>
                </div>`).join('')}`;
}

async function submitComplaint() {
    console.log('DEBUG uploadedFiles:', uploadedFiles);
    const category = document.getElementById('f-cat')?.value || '';
    const barangay = document.getElementById('f-brgy')?.value || '';
    const address = document.getElementById('f-address')?.value.trim() || '';
    const date = document.getElementById('f-date')?.value || '';
    const time = document.getElementById('f-time')?.value || '';
    const desc = document.getElementById('f-desc')?.value.trim() || '';
    const anonymous = document.getElementById('anon-toggle')?.checked || false;

    /* Guard: only regular citizens can submit complaints */
    if (CIVILIAN_USER && CIVILIAN_USER.role && CIVILIAN_USER.role !== 'regular') {
        showToast('Only citizen accounts can submit complaints. Please sign in with a citizen account.');
        return;
    }

    if (!category || !barangay || !address || !date || !time) {
        showToast('Please complete all complaint fields before submitting.');
        goToStep(2);
        return;
    }
    if (!uploadedFiles.length) {
        showToast('Please upload at least one evidence file before submitting your complaint.');
        goToStep(3);
        return;
    }
    if (desc.length < 50) {
        showToast('Please provide a description of at least 50 characters.');
        goToStep(2);
        return;
    }
    // Validate barangay
    const allowedBrgys = ['Commonwealth', 'Batasan Hills', 'Central', 'Sto. Cristo'];
    const brgyLower = (barangay || '').toLowerCase();
    const valid = allowedBrgys.some(b => brgyLower.includes(b.toLowerCase()));
    if (!valid) {
        showToast('Selected barangay is not allowed.');
        return;
    }

    try {
        // Set date/time from earliest evidence metadata if available
        let incidentDate = date;
        let incidentTime = time;
        if (uploadedFiles.length > 0) {
            let minDate = null;
            for (const file of uploadedFiles) {
                if (file.metadata && file.metadata.datetime) {
                    const dt = new Date(file.metadata.datetime);
                    if (!minDate || dt < minDate) {
                        minDate = dt;
                    }
                }
            }
            if (minDate) {
                incidentDate = minDate.toISOString().slice(0,10);
                incidentTime = minDate.toTimeString().slice(0,5);
            }
        }
        const payload = {
            action: 'submit',
            category,
            barangay,
            address,
            date: incidentDate,
            time: incidentTime,
            description: desc,
            priority: selectedPriority,
            anonymous,
            lat: pinnedLat,
            lng: pinnedLng,
            utc_offset: -(new Date().getTimezoneOffset()), // e.g. 480 for PHT (UTC+8)
            media: uploadedFiles.map(f => ({
                filename: f.filename,
                url: f.url,
                type: f.type,
                captured_at: f.captured_at
            }))
        };
        const response = await apiFetch('complaints.php', payload, 'POST');
        await loadMyComplaints();
        renderDashboard();
        renderComplaintsTable();
        showToast(`✓ Complaint submitted! Tracking ID: ${safeText(response.tracking_number)}`);
        
        /* reset form */
        uploadedFiles = [];
        latestEvidenceCapturedAt = null;
        pinnedLat = null; pinnedLng = null;
        if (complaintMapMarker) { complaintMapMarker.remove(); complaintMapMarker = null; }
        const pinLabel = document.getElementById('pin-coords-label');
        if (pinLabel) pinLabel.textContent = 'Click the map to pin the exact incident location.';
        document.getElementById('f-cat').value = '';
        document.getElementById('f-address').value = '';
        document.getElementById('f-desc').value = '';
        autoFillIncidentDateTime(new Date(), 'Auto-updated: current time');
        document.getElementById('anon-toggle').checked = false;
        document.getElementById('anon-warning').classList.add('hidden');
        document.getElementById('upload-status').textContent = '';
        document.getElementById('uploaded-files').innerHTML = '';
        selectedPriority = 'medium';
        document.querySelectorAll('.priority-pill').forEach(p => p.classList.toggle('sel', p.dataset.p === 'medium'));
        goToStep(1);
        setActivePage('complaints');
    } catch (error) {
        showToast(error.message);
    }
}

function renderProfilePage() {
    if (!CIVILIAN_USER) return;

    const displayName = CIVILIAN_USER.name || CIVILIAN_USER.username || 'User';
    const parts = displayName.trim().split(/\s+/);
    const avatarText = parts.length >= 2
        ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
        : parts[0].charAt(0).toUpperCase();

    renderProfileAvatar(avatarText, CIVILIAN_USER.profile_picture_url || '');

    // Topbar / sidebar identity
    const sbName = document.getElementById('sb-name');
    const tbUsername = document.getElementById('topbar-username');
    const tbAvatar = document.getElementById('topbar-avatar');
    if (sbName) sbName.textContent = displayName;
    if (tbUsername) tbUsername.textContent = displayName;
    if (tbAvatar) {
        if (CIVILIAN_USER.profile_picture_url) {
            tbAvatar.innerHTML = `<img src="${CIVILIAN_USER.profile_picture_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
        } else {
            tbAvatar.textContent = avatarText;
        }
    }

    // Profile card header
    document.getElementById('prof-display-name').textContent = displayName;

    // Helper: set text content safely
    const setField = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

    // Personal info — all signup fields
    setField('prof-name',         CIVILIAN_USER.name);
    setField('prof-middle-name',  CIVILIAN_USER.middle_name);
    setField('prof-username',     CIVILIAN_USER.username);
    setField('prof-sex',          CIVILIAN_USER.sex);
    setField('prof-email',        CIVILIAN_USER.email);
    setField('prof-phone',        CIVILIAN_USER.phone);
    setField('prof-street',       CIVILIAN_USER.street);
    setField('prof-brgy',         CIVILIAN_USER.home_barangay);
    setField('prof-city',         CIVILIAN_USER.city || 'Quezon City');
    setField('prof-province',     CIVILIAN_USER.province || 'Metro Manila');
    setField('prof-zip',          CIVILIAN_USER.zip_code);

    // Birthdate — format as human-readable
    if (CIVILIAN_USER.birthdate) {
        const bd = new Date(CIVILIAN_USER.birthdate + 'T00:00:00');
        setField('prof-birthdate', bd.toLocaleDateString(undefined, {year:'numeric', month:'long', day:'numeric'}));
    } else {
        setField('prof-birthdate', '');
    }

    // Emergency contact
    setField('prof-emergency-name',  CIVILIAN_USER.emergency_contact_name);
    setField('prof-emergency-phone', CIVILIAN_USER.emergency_contact_phone);

    // Edit form pre-fill
    const setInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setInput('edit-profile-name',      CIVILIAN_USER.name);
    setInput('edit-profile-middle',    CIVILIAN_USER.middle_name);
    setInput('edit-profile-username',  CIVILIAN_USER.username);
    setInput('edit-profile-email',     CIVILIAN_USER.email);
    setInput('edit-profile-phone',     CIVILIAN_USER.phone);
    setInput('edit-profile-birthdate', CIVILIAN_USER.birthdate);
    setInput('edit-profile-street',    CIVILIAN_USER.street);
    setInput('edit-profile-province',  CIVILIAN_USER.province || 'Metro Manila');
    setInput('edit-profile-zip',       CIVILIAN_USER.zip_code);

    // Sex select
    const sexEl = document.getElementById('edit-profile-sex');
    if (sexEl && CIVILIAN_USER.sex) sexEl.value = CIVILIAN_USER.sex;

    // Pre-select barangay in dropdown
    const brgySelect = document.getElementById('edit-profile-brgy');
    if (brgySelect && CIVILIAN_USER.home_barangay) {
        const opt = Array.from(brgySelect.options).find(o => o.value === CIVILIAN_USER.home_barangay || o.text === CIVILIAN_USER.home_barangay);
        if (opt) brgySelect.value = opt.value;
    }

    // Quick Stats (accurate from MY_COMPLAINTS)
    renderProfileStats();
}

function renderProfileAvatar(avatarText, imageUrl) {
    const avatarDisplay = document.getElementById('profile-avatar-display');
    if (!avatarDisplay) return;

    if (imageUrl) {
        avatarDisplay.innerHTML = `<img src="${imageUrl}" alt="Profile picture" />`;
    } else {
        avatarDisplay.innerHTML = `<span id="profile-avatar-letter">${avatarText}</span>`;
    }
}

function renderProfileStats() {
    const my = MY_COMPLAINTS || [];
    const total     = my.length;
    const resolved  = my.filter(c => ['resolved', 'closed'].includes(c.status)).length;
    const pending   = my.filter(c => !['resolved', 'closed', 'cancelled', 'rejected'].includes(c.status)).length;
    const cancelled = my.filter(c => c.status === 'cancelled').length;

    const el = id => document.getElementById(id);
    if (el('prof-stat-total'))     el('prof-stat-total').textContent     = total;
    if (el('prof-stat-resolved'))  el('prof-stat-resolved').textContent  = resolved;
    if (el('prof-stat-pending'))   el('prof-stat-pending').textContent   = pending;
    if (el('prof-stat-cancelled')) el('prof-stat-cancelled').textContent = cancelled;
}

let editingProfile   = false;
let editingEmergency = false;

function toggleProfileEdit() {
    editingProfile = !editingProfile;
    document.getElementById('profile-view').classList.toggle('hidden', editingProfile);
    document.getElementById('profile-edit').classList.toggle('hidden', !editingProfile);
    document.getElementById('edit-btn').textContent = editingProfile ? '✕ Cancel' : '✎ Edit';
}

function toggleEmergencyEdit() {
    editingEmergency = !editingEmergency;
    document.getElementById('emergency-view').classList.toggle('hidden', editingEmergency);
    document.getElementById('emergency-edit').classList.toggle('hidden', !editingEmergency);
    document.getElementById('edit-emergency-btn').textContent = editingEmergency ? '✕ Cancel' : 'Edit';
    if (editingEmergency) {
        const setInput = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setInput('edit-emergency-name',  CIVILIAN_USER.emergency_contact_name);
        setInput('edit-emergency-phone', CIVILIAN_USER.emergency_contact_phone);
    }
}

async function saveEmergencyContact() {
    const ename  = document.getElementById('edit-emergency-name')?.value.trim() || '';
    const ephone = document.getElementById('edit-emergency-phone')?.value.trim() || '';
    try {
        await apiFetch('user.php', {action: 'updateEmergencyContact', emergency_name: ename, emergency_phone: ephone}, 'POST');
        CIVILIAN_USER.emergency_contact_name  = ename;
        CIVILIAN_USER.emergency_contact_phone = ephone;
        const setField = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
        setField('prof-emergency-name',  ename);
        setField('prof-emergency-phone', ephone);
        toggleEmergencyEdit();
        showToast('Emergency contact updated successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const isVisible = input.type === 'text';
    input.type = isVisible ? 'password' : 'text';
    button.classList.toggle('is-visible', !isVisible);
    button.textContent = isVisible ? 'Show' : 'Hide';
    button.setAttribute('title', isVisible ? 'Show password' : 'Hide password');
}

async function uploadProfilePicture(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
        showToast('Only JPG, PNG, and GIF images allowed.');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showToast('File size must be less than 5MB.');
        return;
    }
    
    const statusEl = document.getElementById('profile-picture-status');
    statusEl.textContent = 'Uploading...';
    
    const formData = new FormData();
    formData.append('action', 'upload_evidence');
    formData.append('file', file);
    
    try {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success) {
                        saveProfilePictureUrl(response.url, statusEl);
                    } else {
                        statusEl.textContent = '✗ ' + (response.message || 'Upload failed');
                    }
                } catch (e) {
                    statusEl.textContent = '✗ Invalid response';
                }
            } else {
                statusEl.textContent = '✗ Upload failed';
            }
        });
        
        xhr.addEventListener('error', () => {
            statusEl.textContent = '✗ Upload error';
        });
        
        xhr.open('POST', '/api/media.php');
        xhr.send(formData);
    } catch (error) {
        statusEl.textContent = '✗ ' + error.message;
    }

    event.target.value = '';
}

async function saveProfilePictureUrl(url, statusEl) {
    try {
        await apiFetch('user.php', {action: 'updateProfilePicture', profilePictureUrl: url}, 'POST');
        CIVILIAN_USER.profile_picture_url = url;
        const displayName = CIVILIAN_USER.name || CIVILIAN_USER.username || 'User';
        const parts = displayName.trim().split(/\s+/);
        const avatarText = parts.length >= 2
            ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
            : parts[0].charAt(0).toUpperCase();
        renderProfileAvatar(avatarText, url);
        const tbAv = document.getElementById('topbar-avatar');
        if (tbAv) tbAv.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
        statusEl.textContent = '✓ Picture uploaded successfully!';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } catch (error) {
        statusEl.textContent = '✗ ' + error.message;
    }
}

async function saveProfile() {
    const name      = document.getElementById('edit-profile-name')?.value.trim() || '';
    const middle    = document.getElementById('edit-profile-middle')?.value.trim() || '';
    const email     = document.getElementById('edit-profile-email')?.value.trim() || '';
    const phone     = document.getElementById('edit-profile-phone')?.value.trim() || '';
    const brgy      = document.getElementById('edit-profile-brgy')?.value || '';
    const sex       = document.getElementById('edit-profile-sex')?.value || '';
    const birthdate = document.getElementById('edit-profile-birthdate')?.value || '';
    const street    = document.getElementById('edit-profile-street')?.value.trim() || '';
    const province  = document.getElementById('edit-profile-province')?.value.trim() || '';
    const zip       = document.getElementById('edit-profile-zip')?.value.trim() || '';

    if (!name) { showToast('Full name is required.'); return; }
    if (!email) { showToast('Email is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email address.'); return; }
    if (!phone) { showToast('Phone number is required.'); return; }
    if (!/^\+?[\d\s\-]{7,15}$/.test(phone)) { showToast('Please enter a valid phone number.'); return; }
    if (!brgy) { showToast('Please select a barangay.'); return; }

    try {
        await apiFetch('user.php', {
            action: 'updateProfile', name, email, phone, brgy,
            middle_name: middle, sex, birthdate, street, province, zip_code: zip,
        }, 'POST');
        CIVILIAN_USER.name          = name;
        CIVILIAN_USER.middle_name   = middle;
        CIVILIAN_USER.email         = email;
        CIVILIAN_USER.phone         = phone;
        CIVILIAN_USER.home_barangay = brgy;
        CIVILIAN_USER.sex           = sex;
        CIVILIAN_USER.birthdate     = birthdate;
        CIVILIAN_USER.street        = street;
        CIVILIAN_USER.province      = province;
        CIVILIAN_USER.zip_code      = zip;
        renderProfilePage();
        toggleProfileEdit();
        showToast('Profile updated successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

async function updatePassword() {
    const current = document.getElementById('pw-current')?.value.trim();
    const nw = document.getElementById('pw-new')?.value.trim();
    const confirm = document.getElementById('pw-confirm')?.value.trim();

    if (!current || !nw || !confirm) {
        showToast('Please fill in all password fields.');
        return;
    }
    if (nw !== confirm) {
        showToast('New passwords do not match.');
        return;
    }
    if (nw.length < 8) {
        showToast('Password must be at least 8 characters.');
        return;
    }
    if (!/[A-Z]/.test(nw) || !/[0-9]/.test(nw)) {
        showToast('Password must contain at least one uppercase letter and one number.');
        return;
    }

    try {
        await apiFetch('user.php', {action: 'changePassword', currentPassword: current, newPassword: nw}, 'POST');
        document.getElementById('pw-current').value = '';
        document.getElementById('pw-new').value = '';
        document.getElementById('pw-confirm').value = '';
        showToast('Password updated successfully.');
    } catch (error) {
        showToast(error.message);
    }
}

async function sendAboutFeedback() {
    const firstName = (document.getElementById('about-first-name')?.value || '').trim();
    const lastName = (document.getElementById('about-last-name')?.value || '').trim();
    const email = (document.getElementById('about-email')?.value || '').trim();
    const message = (document.getElementById('about-message')?.value || '').trim();

    if (!firstName || !lastName || !email || !message) {
        showToast('Please complete all feedback fields.');
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('Please enter a valid email address.');
        return;
    }

    try {
        const resp = await apiFetch('feedback.php', {
            firstName,
            lastName,
            email,
            message,
        }, 'POST');

        const firstEl = document.getElementById('about-first-name');
        const lastEl = document.getElementById('about-last-name');
        const emailEl = document.getElementById('about-email');
        const msgEl = document.getElementById('about-message');
        if (firstEl) firstEl.value = '';
        if (lastEl) lastEl.value = '';
        if (emailEl) emailEl.value = '';
        if (msgEl) msgEl.value = '';

        showToast(resp?.message || 'Feedback sent successfully.');
    } catch (error) {
        showToast(error.message || 'Unable to send feedback right now.');
    }
}

/* ── FILE UPLOAD ───────────────────────────────────────────── */
let uploadedFiles = [];
window.uploadedFiles = uploadedFiles;
const MAX_EVIDENCE_FILES = 3;
const MIN_EVIDENCE_SIZE_BYTES = 1024;
const MAX_EVIDENCE_SIZE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EVIDENCE_MIME_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/3gpp', 'video/3gpp2'
];
const SUPPORTED_EVIDENCE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'm4v', 'webm', '3gp', '3gpp'];

function isSupportedEvidenceFile(file) {
    const mime = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return SUPPORTED_EVIDENCE_MIME_TYPES.includes(mime) || SUPPORTED_EVIDENCE_EXTENSIONS.includes(ext);
}

function toDatetimeLocalParts(dateObj) {
    const d = dateObj;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return {
        date: `${yyyy}-${mm}-${dd}`,
        time: `${hh}:${mi}`,
    };
}

function autoFillIncidentDateTime(dateObj, metaText) {
    const dateInput = document.getElementById('f-date');
    const timeInput = document.getElementById('f-time');
    const metaEl = document.getElementById('incident-time-meta');
    if (!dateInput || !timeInput || !dateObj) return;

    const parts = toDatetimeLocalParts(dateObj);
    dateInput.value = parts.date;
    timeInput.value = parts.time;
    if (metaEl) {
        metaEl.textContent = metaText || `Auto-updated: ${parts.time}`;
    }
}

function getEvidenceCapturedAt(file) {
    if (!file) return new Date();
    if (file.lastModified && Number.isFinite(file.lastModified)) {
        return new Date(file.lastModified);
    }
    return new Date();
}

function openEvidencePicker() {
    const evidenceInput = document.getElementById('evidence-upload');
    if (!evidenceInput) return;
    evidenceInput.click();
}

function initUploadBox() {
    const uploadBox = document.getElementById('upload-box');
    const evidenceInput = document.getElementById('evidence-upload');
    if (!uploadBox || !evidenceInput) {
        console.warn('Upload box or file input not found');
        return;
    }
    
    uploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadBox.style.backgroundColor = 'var(--surface)';
        uploadBox.style.borderColor = 'var(--steel)';
    });
    
    uploadBox.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadBox.style.backgroundColor = '';
        uploadBox.style.borderColor = '';
    });
    
    uploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadBox.style.backgroundColor = '';
        uploadBox.style.borderColor = '';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload({target: {files}});
        }
    });
    
    // Prevent default drag behavior on document
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
    });
}

async function handleFileUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    if (uploadedFiles.length >= MAX_EVIDENCE_FILES) {
        showToast(`You can upload up to ${MAX_EVIDENCE_FILES} evidence files only.`);
        event.target.value = '';
        return;
    }

    const remainingSlots = MAX_EVIDENCE_FILES - uploadedFiles.length;
    const selected = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
        showToast(`Only ${remainingSlots} more file(s) can be added (max ${MAX_EVIDENCE_FILES}).`);
    }

    for (const file of selected) {
        if (file.size < MIN_EVIDENCE_SIZE_BYTES || file.size > MAX_EVIDENCE_SIZE_BYTES) {
            showToast(`"${file.name}" must be between 1KB and 50MB.`);
            continue;
        }

        if (!isSupportedEvidenceFile(file)) {
            showToast(`"${file.name}" is not supported. Use JPG, PNG, GIF, WebP, MP4, MOV, M4V, WEBM, or 3GP.`);
            continue;
        }

        /* Duplicate file detection: check name + size + lastModified */
        const isDuplicate = uploadedFiles.some(existing =>
            existing._file &&
            existing._file.name === file.name &&
            existing._file.size === file.size &&
            existing._file.lastModified === file.lastModified
        );
        if (isDuplicate) {
            showToast(`"${file.name}" has already been uploaded. Please select a different file.`);
            continue;
        }

        await uploadEvidence(file);
    }

    event.target.value = '';
}

async function uploadEvidence(file) {
    const progressContainer = document.getElementById('upload-progress-bar');
    const statusEl = document.getElementById('upload-status');
    const filesContainer = document.getElementById('uploaded-files');
    
    progressContainer.classList.remove('hidden');
    statusEl.textContent = 'Uploading...';
    
    const formData = new FormData();
    formData.append('action', 'upload_evidence');
    formData.append('file', file);
    
    try {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                document.getElementById('upload-progress-fill').style.width = percent + '%';
            }
        });
        
        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.success) {
                        const capturedAt = getEvidenceCapturedAt(file);
                        latestEvidenceCapturedAt = capturedAt;
                        autoFillIncidentDateTime(capturedAt, `Auto-updated: ${toDatetimeLocalParts(capturedAt).time}`);

                        uploadedFiles.push({
                            filename: response.filename,
                            url: response.url,
                            type: file.type,
                            captured_at: capturedAt.toISOString(),
                            _file: file // Store the original File object for FormData
                        });
                        statusEl.textContent = `✓ ${file.name} uploaded successfully. (${uploadedFiles.length}/${MAX_EVIDENCE_FILES}) Incident date/time auto-set from evidence metadata.`;
                        filesContainer.innerHTML = uploadedFiles.map((f, i) => `
                            <div style="display:flex;gap:8px;align-items:center;padding:8px;background:var(--surface);border-radius:4px;font-size:12px;margin-bottom:6px">
                                <span>${f.type.includes('video') ? 'Video' : 'Photo'}</span>
                                <span>${f.filename}</span>
                                <button class="btn-danger btn-sm" style="margin-left:auto" onclick="removeUploadedFile(${i})">Remove</button>
                            </div>`).join('');
                        progressContainer.classList.add('hidden');
                    } else {
                        statusEl.textContent = '✗ ' + (response.message || 'Upload failed');
                        showToast(response.message || 'Upload failed');
                    }
                } catch (e) {
                    statusEl.textContent = '✗ Invalid server response';
                    showToast('Invalid server response');
                }
            } else {
                statusEl.textContent = `✗ Upload failed (${xhr.status})`;
                showToast(`Upload failed with status ${xhr.status}`);
            }
        });
        
        xhr.addEventListener('error', () => {
            statusEl.textContent = '✗ Upload error';
            showToast('Upload error');
        });
        
        xhr.open('POST', '/api/media.php');
        xhr.send(formData);
    } catch (error) {
        statusEl.textContent = '✗ ' + error.message;
        showToast(error.message);
    }
}

function removeUploadedFile(index) {
    uploadedFiles.splice(index, 1);
    const filesContainer = document.getElementById('uploaded-files');
    if (uploadedFiles.length === 0) {
        filesContainer.innerHTML = '';
        document.getElementById('upload-status').textContent = '';
    } else {
        filesContainer.innerHTML = uploadedFiles.map((f, i) => `
            <div style="display:flex;gap:8px;align-items:center;padding:8px;background:var(--surface);border-radius:4px;font-size:12px;margin-bottom:6px">
                <span>${f.type.includes('video') ? '🎬' : '📷'}</span>
                <span>${f.filename}</span>
                <button class="btn-danger btn-sm" style="margin-left:auto" onclick="removeUploadedFile(${i})">Remove</button>
            </div>`).join('');
    }
}

/* ── LEAFLET MAP ───────────────────────────────────────────── */
function initComplaintMap() {
    const container = document.getElementById('complaint-map');
    if (!container) return;
    if (complaintMap) {
        complaintMap.invalidateSize();
        return;
    }
    const defaultLat = 14.6760, defaultLng = 121.0437;
    complaintMap = L.map('complaint-map', {zoomControl: false}).setView([defaultLat, defaultLng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
    }).addTo(complaintMap);
    complaintMap.on('click', function (e) {
        setPinnedLocation(e.latlng.lat, e.latlng.lng, complaintMap.getZoom(), 'Pinned');
        fillAddressFromReverseGeocode(e.latlng.lat, e.latlng.lng);
    });
}

async function searchIncidentLocation() {
    const input = document.getElementById('map-search-input');
    const brgy = document.getElementById('f-brgy')?.value || '';
    if (!input) return;

    const raw = input.value.trim();
    if (!raw) {
        showToast('Please enter a place to search.');
        return;
    }

    const queries = [
        `${raw}, ${brgy}, Quezon City`,
        `${raw}, Quezon City`,
        `${raw}, Philippines`,
    ];

    const qcViewBox = '120.93,14.80,121.15,14.57';

    try {
        let found = null;
        for (const q of queries) {
            const url = `/api/osm_proxy.php?q=${encodeURIComponent(q)}&addressdetails=1&countrycodes=ph&bounded=1&viewbox=${qcViewBox}&limit=5`;
            const res = await fetch(url, {headers: {'Accept': 'application/json'}});
            if (!res.ok) continue;
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const qcMatch = data.find(item => String(item.display_name || '').toLowerCase().includes('quezon city'));
                found = qcMatch || data[0];
                break;
            }
        }

        if (!found) {
            showToast('Location not found.');
            return;
        }

        const lat = Number(found.lat);
        const lng = Number(found.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            showToast('Invalid location result.');
            return;
        }

        setPinnedLocation(lat, lng, 17, 'Pinned');
        const addrInput = document.getElementById('f-address');
        if (addrInput) addrInput.value = buildAddressFromSearchResult(found, raw);
        showToast('Location found and pinned!');
    } catch (_) {
        showToast('Search failed. Please try again.');
    }
}

function zoomComplaintMapIn() {
    if (!complaintMap) initComplaintMap();
    complaintMap.zoomIn();
}

function zoomComplaintMapOut() {
    if (!complaintMap) initComplaintMap();
    complaintMap.zoomOut();
}

function clearPinnedLocation() {
    pinnedLat = null;
    pinnedLng = null;
    if (complaintMapMarker) {
        complaintMapMarker.remove();
        complaintMapMarker = null;
    }
    const label = document.getElementById('pin-coords-label');
    if (label) label.textContent = 'Pinned: —';
}

function useGpsLocation() {
    if (!navigator.geolocation) {
        showToast('GPS is not available in this browser.');
        return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
        setPinnedLocation(pos.coords.latitude, pos.coords.longitude, 17, 'Pinned');
        fillAddressFromReverseGeocode(pos.coords.latitude, pos.coords.longitude);
    }, () => {
        showToast('Could not retrieve GPS location. Please pin manually on the map.');
    });
}

function updateAddressField() {
    const brgy = document.getElementById('f-brgy')?.value || '';
    const addressInput = document.getElementById('f-address');
    if (addressInput) {
        addressInput.placeholder = `Enter address in ${brgy}`;
    }
}

/* ── TIMELINE (API-backed, overrides data.js version) ──────── */
const _tlRatings = {};

function toSafeDomId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function mountTimelineLocationMap(containerId, lat, lng) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

    if (timelineLocationMap) {
        timelineLocationMap.remove();
        timelineLocationMap = null;
    }

    timelineLocationMap = L.map(containerId, {zoomControl: false, scrollWheelZoom: false, dragging: true}).setView([latNum, lngNum], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(timelineLocationMap);
    L.marker([latNum, lngNum]).addTo(timelineLocationMap);

    setTimeout(() => {
        if (timelineLocationMap) timelineLocationMap.invalidateSize();
    }, 30);
}

async function showTimeline(complaintId) {
    const c = MY_COMPLAINTS.find(x => x.id === complaintId);
    if (!c) { showToast('Complaint not found.'); return; }

    let timeline = [];
    try {
        const resp = await apiFetch('complaints.php', {action: 'timeline', id: complaintId});
        timeline = resp.timeline || [];
    } catch (err) {
        showToast('Could not load timeline: ' + err.message);
        return;
    }

    const statusLabels = {
        submitted: 'Submitted',
        verified: 'Verified',
        assigned: 'Assigned',
        en_route: 'En Route',
        in_progress: 'In Progress',
        resolved: 'Resolved',
        validated: 'Validated',
        closed: 'Closed',
        rejected: 'Rejected',
        cancelled: 'Cancelled',
    };
    const fallbackNotes = {
        submitted: 'Complaint received. Tracking ID generated.',
        verified: '-',
        assigned: '-',
        en_route: '-',
        in_progress: '-',
        resolved: '-',
        validated: '-',
        closed: '-',
        rejected: '-',
        cancelled: '-',
    };

    const flowOrder = ['submitted', 'verified', 'assigned', 'en_route', 'in_progress', 'resolved', 'validated', 'closed'];
    const allStages = [...flowOrder, 'rejected', 'cancelled'];
    const currentStatus = String(c.status || '').toLowerCase();
    const flowIndex = flowOrder.indexOf(currentStatus);

    const timelineMap = {};
    timeline.forEach(s => {
        const key = String(s.status || '').toLowerCase();
        timelineMap[key] = s;
    });
    if (!timelineMap.submitted && c.date) {
        timelineMap.submitted = {status: 'submitted', time: c.date, remarks: 'Complaint received. Tracking ID generated.'};
    }

    const stagesHtml = allStages.map(status => {
        const item = timelineMap[status] || null;
        const isTerminalNegative = status === 'rejected' || status === 'cancelled';

        let isDone = false;
        if (isTerminalNegative) {
            isDone = currentStatus === status;
        } else if (flowIndex >= 0) {
            isDone = flowOrder.indexOf(status) <= flowIndex;
        } else if (currentStatus === 'rejected' || currentStatus === 'cancelled') {
            isDone = status === 'submitted';
        }

        const dotClass = isDone
            ? (isTerminalNegative ? 'rejected' : 'done')
            : '';
        const dotLabel = isDone ? (isTerminalNegative ? '✕' : '✓') : '○';
        const timeText = item?.time ? formatDateTime(item.time) : '—';
        const noteText = item?.remarks ? safeText(item.remarks) : fallbackNotes[status];

        return `
          <div class="timeline-item">
            <div class="tl-dot ${dotClass}">${dotLabel}</div>
            <div class="tl-content">
              <div class="tl-label">${safeText(statusLabels[status] || status)}</div>
              <div class="tl-time">${safeText(timeText)}</div>
              <div class="tl-note">${safeText(noteText)}</div>
            </div>
          </div>`;
    }).join('');

    const isRatable = ['closed', 'resolved'].includes(c.status);
    const safeId = safeText(complaintId);
    const ratingHtml = isRatable ? `
      <div class="rating-section">
        <div class="section-title">Rate this Service</div>
        <div class="star-row" id="star-row-${safeId}">
          ${[1,2,3,4,5].map(n => `<span class="star" onclick="setTimelineRating(${n},'${safeId}')" style="cursor:pointer">★</span>`).join('')}
        </div>
        <textarea class="form-input" id="rating-comment-${safeId}" rows="2" placeholder="Optional comment…" style="margin-top:10px"></textarea>
        <div style="text-align:right;margin-top:10px">
          <button class="btn-primary btn-sm" onclick="submitTimelineRating('${safeId}')">Submit Rating</button>
        </div>
      </div>` : '';

        const mapContainerId = `timeline-location-map-${toSafeDomId(safeId)}`;
        const latNum = Number(c.lat);
        const lngNum = Number(c.lng);
        const hasCoords = Number.isFinite(latNum) && Number.isFinite(lngNum);
        const coordText = hasCoords ? `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}` : 'Location unavailable';
        const locationText = String(c.address || '').trim() || 'Address unavailable';

        openModal(`
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal">
          <div class="modal-head">
            <div>
              <div class="modal-title">${safeText(c.id)}</div>
              <div class="modal-subtitle">${safeText(c.cat)} · Brgy. ${safeText(c.brgy)}</div>
            </div>
            <button class="modal-close" onclick="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="badge-row">${statusBadge(c.status)} ${priorityBadge(c.priority)}</div>
                        <div class="complaint-desc" style="margin-top:12px">${safeText(c.description || '')}</div>
                        <div class="section-title" style="margin:16px 0 10px">Incident Location</div>
                        ${hasCoords
                                ? `<div id="${mapContainerId}" style="height:200px;border:1px solid var(--border)"></div>`
                                : mapPlaceholder(200, 'Location unavailable', c.lat, c.lng)}
                        <div class="mono" style="margin-top:8px;font-size:12px;color:var(--mist)">${safeText(coordText)} - ${safeText(locationText)}</div>
            <div class="section-title" style="margin-bottom:16px">Transparency Timeline</div>
            <div class="timeline">${stagesHtml}</div>
            ${ratingHtml}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>`);

    if (hasCoords) {
        setTimeout(() => mountTimelineLocationMap(mapContainerId, latNum, lngNum), 20);
    }
}

function setTimelineRating(n, complaintId) {
    _tlRatings[complaintId] = n;
    const row = document.getElementById('star-row-' + complaintId);
    if (row) row.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('filled', i < n));
}

async function submitTimelineRating(complaintId) {
    const rating = _tlRatings[complaintId] || 0;
    if (!rating) { showToast('Please select a star rating first.'); return; }
    const comment = document.getElementById('rating-comment-' + complaintId)?.value.trim() || '';
    try {
        await apiFetch('complaints.php', {action: 'rate', id: complaintId, rating, comment}, 'POST');
        showToast('Rating submitted. Thank you!');
        closeModal();
    } catch (err) {
        showToast(err.message);
    }
}
