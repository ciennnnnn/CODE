/* ============================================================
   TRAPICO — Field officer frontend backend connector
   ============================================================ */

'use strict';

let FIELD_USER = null;
let ASSIGNMENTS = [];
let HISTORY_ITEMS = [];
let PERFORMANCE_DATA = {};
let fieldNotifOpen = false;
let fieldCountdownInterval = null;
let activeAssignmentId = null;
let gpsTrackInterval = null;
let evidenceUploads = {before: null, after: null};
let activeJobMap = null;
let activeJobIncidentMarker = null;
let activeJobOfficerMarker = null;

window.addEventListener('DOMContentLoaded', initField);
let notificationLastId = 0;
let notificationInterval = null;
let detailsMapInstance = null;
let detailsMapMarker = null;
let assignedCaseMaps = [];
let draftAutosaveTimer = null;
let performanceRefreshInterval = null;

const FIELD_DRAFT_STORE_KEY = 'field_resolution_drafts_v1';
const FIELD_STATUS_OPTIONS = ['submitted', 'verified', 'assigned', 'en_route', 'in_progress', 'resolved', 'validated', 'closed'];

function getDraftStore() {
    try {
        const raw = localStorage.getItem(FIELD_DRAFT_STORE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.warn('Unable to read draft store:', error.message);
        return {};
    }
}

function saveDraftStore(store) {
    try {
        localStorage.setItem(FIELD_DRAFT_STORE_KEY, JSON.stringify(store));
    } catch (error) {
        console.warn('Unable to write draft store:', error.message);
    }
}

function getAssignmentDraft(assignmentId) {
    const store = getDraftStore();
    return store[String(assignmentId)] || null;
}

function persistAssignmentDraft(assignmentId, payload) {
    const store = getDraftStore();
    store[String(assignmentId)] = {
        ...payload,
        saved_at: new Date().toISOString(),
    };
    saveDraftStore(store);
    localStorage.setItem(`field_draft_${assignmentId}`, JSON.stringify(payload));
}

function clearAssignmentDraft(assignmentId) {
    const store = getDraftStore();
    delete store[String(assignmentId)];
    saveDraftStore(store);
    localStorage.removeItem(`field_draft_${assignmentId}`);
}

function cleanupAssignedMaps() {
    assignedCaseMaps.forEach(entry => {
        if (entry?.map) entry.map.remove();
    });
    assignedCaseMaps = [];
}

function computeEfficiencyScore() {
    const serverScore = Number(PERFORMANCE_DATA.efficiency_score || 0);
    if (Number.isFinite(serverScore) && serverScore > 0) {
        return Math.max(0, Math.min(100, Math.round(serverScore)));
    }

    const closure = Number(PERFORMANCE_DATA.closure_rate || 0);
    const onTime = Number(PERFORMANCE_DATA.on_time_rate || 0);
    const satisfaction = Number(PERFORMANCE_DATA.satisfaction || 0) * 20;
    const failurePenalty = 100 - Number(PERFORMANCE_DATA.failure_rate || 0);

    const weighted = (closure * 0.45) + (onTime * 0.30) + (satisfaction * 0.20) + (failurePenalty * 0.05);
    return Math.max(0, Math.min(100, Math.round(weighted)));
}

function startPerformanceRefresh() {
    if (performanceRefreshInterval) {
        clearInterval(performanceRefreshInterval);
    }

    performanceRefreshInterval = setInterval(async () => {
        try {
            await loadPerformance();
            renderDashboard();
            renderPerformance();
        } catch (error) {
            console.warn('Realtime performance refresh failed:', error.message);
        }
    }, 15000);
}

function getCurrentPositionPromise() {
    if (!window.isSecureContext) {
        return Promise.reject(new Error('GPS requires a secure origin. Please use HTTPS for GPS features.'));
    }
    if (!navigator.geolocation) {
        return Promise.reject(new Error('Geolocation is not supported by your browser.'));
    }

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            resolve,
            () => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: false,
                    timeout: 12000,
                    maximumAge: 30000,
                });
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
            }
        );
    });
}

async function initField() {
    const user = await requireLoginRedirect();
    if (!user) return;
    FIELD_USER = user;

    await loadFieldProfile();

    const displayName = FIELD_USER.name || FIELD_USER.username || 'Field Officer';
    const initials = (String(displayName)
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase()) || 'FO';

    const sidebarNameEl = document.getElementById('field-sb-name');
    if (sidebarNameEl) sidebarNameEl.textContent = displayName;

    const topNameEl = document.getElementById('field-top-name');
    if (topNameEl) topNameEl.textContent = displayName;

    const topAvatarEl = document.getElementById('field-top-avatar');
    if (topAvatarEl) {
        topAvatarEl.textContent = initials;
        topAvatarEl.style.fontSize = initials.length > 1 ? '11px' : '14px';
    }

    await Promise.all([loadAssignedTasks(), loadHistory(), loadPerformance()]);
    renderDashboard();
    renderAssigned();
    renderActiveJob();
    renderHistory();
    renderPerformance();
    renderProfile();
    startPerformanceRefresh();
    loadFieldContacts();
    startGlobalUnreadPolling();
}

async function loadFieldProfile() {
    try {
        const resp = await apiFetch('user.php', {action: 'profile'});
        if (resp && resp.user) {
            FIELD_USER = {...FIELD_USER, ...resp.user};
        }
    } catch (error) {
        console.warn('Unable to load field profile:', error.message);
    }
}

function applyFieldAvatar(element, initial, imageUrl, fallbackClassName = '') {
    if (!element) return;
    if (imageUrl) {
        element.innerHTML = `<img src="${safeText(imageUrl)}" alt="Profile picture" style="width:100%;height:100%;object-fit:cover;border-radius:inherit" />`;
        return;
    }

    element.textContent = initial;
    if (fallbackClassName) {
        element.className = fallbackClassName;
    }
}

function getFieldBadgeId() {
    if (FIELD_USER?.badge_number) return FIELD_USER.badge_number;
    const assignmentBadge = ASSIGNMENTS.find(item => item.officer_badge)?.officer_badge;
    if (assignmentBadge) return assignmentBadge;
    return 'EMP-' + String(FIELD_USER?.officer_id || FIELD_USER?.id || '001').padStart(4, '0');
}

function renderProfile() {
        const user = FIELD_USER;
        if (!user) return;

        const initial = (user.name || 'F').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const topbarName = document.getElementById('field-top-name');
        if (topbarName) topbarName.textContent = user.name || 'Field Officer';
        const profilePictureUrl = String(user.profile_picture_url || '').trim();

        const profAvatar = document.getElementById('prof-avatar');
        if (profAvatar) {
            applyFieldAvatar(profAvatar, initial, profilePictureUrl);
        }

        const totalResolved = Number(PERFORMANCE_DATA.resolved || 0);
        const onTimeRate = Number(PERFORMANCE_DATA.on_time_rate || 0);
        const satisfaction = Number(PERFORMANCE_DATA.satisfaction || 0);
        const closureRate = Number(PERFORMANCE_DATA.closure_rate || 0);
        const avgResponseMinutes = Number(PERFORMANCE_DATA.avg_response_mins || 0);
        const currentCaseLoad = ASSIGNMENTS.length;
        const completedCount = HISTORY_ITEMS.length;
        const avgTimeLabel = avgResponseMinutes > 0 ? `${avgResponseMinutes} mins` : '—';
        const efficiencyScore = computeEfficiencyScore();

        document.getElementById('prof-name').textContent = user.name || '—';
        document.getElementById('prof-position').textContent = 'Field Officer';
        document.getElementById('prof-email').textContent = user.email || '—';
        document.getElementById('prof-phone').textContent = user.phone || '—';
        document.getElementById('prof-badgeid').textContent = getFieldBadgeId();
        document.getElementById('prof-brgy').textContent = user.home_barangay || '—';
        document.getElementById('prof-cases').textContent = completedCount;
        document.getElementById('prof-closed').textContent = totalResolved;
        document.getElementById('prof-avgtime').textContent = avgTimeLabel;
        document.getElementById('prof-caseload').textContent = currentCaseLoad;
        document.getElementById('prof-officers-count').textContent = `${onTimeRate}%`;
        document.getElementById('prof-active-brgy').textContent = `${satisfaction.toFixed(1)}/5`;
        document.getElementById('prof-resolution-rate').textContent = `${closureRate}%`;
        document.getElementById('prof-on-time').textContent = `${onTimeRate}%`;
        document.getElementById('prof-avg-rating').textContent = `${satisfaction.toFixed(1)}★`;
        document.getElementById('prof-efficiency').textContent = `${efficiencyScore}/100`;

        const sbName = document.querySelector('.srb-name');
        if (sbName) sbName.textContent = user.name || 'Field Officer';
        const topAvatarEl = document.getElementById('field-top-avatar');
        if (topAvatarEl) applyFieldAvatar(topAvatarEl, initial, profilePictureUrl, 'user-avatar');
}

