import dotenv from "dotenv";
import express from "express";
import cookieSession from "cookie-session";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import nodeCrypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED:", err?.stack || err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
console.log("ENV DEBUG", {
  hasClientId: Boolean(process.env.ETSY_CLIENT_ID),
  hasClientSecret: Boolean(process.env.ETSY_CLIENT_SECRET),
  secretLength: process.env.ETSY_CLIENT_SECRET?.length || 0
});

const app = express();
await loadDotEnv(path.join(__dirname, ".env"));
const PORT = process.env.PORT || 4173;
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const runtimeDataDir = path.join(process.env.ACOPES_DATA_DIR || "/tmp", "acopes-ai");
const seedDataDir = path.join(__dirname, "data");
const WEBHOOK_URL = (process.env.MAKE_WEBHOOK_URL || "").trim();
const MAKE_RESPONSE_SECRET = (process.env.MAKE_RESPONSE_SECRET || "").trim();
const SESSION_SECRET = process.env.SESSION_SECRET || "acopes2026secret";
const ADMIN_SECRET = (process.env.ADMIN_SECRET || "").trim();
const logsPath = path.join(runtimeDataDir, "automation-logs.json");
const legacyListingsCachePath = path.join(seedDataDir, "etsy-listings.json");
const listingsSeedPath = path.join(seedDataDir, "listings.json");
const listingsCachePath = path.join(runtimeDataDir, "listings.json");
const optimizationsPath = path.join(runtimeDataDir, "optimization-history.json");
const optimizationsSeedPath = path.join(seedDataDir, "optimization-history.json");
const queuePath = path.join(runtimeDataDir, "optimization-queue.json");
const queueSeedPath = path.join(seedDataDir, "optimization-queue.json");
const usersPath = path.join(runtimeDataDir, "users.json");
const usersSeedPath = path.join(seedDataDir, "users.json");
const etsyTokensPath = path.join(runtimeDataDir, "etsy-tokens.json");
const etsyTokensSeedPath = path.join(seedDataDir, "etsy-tokens.json");
const waitlistPath = path.join(runtimeDataDir, "waitlist.json");
const analyticsPath = path.join(runtimeDataDir, "analytics.json");
const analyticsSeedPath = path.join(seedDataDir, "analytics.json");
const listingsMetaPath = path.join(runtimeDataDir, "listings-meta.json");
const ETSY_CLIENT_ID = (process.env.ETSY_CLIENT_ID || "").trim();
const ETSY_CLIENT_SECRET = (process.env.ETSY_CLIENT_SECRET || "").trim();
const ETSY_REDIRECT_URI = (process.env.ETSY_REDIRECT_URI || `http://localhost:${PORT}/api/etsy/callback`).trim();
const REQUIRED_ETSY_SCOPES = ["listings_r", "listings_w", "shops_r"];
const ETSY_SCOPES = [...new Set(`${process.env.ETSY_SCOPES || ""} ${REQUIRED_ETSY_SCOPES.join(" ")}`.trim().split(/\s+/).filter(Boolean))].join(" ");
const ETSY_AUTH_URL = "https://www.etsy.com/oauth/connect";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_API_BASE = "https://api.etsy.com/v3/application";
const ETSY_API_FALLBACK_BASE = "https://openapi.etsy.com/v3/application";
const FALLBACK_SHOP_NAME = (process.env.ETSY_SHOP_NAME || "EDELLUXE").trim();
const FALLBACK_SHOP_URL = (process.env.ETSY_SHOP_URL || "").trim();
const ETSY_ACCESS_TOKEN_ENV = (process.env.ETSY_ACCESS_TOKEN || "").trim();
const ETSY_REFRESH_TOKEN_ENV = (process.env.ETSY_REFRESH_TOKEN || "").trim();
const ETSY_TOKEN_EXPIRES_AT_ENV = (process.env.ETSY_TOKEN_EXPIRES_AT || "").trim();
const ETSY_SHOP_ID_ENV = (process.env.ETSY_SHOP_ID || "").trim();
console.log("ETSY_CLIENT_ID first 6 chars:", process.env.ETSY_CLIENT_ID?.slice(0, 6) || "");
console.log("ETSY_CLIENT_SECRET exists:", Boolean(process.env.ETSY_CLIENT_SECRET));
const FREE_OPTIMIZATION_LIMIT = 15;
const ETSY_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const PLAN_CREDITS = {
  free: 15,
  pro: 100,
  agency: 500
};

async function loadDotEnv(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...valueParts] = line.split("=");
      const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
      if (process.env[key.trim()] === undefined) process.env[key.trim()] = value;
    }
  } catch {
    // Local .env is optional. Production should provide environment variables.
  }
}

app.use("/api/make-response", express.text({ type: "*/*", limit: "2mb" }));
app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.setTimeout(8000, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: "timeout" });
    }
  });
  next();
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cookieSession({
  name: "acopes_session",
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: true,
  sameSite: "none",
  httpOnly: true
}));
app.post("/api/test-make-response", handleTestMakeResponse);
app.get("/api/routes-debug", (_req, res) => {
  res.status(200).json({
    testMakeResponseMounted: true,
    staticMounted: true
  });
});
console.log("ROUTE REGISTERED POST /api/test-make-response");
console.log("Server route order initialized");
app.use(express.static(path.join(__dirname, "public")));
console.log("STATIC MOUNTED");

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [key, ...value] = item.split("=");
        return [key, decodeURIComponent(value.join("="))];
      })
  );
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function base64UrlDecode(value = "") {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}

function authCookieOptions(maxAge = 60 * 60 * 24 * 30) {
  const secure = process.env.NODE_ENV === "production" || IS_VERCEL ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function publicEtsyAuth(tokens = {}) {
  return {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || "",
    expires_at: tokens.expires_at || 0,
    user_id: tokens.user_id || "",
    shop_id: tokens.shop_id || "",
    shop_name: tokens.shop_name || "",
    shop_url: tokens.shop_url || "",
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || ETSY_SCOPES,
    updated_at: new Date().toISOString()
  };
}

function readEtsyAuthCookie(req) {
  return {};
}

function setEtsyAuthCookie(res, tokens = {}) {
  clearEtsyAuthCookie(res);
}

function clearEtsyAuthCookie(res) {
  appendSetCookie(res, `acopes_etsy_auth=; ${authCookieOptions(0)}`);
}

function setOauthCookie(res, name, value, maxAge = 600) {
  appendSetCookie(res, `${name}=${encodeURIComponent(value || "")}; ${authCookieOptions(maxAge)}`);
}

function clearOauthCookies(res) {
  setOauthCookie(res, "acopes_etsy_oauth_state", "", 0);
  setOauthCookie(res, "acopes_etsy_code_verifier", "", 0);
}

async function persistEtsyAuth(res, tokens = {}) {
  const auth = publicEtsyAuth(tokens);
  clearEtsyAuthCookie(res);
  return auth;
}

async function persistRequestEtsyAuth(req, res, tokens = {}) {
  const auth = await persistEtsyAuth(res, tokens);
  if (req?.session) {
    const user = await saveUserEtsyAuth(req.session, auth);
    req.user = user;
    req.etsyAuth = user?.etsy_auth || auth;
  }
  return auth;
}

app.use(async (req, res, next) => {
  req.session ||= {};
  req.session.acopes_session_id ||= crypto.randomUUID();
  req.session.created_at ||= new Date().toISOString();
  req.session.optimizations_used ||= 0;
  req.session.onboarding_completed ||= false;
  req.session.store_name ||= "";
  req.session.email ||= "";
  req.session.user_id ||= "";
  next();
});

app.use((req, _res, next) => {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    next();
    return;
  }
  try {
    const payload = jwt.verify(match[1], SESSION_SECRET);
    if (payload?.email) req.session.email = normalizeEmail(payload.email);
    if (payload?.user_id) req.session.user_id = payload.user_id;
    if (payload?.etsy_auth) req.session.etsy_auth = payload.etsy_auth;
    req.session.onboarding_completed = true;
  } catch (error) {
    console.log("[JWT AUTH] invalid token", { message: error instanceof Error ? error.message : String(error) });
  }
  next();
});

app.use(async (req, _res, next) => {
  if (!req.path.startsWith("/api/") && !req.path.startsWith("/auth/")) {
    next();
    return;
  }
  req.user = await getSessionUser(req.session);
  req.etsyAuth = await resolveRequestEtsyAuth(req);
  next();
});

function requireUser(req, res, next) {
  if (req.session?.email) {
    next();
    return;
  }
  res.status(401).json({ success: false, error: "login_required", message: "Login required." });
}

app.post("/api/send-batch", requireUser, handleSendBatch);
function sessionEmail(req) {
  return normalizeEmail(req.session?.email || req.user?.email || "");
}

function belongsToSessionEmail(item = {}, req) {
  const email = sessionEmail(req);
  return Boolean(email && normalizeEmail(item.email) === email);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    res.status(503).json(errorResponse("admin_not_configured", "ADMIN_SECRET is not configured."));
    return;
  }
  if (String(req.get("x-admin-secret") || "") !== ADMIN_SECRET) {
    res.status(401).json(errorResponse("admin_unauthorized", "Invalid admin secret."));
    return;
  }
  next();
}

function createAuthToken(user = {}, etsyAuth = null) {
  return jwt.sign(
    {
      email: normalizeEmail(user.email),
      user_id: user.id || user.user_id || "",
      etsy_auth: etsyAuth || user.etsy_auth || null
    },
    SESSION_SECRET,
    { expiresIn: "7d" }
  );
}

async function ensureLogsFile() {
  try {
    await fs.access(logsPath);
  } catch {
    await writeJsonFile(logsPath, await readJsonFile(path.join(seedDataDir, "automation-logs.json"), []));
  }
}

async function readLogs() {
  await ensureLogsFile();
  return parseJsonText(await fs.readFile(logsPath, "utf8"), []);
}

async function writeLogs(logs) {
  await fs.writeFile(logsPath, `${JSON.stringify(logs, null, 2)}\n`, "utf8");
}

async function readListingsCache(expectedShopId = "") {
  const normalizedExpectedShopId = normalizeListingId(expectedShopId);
  try {
    if (normalizedExpectedShopId) {
      const meta = await readListingsMeta();
      console.log("[LISTINGS CACHE SHOP CHECK]", {
        expected_shop_id: normalizedExpectedShopId,
        cache_shop_id: normalizeListingId(meta.shop_id || "")
      });
      if (normalizeListingId(meta.shop_id || "") !== normalizedExpectedShopId) {
        console.log("[LISTINGS CACHE IGNORED]", {
          expected_shop_id: normalizedExpectedShopId,
          cache_shop_id: normalizeListingId(meta.shop_id || "")
        });
        console.log("[FORCE RESYNC REQUIRED]", { reason: "shop_id_mismatch" });
        return [];
      }
    }
    const listings = parseJsonText(await fs.readFile(listingsCachePath, "utf8"), []);
    if (Array.isArray(listings) && listings.length) return listings;
  } catch {
    // Fall back to seeded cache files for backward compatibility.
  }
  if (normalizedExpectedShopId) {
    console.log("[LISTINGS CACHE IGNORED]", { expected_shop_id: normalizedExpectedShopId, reason: "no_authenticated_cache" });
    console.log("[FORCE RESYNC REQUIRED]", { reason: "missing_authenticated_cache" });
    return [];
  }
  try {
    const listings = parseJsonText(await fs.readFile(listingsSeedPath, "utf8"), []);
    if (Array.isArray(listings) && listings.length) return listings;
  } catch {
    // Legacy seed file remains supported.
  }
  try {
    return parseJsonText(await fs.readFile(legacyListingsCachePath, "utf8"), []);
  } catch {
    return [];
  }
}

async function writeListingsCache(listings, meta = {}) {
  const normalizedListings = Array.isArray(listings) ? listings.map(normalizeListing) : [];
  await writeJsonFile(listingsCachePath, normalizedListings);
  await writeJsonFile(listingsMetaPath, {
    ...meta,
    count: normalizedListings.length,
    updated_at: new Date().toISOString()
  });
  return normalizedListings;
}

function parseJsonText(text, fallback = []) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!cleaned) return fallback;
  return JSON.parse(cleaned);
}

async function readJsonFile(filePath, fallback = []) {
  try {
    return parseJsonText(await fs.readFile(filePath, "utf8"), fallback);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readRuntimeJson(runtimePath, seedPath, fallback = []) {
  try {
    return parseJsonText(await fs.readFile(runtimePath, "utf8"), fallback);
  } catch {
    try {
      return parseJsonText(await fs.readFile(seedPath, "utf8"), fallback);
    } catch {
      return fallback;
    }
  }
}

async function withTimeout(promise, timeoutMs = 3000, fallback = []) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readRuntimeJsonFast(runtimePath, seedPath, fallback = []) {
  return withTimeout(readRuntimeJson(runtimePath, seedPath, fallback), 3000, fallback);
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

async function readUsers() {
  return readRuntimeJson(usersPath, usersSeedPath, []);
}

async function writeUsers(users) {
  await writeJsonFile(usersPath, users);
}

async function getOrCreateUser(email, defaults = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const users = await readUsers();
  let user = users.find((item) => item.email === normalizedEmail);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      plan: "free",
      credits_remaining: PLAN_CREDITS.free,
      credits_granted: PLAN_CREDITS.free,
      optimizations_used: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...defaults
    };
    users.push(user);
    await writeUsers(users);
  }

  return user;
}

async function getSessionUser(session) {
  const users = await readUsers();
  let user = null;

  if (session.user_id) {
    user = users.find((item) => item.id === session.user_id) || null;
  }

  if (!user && session.email) {
    user = users.find((item) => item.email === normalizeEmail(session.email)) || null;
    if (!user) {
      user = await getOrCreateUser(session.email);
    }
  }

  return user;
}

async function resolveRequestEtsyAuth(req) {
  if (req.session?.etsy_auth?.access_token || req.session?.etsy_auth?.refresh_token) {
    return req.session.etsy_auth;
  }
  const user = req.user || await getSessionUser(req.session);
  if (user?.etsy_auth?.access_token || user?.etsy_auth?.refresh_token) {
    req.user = user;
    req.session.email ||= user.email;
    req.session.user_id ||= user.id;
    req.session.etsy_auth = user.etsy_auth;
    req.etsyAuth = user.etsy_auth;
    return user.etsy_auth;
  }
  return {};
}

async function updateUser(userId, patch) {
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) return null;
  Object.assign(user, patch, { updated_at: new Date().toISOString() });
  await writeUsers(users);
  return user;
}

async function updateUserByEmail(email, patch) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const user = await getOrCreateUser(normalizedEmail);
  return updateUser(user.id, patch);
}

async function saveUserEtsyAuth(session, tokens = {}) {
  const email = normalizeEmail(session.email || `session-${session.acopes_session_id || crypto.randomUUID()}@local.acopes`);
  const user = await getOrCreateUser(email);
  const updated = await updateUser(user.id, { etsy_auth: publicEtsyAuth(tokens) });
  session.email = updated.email;
  session.user_id = updated.id;
  session.onboarding_completed = session.onboarding_completed;
  session.store_name = session.store_name || "";
  session.etsy_auth = updated.etsy_auth;
  etsyDebug("Persisted Etsy auth for user", {
    email,
    user_id: publicEtsyAuth(tokens).user_id || "",
    shop_id: publicEtsyAuth(tokens).shop_id || "",
    hasAccessToken: Boolean(tokens.access_token)
  });
  console.log("[USERS JSON CHECK]", {
    email,
    user_created_or_found: Boolean(user),
    etsy_auth_present: Boolean(updated?.etsy_auth),
    access_token_saved: Boolean(updated?.etsy_auth?.access_token),
    shop_id: updated?.etsy_auth?.shop_id || "",
    user_id: updated?.etsy_auth?.user_id || ""
  });
  return updated;
}

function isDevelopmentBypass(req = null) {
  const host = String(req?.headers?.host || "");
  const origin = String(req?.headers?.origin || "");
  return (
    process.env.DEV_MODE === "true" ||
    process.env.NODE_ENV !== "production" ||
    /(^|\/\/|:)localhost(?::|\/|$)/i.test(origin) ||
    /(^|\/\/|:)127\.0\.0\.1(?::|\/|$)/i.test(origin) ||
    /^localhost(?::|$)/i.test(host) ||
    /^127\.0\.0\.1(?::|$)/i.test(host)
  );
}

function devCreditUser(user = null) {
  if (!user) return user;
  return {
    ...user,
    plan: user.plan || "free",
    credits_remaining: 9999,
    credits_granted: 9999,
    limit_reached: false
  };
}

