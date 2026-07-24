// functions/api/[[path]].js
// Smart Wealth Tracker — Cloudflare Pages Function (Refactored v2)
// Storage: Cloudflare D1 (primary) + R2 (images) + KV (sessions/fallback)

import {
  hashPassword, verifyPassword, generateToken,
  createSession, validateSession, deleteSession,
  checkAndRecordFailedLogin, resetFailedAttempts,
  extractToken, getUserByUsername, getUserById,
  generateId, nowISO,
} from './lib/auth.js';

import {
  getAccounts, getAccountById, createAccount, updateAccount, deleteAccount, restoreAccount,
  calculateBalances,
  getCategories, getCategoryById, createCategory, updateCategory, deleteCategory, restoreCategory,
  getTransactions, getTransactionById, createTransaction, updateTransaction,
  softDeleteTransaction, restoreTransaction,
  getSetting, setSetting, getAllSettings,
  getUsers, createUser, updateUserPassword, toggleUserActive,
  exportAllData, getTrash, getAuditLogs, getDashboardStats,
} from './lib/db.js';

import { writeAudit, requestInfo } from './lib/audit.js';
import { validateTransaction, validateAccount, validateCategory, validateBackup, sanitize } from './lib/validator.js';
import { uploadFile, serveFile, deleteFile } from './lib/storage.js';
import { detectBackupVersion, importBackupV1, exportBackupV1, recordBackup } from './lib/backup.js';
import { sendLineReport, buildDailyReport, buildMonthlyReport } from './lib/report.js';

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extraHeaders },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const db  = env.DB;          // D1 database
  const url = new URL(request.url);

  // Strip /api prefix
  const path   = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const method = request.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // File serving (public, no auth needed)
  if (path.startsWith('/uploads/')) {
    const filename = path.replace('/uploads/', '');
    return serveFile(env, filename);
  }

  try {
    // ── PUBLIC ROUTES (no auth) ─────────────────────────────────────────────
    if (path === '/login' && method === 'POST') {
      return handleLogin(db, request, env);
    }
    if (path === '/health' && method === 'GET') {
      return json({ status: 'ok', version: '2.0.0', time: nowISO() });
    }

    // ── LOCAL DEV ONLY: init DB + admin user ─────────────────────────────────
    // เรียก POST /api/init-local เพื่อสร้าง tables + admin user ใน local D1
    // ใช้ได้เฉพาะ local dev (CF_PAGES_BRANCH === 'local') เท่านั้น
    if (path === '/init-local' && method === 'POST') {
      if (env.CF_PAGES_BRANCH !== 'local') {
        return err('This endpoint is only available in local development', 403);
      }
      try {
        // If ?reset=1 is passed, drop all tables first
        const reset = url.searchParams.get('reset') === '1';
        if (reset) {
          const dropTables = ['users', 'sessions', 'accounts', 'categories', 'transactions', 'settings', 'backup_history', 'audit_logs', 'failed_logins', 'schema_versions'];
          for (const tbl of dropTables) {
            await db.prepare(`DROP TABLE IF EXISTS ${tbl}`).run();
          }
        } else {
          // Check if sessions table has 'id' column, drop if obsolete
          try {
            await db.prepare(`SELECT id FROM sessions LIMIT 1`).all();
          } catch (e) {
            if (e.message.includes('no such column') || e.message.includes('no such table')) {
              await db.prepare(`DROP TABLE IF EXISTS sessions`).run();
            }
          }
        }

        // Create all tables (IF NOT EXISTS — safe to call multiple times)
        const schema = `
          CREATE TABLE IF NOT EXISTS schema_versions (
            version INTEGER PRIMARY KEY, description TEXT, applied_at TEXT DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
            is_active INTEGER NOT NULL DEFAULT 1,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT, last_login_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            user_agent TEXT, ip_address TEXT,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'bank',
            bank_name TEXT, initial_balance REAL DEFAULT 0, color TEXT,
            created_by TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
            icon TEXT, color TEXT, created_by TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL,
            sub_type TEXT, pos_machine TEXT, pos_shift TEXT,
            customer_count INTEGER DEFAULT 0, document_total_amount REAL DEFAULT 0, cn_amount REAL DEFAULT 0,
            category_name TEXT, category_id TEXT, amount REAL NOT NULL,
            payment_method TEXT, account_id TEXT, document_number TEXT, notes TEXT, slip_url TEXT,
            status TEXT DEFAULT 'paid', transfer_tx_id TEXT, created_by TEXT,
            created_at TEXT, updated_at TEXT, deleted_at TEXT
          );
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
          );
          CREATE TABLE IF NOT EXISTS backup_history (
            id TEXT PRIMARY KEY, status TEXT, storage_path TEXT,
            file_size INTEGER, checksum TEXT, error_message TEXT,
            user_id TEXT, counts TEXT, created_at TEXT
          );
          CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY, user_id TEXT, username TEXT,
            action TEXT, resource TEXT, resource_id TEXT,
            old_data TEXT, new_data TEXT, ip_address TEXT,
            user_agent TEXT, created_at TEXT
          );
          CREATE TABLE IF NOT EXISTS failed_logins (
            ip TEXT PRIMARY KEY, attempts INTEGER DEFAULT 0, last_attempt TEXT
          )
        `;
        // Execute each statement
        for (const stmt of schema.split(';').map(s => s.trim()).filter(s => s.length > 5)) {
          await db.prepare(stmt).run();
        }
        // ALTER TABLE: add missing columns to existing tables (idempotent — ignore errors)
        const migrations = [
          `ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`,
          `ALTER TABLE users ADD COLUMN locked_until TEXT`,
          `ALTER TABLE users ADD COLUMN last_login_at TEXT`,
          `ALTER TABLE transactions ADD COLUMN transfer_tx_id TEXT`,
          `ALTER TABLE transactions ADD COLUMN due_date TEXT`,
          `ALTER TABLE transactions ADD COLUMN document_number TEXT`,
          `ALTER TABLE transactions ADD COLUMN sub_type TEXT`,
          `ALTER TABLE transactions ADD COLUMN pos_machine TEXT`,
          `ALTER TABLE transactions ADD COLUMN pos_shift TEXT`,
          `ALTER TABLE transactions ADD COLUMN pos_time TEXT`,
          `ALTER TABLE transactions ADD COLUMN document_code TEXT`,
          `ALTER TABLE transactions ADD COLUMN cash_amount REAL DEFAULT 0`,
          `ALTER TABLE transactions ADD COLUMN cash_account_id TEXT`,
          `ALTER TABLE transactions ADD COLUMN transfer_amount REAL DEFAULT 0`,
          `ALTER TABLE transactions ADD COLUMN transfer_account_id TEXT`,
          `ALTER TABLE transactions ADD COLUMN coupon_amount REAL DEFAULT 0`,
          `ALTER TABLE transactions ADD COLUMN coupon_account_id TEXT`,
          `ALTER TABLE transactions ADD COLUMN has_discrepancy INTEGER DEFAULT 0`,
          `ALTER TABLE transactions ADD COLUMN customer_count INTEGER DEFAULT 0`,
          `ALTER TABLE transactions ADD COLUMN document_total_amount REAL DEFAULT 0`,
          `ALTER TABLE transactions ADD COLUMN cn_amount REAL DEFAULT 0`,
        ];
        for (const m of migrations) {
          try { await db.prepare(m).run(); } catch (_) { /* column already exists = ok */ }
        }
        // Create admin user if not exists
        const existing = await db.prepare(`SELECT id FROM users WHERE username='admin'`).first();
        if (!existing) {
          const hash = await hashPassword('Htmsxzs7');
          const now  = nowISO();
          await db.prepare(
            `INSERT OR IGNORE INTO users (id,username,password_hash,role,is_active,created_at,updated_at)
             VALUES ('user-admin-001','admin',?,'admin',1,?,?)`
          ).bind(hash, now, now).run();
        }
        const userCount = (await db.prepare(`SELECT COUNT(*) as c FROM users`).first()).c;
        return json({ message: `✅ Local DB initialized! Tables created. Users: ${userCount}`, adminCreated: !existing });
      } catch (initErr) {
        return json({ error: initErr.message }, 500);
      }
    }

    // ── ONE-TIME SETUP: create admin user ────────────────────────────────────
    // Called ONCE during first-time setup. Protected by SETUP_TOKEN env secret.
    // After first use, remove SETUP_TOKEN from Cloudflare dashboard.
    if (path === '/init-admin' && method === 'POST') {
      const setupToken = env.SETUP_TOKEN;
      if (!setupToken) return err('SETUP_TOKEN not configured', 403);

      const body = await request.json().catch(() => ({}));
      if (body.setupToken !== setupToken) return err('Invalid setup token', 403);

      const username = body.username || 'admin';
      const password = body.password || 'Htmsxzs7';

      // Check if admin already exists
      const existing = await getUserByUsername(db, username);
      if (existing) return err(`User "${username}" already exists`, 400);

      const passwordHash = await hashPassword(password);
      const id           = 'user-admin-001';
      const now          = nowISO();

      await db.prepare(
        `INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', 1, ?, ?)`
      ).bind(id, username, passwordHash, now, now).run();

      return json({ message: `Admin user "${username}" created successfully. Remove SETUP_TOKEN from env now.` }, 201);
    }

    // ── TEST: Send LINE Notify ping (admin only, after auth) ─────────────────
    // เรียก: POST /api/test-line  (ต้องล็อกอินก่อน)
    // ใช้ทดสอบว่า LINE Notify token ถูกต้องไหม

    // ── AUTHENTICATE ────────────────────────────────────────────────────────
    const token   = extractToken(request);
    const session = await validateSession(db, token);

    if (!session) {
      return err('Unauthorized: กรุณาเข้าสู่ระบบ', 401);
    }

    const info = requestInfo(request);

    // ── ACCOUNTS ─────────────────────────────────────────────────────────────
    if (path === '/accounts') {
      if (method === 'GET') {
        const accounts = await calculateBalances(db);
        const filtered = accounts.filter(a => a.id !== 'acc-unspecified');
        return json(filtered);
      }
      if (method === 'POST') {
        const body   = await request.json();
        const errors = validateAccount(body);
        if (errors.length) return json({ errors }, 422);

        const id  = 'acc-' + Date.now();
        const acc = await createAccount(db, { id, ...body });
        await writeAudit(db, { ...session, action: 'create', resource: 'account', resourceId: id, newData: acc, ...info });
        return json(acc, 201);
      }
    }

    if (path.startsWith('/accounts/')) {
      const id = path.split('/')[2];
      if (method === 'PUT') {
        const body    = await request.json();
        const errors  = validateAccount(body);
        if (errors.length) return json({ errors }, 422);
        const oldData = await getAccountById(db, id);
        if (!oldData) return err('ไม่พบบัญชี', 404);
        const updated = await updateAccount(db, id, body);
        await writeAudit(db, { ...session, action: 'update', resource: 'account', resourceId: id, oldData, newData: updated, ...info });
        return json(updated);
      }
      if (method === 'DELETE') {
        if (id === 'acc-cash') return err('ไม่สามารถลบบัญชีเงินสดหลักได้', 400);
        const oldData = await getAccountById(db, id);
        if (!oldData) return err('ไม่พบบัญชี', 404);
        await deleteAccount(db, id);
        await writeAudit(db, { ...session, action: 'delete', resource: 'account', resourceId: id, oldData, ...info });
        return json({ message: 'ลบบัญชีสำเร็จ (ยังสามารถกู้คืนจาก Trash ได้)' });
      }
    }

    // ── CATEGORIES ────────────────────────────────────────────────────────────
    if (path === '/categories') {
      if (method === 'GET') {
        const cats = await getCategories(db);
        return json(cats);
      }
      if (method === 'POST') {
        const body   = await request.json();
        const errors = validateCategory(body);
        if (errors.length) return json({ errors }, 422);

        // Check duplicate
        const existing = await db.prepare(
          `SELECT id FROM categories WHERE name = ? AND type = ? AND deleted_at IS NULL`
        ).bind(body.name.trim(), body.type).first();
        if (existing) return err('หมวดหมู่นี้มีอยู่แล้ว', 400);

        const id  = 'cat-' + Date.now();
        const cat = await createCategory(db, { id, name: body.name.trim(), type: body.type, isSystem: false });
        await writeAudit(db, { ...session, action: 'create', resource: 'category', resourceId: id, newData: cat, ...info });
        return json(cat, 201);
      }
    }

    if (path.startsWith('/categories/')) {
      const id = path.split('/')[2];
      if (method === 'PUT') {
        const body = await request.json();
        if (!body.name?.trim() && body.sortOrder === undefined) return err('กรุณาระบุข้อมูลที่ต้องการแก้ไข', 422);
        const cat = await updateCategory(db, id, {
          name: body.name ? body.name.trim() : undefined,
          sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined
        });
        if (!cat) return err('ไม่พบหมวดหมู่', 404);
        await writeAudit(db, { ...session, action: 'update', resource: 'category', resourceId: id, newData: cat, ...info });
        return json(cat);
      }
      if (method === 'DELETE') {
        const cat = await getCategoryById(db, id);
        if (!cat) return err('ไม่พบหมวดหมู่', 404);
        if (cat.isSystem) return err('ไม่สามารถลบหมวดหมู่ของระบบได้', 400);
        await deleteCategory(db, id);
        await writeAudit(db, { ...session, action: 'delete', resource: 'category', resourceId: id, oldData: cat, ...info });
        return json({ message: 'ลบหมวดหมู่สำเร็จ' });
      }
    }

    // ── TRANSACTIONS ──────────────────────────────────────────────────────────
    if (path === '/transactions') {
      if (method === 'GET') {
        const p       = url.searchParams;
        const result  = await getTransactions(db, {
          page     : parseInt(p.get('page')  || '1'),
          limit    : parseInt(p.get('limit') || '50'),
          accountId: p.get('accountId') || undefined,
          type     : p.get('type')      || undefined,
          startDate: p.get('startDate') || undefined,
          endDate  : p.get('endDate')   || undefined,
          keyword  : p.get('keyword')   || undefined,
        });
        return json(result);
      }
      if (method === 'POST') {
        const body   = await request.json();
        const errors = validateTransaction(body);
        if (errors.length) return json({ errors }, 422);

        if (body.type === 'transfer') {
          const id1 = `tx-${Date.now()}-out-${Math.round(Math.random() * 1000)}`;
          const id2 = `tx-${Date.now()}-in-${Math.round(Math.random() * 1000)}`;
          const notesText = body.notes ? sanitize(body.notes, 500) : '';

          const txOut = await createTransaction(db, {
            id: id1,
            date: body.date,
            type: 'transfer_out',
            category: 'โอนย้ายเงิน',
            amount: Number(body.amount),
            paymentMethod: 'Transfer',
            accountId: body.accountId,
            notes: notesText,
            slipUrl: body.slipUrl || null,
            transferTxId: id2,
            createdBy: session.userId,
          });

          await createTransaction(db, {
            id: id2,
            date: body.date,
            type: 'transfer_in',
            category: 'โอนย้ายเงิน',
            amount: Number(body.amount),
            paymentMethod: 'Transfer',
            accountId: body.toAccountId,
            notes: notesText,
            slipUrl: body.slipUrl || null,
            transferTxId: id1,
            createdBy: session.userId,
          });

          await writeAudit(db, { ...session, action: 'create', resource: 'transaction', resourceId: id1, newData: txOut, ...info });
          return json(txOut, 201);
        }

        const id = `tx-${Date.now()}-${Math.round(Math.random() * 1000)}`;
        const tx = await createTransaction(db, {
          id,
          date         : body.date,
          type         : body.type,
          subType      : body.subType || '',
          posMachine   : body.posMachine || '',
          posShift     : body.posShift || '',
          posTime      : body.posTime || '',
          documentCode : body.documentCode || '',
          cashAmount   : Number(body.cashAmount || 0),
          cashAccountId: body.cashAccountId || '',
          transferAmount: Number(body.transferAmount || 0),
          transferAccountId: body.transferAccountId || '',
          couponAmount : Number(body.couponAmount || 0),
          couponAccountId: body.couponAccountId || '',
          hasDiscrepancy: !!body.hasDiscrepancy,
          customerCount: Number(body.customerCount || 0),
          documentTotalAmount: Number(body.documentTotalAmount || 0),
          cnAmount     : Number(body.cnAmount || 0),
          category     : sanitize(body.category, 200),
          amount       : Number(body.amount),
          paymentMethod: body.paymentMethod,
          accountId    : body.accountId || 'acc-unspecified',
          documentNumber: body.documentNumber || '',
          notes        : sanitize(body.notes, 500),
          slipUrl      : body.slipUrl || null,
          status       : body.status  || null,
          dueDate      : body.dueDate || null,
          createdBy    : session.userId,
        });
        await writeAudit(db, { ...session, action: 'create', resource: 'transaction', resourceId: id, newData: tx, ...info });
        return json(tx, 201);
      }
    }

    if (path.startsWith('/transactions/')) {
      const id = path.split('/')[2];

      // Special: restore from trash
      if (path.endsWith('/restore') && method === 'POST') {
        const txId = path.split('/')[2];
        const tx = await getTransactionById(db, txId);
        if (tx && tx.transferTxId) {
          await restoreTransaction(db, tx.id);
          await restoreTransaction(db, tx.transferTxId);
        } else {
          await restoreTransaction(db, txId);
        }
        await writeAudit(db, { ...session, action: 'restore', resource: 'transaction', resourceId: txId, ...info });
        return json({ message: 'กู้คืนรายการสำเร็จ' });
      }

      if (method === 'GET') {
        const tx = await getTransactionById(db, id);
        if (!tx) return err('ไม่พบรายการ', 404);
        return json(tx);
      }
      if (method === 'PUT') {
        const body    = await request.json();
        const oldData = await getTransactionById(db, id);
        if (!oldData) return err('ไม่พบรายการ', 404);

        if (oldData.transferTxId && body.type !== 'transfer') {
          await softDeleteTransaction(db, oldData.transferTxId);
          const updated = await updateTransaction(db, id, {
            date         : body.date,
            type         : body.type,
            category     : body.category ? sanitize(body.category, 200) : undefined,
            amount       : body.amount   !== undefined ? Number(body.amount) : undefined,
            paymentMethod: body.paymentMethod,
            accountId    : body.accountId || 'acc-unspecified',
            notes        : body.notes    !== undefined ? sanitize(body.notes, 500) : undefined,
            slipUrl      : body.slipUrl  !== undefined ? body.slipUrl : undefined,
            status       : body.status   !== undefined ? body.status  : undefined,
            dueDate      : body.dueDate  !== undefined ? body.dueDate : undefined,
            transferTxId : null
          });
          await writeAudit(db, { ...session, action: 'update', resource: 'transaction', resourceId: id, oldData, newData: updated, ...info });
          return json(updated);
        }

        if (oldData.transferTxId) {
          const otherData = await getTransactionById(db, oldData.transferTxId);
          let txOutId, txInId;
          if (oldData.type === 'transfer_out') {
            txOutId = oldData.id;
            txInId = oldData.transferTxId;
          } else {
            txOutId = oldData.transferTxId;
            txInId = oldData.id;
          }

          const amount = body.amount !== undefined ? Number(body.amount) : oldData.amount;
          const date = body.date || oldData.date;
          const notesText = body.notes !== undefined ? sanitize(body.notes, 500) : oldData.notes;
          const slipUrl = body.slipUrl !== undefined ? body.slipUrl : oldData.slipUrl;

          let sourceAccId = body.accountId || (oldData.type === 'transfer_out' ? oldData.accountId : otherData?.accountId);
          let destAccId = body.toAccountId || (oldData.type === 'transfer_in' ? oldData.accountId : otherData?.accountId);

          const updatedOut = await updateTransaction(db, txOutId, {
            date,
            type: 'transfer_out',
            category: 'โอนย้ายเงิน',
            amount,
            paymentMethod: 'Transfer',
            accountId: sourceAccId,
            notes: notesText,
            slipUrl,
          });

          await updateTransaction(db, txInId, {
            date,
            type: 'transfer_in',
            category: 'โอนย้ายเงิน',
            amount,
            paymentMethod: 'Transfer',
            accountId: destAccId,
            notes: notesText,
            slipUrl,
          });

          await writeAudit(db, { ...session, action: 'update', resource: 'transaction', resourceId: id, oldData, newData: updatedOut, ...info });
          return json(updatedOut);
        }

        if (body.type === 'transfer') {
          const id2 = `tx-${Date.now()}-in-${Math.round(Math.random() * 1000)}`;
          const amount = Number(body.amount);
          const date = body.date;
          const notesText = body.notes ? sanitize(body.notes, 500) : '';

          const updatedOut = await updateTransaction(db, id, {
            date,
            type: 'transfer_out',
            category: 'โอนย้ายเงิน',
            amount,
            paymentMethod: 'Transfer',
            accountId: body.accountId,
            notes: notesText,
            slipUrl: body.slipUrl || null,
            transferTxId: id2,
            status: null
          });

          await createTransaction(db, {
            id: id2,
            date,
            type: 'transfer_in',
            category: 'โอนย้ายเงิน',
            amount,
            paymentMethod: 'Transfer',
            accountId: body.toAccountId,
            notes: notesText,
            slipUrl: body.slipUrl || null,
            transferTxId: id,
            createdBy: session.userId,
          });

          await writeAudit(db, { ...session, action: 'update', resource: 'transaction', resourceId: id, oldData, newData: updatedOut, ...info });
          return json(updatedOut);
        }

        const updated = await updateTransaction(db, id, {
          date         : body.date,
          type         : body.type,
          category     : body.category ? sanitize(body.category, 200) : undefined,
          amount       : body.amount   !== undefined ? Number(body.amount) : undefined,
          paymentMethod: body.paymentMethod,
          accountId    : body.accountId || 'acc-unspecified',
          notes        : body.notes    !== undefined ? sanitize(body.notes, 500) : undefined,
          slipUrl      : body.slipUrl  !== undefined ? body.slipUrl : undefined,
          status       : body.status   !== undefined ? body.status  : undefined,
          dueDate      : body.dueDate  !== undefined ? body.dueDate : undefined,
        });
        await writeAudit(db, { ...session, action: 'update', resource: 'transaction', resourceId: id, oldData, newData: updated, ...info });
        return json(updated);
      }
      if (method === 'DELETE') {
        const tx = await getTransactionById(db, id);
        if (!tx) return err('ไม่พบรายการ', 404);
        if (tx.transferTxId) {
          await softDeleteTransaction(db, tx.id);
          await softDeleteTransaction(db, tx.transferTxId);
        } else {
          await softDeleteTransaction(db, id);
        }
        await writeAudit(db, { ...session, action: 'delete', resource: 'transaction', resourceId: id, oldData: tx, ...info });
        return json({ message: 'ลบรายการสำเร็จ (สามารถกู้คืนได้จาก Trash)' });
      }
    }

    // ── FILE UPLOAD ───────────────────────────────────────────────────────────
    if (path === '/upload' && method === 'POST') {
      const formData = await request.formData();
      const file     = formData.get('attachment');
      if (!file) return err('ไม่พบไฟล์', 400);

      const result = await uploadFile(env, file);
      return json({ ...result, message: 'อัปโหลดสำเร็จ', fileUrl: result.fileUrl }, 201);
    }

    // ── BACKUP & RESTORE ──────────────────────────────────────────────────────
    if (path === '/backup' && method === 'GET') {
      const data = await exportBackupV1(db);

      // Compute balances for the backup
      const balances    = await calculateBalances(db);
      const balanceMap  = Object.fromEntries(balances.map(a => [a.id, a.balance]));
      data.accounts     = data.accounts.map(a => ({ ...a, balance: balanceMap[a.id] ?? a.initialBalance }));

      await writeAudit(db, { ...session, action: 'backup', resource: 'system', ...info });
      return json(data);
    }

    if (path === '/restore' && method === 'POST') {
      const body = await request.json();
      if (!validateBackup(body)) return err('รูปแบบไฟล์ backup ไม่ถูกต้อง', 400);

      const version = detectBackupVersion(body);
      const mode    = body.importMode || 'replace';   // 'replace' | 'merge' | 'skip'

      let results;
      if (version === 1) {
        results = await importBackupV1(db, body, { mode, userId: session.userId });
      } else {
        return err(`Backup version ${version} ยังไม่รองรับ`, 400);
      }

      await writeAudit(db, { ...session, action: 'import', resource: 'system', newData: { version, mode, results }, ...info });
      return json({ message: 'นำเข้าข้อมูลสำเร็จ', version, mode, results });
    }

    // ── LOGOUT ────────────────────────────────────────────────────────────────
    if (path === '/logout' && method === 'POST') {
      await deleteSession(db, token);
      await writeAudit(db, { ...session, action: 'logout', resource: 'system', ...info });
      return json({ message: 'ออกจากระบบสำเร็จ' });
    }

    // ── TRASH / SOFT DELETE MANAGEMENT ───────────────────────────────────────
    if (path === '/trash' && method === 'GET') {
      const trash = await getTrash(db);
      return json(trash);
    }

    if (path.startsWith('/trash/') && method === 'DELETE') {
      const parts = path.split('/'); // ['', 'trash', type, id]
      const type  = parts[2];        // 'transaction' | 'account'
      const id    = parts[3];
      if (type === 'transaction') {
        const tx = await getTransactionById(db, id);
        if (tx && tx.transferTxId) {
          if (tx.slipUrl) {
            try { await deleteFile(env, tx.slipUrl); } catch (fileErr) {}
          }
          const otherTx = await getTransactionById(db, tx.transferTxId);
          if (otherTx && otherTx.slipUrl && otherTx.slipUrl !== tx.slipUrl) {
            try { await deleteFile(env, otherTx.slipUrl); } catch (fileErr) {}
          }
          await db.prepare(`DELETE FROM transactions WHERE id = ?`).bind(id).run();
          await db.prepare(`DELETE FROM transactions WHERE id = ?`).bind(tx.transferTxId).run();
        } else {
          const txSingle = await db.prepare(`SELECT slip_url FROM transactions WHERE id = ? AND deleted_at IS NOT NULL`).bind(id).first();
          if (txSingle && txSingle.slip_url) {
            try { await deleteFile(env, txSingle.slip_url); } catch (fileErr) {}
          }
          await db.prepare(`DELETE FROM transactions WHERE id = ? AND deleted_at IS NOT NULL`).bind(id).run();
        }
      } else if (type === 'account') {
        await db.prepare(`DELETE FROM accounts WHERE id = ? AND deleted_at IS NOT NULL AND id != 'acc-cash'`).bind(id).run();
      }
      return json({ message: 'ลบถาวรสำเร็จ' });
    }

    if (path.startsWith('/trash/') && method === 'POST') {
      const parts = path.split('/'); // ['', 'trash', type, id, 'restore']
      const type  = parts[2];
      const id    = parts[3];
      const now   = nowISO();
      if (type === 'transaction') {
        const tx = await getTransactionById(db, id);
        if (tx && tx.transferTxId) {
          await db.prepare(`UPDATE transactions SET deleted_at=NULL, updated_at=? WHERE id=?`).bind(now, id).run();
          await db.prepare(`UPDATE transactions SET deleted_at=NULL, updated_at=? WHERE id=?`).bind(now, tx.transferTxId).run();
        } else {
          await db.prepare(`UPDATE transactions SET deleted_at=NULL, updated_at=? WHERE id=?`).bind(now, id).run();
        }
      } else if (type === 'account') {
        await db.prepare(`UPDATE accounts SET deleted_at=NULL, updated_at=? WHERE id=?`).bind(now, id).run();
      }
      await writeAudit(db, { ...session, action: 'restore', resource: type, resourceId: id, ...info });
      return json({ message: 'กู้คืนสำเร็จ' });
    }

    // ── ADMIN: DASHBOARD STATS ────────────────────────────────────────────────
    if (path === '/admin/stats' && method === 'GET') {
      const stats = await getDashboardStats(db);
      const balances = await calculateBalances(db);
      return json({ ...stats, balances });
    }

    // ── ADMIN: AUDIT LOGS ─────────────────────────────────────────────────────
    if (path === '/admin/audit' && method === 'GET') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const p      = url.searchParams;
      const logs   = await getAuditLogs(db, {
        limit : parseInt(p.get('limit')  || '100'),
        offset: parseInt(p.get('offset') || '0'),
      });
      return json(logs);
    }

    // ── ADMIN: SETTINGS ───────────────────────────────────────────────────────
    if (path === '/admin/settings') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      if (method === 'GET') {
        const settings = await getAllSettings(db);
        return json(settings);
      }
      if (method === 'POST') {
        const body = await request.json();
        for (const [key, value] of Object.entries(body)) {
          await setSetting(db, key, value, session.userId);
        }
        await writeAudit(db, { ...session, action: 'update', resource: 'system', newData: body, ...info });
        return json({ message: 'บันทึกการตั้งค่าสำเร็จ' });
      }
    }

    // ── ADMIN: USERS ──────────────────────────────────────────────────────────
    if (path === '/admin/users') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      if (method === 'GET') {
        const users = await getUsers(db);
        return json(users);
      }
      if (method === 'POST') {
        const body = await request.json();
        if (!body.username?.trim() || !body.password?.trim()) {
          return err('กรุณาระบุ username และ password', 422);
        }
        const existing = await getUserByUsername(db, body.username.trim());
        if (existing) return err('username นี้มีอยู่แล้ว', 400);

        const passwordHash = await hashPassword(body.password);
        const id           = `user-${Date.now()}`;
        await createUser(db, { id, username: body.username.trim(), passwordHash, role: body.role || 'user' });
        await writeAudit(db, { ...session, action: 'create', resource: 'user', resourceId: id, newData: { username: body.username }, ...info });
        return json({ message: 'สร้างผู้ใช้สำเร็จ', id }, 201);
      }
    }

    if (path.startsWith('/admin/users/') && method === 'PUT') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const userId = path.split('/')[3];
      const body   = await request.json();

      if (body.password) {
        const hash = await hashPassword(body.password);
        await updateUserPassword(db, userId, hash);
      }
      if (body.isActive !== undefined) {
        await toggleUserActive(db, userId, body.isActive);
      }
      return json({ message: 'อัปเดตผู้ใช้สำเร็จ' });
    }

    // ── ADMIN: RESET USER PASSWORD ────────────────────────────────────────────
    if (path.match(/^\/admin\/users\/[^/]+\/reset-password$/) && method === 'POST') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const userId = path.split('/')[3];
      const body   = await request.json().catch(() => ({}));
      if (!body.newPassword || body.newPassword.length < 6)
        return err('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 400);
      const hash = await hashPassword(body.newPassword);
      await updateUserPassword(db, userId, hash);
      await writeAudit(db, { ...session, action: 'reset_password', resource: 'user', resourceId: userId, ...info });
      return json({ message: 'รีเซ็ตรหัสผ่านสำเร็จ' });
    }

    // ── ADMIN: DELETE USER ────────────────────────────────────────────────────
    if (path.match(/^\/admin\/users\/[^/]+$/) && method === 'DELETE') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const userId = path.split('/')[3];
      // ห้ามลบตัวเอง
      if (userId === session.userId) return err('ไม่สามารถลบบัญชีของตัวเองได้', 400);
      // ตรวจว่าเป็น admin คนสุดท้ายหรือไม่
      const { results: admins } = await db.prepare(
        `SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL`
      ).all();
      const target = await getUserById(db, userId);
      if (!target) return err('ไม่พบผู้ใช้', 404);
      if (target.role === 'admin' && admins.length <= 1)
        return err('ไม่สามารถลบ Admin คนสุดท้ายได้', 400);
      // Soft delete
      await db.prepare(
        `UPDATE users SET deleted_at=?, updated_at=? WHERE id=?`
      ).bind(nowISO(), nowISO(), userId).run();
      await writeAudit(db, { ...session, action: 'delete_user', resource: 'user', resourceId: userId, ...info });
      return json({ message: 'ลบผู้ใช้สำเร็จ' });
    }

    // ── ADMIN: GET LINE SETTINGS ──────────────────────────────────────────────
    // ดึงสถานะการตั้งค่า LINE (ไม่คืน token จริงเพื่อความปลอดภัย)
    if (path === '/admin/line-settings' && method === 'GET') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const tokenFromEnv   = !!env.LINE_CHANNEL_ACCESS_TOKEN;
      const groupFromEnv   = !!env.LINE_GROUP_ID;
      const tokenFromDb    = await getSetting(db, 'line_channel_token');
      const groupFromDb    = await getSetting(db, 'line_group_id');
      return json({
        source       : tokenFromEnv ? 'env' : (tokenFromDb ? 'database' : 'none'),
        configured   : !!(tokenFromEnv || tokenFromDb) && !!(groupFromEnv || groupFromDb),
        hasToken     : !!(tokenFromEnv || tokenFromDb),
        hasGroupId   : !!(groupFromEnv || groupFromDb),
        groupIdHint  : groupFromDb ? groupFromDb.slice(0, 8) + '...' : (groupFromEnv ? '(จาก env)' : null),
        usingEnvVar  : tokenFromEnv,
      });
    }

    // ── ADMIN: SAVE LINE SETTINGS ─────────────────────────────────────────────
    // บันทึก channelToken + groupId ลง D1 settings table
    if (path === '/admin/line-settings' && method === 'POST') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const body = await request.json().catch(() => ({}));
      const { channelToken, groupId } = body;
      if (!channelToken || !groupId) return err('ต้องระบุ channelToken และ groupId', 400);
      await setSetting(db, 'line_channel_token', channelToken.trim());
      await setSetting(db, 'line_group_id',      groupId.trim());
      await writeAudit(db, { ...session, action: 'update_line_settings', resource: 'settings', ...info });
      return json({ message: 'บันทึกการตั้งค่า LINE สำเร็จ ✅' });
    }

    // ── ADMIN: TEST LINE MESSAGING API ────────────────────────────────────────
    if (path === '/admin/test-line' && method === 'POST') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      // Priority: env var > D1 settings
      const lineToken   = env.LINE_CHANNEL_ACCESS_TOKEN || await getSetting(db, 'line_channel_token');
      const lineGroupId = env.LINE_GROUP_ID             || await getSetting(db, 'line_group_id');
      if (!lineToken)   return err('ยังไม่ได้ตั้งค่า Channel Access Token', 400);
      if (!lineGroupId) return err('ยังไม่ได้ตั้งค่า Group ID', 400);
      const ok = await sendLineReport(lineToken, lineGroupId,
        '✅ [Smart Wealth Tracker] ทดสอบ LINE Messaging Bot สำเร็จ!\nระบบพร้อมส่งรายงานเข้ากลุ่มนี้แล้ว 🚀');
      if (ok) return json({ message: 'ส่ง LINE สำเร็จ ✅ เช็คกลุ่มในมือถือได้เลย' });
      return err('ส่ง LINE ไม่สำเร็จ — ตรวจสอบ token และ groupId ว่าถูกต้อง และ Bot อยู่ในกลุ่มแล้ว', 500);
    }

    // ── ADMIN: MANUAL DAILY REPORT ────────────────────────────────────────────
    if (path === '/admin/send-report' && method === 'POST') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const lineToken   = env.LINE_CHANNEL_ACCESS_TOKEN || await getSetting(db, 'line_channel_token');
      const lineGroupId = env.LINE_GROUP_ID             || await getSetting(db, 'line_group_id');
      if (!lineToken)   return err('ยังไม่ได้ตั้งค่า Channel Access Token', 400);
      if (!lineGroupId) return err('ยังไม่ได้ตั้งค่า Group ID', 400);

      let body = {};
      try { body = await request.json(); } catch {}

      const today      = body.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const monthStart = today.slice(0, 7) + '-01';

      // คำนวณวันพรุ่งนี้ (Tomorrow) ในเขตเวลา Asia/Bangkok
      const parts = today.split('-');
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      const tomorrowDate = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      const tomorrow = tomorrowDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

      const [balances, stats, futureTxResult] = await Promise.all([
        calculateBalances(db),
        getDashboardStats(db),
        getTransactions(db, { type: 'future', limit: 500 }),
      ]);

      // ดึงธุรกรรมของวันนี้แบบเต็ม (Today transactions)
      const { results: todayTransactions } = await db.prepare(
        `SELECT type, amount, account_id, status FROM transactions WHERE date=? AND deleted_at IS NULL`
      ).bind(today).all();

      // ดึงธุรกรรมของวันพรุ่งนี้แบบเต็ม (Tomorrow items)
      const { results: tomorrowItems } = await db.prepare(
        `SELECT notes, category_name as category, amount, account_id, payment_method FROM transactions WHERE type='future' AND status != 'paid' AND date=? AND deleted_at IS NULL`
      ).bind(tomorrow).all();

      // Today income/expense
      const todayIncome  = todayTransactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const todayExpense = todayTransactions.filter(t => t.type === 'expense' || (t.type === 'future' && t.status === 'paid')).reduce((s, t) => s + Number(t.amount), 0);

      // Month income/expense
      const { results: monthTx } = await db.prepare(
        `SELECT type, amount FROM transactions WHERE date>=? AND date<=? AND deleted_at IS NULL`
      ).bind(monthStart, today).all();

      const monthIncome  = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const monthExpense = monthTx.filter(t => t.type === 'expense' || (t.type === 'future' && t.status === 'paid')).reduce((s, t) => s + Number(t.amount), 0);

      const lastBackup = await db.prepare(
        `SELECT status, created_at FROM backup_history ORDER BY created_at DESC LIMIT 1`
      ).first();
      const backupStatus = lastBackup
        ? `${lastBackup.status === 'success' ? '✅' : '❌'} ${lastBackup.created_at?.slice(0, 10) || '-'}`
        : 'ยังไม่มีข้อมูล';

      const message = buildDailyReport({
        balances, todayIncome, todayExpense, monthIncome, monthExpense,
        futureItems: futureTxResult.data || [], backupStatus, dbStats: stats,
        todayTransactions, tomorrowItems, reportDateStr: today
      });

      const ok = await sendLineReport(lineToken, lineGroupId, message);
      await writeAudit(db, { ...session, action: 'send_report', resource: 'system', ...info });
      if (ok) return json({ message: `ส่ง Daily Report ของวันที่ ${today} เข้ากลุ่ม LINE แล้ว ✅` });
      return err('ส่ง LINE ไม่สำเร็จ — ตรวจสอบ token และ groupId', 500);
    }

    // ── ADMIN: MANUAL MONTHLY REPORT ──────────────────────────────────────────
    if (path === '/admin/send-monthly-report' && method === 'POST') {
      if (session.role !== 'admin') return err('เฉพาะ Admin เท่านั้น', 403);
      const lineToken   = env.LINE_CHANNEL_ACCESS_TOKEN || await getSetting(db, 'line_channel_token');
      const lineGroupId = env.LINE_GROUP_ID             || await getSetting(db, 'line_group_id');
      if (!lineToken)   return err('ยังไม่ได้ตั้งค่า Channel Access Token', 400);
      if (!lineGroupId) return err('ยังไม่ได้ตั้งค่า Group ID', 400);

      let body = {};
      try { body = await request.json(); } catch {}

      const selectedMonth = body.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
      const monthStart = selectedMonth + '-01';

      // หาวันสิ้นเดือนของเดือนที่เลือก
      const parts = selectedMonth.split('-');
      const yearInt = parseInt(parts[0]);
      const monthInt = parseInt(parts[1]);
      const lastDay = new Date(yearInt, monthInt, 0).getDate();
      const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;

      // คำนวณเดือนและปีในรูปแบบภาษาไทยย้อนหลังของเดือนที่เลือก
      const dummyDate = new Date(yearInt, monthInt - 1, 1);
      const monthName = dummyDate.toLocaleDateString('th-TH', { month: 'long' });
      const year      = dummyDate.toLocaleDateString('th-TH', { year: 'numeric' });

      const [balances, stats] = await Promise.all([
        calculateBalances(db),
        getDashboardStats(db),
      ]);

      // ดึงรายรับ/รายจ่ายของเดือนมาสรุป
      const { results: monthTx } = await db.prepare(
        `SELECT type, amount FROM transactions WHERE date>=? AND date<=? AND deleted_at IS NULL`
      ).bind(monthStart, monthEnd).all();
      const monthIncome  = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
      const monthExpense = monthTx.filter(t => t.type === 'expense' || (t.type === 'future' && t.status === 'paid')).reduce((s, t) => s + Number(t.amount), 0);

      // ดึงสถิติรายจ่ายแยกตามหมวดหมู่ในเดือนปัจจุบัน
      const { results: categoriesStats } = await db.prepare(
        `SELECT category_name as name, SUM(amount) as amount FROM transactions 
         WHERE type='expense' AND date>=? AND date<=? AND deleted_at IS NULL 
         GROUP BY category_name`
      ).bind(monthStart, monthEnd).all();

      const message = buildMonthlyReport({
        monthName,
        year,
        balances,
        monthIncome,
        monthExpense,
        categoriesStats
      });

      const ok = await sendLineReport(lineToken, lineGroupId, message);
      await writeAudit(db, { ...session, action: 'send_monthly_report', resource: 'system', ...info });
      if (ok) return json({ message: `ส่ง Monthly Report ของเดือน ${selectedMonth} เข้ากลุ่ม LINE แล้ว ✅` });
      return err('ส่ง LINE ไม่สำเร็จ — ตรวจสอบ token และ groupId', 500);
    }


    // ── CURRENT USER INFO ─────────────────────────────────────────────────────
    if (path === '/me' && method === 'GET') {
      const user = await getUserById(db, session.userId);
      return json(user);
    }

    return err('ไม่พบ endpoint ที่ร้องขอ', 404);

  } catch (e) {
    console.error('[API Error]', e.stack || e.message);
    return json({ error: 'เกิดข้อผิดพลาดภายในระบบ', detail: e.message }, 500);
  }
}