function editProfile() {
        const previewUrl = String(FIELD_USER.profile_picture_url || '').trim() || 'https://i.pravatar.cc/120?img=68';
        openModal(`
            <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
                <div class="modal" style="max-width:520px">
                    <div class="modal-head">
                        <div>
                            <div class="modal-title">Edit Profile</div>
                            <div class="modal-subtitle">Update field officer details</div>
                        </div>
                        <button class="modal-close" onclick="closeModal()">✕</button>
                    </div>
                    <div class="modal-body">
                        <div style="text-align:center; margin-bottom:16px">
                            <img id="edit-profile-photo-preview" src="${safeText(previewUrl)}" style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:2px solid var(--border)" alt="Profile Photo" />
                            <div style="margin-top:10px">
                                <input id="edit-profile-photo" type="file" accept="image/*" class="hidden" onchange="handleFieldProfilePhotoSelection(event)" />
                                <button type="button" class="btn-secondary btn-sm" onclick="document.getElementById('edit-profile-photo').click()">Change Picture</button>
                            </div>
                            <div id="edit-profile-photo-status" style="margin-top:8px;font-size:12px;color:var(--mist)">Upload a JPG, PNG, GIF, or WebP image.</div>
                        </div>
                        <div class="form-group">
                            <label for="edit-profile-name">Full Name</label>
                            <input id="edit-profile-name" class="form-input" type="text" value="${safeText(FIELD_USER.name)}" />
                        </div>
                        <div class="form-group">
                            <label for="edit-profile-email">Email</label>
                            <input id="edit-profile-email" class="form-input" type="email" value="${safeText(FIELD_USER.email)}" />
                        </div>
                        <div class="form-group">
                            <label for="edit-profile-phone">Phone</label>
                            <input id="edit-profile-phone" class="form-input" type="tel" value="${safeText(FIELD_USER.phone || '+63 ')}" />
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                        <button class="btn-primary" onclick="submitProfileEdit()">Save Changes</button>
                    </div>
                </div>
            </div>`);
}

function handleFieldProfilePhotoSelection(event) {
    const file = event?.target?.files?.[0];
    const statusEl = document.getElementById('edit-profile-photo-status');
    const preview = document.getElementById('edit-profile-photo-preview');
    if (!file || !preview) return;

    const reader = new FileReader();
    reader.onload = function(loadEvent) {
        preview.src = String(loadEvent?.target?.result || preview.src);
    };
    reader.readAsDataURL(file);

    if (statusEl) {
        statusEl.textContent = `Selected: ${file.name}`;
    }
}

async function uploadFieldProfilePhoto(file) {
    const statusEl = document.getElementById('edit-profile-photo-status');
    if (statusEl) statusEl.textContent = 'Uploading picture...';

    const formData = new FormData();
    formData.append('action', 'upload_evidence');
    formData.append('file', file);

    const uploadResp = await apiFetch('media.php?action=upload_evidence', formData, 'POST');
    const photoUrl = String(uploadResp?.url || '').trim();
    if (!photoUrl) {
        throw new Error('Upload did not return a file URL.');
    }

    await apiFetch('user.php', {action: 'updateProfilePicture', profilePictureUrl: photoUrl}, 'POST');
    FIELD_USER.profile_picture_url = photoUrl;
    if (statusEl) statusEl.textContent = '✓ Picture uploaded successfully.';
    return photoUrl;
}

