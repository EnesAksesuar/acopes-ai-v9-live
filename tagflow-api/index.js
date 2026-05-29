/**
 * TagFlow API — Standalone Server
 * Product: ACOPES AI · TagFlow
 * Domain:  tagflow.acopesai.com
 *
 * Routes: /api/tagflow/* only
 * Completely independent from ACOPES AI V9.
 */

import dotenv        from 'dotenv';
import express       from 'express';
import path          from 'node:path';
import { fileURLToPath } from 'node:url';
import tagflowRouter from './router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const app       = express();
const PORT      = process.env.PORT || 4200;
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// ── Middleware ────────────────────────────────────────────────────────────────
// Capture rawBody for Paddle webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); }
}));
app.use((_req, res, next) => {
  res.setTimeout(15_000, () => {
    if (!res.headersSent) res.status(504).json({ success: false, error: 'timeout' });
  });
  next();
});
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── TagFlow routes ────────────────────────────────────────────────────────────
app.use('/api/tagflow', tagflowRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tagflow-api', ts: new Date().toISOString() });
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`TagFlow API → http://localhost:${PORT}`);
    console.log(`  POST /api/tagflow/auth/signup`);
    console.log(`  POST /api/tagflow/auth/login`);
    console.log(`  GET  /api/tagflow/user/me`);
    console.log(`  POST /api/tagflow/analyze`);
    console.log(`  GET  /api/tagflow/billing/status`);
    console.log(`  POST /api/tagflow/billing/create-checkout`);
    console.log(`  POST /api/tagflow/billing/webhook`);
  });
}

export default app;