// ─── Login Handler ────────────────────────────────────────────────────────────

async function handleLogin(db, request, env) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const username = sanitize(body.username || body.passcode || '', 100);
  const password = body.password || body.passcode || '';

  if (!username || !password) {
    return err('กรุณาระบุ username และ password', 400);
  }

  // Get user first
  const user = await getUserByUsername(db, username);
  if (!user) {
    // Still call rate limit to avoid timing attacks revealing valid usernames
    await checkAndRecordFailedLogin(db, username).catch(() => {});
    return err('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  }
  if (!user.is_active) {
    return err('บัญชีนี้ถูกปิดการใช้งาน', 403);
  }

  // Check if locked out
  const now = nowISO();
  if (user.locked_until && user.locked_until > now) {
    const until = new Date(user.locked_until + 'Z').toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
    return err(`บัญชีถูกล็อคชั่วคราว กรุณาลองใหม่หลัง ${until}`, 429);
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    // Record failed attempt
    await checkAndRecordFailedLogin(db, username);
    return err('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  }

  // Reset failed attempts on success
  await resetFailedAttempts(db, user.id);

  // Create session
  const token = generateToken();
  await createSession(db, user.id, token, request);

  // Audit
  const info = requestInfo(request);
  await writeAudit(db, { userId: user.id, username: user.username, action: 'login', resource: 'system', ...info });

  // Set HttpOnly cookie (Secure always on Cloudflare Pages / HTTPS)
  const cookieOptions = [
    `swt_session=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 3600}`,
  ];

  return json(
    { token, username: user.username, role: user.role, message: 'เข้าสู่ระบบสำเร็จ' },
    200,
    { 'Set-Cookie': cookieOptions.join('; ') }
  );
}
