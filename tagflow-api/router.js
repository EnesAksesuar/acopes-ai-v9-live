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

// ── Owner configuration ───────────────────────────────────────────────────────
const OWNER_EMAIL = 'enesaksesuar1@gmail.com';

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
  // ── Admin columns migration ──────────────────────────────────────────────
  const _adminCols = [
    "ALTER TABLE tagflow_users ADD COLUMN role                   TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE tagflow_users ADD COLUMN daily_limit_override   INTEGER",
    "ALTER TABLE tagflow_users ADD COLUMN account_status         TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE tagflow_users ADD COLUMN admin_note             TEXT",
    "ALTER TABLE tagflow_users ADD COLUMN billing_subscription_id TEXT"
  ];
  for (const sql of _adminCols) {
    try { _db.exec(sql); } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
  }
  // ── Auto-assign owner role ────────────────────────────────────────────────
  try {
    _db.prepare("UPDATE tagflow_users SET role='owner' WHERE email=? AND role!='owner'")
       .run(OWNER_EMAIL);
  } catch {}
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

// ── Admin middleware (verifies role from DB — never trust JWT payload) ────────
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

// ── Credit helpers ────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function freshUser(user) {
  if (user.last_reset !== today()) {
    db().prepare('UPDATE tagflow_users SET used_today=0, last_reset=? WHERE id=?').run(today(), user.id);
    return { ...user, used_today: 0, last_reset: today() };
  }
  return user;
}
// ── Effective daily limit (-1 = unlimited) ────────────────────────────────────
function effectiveLimit(user) {
  const role = user.role || 'user';
  if (role === 'owner' || role === 'admin') return -1;
  if (user.daily_limit_override != null)    return user.daily_limit_override;
  return PLAN_LIMITS[user.plan] ?? 15;
}

