/**
 * TagFlow SaaS — Backend Router
 * Namespace: /api/tagflow/*
 * Independent module — DO NOT merge into ACOPES AI V9 core logic.
 */

import { Router }       from 'express';
import { DatabaseSync } from 'node:sqlite';
import jwt              from 'jsonwebtoken';
import crypto           from 'node:crypto';
import path             from 'node:path';
import { mkdirSync }    from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router    = Router();

// ── Config ───────────────────────────────────────────────────────────────────
const TAGFLOW_JWT_SECRET = (process.env.TAGFLOW_JWT_SECRET || 'tagflow-dev-secret-CHANGE-IN-PROD').trim();
const ANTHROPIC_KEY      = (process.env.ANTHROPIC_API_KEY  || '').trim();
const DB_PATH            = path.join(process.env.ACOPES_DATA_DIR || '/tmp', 'acopes-ai', 'tagflow.db');
const OWNER_EMAIL        = 'enesaksesuar1@gmail.com';

// ── Plan limits & metadata ────────────────────────────────────────────────────
const PLAN_LIMITS = { free: 15, premium: 250, power: 9999 };
const PLAN_META   = {
  free:    { plan_name: 'Free',         plan_price: '$0/mo'     },
  premium: { plan_name: 'Premium',      plan_price: '$6.99/mo'  },
  power:   { plan_name: 'Power Seller', plan_price: '$10.99/mo' }
};

