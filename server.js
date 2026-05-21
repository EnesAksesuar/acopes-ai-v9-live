import express from "express";
import fs from "node:fs/promises";
import nodeCrypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadDotEnv(path.join(__dirname, ".env"));
const PORT = process.env.PORT || 4173;
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const runtimeDataDir = path.join(process.env.ACOPES_DATA_DIR || "/tmp", "acopes-ai");
const seedDataDir = path.join(__dirname, "data");
const WEBHOOK_URL = (process.env.MAKE_WEBHOOK_URL || "").trim();
const MAKE_RESPONSE_SECRET = (process.env.MAKE_RESPONSE_SECRET || "").trim();
const logsPath = path.join(runtimeDataDir, "automation-logs.json");
const legacyListingsCachePath = path.join(seedDataDir, "etsy-listings.json");
const listingsSeedPath = path.join(seedDataDir, "listings.json");
const listingsCachePath = path.join(runtimeDataDir, "listings.json");
const optimizationsPath = path.join(runtimeDataDir, "optimization-history.json");
const optimizationsSeedPath = path.join(seedDataDir, "optimization-history.json");
const queuePath = path.join(runtimeDataDir, "optimization-queue.json");
const queueSeedPath = path.join(seedDataDir, "optimization-queue.json");
const sessionsPath = path.join(runtimeDataDir, "sessions.json");
const usersPath = path.join(runtimeDataDir, "users.json");
const usersSeedPath = path.join(seedDataDir, "users.json");
const etsyTokensPath = path.join(runtimeDataDir, "etsy-tokens.json");
const etsyTokensSeedPath = path.join(seedDataDir, "etsy-tokens.json");
const waitlistPath = path.join(runtimeDataDir, "waitlist.json");
const analyticsPath = path.join(runtimeDataDir, "analytics.json");
const analyticsSeedPath = path.join(seedDataDir, "analytics.json");
const listingsMetaPath = path.join(runtimeDataDir, "listings-meta.json");
const ETSY_CLIENT_ID = (process.env.ETSY_CLIENT_ID || "").trim();
const ETSY_REDIRECT_URI = (process.env.ETSY_REDIRECT_URI || `http://localhost:${PORT}/api/etsy/callback`).trim();
const ETSY_SCOPES = (process.env.ETSY_SCOPES || "listings_r shops_r").trim();
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
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

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
    shop_id: tokens.shop_id || "",
    shop_name: tokens.shop_name || "",
    shop_url: tokens.shop_url || "",
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || ETSY_SCOPES,
    updated_at: new Date().toISOString()
  };
}

function readEtsyAuthCookie(req) {
  const raw = parseCookies(req.headers.cookie || "").acopes_etsy_auth;
  if (!raw) return {};
  try {
    return base64UrlDecode(raw);
  } catch {
    return {};
  }
}

function setEtsyAuthCookie(res, tokens = {}) {
  appendSetCookie(res, `acopes_etsy_auth=${encodeURIComponent(base64UrlEncode(publicEtsyAuth(tokens)))}; ${authCookieOptions()}`);
}

function clearEtsyAuthCookie(res) {
  appendSetCookie(res, `acopes_etsy_auth=; ${authCookieOptions(0)}`);
}

async function persistEtsyAuth(res, tokens = {}) {
  const auth = publicEtsyAuth(tokens);
  globalThis.etsyAuthStore = auth;
  await writeEtsyTokens(auth);
  setEtsyAuthCookie(res, auth);
  return auth;
}

app.use(async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || "");
  let sessionId = cookies.edel_beta_sid;
  const sessions = await readJsonFile(sessionsPath);
  let session = sessions.find((item) => item.id === sessionId);
  if (!session) {
    sessionId = crypto.randomUUID();
    session = {
      id: sessionId,
      created_at: new Date().toISOString(),
      optimizations_used: 0,
      onboarding_completed: false,
      store_name: "",
      email: "",
      user_id: ""
    };
    sessions.push(session);
    await writeJsonFile(sessionsPath, sessions);
    res.setHeader("Set-Cookie", `edel_beta_sid=${encodeURIComponent(sessionId)}; Path=/; SameSite=Lax`);
  }
  req.session = session;
  next();
});

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

