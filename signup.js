// Citizen sign up handler
async function submitCitizenSignup() {
  const firstName = getVal('cit-firstname');
  const lastName = getVal('cit-lastname');
  const username = getVal('cit-username');
  const email = getVal('cit-email');
  const phone = getVal('cit-phone');
  const password = getVal('cit-password');
  const confirm = getVal('cit-confirm');
  const terms = document.getElementById('cit-terms') ? document.getElementById('cit-terms').checked : false;
  const privacy = document.getElementById('cit-privacy') ? document.getElementById('cit-privacy').checked : false;
  const errorEl = document.getElementById('cit-error');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }
  function clearError() {
    errorEl.classList.add('hidden');
  }

  clearError();
  if (!firstName) return showError('Please enter your first name.');
  if (!lastName) return showError('Please enter your last name.');
  if (!username) return showError('Please enter your username.');
  if (!email) return showError('Please enter your email address.');
  if (!isValidEmail(email)) return showError('Please enter a valid email address.');
  if (!phone) return showError('Please enter your phone number.');
  if (!isValidPhone(phone)) return showError('Please enter a valid phone number.');
  if (!password) return showError('Please enter your password.');
  if (!isStrongPassword(password)) return showError('Password must be at least 8 characters and include 1 uppercase and 1 number.');
  if (!confirm) return showError('Please confirm your password.');
  if (password !== confirm) return showError('Password and confirm password do not match.');
  if (!terms || !privacy) return showError('Please accept the Terms and Privacy policy.');

  const submitBtn = document.getElementById('cit-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'CREATING...';

  try {
    if (typeof apiFetch !== 'function') {
      throw new Error('System error: page not loaded correctly. Please hard-refresh (Ctrl+Shift+R) and try again.');
    }
    const payload = {
      role: 'regular',
      username,
      phone,
      password,
      email,
      first_name: firstName,
      last_name: lastName
    };
    await apiFetch('register.php', payload, 'POST');
    sessionStorage.setItem('citizen_signup_notice', '1');
    window.location.href = '/citizen-login.html?registered=1';
    return;
  } catch (error) {
    showError(error?.message || 'Unable to submit registration right now.');
  }
  submitBtn.textContent = 'CREATE ACCOUNT →';
  updateSubmitState();
}
/* ============================================================
   TRAPICO — Dispatch Sign-Up Logic
   ============================================================ */
'use strict';

let suOpenDropdown = null;
let suModalType = null;
const signupRole = document.body?.dataset?.role || 'dispatch';

const LEGAL_TEXT_BY_ROLE = {
  regular: {
    terms: {
      head: 'TERMS AND CONDITIONS',
      body: 'Welcome to TRAPICO. By using this system, you agree to provide accurate traffic reports. Misuse of the platform or filing false reports may lead to account suspension and legal action under Quezon City traffic ordinances.',
    },
    privacy: {
      head: 'PRIVACY POLICY',
      body: 'We value your privacy. TRAPICO collects officer identification and location data strictly for incident validation. Your personal information is encrypted and will not be shared with third parties without your explicit consent.',
    },
  },
  dispatch: {
    terms: {
      head: 'TERMS AND CONDITIONS',
      body: 'By creating an account, you agree to use TRAPICO only for official traffic operations and to provide accurate information. False reports, unauthorized access, or misuse of this system may result in account suspension and legal action.',
    },
    privacy: {
      head: 'PRIVACY POLICY',
      body: 'TRAPICO collects your account, contact, and assignment data strictly for dispatch operations. Your information is stored securely and processed only for system functionality and authorized government use.',
    },
  },
  field: {
    terms: {
      head: 'TERMS AND CONDITIONS',
      body: 'By creating an account, you agree to use TRAPICO only for official traffic operations and to provide accurate information. False reports, unauthorized access, or misuse of this system may result in account suspension and legal action.',
    },
    privacy: {
      head: 'PRIVACY POLICY',
      body: 'TRAPICO collects your account, contact, and assignment data strictly for field operations. Your information is stored securely and processed only for system functionality and authorized government use.',
    },
  },
};

const LEGAL_TEXT = LEGAL_TEXT_BY_ROLE[signupRole] || LEGAL_TEXT_BY_ROLE.dispatch;

function hasEnhancedOfficerFields() {
  return (signupRole === 'dispatch' || signupRole === 'field') && !!document.getElementById('dis-employeeid');
}

function hasEnhancedCitizenFields() {
  return signupRole === 'regular' && !!document.getElementById('dis-firstname') && !!document.getElementById('dis-email');
}

function toggleSuPassword(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;

  const showing = input.type === 'text';

  input.type = showing ? 'password' : 'text';
  toggle.classList.toggle('is-visible', !showing);

  const isConfirm = inputId === 'dis-confirm';
  if (showing) {
    toggle.setAttribute('aria-label', isConfirm ? 'Show confirm password' : 'Show password');
  } else {
    toggle.setAttribute('aria-label', isConfirm ? 'Hide confirm password' : 'Hide password');
  }
}

