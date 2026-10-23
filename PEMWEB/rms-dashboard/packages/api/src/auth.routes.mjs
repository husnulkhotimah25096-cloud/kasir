import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { signToken, roleOut, requireAuth } from './auth.mjs';

export function authRoutes(prisma) {
  const r = Router();
  const body = z.object({ username: z.string().min(1), password: z.string().min(1) });

  r.post('/login', async (req, res, next) => {
    try {
      const parsed = body.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'Username dan password wajib diisi' });
      const { username, password } = parsed.data;
      const user = await prisma.user.findUnique({ where: { username } });
      const ok = user && (await bcrypt.compare(password, user.password));
      if (!ok) return res.status(401).json({ message: 'Username atau password salah' });
      res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: roleOut(user.role) } });
    } catch (e) { next(e); }
  });

  r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  return r;
}