import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from './auth.mjs';
import { postJournal } from './journal.mjs';

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;

export function financeRoutes(prisma) {
  const r = Router();
  const allow = requireRole('owner', 'admin', 'finance');

  r.get('/accounts', requireAuth, allow, async (_req, res, next) => {
    try {
      const rows = await prisma.account.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
      res.json(rows.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, balance: Number(a.balance) })));
    } catch (e) { next(e); }
  });

  r.get('/journal-entries', requireAuth, allow, async (req, res, next) => {
    try {
      const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
      if (req.query.accountId && !Number.isInteger(accountId)) throw httpErr(400, 'accountId tidak valid');
      const rows = await prisma.journalEntry.findMany({
        where: accountId ? { journalLines: { some: { accountId } } } : {},
        include: { journalLines: true },
        orderBy: { id: 'desc' },
        take: 200,
      });
      res.json(rows.map((j) => {
        const td = r2(j.journalLines.reduce((a, l) => a + Number(l.debit), 0));
        const tc = r2(j.journalLines.reduce((a, l) => a + Number(l.credit), 0));
        return {
          id: j.id, entryDate: j.postedAt, referenceType: j.referenceType, reference: j.reference,
          description: j.description, status: j.status, totalDebit: td, totalCredit: tc, isBalanced: td === tc,
        };
      }));
    } catch (e) { next(e); }
  });

  // Void = tandai VOIDED + buat jurnal pembalik (debit dan kredit ditukar) + catat di audit log
  r.post('/journal-entries/:id/void', requireAuth, allow, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'ID jurnal tidak valid');
      const p = z.object({ reason: z.string().trim().min(3).max(150) }).safeParse(req.body);
      if (!p.success) throw httpErr(400, 'Alasan void minimal 3 karakter');

      await prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.findUnique({ where: { id }, include: { journalLines: true } });
        if (!entry) throw httpErr(404, 'Jurnal tidak ditemukan');
        const upd = await tx.journalEntry.updateMany({ where: { id, status: 'POSTED' }, data: { status: 'VOIDED' } });
        if (upd.count === 0) throw httpErr(409, 'Jurnal sudah di-void atau tidak berstatus POSTED');

        const reversal = await postJournal(tx, {
          referenceType: 'VOID', referenceId: entry.id,
          reference: `VOID-${entry.reference}`,
          description: `Void: ${entry.description} (${p.data.reason})`,
          createdBy: req.user.id, storeId: entry.storeId,
          lines: entry.journalLines.map((l) => ({
            accountId: l.accountId, debit: Number(l.credit), credit: Number(l.debit), description: 'Pembalikan',
          })),
        });
        await tx.auditLog.create({
          data: {
            userId: req.user.id, action: 'VOID', entity: 'JOURNAL', entityId: entry.id,
            changes: { reason: p.data.reason, reference: entry.reference, reversalId: reversal ? reversal.id : null },
            ipAddress: req.ip || null,
          },
        });
      });
      res.json({ message: 'Jurnal di-void, jurnal pembalik dibuat' });
    } catch (e) { next(e); }
  });

  return r;
}