// ── SQLite (lazy init) ───────────────────────────────────────────────────────
let _db = null;
function db() {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS tagflow_users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'free',
      created_at    TEXT NOT NULL,
      used_today    INTEGER NOT NULL DEFAULT 0,
      last_reset    TEXT NOT NULL
    )
  `);
  // ── Safe admin column migration ───────────────────────────────────────────
  const _adminCols = [
    "ALTER TABLE tagflow_users ADD COLUMN role                    TEXT DEFAULT 'user'",
    "ALTER TABLE tagflow_users ADD COLUMN daily_limit_override    INTEGER",
    "ALTER TABLE tagflow_users ADD COLUMN account_status          TEXT DEFAULT 'active'",
    "ALTER TABLE tagflow_users ADD COLUMN admin_note              TEXT",
    "ALTER TABLE tagflow_users ADD COLUMN billing_subscription_id TEXT"
  ];
  for (const sql of _adminCols) {
    try { _db.exec(sql); } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
  }
  // ── Auto-assign owner role ────────────────────────────────────────────────
  try {
    _db.prepare("UPDATE tagflow_users SET role='owner' WHERE email=?").run(OWNER_EMAIL);
    console.log('[TAGFLOW DB] owner role enforced for', OWNER_EMAIL);
  } catch (e) {
    console.warn('[TAGFLOW DB] owner role assign failed:', e.message);
  }
  console.log('[TAGFLOW DB] ready:', DB_PATH);
  return _db;
}

// ── Password helpers (PBKDF2, no extra deps) ─────────────────────────────────
function hashPwd(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 310_000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function checkPwd(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.pbkdf2Sync(password, salt, 310_000, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
  } catch { return false; }
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
function signTok(payload) { return jwt.sign(payload, TAGFLOW_JWT_SECRET, { expiresIn: '30d' }); }
function verifyTok(token) { return jwt.verify(token, TAGFLOW_JWT_SECRET); }

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '').trim();
  if (!tok) return res.status(401).json({ success: false, error: 'Token gerekli.' });
  try {
    req.tf = verifyTok(tok);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Geçersiz veya süresi dolmuş oturum. Yeniden giriş yapın.' });
  }
}

// ── Admin middleware (verifies role from DB, never trusts JWT payload) ────────
function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '').trim();
  if (!tok) return res.status(401).json({ success: false, error: 'Token gerekli.' });
  try {
    req.tf = verifyTok(tok);
    const u = db().prepare('SELECT role FROM tagflow_users WHERE id=?').get(req.tf.userId);
    if (!u || !['owner', 'admin'].includes(u.role || '')) {
      return res.status(403).json({ success: false, error: 'Bu işlem için yetkiniz yok.' });
    }
    req.tf.role = u.role;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Geçersiz token.' });
  }
}

// ── Effective daily limit (owner/admin = -1 = unlimited) ─────────────────────
function effectiveLimit(user) {
  const role = user.role || 'user';
  if (role === 'owner' || role === 'admin') return -1;
  if (user.daily_limit_override != null)    return user.daily_limit_override;
  return PLAN_LIMITS[user.plan] ?? 15;
}

// ── Credit helpers ────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function freshUser(user) {
  if (user.last_reset !== today()) {
    db().prepare('UPDATE tagflow_users SET used_today=0, last_reset=? WHERE id=?').run(today(), user.id);
    return { ...user, used_today: 0, last_reset: today() };
  }
  return user;
}
function creditInfo(user) {
  const plan       = user.plan || 'free';
  const role       = user.role || 'user';
  const limit      = effectiveLimit(user);
  const meta       = PLAN_META[plan] || PLAN_META.free;
  const used_today = user.used_today || 0;
  return {
    plan,
    role,
    plan_name:            meta.plan_name,
    plan_price:           meta.plan_price,
    daily_limit:          limit === -1 ? null : limit,
    daily_limit_override: user.daily_limit_override ?? null,
    account_status:       user.account_status || 'active',
    used_today,
    remaining:            limit === -1 ? null : Math.max(0, limit - used_today),
    subscription_status:  user.subscription_status  || null,
    subscription_renewal: user.subscription_renewal || null,
    billing_provider:     user.billing_provider     || null
  };
}

// ── CORS (Chrome extension → backend) ────────────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/auth/signup
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/signup', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)    return res.status(400).json({ success: false, error: 'Email ve şifre gerekli.' });
  if (password.length < 8)    return res.status(400).json({ success: false, error: 'Şifre en az 8 karakter olmalı.' });

  const cleanEmail = email.toLowerCase().trim();
  try {
    if (db().prepare('SELECT id FROM tagflow_users WHERE email=?').get(cleanEmail))
      return res.status(409).json({ success: false, error: 'Bu email zaten kayıtlı.' });

    const id   = crypto.randomUUID();
    const role = cleanEmail === OWNER_EMAIL ? 'owner' : 'user';
    db().prepare(
      'INSERT INTO tagflow_users (id,email,password_hash,plan,created_at,used_today,last_reset,role) VALUES (?,?,?,?,?,0,?,?)'
    ).run(id, cleanEmail, hashPwd(password), 'free', new Date().toISOString(), today(), role);

    const newUser = { id, email: cleanEmail, plan: 'free', role, used_today: 0 };
    const token   = signTok({ userId: id, email: cleanEmail, plan: 'free' });
    console.log('[TAGFLOW SIGNUP]', cleanEmail, 'role=' + role);
    res.json({ success: true, token, email: cleanEmail, ...creditInfo(newUser) });
  } catch (e) {
    console.error('[TAGFLOW SIGNUP ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/auth/login
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email ve şifre gerekli.' });

  const cleanEmail = email.toLowerCase().trim();
  try {
    let user = db().prepare('SELECT * FROM tagflow_users WHERE email=?').get(cleanEmail);
    if (!user || !checkPwd(password, user.password_hash))
      return res.status(401).json({ success: false, error: 'Email veya şifre hatalı.' });

    user = freshUser(user);
    // Force owner role on login if needed
    if (cleanEmail === OWNER_EMAIL && (user.role || 'user') !== 'owner') {
      db().prepare("UPDATE tagflow_users SET role='owner' WHERE id=?").run(user.id);
      user = { ...user, role: 'owner' };
    }
    const token = signTok({ userId: user.id, email: user.email, plan: user.plan });
    console.log('[TAGFLOW LOGIN]', cleanEmail, 'plan=' + user.plan, 'role=' + (user.role || 'user'));
    res.json({ success: true, token, email: user.email, ...creditInfo(user) });
  } catch (e) {
    console.error('[TAGFLOW LOGIN ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tagflow/user/me
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/me', requireAuth, (req, res) => {
  try {
    let user = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(req.tf.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    user = freshUser(user);
    // ── Hard owner fallback — no dependency on role column or migration ────────
    const isOwner = String(user.email || '').toLowerCase() === 'enesaksesuar1@gmail.com';
    if (isOwner) {
      return res.json({
        success:              true,
        email:                user.email,
        plan:                 user.plan || 'free',
        plan_name:            'Owner',
        role:                 'owner',
        account_status:       'active',
        used_today:           0,
        daily_limit:          null,
        remaining:            null,
        unlimited:            true,
        billing_provider:     user.billing_provider     || null,
        subscription_status:  user.subscription_status  || null,
        subscription_renewal: user.subscription_renewal || null
      });
    }
    const info = creditInfo(user);
    console.log('[ME RESPONSE]', { email: user.email, role: info.role, daily_limit: info.daily_limit });
    res.json({ success: true, email: user.email, ...info });
  } catch (e) {
    console.error('[TAGFLOW ME ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/analyze
// auth → plan → credit → anthropic → response
// ─────────────────────────────────────────────────────────────────────────────
router.post('/analyze', requireAuth, async (req, res) => {
  const { prompt, max_tokens = 1000 } = req.body || {};
  if (!prompt)         return res.status(400).json({ success: false, error: 'Prompt gerekli.' });
  if (!ANTHROPIC_KEY)  return res.status(500).json({ success: false, error: 'Sunucu API key yapılandırılmamış. ANTHROPIC_API_KEY env ekleyin.' });

  try {
    // ── Auth check ──────────────────────────────────────────────────
    let user = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(req.tf.userId);
    if (!user) return res.status(401).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    user = freshUser(user);

    // ── Account status check ────────────────────────────────────────
    if ((user.account_status || 'active') !== 'active') {
      return res.status(403).json({ success: false, error: 'Hesabınız devre dışı bırakıldı.' });
    }

    // ── Plan / Credit check ─────────────────────────────────────────
    const limit = effectiveLimit(user);
    if (limit !== -1 && user.used_today >= limit) {
      return res.status(429).json({
        success: false,
        error:   `Günlük limit doldu (${user.used_today}/${limit}). Premium'a geçerek sınırsız analiz yapın.`,
        upgrade: true,
        credits: creditInfo(user)
      });
    }

    // ── Anthropic call ──────────────────────────────────────────────
    const model = await getAnthropicModel();
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':        ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':     'application/json'
      },
      body: JSON.stringify({ model, max_tokens, messages: [{ role: 'user', content: prompt }] })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      console.error('[TAGFLOW ANALYZE] Anthropic', anthropicRes.status, errText.slice(0, 200));
      return res.status(502).json({ success: false, error: `Anthropic hatası: HTTP ${anthropicRes.status}` });
    }

    const anthropicData = await anthropicRes.json();
    const text = (anthropicData.content || []).map(b => b.text || '').join('').trim();

    // ── Deduct credit ───────────────────────────────────────────────
    db().prepare('UPDATE tagflow_users SET used_today=used_today+1 WHERE id=?').run(user.id);
    const usedNow = user.used_today + 1;

    console.log(`[TAGFLOW ANALYZE] ${user.email} plan=${user.plan} used=${usedNow}/${limit === -1 ? '∞' : limit}`);
    res.json({
      success: true,
      text,
      credits: {
        plan:        user.plan,
        used_today:  usedNow,
        daily_limit: limit,
        remaining:   limit === -1 ? null : Math.max(0, limit - usedNow)
      }
    });
  } catch (e) {
    console.error('[TAGFLOW ANALYZE ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası: ' + e.message });
  }
});

