/* ===========================
   Auth JS — Login & Register
   =========================== */

// ---- Utility ----
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; }
}
function clearError(id) {
  const el = document.getElementById(id);
  if (el) { el.textContent = ''; }
}

function setLoading(btnId, spinnerId, textId, loading) {
  const btn     = document.getElementById(btnId);
  const spinner = document.getElementById(spinnerId);
  const text    = document.getElementById(textId);
  if (!btn) return;
  btn.disabled = loading;
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
  if (text)    text.style.display    = loading ? 'none' : 'inline';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---- Toggle password visibility ----
function setupPasswordToggle(toggleId, inputId) {
  const btn = document.getElementById(toggleId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = isHidden
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  });
}

// ---- Password Strength ----
function getPasswordStrength(pwd) {
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return score;
}

function updateStrengthUI(pwd) {
  const wrap  = document.getElementById('password-strength');
  const label = document.getElementById('strength-label');
  const bars  = ['sb1','sb2','sb3','sb4'].map(id => document.getElementById(id));
  if (!wrap || !label || bars.some(b => !b)) return;

  if (!pwd) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const score = getPasswordStrength(pwd);
  const configs = [
    { label: 'Very Weak', color: '#ef4444' },
    { label: 'Weak',      color: '#f59e0b' },
    { label: 'Good',      color: '#3b82f6' },
    { label: 'Strong',    color: '#10b981' },
  ];
  const cfg = configs[score - 1] || { label: 'Very Weak', color: '#ef4444' };
  label.textContent = cfg.label;
  label.style.color = cfg.color;
  bars.forEach((bar, i) => {
    bar.style.background = i < score ? cfg.color : 'rgba(255,255,255,0.08)';
  });
}

// ---- Login Form ----
const loginForm = document.getElementById('login-form');
if (loginForm) {
  setupPasswordToggle('toggle-login-pwd', 'login-password');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('email-error');
    clearError('password-error');

    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    let valid   = true;

    if (!email || !isValidEmail(email)) {
      showError('email-error', 'Please enter a valid email address.');
      valid = false;
    }
    if (!pass || pass.length < 8) {
      showError('password-error', 'Password must be at least 8 characters.');
      valid = false;
    }
    if (!valid) return;

    setLoading('login-submit-btn', 'login-spinner', 'login-btn-text', true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password: pass })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed.');
      }

      const name = data.user.lastName ? `${data.user.firstName} ${data.user.lastName}` : data.user.firstName;
      sessionStorage.setItem('ls_user', JSON.stringify({ email: data.user.email, name }));
      window.location.href = 'dashboard.html';
    } catch (err) {
      showError('password-error', err.message);
    } finally {
      setLoading('login-submit-btn', 'login-spinner', 'login-btn-text', false);
    }
  });

  // Real-time validation
  document.getElementById('login-email').addEventListener('blur', () => {
    const email = document.getElementById('login-email').value.trim();
    if (email && !isValidEmail(email)) showError('email-error', 'Invalid email format.');
    else clearError('email-error');
  });
}

// ---- Register Form ----
const registerForm = document.getElementById('register-form');
if (registerForm) {
  setupPasswordToggle('toggle-reg-pwd', 'reg-password');
  setupPasswordToggle('toggle-confirm-pwd', 'reg-confirm');

  document.getElementById('reg-password').addEventListener('input', (e) => {
    updateStrengthUI(e.target.value);
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError('firstname-error');
    clearError('reg-email-error');
    clearError('reg-password-error');
    clearError('confirm-error');

    const firstname = document.getElementById('reg-firstname').value.trim();
    const lastname  = document.getElementById('reg-lastname').value.trim();
    const email     = document.getElementById('reg-email').value.trim();
    const pass      = document.getElementById('reg-password').value;
    const confirm   = document.getElementById('reg-confirm').value;
    const terms     = document.getElementById('terms-check').checked;
    let valid = true;

    if (!firstname) { showError('firstname-error', 'First name is required.'); valid = false; }
    if (!email || !isValidEmail(email)) { showError('reg-email-error', 'Valid email required.'); valid = false; }
    if (!pass || pass.length < 8) { showError('reg-password-error', 'Min. 8 characters required.'); valid = false; }
    if (pass !== confirm) { showError('confirm-error', 'Passwords do not match.'); valid = false; }
    if (!terms) { alert('Please accept the Terms of Service to continue.'); valid = false; }
    if (!valid) return;

    setLoading('register-submit-btn', 'register-spinner', 'register-btn-text', true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ firstName: firstname, lastName: lastname, email, password: pass })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed.');
      }

      const name = data.user.lastName ? `${data.user.firstName} ${data.user.lastName}` : data.user.firstName;
      sessionStorage.setItem('ls_user', JSON.stringify({ email: data.user.email, name }));
      window.location.href = 'dashboard.html';
    } catch (err) {
      showError('reg-password-error', err.message);
    } finally {
      setLoading('register-submit-btn', 'register-spinner', 'register-btn-text', false);
    }
  });
}

// Demo social buttons (act as fully authenticated demo accounts)
['google-login-btn', 'github-login-btn', 'google-reg-btn', 'github-reg-btn'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/auth/demo', {
          method: 'POST'
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Demo login failed.');
        }
        const name = data.user.lastName ? `${data.user.firstName} ${data.user.lastName}` : data.user.firstName;
        sessionStorage.setItem('ls_user', JSON.stringify({ email: data.user.email, name }));
        window.location.href = 'dashboard.html';
      } catch (err) {
        alert(err.message);
      }
    });
  }
});
