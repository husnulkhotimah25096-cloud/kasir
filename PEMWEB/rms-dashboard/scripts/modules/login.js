// ========================================
// RMS — Login & menu akun
// Kontrak API: POST /auth/login { username, password }
//   -> { token, user: { id, name, role } }
// Role: owner | admin | kasir | gudang | finance | pembeli
// ========================================

import { apiPost, setAuthToken } from '../utils/api.js';
import { setUser, getUser, logout } from '../utils/auth.js';
import { showToast } from '../utils/ui.js';
import { esc } from '../utils/state.js';

export function showLogin(onSuccess) {
  if (document.getElementById('login-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <form id="login-form" style="background:var(--color-surface,#fff);color:var(--color-text,#111);padding:2rem;border-radius:8px;width:min(340px,90vw);display:grid;gap:.75rem;">
      <h2 style="margin:0">Masuk ke RMS</h2>
      <label>Username <input name="username" autocomplete="username" required style="width:100%;padding:.5rem;"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" required style="width:100%;padding:.5rem;"></label>
      <p id="login-error" style="color:var(--color-danger,#ef4444);margin:0;min-height:1.2em;"></p>
      <button class="btn" type="submit">Masuk</button>
    </form>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#login-form');
  const errorEl = overlay.querySelector('#login-error');
  form.username.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const { token, user } = await apiPost('/auth/login', {
        username: form.username.value.trim(),
        password: form.password.value
      });
      if (!token || !user?.role) throw new Error('Respons login tidak valid');
      setAuthToken(token);
      setUser({ ...user, token });
      overlay.remove();
      onSuccess({ ...user, token });
    } catch (err) {
      errorEl.textContent = err.status === 401 ? 'Username atau password salah' : `Gagal masuk: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  });
}

// Tampilkan nama/role + tombol keluar di navbar
export function setupAccountMenu() {
  const user = getUser();
  const bar = document.querySelector('.navbar > div[style*="margin-left"]');
  if (!user || !bar || bar.querySelector('#account-menu')) return;

  const wrap = document.createElement('span');
  wrap.id = 'account-menu';
  wrap.style.cssText = 'display:flex;gap:.5rem;align-items:center;font-size:.85rem;';
  wrap.innerHTML = `<span>${esc(user.name || 'User')} (${esc(user.role)})</span><button class="btn btn-small btn-secondary" type="button" id="logout-btn">Keluar</button>`;
  bar.prepend(wrap);
  wrap.querySelector('#logout-btn').addEventListener('click', () => {
    logout();
    showToast('Anda telah keluar', 'info');
    location.reload();
  });
}