async function consumeCredits(user, amount) {
  if (!user || user.credits_remaining < amount) return null;
  return updateUser(user.id, {
    credits_remaining: user.credits_remaining - amount,
    optimizations_used: (user.optimizations_used || 0) + amount
  });
}

async function incrementAnalytics(event) {
  const analytics = await readRuntimeJson(analyticsPath, analyticsSeedPath, {
    visits: 0,
    optimizations_started: 0,
    optimizations_completed: 0,
    waitlist_signups: 0,
    by_event: {}
  });
  analytics.by_event[event] = (analytics.by_event[event] || 0) + 1;
  if (event === "visit") analytics.visits += 1;
  if (event === "optimization_started") analytics.optimizations_started += 1;
  if (event === "optimization_completed") analytics.optimizations_completed += 1;
  if (event === "waitlist_signup") analytics.waitlist_signups += 1;
  await writeJsonFile(analyticsPath, analytics);
  return analytics;
}

function parseMakeResponseBody(body) {
  if (!body) return { ok: false, error: "invalid_json" };
  if (typeof body === "object") return { ok: true, value: body };

  const text = String(body).trim();
  if (!text) return { ok: false, error: "invalid_json" };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // Make can accidentally send duplicated mapped JSON tokens. Keep the first
    // complete object so the live UI still updates instead of dropping the run.
    const firstStart = text.indexOf("{");
    if (firstStart === -1) return { ok: false, error: "invalid_json" };
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = firstStart; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        try {
          return { ok: true, value: JSON.parse(text.slice(firstStart, index + 1)) };
        } catch {
          return { ok: false, error: "invalid_json" };
        }
      }
    }
  }

  return { ok: false, error: "invalid_json" };
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function titleCaseWords(value = "") {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeStem(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/ies$/, "y").replace(/s$/, ""))
    .join(" ");
}

function countRootUses(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .reduce((counts, word) => {
      const stem = word.replace(/ies$/, "y").replace(/s$/, "");
      counts[stem] = (counts[stem] || 0) + 1;
      return counts;
    }, {});
}

function textIncludesAny(text = "", words = []) {
  const lower = String(text || "").toLowerCase();
  return words.find((word) => lower.includes(word)) || "";
}

function normalizeListingId(value = "") {
  return String(value ?? "").trim();
}

function normalizeMakeResponsePayload(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const listing_id = normalizeListingId(source.listing_id);
  const candidate = source.optimization || source.aiOptimization || source.ai_optimization || source.result || source.data || {};
  const merged = {
    ...candidate,
    ...source
  };
  const titleCandidate = merged.seo_title || merged.optimized_title || merged.title || merged.ai_title || merged.optimizedTitle || merged.title_candidate || "";
  const descriptionCandidate = merged.description || merged.optimized_description || merged.ai_description || merged.optimizedDescription || "";
  const tagsCandidate = merged.tags || merged.optimized_tags || merged.ai_tags || merged.optimizedTags || [];

  if (!listing_id) {
    return { ok: false, error: "listing_id_required" };
  }

  return {
    ok: true,
    value: {
      ...merged,
      listing_id,
      seo_title: typeof titleCandidate === "string" ? titleCandidate : "",
      optimized_title: typeof titleCandidate === "string" ? titleCandidate : "",
      description: typeof descriptionCandidate === "string" ? descriptionCandidate : "",
      optimized_description: typeof descriptionCandidate === "string" ? descriptionCandidate : "",
      tags: Array.isArray(tagsCandidate) ? tagsCandidate.filter((tag) => typeof tag === "string").slice(0, 13) : [],
      optimized_tags: Array.isArray(tagsCandidate) ? tagsCandidate.filter((tag) => typeof tag === "string").slice(0, 13) : [],
      alt_text: typeof merged.alt_text === "string" ? merged.alt_text : "",
      canva_prompt: typeof merged.canva_prompt === "string" ? merged.canva_prompt : "",
      thumbnail_preview_url: typeof merged.thumbnail_preview_url === "string" ? merged.thumbnail_preview_url : "",
      hero_thumbnail_url: typeof merged.hero_thumbnail_url === "string" ? merged.hero_thumbnail_url : "",
      pinterest_title: typeof merged.pinterest_title === "string" ? merged.pinterest_title : "",
      pinterest_description: typeof merged.pinterest_description === "string" ? merged.pinterest_description : "",
      status: typeof merged.status === "string" ? merged.status : "completed",
      seo_score: numberOrUndefined(merged.seo_score),
      ctr_score: numberOrUndefined(merged.ctr_score),
      thumbnail_score: numberOrUndefined(merged.thumbnail_score),
      tag_score: numberOrUndefined(merged.tag_score),
      alt_text_score: numberOrUndefined(merged.alt_text_score)
    }
  };
}

function successResponse(data = {}, message = "ok") {
  const envelope = { success: true, message, data, error: null, timestamp: new Date().toISOString(), request_id: crypto.randomUUID(), retryable: false };
  return data && typeof data === "object" && !Array.isArray(data) ? { ...envelope, ...data } : envelope;
}

function errorResponse(error, message = error, data = {}, retryable = true) {
  const envelope = { success: false, message, data, error, timestamp: new Date().toISOString(), request_id: crypto.randomUUID(), retryable };
  return data && typeof data === "object" && !Array.isArray(data) ? { ...envelope, ...data } : envelope;
}

function isAuthorizedMakeResponse(req) {
  if (!MAKE_RESPONSE_SECRET) return process.env.NODE_ENV !== "production";
  return String(req.get("X-ACOPES-WEBHOOK-SECRET") || "").trim() === MAKE_RESPONSE_SECRET;
}

function buildPayload(product) {
  const detectedProductType = detectJewelryProductType(product);
  const optimizationMode = optimizationModeFrom(product);
  return {
    product_name: product.name,
    product_type: detectedProductType || product.type,
    detected_product_type: detectedProductType,
    strict_jewelry_taxonomy: true,
    optimization_mode: optimizationMode,
    ai_system_rule: "CRITICAL: The optimized title MUST contain the exact same product type as the original. If original contains 'necklace', output MUST contain 'necklace'. Never change necklace→ring, bracelet→necklace, earring→pendant. Product type is LOCKED.",
    style: product.style,
    target_market: "USA",
    brand: "Edel Luxe",
    current_title: product.title,
    current_description: product.description,
    current_tags: product.tags,
    image_url: product.image_url,
    listing_id: product.listing_id || "",
    mode: product.listing_id ? "update_existing" : "create_new",
    publish_mode: "draft_only",
    auto_publish: false,
    etsy_status: "draft",
    optimization_priority: "hero_thumbnail_ctr",
    future_scores: {
      ctr_score: null,
      seo_score: null,
      thumbnail_score: null,
      tag_score: null,
      alt_text_score: null
    }
  };
}

function normalizeOptimization(input = {}) {
  let source = input && typeof input === "object" ? input : {};
  if (typeof input === "string") {
    try {
      source = JSON.parse(input);
    } catch {
      source = { optimized_title: input.split(/\r?\n/).find((line) => /necklace|bracelet|earrings|ring|jewelry|chain/i.test(line)) || "" };
    }
  }
  const candidate = source.optimization || source.aiOptimization || source.ai_optimization || source.result || source.data || {};
  const merged = {
    ...candidate,
    ...source
  };
  const titleCandidate = merged.seo_title || merged.optimized_title || merged.title || merged.ai_title || merged.optimizedTitle || merged.title_candidate || "";
  const descriptionCandidate = merged.description || merged.optimized_description || merged.ai_description || merged.optimizedDescription || "";
  const tagsCandidate = merged.tags || merged.optimized_tags || merged.ai_tags || merged.optimizedTags || [];
  return {
    seo_title: typeof titleCandidate === "string" ? titleCandidate : "",
    optimized_title: typeof titleCandidate === "string" ? titleCandidate : "",
    description: typeof descriptionCandidate === "string" ? descriptionCandidate : "",
    optimized_description: typeof descriptionCandidate === "string" ? descriptionCandidate : "",
    tags: Array.isArray(tagsCandidate) ? tagsCandidate.filter((tag) => typeof tag === "string").slice(0, 13) : [],
    optimized_tags: Array.isArray(tagsCandidate) ? tagsCandidate.filter((tag) => typeof tag === "string").slice(0, 13) : [],
    alt_text: typeof merged.alt_text === "string" ? merged.alt_text : "",
    canva_prompt: typeof merged.canva_prompt === "string" ? merged.canva_prompt : "",
    thumbnail_preview_url:
      typeof merged.thumbnail_preview_url === "string"
        ? merged.thumbnail_preview_url
        : typeof merged.hero_thumbnail_url === "string"
          ? merged.hero_thumbnail_url
          : "",
    pinterest_title: typeof merged.pinterest_title === "string" ? merged.pinterest_title : "",
    pinterest_description: typeof merged.pinterest_description === "string" ? merged.pinterest_description : "",
    optimization_status:
      typeof merged.status === "string"
        ? merged.status
        : typeof merged.optimization_status === "string"
          ? merged.optimization_status
          : "completed",
    provided_scores: {
      seo_score: numberOrUndefined(merged.seo_score),
      ctr_score: numberOrUndefined(merged.ctr_score),
      thumbnail_score: numberOrUndefined(merged.thumbnail_score),
      tag_quality_score: numberOrUndefined(merged.tag_score ?? merged.tag_quality_score),
      alt_text_score: numberOrUndefined(merged.alt_text_score)
    },
    taxonomy_validation: merged.taxonomy_validation || null,
    final_output_source: typeof merged.final_output_source === "string" ? merged.final_output_source : ""
  };
}

const JEWELRY_PRODUCT_TYPES = ["necklace", "bracelet", "ring", "earring", "pendant", "anklet", "brooch", "choker", "chain", "bangle", "cuff"];
const PRODUCT_TYPE_PATTERNS = [
  ["necklace", /\bnecklaces?\b|\bchain necklace\b|\bpendant necklace\b/i],
  ["bracelet", /\bbracelets?\b/i],
  ["ring", /\brings?\b/i],
  ["earring", /\bearrings?\b/i],
  ["pendant", /\bpendants?\b/i],
  ["anklet", /\banklets?\b/i],
  ["brooch", /\bbrooch(?:es)?\b/i],
  ["choker", /\bchokers?\b/i],
  ["bangle", /\bbangles?\b/i],
  ["cuff", /\bcuffs?\b/i],
  ["chain", /\bchains?\b/i]
];

function detectProductTypeFromText(text = "") {
  const normalized = String(text || "");
  const match = PRODUCT_TYPE_PATTERNS.find(([, pattern]) => pattern.test(normalized));
  if (!match) return "";
  return match[0] === "chain" && /\bnecklace\b/i.test(normalized) ? "necklace" : match[0];
}

function detectJewelryProductType(listing = {}) {
  const originalTitleType = detectProductTypeFromText(listing.title || listing.name || "");
  if (originalTitleType) return originalTitleType;
  return detectProductTypeFromText(`${listing.product_type || ""} ${listing.type || ""} ${listing.description || ""} ${(listing.tags || []).join(" ")}`);
}

function productTypeTerms(type = "") {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "necklace") return ["necklace", "chain necklace", "pendant necklace"];
  if (normalized === "earring") return ["earring", "earrings"];
  if (normalized === "chain") return ["chain"];
  return normalized ? [normalized] : [];
}

function originalKeywords(listing = {}) {
  const blocked = new Set(["for", "and", "with", "the", "gift", "women", "woman", "jewelry", "jewellery", "minimal", "minimalist", "dainty", "gold", "silver"]);
  return Array.from(new Set(String(listing.title || listing.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !blocked.has(word))));
}

const MATERIAL_KEYWORDS = ["gold", "silver", "pearl", "gemstone", "crystal", "stainless steel", "rose gold", "beaded"];
const STYLE_KEYWORDS = ["chunky", "minimalist", "dainty", "bohemian", "boho", "vintage", "figaro", "paperclip", "herringbone", "box chain", "layering", "old money"];
const GIFT_KEYWORDS = ["gift for her", "gift for mom", "bridesmaid gift", "jewelry gift"];
const OCCASION_KEYWORDS = ["wedding", "birthday", "christmas", "anniversary", "bridesmaid"];
const FILLER_WORDS = ["beautiful", "lovely", "amazing", "unique"];
const TRANSACTIONAL_WORDS = ["gift", "everyday", "layering", "bridal", "bridesmaid", "birthday", "wedding", "anniversary"];
const POWER_WORDS = ["timeless", "elegant", "refined", "delicate", "polished", "luxury", "gift"];

function optimizationModeFrom(input = {}) {
  const mode = String(input.optimization_mode || input.mode || "safe_seo").toLowerCase();
  return ["safe_seo", "aggressive_ctr", "luxury_branding", "gift_intent", "minimalist_jewelry"].includes(mode) ? mode : "safe_seo";
}

function keywordClusters(listing = {}, mode = "safe_seo") {
  const text = `${listing.title || ""} ${listing.name || ""} ${listing.description || ""} ${(listing.tags || []).join(" ")}`.toLowerCase();
  const productType = detectJewelryProductType(listing) || "necklace";
  const material = textIncludesAny(text, MATERIAL_KEYWORDS) || "gold";
  const style = textIncludesAny(text, STYLE_KEYWORDS) || (mode === "luxury_branding" ? "old money" : mode === "minimalist_jewelry" ? "minimalist" : "dainty");
  const occasion = textIncludesAny(text, OCCASION_KEYWORDS) || (mode === "gift_intent" ? "birthday" : "everyday");
  const gift = textIncludesAny(text, GIFT_KEYWORDS) || (mode === "gift_intent" ? "gift for her" : "jewelry gift");
  const productPhrase = productType === "earrings" ? "earrings" : productType;
  const primary = [material, style, productPhrase].filter(Boolean).join(" ").replace(/\bold money\b/, "old money");
  const secondary = text.includes("chain") || ["necklace", "choker"].includes(productType)
    ? "layering jewelry"
    : mode === "luxury_branding"
      ? "quiet luxury jewelry"
      : "everyday jewelry";
  return {
    primary_keyword: primary,
    secondary_keyword: secondary,
    material_keyword: material,
    style_keyword: style,
    gift_keyword: gift,
    occasion_keyword: occasion,
    product_type: productType
  };
}

function ensureTitleProductType(title = "", productType = "") {
  if (!productType) return title;
  const lower = String(title || "").toLowerCase();
  if (productTypeTerms(productType).some((term) => lower.includes(term))) return title;
  const parts = String(title || "").split(",");
  parts[0] = `${parts[0].trim()} ${titleCaseWords(productType)}`.trim();
  return compactTitle(parts.join(","), 140);
}

function productTypeTitleWord(type = "") {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "earring") return "Earrings";
  if (normalized === "necklace") return "Necklace";
  if (normalized === "bracelet") return "Bracelet";
  if (normalized === "ring") return "Ring";
  if (normalized === "pendant") return "Pendant";
  if (normalized === "anklet") return "Anklet";
  if (normalized === "brooch") return "Brooch";
  if (normalized === "choker") return "Choker";
  if (normalized === "chain") return "Chain";
  if (normalized === "bangle") return "Bangle";
  if (normalized === "cuff") return "Cuff";
  return titleCaseWords(normalized);
}

function productTypeReplacementPattern(type = "") {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "earring") return /\bearrings?\b/gi;
  if (normalized === "brooch") return /\bbrooch(?:es)?\b/gi;
  return new RegExp(`\\b${normalized}s?\\b`, "gi");
}

function enforceLockedProductTypeInTitle(title = "", originalType = "") {
  if (!title || !originalType) return title;
  const requiredTerms = productTypeTerms(originalType);
  const requiredWord = productTypeTitleWord(originalType);
  let fixedTitle = String(title || "");
  const hasRequiredType = requiredTerms.some((term) => new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}s?\\b`, "i").test(fixedTitle));

  for (const type of JEWELRY_PRODUCT_TYPES) {
    if (type === originalType) continue;
    if (originalType === "necklace" && type === "chain") continue;
    const pattern = productTypeReplacementPattern(type);
    if (pattern.test(fixedTitle)) {
      fixedTitle = fixedTitle.replace(productTypeReplacementPattern(type), requiredWord);
    }
  }

  if (!hasRequiredType && !productTypeTerms(originalType).some((term) => new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}s?\\b`, "i").test(fixedTitle))) {
    const parts = fixedTitle.split(",");
    parts[0] = `${parts[0].trim()} ${requiredWord}`.trim();
    fixedTitle = parts.join(",");
  }

  fixedTitle = compactTitle(fixedTitle.replace(/\b(Necklace|Bracelet|Ring|Earrings|Pendant|Anklet|Brooch|Choker|Chain|Bangle|Cuff)\s+\1\b/gi, "$1"), 140);
  if (fixedTitle !== title) {
    console.log("[PRODUCT TYPE ENFORCED]", `${originalType} → ${fixedTitle}`);
  }
  return fixedTitle;
}