async function submitProfileEdit() {
        const name = document.getElementById('edit-profile-name')?.value.trim();
        const email = document.getElementById('edit-profile-email')?.value.trim();
        const phone = document.getElementById('edit-profile-phone')?.value.trim();
    const photoFile = document.getElementById('edit-profile-photo')?.files?.[0] || null;

        if (!name || !email || !phone) {
                showToast('All fields are required.');
                return;
        }

        try {
        if (photoFile) {
            await uploadFieldProfilePhoto(photoFile);
        }
                await apiFetch('user.php', {action: 'updateProfile', name, email, phone}, 'POST');
                FIELD_USER.name = name;
                FIELD_USER.email = email;
                FIELD_USER.phone = phone;
                renderProfile();
                closeModal();
                showToast('✓ Profile updated successfully.');
        } catch (error) {
                showToast(error.message);
        }
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
                        <div class="form-group">
                            <label for="current-pass">Current Password</label>
                            <div class="password-wrap">
                                <input id="current-pass" class="form-input login-input-password" type="password" placeholder="Enter current password" />
                                <button type="button" class="password-toggle" onclick="toggleProfilePasswordVisibility('current-pass', this)" aria-label="Show password">◔</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="new-pass">New Password</label>
                            <div class="password-wrap">
                                <input id="new-pass" class="form-input login-input-password" type="password" placeholder="Enter new password" />
                                <button type="button" class="password-toggle" onclick="toggleProfilePasswordVisibility('new-pass', this)" aria-label="Show password">◔</button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="confirm-pass">Confirm Password</label>
                            <div class="password-wrap">
                                <input id="confirm-pass" class="form-input login-input-password" type="password" placeholder="Confirm new password" />
                                <button type="button" class="password-toggle" onclick="toggleProfilePasswordVisibility('confirm-pass', this)" aria-label="Show password">◔</button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                        <button class="btn-primary" onclick="submitPasswordChange()">✓ Change Password</button>
                    </div>
                </div>
            </div>`);
}

        function toggleProfilePasswordVisibility(inputId, button) {
            const input = document.getElementById(inputId);
            if (!input || !button) return;

            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            button.textContent = showing ? '◔' : '◕';
            button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
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
                {time: '2 min ago', action: 'Viewed assigned cases', detail: 'Accessed Assigned Cases page'},
                {time: '5 min ago', action: 'Opened active job', detail: 'Reviewed current assignment details'},
                {time: '12 min ago', action: 'Saved resolution draft', detail: 'Saved current progress locally'},
                {time: '18 min ago', action: 'Updated case status', detail: 'Changed assignment workflow status'},
                {time: '25 min ago', action: 'Sent message to dispatch', detail: 'Opened dispatch chat thread'},
                {time: '42 min ago', action: 'Viewed performance', detail: 'Accessed My Performance page'},
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

/* ── MESSAGES PAGE ─────────────────────────────────────────── */
let fieldContacts = [];
let fieldActiveContact = null;
let fieldChatLastId = 0;
let fieldChatInterval = null;
let fieldUnreadMap = {};
let fieldBaselineMap = {};

async function loadFieldContacts() {
    try {
        const resp = await apiFetch('field.php', {action: 'contacts'});
        fieldContacts = resp.contacts || [];
        renderContactList();
        pollAllContactsForUnread();
    } catch (error) {
        console.warn('Could not load contacts:', error.message);
    }
}

function renderContactList() {
    const listEl = document.getElementById('contact-list');
    if (!listEl) return;
    if (!fieldContacts.length) {
        listEl.innerHTML = '<div class="contact-empty">No dispatch officers available.</div>';
        return;
    }
    listEl.innerHTML = fieldContacts.map(c => {
        const initials = String(c.name || 'D').split(' ').filter(Boolean).map(p => p[0]).join('').slice(0,2).toUpperCase();
        const unread = fieldUnreadMap[String(c.user_id)] || 0;
        const isActive = fieldActiveContact && String(fieldActiveContact.user_id) === String(c.user_id);
        return `<div class="contact-item${isActive ? ' active' : ''}" onclick="selectFieldContactById('${safeText(c.user_id)}')">
            <div class="contact-avatar">${safeText(initials)}</div>
            <div class="contact-info">
                <div class="contact-name">${safeText(c.name || 'Dispatch Officer')}</div>
                <div class="contact-brgy">${safeText(c.brgy ? 'Brgy. ' + c.brgy : 'Command Center')}</div>
            </div>
            ${unread > 0 ? `<div class="contact-unread">${unread}</div>` : ''}
        </div>`;
    }).join('');
}

function selectFieldContactById(userId) {
    const contact = fieldContacts.find(c => String(c.user_id) === String(userId));
    if (contact) selectFieldContact(contact);
}

function selectFieldContact(contact) {
    fieldActiveContact = contact;
    fieldChatLastId = 0;
    fieldUnreadMap[String(contact.user_id)] = 0;
    renderContactList();
    openFieldChat(contact);
    loadFieldChatThread();
    startFieldChatPolling();
    updateMessagesNavBadge();
}

function openFieldChat(contact) {
    const initials = String(contact.name || 'D').split(' ').filter(Boolean).map(p => p[0]).join('').slice(0,2).toUpperCase();
    const placeholder = document.getElementById('chat-placeholder');
    const chatArea = document.getElementById('chat-active-area');
    if (placeholder) placeholder.classList.add('hidden');
    if (chatArea) chatArea.classList.remove('hidden');
    const avatarEl = document.getElementById('chat-header-avatar');
    const nameEl = document.getElementById('chat-header-name');
    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = contact.name || 'Dispatch Officer';

    // Mobile: switch to chat panel
    if (window.innerWidth <= 768) {
        const shell = document.querySelector('.messenger-shell');
        if (shell) shell.classList.add('chat-mode');
    }
}

function backToContacts() {
    const shell = document.querySelector('.messenger-shell');
    if (shell) shell.classList.remove('chat-mode');
    stopFieldChatPolling();
    fieldActiveContact = null;
    const placeholder = document.getElementById('chat-placeholder');
    const chatArea = document.getElementById('chat-active-area');
    if (placeholder) placeholder.classList.remove('hidden');
    if (chatArea) chatArea.classList.add('hidden');
}

async function loadFieldChatThread(silent = false) {
    if (!fieldActiveContact) return;
    try {
        const resp = await apiFetch('messages.php', {
            action: 'thread',
            receiver_role: 'dispatch',
            receiver_id: String(fieldActiveContact.user_id),
        });
        const messages = resp.messages || [];
        fieldChatLastId = messages.length ? Number(messages[messages.length - 1].id) : 0;
        renderFieldChatMessages(messages);
    } catch (error) {
        if (silent) {
            console.warn('Field chat thread reload failed:', error.message);
        } else {
            showToast(error.message);
        }
    }
}

function renderFieldChatMessages(messages) {
    const body = document.getElementById('messenger-messages-body');
    if (!body) return;
    const myUserId = FIELD_USER ? String(FIELD_USER.user_id || FIELD_USER.id || '') : '';

    if (!messages.length) {
        body.innerHTML = '<div class="msg-date-divider">No messages yet. Send the first message!</div>';
        return;
    }

    let lastDate = '';
    const rows = [];
    for (const msg of messages) {
        const isMine = myUserId ? String(msg.senderId) === myUserId : String(msg.senderRole || '') === 'field';
        const senderName = msg.senderName || (isMine ? (FIELD_USER?.name || 'Me') : (fieldActiveContact?.name || 'Dispatch'));
        const initials = String(senderName).split(' ').filter(Boolean).map(p => p[0]).join('').slice(0,2).toUpperCase() || '?';
        const sentAt = new Date(msg.sentAt);
        const dateStr = sentAt.toLocaleDateString();
        let dateDivider = '';
        if (dateStr !== lastDate) {
            lastDate = dateStr;
            dateDivider = `<div class="msg-date-divider">${safeText(dateStr)}</div>`;
        }
        const timeStr = sentAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        rows.push(`${dateDivider}<div class="messenger-msg-row ${isMine ? 'sent' : 'received'}">
            <div class="msg-sender-avatar ${isMine ? 'my-avatar' : 'their-avatar'}">${safeText(initials)}</div>
            <div class="msg-bubble-wrap ${isMine ? 'sent' : ''}">
                <div class="msg-sender-name">${safeText(senderName)}</div>
                <div class="msg-bubble ${isMine ? 'sent' : 'received'}">${safeText(msg.message)}</div>
                <div class="msg-time">${safeText(timeStr)}</div>
            </div>
        </div>`);
    }
    body.innerHTML = rows.join('');
    body.scrollTop = body.scrollHeight;
}

async function sendFieldMessage() {
    const input = document.getElementById('field-chat-input');
    if (!input || !fieldActiveContact) return;
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    try {
        await apiFetch('messages.php', {
            action: 'send',
            receiver_role: 'dispatch',
            receiver_id: String(fieldActiveContact.user_id),
            message,
        }, 'POST');
        await loadFieldChatThread(true);
    } catch (error) {
        input.value = message;
        showToast(error.message);
    }
}

function startFieldChatPolling() {
    stopFieldChatPolling();
    fieldChatInterval = setInterval(async () => {
        if (!fieldActiveContact) return;
        try {
            const resp = await apiFetch('messages.php', {
                action: 'poll',
                receiver_role: 'dispatch',
                receiver_id: String(fieldActiveContact.user_id),
                last_id: fieldChatLastId,
            });
            const newMsgs = resp.messages || [];
            if (newMsgs.length) {
                fieldChatLastId = Number(newMsgs[newMsgs.length - 1].id);
                await loadFieldChatThread();
            }
        } catch (error) {
            console.warn('Chat poll failed:', error.message);
        }
    }, 3000);
}

function stopFieldChatPolling() {
    if (fieldChatInterval) {
        clearInterval(fieldChatInterval);
        fieldChatInterval = null;
    }
}

async function pollAllContactsForUnread() {
    for (const c of fieldContacts) {
        try {
            const resp = await apiFetch('messages.php', {
                action: 'thread',
                receiver_role: 'dispatch',
                receiver_id: String(c.user_id),
            });
            const messages = resp.messages || [];
            const incoming = messages.filter(m => String(m.senderRole || '') !== 'field');
            const lastId = incoming.length ? Number(incoming[incoming.length - 1].id) : 0;
            const baseline = fieldBaselineMap[String(c.user_id)];
            if (baseline === undefined) {
                fieldBaselineMap[String(c.user_id)] = lastId;
            } else {
                const unread = incoming.filter(m => Number(m.id) > baseline).length;
                if (unread > 0 && !(fieldActiveContact && String(fieldActiveContact.user_id) === String(c.user_id))) {
                    fieldUnreadMap[String(c.user_id)] = (fieldUnreadMap[String(c.user_id)] || 0) + unread;
                    fieldBaselineMap[String(c.user_id)] = lastId;
                }
            }
        } catch (_) {}
    }
    renderContactList();
    updateMessagesNavBadge();
}

function updateMessagesNavBadge() {
    const total = Object.values(fieldUnreadMap).reduce((s, n) => s + Number(n || 0), 0);
    const badge = document.getElementById('badge-messages');
    if (!badge) return;
    badge.textContent = String(total);
    badge.classList.toggle('hidden', total <= 0);
}

function startGlobalUnreadPolling() {
    setInterval(async () => {
        await pollAllContactsForUnread();
    }, 8000);
}

async function loadAssignedTasks() {
    const resp = await apiFetch('field.php', {action: 'assigned'});
    ASSIGNMENTS = resp.assignments || [];
}

async function loadHistory() {
    const resp = await apiFetch('field.php', {action: 'history'});
    HISTORY_ITEMS = resp.history || [];
}

async function loadPerformance() {
    const resp = await apiFetch('field.php', {action: 'performance'});
    PERFORMANCE_DATA = resp.performance || {};
}

function toggleNotif() {
    fieldNotifOpen = !fieldNotifOpen;
    document.getElementById('notif-panel').classList.toggle('hidden', !fieldNotifOpen);
}

document.addEventListener('click', e => {
    if (!e.target.closest('#notif-btn') && fieldNotifOpen) {
        document.getElementById('notif-panel').classList.add('hidden');
        fieldNotifOpen = false;
    }
});

function fmtTime(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function myAssigned() {
    return ASSIGNMENTS;
}

function getActiveAssignment() {
    if (!ASSIGNMENTS.length) return null;
    if (!activeAssignmentId) {
        activeAssignmentId = ASSIGNMENTS[0].assignment_id;
    }
    return ASSIGNMENTS.find(a => String(a.assignment_id) === String(activeAssignmentId)) || ASSIGNMENTS[0];
}

function openJobByAssignment(assignmentId) {
    activeAssignmentId = assignmentId;
    evidenceUploads = {before: null, after: null};
    renderActiveJob();
    setActivePage('job');
    refreshDispatchChatAlerts({baselineOnly: true});
}

function renderDashboard() {
        const assignedCount = ASSIGNMENTS.length;
        const inProgressCount = ASSIGNMENTS.filter(a => a.assignment_status === 'in_progress').length;
        const resolvedToday = Number(PERFORMANCE_DATA.resolved_today || 0);
        const efficiency = computeEfficiencyScore();

        document.getElementById('stat-assigned').textContent = assignedCount;
        document.getElementById('stat-inprog').textContent = inProgressCount;
        document.getElementById('badge-assigned').textContent = assignedCount;
        const resolvedTodayEl = document.getElementById('stat-resolved-today');
        if (resolvedTodayEl) resolvedTodayEl.textContent = resolvedToday;
        const efficiencyEl = document.getElementById('stat-efficiency');
        if (efficiencyEl) efficiencyEl.innerHTML = `${efficiency}<span class="unit">%</span>`;

        // Show/hide Active Job alert
        const urgentAlert = document.getElementById('dash-urgent-alert');
        const dashCountdown = document.getElementById('dash-countdown');
        const active = getActiveAssignment();
        if (urgentAlert && dashCountdown) {
                if (active && ['assigned','en_route','in_progress'].includes(active.assignment_status)) {
                        urgentAlert.classList.remove('hidden');
                        // Set countdown
                        const deadline = active.deadline ? new Date(active.deadline).getTime() : null;
                        if (deadline) {
                                const now = Date.now();
                                let diff = Math.floor((deadline - now) / 1000);
                                dashCountdown.textContent = diff > 0 ? fmtTime(diff) : 'OVERDUE';
                        } else {
                                dashCountdown.textContent = '--:--';
                        }
                } else {
                        urgentAlert.classList.add('hidden');
                }
        }

        // Render task list
        const allTasks = ASSIGNMENTS.slice(0, 4);
        const taskList = document.getElementById('dash-task-list');
        if (!taskList) return;
        taskList.innerHTML = allTasks.map((c, i) => `
            <div class="task-card${i === 0 ? ' priority-top' : ''}">
                <div class="task-num">${i + 1}</div>
                <div class="task-body">
                    <div class="task-id">${safeText(c.id)}</div>
                    <div class="task-cat">${safeText(c.cat)}</div>
                    <div class="task-meta">Brgy. ${safeText(c.brgy)} &middot; ${formatDateTime(c.date)}</div>
                    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
                        ${statusBadge(c.status)} ${priorityBadge(c.priority)}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn-primary btn-sm" onclick="openJobByAssignment('${safeText(c.assignment_id)}')">Start Job</button>
                    <button class="btn-secondary btn-sm" onclick="showCaseDetailsMap('${safeText(c.id)}')">Details</button>
                </div>
            </div>`).join('');
}

function getReporterName(assignment) {
    if (assignment.anon) return 'Anonymous';
    return assignment.reporter ? String(assignment.reporter) : 'Citizen';
}

function statusOptionsMarkup(currentStatus = '') {
    return FIELD_STATUS_OPTIONS
        .map(status => `<option value="${safeText(status)}" ${String(currentStatus) === status ? 'selected' : ''}>${safeText(status.replace('_', ' '))}</option>`)
        .join('');
}

function renderTransparencyTimeline(currentStatus = 'submitted') {
    const statusIndex = FIELD_STATUS_OPTIONS.indexOf(String(currentStatus).toLowerCase());
    const timelineItems = FIELD_STATUS_OPTIONS.map((status, idx) => {
        const isCompleted = idx < statusIndex;
        const isCurrent = idx === statusIndex;
        const statusDisplay = status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1);
        
        let indicator = '';
        if (isCompleted) {
            indicator = '✓';
        } else if (isCurrent) {
            indicator = '●';
        } else {
            indicator = '○';
        }
        
        const circleClass = isCompleted ? 'timeline-check' : isCurrent ? 'timeline-active' : 'timeline-pending';
        
        return `
            <div class="timeline-item ${circleClass}">
                <div class="timeline-circle">${indicator}</div>
                <div class="timeline-content">
                    <div class="timeline-status">${statusDisplay}</div>
                    <div class="timeline-time">${idx === 0 ? formatDateTime(new Date()) : '—'}</div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="transparency-timeline">
            <div class="timeline-title">Transparency Timeline</div>
            ${timelineItems}
        </div>
    `;
}

function renderAssigned() {
    const list = myAssigned();
    const el = document.getElementById('assigned-list');
    if (!el) return;

    cleanupAssignedMaps();

    if (!list.length) {
        el.innerHTML = `<div class="empty-state"><div class="empty-icon">--</div><div class="empty-title">No assigned cases</div><div class="empty-sub">You have no active assignments. Stand by.</div></div>`;
        return;
    }

        el.innerHTML = list.map(c => {
            const lat = Number.parseFloat(c.lat);
            const lng = Number.parseFloat(c.lng);
            const coordText = Number.isFinite(lat) && Number.isFinite(lng)
                ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                : 'Location unavailable';

                        return `
      <div class="assigned-card">
        <div class="assigned-card-header">
          <div>
            <div class="assigned-card-title">
              <span class="track-id">${safeText(c.id)}</span>
              ${statusBadge(c.status)}
              ${priorityBadge(c.priority)}
            </div>
            <div class="assigned-card-name">${safeText(c.cat)} · Barangay ${safeText(c.brgy)}</div>
          </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                        <button class="btn-secondary btn-sm" onclick="showCaseDetailsMap('${safeText(c.id)}')">Details</button>
                        <button class="btn-danger btn-sm" onclick="openFieldReassignModal('${safeText(c.assignment_id)}', '${safeText(c.id)}')">Reassign</button>
                        <button class="btn-primary btn-sm" onclick="openJobByAssignment('${safeText(c.assignment_id)}')">▶ Start Job</button>
                    </div>
        </div>
        <div class="assigned-card-body">
          <div>
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--mist);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Description</div>
            <div style="font-size:13px;line-height:1.6">${safeText(c.desc)}</div>
            <div style="margin-top:14px;display:flex;flex-direction:column;gap:4px">
              <div class="assigned-meta-row"><span class="assigned-meta-label">Date/Time</span><span class="assigned-meta-val">${formatDateTime(c.date)}</span></div>
              <div class="assigned-meta-row"><span class="assigned-meta-label">Priority</span><span class="assigned-meta-val">${safeText(c.priority)}</span></div>
                            <div class="assigned-meta-row"><span class="assigned-meta-label">Reporter</span><span class="assigned-meta-val">${safeText(getReporterName(c))}</span></div>
                            <div class="assigned-meta-row"><span class="assigned-meta-label">Status</span><span class="assigned-meta-val" style="text-transform:capitalize">${safeText(String(c.status || '').replace('_', ' '))}</span></div>
            </div>
          </div>
          <div>
            <div class="assigned-map-shell" style="height:170px;border-radius:8px;border:1px solid var(--border);overflow:hidden;position:relative">
              <div id="assigned-map-${safeText(c.assignment_id)}" class="assigned-case-map" style="height:100%"></div>
            </div>
            <div style="margin-top:8px">
                            <span id="assigned-map-label-${safeText(c.assignment_id)}" style="font-size:12px;color:var(--mist)">${safeText(coordText)}</span>
            </div>
          </div>
        </div>
            </div>`;
        }).join('');

    initAssignedMaps(list);
}

function initAssignedMaps(assignments) {
    if (typeof L === 'undefined') return;

    assignments.forEach(assignment => {
        const mapId = `assigned-map-${assignment.assignment_id}`;
        const mapEl = document.getElementById(mapId);
        if (!mapEl) return;

        const lat = Number.parseFloat(assignment.lat);
        const lng = Number.parseFloat(assignment.lng);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        const target = hasCoords ? [lat, lng] : [14.6760, 121.0437];

        const map = L.map(mapId, {zoomControl: false, scrollWheelZoom: false}).setView(target, hasCoords ? 15 : 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
        }).addTo(map);

        if (hasCoords) {
            const incidentPopup = `
                <div style="font-weight:700">${safeText(assignment.id || 'Incident')}</div>
                <div style="font-size:12px;margin-top:4px">${safeText(assignment.cat || '')} · ${safeText(assignment.brgy || '')}</div>
                <div style="font-size:12px;margin-top:6px;line-height:1.45">${safeText(assignment.desc || 'No description')}</div>
            `;
            L.marker(target)
                .addTo(map)
                .bindPopup(incidentPopup)
                .bindTooltip('Incident location', {permanent: true, direction: 'top', offset: [0, -18], className: 'incident-pin-label'});
        }

        assignedCaseMaps.push({assignmentId: String(assignment.assignment_id), map, officerMarker: null});
    });
}

function centerAssignedMapToGps(assignmentId) {
    const mapId = `assigned-map-${assignmentId}`;
    const entry = assignedCaseMaps.find(item => item?.map && item.map.getContainer && item.map.getContainer().id === mapId);
    if (!entry?.map) {
        showToast('Map is still loading. Please try again.');
        return;
    }

    const label = document.getElementById(`assigned-map-label-${assignmentId}`);
    if (label) label.textContent = 'Detecting your GPS location...';

    getCurrentPositionPromise().then(position => {
        const point = [position.coords.latitude, position.coords.longitude];
        if (entry.officerMarker) {
            entry.officerMarker.setLatLng(point);
        } else {
            entry.officerMarker = L.marker(point).addTo(entry.map).bindPopup('Field officer pinned location');
        }
        entry.map.setView(point, 16);
        if (label) label.textContent = `Pinned: ${point[0].toFixed(5)}, ${point[1].toFixed(5)}`;
        showToast('Your location has been pinned on the map.');
    }).catch(error => {
        if (label) label.textContent = 'GPS unavailable. Please use HTTPS (https://yourdomain) for GPS features.';
        showToast('Unable to fetch GPS location: ' + (error.message || 'Permission denied.'));
    });
}

function getStatusSelectValue(assignmentId) {
    const selectEl = document.getElementById(`assigned-status-${assignmentId}`) || document.getElementById('active-status-select');
    return selectEl ? selectEl.value : '';
}

async function updateAssignmentStatus(assignmentId, nextStatus) {
    if (!assignmentId || !nextStatus) {
        showToast('Please select a valid status.');
        return;
    }

    try {
        await apiFetch('field.php', {action: 'updateStatus', assignment_id: assignmentId, status: nextStatus}, 'POST');
        showToast('Report status updated.');
        await Promise.all([loadAssignedTasks(), loadHistory(), loadPerformance()]);
        renderDashboard();
        renderAssigned();
        renderActiveJob();
        renderHistory();
        renderPerformance();
    } catch (error) {
        showToast(error.message || 'Unable to update status.');
    }
}

function applyStatusFromAssigned(assignmentId) {
    const value = getStatusSelectValue(assignmentId);
    updateAssignmentStatus(assignmentId, value);
}

function renderActiveJob() {
        const page = document.getElementById('page-job');
        if (!page) return;

    if (activeJobMap) {
        activeJobMap.remove();
        activeJobMap = null;
        activeJobIncidentMarker = null;
        activeJobOfficerMarker = null;
    }

        const assignment = getActiveAssignment();
        if (!assignment) {
                page.innerHTML = `<div class="empty-state"><div class="empty-icon">--</div><div class="empty-title">No active job</div><div class="empty-sub">You have no pending or in-progress assignments right now.</div></div>`;
                stopLiveTracking();
                return;
        }

        const checkedIn = Number(assignment.checked_in) === 1 || assignment.assignment_status === 'in_progress';
        const statusText = assignment.status || assignment.assignment_status || 'assigned';

        page.innerHTML = `
            <div class="active-job-card">
                <div class="job-header">
                    <div>
                        <div class="job-id-row">
                            <span class="track-id">${safeText(assignment.id)}</span>
                            ${statusBadge(statusText)}
                            ${priorityBadge(assignment.priority)}
                        </div>
                        <div class="job-meta">${safeText(assignment.cat)} · Barangay ${safeText(assignment.brgy)} · ${formatDateTime(assignment.date)}</div>
                    </div>
                </div>

                ${renderTransparencyTimeline(statusText)}

                                <div class="job-meta-grid">
                                        <div class="job-meta-cell"><div class="job-meta-k">Description</div><div class="job-meta-v">${safeText(assignment.desc || 'No description')}</div></div>
                                        <div class="job-meta-cell"><div class="job-meta-k">Date/Time</div><div class="job-meta-v">${formatDateTime(assignment.date)}</div></div>
                                        <div class="job-meta-cell"><div class="job-meta-k">Priority</div><div class="job-meta-v">${safeText(assignment.priority)}</div></div>
                                        <div class="job-meta-cell"><div class="job-meta-k">Reporter</div><div class="job-meta-v">${safeText(getReporterName(assignment))}</div></div>
                                </div>

                <div class="countdown-box">
                    <div>
                        <div class="countdown-val" id="job-countdown">--:--</div>
                        <div class="countdown-label">Time remaining in arrival window</div>
                    </div>
                    <div class="countdown-meta">
                        Submitted: ${formatDateTime(assignment.date)}<br>
                        Deadline: ${formatDateTime(assignment.deadline)}
                    </div>
                </div>

                <div id="job-fta-alert" class="alert alert-danger hidden">
                    <div>You are approaching the 30-minute arrival deadline. Failure to check in will trigger an automated <strong>Failure-to-Arrive</strong> alert to Dispatch.</div>
                </div>

                                <div style="margin-bottom:20px">
                                        <div id="active-job-map" style="height:220px;border-radius:8px;border:1px solid var(--border)"></div>
                                        <div style="margin-top:8px">
                                            <span id="active-job-map-label" style="font-size:12px;color:var(--mist)">Loading map…</span>
                                        </div>
                </div>

                <div class="checkin-panel">
                    <div class="checkin-title">GPS Geofence Check-In</div>
                    <div class="checkin-sub">You must be within 150m of the incident site to check in. The system verifies your GPS coordinates.</div>
                    <div class="checkin-actions" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
                        <button class="btn-danger" id="btn-checkin" onclick="attemptCheckin()" ${checkedIn ? 'disabled style="opacity:.45"' : ''}>Check In (GPS)</button>
                        <button class="btn-success" id="btn-simulate" onclick="simulateArrival()" ${checkedIn ? 'disabled style="opacity:.45"' : ''}>Simulate Arrival</button>
                    </div>
                    <div class="checkin-status ${checkedIn ? 'ok' : ''}" id="checkin-status">${checkedIn ? 'Already checked in for this assignment.' : ''}</div>
                </div>

                <div id="resolution-form">
                    <div class="section-title" style="margin-bottom:16px">Resolution Report</div>

                    <div class="evidence-grid">
                        <div>
                            <label class="evidence-label">Before — Incident Evidence</label>
                            <input type="file" id="evidence-before-input" accept="image/*,video/mp4,video/quicktime" style="display:none" onchange="handleEvidenceSelected('before', this)" />
                            <div class="upload-box" style="height:110px;cursor:pointer" onclick="chooseEvidence('before')">
                                <div class="upload-text" style="font-size:12px">Upload BEFORE photo/video</div>
                                <div class="upload-sub" id="evidence-before-status">No file uploaded</div>
                            </div>
                        </div>
                        <div>
                            <label class="evidence-label">After — Proof of Resolution</label>
                            <input type="file" id="evidence-after-input" accept="image/*,video/mp4,video/quicktime" style="display:none" onchange="handleEvidenceSelected('after', this)" />
                            <div class="upload-box" style="height:110px;cursor:pointer" onclick="chooseEvidence('after')">
                                <div class="upload-text" style="font-size:12px">Upload AFTER photo/video</div>
                                <div class="upload-sub" id="evidence-after-status">No file uploaded</div>
                            </div>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label for="res-method">Resolution Method *</label>
                            <select id="res-method" class="form-select">
                                <option value="">— Select method —</option>
                                <option>Traffic re-routing</option>
                                <option>Obstruction removal</option>
                                <option>Road barricading</option>
                                <option>DPWH referral</option>
                                <option>On-site enforcement</option>
                                <option>Emergency repair coordination</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="res-equipment">Equipment Used</label>
                            <input id="res-equipment" class="form-input" placeholder="e.g. Traffic cones, flares…" />
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="res-desc">Resolution Description *</label>
                        <textarea id="res-desc" class="form-input" rows="4" placeholder="Describe the actions taken to resolve the incident…"></textarea>
                    </div>

                    <div class="form-group">
                        <label for="res-followup">Follow-Up Recommendations</label>
                        <textarea id="res-followup" class="form-input" rows="2" placeholder="Any recommendations for DPWH, LTO, or further action…"></textarea>
                    </div>

                    <div class="btn-row">
                        <button class="btn-secondary" onclick="saveDraft()">Save Draft</button>
                        <button class="btn-success" onclick="submitResolution()">Submit Resolution Report ✓</button>
                    </div>
                </div>
            </div>`;

            try {
                const draft = getAssignmentDraft(assignment.assignment_id) || JSON.parse(localStorage.getItem(`field_draft_${assignment.assignment_id}`) || 'null');
                if (draft) {
                    if (draft.method) document.getElementById('res-method').value = draft.method;
                    if (draft.equipment) document.getElementById('res-equipment').value = draft.equipment;
                    if (draft.desc) document.getElementById('res-desc').value = draft.desc;
                    if (draft.followup) document.getElementById('res-followup').value = draft.followup;
                    evidenceUploads.before = draft.before || null;
                    evidenceUploads.after = draft.after || null;
                    const beforeStatus = document.getElementById('evidence-before-status');
                    const afterStatus = document.getElementById('evidence-after-status');
                    if (beforeStatus && evidenceUploads.before) beforeStatus.textContent = 'Uploaded from draft';
                    if (afterStatus && evidenceUploads.after) afterStatus.textContent = 'Uploaded from draft';
                }
            } catch (error) {
                console.warn('Unable to load draft:', error.message);
            }

        bindDraftAutoSave();

        startJobCountdown(assignment.deadline);
        initActiveJobMap(assignment);
        startLiveTracking(checkedIn ? 'busy' : 'available');
}

function initActiveJobMap(assignment) {
    const mapEl = document.getElementById('active-job-map');
    if (!mapEl || typeof L === 'undefined') return;

    const lat = Number.parseFloat(assignment.lat);
    const lng = Number.parseFloat(assignment.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const target = hasCoords ? [lat, lng] : [14.6760, 121.0437];

    activeJobMap = L.map('active-job-map', {zoomControl: false, scrollWheelZoom: false}).setView(target, hasCoords ? 16 : 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
    }).addTo(activeJobMap);

    if (hasCoords) {
        const incidentPopup = `
            <div style="font-weight:700">${safeText(assignment.id || 'Incident')}</div>
            <div style="font-size:12px;margin-top:4px">${safeText(assignment.cat || '')} · ${safeText(assignment.brgy || '')}</div>
            <div style="font-size:12px;margin-top:6px;line-height:1.45">${safeText(assignment.desc || 'No description')}</div>
        `;
        activeJobIncidentMarker = L.marker(target)
            .addTo(activeJobMap)
            .bindPopup(incidentPopup)
            .bindTooltip('Incident location', {permanent: true, direction: 'top', offset: [0, -18], className: 'incident-pin-label'})
            .openPopup();
        const label = document.getElementById('active-job-map-label');
        if (label) label.textContent = `Incident: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    centerActiveJobMapToGps();
}

