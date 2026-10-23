// ========================================
// Auth Module — JWT & RBAC Handling
// ========================================

import { setAuthToken, clearAuthToken } from './api.js';

// Simpan user info ke localStorage setelah login
export function setUser(user) {
  localStorage.setItem('rms_user', JSON.stringify(user));
}

// Ambil user info dari localStorage
export function getUser() {
  const stored = localStorage.getItem('rms_user');
  return stored ? JSON.parse(stored) : null;
}

// Cek apakah user punya role tertentu
export function hasRole(...roles) {
  const user = getUser();
  if (!user) return false;
  return roles.some((role) => user.role === role);
}

// Cek apakah user boleh akses modul tertentu
export function canAccessModule(moduleKey) {
  const user = getUser();
  if (!user) return false;
  
  const modules = {
    dashboard: ['owner', 'admin', 'kasir', 'finance'],
    pos: ['owner', 'admin', 'kasir'],
    inventory: ['owner', 'admin', 'gudang', 'finance'],
    finance: ['owner', 'admin', 'finance'],
    analytics: ['owner', 'admin'],
  };
  
  const allowed = modules[moduleKey] || [];
  return allowed.includes(user.role);
}

// Logout cleanup
export function logout() {
  clearAuthToken();
  localStorage.removeItem('rms_user');
}

// Middleware untuk tombol/nav tombol RBAC
export function requireRole(...allowedRoles) {
  return (element) => {
    if (!hasRole(...allowedRoles)) {
      element.style.display = 'none';
      return;
    }
    element.style.display = '';
  };
}