function enforceOptimizationProductType(optimized = {}, listing = {}) {
  const originalType = detectJewelryProductType(listing);
  if (!originalType) return optimized;
  const currentTitle = optimized.seo_title || optimized.optimized_title || "";
  const fixedTitle = enforceLockedProductTypeInTitle(currentTitle, originalType);
  return {
    ...optimized,
    seo_title: fixedTitle,
    optimized_title: fixedTitle
  };
}

function keyFeatureFromListing(listing = {}, clusters = {}) {
  const text = `${listing.title || ""} ${listing.description || ""} ${(listing.tags || []).join(" ")}`.toLowerCase();
  if (text.includes("chunky")) return "Bold chain texture adds visible shine without changing the necklace category.";
  if (text.includes("figaro")) return "Figaro links create a polished layered look.";
  if (text.includes("paperclip")) return "Paperclip links give the piece a modern layering profile.";
  if (text.includes("heart")) return "The heart detail adds soft meaning for everyday gifting.";
  if (text.includes("pearl")) return "Pearl detail adds a refined feminine finish.";
  return `Designed for ${clusters.secondary_keyword || "everyday styling"} with a refined ${clusters.style_keyword || "minimalist"} finish.`;
}

function fallbackDescription(listing = {}, clusters = {}) {
  const location = listing.location || listing.shop_location || listing.ships_from || "";
  const sentence = `${titleCaseWords(clusters.product_type)} in ${clusters.material_keyword}, ${clusters.style_keyword} design. Perfect ${clusters.occasion_keyword} gift. ${keyFeatureFromListing(listing, clusters)}${location ? ` Ships from ${location}.` : ""}`;
  return sentence.split(/\s+/).slice(0, 150).join(" ");
}

function productTitleLabel(listing = {}, clusters = {}) {
  const productType = clusters.product_type || detectJewelryProductType(listing) || "jewelry";
  const text = `${listing.title || ""} ${listing.name || ""}`.toLowerCase();
  if (productType === "necklace" && text.includes("chain")) return "Chain Necklace";
  if (productType === "necklace" && text.includes("pendant")) return "Pendant Necklace";
  if (productType === "bracelet" && text.includes("bangle")) return "Bangle Bracelet";
  if (productType === "earring") return "Earrings";
  return titleCaseWords(productType);
}

function compactTitle(value = "", maxLength = 140) {
  let title = String(value || "").replace(/\s+/g, " ").trim();
  for (const filler of FILLER_WORDS) title = title.replace(new RegExp(`\\b${filler}\\b`, "ig"), "").replace(/\s+/g, " ").trim();
  const counts = {};
  title = title.split(/\s+/).filter((word) => {
    const stem = normalizeStem(word);
    counts[stem] = (counts[stem] || 0) + 1;
    return counts[stem] <= 2;
  }).join(" ");
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength).replace(/[,\s|]+[^,\s|]*$/, "").trim();
}

function buildSeoTitle(listing = {}, mode = "safe_seo") {
  const clusters = keywordClusters(listing, mode);
  const material = titleCaseWords(clusters.material_keyword);
  const style = titleCaseWords(clusters.style_keyword);
  const product = productTitleLabel(listing, clusters);
  const useCase = mode === "gift_intent"
    ? `${titleCaseWords(clusters.occasion_keyword)} Ready Jewelry`
    : mode === "luxury_branding"
      ? "Quiet Luxury Styling"
      : mode === "aggressive_ctr"
        ? "Everyday Statement Layering"
        : "Minimalist Layering Jewelry";
  const gift = mode === "luxury_branding" ? "Refined Gift for Her" : titleCaseWords(clusters.gift_keyword);
  const title = `${material} ${style} ${product}, ${useCase} | ${gift}`;
  return compactTitle(title, 140);
}

function addTag(tags, tag) {
  const cleaned = String(tag || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 20) return tags;
  const normalized = normalizeStem(cleaned);
  if (tags.some((item) => normalizeStem(item) === normalized)) return tags;
  tags.push(cleaned);
  return tags;
}

function generateEtsyTags(listing = {}, mode = "safe_seo") {
  const clusters = keywordClusters(listing, mode);
  const tags = [];
  addTag(tags, clusters.product_type);
  addTag(tags, clusters.material_keyword);
  addTag(tags, clusters.style_keyword);
  addTag(tags, `${clusters.material_keyword} ${clusters.product_type}`);
  addTag(tags, `${clusters.style_keyword} style`);
  addTag(tags, "layering piece");
  addTag(tags, "everyday wear");
  addTag(tags, "quiet luxury");
  addTag(tags, clusters.gift_keyword);
  addTag(tags, `${clusters.occasion_keyword} gift`);
  addTag(tags, "bridesmaid gift");
  addTag(tags, "old money style");
  addTag(tags, mode === "aggressive_ctr" ? "coquette style" : "timeless jewelry");
  for (const fallback of ["dainty jewelry", "minimal jewelry", "elegant jewelry", "gift for her", "wedding jewelry", "birthday gift", "gold jewelry"]) {
    if (tags.length >= 13) break;
    addTag(tags, fallback);
  }
  return tags.slice(0, 13);
}

function complianceChecks(title = "", tags = [], clusters = {}) {
  const lowerTitle = String(title || "").toLowerCase();
  const rootCounts = countRootUses(title);
  const duplicateTags = tags.length !== new Set(tags.map(normalizeStem)).size;
  const primary = clusters.primary_keyword || clusters.product_type || "";
  return {
    title_too_long: title.length > 140,
    keyword_spam: Object.values(rootCounts).some((count) => count >= 3),
    no_primary_keyword: !lowerTitle.slice(0, 40).includes(String(primary).split(/\s+/).filter(Boolean).at(-1) || ""),
    duplicate_tags: duplicateTags,
    missing_material: !MATERIAL_KEYWORDS.some((word) => lowerTitle.includes(word)),
    mobile_fail: !lowerTitle.slice(0, 40).includes(clusters.product_type || "")
  };
}

function confidenceBreakdown(scores = {}, optimized = {}) {
  const checks = optimized.compliance_checks || {};
  const tags = optimized.tags || [];
  const clusters = optimized.keyword_clusters || {};
  const title = optimized.seo_title || "";
  const titleQuality = title.length >= 40 && title.length <= 140 && !FILLER_WORDS.some((word) => title.toLowerCase().includes(word));
  const tagQuality = tags.length === 13 && !checks.duplicate_tags;
  const keywordCarryover = title.toLowerCase().includes((clusters.product_type || "").toLowerCase()) && tags.some((tag) => tag.includes(clusters.product_type || ""));
  const taxonomyValid = optimized.taxonomy_validation?.valid !== false || (optimized.taxonomy_validation?.category_preserved && optimized.taxonomy_validation?.title_category_preserved && !optimized.taxonomy_validation?.mismatched_type);
  const breakdown = {
    taxonomy_valid: taxonomyValid ? 20 : 0,
    keyword_carryover: keywordCarryover ? 20 : 0,
    title_quality: titleQuality ? 20 : 0,
    tag_quality: tagQuality ? 20 : 0,
    ctr_prediction: scores.ctr_score > 85 ? 20 : scores.ctr_score > 70 ? 10 : 0
  };
  return {
    ...breakdown,
    confidence_score: Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  };
}

function carriedKeywordCount(listing = {}, title = "") {
  const lowerTitle = String(title || "").toLowerCase();
  return originalKeywords(listing).filter((word) => lowerTitle.includes(word)).length;
}

function validateJewelryOptimization(optimized = {}, listing = {}) {
  const detectedProductType = detectJewelryProductType(listing);
  const title = String(optimized.seo_title || optimized.optimized_title || "").toLowerCase();
  const optimizedTitleType = detectProductTypeFromText(title);
  const description = String(optimized.description || optimized.optimized_description || "").toLowerCase();
  const tags = (optimized.tags || optimized.optimized_tags || []).map((tag) => String(tag).toLowerCase());
  const requiredTerms = productTypeTerms(detectedProductType);
  const productText = `${title} ${description} ${tags.join(" ")}`;
  const categoryPreserved = !requiredTerms.length || requiredTerms.some((term) => productText.includes(term));
  const titleCategoryPreserved = !requiredTerms.length || requiredTerms.some((term) => title.includes(term));
  const detectedMatchesOriginal = detectJewelryProductType(listing) === detectedProductType;
  const rawMismatchedType = JEWELRY_PRODUCT_TYPES.some((type) => {
    if (!detectedProductType || type === detectedProductType) return false;
    return productTypeTerms(type).some((term) => title.includes(term));
  });
  const hardTypeSwap = optimizedTitleType && detectedProductType && optimizedTitleType !== detectedProductType && !(detectedProductType === "necklace" && optimizedTitleType === "pendant");
  const mismatchedType = categoryPreserved && titleCategoryPreserved && detectedMatchesOriginal && !hardTypeSwap ? false : rawMismatchedType || hardTypeSwap;
  const carryOver = carriedKeywordCount(listing, title);
  const genericTitle = /minimal everyday jewelry|gold minimal ring|minimal ring/i.test(optimized.seo_title || optimized.optimized_title || "");
  const requiredCarryover = Math.min(1, originalKeywords(listing).length || 1);
  const valid = Boolean(title) && categoryPreserved && titleCategoryPreserved && !mismatchedType && !genericTitle && carryOver >= requiredCarryover;
  const failReasons = [
    !title ? "missing_title" : "",
    !categoryPreserved ? "category_not_preserved_in_content" : "",
    !titleCategoryPreserved ? "category_not_preserved_in_title" : "",
    mismatchedType ? "mismatched_product_type" : "",
    genericTitle ? "generic_or_blocked_title" : "",
    carryOver < requiredCarryover ? "insufficient_keyword_carryover" : ""
  ].filter(Boolean);
  const result = {
    valid,
    detected_product_type: detectedProductType,
    expected_type: detectedProductType,
    category_preserved: categoryPreserved,
    title_category_preserved: titleCategoryPreserved,
    mismatched_type: mismatchedType,
    carried_keywords: carryOver,
    generic_title: genericTitle,
    fail_reasons: failReasons
  };
  console.log("[TAXONOMY CHECK]", {
    detected_product_type: detectedProductType,
    expected_type: detectedProductType,
    pass: valid
  });
  if (!valid) {
    console.log("[VALIDATION FAIL REASON]", failReasons);
  }
  console.log("[OPTIMIZATION DEBUG]", {
    detected_product_type: detectedProductType,
    validation_result: result,
    retry_triggered: false,
    final_output_valid: valid
  });
  return result;
}

function enforceProductTypeInContent(candidate = {}, detectedProductType = "") {
  if (!detectedProductType) return candidate;
  const typeLabel = detectedProductType === "earrings" ? "earrings" : detectedProductType;
  const description = String(candidate.description || candidate.optimized_description || "");
  const tags = Array.isArray(candidate.tags) ? candidate.tags : [];
  const updatedTags = tags.some((tag) => String(tag).toLowerCase().includes(typeLabel))
    ? tags
    : [typeLabel, ...tags].slice(0, 13);
  const updatedDescription = description.toLowerCase().includes(typeLabel)
    ? description
    : `${description} This ${typeLabel} keeps the original jewelry category accurate for Etsy search.`;
  return {
    ...candidate,
    description: updatedDescription,
    optimized_description: updatedDescription,
    tags: updatedTags,
    optimized_tags: updatedTags
  };
}

function fallbackOptimizedTitle(listing = {}) {
  return buildSeoTitle(listing, optimizationModeFrom(listing));
}

function ensureOptimizationContent(optimized = {}, listing = {}) {
  const detectedProductType = detectJewelryProductType(listing);
  const optimizationMode = optimizationModeFrom(listing);
  const clusters = keywordClusters(listing, optimizationMode);
  let finalOutputSource = optimized.final_output_source || "ai";
  optimized = enforceOptimizationProductType(optimized, listing);
  let title = enforceLockedProductTypeInTitle(
    ensureTitleProductType(compactTitle(optimized.seo_title || optimized.optimized_title || fallbackOptimizedTitle({ ...listing, optimization_mode: optimizationMode })), clusters.product_type),
    detectedProductType
  );
  let tags = optimized.tags?.length ? optimized.tags : optimized.optimized_tags?.length ? optimized.optimized_tags : generateEtsyTags(listing, optimizationMode);
  tags = tags.length === 13 ? tags : generateEtsyTags({ ...listing, tags }, optimizationMode);
  let description = optimized.description || optimized.optimized_description || `${title} is optimized for ${clusters.secondary_keyword}, mobile-first Etsy search, and draft-safe buyer intent. It preserves the original ${clusters.product_type} category while highlighting ${clusters.material_keyword}, ${clusters.style_keyword}, and ${clusters.gift_keyword}.`;
  let candidate = {
    ...optimized,
    seo_title: title,
    optimized_title: title,
    description,
    optimized_description: description,
    tags,
    optimized_tags: tags,
    keyword_clusters: clusters,
    optimization_mode: optimizationMode,
    compliance_checks: complianceChecks(title, tags, clusters)
  };
  candidate = enforceProductTypeInContent(candidate, detectedProductType);
  const validation = validateJewelryOptimization(candidate, listing);
  if (!validation.valid) {
    console.log("[FALLBACK TRIGGER]", {
      stage: "ensure_optimization_content",
      condition: "validation_failed",
      fail_reasons: validation.fail_reasons || [],
      optimized_title: candidate.seo_title || candidate.optimized_title || ""
    });
    finalOutputSource = "safe_fallback";
    title = enforceLockedProductTypeInTitle(ensureTitleProductType(fallbackOptimizedTitle(listing), clusters.product_type), detectedProductType);
    tags = generateEtsyTags(listing, optimizationMode);
    description = fallbackDescription(listing, clusters);
    candidate = {
      ...optimized,
      seo_title: title,
      optimized_title: title,
      description,
      optimized_description: description,
      tags,
      optimized_tags: tags,
      keyword_clusters: clusters,
      optimization_mode: optimizationMode,
      compliance_checks: complianceChecks(title, tags, clusters),
      taxonomy_validation: validation,
      strict_jewelry_taxonomy: true,
      final_output_source: finalOutputSource
    };
    const finalValidation = validateJewelryOptimization(candidate, listing);
    candidate.taxonomy_validation = finalValidation;
    console.log("[OPTIMIZATION DEBUG]", {
      detected_product_type: detectedProductType,
      validation_result: finalValidation,
      retry_triggered: true,
      final_output_valid: finalValidation.valid
    });
  }
  return {
    ...candidate,
    detected_product_type: detectedProductType,
    strict_jewelry_taxonomy: true,
    final_output_source: finalOutputSource,
    keyword_clusters: clusters,
    optimization_mode: optimizationMode,
    compliance_checks: complianceChecks(candidate.seo_title, candidate.tags || [], clusters)
  };
}

function buildOptimizationResponsePayload(product = {}, log = {}, session = {}) {
  const optimized = ensureOptimizationContent(
    normalizeOptimization(log.optimization_record?.after || log.make_response?.parsed || log.make_response?.body || {}),
    product
  );
  const analysis = scoreOptimization(optimized);
  return {
    ...log,
    optimized_title: optimized.optimized_title,
    seo_title: optimized.seo_title,
    optimized_description: optimized.optimized_description,
    optimized_tags: optimized.optimized_tags,
    keyword_clusters: optimized.keyword_clusters,
    compliance_checks: optimized.compliance_checks,
    confidence_breakdown: analysis.confidence_breakdown,
    optimization_mode: optimized.optimization_mode || optimizationModeFrom(product),
    final_output_source: optimized.final_output_source,
    validation_result: optimized.taxonomy_validation,
    final_output_valid: optimized.taxonomy_validation?.valid !== false,
    analysis,
    session
  };
}

function rawOptimizationValid(product = {}, log = {}) {
  const raw = normalizeOptimization(log.optimization_record?.after || log.make_response?.parsed || log.make_response?.body || {});
  return validateJewelryOptimization(raw, product).valid;
}

