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

// ── Plan limits (analyses / day) ─────────────────────────────────────────────
const PLAN_LIMITS = { free: 15, premium: 250, power: 9999 };

// ── Plan display metadata ─────────────────────────────────────────────────────
const PLAN_META = {
  free:    { name: 'Free',         price: '$0',     limit: 15   },
  premium: { name: 'Premium',      price: '$6.99',  limit: 250  },
  power:   { name: 'Power Seller', price: '$10.99', limit: 9999 }
};

// ── Paddle config (set env vars to go live; placeholder mode until then) ──────
const PADDLE_API_KEY        = (process.env.PADDLE_API_KEY        || '').trim();
const PADDLE_WEBHOOK_SECRET = (process.env.PADDLE_WEBHOOK_SECRET || '').trim();
const PADDLE_SANDBOX        = process.env.PADDLE_SANDBOX === 'true';
const PADDLE_BASE_URL       = PADDLE_SANDBOX
  ? 'https://sandbox-api.paddle.com'
  : 'https://api.paddle.com';
// TODO: Create products in Paddle dashboard, then set these env vars in Railway
const PADDLE_PRICES = {
  premium: (process.env.PADDLE_PRICE_PREMIUM || 'TODO_PADDLE_PRICE_PREMIUM').trim(),
  power:   (process.env.PADDLE_PRICE_POWER   || 'TODO_PADDLE_PRICE_POWER'  ).trim()
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
  // ── Billing columns migration (safe for existing DBs without these cols) ────
  const _billingCols = [
    'ALTER TABLE tagflow_users ADD COLUMN subscription_status  TEXT',
    'ALTER TABLE tagflow_users ADD COLUMN billing_provider     TEXT',
    'ALTER TABLE tagflow_users ADD COLUMN billing_customer_id  TEXT',
    'ALTER TABLE tagflow_users ADD COLUMN subscription_renewal TEXT'
  ];
  for (const sql of _billingCols) {
    try { _db.exec(sql); } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
  }
  // ── Admin columns migration ───────────────────────────────────────────────
  const _adminCols = [
    'ALTER TABLE tagflow_users ADD COLUMN daily_limit_override INTEGER',
    "ALTER TABLE tagflow_users ADD COLUMN account_status       TEXT NOT NULL DEFAULT 'active'",
    'ALTER TABLE tagflow_users ADD COLUMN admin_note           TEXT'
  ];
  for (const sql of _adminCols) {
    try { _db.exec(sql); } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
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

// ── Admin middleware (owner email = always allowed; others → 403) ─────────────
function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '').trim();
  if (!tok) return res.status(401).json({ success: false, error: 'Token gerekli.' });
  try {
    req.tf = verifyTok(tok);
  } catch {
    return res.status(401).json({ success: false, error: 'Geçersiz token.' });
  }
  if (String(req.tf.email || '').toLowerCase() === OWNER_EMAIL) {
    req.tf.role = 'owner';
    return next();
  }
  return res.status(403).json({ success: false, error: 'Bu işlem için yetkiniz yok.' });
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
// Effective daily limit — admin override takes priority over plan default
function effectiveLimit(user) {
  if (user.daily_limit_override != null) return user.daily_limit_override;
  return PLAN_LIMITS[user.plan] ?? 15;
}
function creditInfo(user) {
  const limit = effectiveLimit(user);
  const meta  = PLAN_META[user.plan] || PLAN_META.free;
  return {
    plan:                  user.plan,
    plan_name:             meta.name,
    plan_price:            meta.price,
    daily_limit:           limit,
    daily_limit_override:  user.daily_limit_override ?? null,
    account_status:        user.account_status || 'active',
    used_today:            user.used_today,
    remaining:             Math.max(0, limit - (user.used_today || 0)),
    subscription_status:   user.subscription_status  || null,
    subscription_renewal:  user.subscription_renewal || null,
    billing_provider:      user.billing_provider     || null
  };
}

// ── Temporary deployment probe (no auth) ─────────────────────────────────────
router.get('/probe', (_req, res) => {
  res.json({ probe: 'OWNER_PATCH_ACTIVE_v3', ts: new Date().toISOString() });
});

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

    const id = crypto.randomUUID();
    db().prepare(
      'INSERT INTO tagflow_users (id,email,password_hash,plan,created_at,used_today,last_reset) VALUES (?,?,?,?,?,0,?)'
    ).run(id, cleanEmail, hashPwd(password), 'free', new Date().toISOString(), today());

    const token = signTok({ userId: id, email: cleanEmail, plan: 'free' });
    console.log('[TAGFLOW SIGNUP]', cleanEmail);
    res.json({ success: true, token, ...creditInfo({ plan: 'free', used_today: 0 }) });
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
    const token = signTok({ userId: user.id, email: user.email, plan: user.plan });
    console.log('[TAGFLOW LOGIN]', cleanEmail, user.plan);
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
    // ── Hard owner check on JWT email — no DB/migration dependency ───────────
    if (String(req.tf.email || '').toLowerCase() === 'enesaksesuar1@gmail.com') {
      return res.json({
        success:              true,
        email:                req.tf.email,
        plan:                 'free',
        plan_name:            'Owner',
        plan_price:           '$0',
        role:                 'owner',
        account_status:       'active',
        used_today:           0,
        daily_limit:          null,
        daily_limit_override: null,
        remaining:            null,
        unlimited:            true,
        owner_debug:          'OWNER_PATCH_ACTIVE',
        subscription_status:  null,
        subscription_renewal: null,
        billing_provider:     null
      });
    }
    let user = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(req.tf.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    user = freshUser(user);
    res.json({ success: true, email: user.email, ...creditInfo(user) });
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

    // ── Plan / Credit check ─────────────────────────────────────────
    const limit = PLAN_LIMITS[user.plan] ?? 15;
    if (user.used_today >= limit) {
      return res.status(429).json({
        success: false,
        error:   `Günlük limit doldu (${user.used_today}/${limit}). Planınızı yükselterek daha fazla analiz yapın.`,
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
// BILLING ROUTES  (/api/tagflow/billing/*)
// Paddle-ready — placeholder mode when PADDLE_API_KEY is not set.
// To go live: set PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_PRICE_PREMIUM,
//             PADDLE_PRICE_POWER in Railway Variables.
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tagflow/billing/status
router.get('/billing/status', requireAuth, (req, res) => {
  try {
    let user = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(req.tf.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    user = freshUser(user);
    res.json({
      success:         true,
      email:           user.email,
      available_plans: PLAN_META,
      ...creditInfo(user)
    });
  } catch (e) {
    console.error('[BILLING STATUS ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// POST /api/tagflow/billing/create-checkout
// Body: { plan: 'premium' | 'power' }
// Returns: { success, checkout_url, placeholder? }
router.post('/billing/create-checkout', requireAuth, async (req, res) => {
  const { plan } = req.body || {};
  if (!plan || !['premium', 'power'].includes(plan)) {
    return res.status(400).json({ success: false, error: "Plan 'premium' veya 'power' olmalı." });
  }

  // ── Placeholder mode — live when PADDLE_API_KEY is set ────────────────────
  if (!PADDLE_API_KEY || PADDLE_API_KEY.startsWith('TODO')) {
    const planLabel = plan === 'power' ? 'Power+Seller' : 'Premium';
    console.log(`[BILLING CHECKOUT] PLACEHOLDER plan=${plan} user=${req.tf.email}`);
    return res.json({
      success:      true,
      placeholder:  true,
      checkout_url: `https://tagflow.acopesai.com/upgrade?plan=${plan}&email=${encodeURIComponent(req.tf.email || '')}`,
      message:      'Paddle henüz yapılandırılmadı. Ödeme altyapısı yakında aktif olacak.'
    });
  }

  // ── Live Paddle Billing v2 ────────────────────────────────────────────────
  try {
    const user    = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(req.tf.userId);
    const priceId = PADDLE_PRICES[plan];
    if (!priceId || priceId.startsWith('TODO')) {
      return res.status(500).json({
        success: false,
        error:   `PADDLE_PRICE_${plan.toUpperCase()} env var eksik. Railway Variables'a ekleyin.`
      });
    }

    const paddleRes = await fetch(`${PADDLE_BASE_URL}/transactions`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items:           [{ price_id: priceId, quantity: 1 }],
        customer:        { email: user.email, ...(user.billing_customer_id ? { id: user.billing_customer_id } : {}) },
        custom_data:     { tagflow_user_id: user.id },
        collection_mode: 'automatic'
      })
    });

    const paddleData = await paddleRes.json();
    if (!paddleRes.ok) {
      console.error('[BILLING CHECKOUT] Paddle error:', JSON.stringify(paddleData).slice(0, 300));
      return res.status(502).json({ success: false, error: 'Paddle checkout oluşturulamadı.' });
    }

    const checkoutUrl = paddleData.data?.checkout?.url;
    console.log(`[BILLING CHECKOUT] plan=${plan} user=${user.email} → ${checkoutUrl}`);
    res.json({ success: true, checkout_url: checkoutUrl });
  } catch (e) {
    console.error('[BILLING CHECKOUT ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası: ' + e.message });
  }
});

// POST /api/tagflow/billing/webhook
// Set Paddle Notification URL to:
//   https://acopes-ai-production.up.railway.app/api/tagflow/billing/webhook
// TODO: Set PADDLE_WEBHOOK_SECRET in Railway env to enable signature verification.
// NOTE: index.js captures req.rawBody via express.json({ verify }) for this route.
router.post('/billing/webhook', async (req, res) => {
  // ── Signature verification ────────────────────────────────────────────────
  if (PADDLE_WEBHOOK_SECRET && !PADDLE_WEBHOOK_SECRET.startsWith('TODO')) {
    const sig  = req.headers['paddle-signature'] || '';
    const body = req.rawBody || '';
    const ts   = (sig.match(/ts=(\d+)/)         || [])[1] || '';
    const h1   = (sig.match(/h1=([a-f0-9]+)/)   || [])[1] || '';
    if (!ts || !h1) {
      console.warn('[BILLING WEBHOOK] Missing Paddle-Signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }
    const expected = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET)
      .update(`${ts}:${body}`).digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(h1, 'hex'), Buffer.from(expected, 'hex'))) {
        console.warn('[BILLING WEBHOOK] Signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch { return res.status(401).json({ error: 'Signature error' }); }
  } else {
    // TODO: Set PADDLE_WEBHOOK_SECRET to enable verification before going live
    console.warn('[BILLING WEBHOOK] PLACEHOLDER — signature not verified');
  }

  const event = req.body || {};
  const type  = event.event_type || 'unknown';
  console.log('[BILLING WEBHOOK] event_type:', type);

  try {
    // ── subscription.activated | subscription.updated ─────────────────────
    if (type === 'subscription.activated' || type === 'subscription.updated') {
      const userId     = event.data?.custom_data?.tagflow_user_id;
      const priceId    = event.data?.items?.[0]?.price?.id || '';
      const customerId = event.data?.customer_id || '';
      const status     = event.data?.status      || 'active';
      const renewal    = event.data?.next_billed_at || null;
      const plan       = priceId === PADDLE_PRICES.power    ? 'power'
                       : priceId === PADDLE_PRICES.premium   ? 'premium'
                       : null;

      if (!userId || !plan) {
        console.warn('[BILLING WEBHOOK] Cannot map to user/plan:', { userId, priceId });
        return res.status(200).json({ received: true, warning: 'Could not map to plan' });
      }

      db().prepare(`
        UPDATE tagflow_users
        SET plan=?, subscription_status=?, billing_provider='paddle',
            billing_customer_id=?, subscription_renewal=?
        WHERE id=?
      `).run(plan, status, customerId, renewal, userId);
      console.log(`[BILLING WEBHOOK] Upgraded userId=${userId} → plan=${plan} status=${status}`);
    }

    // ── subscription.cancelled | subscription.paused ──────────────────────
    else if (type === 'subscription.cancelled' || type === 'subscription.paused') {
      const userId    = event.data?.custom_data?.tagflow_user_id;
      const newStatus = type === 'subscription.paused' ? 'paused' : 'cancelled';
      if (userId) {
        db().prepare(`
          UPDATE tagflow_users
          SET plan='free', subscription_status=?, subscription_renewal=NULL
          WHERE id=?
        `).run(newStatus, userId);
        console.log(`[BILLING WEBHOOK] Downgraded userId=${userId} → free (${newStatus})`);
      }
    }

    // ── subscription.past_due ─────────────────────────────────────────────
    else if (type === 'subscription.past_due') {
      const userId = event.data?.custom_data?.tagflow_user_id;
      if (userId) {
        db().prepare(`UPDATE tagflow_users SET subscription_status='past_due' WHERE id=?`).run(userId);
        console.log(`[BILLING WEBHOOK] past_due userId=${userId}`);
      }
    }

    else {
      console.log(`[BILLING WEBHOOK] Unhandled event: ${type}`);
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error('[BILLING WEBHOOK ERROR]', e.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tagflow/admin/users
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/users', requireAdmin, (req, res) => {
  try {
    const rows = db().prepare(
      `SELECT id, email, plan, used_today, last_reset, created_at,
              subscription_status, subscription_renewal,
              daily_limit_override, account_status, admin_note
       FROM tagflow_users ORDER BY created_at DESC`
    ).all();
    // Attach effective limit so frontend doesn't need to compute it
    const users = rows.map(u => ({ ...u, effective_limit: effectiveLimit(u) }));
    res.json({ success: true, count: users.length, users });
  } catch (e) {
    console.error('[TAGFLOW ADMIN USERS]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tagflow/admin/users/:id
// Body: { plan?, daily_limit_override?, account_status?, admin_note? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { plan, daily_limit_override, account_status, admin_note } = req.body || {};

  if (plan !== undefined && !['free', 'premium', 'power'].includes(plan))
    return res.status(400).json({ success: false, error: 'Geçersiz plan.' });
  if (account_status !== undefined && !['active', 'disabled'].includes(account_status))
    return res.status(400).json({ success: false, error: "account_status 'active' veya 'disabled' olmalı." });

  try {
    const user = db().prepare('SELECT email FROM tagflow_users WHERE id=?').get(id);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    if (user.email.toLowerCase() === OWNER_EMAIL && account_status === 'disabled')
      return res.status(403).json({ success: false, error: 'Owner hesabı devre dışı bırakılamaz.' });

    const sets = [], vals = [];
    if (plan                !== undefined) { sets.push('plan=?');                 vals.push(plan); }
    if (daily_limit_override !== undefined) { sets.push('daily_limit_override=?'); vals.push(daily_limit_override); }
    if (account_status      !== undefined) { sets.push('account_status=?');       vals.push(account_status); }
    if (admin_note          !== undefined) { sets.push('admin_note=?');           vals.push(admin_note); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Güncellenecek alan yok.' });

    vals.push(id);
    db().prepare(`UPDATE tagflow_users SET ${sets.join(',')} WHERE id=?`).run(...vals);
    console.log(`[ADMIN PATCH] id=${id}`, sets.join(','));
    res.json({ success: true });
  } catch (e) {
    console.error('[ADMIN PATCH ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/admin/users/:id/add-credit
// Body: { amount: number }
// Logic: override = (override ?? planDefault) + amount
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/users/:id/add-credit', requireAdmin, (req, res) => {
  const { id }     = req.params;
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)
    return res.status(400).json({ success: false, error: 'amount pozitif tam sayı olmalı.' });

  try {
    const user = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(id);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });

    const base     = user.daily_limit_override ?? (PLAN_LIMITS[user.plan] ?? 15);
    const newLimit = base + amount;
    db().prepare('UPDATE tagflow_users SET daily_limit_override=? WHERE id=?').run(newLimit, id);
    console.log(`[ADMIN ADD-CREDIT] id=${id} +${amount} → ${newLimit}`);
    res.json({ success: true, daily_limit_override: newLimit });
  } catch (e) {
    console.error('[ADMIN ADD-CREDIT ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tagflow/admin/users/:id/reset-usage
// Sets used_today = 0 for today
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/users/:id/reset-usage', requireAdmin, (req, res) => {
  const { id } = req.params;
  try {
    const user = db().prepare('SELECT id FROM tagflow_users WHERE id=?').get(id);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    db().prepare('UPDATE tagflow_users SET used_today=0, last_reset=? WHERE id=?').run(today(), id);
    console.log(`[ADMIN RESET-USAGE] id=${id}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[ADMIN RESET-USAGE ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tagflow/admin/users/:id/plan
// Body: { plan: 'free'|'premium'|'power' }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/users/:id/plan', requireAdmin, (req, res) => {
  const { id }   = req.params;
  const { plan } = req.body || {};
  if (!['free', 'premium', 'power'].includes(plan))
    return res.status(400).json({ success: false, error: "Plan 'free', 'premium' veya 'power' olmalı." });

  try {
    const user = db().prepare('SELECT id FROM tagflow_users WHERE id=?').get(id);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    db().prepare('UPDATE tagflow_users SET plan=? WHERE id=?').run(plan, id);
    console.log(`[ADMIN SET-PLAN] id=${id} → ${plan}`);
    res.json({ success: true, plan });
  } catch (e) {
    console.error('[ADMIN SET-PLAN ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/tagflow/admin/users/:id/status
// Body: { account_status: 'active'|'disabled' }
// Owner account cannot be disabled.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/admin/users/:id/status', requireAdmin, (req, res) => {
  const { id }             = req.params;
  const { account_status } = req.body || {};
  if (!['active', 'disabled'].includes(account_status))
    return res.status(400).json({ success: false, error: "account_status 'active' veya 'disabled' olmalı." });

  try {
    const user = db().prepare('SELECT email FROM tagflow_users WHERE id=?').get(id);
    if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    if (user.email.toLowerCase() === OWNER_EMAIL && account_status === 'disabled')
      return res.status(403).json({ success: false, error: 'Owner hesabı devre dışı bırakılamaz.' });
    db().prepare('UPDATE tagflow_users SET account_status=? WHERE id=?').run(account_status, id);
    console.log(`[ADMIN SET-STATUS] id=${id} → ${account_status}`);
    res.json({ success: true, account_status });
  } catch (e) {
    console.error('[ADMIN SET-STATUS ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

export default router;
