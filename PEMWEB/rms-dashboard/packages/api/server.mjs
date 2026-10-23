import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const api = express.Router();

api.get('/health', async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const users = await prisma.user.count();
    res.json({ status: 'ok', db: 'up', users });
  } catch (e) {
    next(e);
  }
});

app.use('/api/v1', api);

app.use((_req, res) => res.status(404).json({ message: 'Endpoint tidak ditemukan' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Kesalahan server' });
});

const PORT = process.env.API_PORT || 8000;
app.listen(PORT, () => console.log(`API berjalan di http://localhost:${PORT}/api/v1`));