function rawOptimizationFromLog(log = {}) {
  return normalizeOptimization(log.optimization_record?.after || log.make_response?.parsed || log.make_response?.body || {});
}

async function attachFinalOptimizationRecord(log = {}, product = {}, optimized = {}, source = "ai_valid") {
  const finalOptimized = ensureOptimizationContent({ ...optimized, final_output_source: source }, product);
  log.optimization_record = await createOptimizationRecord({
    listing: product,
    optimized: finalOptimized,
    request_log_id: log.id
  });
  log.optimized_title = finalOptimized.seo_title || finalOptimized.optimized_title || "";
  log.seo_title = finalOptimized.seo_title;
  log.optimized_description = finalOptimized.optimized_description || finalOptimized.description || "";
  log.optimized_tags = finalOptimized.optimized_tags || finalOptimized.tags || [];
  log.final_output_source = finalOptimized.final_output_source || source;
  log.final_output_valid = finalOptimized.taxonomy_validation?.valid !== false;
  log.validation_result = finalOptimized.taxonomy_validation || null;
  return log;
}

async function sendToMakeWithTaxonomyRetry(product = {}) {
  const firstLog = await sendToMake(product);
  const firstRaw = enforceOptimizationProductType(rawOptimizationFromLog(firstLog), product);
  const firstValidation = validateJewelryOptimization(firstRaw, product);
  if (firstValidation.valid) return attachFinalOptimizationRecord(firstLog, product, firstRaw, "ai");
  console.log("[FALLBACK TRIGGER]", {
    stage: "first_ai_validation",
    condition: "first_ai_output_invalid_retry_required",
    fail_reasons: firstValidation.fail_reasons || []
  });
  console.log("[OPTIMIZATION DEBUG]", {
    detected_product_type: detectJewelryProductType(product),
    validation_result: firstValidation,
    retry_triggered: true,
    final_output_valid: false
  });
  const retryLog = await sendToMake({
    ...product,
    strict_jewelry_taxonomy: true,
    ai_system_rule: "CRITICAL: The optimized title MUST contain the exact same product type as the original. If original contains 'necklace', output MUST contain 'necklace'. Never change necklace→ring, bracelet→necklace, earring→pendant. Product type is LOCKED."
  });
  const retryRaw = enforceOptimizationProductType(rawOptimizationFromLog(retryLog), product);
  const retryValidation = validateJewelryOptimization(retryRaw, product);
  if (retryValidation.valid) return attachFinalOptimizationRecord(retryLog, product, retryRaw, "ai_retry_valid");
  console.log("[FALLBACK TRIGGER]", {
    stage: "retry_validation",
    condition: "retry_ai_output_invalid_safe_fallback_required",
    fail_reasons: retryValidation.fail_reasons || []
  });
  const fallbackLog = retryLog.status === "completed" ? retryLog : firstLog;
  return attachFinalOptimizationRecord(fallbackLog, product, {}, "safe_fallback");
}

function scoreOptimization(optimized = {}, scoreOverrides = {}) {
  const title = optimized.seo_title || "";
  const description = optimized.description || "";
  const tags = optimized.tags || [];
  const alt = optimized.alt_text || "";
  const canva = optimized.canva_prompt || "";
  const clusters = optimized.keyword_clusters || keywordClusters(optimized, optimized.optimization_mode || "safe_seo");
  const checks = optimized.compliance_checks || complianceChecks(title, tags, clusters);
  const titleWords = title.split(/\s+/).filter(Boolean);
  const lowerTitle = title.toLowerCase();
  const first40 = lowerTitle.slice(0, 40);
  const primary = String(clusters.primary_keyword || clusters.product_type || "").toLowerCase();
  const primaryParts = primary.split(/\s+/).filter(Boolean);
  const primaryInFirst40 = primaryParts.some((part) => first40.includes(part));
  const primaryPosition = primaryParts.length ? Math.min(...primaryParts.map((part) => lowerTitle.indexOf(part)).filter((index) => index >= 0), 999) : 999;
  const giftPhraseMatches = lowerTitle.match(/gift for her|birthday gift|bridesmaid jewelry|quiet luxury gift|anniversary gift|meaningful gift/g) || [];
  const repeatedGiftTerms = new Set(giftPhraseMatches).size !== giftPhraseMatches.length || giftPhraseMatches.length > 1;
  const spamSeparators = (title.match(/,|\||-/g) || []).length;
  const taxonomy = optimized.taxonomy_validation || {};
  const categoryPenalty = taxonomy.valid === false ? 45 : 0;
  const genericPenalty = taxonomy.generic_title ? 30 : /minimal everyday jewelry|gold minimal ring|minimal ring/i.test(title) ? 30 : 0;
  const primaryKeywordPenalty = taxonomy.category_preserved === false || taxonomy.title_category_preserved === false ? 35 : 0;
  const carryPenalty = Number(taxonomy.carried_keywords) >= 2 || taxonomy.valid !== false ? 0 : 25;
  const etsy_2026_title_score = Math.max(
    0,
    Math.min(
      100,
      (titleWords.length > 0 && titleWords.length <= 15 ? 35 : 0) +
        (title.length <= 95 ? 20 : 0) +
        (/necklace|bracelet|earrings|ring|jewelry/i.test(title) ? 20 : 0) +
        (!repeatedGiftTerms ? 15 : -20) +
        (spamSeparators <= 2 ? 10 : -25) -
        categoryPenalty -
        genericPenalty
    )
  );
  const tagText = tags.join(" ").toLowerCase();
  const titleDensity = primaryParts.length ? primaryParts.filter((part) => lowerTitle.includes(part)).length / primaryParts.length : 0;
  const titleLengthScore = title.length >= 40 && title.length <= 140 ? 25 : title.length <= 140 ? 15 : 5;
  const placementScore = primaryInFirst40 ? 30 : lowerTitle.includes(clusters.product_type || "") ? 20 : 5;
  const densityScore = Math.round(titleDensity * 25);
  const seo_score = clampScore(
    placementScore +
      titleLengthScore +
      densityScore +
      (tags.length === 13 ? 15 : Math.min(12, tags.length)) +
      (description.length > 180 ? 15 : 5) -
      (checks.keyword_spam ? 25 : 0) -
      genericPenalty
  );
  const ctr_score = clampScore(
    POWER_WORDS.filter((word) => lowerTitle.includes(word)).length * 10 +
      (title.includes("|") ? 12 : 0) +
      (title.includes(",") ? 8 : 0) +
      (primaryInFirst40 ? 20 : 0) +
      (/gift|everyday|layer|luxury|dainty|refined|elegant/i.test(title) ? 25 : 0) -
      Math.round(categoryPenalty / 2) -
      genericPenalty
  );
  const thumbnail_score = Math.min(
    100,
    (/65|70|75|mobile|ivory|neutral|no clutter|luxury/i.test(canva) ? 70 : 0) +
      (canva.length > 100 ? 30 : 0)
  );
  const tag_relevance = clampScore(
    (tags.length === 13 ? 25 : tags.length * 2) +
      tags.filter((tag) => tag.length <= 20).length * 2 +
      tags.filter((tag) => tag.split(/\s+/).some((word) => lowerTitle.includes(word))).length * 4 +
      (checks.duplicate_tags ? -25 : 0)
  );
  const alt_text_score = Math.min(
    100,
    (alt.length > 20 ? 25 : 0) +
      (alt.length <= 250 ? 25 : 0) +
      (/necklace|bracelet|jewelry/i.test(alt) ? 20 : 0) +
      (!/quiet luxury jewelry quiet luxury jewelry/i.test(alt) ? 30 : 0)
  );
  const description_quality_score = Math.min(
    100,
    (description.length > 180 ? 35 : 0) +
      (/gift|birthday|bridesmaid|anniversary|everyday|layer/i.test(description) ? 25 : 0) +
      (/care|dry|store|perfume|water/i.test(description) ? 20 : 0) +
      (/ACOPES AI|quiet luxury|minimal/i.test(description) ? 20 : 0)
  );
  const mobile_readability_score = clampScore((primaryInFirst40 ? 65 : 20) + (title.length <= 140 ? 20 : 0) + (titleWords.length <= 18 ? 15 : 5));
  const keyword_positioning = clampScore(primaryPosition <= 10 ? 100 : primaryPosition <= 20 ? 80 : primaryPosition <= 40 ? 60 : 25);
  const buyer_intent_score = clampScore(
    TRANSACTIONAL_WORDS.filter((word) => `${lowerTitle} ${description.toLowerCase()} ${tagText}`.includes(word)).length * 12 +
      (clusters.gift_keyword ? 15 : 0) -
      primaryKeywordPenalty -
      genericPenalty
  );
  const giftability_score = clampScore((/gift|mom|bridesmaid|birthday|anniversary|wedding|christmas/i.test(`${title} ${description} ${tagText}`) ? 75 : 15) + (clusters.gift_keyword ? 20 : 0));
  const competition_pressure = clampScore(100 - (["gold", "jewelry", "gift", "necklace", "ring"].filter((word) => lowerTitle === word || tags.includes(word)).length * 15) - (checks.keyword_spam ? 20 : 0));
  const viral_potential = clampScore(ctr_score * 0.4 + giftability_score * 0.35 + (clusters.occasion_keyword ? 15 : 0) + (thumbnail_score || 0) * 0.1);
  const finalSeo = clampScore((numberOrUndefined(scoreOverrides.seo_score ?? optimized.provided_scores?.seo_score) ?? seo_score) - genericPenalty);
  const finalCtr = clampScore((numberOrUndefined(scoreOverrides.ctr_score ?? optimized.provided_scores?.ctr_score) ?? ctr_score) - Math.round(categoryPenalty / 2) - genericPenalty);
  const finalThumbnail = numberOrUndefined(scoreOverrides.thumbnail_score ?? optimized.provided_scores?.thumbnail_score) ?? thumbnail_score;
  const finalTags = clampScore((numberOrUndefined(scoreOverrides.tag_quality_score ?? optimized.provided_scores?.tag_quality_score) ?? tag_relevance) - primaryKeywordPenalty);
  const confidence_breakdown = confidenceBreakdown({ ctr_score: finalCtr }, { ...optimized, tags, keyword_clusters: clusters, compliance_checks: checks });
  const confidence_score = confidence_breakdown.confidence_score;

  return {
    seo_score: finalSeo,
    ctr_score: finalCtr,
    thumbnail_score: finalThumbnail,
    tag_quality_score: finalTags,
    tag_relevance: finalTags,
    alt_text_score: numberOrUndefined(scoreOverrides.alt_text_score ?? optimized.provided_scores?.alt_text_score) ?? alt_text_score,
    etsy_2026_title_score,
    description_quality_score,
    mobile_readability_score,
    keyword_positioning,
    buyer_intent_score,
    buyer_intent_match: buyer_intent_score,
    giftability_score,
    competition_pressure,
    viral_potential,
    confidence_score,
    confidence_breakdown,
    compliance_checks: checks,
    keyword_clusters: clusters
  };
}

function confidenceLabel(score = 0) {
  if (score >= 91) return "Excellent";
  if (score >= 71) return "Good";
  if (score >= 41) return "Medium";
  return "Low";
}

async function createOptimizationRecord({ listing, optimized, source = "make_response", request_log_id = null }) {
  const normalized = ensureOptimizationContent(normalizeOptimization(optimized), listing);
  const scores = scoreOptimization(normalized);
  const idCandidates = [
    ["listing.listing_id", listing?.listing_id],
    ["listing.id", listing?.id],
    ["optimized.listing_id", optimized?.listing_id],
    ["normalized.listing_id", normalized?.listing_id],
    ["optimized.id", optimized?.id]
  ];
  const [resolvedSource, resolvedRawId] = idCandidates.find(([, value]) => normalizeListingId(value)) || ["missing", ""];
  const resolvedListingId = normalizeListingId(resolvedRawId);
  console.log("[OPTIMIZATION RECORD ID]", { resolvedListingId, source: resolvedSource });
  if (!resolvedListingId) {
    const error = new Error("Missing listing_id while creating optimization record.");
    error.code = "missing_listing_id";
    error.status = 400;
    throw error;
  }
  const record = {
    id: crypto.randomUUID(),
    listing_id: resolvedListingId,
    original_listing_id: resolvedListingId,
    email: normalizeEmail(listing.email || optimized.email),
    listing_name: listing.name,
    created_at: new Date().toISOString(),
    source,
    request_log_id,
    before: {
      title: listing.title,
      description: listing.description,
      tags: listing.tags,
      image_url: listing.image_url
    },
    after: normalized,
    final_output_source: normalized.final_output_source || "safe_fallback",
    validation_result: normalized.taxonomy_validation || null,
    final_output_valid: normalized.taxonomy_validation?.valid !== false,
    scores,
    confidence_label: confidenceLabel(scores.confidence_score),
    ai_change_reasons: [
      "Shortened title for mobile readability",
      "Moved gift terms into tags",
      "Improved primary keyword clarity",
      "Aligned with Etsy 2026 title guidance"
    ],
    status: normalized.optimization_status === "failed" ? "failed" : "completed",
    publish_mode: "draft_only",
    auto_publish: false,
    execution_plan: {
      title_update: Boolean(normalized.seo_title),
      description_update: Boolean(normalized.description),
      tags_replace: normalized.tags.length > 0,
      hero_thumbnail_upload: Boolean(normalized.canva_prompt),
      alt_text_update: Boolean(normalized.alt_text),
      requires_authenticated_etsy_executor: true
    }
  };

  const history = await readRuntimeJson(optimizationsPath, optimizationsSeedPath, []);
  const nextHistory = history.filter((item) => normalizeListingId(item.listing_id || item.id) !== resolvedListingId);
  nextHistory.unshift(record);
  await writeJsonFile(optimizationsPath, nextHistory);
  return record;
}

function enrichOptimizationRecord(record) {
  const scores = scoreOptimization(normalizeOptimization(record.after || {}), {
    seo_score: record.scores?.seo_score,
    ctr_score: record.scores?.ctr_score,
    thumbnail_score: record.scores?.thumbnail_score,
    tag_quality_score: record.scores?.tag_quality_score,
    alt_text_score: record.scores?.alt_text_score
  });
  return {
    ...record,
    scores: {
      ...(record.scores || {}),
      ...scores
    },
    confidence_label: confidenceLabel(scores.confidence_score),
    ai_change_reasons: record.ai_change_reasons || [
      "Shortened title for mobile readability",
      "Moved gift terms into tags",
      "Improved primary keyword clarity",
      "Aligned with Etsy 2026 title guidance"
    ]
  };
}