function creditInfo(user) {
  const limit = effectiveLimit(user);
  const meta  = PLAN_META[user.plan] || PLAN_META.free;
  const role  = user.role || 'user';
  return {
    plan:                 user.plan,
    role,
    plan_name:            meta.name,
    plan_price:           meta.price,
    daily_limit:          limit === -1 ? null : limit,
    daily_limit_override: user.daily_limit_override ?? null,
    account_status:       user.account_status || 'active',
    used_today:           user.used_today,
    remaining:            limit === -1 ? null : Math.max(0, limit - (user.used_today || 0)),
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

    const id = crypto.randomUUID();
    db().prepare(
      'INSERT INTO tagflow_users (id,email,password_hash,plan,created_at,used_today,last_reset) VALUES (?,?,?,?,?,0,?)'
    ).run(id, cleanEmail, hashPwd(password), 'free', new Date().toISOString(), today());

    // Assign owner role for the owner email
    const userRole = cleanEmail === OWNER_EMAIL ? 'owner' : 'user';
    if (userRole === 'owner') db().prepare("UPDATE tagflow_users SET role='owner' WHERE id=?").run(id);

    const newUser = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(id);
    const token   = signTok({ userId: id, email: cleanEmail, plan: 'free', role: userRole });
    console.log('[TAGFLOW SIGNUP]', cleanEmail, 'role=' + userRole);
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
    // Ensure owner email always has owner role (safety net for pre-migration rows)
    if (cleanEmail === OWNER_EMAIL && (user.role || 'user') !== 'owner') {
      db().prepare("UPDATE tagflow_users SET role='owner' WHERE id=?").run(user.id);
      user = { ...user, role: 'owner' };
    }
    const token = signTok({ userId: user.id, email: user.email, plan: user.plan, role: user.role || 'user' });
    console.log('[TAGFLOW LOGIN]', cleanEmail, user.plan, 'role=' + (user.role || 'user'));
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

    // ── Account status check ─────────────────────────────────────────
    if ((user.account_status || 'active') !== 'active') {
      return res.status(403).json({ success: false, error: 'Hesabınız devre dışı bırakıldı.' });
    }

    // ── Plan / Credit check (owner/admin = unlimited) ─────────────────
    const limit = effectiveLimit(user);
    if (limit !== -1 && user.used_today >= limit) {
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

// ── Billing helper ────────────────────────────────────────────────────────────
function planFromPriceId(priceId) {
  if (priceId && priceId === PADDLE_PRICES.power)   return 'power';
  if (priceId && priceId === PADDLE_PRICES.premium) return 'premium';
  return null;
}

// POST /api/tagflow/billing/create-checkout
// Body: { plan: 'premium' | 'power' }
// Returns: { success, checkout_url, placeholder? }
// NOTE: Configure success/cancel redirect URLs in Paddle Dashboard →
//   Settings → Checkout → Redirect users to a custom URL after payment:
//   Success: https://acopesai.com/pricing?checkout=success
//   Cancel:  https://acopesai.com/pricing?checkout=cancelled
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

    // Paddle v2: customer_id (returning) OR customer.email (new) — never both
    const txnBody = {
      items:           [{ price_id: priceId, quantity: 1 }],
      custom_data:     { tagflow_user_id: user.id },
      collection_mode: 'automatic',
      ...(user.billing_customer_id
        ? { customer_id: user.billing_customer_id }
        : { customer:   { email: user.email } })
    };

    const paddleRes = await fetch(`${PADDLE_BASE_URL}/transactions`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${PADDLE_API_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(txnBody)
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
    // ── transaction.completed — payment cleared (one-time or first sub charge) ─
    if (type === 'transaction.completed') {
      const userId     = event.data?.custom_data?.tagflow_user_id;
      const priceId    = event.data?.items?.[0]?.price?.id || '';
      const customerId = event.data?.customer_id || null;
      const plan       = planFromPriceId(priceId);

      if (!userId || !plan) {
        console.warn('[BILLING WEBHOOK] transaction.completed — cannot map user/plan:', { userId, priceId });
        return res.status(200).json({ received: true, warning: 'Could not map to plan' });
      }
      db().prepare(`
        UPDATE tagflow_users
        SET plan=?, subscription_status='active', billing_provider='paddle',
            billing_customer_id=COALESCE(?, billing_customer_id)
        WHERE id=?
      `).run(plan, customerId, userId);
      console.log(`[BILLING WEBHOOK] transaction.completed → userId=${userId} plan=${plan}`);
    }

    // ── subscription.created | subscription.activated | subscription.updated ─
    else if ([
      'subscription.created',
      'subscription.activated',
      'subscription.updated'
    ].includes(type)) {
      const userId     = event.data?.custom_data?.tagflow_user_id;
      const priceId    = event.data?.items?.[0]?.price?.id || '';
      const customerId = event.data?.customer_id || null;
      const status     = event.data?.status      || 'active';
      const renewal    = event.data?.next_billed_at || null;
      const plan       = planFromPriceId(priceId);

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
      console.log(`[BILLING WEBHOOK] ${type} → userId=${userId} plan=${plan} status=${status}`);
    }

    // ── subscription.canceled | subscription.cancelled | subscription.paused ─
    // Paddle v2 sends "canceled" (US). Accept both spellings for safety.
    else if ([
      'subscription.canceled',
      'subscription.cancelled',
      'subscription.paused'
    ].includes(type)) {
      const userId    = event.data?.custom_data?.tagflow_user_id;
      const newStatus = type === 'subscription.paused' ? 'paused' : 'canceled';
      if (userId) {
        db().prepare(`
          UPDATE tagflow_users
          SET plan='free', subscription_status=?, subscription_renewal=NULL
          WHERE id=?
        `).run(newStatus, userId);
        console.log(`[BILLING WEBHOOK] ${type} → userId=${userId} downgraded to free`);
      }
    }

    // ── subscription.past_due ─────────────────────────────────────────────
    else if (type === 'subscription.past_due') {
      const userId = event.data?.custom_data?.tagflow_user_id;
      if (userId) {
        db().prepare(`UPDATE tagflow_users SET subscription_status='past_due' WHERE id=?`).run(userId);
        console.log(`[BILLING WEBHOOK] past_due → userId=${userId}`);
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
// ADMIN ROUTES  (/api/tagflow/admin/*)
// All routes require owner or admin role — verified from DB, never from JWT.
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tagflow/admin/users
router.get('/admin/users', requireAdmin, (req, res) => {
  try {
    const users = db().prepare(`
      SELECT id, email, plan, role, daily_limit_override, account_status,
             admin_note, used_today, last_reset,
             billing_customer_id, billing_subscription_id,
             subscription_status, subscription_renewal, created_at
      FROM tagflow_users ORDER BY created_at DESC
    `).all();
    const result = users.map(u => ({ ...u, effective_daily_limit: effectiveLimit(u) }));
    res.json({ success: true, users: result, total: result.length });
  } catch (e) {
    console.error('[ADMIN USERS ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// PATCH /api/tagflow/admin/users/:id
router.patch('/admin/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { plan, role, daily_limit_override, account_status, admin_note } = req.body || {};
  if (plan           && !['free','premium','power'].includes(plan))
    return res.status(400).json({ success: false, error: 'Geçersiz plan.' });
  if (role           && !['user','admin','owner'].includes(role))
    return res.status(400).json({ success: false, error: 'Geçersiz rol.' });
  if (account_status && !['active','disabled'].includes(account_status))
    return res.status(400).json({ success: false, error: 'Geçersiz hesap durumu.' });
  try {
    if (!db().prepare('SELECT id FROM tagflow_users WHERE id=?').get(id))
      return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    const sets = []; const vals = [];
    if (plan                !== undefined) { sets.push('plan=?');                 vals.push(plan); }
    if (role                !== undefined) { sets.push('role=?');                 vals.push(role); }
    if (daily_limit_override!== undefined) { sets.push('daily_limit_override=?'); vals.push(daily_limit_override); }
    if (account_status      !== undefined) { sets.push('account_status=?');       vals.push(account_status); }
    if (admin_note          !== undefined) { sets.push('admin_note=?');           vals.push(admin_note); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Güncellenecek alan yok.' });
    vals.push(id);
    db().prepare(`UPDATE tagflow_users SET ${sets.join(',')} WHERE id=?`).run(...vals);
    const u = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(id);
    console.log(`[ADMIN PATCH] id=${id} by=${req.tf.userId}`);
    const { password_hash: _ph, ...safe } = u;
    res.json({ success: true, user: { ...safe, effective_daily_limit: effectiveLimit(u) } });
  } catch (e) {
    console.error('[ADMIN PATCH ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// POST /api/tagflow/admin/users/:id/add-credit
router.post('/admin/users/:id/add-credit', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount))
    return res.status(400).json({ success: false, error: 'amount must be a positive integer.' });
  try {
    const u = db().prepare('SELECT * FROM tagflow_users WHERE id=?').get(id);
    if (!u) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    const base     = u.daily_limit_override ?? (PLAN_LIMITS[u.plan] ?? 15);
    const newLimit = base + amount;
    db().prepare('UPDATE tagflow_users SET daily_limit_override=? WHERE id=?').run(newLimit, id);
    console.log(`[ADMIN ADD-CREDIT] id=${id} +${amount} → ${newLimit}`);
    res.json({ success: true, daily_limit_override: newLimit, effective_daily_limit: newLimit });
  } catch (e) {
    console.error('[ADMIN ADD-CREDIT ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

// POST /api/tagflow/admin/users/:id/reset-usage
router.post('/admin/users/:id/reset-usage', requireAdmin, (req, res) => {
  const { id } = req.params;
  try {
    if (!db().prepare('SELECT id FROM tagflow_users WHERE id=?').get(id))
      return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
    db().prepare('UPDATE tagflow_users SET used_today=0, last_reset=? WHERE id=?').run(today(), id);
    console.log(`[ADMIN RESET-USAGE] id=${id} by=${req.tf.userId}`);
    res.json({ success: true, used_today: 0 });
  } catch (e) {
    console.error('[ADMIN RESET-USAGE ERROR]', e.message);
    res.status(500).json({ success: false, error: 'Sunucu hatası.' });
  }
});

export default router;
