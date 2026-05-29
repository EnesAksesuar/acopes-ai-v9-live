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

// ── Plan limits (-1 = unlimited) ─────────────────────────────────────────────
const PLAN_LIMITS = { free: 15, premium: -1, power: -1 };

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
  const limit = PLAN_LIMITS[user.plan] ?? 15;
  return {
    plan:       user.plan,
    daily_limit: limit,
    used_today: user.used_today,
    remaining:  limit === -1 ? null : Math.max(0, limit - user.used_today)
  };
}

// ── CORS (Chrome extension → backend) ────────────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

export default router;