function centerActiveJobMapToGps() {
    if (!activeJobMap) {
        showToast('Map is not ready yet.');
        return;
    }

    const label = document.getElementById('active-job-map-label');
    if (label) label.textContent = 'Detecting your GPS location...';

    getCurrentPositionPromise().then(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const point = [lat, lng];

        if (activeJobOfficerMarker) {
            activeJobOfficerMarker.setLatLng(point);
        } else {
            activeJobOfficerMarker = L.marker(point).addTo(activeJobMap).bindPopup('Field officer pinned location');
        }
        activeJobMap.setView(point, 16);

        if (label) label.textContent = `Pinned: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        showToast('Your location has been pinned on the map.');
    }).catch(error => {
        if (label) label.textContent = 'GPS unavailable. Please use HTTPS (https://yourdomain) for GPS features.';
        showToast('Unable to fetch GPS location: ' + (error.message || 'Permission denied.'));
    });
}

function startJobCountdown(deadline) {
    if (fieldCountdownInterval) clearInterval(fieldCountdownInterval);
    const el = document.getElementById('job-countdown');
    const ftaEl = document.getElementById('job-fta-alert');
    if (!el) return;

    const active = getActiveAssignment();
    const useDeadline = deadline || active?.deadline || null;
    const parsedDeadline = useDeadline ? new Date(useDeadline).getTime() : NaN;
    const target = Number.isFinite(parsedDeadline) ? parsedDeadline : Date.now() + 18 * 60 * 1000 + 42000;

    fieldCountdownInterval = setInterval(() => {
        const now = Date.now();
        let diff = Math.floor((target - now) / 1000);
        if (diff <= 0) {
            el.textContent = 'OVERDUE';
            el.classList.add('urgent');
            if (ftaEl) ftaEl.classList.remove('hidden');
            clearInterval(fieldCountdownInterval);
            return;
        }
        el.textContent = fmtTime(diff);
        if (ftaEl) ftaEl.classList.toggle('hidden', diff >= 300);
    }, 1000);
}

async function attemptCheckin() {
    const assignment = getActiveAssignment();
    if (!assignment) {
        showToast('No active assignment available for check-in.');
        return;
    }

    getCurrentPositionPromise().then(async position => {
        try {
            await apiFetch('field.php', {
                action: 'checkin',
                assignment_id: assignment.assignment_id,
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            }, 'POST');
            showToast('✓ Geofence check-in confirmed.');
            await updateAssignmentStatus(assignment.assignment_id, 'en_route');
        } catch (error) {
            showToast(error.message);
        }
    }).catch(error => {
        showToast('GPS error: ' + (error.message || 'Unable to fetch your location.'));
    });
}

async function simulateArrival() {
    const assignment = getActiveAssignment();
    if (!assignment) {
        showToast('No active assignment available.');
        return;
    }

    try {
        await apiFetch('field.php', {action: 'checkin', assignment_id: assignment.assignment_id, simulate: 1}, 'POST');
        showToast('✓ Geofence check-in simulated.');
        await updateAssignmentStatus(assignment.assignment_id, 'in_progress');
    } catch (error) {
        showToast(error.message);
    }
}

async function submitResolution() {
    const assignment = getActiveAssignment();
    if (!assignment) {
        showToast('No active assignment available to submit.');
        return;
    }
    const method = document.getElementById('res-method')?.value || '';
    const desc = document.getElementById('res-desc')?.value.trim() || '';
    const equipment = document.getElementById('res-equipment')?.value.trim() || '';
    const followup = document.getElementById('res-followup')?.value.trim() || '';

    if (!method || !desc) {
        showToast('Please select a resolution method and provide a description.');
        return;
    }

    try {
        await apiFetch('field.php', {
            action: 'submitResolution',
            assignment_id: assignment.assignment_id,
            method,
            description: desc,
            equipment,
            followup,
            before_photo_url: evidenceUploads.before || '',
            after_photo_url: evidenceUploads.after || '',
        }, 'POST');
        showToast('✓ Resolution report submitted.');
        clearAssignmentDraft(assignment.assignment_id);
        activeAssignmentId = null;
        evidenceUploads = {before: null, after: null};
        await updateAssignmentStatus(assignment.assignment_id, 'resolved');
        setActivePage('history');
    } catch (error) {
        showToast(error.message);
    }
}

function chooseEvidence(stage) {
    const input = document.getElementById(`evidence-${stage}-input`);
    if (input) input.click();
}

async function handleEvidenceSelected(stage, inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById(`evidence-${stage}-status`);
    if (statusEl) statusEl.textContent = 'Uploading...';

    try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await apiFetch('media.php?action=upload_evidence', formData, 'POST');
        evidenceUploads[stage] = resp.url || '';
        if (statusEl) statusEl.textContent = `Uploaded: ${file.name}`;
        showToast(`${stage === 'before' ? 'Before' : 'After'} evidence uploaded.`);
    } catch (error) {
        if (statusEl) statusEl.textContent = 'Upload failed';
        showToast(error.message || 'Evidence upload failed.');
    }
}

function saveDraft() {
    const assignment = getActiveAssignment();
    if (!assignment) {
        showToast('No active assignment to save.');
        return;
    }

    const payload = {
        method: document.getElementById('res-method')?.value || '',
        equipment: document.getElementById('res-equipment')?.value || '',
        desc: document.getElementById('res-desc')?.value || '',
        followup: document.getElementById('res-followup')?.value || '',
        before: evidenceUploads.before || '',
        after: evidenceUploads.after || '',
    };

    persistAssignmentDraft(assignment.assignment_id, payload);
    showToast('Draft saved for this assignment.');
    renderDrafts();
    setActivePage('drafts');
}

function autoSaveDraft() {
    const assignment = getActiveAssignment();
    if (!assignment) return;

    if (draftAutosaveTimer) clearTimeout(draftAutosaveTimer);
    draftAutosaveTimer = setTimeout(() => {
        const payload = {
            method: document.getElementById('res-method')?.value || '',
            equipment: document.getElementById('res-equipment')?.value || '',
            desc: document.getElementById('res-desc')?.value || '',
            followup: document.getElementById('res-followup')?.value || '',
            before: evidenceUploads.before || '',
            after: evidenceUploads.after || '',
        };
        persistAssignmentDraft(assignment.assignment_id, payload);
    }, 300);
}

function bindDraftAutoSave() {
    ['res-method', 'res-equipment', 'res-desc', 'res-followup'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', autoSaveDraft);
        el.addEventListener('change', autoSaveDraft);
    });
}

function startLiveTracking(status = '') {
    stopLiveTracking();
    const push = () => {
        getCurrentPositionPromise().then(async position => {
            try {
                await apiFetch('field.php', {
                    action: 'updateGps',
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    status,
                }, 'POST');
            } catch (error) {
                console.warn('Live GPS update failed:', error.message);
            }
        }).catch(() => {
            /* silently ignore live GPS errors to avoid noisy UI */
        });
    };

    push();
    gpsTrackInterval = setInterval(push, 15000);
}

function stopLiveTracking() {
    if (gpsTrackInterval) {
        clearInterval(gpsTrackInterval);
        gpsTrackInterval = null;
    }
}

const baseFieldSetActivePage = window.setActivePage;
window.setActivePage = function(pageId) {
    if (typeof baseFieldSetActivePage === 'function') {
        baseFieldSetActivePage(pageId);
    }

    if (pageId === 'assigned') renderAssigned();
    if (pageId === 'job') {
        renderActiveJob();
    } else {
        stopLiveTracking();
    }
    if (pageId === 'history') renderHistory();
    if (pageId === 'performance') renderPerformance();
    if (pageId === 'drafts') renderDrafts();
    if (pageId === 'profile') renderProfile();
    if (pageId === 'messages') {
        /* On mobile: reset to contact-list view */
        const shell = document.querySelector('.messenger-shell');
        if (shell && window.innerWidth <= 768) shell.classList.remove('chat-mode');
        loadFieldContacts();
        /* Clear unread counts for active contact when returning to messages */
        if (fieldActiveContact) {
            fieldUnreadMap[String(fieldActiveContact.user_id)] = 0;
            updateMessagesNavBadge();
        }
    }
};

function renderDrafts() {
        const container = document.getElementById('drafts-list');
        if (!container) return;

        const store = getDraftStore();
        const rows = Object.entries(store)
                .map(([assignmentId, draft]) => {
                        const assignment = ASSIGNMENTS.find(item => String(item.assignment_id) === String(assignmentId));
                        const title = assignment?.id || `Assignment #${assignmentId}`;
                        const cat = assignment?.cat || 'Unassigned category';
                        const savedAt = draft?.saved_at ? formatDateTime(draft.saved_at) : 'Unknown time';
                        return {assignmentId, draft, title, cat, savedAt};
                })
                .sort((a, b) => new Date(b.draft?.saved_at || 0) - new Date(a.draft?.saved_at || 0));

        if (!rows.length) {
                container.innerHTML = `<div class="empty-state"><div class="empty-title">No saved drafts</div><div class="empty-sub">Saved resolution drafts will appear here.</div></div>`;
                return;
        }

        container.innerHTML = rows.map(row => `
            <div class="draft-card">
                <div>
                    <div class="track-id">${safeText(row.title)}</div>
                    <div class="draft-sub">${safeText(row.cat)} · Last saved: ${safeText(row.savedAt)}</div>
                </div>
                <div class="draft-actions">
                    <button class="btn-primary btn-sm" onclick="openDraftByAssignment('${safeText(row.assignmentId)}')">Open Draft</button>
                    <button class="btn-secondary btn-sm" onclick="deleteDraftByAssignment('${safeText(row.assignmentId)}')">Delete</button>
                </div>
            </div>
        `).join('');
}

