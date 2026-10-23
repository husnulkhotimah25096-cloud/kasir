import jwt from 'jsonwebtoken';

const ROLE_OUT = { OWNER: 'owner', ADMIN: 'admin', KASIR: 'kasir', GUDANG: 'gudang', FINANCE: 'finance', PEMBELIAN: 'pembeli' };
export const roleOut = (r) => ROLE_OUT[r] || String(r).toLowerCase();

const secret = () => {
  if (!process.env.JWT_SECRET) throw Object.assign(new Error('JWT_SECRET belum diset'), { status: 500 });
  return process.env.JWT_SECRET;
};

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: roleOut(user.role), name: user.name }, secret(), { expiresIn: '8h' });
}

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(Object.assign(new Error('Token tidak ada'), { status: 401 }));
  try {
    const p = jwt.verify(token, secret());
    req.user = { id: p.sub, role: p.role, name: p.name };
    next();
  } catch {
    next(Object.assign(new Error('Token tidak valid atau kedaluwarsa'), { status: 401 }));
  }
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(Object.assign(new Error('Akses ditolak untuk role ini'), { status: 403 }));