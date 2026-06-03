
// ── NOTIFICATION SEEN/UNSEEN LOGIC & AUTO-UPDATE ──
const NOTIF_KEY = 'trapico_civilian_seen_notifs';
function getSeenNotifs() {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY)) || {}; } catch { return {}; }
}

function setSeenNotif(id) {
  const seen = getSeenNotifs();
  seen[id] = true;
  localStorage.setItem(NOTIF_KEY, JSON.stringify(seen));
}

function goToStep(step) {
  // Step 2 validation: Details
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
    // Cross-check pin's barangay with selected barangay ONLY if both are set
    const addressInput = document.getElementById('f-address');
    const pinBarangay = (addressInput?.dataset.barangay || '').toLowerCase();
    const selectedBarangay = (brgy || '').toLowerCase();
    if (pinBarangay && selectedBarangay && !pinBarangay.includes(selectedBarangay)) {
      showToast('Pinned location does not match selected barangay. Please pin a location within the selected barangay.');
      return;
    }
  }
  // Step 3: Review & Evidence & Submit
  if (step === 3) {
    const date = document.getElementById('f-date')?.value;
    const time = document.getElementById('f-time')?.value;
    const desc = document.getElementById('f-desc')?.value.trim() || '';
    if (!date || !time) {
      showToast('Please fill in the incident date and time.');
      return;
    }
    if (desc.length < 50) {
      showToast('Description must be at least 50 characters (' + desc.length + ' so far).');
      return;
    }
    buildReviewSummary();
  }
  [1,2,3].forEach(n => {
    const formStep = document.getElementById('form-step-' + n);
    if (formStep) formStep.classList.add('hidden');
    const stepEl = document.getElementById('step-' + n);
    if (stepEl) {
      stepEl.classList.remove('active', 'done');
      if (n < step)     stepEl.classList.add('done');
      if (n === step)   stepEl.classList.add('active');
      stepEl.querySelector('.step-num').textContent = n < step ? '✓' : n;
    }
  });
  const showStep = document.getElementById('form-step-' + step);
  if (showStep) showStep.classList.remove('hidden');
  currentStep = step;
  window.scrollTo(0, 0);
  saveFormState();
}

renderBrgyGrid();

/* ── NOTIF PANEL TOGGLE ────────────────────────────────────── */
let notifOpen = false;

function toggleNotif() {
  notifOpen = !notifOpen;
  document.getElementById('notif-panel').classList.toggle('hidden', !notifOpen);
}

document.addEventListener('click', e => {
  if (!e.target.closest('#notif-btn') && notifOpen) {
    document.getElementById('notif-panel').classList.add('hidden');
    notifOpen = false;
  }
});

/* ── DASHBOARD ─────────────────────────────────────────────── */
function getMyComplaints() {
  return COMPLAINTS.filter(c => c.user === 'jdoe' || c.anon);
}

function renderDashboard() {
  const my       = getMyComplaints();
  const active   = my.filter(c => !['closed','cancelled'].includes(c.status)).length;
  const resolved = my.filter(c => ['resolved','closed'].includes(c.status)).length;

  document.getElementById('stat-total').textContent    = my.length;
  document.getElementById('stat-active').textContent   = active;
  document.getElementById('stat-resolved').textContent = resolved;
  document.getElementById('badge-complaints').textContent = active;

  /* Recent complaints table */
  const tbody = document.getElementById('dash-recent-tbody');
  tbody.innerHTML = my.slice(0, 5).map(c => `
    <tr>
      <td class="track-id">${c.id}</td>
      <td>${c.cat}</td>
      <td>${priorityBadge(c.priority)}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="mono" style="font-size:12px">${c.date}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="showTimeline('${c.id}')">Track</button>
      </td>
    </tr>`).join('');
}

function renderBrgyGrid() {
  const grid = document.getElementById('brgy-grid');
  const BARANGAYS_SAFE = typeof BARANGAYS !== 'undefined' ? BARANGAYS : ['Commonwealth', 'Batasan Hills', 'Central', 'Sto. Cristo'];
  grid.innerHTML = BARANGAYS_SAFE.map(b => `
    <div class="brgy-card">
      <div class="brgy-card-icon"></div>
      <div class="brgy-card-name">${b}</div>
      <div class="brgy-card-label"><span class="brgy-card-dot"></span>Active</div>
    </div>`).join('');
}