// ── Anthropic model discovery (server-side, cached 10 min) ───────────────────
let _model = null, _modelAt = 0;
async function getAnthropicModel() {
  if (_model && Date.now() - _modelAt < 600_000) return _model;
  try {
    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' }
    });
    if (!r.ok) throw new Error('models ' + r.status);
    const d   = await r.json();
    const ids = (d.data || []).map(m => m.id);
    _model    = ids.find(id => id.toLowerCase().includes('sonnet')) || ids[0] || 'claude-3-5-haiku-20241022';
    _modelAt  = Date.now();
    console.log('[TAGFLOW MODEL]', _model);
  } catch (e) {
    console.error('[TAGFLOW MODEL ERROR]', e.message);
    _model = _model || 'claude-3-5-haiku-20241022';
  }
  return _model;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/billing/create-checkout
// ─────────────────────────────────────────────────────────────────────────────
router.post('/billing/create-checkout', requireAuth, async (req, res) => {
  const { plan } = req.body || {};
  if (!['premium', 'power'].includes(plan)) {
    return res.status(400).json({ success: false, error: 'Geçersiz plan.' });
  }
  // Paddle integration placeholder — wire PADDLE_API_KEY server-side only
  const PADDLE_KEY = process.env.PADDLE_API_KEY || '';
  if (!PADDLE_KEY) {
    // Return a placeholder URL so the UI doesn't break
    return res.json({
      success:      true,
      placeholder:  true,
      checkout_url: 'https://tagflow.acopesai.com/upgrade?plan=' + plan
    });
  }
  try {
    const priceId = plan === 'premium'
      ? (process.env.PADDLE_PRICE_PREMIUM || '')
      : (process.env.PADDLE_PRICE_POWER   || '');
    const paddleRes = await fetch('https://api.paddle.com/transactions', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + PADDLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ price_id: priceId, quantity: 1 }] })
    });
    const paddleData = await paddleRes.json();
    const url = paddleData?.data?.checkout?.url;
    if (!paddleRes.ok || !url) {
      console.error('[TAGFLOW CHECKOUT]', paddleData);
      return res.status(502).json({ success: false, error: 'Checkout oluşturulamadı.' });
    }
    res.json({ success: true, checkout_url: url });
  } catch (e) {
    console.error('[TAGFLOW CHECKOUT ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tagflow/admin/users
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/users', requireAdmin, (req, res) => {
  try {
    const users = db().prepare(
      'SELECT id,email,plan,role,used_today,last_reset,created_at,account_status,daily_limit_override,admin_note FROM tagflow_users ORDER BY created_at DESC'
    ).all();
    res.json({ success: true, users });
  } catch (e) {
    console.error('[TAGFLOW ADMIN USERS]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tagflow/admin/users/:id
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const allowed = ['plan', 'role', 'account_status', 'daily_limit_override', 'admin_note'];
  const fields  = Object.keys(req.body || {}).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ success: false, error: 'Güncellenecek alan yok.' });

  // Prevent de-owning OWNER_EMAIL
  const target = db().prepare('SELECT email,role FROM tagflow_users WHERE id=?').get(id);
  if (!target) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
  if (target.email === OWNER_EMAIL && req.body.role && req.body.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Owner rolü değiştirilemez.' });
  }

  try {
    const set = fields.map(f => `${f}=?`).join(', ');
    const val = fields.map(f => req.body[f]);
    db().prepare(`UPDATE tagflow_users SET ${set} WHERE id=?`).run(...val, id);
    console.log('[TAGFLOW ADMIN PATCH]', id, req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('[TAGFLOW ADMIN PATCH ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/admin/users/:id/add-credit
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/users/:id/add-credit', requireAdmin, (req, res) => {
  const { id }     = req.params;
  const { amount } = req.body || {};
  if (!amount || isNaN(amount)) return res.status(400).json({ success: false, error: 'Miktar gerekli.' });
  try {
    db().prepare('UPDATE tagflow_users SET used_today=MAX(0,used_today-?) WHERE id=?').run(Number(amount), id);
    console.log('[TAGFLOW ADMIN ADD-CREDIT]', id, amount);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/admin/users/:id/reset-usage
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/users/:id/reset-usage', requireAdmin, (req, res) => {
  const { id } = req.params;
  try {
    db().prepare('UPDATE tagflow_users SET used_today=0, last_reset=? WHERE id=?').run(today(), id);
    console.log('[TAGFLOW ADMIN RESET-USAGE]', id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

export default router;