async function readListingsCache() {
  try {
    const listings = parseJsonText(await fs.readFile(listingsCachePath, "utf8"), []);
    if (Array.isArray(listings) && listings.length) return listings;
  } catch {
    // Fall back to seeded cache files for backward compatibility.
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

async function updateSession(sessionId, patch) {
  const sessions = await readJsonFile(sessionsPath);
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  await writeJsonFile(sessionsPath, sessions);
  return session;
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

async function updateUser(userId, patch) {
  const users = await readUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) return null;
  Object.assign(user, patch, { updated_at: new Date().toISOString() });
  await writeUsers(users);
  return user;
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

function normalizeListingId(value = "") {
  return String(value ?? "").trim();
}

function normalizeMakeResponsePayload(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const listing_id = normalizeListingId(source.listing_id);

  if (!listing_id) {
    return { ok: false, error: "listing_id_required" };
  }

  return {
    ok: true,
    value: {
      ...source,
      listing_id,
      seo_title: typeof source.seo_title === "string" ? source.seo_title : "",
      description: typeof source.description === "string" ? source.description : "",
      tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === "string").slice(0, 13) : [],
      alt_text: typeof source.alt_text === "string" ? source.alt_text : "",
      canva_prompt: typeof source.canva_prompt === "string" ? source.canva_prompt : "",
      thumbnail_preview_url: typeof source.thumbnail_preview_url === "string" ? source.thumbnail_preview_url : "",
      hero_thumbnail_url: typeof source.hero_thumbnail_url === "string" ? source.hero_thumbnail_url : "",
      pinterest_title: typeof source.pinterest_title === "string" ? source.pinterest_title : "",
      pinterest_description: typeof source.pinterest_description === "string" ? source.pinterest_description : "",
      status: typeof source.status === "string" ? source.status : "completed",
      seo_score: numberOrUndefined(source.seo_score),
      ctr_score: numberOrUndefined(source.ctr_score),
      thumbnail_score: numberOrUndefined(source.thumbnail_score),
      tag_score: numberOrUndefined(source.tag_score),
      alt_text_score: numberOrUndefined(source.alt_text_score)
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
  return {
    product_name: product.name,
    product_type: product.type,
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
  const source = input && typeof input === "object" ? input : {};
  return {
    seo_title: typeof source.seo_title === "string" ? source.seo_title : "",
    description: typeof source.description === "string" ? source.description : "",
    tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === "string").slice(0, 13) : [],
    alt_text: typeof source.alt_text === "string" ? source.alt_text : "",
    canva_prompt: typeof source.canva_prompt === "string" ? source.canva_prompt : "",
    thumbnail_preview_url:
      typeof source.thumbnail_preview_url === "string"
        ? source.thumbnail_preview_url
        : typeof source.hero_thumbnail_url === "string"
          ? source.hero_thumbnail_url
          : "",
    pinterest_title: typeof source.pinterest_title === "string" ? source.pinterest_title : "",
    pinterest_description: typeof source.pinterest_description === "string" ? source.pinterest_description : "",
    optimization_status:
      typeof source.status === "string"
        ? source.status
        : typeof source.optimization_status === "string"
          ? source.optimization_status
          : "completed",
    provided_scores: {
      seo_score: numberOrUndefined(source.seo_score),
      ctr_score: numberOrUndefined(source.ctr_score),
      thumbnail_score: numberOrUndefined(source.thumbnail_score),
      tag_quality_score: numberOrUndefined(source.tag_score ?? source.tag_quality_score),
      alt_text_score: numberOrUndefined(source.alt_text_score)
    }
  };
}

function scoreOptimization(optimized = {}, scoreOverrides = {}) {
  const title = optimized.seo_title || "";
  const description = optimized.description || "";
  const tags = optimized.tags || [];
  const alt = optimized.alt_text || "";
  const canva = optimized.canva_prompt || "";
  const titleWords = title.split(/\s+/).filter(Boolean);
  const lowerTitle = title.toLowerCase();
  const giftPhraseMatches = lowerTitle.match(/gift for her|birthday gift|bridesmaid jewelry|quiet luxury gift|anniversary gift|meaningful gift/g) || [];
  const repeatedGiftTerms = new Set(giftPhraseMatches).size !== giftPhraseMatches.length || giftPhraseMatches.length > 1;
  const spamSeparators = (title.match(/,|\||-/g) || []).length;
  const etsy_2026_title_score = Math.max(
    0,
    Math.min(
      100,
      (titleWords.length > 0 && titleWords.length <= 15 ? 35 : 0) +
        (title.length <= 95 ? 20 : 0) +
        (/necklace|bracelet|earrings|ring|jewelry/i.test(title) ? 20 : 0) +
        (!repeatedGiftTerms ? 15 : -20) +
        (spamSeparators <= 2 ? 10 : -25)
    )
  );
  const seo_score = Math.min(
    100,
    (title.length > 0 ? 20 : 0) +
      (titleWords.length <= 15 ? 20 : -10) +
      (/necklace|jewelry|pearl|gold|chain/i.test(title) ? 20 : 0) +
      (description.length > 180 ? 20 : 0) +
      (tags.length === 13 ? 25 : 0) +
      (repeatedGiftTerms || spamSeparators > 3 ? -25 : 0)
  );
  const ctr_score = Math.min(
    100,
    (/hero|thumbnail|mobile|large|clean|ivory|neutral/i.test(canva) ? 45 : 0) +
      (/quiet luxury|minimal|layering|pearl|gold/i.test(title) ? 25 : 0) +
      (titleWords.length <= 15 ? 15 : 0) +
      (canva.length > 80 ? 15 : 0)
  );
  const thumbnail_score = Math.min(
    100,
    (/65|70|75|mobile|ivory|neutral|no clutter|luxury/i.test(canva) ? 70 : 0) +
      (canva.length > 100 ? 30 : 0)
  );
  const tag_quality_score = Math.min(
    100,
    (tags.length === 13 ? 40 : tags.length * 3) +
      tags.filter((tag) => tag.length <= 20).length * 3 +
      new Set(tags.map((tag) => tag.toLowerCase())).size * 2
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
  const mobile_readability_score = Math.min(
    100,
    (titleWords.length > 0 && titleWords.length <= 12 ? 45 : titleWords.length <= 15 ? 35 : 10) +
      (title.length <= 72 ? 35 : title.length <= 95 ? 22 : 8) +
      (spamSeparators <= 2 ? 20 : 5)
  );
  const buyer_intent_score = Math.min(
    100,
    (/necklace|jewelry|chain|pearl|gold/i.test(title) ? 30 : 0) +
      (/gift|birthday|bridesmaid|anniversary|everyday|layer/i.test(description) ? 30 : 0) +
      (tags.some((tag) => /gift|birthday|bridesmaid|everyday|minimal|layer/i.test(tag)) ? 25 : 0) +
      (/minimal|quiet luxury|dainty|timeless/i.test(`${title} ${description}`) ? 15 : 0)
  );
  const competition_score = Math.min(
    100,
    (/gold|pearl|necklace|chain/i.test(title) ? 55 : 35) +
      (titleWords.length <= 15 ? 20 : 5) +
      (tags.length >= 10 ? 20 : tags.length) +
      (repeatedGiftTerms ? -15 : 5)
  );
  const finalSeo = numberOrUndefined(scoreOverrides.seo_score ?? optimized.provided_scores?.seo_score) ?? seo_score;
  const finalCtr = numberOrUndefined(scoreOverrides.ctr_score ?? optimized.provided_scores?.ctr_score) ?? ctr_score;
  const finalThumbnail = numberOrUndefined(scoreOverrides.thumbnail_score ?? optimized.provided_scores?.thumbnail_score) ?? thumbnail_score;
  const finalTags = numberOrUndefined(scoreOverrides.tag_quality_score ?? optimized.provided_scores?.tag_quality_score) ?? tag_quality_score;
  const confidence_score = Math.round(
    finalSeo * 0.25 +
      finalCtr * 0.25 +
      finalThumbnail * 0.2 +
      finalTags * 0.15 +
      mobile_readability_score * 0.05 +
      buyer_intent_score * 0.05 +
      competition_score * 0.05
  );

  return {
    seo_score: finalSeo,
    ctr_score: finalCtr,
    thumbnail_score: finalThumbnail,
    tag_quality_score: finalTags,
    alt_text_score: numberOrUndefined(scoreOverrides.alt_text_score ?? optimized.provided_scores?.alt_text_score) ?? alt_text_score,
    etsy_2026_title_score,
    description_quality_score,
    mobile_readability_score,
    buyer_intent_score,
    competition_score,
    confidence_score
  };
}

function confidenceLabel(score = 0) {
  if (score >= 95) return "Elite";
  if (score >= 90) return "High confidence";
  if (score >= 80) return "Good confidence";
  if (score >= 70) return "Moderate";
  return "Weak optimization";
}

async function createOptimizationRecord({ listing, optimized, source = "make_response", request_log_id = null }) {
  const normalized = normalizeOptimization(optimized);
  const scores = scoreOptimization(normalized);
  const record = {
    id: crypto.randomUUID(),
    listing_id: listing.listing_id,
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
  history.unshift(record);
  await writeJsonFile(optimizationsPath, history);
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
  const stored = await readRuntimeJson(etsyTokensPath, etsyTokensSeedPath, {});
  if (stored.access_token || stored.refresh_token) return stored;
  const envExpiresAt = ETSY_TOKEN_EXPIRES_AT_ENV ? Number(ETSY_TOKEN_EXPIRES_AT_ENV) : 0;
  const envTokens = {
    access_token: ETSY_ACCESS_TOKEN_ENV,
    refresh_token: ETSY_REFRESH_TOKEN_ENV,
    token_type: "Bearer",
    scope: ETSY_SCOPES,
    expires_at: Number.isFinite(envExpiresAt) && envExpiresAt > 0 ? envExpiresAt : 0,
    shop_id: ETSY_SHOP_ID_ENV,
    shop_name: FALLBACK_SHOP_NAME,
    shop_url: FALLBACK_SHOP_URL,
    source: "environment"
  };
  if (envTokens.access_token || envTokens.refresh_token) {
    etsyDebug("Etsy auth loaded", {
      source: "environment",
      hasAccessToken: Boolean(envTokens.access_token),
      hasRefreshToken: Boolean(envTokens.refresh_token),
      shop_id: envTokens.shop_id || "",
      shop_name: envTokens.shop_name || ""
    });
    return envTokens;
  }
  etsyDebug("Etsy auth loaded", {
    source: "none",
    hasAccessToken: false,
    hasRefreshToken: false,
    shop_id: "",
    shop_name: ""
  });
  return {};
}

async function writeEtsyTokens(tokens) {
  await writeJsonFile(etsyTokensPath, tokens || {});
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

async function ensureValidEtsyToken(tokens = null, res = null) {
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
  }
  else if (tokens.last_refresh_status !== "active") {
    tokens = { ...tokens, last_refresh_status: "active" };
    await writeEtsyTokens(tokens);
    if (res) setEtsyAuthCookie(res, tokens);
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

async function etsyApi(pathname, tokens) {
  tokens = await ensureValidEtsyToken(tokens);
  let lastError = null;
  for (const baseUrl of [ETSY_API_BASE, ETSY_API_FALLBACK_BASE]) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        headers: {
          "Authorization": `Bearer ${tokens.access_token}`,
          "x-api-key": ETSY_CLIENT_ID
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const error = new Error(payload.error || payload.message || `Etsy API failed with ${response.status}`);
      error.status = response.status;
      error.baseUrl = baseUrl;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Etsy API request failed.");
}

function extractEtsyResults(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
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

function selectActiveShop(shops = []) {
  return shops.find((shop) => {
    const state = String(shop.state || shop.status || "").toLowerCase();
    if (shop.is_open === false || shop.is_closed === true) return false;
    return !["closed", "inactive", "deleted"].includes(state);
  }) || shops[0] || null;
}

async function discoverEtsyShop(tokens) {
  if (tokens.shop_id && tokens.shop_name) return tokens;
  let me = {};
  try {
    me = await etsyApi("/users/me", tokens);
    etsyDebug("User fetched", { user_id: me.user_id || me.user?.user_id || me.results?.[0]?.user_id || userIdFromToken(tokens) });
  } catch (error) {
    etsyDebug("User fetch fallback", { error: error instanceof Error ? error.message : String(error) });
  }
  const userId = String(me.user_id || me.user?.user_id || me.results?.[0]?.user_id || userIdFromToken(tokens) || "");
  if (!userId) throw new Error("Could not read Etsy user id.");
  let shops = [];
  try {
    const shopsPayload = await etsyApi(`/users/${userId}/shops`, tokens);
    shops = extractEtsyResults(shopsPayload);
  } catch (error) {
    etsyDebug("User shops fetch failed", { user_id: userId, error: error instanceof Error ? error.message : String(error) });
  }
  const shop = selectActiveShop(shops);
  if (!shop?.shop_id) throw new Error("No Etsy shop found for this account.");
  const updated = {
    ...tokens,
    user_id: userId,
    shop_id: String(shop.shop_id),
    shop_name: shop.shop_name || shop.title || "",
    shop_url: urlFromShop(shop),
    updated_at: new Date().toISOString()
  };
  await writeEtsyTokens(updated);
  etsyDebug("Shop resolved", {
    user_id: updated.user_id,
    shop_id: updated.shop_id,
    shop_name: updated.shop_name,
    shops_seen: shops.length
  });
  return updated;
}

async function syncEtsyListings(tokens = null, res = null) {
  tokens = await discoverEtsyShop(await ensureValidEtsyToken(tokens, res));
  globalThis.etsyAuthStore = publicEtsyAuth(tokens);
  if (res) setEtsyAuthCookie(res, tokens);
  console.log("Fetching live Etsy listings", { shop_id: tokens.shop_id || "", shop_name: tokens.shop_name || "" });
  const payload = await etsyApi(`/shops/${tokens.shop_id}/listings/active?limit=100&includes=Images`, tokens);
  const listings = extractEtsyResults(payload).map((listing) => normalizeListing({
    ...listing,
    sync_source: "etsy_api",
    details_status: "synced"
  })).filter((listing) => listing.listing_id && listing.title);
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

async function sendToMake(product) {
  const payload = buildPayload(product);
  const startedAt = new Date().toISOString();

  if (!WEBHOOK_URL) {
    const log = {
      id: crypto.randomUUID(),
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
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

    const log = {
      id: crypto.randomUUID(),
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      status: response.ok ? "completed" : "failed",
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

    if (response.ok && parsed && parsed.seo_title) {
      await createOptimizationRecord({
        listing: product,
        optimized: parsed,
        request_log_id: log.id
      });
    }

    return log;
  } catch (error) {
    const log = {
      id: crypto.randomUUID(),
      created_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
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

function sessionSummary(session, user = null) {
  const creditsRemaining = user ? user.credits_remaining : 0;
  const optimizationsUsed = user ? user.optimizations_used || 0 : session.optimizations_used || 0;
  const plan = user ? user.plan : "free";
  const freeLimit = user ? user.credits_granted || PLAN_CREDITS.free : FREE_OPTIMIZATION_LIMIT;

  return {
    id: session.id,
    user_id: user?.id || "",
    free_limit: freeLimit,
    optimizations_used: optimizationsUsed,
    free_remaining: creditsRemaining,
    credits_remaining: creditsRemaining,
    credits_granted: user?.credits_granted || 0,
    current_plan: plan,
    plan,
    limit_reached: Boolean(user) && creditsRemaining <= 0,
    email_required: !user,
    onboarding_completed: session.onboarding_completed,
    store_name: session.store_name,
    email: user?.email || session.email || ""
  };
}

app.get("/api/logs", async (_req, res) => {
  res.json(successResponse(await readLogs(), "Logs loaded"));
});

app.get("/api/session", async (req, res) => {
  res.json(successResponse(sessionSummary(req.session, await getSessionUser(req.session)), "Session loaded"));
});

app.get("/api/etsy/status", async (req, res) => {
  try {
    const tokens = readEtsyAuthCookie(req);
    res.json(successResponse(await etsyTokenStatus(tokens), "Etsy auth status loaded"));
  } catch (error) {
    res.status(500).json(errorResponse("etsy_status_failed", error instanceof Error ? error.message : String(error)));
  }
});

app.get("/api/auth-status", async (req, res) => {
  try {
    const tokens = readEtsyAuthCookie(req);
    res.json(successResponse(await etsyTokenStatus(tokens), "Etsy auth status loaded"));
  } catch (error) {
    res.status(500).json(errorResponse("etsy_status_failed", error instanceof Error ? error.message : String(error)));
  }
});

app.get("/api/etsy/connect", async (req, res) => {
  if (!etsyConfigured()) {
    res.status(503).send("Etsy API is not configured. Set ETSY_CLIENT_ID and ETSY_REDIRECT_URI.");
    return;
  }
  const { verifier, challenge } = createPkcePair();
  const state = crypto.randomUUID();
  await updateSession(req.session.id, {
    etsy_oauth_state: state,
    etsy_code_verifier: verifier,
    etsy_oauth_started_at: new Date().toISOString()
  });
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
});

app.get("/api/etsy/callback", async (req, res) => {
  try {
    if (!etsyConfigured()) throw new Error("Etsy API is not configured.");
    if (!req.query.code) throw new Error("Missing Etsy authorization code.");
    if (!req.query.state || req.query.state !== req.session.etsy_oauth_state) throw new Error("Invalid Etsy OAuth state.");
    const response = await fetch(ETSY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ETSY_CLIENT_ID,
        redirect_uri: ETSY_REDIRECT_URI,
        code: String(req.query.code),
        code_verifier: req.session.etsy_code_verifier || ""
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
    await updateSession(req.session.id, {
      etsy_oauth_state: "",
      etsy_code_verifier: "",
      etsy_connected_at: new Date().toISOString()
    });
    let resolvedTokens = tokens;
    try {
      resolvedTokens = await discoverEtsyShop(tokens);
    } catch (error) {
      etsyDebug("Shop status resolution skipped", { error: error instanceof Error ? error.message : String(error) });
    }
    await persistEtsyAuth(res, resolvedTokens);
    etsyDebug("Etsy auth saved after callback", {
      hasAccessToken: Boolean(resolvedTokens.access_token),
      hasRefreshToken: Boolean(resolvedTokens.refresh_token),
      shop_id: resolvedTokens.shop_id || "",
      shop_name: resolvedTokens.shop_name || ""
    });
    try {
      await syncEtsyListings(resolvedTokens, res);
    } catch (error) {
      etsyDebug("Initial Etsy listing sync skipped", { error: error instanceof Error ? error.message : String(error) });
    }
    res.redirect("/app.html?etsy=connected");
  } catch (error) {
    res.redirect(`/app.html?etsy=error&message=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
  }
});

app.post("/api/etsy/disconnect", async (_req, res) => {
  await writeEtsyTokens({});
  globalThis.etsyAuthStore = null;
  clearEtsyAuthCookie(res);
  res.json(successResponse(await etsyTokenStatus(), "Etsy disconnected"));
});

app.post("/api/etsy/sync", async (req, res) => {
  try {
    if (!etsyConfigured()) {
      res.status(503).json(errorResponse("etsy_not_configured", "Etsy API is not configured.", await etsyTokenStatus(readEtsyAuthCookie(req))));
      return;
    }
    const cookieTokens = readEtsyAuthCookie(req);
    if (!cookieTokens.access_token) {
      res.status(401).json(errorResponse("etsy_auth_required", "Etsy is not connected.", { listings: [], etsy: await etsyTokenStatus(cookieTokens) }));
      return;
    }
    const listings = await syncEtsyListings(cookieTokens, res);
    res.json(successResponse({
      status: "completed",
      source: "etsy_api",
      listings,
      etsy: await etsyTokenStatus(globalThis.etsyAuthStore || cookieTokens)
    }, "Etsy listings synced"));
  } catch (error) {
    const isRefreshFailure = error?.code === "token_refresh_failed" || error?.code === "missing_refresh_token";
    const status = isRefreshFailure || error?.status === 401 ? 401 : 502;
    const errorCode = error?.code === "missing_refresh_token" ? "missing_refresh_token" : isRefreshFailure ? "token_refresh_failed" : status === 401 ? "etsy_reconnect_required" : "etsy_sync_failed";
    res.status(status).json(errorResponse(
      errorCode,
      error instanceof Error ? error.message : String(error),
      { etsy: { ...(await etsyTokenStatus(readEtsyAuthCookie(req))), reconnect_required: true, token_status: "reconnect_required" } }
    ));
  }
});

app.post("/api/etsy/refresh-sync", async (req, res) => {
  try {
    const cookieTokens = readEtsyAuthCookie(req);
    if (!cookieTokens.access_token) {
      res.status(401).json(errorResponse("etsy_auth_required", "Etsy is not connected.", { listings: [], etsy: await etsyTokenStatus(cookieTokens) }));
      return;
    }
    const token = await ensureValidEtsyToken(cookieTokens, res);
    etsyDebug("Etsy token refresh debug", {
      hasAccessToken: Boolean(token.access_token),
      hasRefreshToken: Boolean(token.refresh_token),
      expiresAt: token.expires_at || null,
      isExpired: !etsyTokenUsable(token),
      refreshAttempted: token.last_refresh_status === "refreshed",
      refreshSuccess: token.last_refresh_status === "refreshed",
      etsyStatusCode: null
    });
    const listings = await syncEtsyListings(token, res);
    res.json(successResponse({
      status: "completed",
      source: "etsy_refresh_sync",
      listings,
      etsy: await etsyTokenStatus(globalThis.etsyAuthStore || token)
    }, "Etsy refresh sync completed"));
  } catch (error) {
    const errorCode = error?.code === "missing_refresh_token" ? "missing_refresh_token" : error?.code === "token_refresh_failed" ? "token_refresh_failed" : "etsy_sync_failed";
    res.status(errorCode === "etsy_sync_failed" ? 502 : 401).json(errorResponse(
      errorCode,
      error instanceof Error ? error.message : String(error),
      { etsy: { ...(await etsyTokenStatus(readEtsyAuthCookie(req))), reconnect_required: true, token_status: "reconnect_required" } }
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
  const session = await updateSession(req.session.id, {
    onboarding_completed: true,
    store_name: req.body.store_name || "",
    email,
    user_id: user.id
  });
  res.json(successResponse(sessionSummary(session, user), "Onboarding completed"));
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

app.get("/api/optimizations", async (_req, res) => {
  const records = await readRuntimeJson(optimizationsPath, optimizationsSeedPath, []);
  res.json(successResponse(records.map(enrichOptimizationRecord), "Optimizations loaded"));
});

app.get("/api/queue", async (_req, res) => {
  res.json(successResponse(await readRuntimeJson(queuePath, queueSeedPath, []), "Queue loaded"));
});

app.get("/api/listings", async (req, res) => {
  try {
    const cookieTokens = readEtsyAuthCookie(req);
    if (!cookieTokens.access_token) {
      res.status(401).json(errorResponse("etsy_auth_required", "Etsy is not connected.", {
        status: "failed",
        listings: [],
        etsy: await etsyTokenStatus(cookieTokens)
      }));
      return;
    }
    const tokens = await discoverEtsyShop(await ensureValidEtsyToken(cookieTokens, res));
    globalThis.etsyAuthStore = publicEtsyAuth(tokens);
    setEtsyAuthCookie(res, tokens);
    const response = await fetch(`https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(tokens.shop_id)}/listings/active?limit=100&includes=Images`, {
      headers: {
        "Authorization": `Bearer ${tokens.access_token}`,
        "x-api-key": ETSY_CLIENT_ID
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || `Etsy API failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const listings = extractEtsyResults(payload).map((listing) => normalizeListing({
      ...listing,
      sync_source: "etsy_api",
      details_status: "synced"
    })).filter((listing) => listing.listing_id && listing.title);
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
    const status = error?.status === 401 ? 401 : 502;
    res.status(status).json(errorResponse(status === 401 ? "etsy_auth_required" : "listings_failed", error instanceof Error ? error.message : String(error), {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    }));
  }
});

app.post("/api/send", async (req, res) => {
  const user = await getSessionUser(req.session);
  if (!user) {
    res.status(401).json(errorResponse("email_required", "Email onboarding is required.", { session: sessionSummary(req.session) }));
    return;
  }
  if (user.credits_remaining < 1) {
    res.status(402).json(errorResponse("credits_depleted", "Credits depleted.", { session: sessionSummary(req.session, user) }));
    return;
  }
  if (!WEBHOOK_URL) {
    res.status(503).json(errorResponse("make_webhook_not_configured", "Make webhook is not configured.", {
      error: "make_webhook_not_configured",
      message: "Make webhook is not configured.",
      session: sessionSummary(req.session, user)
    }));
    return;
  }
  await incrementAnalytics("optimization_started");
  const log = await sendToMake(req.body.product);
  const updatedUser = log.status === "completed" ? await consumeCredits(user, 1) : user;
  res.status(log.status === "completed" ? 200 : 502).json((log.status === "completed" ? successResponse : errorResponse)(
    log.status === "completed" ? {
    ...log,
    session: sessionSummary(req.session, updatedUser)
    } : "make_request_failed",
    log.status === "completed" ? "Optimization queued" : "Optimization request failed.",
    log.status === "completed" ? undefined : { ...log, session: sessionSummary(req.session, updatedUser) }
  ));
});

app.post("/api/send-batch", async (req, res) => {
  const products = Array.isArray(req.body.products) ? req.body.products : [];
  const user = await getSessionUser(req.session);
  if (!user) {
    res.status(401).json(errorResponse("email_required", "Email onboarding is required.", { session: sessionSummary(req.session) }));
    return;
  }
  if (user.credits_remaining < products.length) {
    res.status(402).json(errorResponse("credits_depleted", "Credits depleted.", { session: sessionSummary(req.session, user) }));
    return;
  }
  if (!WEBHOOK_URL) {
    res.status(503).json(errorResponse("make_webhook_not_configured", "Make webhook is not configured.", {
      error: "make_webhook_not_configured",
      message: "Make webhook is not configured.",
      session: sessionSummary(req.session, user)
    }));
    return;
  }
  const results = [];
  for (const product of products) {
    await incrementAnalytics("optimization_started");
    results.push(await sendToMake(product));
  }
  const completedCount = results.filter((item) => item.status === "completed").length;
  const updatedUser = completedCount > 0 ? await consumeCredits(user, completedCount) : user;
  res.json(successResponse({
    status: results.every((item) => item.status === "completed") ? "completed" : "partial",
    results,
    session: sessionSummary(req.session, updatedUser)
  }, "Batch processed"));
});

app.post("/api/retry/:id", async (req, res) => {
  const user = await getSessionUser(req.session);
  if (!user) {
    res.status(401).json(errorResponse("email_required", "Email onboarding is required.", { session: sessionSummary(req.session) }));
    return;
  }
  if (user.credits_remaining < 1) {
    res.status(402).json(errorResponse("credits_depleted", "Credits depleted.", { session: sessionSummary(req.session, user) }));
    return;
  }
  if (!WEBHOOK_URL) {
    res.status(503).json(errorResponse("make_webhook_not_configured", "Make webhook is not configured.", {
      error: "make_webhook_not_configured",
      message: "Make webhook is not configured.",
      session: sessionSummary(req.session, user)
    }));
    return;
  }

  const logs = await readLogs();
  const original = logs.find((log) => log.id === req.params.id);
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
    listing_id: original.payload.listing_id
  };

  const log = await sendToMake(product);
  const updatedUser = log.status === "completed" ? await consumeCredits(user, 1) : user;
  res.status(log.status === "completed" ? 200 : 502).json((log.status === "completed" ? successResponse : errorResponse)(
    log.status === "completed" ? {
    ...log,
    session: sessionSummary(req.session, updatedUser)
    } : "make_request_failed",
    log.status === "completed" ? "Retry queued" : "Retry failed.",
    log.status === "completed" ? undefined : { ...log, session: sessionSummary(req.session, updatedUser) }
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

app.post("/api/test-make-response", async (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json(errorResponse("disabled_in_production", "Disabled in production."));
    return;
  }
  const listings = await readListingsCache();
  const listing = listings.find((item) => item.listing_id === "4362680734") || listings.find((item) => item.details_status === "synced");
  if (!listing) {
    res.status(404).json(errorResponse("no_synced_listing", "No synced listing available for test"));
    return;
  }
  const record = await createOptimizationRecord({
    listing,
    optimized: {
      listing_id: listing.listing_id,
      seo_title: "Gold Box Chain Necklace, Minimal Layering Jewelry",
      description: "Gold Box Chain Necklace designed for quiet luxury styling, polished everyday wear, and meaningful gifting. Its refined gold finish layers easily with pearl necklaces, heart pendants, and delicate chains for a timeless minimalist look. Gift terms such as birthday gift, bridesmaid jewelry, and gift for her belong in the tags so the title stays clean and mobile-friendly.",
      tags: [
        "gold box chain",
        "layering necklace",
        "minimal jewelry",
        "quiet luxury gift",
        "gift for her",
        "birthday gift",
        "bridesmaid jewelry",
        "everyday necklace",
        "gold necklace",
        "dainty jewelry",
        "elegant jewelry",
        "timeless necklace",
        "old money jewelry"
      ],
      alt_text: "Gold box chain necklace on a soft ivory background with minimal styling.",
      thumbnail_preview_url: listing.image_url,
      seo_score: 90,
      ctr_score: 95,
      thumbnail_score: 92,
      tag_score: 90,
      alt_text_score: 95,
      status: "completed"
    },
    source: "local_test"
  });
  res.json(successResponse(record, "Test Make response generated"));
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
    session = await updateSession(req.session.id, {
      email,
      user_id: updatedUser.id,
      onboarding_completed: true
    });
  }

  res.json(successResponse({
    status: "updated",
    user: updatedUser,
    session: sessionSummary(session, updatedUser)
  }, "Plan updated"));
});

app.post("/api/queue", async (req, res) => {
  const listings = Array.isArray(req.body.listings) ? req.body.listings : [];
  const queue = await readRuntimeJson(queuePath, queueSeedPath, []);
  const queued = listings.map((listing) => ({
    id: crypto.randomUUID(),
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

app.post("/api/queue/:id/retry", async (req, res) => {
  const queue = await readRuntimeJson(queuePath, queueSeedPath, []);
  const item = queue.find((entry) => entry.id === req.params.id);
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

app.post("/api/optimizations/:id/approve", async (req, res) => {
  const history = await readRuntimeJson(optimizationsPath, optimizationsSeedPath, []);
  const record = history.find((item) => item.id === req.params.id);
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

export default app;