function openDraftByAssignment(assignmentId) {
        activeAssignmentId = assignmentId;
        renderActiveJob();
        setActivePage('job');
}

function deleteDraftByAssignment(assignmentId) {
        clearAssignmentDraft(assignmentId);
        renderDrafts();
        showToast('Draft deleted.');
}

function renderHistory() {
    const search = (document.getElementById('history-search')?.value || '').toLowerCase();
    const closed = HISTORY_ITEMS.filter(c => !search || c.id.toLowerCase().includes(search) || c.cat.toLowerCase().includes(search));
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    if (!closed.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-title">No history found</div></div></td></tr>`;
        return;
    }

        tbody.innerHTML = closed.map(c => {
            const rawRating = Number.parseInt(c.rating, 10);
            const stars = Number.isFinite(rawRating) && rawRating > 0 ? Math.max(1, Math.min(5, rawRating)) : 0;
            const ratingHtml = stars > 0
                ? `${'<span class="rating-filled">★</span>'.repeat(stars)}${'<span class="rating-empty">★</span>'.repeat(5 - stars)}`
                : '—';

            return `
      <tr>
        <td class="track-id">${safeText(c.id)}</td>
        <td>${safeText(c.cat)}</td>
        <td>${safeText(c.brgy)}</td>
        <td>${priorityBadge(c.priority)}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="mono" style="font-size:12px">${formatDateTime(c.date)}</td>
                <td class="rating-stars" style="white-space:nowrap">${ratingHtml}</td>
            </tr>`;
        }).join('');
}