function toggleDropdown(id) {
  const list = document.getElementById(`${id}-list`);
  const btn = document.getElementById(`${id}-btn`);
  const isOpen = !list.classList.contains('hidden');

  closeOpenDropdown();

  if (!isOpen) {
    list.classList.remove('hidden');
    btn.classList.add('su-open');
    btn.setAttribute('aria-expanded', 'true');
    suOpenDropdown = id;
  }
}

function closeOpenDropdown() {
  if (!suOpenDropdown) return;
  const list = document.getElementById(`${suOpenDropdown}-list`);
  const btn = document.getElementById(`${suOpenDropdown}-btn`);
  if (list) list.classList.add('hidden');
  if (btn) {
    btn.classList.remove('su-open');
    btn.setAttribute('aria-expanded', 'false');
  }
  suOpenDropdown = null;
}

function selectOption(id, value) {
  document.getElementById(`${id}-val`).textContent = value;
  document.getElementById(`${id}-input`).value = value;
  document.getElementById(`${id}-btn`).classList.add('su-has-value');

  const list = document.getElementById(`${id}-list`);
  list.querySelectorAll('.su-option').forEach(opt => {
    opt.classList.toggle('su-option-selected', opt.textContent.trim() === value);
  });

  closeOpenDropdown();
  updateSubmitState();
}

document.addEventListener('click', e => {
  if (!suOpenDropdown) return;
  const wrap = document.getElementById(`${suOpenDropdown}-wrap`);
  if (wrap && !wrap.contains(e.target)) closeOpenDropdown();
});

function openLegalModal(type) {
  suModalType = type;
  const content = LEGAL_TEXT[type];

  document.getElementById('legal-modal-head').textContent = content.head;
  const body = document.getElementById('legal-modal-body');
  body.style.whiteSpace = 'normal';
  body.textContent = content.body;

  document.getElementById('legal-backdrop').classList.remove('hidden');
}

function closeLegalModal() {
  document.getElementById('legal-backdrop').classList.add('hidden');
  suModalType = null;
}

function acceptModal() {
  // Support both citizen and officer/dispatch forms
  let checkbox = null;
  if (suModalType === 'terms') {
    let el;
    if ((el = document.getElementById('dis-terms'))) {
      el.checked = true;
      checkbox = el;
    }
    if ((el = document.getElementById('cit-terms'))) {
      el.checked = true;
      checkbox = el;
    }
  }
  if (suModalType === 'privacy') {
    let el;
    if ((el = document.getElementById('dis-privacy'))) {
      el.checked = true;
      checkbox = el;
    }
    if ((el = document.getElementById('cit-privacy'))) {
      el.checked = true;
      checkbox = el;
    }
  }
  closeLegalModal();
  if (checkbox) {
    checkbox.scrollIntoView({behavior: 'smooth', block: 'center'});
    checkbox.classList.add('highlight-checkbox');
    setTimeout(() => checkbox.classList.remove('highlight-checkbox'), 1200);
  }
  updateSubmitState();
}

function handleBackdropClick(e) {
  if (e.target === e.currentTarget) closeLegalModal();
}

function getVal(id) {
  return (document.getElementById(id)?.value ?? '').trim();
}

function isStrongPassword(password) {
  return password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return phone.replace(/\D/g, '').length >= 10;
}

function getBarangayValue() {
  const nativeSelect = document.getElementById('dis-brgy');
  if (nativeSelect) return nativeSelect.value.trim();
  return getVal('dis-brgy-input');
}