function decodeHtml(value = "") {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractListingLinks(html) {
  const matches = [...html.matchAll(/https:\/\/www\.etsy\.com\/listing\/(\d+)\/[^"'\\\s?]+/g)];
  return [...new Map(matches.map((match) => [match[1], match[0]])).entries()].map(([listing_id, url]) => ({
    listing_id,
    url
  }));
}

function extractJsonLd(html) {
  const scripts = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const product = nodes.find((node) => node["@type"] === "Product");
      if (product) return product;
    } catch {
      // Etsy sometimes emits multiple JSON-LD blocks; skip malformed ones.
    }
  }
  return null;
}

function extractTags(html) {
  const match = html.match(/"tags":\s*(\[[\s\S]*?\])/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

function inferType(title = "") {
  const lower = title.toLowerCase();
  if (lower.includes("bracelet")) return "bracelet";
  if (lower.includes("earring")) return "earrings";
  return "necklace";
}

function inferStyle(title = "", tags = []) {
  const text = `${title} ${tags.join(" ")}`.toLowerCase();
  if (text.includes("pearl")) return "quiet luxury pearl jewelry";
  if (text.includes("heart")) return "meaningful gift jewelry";
  if (text.includes("layer")) return "layered minimalist jewelry";
  return "minimalist jewelry";
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(nodeCrypto.randomBytes(48));
  const challenge = base64Url(nodeCrypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function normalizeListing(listing = {}) {
  const image = listing.image_url || listing.image || listing.Images?.[0]?.url_fullxfull || listing.Images?.[0]?.url_570xN || "";
  const title = listing.title || listing.name || "";
  const tags = Array.isArray(listing.tags) ? listing.tags : [];
  return {
    name: listing.name || title.split(",")[0] || `Listing ${listing.listing_id || ""}`.trim(),
    type: listing.type || inferType(title),
    style: listing.style || inferStyle(title, tags),
    title,
    description: listing.description || "",
    tags,
    image_url: image,
    listing_id: String(listing.listing_id || listing.id || ""),
    source_url: listing.source_url || listing.url || (listing.listing_id ? `https://www.etsy.com/listing/${listing.listing_id}` : ""),
    views: Number(listing.views || listing.views_count || 0),
    favorites: Number(listing.num_favorers || listing.favorites || 0),
    price: listing.price?.amount ? Number(listing.price.amount) / Number(listing.price.divisor || 100) : listing.price || "",
    state: listing.state || "active",
    details_status: listing.details_status || "synced",
    sync_source: listing.sync_source || "cache",
    optimization_focus: listing.optimization_focus || "Hero thumbnail generation and Etsy CTR optimization"
  };
}

async function readEtsyTokens() {
  etsyDebug("Etsy auth loaded", {
    source: "session_user_only",
    hasAccessToken: false,
    hasRefreshToken: false,
    shop_id: "",
    shop_name: ""
  });
  return {};
}

async function writeEtsyTokens(tokens) {
  return tokens || {};
}

async function readListingsMeta() {
  return readJsonFile(listingsMetaPath, {});
}

function etsyDebug(message, details = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/token|secret|verifier|authorization/i.test(key))
  );
  console.log(`[ETSY DEBUG] ${message}`, safeDetails);
}

function etsyConfigured() {
  return Boolean(ETSY_CLIENT_ID);
}

function etsyApiHeaders(accessToken) {
  const etsyApiKey = `${process.env.ETSY_CLIENT_ID}:${process.env.ETSY_CLIENT_SECRET}`;
  return {
    "x-api-key": etsyApiKey,
    "Authorization": `Bearer ${accessToken}`
  };
}

function etsyTokenUsable(tokens = {}) {
  return Boolean(tokens.access_token && tokens.expires_at && Number(tokens.expires_at) > Date.now() + ETSY_REFRESH_WINDOW_MS);
}

async function etsyTokenStatus(tokens = null) {
  tokens = tokens || await readEtsyTokens();
  if (!etsyConfigured()) etsyDebug("Missing Etsy config", { hasClientId: Boolean(ETSY_CLIENT_ID), hasRedirectUri: Boolean(ETSY_REDIRECT_URI) });
  if (!tokens.access_token) etsyDebug("Missing Etsy access token", { hasRefreshToken: Boolean(tokens.refresh_token) });
  if (!tokens.refresh_token) etsyDebug("Missing Etsy refresh token", { hasAccessToken: Boolean(tokens.access_token) });
  const connected = Boolean(tokens.access_token || tokens.refresh_token);
  const expired = connected && !etsyTokenUsable(tokens);
  if (connected && !expired && (!tokens.shop_id || !tokens.shop_name)) {
    try {
      tokens = await discoverEtsyShop(tokens);
    } catch (error) {
      etsyDebug("Shop status resolution skipped", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const meta = await readListingsMeta();
  const fallbackShopName = tokens.shop_name || meta.shop_name || FALLBACK_SHOP_NAME;
  const fallbackShopUrl = tokens.shop_url || meta.shop_url || FALLBACK_SHOP_URL;
  if (connected && (tokens.shop_id || meta.shop_id || fallbackShopName)) {
    etsyDebug("Loaded Etsy shop", {
      shop_id: tokens.shop_id || meta.shop_id || "",
      shop_name: fallbackShopName || "",
      shop_url: fallbackShopUrl || ""
    });
  }
  return {
    configured: etsyConfigured(),
    connected,
    expired: connected && !etsyTokenUsable(tokens),
    shop_id: tokens.shop_id || meta.shop_id || "",
    shop_name: connected ? fallbackShopName : "",
    shop_url: connected ? fallbackShopUrl : "",
    scopes: tokens.scope || ETSY_SCOPES,
    expires_at: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : "",
    reconnect_required: connected && expired && !tokens.refresh_token,
    token_status: tokens.last_refresh_status || (connected && !expired ? "active" : expired ? "reconnect_required" : "not_connected"),
    source: tokens.source || (connected ? "runtime" : "none"),
    error: !etsyConfigured() ? "missing_etsy_config" : !tokens.access_token ? "missing_etsy_access_token" : !tokens.refresh_token ? "missing_etsy_refresh_token" : "",
    draft_safe: true
  };
}

async function refreshEtsyToken(tokens) {
  if (!tokens.refresh_token) {
    const error = new Error("Etsy refresh token is missing.");
    error.code = "missing_refresh_token";
    error.reconnect_required = true;
    throw error;
  }
  const response = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ETSY_CLIENT_ID,
      refresh_token: tokens.refresh_token
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    etsyDebug("Etsy token refresh debug", {
      hasAccessToken: Boolean(tokens.access_token),
      hasRefreshToken: Boolean(tokens.refresh_token),
      expiresAt: tokens.expires_at || null,
      isExpired: !etsyTokenUsable(tokens),
      refreshAttempted: true,
      refreshSuccess: false,
      etsyStatusCode: response.status
    });
    const error = new Error(payload.error_description || payload.error || "Etsy token refresh failed.");
    error.code = "token_refresh_failed";
    error.status = response.status;
    error.reconnect_required = true;
    throw error;
  }
  const updated = {
    ...tokens,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || tokens.refresh_token,
    token_type: payload.token_type || tokens.token_type || "Bearer",
    scope: payload.scope || tokens.scope,
    expires_at: Date.now() + Number(payload.expires_in || 3600) * 1000,
    last_refresh_status: "refreshed",
    last_refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await writeEtsyTokens(updated);
  etsyDebug("Etsy token refresh debug", {
    hasAccessToken: Boolean(updated.access_token),
    hasRefreshToken: Boolean(updated.refresh_token),
    expiresAt: updated.expires_at || null,
    isExpired: !etsyTokenUsable(updated),
    refreshAttempted: true,
    refreshSuccess: true,
    etsyStatusCode: response.status
  });
  etsyDebug("Etsy token refreshed", { expires_at: updated.expires_at, scope: updated.scope });
  return updated;
}

async function ensureValidEtsyToken(tokens = null, res = null, req = null) {
  tokens = tokens || await readEtsyTokens();
  if (!tokens.access_token) throw new Error("Etsy is not connected.");
  const isExpired = !etsyTokenUsable(tokens);
  if (isExpired) {
    etsyDebug("Etsy token refresh debug", {
      hasAccessToken: Boolean(tokens.access_token),
      hasRefreshToken: Boolean(tokens.refresh_token),
      expiresAt: tokens.expires_at || null,
      isExpired,
      refreshAttempted: Boolean(tokens.refresh_token),
      refreshSuccess: false,
      etsyStatusCode: null
    });
    tokens = await refreshEtsyToken(tokens);
    if (res) setEtsyAuthCookie(res, tokens);
    if (req?.session) await saveUserEtsyAuth(req.session, tokens);
  }
  else if (tokens.last_refresh_status !== "active") {
    tokens = { ...tokens, last_refresh_status: "active" };
    await writeEtsyTokens(tokens);
    if (res) setEtsyAuthCookie(res, tokens);
    if (req?.session) await saveUserEtsyAuth(req.session, tokens);
    etsyDebug("Etsy token refresh debug", {
      hasAccessToken: Boolean(tokens.access_token),
      hasRefreshToken: Boolean(tokens.refresh_token),
      expiresAt: tokens.expires_at || null,
      isExpired: false,
      refreshAttempted: false,
      refreshSuccess: false,
      etsyStatusCode: null
    });
  }
  return tokens;
}

async function etsyApi(pathname, tokens, context = {}) {
  tokens = await ensureValidEtsyToken(tokens, context.res, context.req);
  let lastError = null;
  for (const baseUrl of [ETSY_API_BASE, ETSY_API_FALLBACK_BASE]) {
    try {
      let response = await fetch(`${baseUrl}${pathname}`, {
        headers: etsyApiHeaders(tokens.access_token)
      });
      if (response.status === 401 && tokens.refresh_token) {
        tokens = await refreshEtsyToken(tokens);
        if (context.res) setEtsyAuthCookie(context.res, tokens);
        if (context.req?.session) await saveUserEtsyAuth(context.req.session, tokens);
        response = await fetch(`${baseUrl}${pathname}`, {
          headers: etsyApiHeaders(tokens.access_token)
        });
      }
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      etsyDebug("Etsy API request failed", {
        path: pathname,
        baseUrl,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: payload
      });
      const error = new Error(payload.error || payload.message || `Etsy API failed with ${response.status}`);
      error.status = response.status;
      error.baseUrl = baseUrl;
      error.payload = payload;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Etsy API request failed.");
}

function extractEtsyResults(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.shops)) return payload.shops;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function extractEtsyUserId(payload = {}, tokens = {}) {
  return String(
    payload.user_id ||
    payload.user?.user_id ||
    payload.data?.user_id ||
    payload.results?.[0]?.user_id ||
    payload.results?.[0]?.user?.user_id ||
    userIdFromToken(tokens) ||
    ""
  );
}

function userIdFromToken(tokens = {}) {
  const tokenPrefix = String(tokens.access_token || "").split(".")[0];
  return /^\d+$/.test(tokenPrefix) ? tokenPrefix : "";
}

function urlFromShop(shop = {}) {
  if (shop.url) return shop.url;
  if (shop.shop_url) return shop.shop_url;
  return "";
}

function shopIdFromShop(shop = {}) {
  return String(shop.shop_id || shop.id || shop.shop?.shop_id || "");
}

function shopNameFromShop(shop = {}) {
  return String(shop.shop_name || shop.name || shop.title || shop.shop?.shop_name || "");
}

function selectActiveShop(shops = []) {
  return shops.find((shop) => {
    const state = String(shop.state || shop.status || "").toLowerCase();
    if (shop.is_open === false || shop.is_closed === true) return false;
    return !["closed", "inactive", "deleted"].includes(state);
  }) || shops[0] || null;
}

async function fetchEtsyShopLookup(url, tokens, label) {
  const response = await fetch(url, { headers: etsyApiHeaders(tokens.access_token) });
  const body = await response.json().catch(() => ({}));
  if (label === "users_self") {
    console.log("[ETSY DEBUG] FULL USERS SELF RESPONSE", {
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      primary_email: body.primary_email || body.user?.primary_email || body.data?.primary_email || body.results?.[0]?.primary_email || "",
      user_id: body.user_id || body.user?.user_id || body.data?.user_id || body.results?.[0]?.user_id || "",
      shop_id: body.shop_id || body.user?.shop_id || body.data?.shop_id || body.results?.[0]?.shop_id || "",
      login_name: body.login_name || body.user?.login_name || body.data?.login_name || body.results?.[0]?.login_name || "",
      access_token_prefix_10: String(tokens.access_token || "").slice(0, 10)
    });
  }
  if (label === "user_shops") {
    console.log("[ETSY DEBUG] FULL USER SHOPS RESPONSE", {
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      access_token_prefix_10: String(tokens.access_token || "").slice(0, 10)
    });
  }
  etsyDebug("Etsy shop lookup response", {
    label,
    url,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    accessPrefix10: String(tokens.access_token || "").slice(0, 10)
  });
  if (!response.ok) {
    const error = new Error(body.error || body.message || `${label} failed with ${response.status}`);
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body;
}

async function discoverEtsyShop(tokens, context = {}) {
  if (tokens.shop_id && tokens.shop_name) return tokens;
  let me = {};
  try {
    me = await fetchEtsyShopLookup(`${ETSY_API_FALLBACK_BASE}/users/__SELF__`, tokens, "users_self");
    etsyDebug("User fetched", { user_id: extractEtsyUserId(me, tokens) });
  } catch (error) {
    etsyDebug("User __SELF__ fetch failed", { error: error instanceof Error ? error.message : String(error) });
  }
  const userId = extractEtsyUserId(me, tokens);
  let shops = [];
  if (userId) {
    try {
      const shopsPayload = await fetchEtsyShopLookup(`${ETSY_API_FALLBACK_BASE}/users/${encodeURIComponent(userId)}/shops`, tokens, "user_shops");
      console.log("[ETSY DEBUG] RAW SHOP RESPONSE", JSON.stringify(shopsPayload, null, 2));
      shops = extractEtsyResults(shopsPayload);
    } catch (error) {
      etsyDebug("User shops fetch failed", { user_id: userId, error: error instanceof Error ? error.message : String(error) });
    }
  } else {
    etsyDebug("Could not read Etsy user id before shop lookup", { accessPrefix10: String(tokens.access_token || "").slice(0, 10) });
  }
  let shop = selectActiveShop(shops);
  let foundShopCount = shops.length;
  if (!shopIdFromShop(shop) && FALLBACK_SHOP_NAME) {
    try {
      const shopNamePayload = await fetchEtsyShopLookup(`${ETSY_API_FALLBACK_BASE}/shops?shop_name=${encodeURIComponent(FALLBACK_SHOP_NAME.toLowerCase())}`, tokens, "shop_name_lookup");
      console.log("[ETSY DEBUG] RAW SHOP RESPONSE", JSON.stringify(shopNamePayload, null, 2));
      const shopNameShops = extractEtsyResults(shopNamePayload);
      foundShopCount += shopNameShops.length;
      shop = selectActiveShop(shopNameShops);
    } catch (error) {
      etsyDebug("Shop name lookup failed", { shop_name: FALLBACK_SHOP_NAME, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const resolvedShopId = shopIdFromShop(shop);
  const resolvedShopName = shopNameFromShop(shop);
  if (!resolvedShopId && foundShopCount > 0) {
    const error = new Error("Etsy returned shops but no usable shop_id.");
    error.code = "shop_id_missing";
    error.status = 502;
    throw error;
  }
  if (!resolvedShopId) {
    etsyDebug("No seller shop found for Etsy user", {
      user_id: userId,
      shops_seen: foundShopCount,
      scopes: tokens.scope || ETSY_SCOPES,
      shop_name_lookup: FALLBACK_SHOP_NAME,
      accessPrefix10: String(tokens.access_token || "").slice(0, 10)
    });
    const error = new Error("Your Etsy account has no shop. Please connect a seller account.");
    error.code = "seller_account_required";
    error.status = 403;
    throw error;
  }
  const updated = {
    ...tokens,
    user_id: userId,
    shop_id: resolvedShopId,
    shop_name: resolvedShopName,
    shop_url: urlFromShop(shop),
    updated_at: new Date().toISOString()
  };
  console.log("[ETSY DEBUG] RESOLVED SHOP", {
    shop_id: updated.shop_id,
    shop_name: updated.shop_name
  });
  await writeEtsyTokens(updated);
  if (context.req?.session) {
    context.req.session.etsy_shop_id = updated.shop_id;
    context.req.session.etsy_shop_name = updated.shop_name;
    context.req.session.etsy_shop_url = updated.shop_url;
    await saveUserEtsyAuth(context.req.session, updated);
  }
  if (context.res) setEtsyAuthCookie(context.res, updated);
  etsyDebug("Shop resolved", {
    user_id: updated.user_id,
    shop_id: updated.shop_id,
    shop_name: updated.shop_name,
    shops_seen: foundShopCount
  });
  return updated;
}

async function syncEtsyListings(tokens = null, res = null, req = null) {
  tokens = await discoverEtsyShop(await ensureValidEtsyToken(tokens, res, req), { req, res });
  console.log("Fetching live Etsy listings", { shop_id: tokens.shop_id || "", shop_name: tokens.shop_name || "" });
  const payload = await etsyApi(`/shops/${tokens.shop_id}/listings/active?limit=100&includes=Images`, tokens, { req, res });
  const listings = extractEtsyResults(payload).map((listing) => normalizeListing({
    ...listing,
    sync_source: "etsy_api",
    details_status: "synced"
  })).filter((listing) => {
    const listingShopId = normalizeListingId(listing.shop_id || listing.Shop?.shop_id || "");
    return listing.listing_id && listing.title && (!listingShopId || listingShopId === normalizeListingId(tokens.shop_id));
  });
  console.log("Live Etsy listing count", { count: listings.length });
  await writeListingsCache(listings, {
    source: "etsy_api",
    shop_id: tokens.shop_id,
    shop_name: tokens.shop_name,
    shop_url: tokens.shop_url
  });
  etsyDebug("Listings synced", {
    shop_id: tokens.shop_id,
    shop_name: tokens.shop_name,
    count: listings.length
  });
  return listings;
}

function directEtsyUpdatePayload(product = {}) {
  const title = String(product.optimized_title || product.optimizedTitle || product.seo_title || product.title || "").trim();
  const description = String(product.optimized_description || product.optimizedDescription || product.description || "").trim();
  const tagsSource = Array.isArray(product.optimized_tags)
    ? product.optimized_tags
    : Array.isArray(product.optimizedTags)
      ? product.optimizedTags
      : Array.isArray(product.tags)
        ? product.tags
        : [];
  const tags = tagsSource.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 13);
  return { title, tags, description };
}

function etsyErrorMessage(payload = {}, fallback = "Etsy listing update failed.") {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (payload.error) return String(payload.error);
  if (payload.message) return String(payload.message);
  if (payload.error_description) return String(payload.error_description);
  if (Array.isArray(payload.errors) && payload.errors.length) return payload.errors.map((item) => item.message || item.error || item).join("; ");
  return fallback;
}

function maskedTokenPrefix(token = "") {
  return token ? `${String(token).slice(0, 6)}***` : "";
}

function normalizeTitleForMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function resolveLiveListingForEtsyPut(product = {}, shopId = "") {
  const listings = (await readListingsCache(shopId)).filter((listing) => String(listing.sync_source || "") === "etsy_api");
  if (!listings.length) {
    console.log("[FORCE RESYNC REQUIRED]", { shop_id: shopId, reason: "empty_or_mismatched_cache" });
  }
  const liveIds = listings.map((listing) => normalizeListingId(listing.listing_id || listing.id)).filter(Boolean);
  const requestedId = normalizeListingId(product.listing_id || product.id);
  console.log("[LIVE LISTING IDS]", {
    shop_id: shopId,
    count: liveIds.length,
    first_5_listing_ids: liveIds.slice(0, 5)
  });
  console.log("[QUEUE ITEM ID]", {
    listing_id: requestedId,
    title: product.title || product.name || ""
  });
  if (requestedId && liveIds.includes(requestedId)) {
    return { listing_id: requestedId, matched: "id" };
  }
  const productTitle = normalizeTitleForMatch(product.title || product.name || product.current_title || "");
  const matched = productTitle
    ? listings.find((listing) => normalizeTitleForMatch(listing.title || listing.name) === productTitle)
      || listings.find((listing) => {
        const liveTitle = normalizeTitleForMatch(listing.title || listing.name);
        return liveTitle && (liveTitle.includes(productTitle) || productTitle.includes(liveTitle));
      })
    : null;
  if (matched?.listing_id) {
    return {
      listing_id: normalizeListingId(matched.listing_id),
      matched: "title",
      stale_listing_id: requestedId
    };
  }
  const error = new Error("Listing ID is stale. Refresh Etsy Listings and regenerate optimization.");
  error.code = "stale_listing_id";
  error.status = 409;
  error.live_listing_count = liveIds.length;
  error.requested_listing_id = requestedId;
  throw error;
}

async function updateEtsyListingDirect(req, res, product = {}) {
  const rawListingId = product.listing_id || product.id || "";
  const listingId = normalizeListingId(rawListingId);
  if (!listingId) {
    const error = new Error("Missing Etsy listing_id.");
    error.code = "missing_listing_id";
    error.status = 400;
    throw error;
  }
  if (!/^\d+$/.test(listingId)) {
    const error = new Error("Invalid Etsy listing_id. Expected a numeric listing id.");
    error.code = "invalid_listing_id";
    error.status = 400;
    throw error;
  }

  let tokens = await resolveRequestEtsyAuth(req);
  tokens = await discoverEtsyShop(await ensureValidEtsyToken(tokens, res, req), { req, res });
  const sessionShopId = req.session?.etsy_shop_id || "";
  const sessionAuthShopId = req.session?.etsy_auth?.shop_id || "";
  const requestAuthShopId = req.etsyAuth?.shop_id || "";
  console.log("[ETSY PUT AUTH IDS]", {
    session_shop_id: sessionShopId,
    session_etsy_auth_shop_id: sessionAuthShopId,
    request_etsy_auth_shop_id: requestAuthShopId,
    token_shop_id: tokens.shop_id || "",
    request_listing_id: rawListingId,
    normalized_listing_id: listingId
  });
  if (!tokens.access_token || !tokens.shop_id) {
    const error = new Error("Please connect your Etsy shop before sending listings.");
    error.code = "etsy_not_connected";
    error.status = 401;
    throw error;
  }
  const shopId = normalizeListingId(sessionAuthShopId || requestAuthShopId || tokens.shop_id);
  if (!/^\d+$/.test(shopId)) {
    const error = new Error("Invalid Etsy shop_id. Please reconnect your Etsy shop to grant write permissions.");
    error.code = "invalid_shop_id";
    error.status = 400;
    throw error;
  }
  const liveListing = await resolveLiveListingForEtsyPut(product, shopId);
  const liveListingId = liveListing.listing_id;
  if (liveListing.matched === "title") {
    console.log("[LIVE LISTING ID REMAPPED]", {
      stale_listing_id: liveListing.stale_listing_id,
      live_listing_id: liveListingId,
      match: "title"
    });
  }

  const updatePayload = directEtsyUpdatePayload(product);
  if (!updatePayload.title || !updatePayload.description || !updatePayload.tags.length) {
    const error = new Error("Optimized title, description, and tags are required before sending to Etsy.");
    error.code = "missing_optimized_fields";
    error.status = 400;
    throw error;
  }

<<<<<<< HEAD
  const verifyPath = `/listings/${encodeURIComponent(liveListingId)}`;
const putPath = `/listings/${encodeURIComponent(liveListingId)}`;
const verifyEndpoint = `${ETSY_API_BASE}${verifyPath}`;

=======
  const listingPath = `/shops/${encodeURIComponent(shopId)}/listings/${encodeURIComponent(liveListingId)}`;
  const etsyUpdateBase = ETSY_API_FALLBACK_BASE;
  const verifyEndpoint = `${etsyUpdateBase}${listingPath}`;
>>>>>>> 9616f21 (fix Etsy PUT URL - correct shop-scoped endpoint)
  console.log("[ETSY VERIFY LISTING GET]", {
    url: verifyEndpoint,
    shop_id: shopId,
    listing_id: liveListingId
  });
  const verifyResponse = await fetch(verifyEndpoint, {
    method: "GET",
    headers: etsyApiHeaders(tokens.access_token)
  });
  const verifyText = await verifyResponse.text();
  let verifyPayload = {};
  try {
    verifyPayload = verifyText ? JSON.parse(verifyText) : {};
  } catch {
    verifyPayload = verifyText;
  }
  console.log("[ETSY VERIFY LISTING RESPONSE]", {
    status: verifyResponse.status,
    body: verifyPayload
  });
  if (verifyResponse.status === 404) {
    const cached = await readListingsCache(shopId);
    const nextCache = cached.filter((listing) => normalizeListingId(listing.listing_id || listing.id) !== liveListingId);
    await writeListingsCache(nextCache, {
      source: "etsy_api",
      shop_id: shopId,
      shop_name: tokens.shop_name,
      shop_url: tokens.shop_url
    });
    console.log("[LISTING REMOVED FROM CACHE]", {
      shop_id: shopId,
      listing_id: liveListingId,
      before_count: cached.length,
      after_count: nextCache.length
    });
    const error = new Error("Listing is not accessible in this Etsy shop. Refresh Etsy Listings.");
    error.code = "etsy_resource_not_found";
    error.status = 404;
    error.payload = {
      shop_id: shopId,
      listing_id: liveListingId,
      etsy_status: verifyResponse.status,
      etsy_body: verifyPayload
    };
    throw error;
  }

<<<<<<< HEAD
  let endpoint = `${ETSY_API_BASE}${putPath}`;
  console.log("[ETSY PUT BASE USED]", ETSY_API_BASE);
=======
  let endpoint = `${etsyUpdateBase}${listingPath}`;
  console.log("[ETSY PUT BASE USED]", etsyUpdateBase);
>>>>>>> 9616f21 (fix Etsy PUT URL - correct shop-scoped endpoint)
  console.log("[ETSY PUT URL]", endpoint);
  console.log("[ETSY SHOP ID]", shopId);
  console.log("[ETSY LISTING ID]", liveListingId);
  console.log("[ETSY PUT REQUEST]", {
    shop_id: shopId,
    listing_id: liveListingId,
    original_listing_id: listingId,
    url: endpoint,
    method: "PUT",
    token_scopes: tokens.scope || ETSY_SCOPES,
    has_access_token: Boolean(tokens.access_token),
    access_token_prefix: maskedTokenPrefix(tokens.access_token)
  });
  const putHeaders = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ETSY_CLIENT_ID || "",
    "Authorization": `Bearer ${tokens.access_token}`
  };
  let response = await fetch(endpoint, {
    method: "PUT",
    headers: putHeaders,
    body: JSON.stringify(updatePayload)
  });
  let responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = responseText;
  }
<<<<<<< HEAD
  console.log("[PRIMARY PUT STATUS]", response.status);

if (response.status === 404) {
   const fallbackEndpoint = `${ETSY_API_FALLBACK_BASE}${putPath}`;
    console.log("[ETSY PUT BASE USED]", ETSY_API_FALLBACK_BASE);
=======
  if (!response.ok && response.status === 404) {
    const fallbackEndpoint = `${etsyUpdateBase}${listingPath}`;
    console.log("[ETSY PUT BASE USED]", etsyUpdateBase);
>>>>>>> 9616f21 (fix Etsy PUT URL - correct shop-scoped endpoint)
    console.log("[ETSY PUT URL]", fallbackEndpoint);
    response = await fetch(fallbackEndpoint, {
      method: "PUT",
      headers: putHeaders,
      body: JSON.stringify(updatePayload)
    });
    endpoint = fallbackEndpoint;
    responseText = await response.text();
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = responseText;
    }
  }
  const errorMessage = etsyErrorMessage(payload, response.ok ? "" : `Etsy listing update failed with ${response.status}.`);
  console.log("[ETSY RESPONSE STATUS]", response.status);
  console.log("[ETSY RESPONSE BODY]", payload);
  console.log("[ETSY PUT RESPONSE]", {
    shop_id: shopId,
    listing_id: liveListingId,
    original_listing_id: listingId,
    url: endpoint,
    method: "PUT",
    token_scopes: tokens.scope || ETSY_SCOPES,
    has_access_token: Boolean(tokens.access_token),
    access_token_prefix: maskedTokenPrefix(tokens.access_token),
    etsy_response_status: response.status,
    etsy_response_body: payload,
    etsy_error_message: response.ok ? "" : errorMessage
  });
  if (!response.ok) {
    console.error("[ETSY PUT FAILED]", {
      url: endpoint,
      method: "PUT",
      status: response.status,
      body: payload,
      etsy_error_message: errorMessage,
      token_scopes: tokens.scope || ETSY_SCOPES,
      has_access_token: Boolean(tokens.access_token),
      access_token_prefix: maskedTokenPrefix(tokens.access_token),
      shop_id: shopId,
      listing_id: liveListingId,
      original_listing_id: listingId,
      session_shop_id: sessionShopId,
      session_etsy_auth_shop_id: sessionAuthShopId,
      request_etsy_auth_shop_id: requestAuthShopId,
      token_shop_id: tokens.shop_id || "",
      request_listing_id: rawListingId
    });
    const error = new Error(errorMessage);
    error.code = response.status === 404 ? "etsy_resource_not_found" : "etsy_update_failed";
    error.status = response.status;
    error.payload = {
      shop_id: shopId,
      listing_id: liveListingId,
      etsy_status: response.status,
      etsy_body: payload
    };
    throw error;
  }

  const log = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: "sent",
    email: sessionEmail(req),
    payload: buildPayload(product),
    send_method: "etsy_api",
    listing_id: listingId,
    etsy_response: {
      status: response.status,
      ok: true,
      body: payload
    }
  };
  const logs = await readLogs();
  logs.unshift(log);
  await writeLogs(logs);

  return {
    id: log.id,
    status: "sent",
    send_method: "etsy_api",
    listing_id: liveListingId,
    completed_at: log.completed_at,
    etsy_response: log.etsy_response,
    sent_payload: updatePayload
  };
}

async function sendToMake(product) {
  const payload = buildPayload(product);
  const startedAt = new Date().toISOString();

  if (!WEBHOOK_URL) {
    const log = {
      id: crypto.randomUUID(),
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      email: normalizeEmail(product.email),
      payload,
      make_response: {
        status: null,
        ok: false,
        body: "Make webhook is not configured."
      }
    };
    const logs = await readLogs();
    logs.unshift(log);
    await writeLogs(logs);
    return log;
  }

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = null;
    }
    console.log("[AI RESPONSE RAW]", responseText.slice(0, 200));
    console.log("AI optimization raw:", parsed || responseText);

    const log = {
      id: crypto.randomUUID(),
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      status: response.ok ? "completed" : "failed",
      email: normalizeEmail(product.email),
      payload,
      make_response: {
        status: response.status,
        ok: response.ok,
        body: responseText,
        parsed
      }
    };

    const logs = await readLogs();
    logs.unshift(log);
    await writeLogs(logs);

    if (response.ok) {
      const normalizedParsed = normalizeOptimization(parsed || responseText);
      log.raw_optimization_valid = validateJewelryOptimization(normalizedParsed, product).valid;
    }

    return log;
  } catch (error) {
    const log = {
      id: crypto.randomUUID(),
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      email: normalizeEmail(product.email),
      payload,
      make_response: {
        status: null,
        ok: false,
        body: error instanceof Error ? error.message : String(error)
      }
    };

    const logs = await readLogs();
    logs.unshift(log);
    await writeLogs(logs);
    return log;
  }
}

function sessionSummary(session, user = null, options = {}) {
  const devMode = Boolean(options.dev_mode);
  const summaryUser = devMode ? devCreditUser(user) : user;
  const creditsRemaining = summaryUser ? summaryUser.credits_remaining : devMode ? 9999 : 0;
  const optimizationsUsed = summaryUser ? summaryUser.optimizations_used || 0 : session.optimizations_used || 0;
  const plan = summaryUser ? summaryUser.plan : "free";
  const freeLimit = summaryUser ? summaryUser.credits_granted || PLAN_CREDITS.free : devMode ? 9999 : FREE_OPTIMIZATION_LIMIT;

  return {
    id: session.id,
    user_id: summaryUser?.id || "",
    free_limit: freeLimit,
    optimizations_used: optimizationsUsed,
    free_remaining: creditsRemaining,
    credits_remaining: creditsRemaining,
    credits_granted: summaryUser?.credits_granted || (devMode ? 9999 : 0),
    current_plan: plan,
    plan,
    limit_reached: devMode ? false : Boolean(summaryUser) && creditsRemaining <= 0,
    email_required: !summaryUser,
    dev_mode: devMode,
    onboarding_completed: session.onboarding_completed,
    store_name: session.store_name,
    email: summaryUser?.email || session.email || ""
  };
}

function handleTestMakeResponse(req, res) {
  try {
    const payload = {
      ok: true,
      message: "Test Make Response OK",
      source: "server",
      method: req.method,
      timestamp: Date.now()
    };
    console.log("test-make-response POST hit");
    console.log("test-make-response response payload", payload);
    res.status(200).json(payload);
  } catch (error) {
    console.error("test-make-response caught error", error?.stack || error);
    res.status(500).json({
      ok: false,
      message: "Test Make Response failed",
      error: error instanceof Error ? error.message : String(error),
      source: "server",
      method: req.method,
      timestamp: Date.now()
    });
  }
}

app.get("/api/logs", requireUser, async (req, res) => {
  res.json(successResponse((await readLogs()).filter((log) => belongsToSessionEmail(log, req)), "Logs loaded"));
});

app.get("/api/session", async (req, res) => {
  res.json(successResponse(sessionSummary(req.session, await getSessionUser(req.session), { dev_mode: isDevelopmentBypass(req) }), "Session loaded"));
});

app.get("/api/etsy/status", async (req, res) => {
  try {
    const tokens = await resolveRequestEtsyAuth(req);
    res.json(successResponse(await etsyTokenStatus(tokens), "Etsy auth status loaded"));
  } catch (error) {
    res.status(500).json(errorResponse("etsy_status_failed", error instanceof Error ? error.message : String(error)));
  }
});

app.get("/api/auth-status", async (req, res) => {
  try {
    const tokens = await resolveRequestEtsyAuth(req);
    res.json(successResponse(await etsyTokenStatus(tokens), "Etsy auth status loaded"));
  } catch (error) {
    res.status(500).json(errorResponse("etsy_status_failed", error instanceof Error ? error.message : String(error)));
  }
});

app.get("/api/auth/status", async (req, res) => {
  try {
    const tokens = await resolveRequestEtsyAuth(req);
    res.json(successResponse(await etsyTokenStatus(tokens), "Etsy auth status loaded"));
  } catch (error) {
    res.status(500).json(errorResponse("etsy_status_failed", error instanceof Error ? error.message : String(error)));
  }
});

async function startEtsyOAuth(req, res) {
  if (!etsyConfigured()) {
    res.status(503).send("Etsy API is not configured. Set ETSY_CLIENT_ID and ETSY_REDIRECT_URI.");
    return;
  }
  const { verifier, challenge } = createPkcePair();
  const state = crypto.randomUUID();
  req.session.etsy_oauth_state = state;
  req.session.etsy_code_verifier = verifier;
  req.session.etsy_oauth_started_at = new Date().toISOString();
  setOauthCookie(res, "acopes_etsy_oauth_state", state);
  setOauthCookie(res, "acopes_etsy_code_verifier", verifier);
  etsyDebug("Starting Etsy OAuth request", { scopes: ETSY_SCOPES, redirect_uri: ETSY_REDIRECT_URI });
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: ETSY_REDIRECT_URI,
    scope: ETSY_SCOPES,
    client_id: ETSY_CLIENT_ID,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  res.redirect(`${ETSY_AUTH_URL}?${params.toString()}`);
}

async function finishEtsyOAuth(req, res) {
  try {
    if (!etsyConfigured()) throw new Error("Etsy API is not configured.");
    if (!req.query.code) throw new Error("Missing Etsy authorization code.");
    const cookies = parseCookies(req.headers.cookie || "");
    const expectedState = cookies.acopes_etsy_oauth_state || req.session.etsy_oauth_state || "";
    if (!req.query.state || req.query.state !== expectedState) throw new Error("Invalid Etsy OAuth state.");
    const codeVerifier = cookies.acopes_etsy_code_verifier || req.session.etsy_code_verifier || "";
    clearOauthCookies(res);
    const response = await fetch(ETSY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ETSY_CLIENT_ID,
        redirect_uri: ETSY_REDIRECT_URI,
        code: String(req.query.code),
        code_verifier: codeVerifier
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error_description || payload.error || "Etsy token exchange failed.");
    const tokens = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_type: payload.token_type || "Bearer",
      scope: payload.scope || ETSY_SCOPES,
      expires_at: Date.now() + Number(payload.expires_in || 3600) * 1000,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    etsyDebug("Etsy token received", {
      has_access_token: Boolean(payload.access_token),
      has_refresh_token: Boolean(payload.refresh_token),
      scope: payload.scope || ETSY_SCOPES,
      expires_in: payload.expires_in || 3600
    });
    req.session.etsy_oauth_state = "";
    req.session.etsy_code_verifier = "";
    req.session.etsy_connected_at = new Date().toISOString();
    let resolvedTokens = tokens;
    try {
      resolvedTokens = await discoverEtsyShop(tokens, { req, res });
    } catch (error) {
      etsyDebug("Shop status resolution skipped", { error: error instanceof Error ? error.message : String(error) });
    }
    await persistRequestEtsyAuth(req, res, resolvedTokens);
    const connectToken = crypto.randomUUID();
    const callbackEmail = normalizeEmail(req.session?.email || "");
    if (callbackEmail) {
      await updateUserByEmail(callbackEmail, {
        etsy_auth: publicEtsyAuth(resolvedTokens),
        etsy_connect_token: connectToken,
        etsy_connect_token_expires: Date.now() + 300000
      });
    }
    console.log("[CALLBACK] email saved to session:", req.session?.email ? "yes" : "no");
    console.log("[CALLBACK] etsy_auth saved to session:", req.session?.etsy_auth ? "yes" : "no");
    console.log("[CALLBACK] session keys:", Object.keys(req.session || {}));
    console.log("[OAUTH SAVE]", {
      email: req.session?.email || "",
      user_id: resolvedTokens.user_id || "",
      shop_id: resolvedTokens.shop_id || "",
      token_present: Boolean(resolvedTokens.access_token)
    });
    etsyDebug("Etsy auth saved after callback", {
      hasAccessToken: Boolean(resolvedTokens.access_token),
      hasRefreshToken: Boolean(resolvedTokens.refresh_token),
      shop_id: resolvedTokens.shop_id || "",
      shop_name: resolvedTokens.shop_name || ""
    });
    try {
      await syncEtsyListings(resolvedTokens, res, req);
    } catch (error) {
      etsyDebug("Initial Etsy listing sync skipped", { error: error instanceof Error ? error.message : String(error) });
    }
    const redirectParams = new URLSearchParams({ etsy: "connected" });
    if (callbackEmail) {
      redirectParams.set("connect_token", connectToken);
      redirectParams.set("email", callbackEmail);
    }
    res.redirect(`/app.html?${redirectParams.toString()}`);
  } catch (error) {
    clearOauthCookies(res);
    res.redirect(`/app.html?etsy=error&message=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
  }
}

app.get("/auth/etsy", startEtsyOAuth);
app.get("/api/etsy/auth", startEtsyOAuth);
app.get("/api/etsy/connect", startEtsyOAuth);
app.get("/auth/etsy/callback", finishEtsyOAuth);
app.get("/api/etsy/callback", finishEtsyOAuth);

app.post("/api/etsy/activate-token", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const token = String(req.body.token || "").trim();
  if (!email || !token) {
    res.status(400).json(errorResponse("invalid_connect_token", "Missing Etsy connect token or email."));
    return;
  }
  const users = await readUsers();
  const user = users.find((item) => normalizeEmail(item.email) === email);
  const tokenMatches = user?.etsy_connect_token && user.etsy_connect_token === token;
  const tokenActive = Number(user?.etsy_connect_token_expires || 0) > Date.now();
  if (!user || !tokenMatches || !tokenActive || !user.etsy_auth) {
    res.status(401).json(errorResponse("invalid_connect_token", "Etsy connect token is invalid or expired."));
    return;
  }
  user.etsy_connect_token = "";
  user.etsy_connect_token_expires = 0;
  user.updated_at = new Date().toISOString();
  await writeUsers(users);
  req.session.email = email;
  req.session.user_id = user.id;
  req.session.onboarding_completed = true;
  req.session.etsy_auth = user.etsy_auth;
  req.user = user;
  req.etsyAuth = user.etsy_auth;
  res.json(successResponse({
    status: "activated",
    auth_token: createAuthToken(user, user.etsy_auth),
    etsy: await etsyTokenStatus(user.etsy_auth)
  }, "Etsy session activated"));
});

app.post("/api/etsy/disconnect", requireUser, async (req, res) => {
  clearEtsyAuthCookie(res);
  if (req.user?.id) await updateUser(req.user.id, { etsy_auth: null });
  res.json(successResponse(await etsyTokenStatus(), "Etsy disconnected"));
});

app.post("/api/etsy/sync", requireUser, async (req, res) => {
  try {
    if (!etsyConfigured()) {
      res.status(503).json(errorResponse("etsy_not_configured", "Etsy API is not configured.", await etsyTokenStatus(req.etsyAuth || {})));
      return;
    }
    const userTokens = await resolveRequestEtsyAuth(req);
    if (!userTokens.access_token) {
      res.status(401).json(errorResponse("etsy_not_connected", "Please connect your Etsy shop", { listings: [], etsy: await etsyTokenStatus(userTokens) }));
      return;
    }
    const listings = await syncEtsyListings(userTokens, res, req);
    res.json(successResponse({
      status: "completed",
      source: "etsy_api",
      listings,
      etsy: await etsyTokenStatus(req.etsyAuth || userTokens)
    }, "Etsy listings synced"));
  } catch (error) {
    const isRefreshFailure = error?.code === "token_refresh_failed" || error?.code === "missing_refresh_token";
    const status = error?.code === "seller_account_required" ? 403 : isRefreshFailure || error?.status === 401 ? 401 : 502;
    const errorCode = error?.code === "seller_account_required" ? "seller_account_required" : error?.code === "missing_refresh_token" ? "missing_refresh_token" : isRefreshFailure ? "token_refresh_failed" : status === 401 ? "etsy_reconnect_required" : "etsy_sync_failed";
    res.status(status).json(errorResponse(
      errorCode,
      error instanceof Error ? error.message : String(error),
      { etsy: { ...(await etsyTokenStatus(req.etsyAuth || {})), reconnect_required: true, token_status: "reconnect_required" } }
    ));
  }
});

app.post("/api/etsy/refresh-sync", requireUser, async (req, res) => {
  try {
    const userTokens = await resolveRequestEtsyAuth(req);
    if (!userTokens.access_token) {
      res.status(401).json(errorResponse("etsy_not_connected", "Please connect your Etsy shop", { listings: [], etsy: await etsyTokenStatus(userTokens) }));
      return;
    }
    const token = await ensureValidEtsyToken(userTokens, res, req);
    etsyDebug("Etsy token refresh debug", {
      hasAccessToken: Boolean(token.access_token),
      hasRefreshToken: Boolean(token.refresh_token),
      expiresAt: token.expires_at || null,
      isExpired: !etsyTokenUsable(token),
      refreshAttempted: token.last_refresh_status === "refreshed",
      refreshSuccess: token.last_refresh_status === "refreshed",
      etsyStatusCode: null
    });
    const listings = await syncEtsyListings(token, res, req);
    res.json(successResponse({
      status: "completed",
      source: "etsy_refresh_sync",
      listings,
      etsy: await etsyTokenStatus(token)
    }, "Etsy refresh sync completed"));
  } catch (error) {
    const errorCode = error?.code === "seller_account_required" ? "seller_account_required" : error?.code === "missing_refresh_token" ? "missing_refresh_token" : error?.code === "token_refresh_failed" ? "token_refresh_failed" : "etsy_sync_failed";
    res.status(errorCode === "seller_account_required" ? 403 : errorCode === "etsy_sync_failed" ? 502 : 401).json(errorResponse(
      errorCode,
      error instanceof Error ? error.message : String(error),
      { etsy: { ...(await etsyTokenStatus(req.etsyAuth || {})), reconnect_required: true, token_status: "reconnect_required" } }
    ));
  }
});

app.post("/api/onboarding", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) {
    res.status(400).json(errorResponse("email_required", "Email is required.", { session: sessionSummary(req.session) }));
    return;
  }

  const user = await getOrCreateUser(email);
  req.session.onboarding_completed = true;
  req.session.store_name = req.body.store_name || "";
  req.session.email = email;
  req.session.user_id = user.id;
  req.session.etsy_auth = user.etsy_auth || req.session.etsy_auth || null;
  res.json(successResponse({
    ...sessionSummary(req.session, user, { dev_mode: isDevelopmentBypass(req) }),
    auth_token: createAuthToken(user, req.session.etsy_auth)
  }, "Onboarding completed"));
});

app.get("/api/analytics", async (_req, res) => {
  res.json(successResponse(await readRuntimeJson(analyticsPath, analyticsSeedPath, {}), "Analytics loaded"));
});

app.post("/api/visit", async (_req, res) => {
  res.json(successResponse(await incrementAnalytics("visit"), "Visit tracked"));
});

app.post("/api/waitlist", async (req, res) => {
  const waitlist = await readJsonFile(waitlistPath);
  waitlist.unshift({
    id: crypto.randomUUID(),
    email: req.body.email || "",
    shop_url: req.body.shop_url || "",
    created_at: new Date().toISOString()
  });
  await writeJsonFile(waitlistPath, waitlist);
  await incrementAnalytics("waitlist_signup");
  res.json(successResponse({ status: "joined" }, "Joined waitlist"));
});

app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
  const users = await readUsers();
  const optimizations = await readRuntimeJsonFast(optimizationsPath, optimizationsSeedPath, []);
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const normalizedUsers = users.map((user) => {
    const email = normalizeEmail(user.email);
    const userOptimizations = optimizations.filter((record) => normalizeEmail(record.email) === email);
    const creditsGranted = Number(user.credits_granted || PLAN_CREDITS[user.plan] || PLAN_CREDITS.free);
    const creditsRemaining = Number(user.credits_remaining ?? creditsGranted);
    return {
      email,
      shop_name: user.store_name || user.shop_name || user.etsy_auth?.shop_name || "",
      shop_url: user.shop_url || user.etsy_auth?.shop_url || "",
      credits_used: Math.max(0, creditsGranted - creditsRemaining),
      optimizations_count: userOptimizations.length || Number(user.optimizations_used || 0),
      last_active: user.updated_at || user.created_at || "",
      etsy_connected: user.etsy_auth?.access_token || user.etsy_auth?.refresh_token ? "yes" : "no"
    };
  });
  res.json(successResponse({
    total_registered_users: users.length,
    users: normalizedUsers,
    optimizations: {
      today: optimizations.filter((record) => new Date(record.created_at || 0).getTime() >= dayStart.getTime()).length,
      this_week: optimizations.filter((record) => new Date(record.created_at || 0).getTime() >= weekStart.getTime()).length,
      all_time: optimizations.length
    },
    generated_at: new Date(now).toISOString()
  }, "Admin stats loaded"));
});

app.get("/api/optimizations", requireUser, async (req, res) => {
  const records = await readRuntimeJsonFast(optimizationsPath, optimizationsSeedPath, []);
  const userTokens = await resolveRequestEtsyAuth(req);
  const liveListings = await readListingsCache(userTokens.shop_id);
  const liveIds = new Set(
    liveListings
      .filter((item) => item.sync_source === "etsy_api")
      .map((item) => normalizeListingId(item.listing_id || item.id))
      .filter(Boolean)
  );
  const filtered = records
    .filter((record) => belongsToSessionEmail(record, req))
    .filter((record) => {
      const id = normalizeListingId(record.listing_id);
      const keep = id && id !== "4384247178" && liveIds.has(id);
      console.log(keep ? "[OPTIMIZATION PRUNE]" : "[STALE RECORD REMOVED]", {
        listing_id: id || "missing",
        live: liveIds.has(id),
        blocked: id === "4384247178"
      });
      return keep;
    });
  res.json(successResponse(filtered.map(enrichOptimizationRecord), "Optimizations loaded"));
});

app.get("/api/queue", requireUser, async (req, res) => {
  const userTokens = await resolveRequestEtsyAuth(req);
  const liveListings = await readListingsCache(userTokens.shop_id);
  const liveIds = new Set(
    liveListings
      .filter((item) => item.sync_source === "etsy_api")
      .map((item) => normalizeListingId(item.listing_id || item.id))
      .filter(Boolean)
  );
  const items = await readRuntimeJsonFast(queuePath, queueSeedPath, []);
  const filtered = items
    .filter((item) => belongsToSessionEmail(item, req))
    .filter((item) => {
      const id = normalizeListingId(item.listing_id);
      const keep = id && id !== "4384247178" && liveIds.has(id);
      console.log(keep ? "[QUEUE PRUNE]" : "[STALE RECORD REMOVED]", {
        listing_id: id || "missing",
        live: liveIds.has(id),
        blocked: id === "4384247178"
      });
      return keep;
    });
  res.json(successResponse(filtered, "Queue loaded"));
});

app.post("/api/clear-stale-queue", requireUser, async (req, res) => {
  const userTokens = await resolveRequestEtsyAuth(req);
  const liveListings = (await readListingsCache(userTokens.shop_id)).filter((listing) => String(listing.sync_source || "") === "etsy_api");
  const liveIds = new Set(liveListings.map((listing) => normalizeListingId(listing.listing_id || listing.id)).filter(Boolean));
  const blockedIds = new Set(["4384247178"]);
  const isLive = (item) => {
    const listingId = normalizeListingId(item.listing_id || item.id);
    return listingId && liveIds.has(listingId) && !blockedIds.has(listingId) && belongsToSessionEmail(item, req);
  };
  const queue = await readRuntimeJson(queuePath, queueSeedPath, []);
  const optimizations = await readRuntimeJson(optimizationsPath, optimizationsSeedPath, []);
  const nextQueue = queue.filter(isLive);
  const nextOptimizations = optimizations.filter(isLive);
  await writeJsonFile(queuePath, nextQueue);
  await writeJsonFile(optimizationsPath, nextOptimizations);
  console.log("[BACKEND STALE QUEUE CLEARED]", {
    live_count: liveIds.size,
    queue_removed: queue.length - nextQueue.length,
    optimizations_removed: optimizations.length - nextOptimizations.length
  });
  res.json(successResponse({
    live_listing_ids: [...liveIds],
    queue_removed: queue.length - nextQueue.length,
    optimizations_removed: optimizations.length - nextOptimizations.length
  }, "Stale queue cleared"));
});

app.get("/api/listings", requireUser, async (req, res) => {
  try {
    const userTokens = await resolveRequestEtsyAuth(req);
    etsyDebug("Listings auth snapshot", {
      hasAccessToken: Boolean(userTokens.access_token),
      hasRefreshToken: Boolean(userTokens.refresh_token),
      user_id: userTokens.user_id || "",
      shop_id: userTokens.shop_id || "",
      scopes: userTokens.scope || ETSY_SCOPES
    });
    if (!userTokens.access_token) {
      res.status(401).json(errorResponse("etsy_not_connected", "Please connect your Etsy shop", {
        status: "failed",
        listings: [],
        etsy: await etsyTokenStatus(userTokens)
      }));
      return;
    }
    const validTokens = await ensureValidEtsyToken(userTokens, res, req);
    const sessionShopId = req.session?.etsy_shop_id || "";
    const sessionShopName = req.session?.etsy_shop_name || "";
    const tokens = sessionShopId
      ? {
          ...validTokens,
          shop_id: String(sessionShopId),
          shop_name: sessionShopName || validTokens.shop_name || FALLBACK_SHOP_NAME,
          shop_url: req.session?.etsy_shop_url || validTokens.shop_url || ""
        }
      : await discoverEtsyShop(validTokens, { req, res });
    const response = await fetch(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(tokens.shop_id)}/listings/active?limit=100&includes=Images`, {
      headers: etsyApiHeaders(tokens.access_token)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      etsyDebug("Etsy listings API failed", {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: payload,
        shop_id: tokens.shop_id || "",
        user_id: tokens.user_id || ""
      });
      const error = new Error(payload.error || payload.message || `Etsy API failed with ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    const listings = extractEtsyResults(payload).map((listing) => normalizeListing({
      ...listing,
      sync_source: "etsy_api",
      details_status: "synced"
    })).filter((listing) => {
      const listingShopId = normalizeListingId(listing.shop_id || listing.Shop?.shop_id || "");
      return listing.listing_id && listing.title && (!listingShopId || listingShopId === normalizeListingId(tokens.shop_id));
    });
    console.log("Etsy API listing count", { count: listings.length });
    await writeListingsCache(listings, {
      source: "etsy_api",
      shop_id: tokens.shop_id,
      shop_name: tokens.shop_name,
      shop_url: tokens.shop_url
    });
    res.json(successResponse({
      status: "completed",
      source: "etsy_api",
      etsy: await etsyTokenStatus(tokens),
      listings
    }, "Etsy listings synced"));
  } catch (error) {
    const status = error?.status === 401 ? 401 : error?.status === 403 ? 403 : 502;
    const errorCode = error?.code === "seller_account_required" ? "seller_account_required" : status === 401 ? "etsy_auth_required" : "listings_failed";
    res.status(status).json(errorResponse(errorCode, error instanceof Error ? error.message : String(error), {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    }));
  }
});

app.post("/api/optimize", requireUser, async (req, res) => {
  try {
    await incrementAnalytics("optimization_started");
    const baseProduct = req.body.product || req.body.listing || req.body || {};
    const product = { ...baseProduct, email: sessionEmail(req), optimization_mode: req.body.optimization_mode || baseProduct.optimization_mode || "safe_seo" };
    console.log("[OPTIMIZE START]", {
      listing_name: product.name || product.title || product.listing_id || "unknown_listing",
      optimization_mode: product.optimization_mode
    });
    const log = await sendToMakeWithTaxonomyRetry(product);
    const user = await getSessionUser(req.session);
    const responseBody = successResponse(
      buildOptimizationResponsePayload(product, log, sessionSummary(req.session, user, { dev_mode: isDevelopmentBypass(req) })),
      log.status === "completed" ? "Optimization queued" : "Optimization generated with fallback"
    );
    console.log("FINAL OPT RESPONSE:", JSON.stringify(responseBody, null, 2));
    res.status(200).json(responseBody);
  } catch (error) {
    console.error("[OPTIMIZE ERROR]", error?.stack || error);
    const status = error?.status && Number(error.status) >= 400 ? Number(error.status) : 500;
    res.status(status).json({
      ok: false,
      success: false,
      error: error?.code || "optimization_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/send", requireUser, async (req, res) => {
  const user = await getSessionUser(req.session);
  const devMode = isDevelopmentBypass(req);
  if (!user) {
    res.status(401).json(errorResponse("email_required", "Email onboarding is required.", { session: sessionSummary(req.session, null, { dev_mode: devMode }) }));
    return;
  }
  const creditBlocked = !devMode && user.credits_remaining < 1;
  await incrementAnalytics("optimization_started");
  const sendProduct = { ...(req.body.product || {}), email: sessionEmail(req), optimization_mode: req.body.optimization_mode || req.body.product?.optimization_mode || "safe_seo" };
  const log = await sendToMakeWithTaxonomyRetry(sendProduct);
  const updatedUser = !devMode && !creditBlocked && log.status === "completed" ? await consumeCredits(user, 1) : user;
  const responseBody = successResponse(
    buildOptimizationResponsePayload(sendProduct, { ...log, credit_blocked: creditBlocked }, sessionSummary(req.session, updatedUser, { dev_mode: devMode })),
    log.status === "completed" ? "Optimization queued" : "Optimization generated with fallback"
  );
  console.log("FINAL OPT RESPONSE:", JSON.stringify(responseBody, null, 2));
  res.status(200).json(responseBody);
});

async function handleSendBatch(req, res) {
  const products = Array.isArray(req.body.products) ? req.body.products : [];
  const user = await getSessionUser(req.session);
  const devMode = isDevelopmentBypass(req);
  console.log("[SEND BATCH REQUEST]", {
    count: products.length,
    direct_etsy_mode: !WEBHOOK_URL,
    listing_ids: products.map((product) => normalizeListingId(product.listing_id || product.id))
  });
  if (!user) {
    res.status(401).json(errorResponse("email_required", "Email onboarding is required.", { session: sessionSummary(req.session, null, { dev_mode: devMode }) }));
    return;
  }
  if (!devMode && user.credits_remaining < products.length) {
    res.status(402).json(errorResponse("credits_depleted", "Credits depleted.", { session: sessionSummary(req.session, user) }));
    return;
  }
  const results = [];
  const directEtsyMode = !WEBHOOK_URL;
  try {
    for (const product of products) {
      console.log("[SEND BATCH ITEM]", {
        listing_id: normalizeListingId(product.listing_id || product.id),
        title: product.title || product.name || "",
        has_optimized_title: Boolean(product.optimized_title || product.optimizedTitle)
      });
      await incrementAnalytics("optimization_started");
      const sendProduct = { ...product, email: sessionEmail(req), optimization_mode: req.body.optimization_mode || product.optimization_mode || "safe_seo" };
      results.push(directEtsyMode ? await updateEtsyListingDirect(req, res, sendProduct) : await sendToMakeWithTaxonomyRetry(sendProduct));
    }
  } catch (error) {
    const status = error?.status && Number(error.status) >= 400 ? Number(error.status) : 502;
    const errorData = {
      status: "failed",
      send_method: directEtsyMode ? "etsy_api" : "make",
      results,
      etsy_response: error?.payload || null,
      session: sessionSummary(req.session, user, { dev_mode: devMode })
    };
    if (error?.code === "etsy_resource_not_found") {
      Object.assign(errorData, error.payload || {});
    }
    res.status(status).json(errorResponse(error?.code || "etsy_update_failed", error instanceof Error ? error.message : String(error), errorData));
    return;
  }
  const completedCount = results.filter((item) => item.status === "completed" || item.status === "sent").length;
  const updatedUser = !devMode && completedCount > 0 ? await consumeCredits(user, completedCount) : user;
  res.json(successResponse({
    status: results.every((item) => item.status === "completed" || item.status === "sent") ? (directEtsyMode ? "sent" : "completed") : "partial",
    send_method: directEtsyMode ? "etsy_api" : "make",
    results,
    session: sessionSummary(req.session, updatedUser, { dev_mode: devMode })
  }, directEtsyMode ? "Batch sent to Etsy" : "Batch processed"));
}

app.post("/api/retry/:id", requireUser, async (req, res) => {
  const user = await getSessionUser(req.session);
  const devMode = isDevelopmentBypass(req);
  if (!user) {
    res.status(401).json(errorResponse("email_required", "Email onboarding is required.", { session: sessionSummary(req.session, null, { dev_mode: devMode }) }));
    return;
  }
  if (!devMode && user.credits_remaining < 1) {
    res.status(402).json(errorResponse("credits_depleted", "Credits depleted.", { session: sessionSummary(req.session, user) }));
    return;
  }
  if (!WEBHOOK_URL) {
    res.status(503).json(errorResponse("make_webhook_not_configured", "Make webhook is not configured.", {
      error: "make_webhook_not_configured",
      message: "Make webhook is not configured.",
      session: sessionSummary(req.session, user, { dev_mode: devMode })
    }));
    return;
  }

  const logs = await readLogs();
  const original = logs.find((log) => log.id === req.params.id && belongsToSessionEmail(log, req));
  if (!original) {
    res.status(404).json(errorResponse("log_not_found", "Log not found"));
    return;
  }

  const product = {
    name: original.payload.product_name,
    type: original.payload.product_type,
    style: original.payload.style,
    title: original.payload.current_title,
    description: original.payload.current_description,
    tags: original.payload.current_tags,
    image_url: original.payload.image_url,
    listing_id: original.payload.listing_id,
    email: sessionEmail(req)
  };

  const log = await sendToMake(product);
  const updatedUser = !devMode && log.status === "completed" ? await consumeCredits(user, 1) : user;
  res.status(log.status === "completed" ? 200 : 502).json((log.status === "completed" ? successResponse : errorResponse)(
    log.status === "completed" ? {
    ...log,
    session: sessionSummary(req.session, updatedUser, { dev_mode: devMode })
    } : "make_request_failed",
    log.status === "completed" ? "Retry queued" : "Retry failed.",
    log.status === "completed" ? undefined : { ...log, session: sessionSummary(req.session, updatedUser, { dev_mode: devMode }) }
  ));
});

app.post("/api/make-response", async (req, res) => {
  if (!isAuthorizedMakeResponse(req)) {
    console.log("MAKE webhook auth debug", {
      hasEnvSecret: Boolean(process.env.MAKE_RESPONSE_SECRET),
      envLength: process.env.MAKE_RESPONSE_SECRET ? process.env.MAKE_RESPONSE_SECRET.length : 0,
      hasHeaderSecret: Boolean(req.headers["x-acopes-webhook-secret"]),
      headerLength: req.headers["x-acopes-webhook-secret"] ? String(req.headers["x-acopes-webhook-secret"]).length : 0,
      headerKeys: Object.keys(req.headers)
    });
    res.status(401).json({ success: false, error: "unauthorized_webhook" });
    return;
  }
  const parsed = parseMakeResponseBody(req.body);
  if (!parsed.ok) {
    res.status(400).json(errorResponse("invalid_json", "Invalid JSON."));
    return;
  }
  const validated = normalizeMakeResponsePayload(parsed.value);
  if (!validated.ok) {
    res.status(400).json(errorResponse(validated.error, validated.error));
    return;
  }
  const optimized = validated.value;
  const listings = await readListingsCache();
  const incomingListingId = normalizeListingId(optimized.listing_id);
  let listing = listings.find((item) => {
    const storedListingId = normalizeListingId(item.listing_id || item.id);
    return storedListingId === incomingListingId;
  });
  const created = !listing;
  if (listing) {
    Object.assign(listing, normalizeListing({
      ...listing,
      listing_id: incomingListingId,
      title: optimized.current_title || listing.title || optimized.seo_title,
      description: optimized.current_description || listing.description || "",
      tags: Array.isArray(optimized.current_tags) ? optimized.current_tags : listing.tags,
      image_url: optimized.image_url || optimized.thumbnail_preview_url || listing.image_url,
      sync_source: listing.sync_source || "make_callback",
      details_status: listing.details_status || "callback_merged"
    }));
  } else {
    listing = normalizeListing({
      listing_id: incomingListingId,
      name: optimized.product_name || optimized.listing_name || optimized.seo_title || `Listing ${incomingListingId}`,
      type: optimized.product_type || inferType(optimized.seo_title || ""),
      style: optimized.style || inferStyle(optimized.seo_title || "", optimized.tags),
      title: optimized.current_title || optimized.seo_title || `Listing ${incomingListingId}`,
      description: optimized.current_description || "",
      tags: Array.isArray(optimized.current_tags) ? optimized.current_tags : [],
      image_url: optimized.image_url || optimized.thumbnail_preview_url || optimized.hero_thumbnail_url || "",
      source_url: optimized.source_url || (incomingListingId ? `https://www.etsy.com/listing/${incomingListingId}` : ""),
      state: "draft_callback",
      details_status: "created_from_make_callback",
      sync_source: "make_callback",
      optimization_focus: "Hero thumbnail generation and Etsy CTR optimization"
    });
    listings.unshift(listing);
  }
  await writeListingsCache(listings, { source: "make_callback", last_listing_id: incomingListingId });

  const record = await createOptimizationRecord({
    listing,
    optimized,
    source: "make_callback"
  });
  await incrementAnalytics("optimization_completed");
  res.json(successResponse({
    ...record,
    created,
    updated: !created,
    auto_publish: false,
    publish_mode: "draft_only"
  }, created ? "Make response accepted and listing created" : "Make response accepted and listing updated"));
});

app.post("/api/paddle-webhook-test", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json(errorResponse("disabled_in_production", "Disabled in production."));
    return;
  }

  const email = normalizeEmail(req.body.email);
  const plan = String(req.body.plan || "").toLowerCase();
  if (!email || !["pro", "agency"].includes(plan)) {
    res.status(400).json(errorResponse("invalid_plan", "Provide email and plan: pro or agency"));
    return;
  }

  const user = await getOrCreateUser(email);
  const updatedUser = await updateUser(user.id, {
    plan,
    credits_remaining: PLAN_CREDITS[plan],
    credits_granted: PLAN_CREDITS[plan]
  });

  let session = req.session;
  if (normalizeEmail(req.session.email) === email || !req.session.email) {
    req.session.email = email;
    req.session.user_id = updatedUser.id;
    req.session.onboarding_completed = true;
    session = req.session;
  }

  res.json(successResponse({
    status: "updated",
    user: updatedUser,
    session: sessionSummary(session, updatedUser)
  }, "Plan updated"));
});

app.post("/api/queue", requireUser, async (req, res) => {
  const listings = Array.isArray(req.body.listings) ? req.body.listings : [];
  const queue = await readRuntimeJson(queuePath, queueSeedPath, []);
  const queued = listings.map((listing) => ({
    id: crypto.randomUUID(),
    email: sessionEmail(req),
    listing_id: listing.listing_id,
    listing_name: listing.name,
    queued_at: new Date().toISOString(),
    status: "queued",
    priority: "hero_thumbnail_ctr",
    retry_count: 0
  }));
  queue.push(...queued);
  await writeJsonFile(queuePath, queue);
  res.json(successResponse({ status: "queued", queued }, "Listings queued"));
});

app.post("/api/queue/:id/retry", requireUser, async (req, res) => {
  const queue = await readRuntimeJson(queuePath, queueSeedPath, []);
  const item = queue.find((entry) => entry.id === req.params.id && belongsToSessionEmail(entry, req));
  if (!item) {
    res.status(404).json(errorResponse("queue_item_not_found", "Queue item not found"));
    return;
  }
  item.status = "queued";
  item.retry_count += 1;
  item.last_retry_at = new Date().toISOString();
  await writeJsonFile(queuePath, queue);
  res.json(successResponse(item, "Queue item retried"));
});

app.post("/api/optimizations/:id/approve", requireUser, async (req, res) => {
  const history = await readRuntimeJson(optimizationsPath, optimizationsSeedPath, []);
  const record = history.find((item) => item.id === req.params.id && belongsToSessionEmail(item, req));
  if (!record) {
    res.status(404).json(errorResponse("optimization_not_found", "Optimization not found"));
    return;
  }
  record.status = "approved_draft";
  record.approved_at = new Date().toISOString();
  record.publish_mode = "draft_only";
  record.auto_publish = false;
  record.execution_status = "awaiting_authenticated_etsy_executor";
  await writeJsonFile(optimizationsPath, history);
  res.json(successResponse(record, "Draft approved"));
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`ACOPES AI optimization platform running at http://localhost:${PORT}`);
  });
}

if (typeof module !== "undefined") {
  module.exports = app;
}

export default app;