function renderPerformance() {
    const onTime = Number(PERFORMANCE_DATA.on_time_rate || 0);
    const closure = Number(PERFORMANCE_DATA.closure_rate || 0);
    const satisfaction = Number(PERFORMANCE_DATA.satisfaction || 0);

    const efficiencyEl = document.getElementById('perf-efficiency');
    const totalResolvedEl = document.getElementById('perf-total-resolved');
    const onTimeEl = document.getElementById('perf-on-time');
    const satisfactionEl = document.getElementById('perf-satisfaction');
    if (efficiencyEl) efficiencyEl.textContent = `${computeEfficiencyScore()}%`;
    if (totalResolvedEl) totalResolvedEl.textContent = `${PERFORMANCE_DATA.resolved || 0}`;
    if (onTimeEl) onTimeEl.textContent = `${Math.round(onTime)}%`;
    if (satisfactionEl) satisfactionEl.textContent = `${satisfaction.toFixed(1)}`;

    const metricsEl = document.getElementById('perf-metrics-list');
    if (metricsEl) {
        const metrics = [
                        ['Total Assignments', `${PERFORMANCE_DATA.total_assignments || 0}`],
                        ['Resolved Cases', `${PERFORMANCE_DATA.resolved || 0}`],
                        ['Resolved This Month', `${PERFORMANCE_DATA.resolved_this_month || 0}`],
                        ['Active Cases', `${PERFORMANCE_DATA.active || 0}`],
                        ['Avg. Arrival Time', `${PERFORMANCE_DATA.avg_response_mins || 0} min`],
                        ['Fastest Arrival', `${PERFORMANCE_DATA.fastest_mins || 0} min`],
                        ['Slowest Arrival', `${PERFORMANCE_DATA.slowest_mins || 0} min`],
        ];
        metricsEl.innerHTML = metrics.map(([l, v]) => `
          <div class="metric-row"><span class="metric-label">${safeText(l)}</span><span class="metric-val">${safeText(v)}</span></div>`).join('');
    }

    const kpiEl = document.getElementById('perf-kpi-bars');
    if (kpiEl) {
        const kpis = [
            ['On-Time Arrival Rate', PERFORMANCE_DATA.on_time_rate || 0],
            ['Case Closure Rate', PERFORMANCE_DATA.closure_rate || 0],
            ['User Satisfaction (x20)', (PERFORMANCE_DATA.satisfaction || 0) * 20],
        ];
        kpiEl.innerHTML = kpis.map(([l, v]) => perfBar(l, v)).join('');
    }

    const ratingsEl = document.getElementById('perf-ratings');
    if (ratingsEl) {
        const reviews = PERFORMANCE_DATA.recent_ratings || [];
        if (!reviews.length) {
            ratingsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><div class="empty-title">No ratings yet</div><div class="empty-sub">User ratings will appear here once cases are rated.</div></div>`;
            return;
        }

        ratingsEl.innerHTML = reviews.map(r => {
          const stars = Math.max(1, Math.min(5, Number.parseInt(r.score, 10) || 0));
          return `
          <div class="rating-card">
                        <div class="rating-stars">${'<span class="rating-filled">★</span>'.repeat(stars)}${'<span class="rating-empty">★</span>'.repeat(5 - stars)}</div>
            <div class="rating-quote">"${safeText(r.comments || 'No comment provided.')}"</div>
            <div class="rating-meta">${formatDateTime(r.submitted_at)} · ${safeText(r.id)}</div>
          </div>`;
                }).join('');
    }
}


function showNotification(title, message) {
    const container = document.getElementById('notif-panel') || document.querySelector('.notif-panel');
    if (!container) return;

    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = `<div class="notif-dot-inline"></div><div><div class="notif-msg">${safeText(title)}</div><div class="notif-time">${safeText(message)}</div></div>`;
    container.insertBefore(item, container.querySelector('.notif-item') || container.firstChild);

    while (container.querySelectorAll('.notif-item').length > 5) {
        container.lastChild?.remove();
    }
}

function showCaseDetailsMap(caseId) {
    const caseData = ASSIGNMENTS.find(c => c.id === caseId);
    if (!caseData) {
        showToast('Case not found.');
        return;
    }
    
        const lat = Number.parseFloat(caseData.lat);
        const lng = Number.parseFloat(caseData.lng);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        const coordText = hasCoords ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Coordinates unavailable';
    
        openModal(`
            <div class="modal-overlay" onclick="if(event.target===this){ closeModal(); if(detailsMapInstance) detailsMapInstance.remove(); detailsMapInstance=null; }">
                <div class="modal" style="max-width:620px;max-height:85vh;overflow-y:auto">
                    <div class="modal-head">
                        <div>
                            <div class="modal-title">${safeText(caseData.id)}</div>
                            <div class="modal-subtitle">${safeText(caseData.cat)}</div>
                        </div>
                        <button class="modal-close" onclick="closeModal(); if(detailsMapInstance) detailsMapInstance.remove(); detailsMapInstance=null;">✕</button>
                    </div>
                    <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            ${statusBadge(caseData.status)}
                            ${priorityBadge(caseData.priority)}
                        </div>
                    
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
                            <div><div style="color:var(--mist);text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:4px">Barangay</div><div style="font-weight:500">${safeText(caseData.brgy)}</div></div>
                            <div><div style="color:var(--mist);text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:4px">Priority</div><div style="font-weight:500">${safeText(caseData.priority)}</div></div>
                            <div><div style="color:var(--mist);text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:4px">Reported</div><div style="font-weight:500">${formatDateTime(caseData.date)}</div></div>
                            <div><div style="color:var(--mist);text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:4px">Status</div><div style="font-weight:500;text-transform:capitalize">${safeText(caseData.status)}</div></div>
                        </div>
                    
                        <div>
                            <div style="color:var(--mist);text-transform:uppercase;font-size:11px;letter-spacing:0.05em;margin-bottom:8px;font-weight:600">Description</div>
                            <div style="font-size:13px;line-height:1.6;color:var(--ink-dim)">${safeText(caseData.desc)}</div>
                        </div>
                    
                        <div style="height:280px;border-radius:8px;border:1px solid var(--border);overflow:hidden;position:relative">
                            <div id="details-case-map" style="height:100%"></div>
                        </div>
                    
                        <div style="padding:12px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">
                            <div style="font-size:11px;color:var(--mist);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Coordinates</div>
                            <div class="mono" style="font-size:13px;font-weight:500">${safeText(coordText)}</div>
                        </div>
                    
                        <button class="btn-secondary" onclick="closeModal(); if(detailsMapInstance) detailsMapInstance.remove(); detailsMapInstance=null;">Close</button>
                    </div>
                </div>
            </div>
        `);
    
    setTimeout(() => {
        if (typeof L !== 'undefined' && hasCoords) {
            const mapEl = document.getElementById('details-case-map');
            if (mapEl) {
                if (detailsMapInstance) {
                    detailsMapInstance.remove();
                    detailsMapMarker = null;
                }

                detailsMapInstance = L.map('details-case-map', {zoomControl: true, scrollWheelZoom: false}).setView([lat, lng], 16);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                    maxZoom: 19,
                }).addTo(detailsMapInstance);

                detailsMapMarker = L.marker([lat, lng]).addTo(detailsMapInstance).bindPopup(`<div style="font-weight:500">${safeText(caseData.cat)}</div><div style="font-size:12px">${safeText(caseData.id)}</div>`).openPopup();
                detailsMapInstance.invalidateSize();
            }
        }
    }, 200);
}

/* ── FIELD REASSIGN ─────────────────────────────────────────── */
let _fieldReassignOfficerId = null;

async function openFieldReassignModal(assignmentId, caseId) {
    _fieldReassignOfficerId = null;
    let officers = [];
    try {
        const resp = await apiFetch('field.php', {action: 'availableOfficers'});
        officers = resp.officers || [];
    } catch (error) {
        showToast(error.message);
        return;
    }
    if (!officers.length) {
        showToast('No available field officers at this time. All are currently busy or offline.');
        return;
    }
    const cards = officers.map(o => `
        <div class="officer-card reassign-officer-card" id="freassign-ocard-${safeText(o.id)}"
             onclick="selectFieldReassignOfficer('${safeText(o.id)}')">
            <div class="officer-name">${safeText(o.name)}</div>
            <div class="officer-meta" style="word-break:break-word">Badge: <strong>${safeText(o.code || '—')}</strong> · Brgy. ${safeText(o.brgy)}</div>
            <div style="display:flex;gap:10px;margin-top:6px;font-size:11px;font-family:var(--font-mono);color:var(--mist);flex-wrap:wrap">
                <span>● Available</span>
                <span>${Number(o.active_count) || 0} active</span>
                <span>${Number(o.cases_closed) || 0} closed</span>
            </div>
        </div>`).join('');

    openModal(`
        <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
            <div class="modal modal-lg">
                <div class="modal-head">
                    <div>
                        <div class="modal-title">Reassign Case</div>
                        <div class="modal-subtitle" style="word-break:break-all;font-size:12px">${safeText(caseId)}</div>
                    </div>
                    <button class="modal-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="section-title" style="margin-bottom:12px">Select Available Field Officer</div>
                    <div class="officer-grid reassign-grid">${cards}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
                    <button class="btn-success" onclick="submitFieldReassign('${safeText(assignmentId)}', '${safeText(caseId)}')">Reassign</button>
                </div>
            </div>
        </div>`);
}

function selectFieldReassignOfficer(officerId) {
    _fieldReassignOfficerId = officerId;
    document.querySelectorAll('.reassign-officer-card').forEach(c => c.classList.remove('selected'));
    const el = document.getElementById(`freassign-ocard-${officerId}`);
    if (el) el.classList.add('selected');
}

async function submitFieldReassign(assignmentId, caseId) {
    if (!_fieldReassignOfficerId) {
        showToast('Please select an officer first.');
        return;
    }
    closeModal();
    try {
        await apiFetch('field.php', {action: 'reassign', assignment_id: assignmentId, officer_id: _fieldReassignOfficerId}, 'POST');
        showToast(`Case ${safeText(caseId)} reassigned successfully.`);
        activeAssignmentId = null;
        await Promise.all([loadAssignedTasks(), loadHistory(), loadPerformance()]);
        renderDashboard();
        renderAssigned();
        renderActiveJob();
        renderHistory();
        renderPerformance();
    } catch (error) {
        showToast(error.message);
    }
}