function showError(message) {
  const errorEl = document.getElementById('dis-error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function clearError() {
  document.getElementById('dis-error').classList.add('hidden');
}

function isFormReady() {
  // Detect which form is present: citizen or officer/dispatch
  const citizenForm = document.getElementById('citizen-signup');
  if (citizenForm) {
    // Citizen form fields
    const firstName = getVal('cit-firstname');
    const lastName = getVal('cit-lastname');
    const username = getVal('cit-username');
    const email = getVal('cit-email');
    const phone = getVal('cit-phone');
    const password = getVal('cit-password');
    const confirm = getVal('cit-confirm');
    const terms = document.getElementById('cit-terms') ? document.getElementById('cit-terms').checked : false;
    const privacy = document.getElementById('cit-privacy') ? document.getElementById('cit-privacy').checked : false;
    return !!(firstName && lastName && username && email && phone && password && confirm && terms && privacy);
  }
  // Officer/dispatch form (default)
  const enhancedOfficer = hasEnhancedOfficerFields();
  const enhancedCitizen = hasEnhancedCitizenFields();
  const username = getVal('dis-username');
  const phone = getVal('dis-phone');
  const barangay = getBarangayValue();
  const password = getVal('dis-password');
  const confirm = getVal('dis-confirm');
  const terms = document.getElementById('dis-terms') ? document.getElementById('dis-terms').checked : false;
  const privacy = document.getElementById('dis-privacy') ? document.getElementById('dis-privacy').checked : false;
  if (!enhancedOfficer && !enhancedCitizen) {
    return !!(username && phone && barangay && password && confirm && terms && privacy);
  }
  const firstName = getVal('dis-firstname');
  const lastName = getVal('dis-lastname');
  const employeeId = getVal('dis-employeeid');
  const badgeId = getVal('dis-badgeid');
  const department = getVal('dis-department');
  const email = getVal('dis-email');
  if (enhancedCitizen) {
    return !!(
      firstName &&
      lastName &&
      username &&
      email &&
      phone &&
      barangay &&
      password &&
      confirm &&
      terms &&
      privacy
    );
  }
  return !!(
    firstName &&
    lastName &&
    employeeId &&
    badgeId &&
    department &&
    username &&
    barangay &&
    email &&
    phone &&
    password &&
    confirm &&
    terms &&
    privacy
  );
}

function updateSubmitState() {
  // Support both citizen and officer/dispatch forms
  const citizenBtn = document.getElementById('cit-submit');
  const officerBtn = document.getElementById('dis-submit');
  const enabled = isFormReady();
  if (citizenBtn) {
    citizenBtn.disabled = !enabled;
    citizenBtn.classList.toggle('su-submit-enabled', enabled);
    citizenBtn.classList.toggle('su-submit-disabled', !enabled);
  }
  if (officerBtn) {
    officerBtn.disabled = !enabled;
    officerBtn.classList.toggle('su-submit-enabled', enabled);
    officerBtn.classList.toggle('su-submit-disabled', !enabled);
  }
}

async function submitDispatchSignup() {
  clearError();

  const enhancedOfficer = hasEnhancedOfficerFields();
  const enhancedCitizen = hasEnhancedCitizenFields();

  const firstName = getVal('dis-firstname');
  const lastName = getVal('dis-lastname');
  const employeeId = getVal('dis-employeeid');
  const badgeId = getVal('dis-badgeid');
  const department = getVal('dis-department');
  const username = getVal('dis-username');
  const email = getVal('dis-email');
  const phone = getVal('dis-phone');
  const barangay = getBarangayValue();
  const password = getVal('dis-password');
  const confirm = getVal('dis-confirm');

  if (enhancedOfficer) {
    if (!firstName) return showError('Please enter your first name.');
    if (!lastName) return showError('Please enter your last name.');
    if (!employeeId) return showError('Please enter your employee ID.');
    if (!badgeId) return showError('Please enter your badge ID.');
    if (!department) return showError('Please enter your department.');
    if (!email) return showError('Please enter your email address.');
    if (!isValidEmail(email)) return showError('Please enter a valid email address.');
  }

  if (enhancedCitizen) {
    if (!firstName) return showError('Please enter your first name.');
    if (!lastName) return showError('Please enter your last name.');
    if (!email) return showError('Please enter your email address.');
    if (!isValidEmail(email)) return showError('Please enter a valid email address.');
  }

  if (!username) return showError('Please enter your username.');
  if (!phone) return showError('Please enter your phone number.');
  if (!isValidPhone(phone)) return showError('Please enter a valid phone number.');
  if (!barangay) return showError('Please select your barangay.');
  if (!isStrongPassword(password)) return showError('Password must be at least 8 characters and include 1 uppercase and 1 number.');
  if (password !== confirm) return showError('Password and confirm password do not match.');
  if ((document.getElementById('dis-terms') && !document.getElementById('dis-terms').checked) || (document.getElementById('dis-privacy') && !document.getElementById('dis-privacy').checked)) {
    return showError('Please accept the Terms and Privacy policy.');
  }

  const submitBtn = document.getElementById('dis-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'CREATING...';


  try {
    if (typeof apiFetch !== 'function') {
      throw new Error('System error: page not loaded correctly. Please hard-refresh (Ctrl+Shift+R) and try again.');
    }
    // Build payload based on role
    let payload = {
      role: signupRole,
      username,
      phone: phone, // always send as 'phone' for backend
      home_barangay: barangay,
      password,
      email,
      first_name: firstName,
      last_name: lastName
    };

    if (signupRole === 'dispatch') {
      payload = {
        ...payload,
        badge_id: badgeId,
        department
      };
    } else if (signupRole === 'field') {
      payload = {
        ...payload,
        badge_id: badgeId,
        department
      };
    }

    await apiFetch('register.php', payload, 'POST');

    if (enhancedCitizen) {
      sessionStorage.setItem('citizen_signup_notice', '1');
    }

    const signInRoutes = {
      dispatch: '/dispatch-login.html?registered=1',
      field: '/field-login.html?registered=1',
      regular: '/citizen-login.html?registered=1',
    };
    window.location.href = signInRoutes[signupRole] || '/index.html?registered=1';
    return;
  } catch (error) {
    showError(error?.message || 'Unable to submit registration right now.');
  }

  submitBtn.textContent = 'CREATE ACCOUNT →';
  updateSubmitState();
}

function bindSignupFormSubmit() {
  const form = document.getElementById('dispatch-signup');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    submitDispatchSignup();
  });
}

document.addEventListener('input', updateSubmitState);
document.addEventListener('change', updateSubmitState);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeOpenDropdown();
    closeLegalModal();
  }

  if (e.key === 'Enter' && !document.getElementById('dis-submit').disabled) {
    submitDispatchSignup();
  }
});

bindSignupFormSubmit();
updateSubmitState();