/* ── MY COMPLAINTS TABLE ───────────────────────────────────── */
function renderComplaintsTable() {
  const search    = (document.getElementById('complaints-search')?.value || '').toLowerCase();
  const statusFil = document.getElementById('complaints-filter')?.value || '';

  const my = getMyComplaints().filter(c => {
    const matchSearch = !search || c.id.toLowerCase().includes(search) || c.cat.toLowerCase().includes(search);
    const matchStatus = !statusFil || c.status === statusFil;
    return matchSearch && matchStatus;
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

  tbody.innerHTML = my.map(c => `
    <tr>
      <td class="track-id">${c.id}</td>
      <td>${c.cat}</td>
      <td style="font-size:12px">${c.brgy}</td>
      <td>${priorityBadge(c.priority)}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="mono" style="font-size:12px">${c.date}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" onclick="showTimeline('${c.id}')">Track</button>
        ${c.status === 'submitted'
          ? `<button class="btn-danger btn-sm" onclick="cancelComplaint('${c.id}')">Cancel</button>`
          : ''}
      </td>
    </tr>`).join('');
}

function cancelComplaint(id) {
  if (confirm('Are you sure you want to cancel this complaint?')) {
    showToast('Complaint cancelled successfully.');
    renderComplaintsTable();
  }
}

/* ── MULTI-STEP COMPLAINT FORM ─────────────────────────────── */
let currentStep = 1;
// Persist form state
function saveFormState() {
  const state = {
    step: currentStep,
    cat: document.getElementById('f-cat')?.value,
    brgy: document.getElementById('f-brgy')?.value,
    address: document.getElementById('f-address')?.value,
    date: document.getElementById('f-date')?.value,
    time: document.getElementById('f-time')?.value,
    desc: document.getElementById('f-desc')?.value,
    priority: document.querySelector('.priority-pill.sel')?.dataset.p,
    anon: document.getElementById('anon-toggle')?.checked
  };
  localStorage.setItem('trapico_civilian_form', JSON.stringify(state));
}

function restoreFormState() {
  // Only restore if user is logged in
  const user = sessionStorage.getItem('trapico_user');
  if (!user) return;
  const state = JSON.parse(localStorage.getItem('trapico_civilian_form') || '{}');
  if (!state || !state.step) return;
  if (state.cat) document.getElementById('f-cat').value = state.cat;
  if (state.brgy) document.getElementById('f-brgy').value = state.brgy;
  if (state.address) document.getElementById('f-address').value = state.address;
  if (state.date) document.getElementById('f-date').value = state.date;
  if (state.time) document.getElementById('f-time').value = state.time;
  if (state.desc) document.getElementById('f-desc').value = state.desc;
  if (state.priority) {
    document.querySelectorAll('.priority-pill').forEach(p => p.classList.toggle('sel', p.dataset.p === state.priority));
  }
  if (typeof state.anon === 'boolean') document.getElementById('anon-toggle').checked = state.anon;
  goToStep(state.step);
}

window.addEventListener('beforeunload', saveFormState);
window.addEventListener('DOMContentLoaded', restoreFormState);

function goToStep(step) {
  // Step 2 validation: Details
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
    // Cross-check pin's barangay with selected barangay ONLY if both are set
    const addressInput = document.getElementById('f-address');
    const pinBarangay = (addressInput?.dataset.barangay || '').toLowerCase();
    const selectedBarangay = (brgy || '').toLowerCase();
    if (pinBarangay && selectedBarangay && !pinBarangay.includes(selectedBarangay)) {
      showToast('Pinned location does not match selected barangay. Please pin a location within the selected barangay.');
      return;
    }
  }
  // Step 3 validation: Review (no validation, just show summary)
  if (step === 3) {
    const date = document.getElementById('f-date')?.value;
    const time = document.getElementById('f-time')?.value;
    const desc = document.getElementById('f-desc')?.value.trim() || '';
    if (!date || !time) {
      showToast('Please fill in the incident date and time.');
      return;
    }
    if (desc.length < 50) {
      showToast('Description must be at least 50 characters (' + desc.length + ' so far).');
      return;
    }
    buildReviewSummary();
  }
  // Step 4: Evidence & Submit — show review summary again for confirmation
  if (step === 4) {
    buildReviewSummaryFinal();
  }
  // Sign out: clear all form/session data and redirect to login
  function signOutCivilian() {
    try {
      localStorage.removeItem('trapico_civilian_form');
      sessionStorage.removeItem('trapico_user');
    } catch (e) {}
    window.location.href = '/CITIZEN/civilian.html';
  }
  // Sign out: clear all form/session data and redirect to login
  function signOutCivilian() {
    sessionStorage.removeItem('trapico_user');
    localStorage.removeItem('trapico_civilian_form');
    window.location.href = '../CITIZEN/civilian.html';
  }
  [1,2,3,4].forEach(n => {
    const formStep = document.getElementById('form-step-' + n);
    if (formStep) formStep.classList.add('hidden');
    const stepEl = document.getElementById('step-' + n);
    if (stepEl) {
      stepEl.classList.remove('active', 'done');
      if (n < step)     stepEl.classList.add('done');
      if (n === step)   stepEl.classList.add('active');
      stepEl.querySelector('.step-num').textContent = n < step ? '✓' : n;
    }
  });
  const showStep = document.getElementById('form-step-' + step);
  if (showStep) showStep.classList.remove('hidden');
  currentStep = step;
  window.scrollTo(0, 0);
  saveFormState();
}

function updateCharCount(el) {
  const len = el.value.length;
  document.getElementById('char-count').textContent = `${len} / 50 min`;
  document.getElementById('char-count').style.color = len >= 50 ? 'var(--green)' : 'var(--mist)';
}

function selectPriority(el) {
  document.querySelectorAll('.priority-pill').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
}

function toggleAnonWarning(checkbox) {
  document.getElementById('anon-warning').classList.toggle('hidden', !checkbox.checked);
}

function buildReviewSummary() {
  const cat      = document.getElementById('f-cat')?.value || '—';
  const brgy     = document.getElementById('f-brgy')?.value || '—';
  const address  = document.getElementById('f-address')?.value || '—';
  const date     = document.getElementById('f-date')?.value || '—';
  const time     = document.getElementById('f-time')?.value || '—';
  const priority = document.querySelector('.priority-pill.sel')?.dataset.p || 'medium';
  const anon     = document.getElementById('anon-toggle')?.checked ? 'Yes' : 'No';
  const rows = [
    ['Category',  cat],
    ['Barangay',  brgy],
    ['Address',   address],
    ['Date',      date],
    ['Time',      time],
    ['Priority',  priority.charAt(0).toUpperCase() + priority.slice(1)],
    ['Anonymous', anon],
  ];
  document.getElementById('review-summary').innerHTML = `
    <div class="review-summary-title">Review Your Submission</div>
    ${rows.map(([l,v]) => `
      <div class="review-row">
        <span class="review-label">${l}:</span>
        <span class="review-value">${v}</span>
      </div>`).join('')}`;
}

/* ── PROFILE ───────────────────────────────────────────────── */
let isEditing = false;

function toggleProfileEdit() {
  isEditing = !isEditing;
  document.getElementById('profile-view').classList.toggle('hidden', isEditing);
  document.getElementById('profile-edit').classList.toggle('hidden', !isEditing);
  document.getElementById('edit-btn').textContent = isEditing ? '✕ Cancel' : '✎ Edit';
}

function saveProfile() {
  toggleProfileEdit();
  showToast('Profile updated successfully.');
}

function updatePassword() {
  const cur     = document.getElementById('pw-current')?.value;
  const nw      = document.getElementById('pw-new')?.value;
  const confirm = document.getElementById('pw-confirm')?.value;

  if (!cur || !nw || !confirm) { showToast('Please fill in all password fields.'); return; }
  if (nw !== confirm)          { showToast('New passwords do not match.'); return; }
  if (nw.length < 8)           { showToast('Password must be at least 8 characters.'); return; }

  showToast('Password updated successfully.');
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value     = '';
  document.getElementById('pw-confirm').value = '';
}


function autoFillIncidentDateTime(dateObj, metaText) {
  const dateInput = document.getElementById('f-date');
  const timeInput = document.getElementById('f-time');
  const metaEl = document.getElementById('incident-time-meta');
  if (!dateInput || !timeInput || !dateObj) return;

  const parts = toDatetimeLocalParts(dateObj);
  // Set placeholder to evidence time
  dateInput.placeholder = parts.date;
  timeInput.placeholder = parts.time;
  // Only set value if empty (user hasn't typed anything)
  if (!dateInput.value) dateInput.value = parts.date;
  if (!timeInput.value) timeInput.value = parts.time;
  if (metaEl) {
    metaEl.textContent = metaText || `Auto-updated: ${parts.time}`;
  }
}

// Fix: Add setActivePage to enable navigation
function setActivePage(page) {
  // Hide all main/page sections
  document.querySelectorAll('.main-page-section, .page-section').forEach(el => el.classList.add('hidden'));
  // Remove 'active' class from all nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // Show the selected page section
  var section = document.getElementById('page-' + page);
  if (section) section.classList.remove('hidden');
  // Set the nav item as active
  var nav = document.getElementById('nav-' + page);
  if (nav) nav.classList.add('active');
  // Optionally update the topbar title
  var titleMap = {
    dash: 'Dashboard',
    report: 'File a Complaint',
    complaints: 'My Complaints',
    profile: 'My Profile',
    about: 'About Us'
  };
  if (document.getElementById('topbar-title') && titleMap[page]) {
    document.getElementById('topbar-title').textContent = titleMap[page];
  }
  // Close sidebar on mobile (clears backdrop and body class too)
  if (typeof closeSidebar === 'function') closeSidebar();
}
// Ensure global access
window.setActivePage = setActivePage;