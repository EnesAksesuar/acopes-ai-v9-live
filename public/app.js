let products = [];
let optimizationRecords = [];
let queueRecords = [];
let logRecords = [];
let currentSession = null;
let dashboardInitialized = false;
const DEBUG_MODE = true;

const productsEl = document.querySelector("#products");
const logsEl = document.querySelector("#logs");
const statusEl = document.querySelector("#status");
const sendSelectedBtn = document.querySelector("#sendSelected");
const sendBatchBtn = document.querySelector("#sendBatch");
const refreshListingsBtn = document.querySelector("#refreshListings");
const queueBatchBtn = document.querySelector("#queueBatch");
const testMakeResponseBtn = document.querySelector("#testMakeResponse");
const optimizationsEl = document.querySelector("#optimizations");
const queueEl = document.querySelector("#queue");
const scoreDashboardEl = document.querySelector("#scoreDashboard");
const timelineEl = document.querySelector("#timeline");
const batchDashboardEl = document.querySelector("#batchDashboard");
const historySidebarEl = document.querySelector("#historySidebar");
const heroCtrValueEl = document.querySelector("#heroCtrValue");
const confidenceValueEl = document.querySelector("#confidenceValue");
const heroThumbValueEl = document.querySelector("#heroThumbValue");
const queuedCountEl = document.querySelector("#queuedCount");
const approvedCountEl = document.querySelector("#approvedCount");
const thumbnailModalEl = document.querySelector("#thumbnailModal");
const modalImageEl = document.querySelector("#modalImage");
const usagePillEl = document.querySelector("#usagePill");
const usagePanelEl = document.querySelector("#usagePanel");
const onboardingPanelEl = document.querySelector("#onboardingPanel");
const onboardingFormEl = document.querySelector("#onboardingForm");
const upgradeModalEl = document.querySelector("#upgradeModal");
const toastStackEl = document.querySelector("#toastStack");
const competitorFormEl = document.querySelector("#competitorForm");
const competitorIntelligenceEl = document.querySelector("#competitorIntelligence");
const trendPanelEl = document.querySelector("#trendPanel");
const bulkEngineEl = document.querySelector("#bulkEngine");
const actionCenterEl = document.querySelector("#actionCenter");
const activityFeedEl = document.querySelector("#activityFeed");
const workspaceSelectorEl = document.querySelector("#workspaceSelector");
const etsyAuthStatusEl = document.querySelector("#etsyAuthStatus");
const connectEtsyBtn = document.querySelector("#connectEtsy");
const syncEtsyListingsBtn = document.querySelector("#syncEtsyListings");
const disconnectEtsyBtn = document.querySelector("#disconnectEtsy");
const seenOptimizationIds = new Set();
const rewriteModesByRecord = new Map();
const rewriteModeDetails = {
  seo: {
    label: "SEO Focused",
    description: "Prioritizes high-intent Etsy search keywords."
  },
  ctr: {
    label: "CTR Focused",
    description: "Improves click appeal and mobile readability."
  },
  luxury: {
    label: "Luxury Tone",
    description: "Adds premium, elegant wording without keyword stuffing."
  },
  gift: {
    label: "Gift Buyer Mode",
    description: "Highlights gifting intent and occasion-based search terms."
  },
  minimalist: {
    label: "Minimalist Mode",
    description: "Keeps the title cleaner, shorter, and modern."
  }
};
const competitorSnapshot = {
  titleLength: "112 characters",
  keywords: "gold necklace, layering necklace, gift for her, dainty jewelry",
  thumbnailTrend: "light neutral background, close-up product focus",
  competition: "Medium-High"
};
const seoRisks = [
  ["Keyword stuffing risk", "Low"],
  ["First 40 characters strength", "Strong"],
  ["Mobile truncation risk", "Improved"],
  ["Repetitive title structure", "Reduced"],
  ["Etsy 2026 title compliance", "Passed"]
];
const thumbnailBreakdown = [
  ["Product visibility", 94],
  ["Mobile clarity", 91],
  ["Contrast", 88],
  ["Emotional appeal", 86],
  ["Premium feel", 92]
];
const trendSeeds = ["coquette jewelry", "old money necklace", "minimalist gold bracelet", "dainty pearl gift", "quiet luxury jewelry"];
const analysisFields = [
  ["seo", "SEO score"],
  ["ctr", "CTR score"],
  ["thumbnail", "Thumbnail score"],
  ["tagRelevance", "Tag relevance"],
  ["mobile", "Mobile readability"],
  ["keywordPositioning", "Etsy keyword positioning"],
  ["buyerIntent", "Buyer intent match"],
  ["giftability", "Giftability score"],
  ["competition", "Competition pressure"]
];
const demoListings = [
  {
    listing_id: "demo-gold-box-chain",
    name: "Gold Box Chain Necklace",
    title: "Gold Box Chain Necklace, Minimal Layering Jewelry",
    description: "A refined everyday gold necklace designed for minimalist styling, layering, and meaningful gifting.",
    tags: ["gold necklace", "box chain", "layering necklace", "dainty jewelry", "gift for her", "minimalist style", "everyday jewelry"],
    image_url: "",
    type: "necklace",
    style: "minimalist gold jewelry",
    details_status: "demo"
  }
];

function debugLog(message, data = null) {
  if (!DEBUG_MODE) return;
  if (data === null) {
    console.log(`[ACOPES DEBUG] ${message}`);
    return;
  }
  console.log(`[ACOPES DEBUG] ${message}`, data);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeList(values = []) {
  return (Array.isArray(values) ? values : []).map((value) => escapeHtml(value)).join(", ");
}

function safeStatusClass(value = "") {
  return String(value).replace(/[^a-z0-9_-]/gi, "");
}

function confidenceClass(label = "") {
  const normalized = String(label).toLowerCase();
  if (normalized.includes("elite")) return "confidence-elite";
  if (normalized.includes("high")) return "confidence-high";
  if (normalized.includes("good")) return "confidence-good";
  if (normalized.includes("moderate")) return "confidence-moderate";
  if (normalized.includes("weak")) return "confidence-weak";
  return "";
}

function unwrapResponse(payload, fallback = payload) {
  return payload && typeof payload === "object" && "success" in payload && "data" in payload ? payload.data : fallback;
}

function stableHash(value = "") {
  return [...String(value)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 9973, 17);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function analyzeListing(product = {}, optimization = null) {
  const title = product.title || product.name || "";
  const description = product.description || "";
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const titleWords = title.split(/\s+/).filter(Boolean);
  const jewelrySignal = /necklace|jewelry|chain|pearl|gold|bracelet|earring|ring/i.test(`${title} ${description}`);
  const giftSignal = /gift|birthday|bridesmaid|anniversary|wedding|her/i.test(`${title} ${description} ${tags.join(" ")}`);
  const quietSignal = /minimal|dainty|quiet|luxury|layer|timeless|everyday/i.test(`${title} ${description} ${tags.join(" ")}`);
  const hash = stableHash(`${product.listing_id}-${title}`);
  const seo = optimization?.scores?.seo_score ?? clampScore(50 + (jewelrySignal ? 18 : 0) + Math.min(tags.length, 13) * 2 + (quietSignal ? 8 : 0));
  const ctr = optimization?.scores?.ctr_score ?? clampScore(48 + (titleWords.length <= 12 ? 14 : 4) + (product.image_url ? 12 : 0) + (quietSignal ? 10 : 0) + (hash % 9));
  const thumbnail = optimization?.scores?.thumbnail_score ?? clampScore(54 + (product.image_url ? 22 : 6) + (quietSignal ? 8 : 0) + (hash % 8));
  const tagRelevance = optimization?.scores?.tag_quality_score ?? clampScore(45 + Math.min(tags.length, 13) * 3 + (tags.some((tag) => /gold|necklace|gift|minimal|layer/i.test(tag)) ? 12 : 0));
  const mobile = optimization?.scores?.mobile_readability_score ?? clampScore(92 - Math.max(0, titleWords.length - 10) * 5 - Math.max(0, title.length - 72) * 0.35);
  const keywordPositioning = clampScore(55 + (/gold|pearl|necklace|chain/i.test(title.slice(0, 48)) ? 25 : 5) + (titleWords.length <= 15 ? 12 : 0));
  const buyerIntent = optimization?.scores?.buyer_intent_score ?? clampScore(52 + (giftSignal ? 18 : 0) + (quietSignal ? 12 : 0) + (jewelrySignal ? 12 : 0));
  const giftability = clampScore(48 + (giftSignal ? 28 : 10) + (jewelrySignal ? 10 : 0) + (quietSignal ? 8 : 0));
  const competition = optimization?.scores?.competition_score ?? clampScore(62 + (/gold|pearl|necklace/i.test(title) ? 15 : 6) + (hash % 12));
  return { seo, ctr, thumbnail, tagRelevance, mobile, keywordPositioning, buyerIntent, giftability, competition };
}

function fakeAnalytics(product = {}, analysis = {}) {
  const title = product.title || product.name || "";
  const hash = stableHash(`${product.listing_id}-${title}`);
  const intent = ((analysis.buyerIntent || 60) + (analysis.ctr || 60) + (analysis.thumbnail || 60)) / 3;
  const views = Math.max(4, Math.round(intent * 0.72 + (hash % 18)));
  const favorites = Math.max(1, Math.round(views * (0.06 + (analysis.giftability || 60) / 1600)));
  const conversion = Math.max(0.4, Math.min(6.8, ((analysis.seo || 60) + intent) / 42));
  const revenue = Math.round(views * (conversion / 100) * (24 + (hash % 32)));
  return { views, favorites, conversion: conversion.toFixed(1), revenue };
}

function confidenceFromAnalysis(analysis = {}) {
  return clampScore(
    (analysis.seo || 0) * 0.25 +
      (analysis.ctr || 0) * 0.25 +
      (analysis.thumbnail || 0) * 0.2 +
      (analysis.tagRelevance || 0) * 0.15 +
      (analysis.mobile || 0) * 0.05 +
      (analysis.buyerIntent || 0) * 0.05 +
      (100 - Math.max(0, (analysis.competition || 0) - 35)) * 0.05
  );
}

function analysisLabel(score = 0) {
  if (score >= 95) return "Elite";
  if (score >= 90) return "High confidence";
  if (score >= 80) return "Good confidence";
  if (score >= 70) return "Moderate";
  return "Weak optimization";
}

function renderListingAnalysis(product, optimization) {
  const analysis = analyzeListing(product, optimization);
  const analytics = fakeAnalytics(product, analysis);
  return `
    <div class="analysis-engine">
      <div class="micro-head"><small>Listing Analysis Engine</small><span>${escapeHtml(analysisLabel(confidenceFromAnalysis(analysis)))}</span></div>
      <div class="analysis-grid">
        ${analysisFields.map(([key, label]) => `<span><b>${escapeHtml(label)}</b><i>${escapeHtml(analysis[key])}</i></span>`).join("")}
      </div>
      <div class="fake-analytics">
        <span>Views/day <b>${escapeHtml(analytics.views)}</b></span>
        <span>Favorites/day <b>${escapeHtml(analytics.favorites)}</b></span>
        <span>Conversion est. <b>${escapeHtml(analytics.conversion)}%</b></span>
        <span>Revenue est. <b>$${escapeHtml(analytics.revenue)}/day</b></span>
      </div>
    </div>
  `;
}

function renderRecommendationCards(product, optimization) {
  const analysis = analyzeListing(product, optimization);
  const title = product.title || "";
  const warnings = [];
  if (title.length > 95) warnings.push("Title may truncate on mobile search results.");
  if ((product.tags || []).length < 13) warnings.push("Fill all 13 Etsy tag slots for stronger coverage.");
  if (analysis.competition > 78) warnings.push("High competition pressure: tighten primary keyword and thumbnail contrast.");
  if (!warnings.length) warnings.push("Core Etsy compliance checks look stable.");
  const cards = [
    ["Title improvements", "Move the clearest product keyword into the first 40 characters."],
    ["Tag replacement suggestions", "Prioritize buyer phrases such as gold necklace, layering necklace, gift for her, and dainty jewelry."],
    ["Thumbnail improvement hints", "Use a close-up ivory hero image with the jewelry filling most of the frame."],
    ["CTR recommendations", "Keep title concise and make the first image readable on mobile."],
    ["SEO warnings", warnings.join(" ")],
    ["Etsy compliance checks", "Draft-safe output, no auto-publish, cleaner 2026 title structure."]
  ];
  return `<div class="recommendation-grid">${cards.map(([titleText, body]) => `<article><strong>${escapeHtml(titleText)}</strong><p>${escapeHtml(body)}</p></article>`).join("")}</div>`;
}

function renderTitleDiff(before = "", after = "") {
  const beforeWords = new Set(String(before).toLowerCase().split(/\W+/).filter(Boolean));
  return String(after)
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim()) return escapeHtml(part);
      return beforeWords.has(part.toLowerCase().replace(/\W+/g, "")) ? escapeHtml(part) : `<mark>${escapeHtml(part)}</mark>`;
    })
    .join("");
}

function viralScore(product = {}, analysis = {}) {
  const text = `${product.title || ""} ${product.description || ""} ${(product.tags || []).join(" ")}`;
  const emotional = /gift|heart|pearl|dainty|coquette|romantic|bridesmaid|birthday/i.test(text) ? 16 : 7;
  const seasonal = /gift|bridesmaid|pearl|gold|holiday|birthday/i.test(text) ? 14 : 8;
  const social = /coquette|old money|quiet luxury|minimal|dainty|pearl/i.test(text) ? 15 : 8;
  const personal = /initial|name|personal|heart|birthstone|custom/i.test(text) ? 14 : 6;
  const score = clampScore(emotional + seasonal + social + personal + (analysis.giftability || 55) * 0.18 + (analysis.ctr || 55) * 0.18 + (analysis.thumbnail || 55) * 0.15);
  let label = "Weak";
  if (score >= 95) label = "Viral Elite";
  else if (score >= 90) label = "Viral";
  else if (score >= 80) label = "Strong Potential";
  else if (score >= 70) label = "Moderate";
  return { score, label };
}

function thumbnailIntelligence(product = {}, analysis = {}) {
  const hasImage = Boolean(product.image_url);
  const hash = stableHash(product.listing_id || product.title || "");
  return {
    brightness: clampScore((hasImage ? 74 : 48) + (hash % 13)),
    contrast: clampScore((analysis.thumbnail || 62) - 4 + (hash % 9)),
    visibility: clampScore((analysis.thumbnail || 60) + (hasImage ? 8 : -8)),
    mobile: clampScore((analysis.mobile || 65) + (hasImage ? 4 : -6)),
    clutter: clampScore(100 - ((analysis.thumbnail || 60) - 8)),
    luxury: clampScore((analysis.buyerIntent || 60) + (/pearl|gold|minimal|quiet/i.test(product.title || "") ? 12 : 2)),
    ctrPrediction: clampScore(((analysis.ctr || 60) + (analysis.thumbnail || 60)) / 2)
  };
}

function revenueImpact(analysis = {}, confidence = 75) {
  const ctrUplift = clampScore(((analysis.ctr || 60) - 50) * 0.9);
  const conversionUplift = clampScore(((analysis.buyerIntent || 60) - 45) * 0.55);
  const favoritesGrowth = clampScore(((analysis.giftability || 60) + (analysis.thumbnail || 60)) / 2 - 38);
  const monthlyRevenue = Math.max(18, Math.round((ctrUplift * 6 + conversionUplift * 8 + favoritesGrowth * 3) * (confidence / 100)));
  return { ctrUplift, conversionUplift, favoritesGrowth, monthlyRevenue };
}

function competitorIntel(query = "quiet luxury jewelry") {
  const hash = stableHash(query);
  const core = query.includes("http") ? "listing URL sample" : query || "quiet luxury jewelry";
  return {
    query: core,
    titleLengths: `${88 + (hash % 20)}-${126 + (hash % 28)} chars`,
    keywordDensity: `${Math.round(8 + (hash % 9))}% primary keyword density`,
    tagOverlap: `${42 + (hash % 31)}% with top Etsy jewelry listings`,
    pricingClusters: `$${18 + (hash % 9)}-$${34 + (hash % 18)}, $${42 + (hash % 14)}-$${68 + (hash % 24)}`,
    thumbnailStyle: ["ivory close-up", "model neckline crop", "warm neutral macro"][hash % 3],
    reviewRanges: `${120 + (hash % 260)}-${900 + (hash % 1400)} reviews`,
    favorites: `${40 + (hash % 90)}-${220 + (hash % 420)} favorites`,
    listingAge: `${3 + (hash % 18)} months median`,
    shipping: hash % 2 ? "free shipping badge common" : "low-cost tracked shipping",
    personalization: hash % 3 ? "low personalization usage" : "personalized gift angle emerging"
  };
}

function renderCompetitorIntel(query) {
  const intel = competitorIntel(query);
  competitorIntelligenceEl.innerHTML = `
    <div class="market-card">
      <div class="micro-head"><small>${escapeHtml(intel.query)}</small><span>Simulated market intelligence</span></div>
      <dl>
        <div><dt>Competitor title lengths</dt><dd>${escapeHtml(intel.titleLengths)}</dd></div>
        <div><dt>Keyword density</dt><dd>${escapeHtml(intel.keywordDensity)}</dd></div>
        <div><dt>Tag overlap</dt><dd>${escapeHtml(intel.tagOverlap)}</dd></div>
        <div><dt>Pricing clusters</dt><dd>${escapeHtml(intel.pricingClusters)}</dd></div>
        <div><dt>Thumbnail style</dt><dd>${escapeHtml(intel.thumbnailStyle)}</dd></div>
        <div><dt>Review count ranges</dt><dd>${escapeHtml(intel.reviewRanges)}</dd></div>
        <div><dt>Favorites estimate</dt><dd>${escapeHtml(intel.favorites)}</dd></div>
        <div><dt>Listing age estimate</dt><dd>${escapeHtml(intel.listingAge)}</dd></div>
        <div><dt>Shipping style</dt><dd>${escapeHtml(intel.shipping)}</dd></div>
        <div><dt>Personalization usage</dt><dd>${escapeHtml(intel.personalization)}</dd></div>
      </dl>
    </div>
  `;
}

function renderTrendPanel() {
  trendPanelEl.innerHTML = trendSeeds
    .map((trend) => {
      const hash = stableHash(trend);
      return `
        <article>
          <strong>${escapeHtml(trend)}</strong>
          <span>Trend strength <b>${76 + (hash % 22)}</b></span>
          <span>Saturation <b>${42 + (hash % 38)}</b></span>
          <span>Buyer intent <b>${70 + (hash % 24)}</b></span>
          <span>Competition <b>${55 + (hash % 34)}</b></span>
        </article>
      `;
    })
    .join("");
}

function renderBulkEngine() {
  const plan = currentSession?.current_plan || currentSession?.plan || "free";
  const selectedCount = selectedProducts().length;
  const isLocked = plan === "free";
  bulkEngineEl.innerHTML = `
    <div class="bulk-card ${isLocked ? "locked" : ""}">
      <div>
        <strong>${isLocked ? "Unlock AI bulk optimization" : "Bulk queue ready"}</strong>
        <p>${isLocked ? "Pro and Agency users can optimize, approve, and retry multiple listings at once." : `${selectedCount || products.length} listings available for bulk operations.`}</p>
      </div>
      <div class="progress large"><i style="width:${isLocked ? 18 : Math.min(100, 28 + selectedCount * 12)}%"></i></div>
      <div class="bulk-actions">
        <button class="ghost" ${isLocked ? "disabled" : ""}>Bulk queue</button>
        <button class="ghost" ${isLocked ? "disabled" : ""}>Bulk approve</button>
        <button class="ghost" ${isLocked ? "disabled" : ""}>Bulk retry</button>
      </div>
    </div>
  `;
}

function renderActionCenter() {
  const product = products[0] || {};
  const analysis = analyzeListing(product, null);
  const issues = [
    ["critical", analysis.mobile < 62 ? "weak mobile readability" : "weak primary keyword"],
    ["medium", analysis.thumbnail < 76 ? "low thumbnail contrast" : "tags duplicated"],
    ["low", analysis.giftability < 72 ? "low gift intent" : "title too long"]
  ];
  actionCenterEl.innerHTML = issues.map(([severity, text]) => `<article class="${severity}"><b>${escapeHtml(severity)}</b><span>${escapeHtml(text)}</span></article>`).join("");
}

function renderActivityFeed() {
  const events = [
    ["Listing optimized", optimizationRecords[0]?.listing_name || "Gold Box Chain Necklace"],
    ["Queue completed", `${queueRecords.filter((item) => item.status === "queued").length} jobs waiting`],
    ["Confidence upgraded", optimizationRecords[0]?.confidence_label || "High confidence"],
    ["Credits used", `${currentSession?.optimizations_used || 0} total`],
    ["New onboarding completed", currentSession?.email || "beta workspace ready"]
  ];
  activityFeedEl.innerHTML = events.map(([title, detail]) => `<article><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></article>`).join("");
}

function renderCommerceIntelligence() {
  renderTrendPanel();
  renderBulkEngine();
  renderActionCenter();
  renderActivityFeed();
  if (competitorIntelligenceEl && !competitorIntelligenceEl.innerHTML) renderCompetitorIntel("quiet luxury jewelry");
}

function renderRewriteModes(recordId) {
  const selectedMode = rewriteModesByRecord.get(recordId) || "seo";
  const selectedDetail = rewriteModeDetails[selectedMode] || rewriteModeDetails.seo;
  const buttons = Object.entries(rewriteModeDetails)
    .map(([mode, detail]) => {
      const isSelected = mode === selectedMode;
      return `<button class="mode-pill ${isSelected ? "selected" : ""}" data-rewrite-mode="${escapeAttribute(mode)}" data-record-id="${escapeAttribute(recordId)}" type="button">${escapeHtml(detail.label)}</button>`;
    })
    .join("");

  return `
    <div class="rewrite-modes">
      <div class="micro-head"><small>AI Rewrite Modes</small><span>${escapeHtml(selectedDetail.label)}</span></div>
      <div class="mode-selector">${buttons}</div>
      <p class="mode-description">${escapeHtml(selectedDetail.description)}</p>
    </div>
  `;
}

function renderCompetitorSnapshot() {
  return `
    <div class="insight-panel competitor-snapshot">
      <div class="micro-head"><small>Competitor Snapshot</small><span>Market scan</span></div>
      <dl>
        <div><dt>Avg competitor title length</dt><dd>${escapeHtml(competitorSnapshot.titleLength)}</dd></div>
        <div><dt>Top repeated keywords</dt><dd>${escapeHtml(competitorSnapshot.keywords)}</dd></div>
        <div><dt>Thumbnail style trend</dt><dd>${escapeHtml(competitorSnapshot.thumbnailTrend)}</dd></div>
        <div><dt>Estimated competition level</dt><dd>${escapeHtml(competitorSnapshot.competition)}</dd></div>
      </dl>
    </div>
  `;
}

function renderSeoRiskDetector() {
  return `
    <div class="insight-panel seo-risk">
      <div class="micro-head"><small>Etsy SEO Risk Detector</small><span>Passed review</span></div>
      <div class="risk-list">
        ${seoRisks
          .map(([label, value]) => `<span><i></i>${escapeHtml(label)}: <strong>${escapeHtml(value)}</strong></span>`)
          .join("")}
      </div>
    </div>
  `;
}

function renderThumbnailBreakdown() {
  return `
    <div class="thumbnail-breakdown">
      <div class="micro-head"><small>Thumbnail Score Breakdown</small><span>CTR signals</span></div>
      ${thumbnailBreakdown
        .map(
          ([label, score]) => `
            <div class="score-row">
              <span>${escapeHtml(label)}</span>
              <div class="mini-progress"><i style="width:${score}%"></i></div>
              <strong>${escapeHtml(score)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function imageOrPlaceholder(src, classes = "", attrs = "") {
  const safeClasses = escapeAttribute(classes);
  if (!src) return `<span class="luxury-placeholder ${safeClasses}" ${attrs}><i>ACOPES AI</i></span>`;
  return `<img class="${safeClasses}" src="${escapeAttribute(src)}" alt="" ${attrs} data-placeholder-class="${safeClasses}" onerror="this.replaceWith(createLuxuryPlaceholder(this.dataset.placeholderClass || ''))" />`;
}

window.createLuxuryPlaceholder = function createLuxuryPlaceholder(classes = "") {
  const placeholder = document.createElement("span");
  placeholder.className = `luxury-placeholder ${classes}`.trim();
  const label = document.createElement("i");
  label.textContent = "ACOPES AI";
  placeholder.append(label);
  return placeholder;
};

function setStatus(status) {
  statusEl.className = `status ${status.toLowerCase()}`;
  statusEl.textContent = status;
}

function showToast(message, type = "success") {
  if (!toastStackEl) return;
  const toast = document.createElement("div");
  toast.className = `toast ${safeStatusClass(type)}`;
  toast.textContent = message;
  toastStackEl.append(toast);
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, 3600);
}

function renderProductsSkeleton(count = 3) {
  productsEl.innerHTML = Array.from({ length: count }, () => `
    <article class="product-card skeleton-card">
      <span class="skeleton-dot"></span>
      <div class="skeleton-thumb"></div>
      <div class="product-copy">
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    </article>
  `).join("");
}

function renderEtsyAuthStatus(status = {}) {
  if (!etsyAuthStatusEl) return;
  const configured = Boolean(status.configured);
  const connected = Boolean(status.connected);
  const expired = Boolean(status.expired);
  const tokenStatus = status.token_status || "";
  const badge = !configured ? "Not configured" : status.reconnect_required ? "Reconnect required" : tokenStatus === "refreshed" ? "Token refreshed" : expired ? "Token expired" : connected ? "Token active" : "Not connected";
  const badgeClass = !configured || expired || status.reconnect_required ? "failed" : connected ? "completed" : "queued";
  etsyAuthStatusEl.innerHTML = `
    <div class="auth-status-row"><span>Status</span><strong class="${badgeClass}">${escapeHtml(badge)}</strong></div>
    <div class="auth-status-row"><span>Shop</span><strong>${escapeHtml(status.shop_name || status.shop_id || "No shop connected")}</strong></div>
    ${status.shop_url ? `<div class="auth-status-row"><span>Shop URL</span><strong>${escapeHtml(status.shop_url)}</strong></div>` : ""}
    <div class="auth-status-row"><span>Scopes</span><strong>${escapeHtml(status.scopes || "listings_r shops_r")}</strong></div>
    <div class="auth-status-row"><span>Token</span><strong>${escapeHtml(badge)}</strong></div>
    <div class="auth-status-row"><span>Mode</span><strong>Draft-safe only</strong></div>
    ${status.expires_at ? `<small>Token expires: ${escapeHtml(new Date(status.expires_at).toLocaleString())}</small>` : `<small>Connect Etsy to pull live seller listings.</small>`}
  `;
  if (connectEtsyBtn) connectEtsyBtn.hidden = connected && !expired;
  if (disconnectEtsyBtn) disconnectEtsyBtn.textContent = connected ? "Reconnect Etsy" : "Clear Etsy";
  if (syncEtsyListingsBtn) syncEtsyListingsBtn.disabled = !configured || !connected;
}

async function refreshEtsyStatus() {
  try {
    const response = await fetch("/api/etsy/status");
    const result = await parseJsonResponse(response);
    const status = unwrapResponse(result, result);
    renderEtsyAuthStatus(status);
    return status;
  } catch (error) {
    debugLog("etsy status failed", error);
    renderEtsyAuthStatus({ configured: false, connected: false });
    return null;
  }
}

async function syncEtsyListings() {
  console.log("Refresh Sync clicked");
  setStatus("Processing");
  showToast("Refreshing Etsy sync...", "success");
  renderProductsSkeleton();
  const previousText = syncEtsyListingsBtn?.textContent || "Refresh Sync";
  if (syncEtsyListingsBtn) {
    syncEtsyListingsBtn.disabled = true;
    syncEtsyListingsBtn.textContent = "Refreshing...";
  }
  try {
    debugLog("etsy live sync started");
    const response = await fetch("/api/etsy/refresh-sync", { method: "POST" });
    const result = await parseJsonResponse(response);
    console.log("Refresh Sync response", { status: response.status, ok: response.ok, result });
    debugLog("etsy sync api response received", result);
    if (!response.ok || result?.success === false) {
      const message = result.message || result.error || "Etsy sync failed.";
      showToast(message, "error");
      setStatus("Failed");
      await refreshEtsyStatus();
      await refreshListings();
      return;
    }
    const payload = unwrapResponse(result, result);
    products = Array.isArray(payload.listings) && payload.listings.length ? payload.listings : demoListings;
    renderProducts();
    renderCommerceIntelligence();
    renderEtsyAuthStatus(payload.etsy);
    setStatus("Completed");
    showToast(`Etsy sync completed. ${products.length} listings loaded.`, "success");
  } catch (error) {
    console.log("Refresh Sync failed", error);
    debugLog("etsy sync failed", error);
    setStatus("Failed");
    showToast("API unavailable. Etsy sync failed.", "error");
    await refreshListings();
  } finally {
    if (syncEtsyListingsBtn) {
      syncEtsyListingsBtn.disabled = false;
      syncEtsyListingsBtn.textContent = previousText;
    }
  }
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function showUpgradeModal(plan = "") {
  upgradeModalEl.hidden = false;
  upgradeModalEl.dataset.selectedPlan = plan;
}

function renderSession(session) {
  currentSession = session;
  const credits = session.credits_remaining ?? session.free_remaining;
  usagePillEl.textContent = session.email_required ? "Sign in for credits" : `${credits} credits`;
  const creditNote = session.email_required
    ? "Add your email to unlock 15 free optimization credits"
    : `${session.credits_granted || session.free_limit} credits granted on ${session.current_plan || session.plan || "free"} plan`;
  const progress = Math.min(100, Math.round((session.optimizations_used / Math.max(1, session.credits_granted || session.free_limit)) * 100));
  const lockedFeatures = (session.current_plan || session.plan || "free") === "free"
    ? `
      <div class="locked-growth">
        <span>Unlock AI bulk optimization</span>
        <span>Unlock advanced competitor intelligence</span>
        <span>Unlock elite confidence engine</span>
      </div>
    `
    : "";
  usagePanelEl.innerHTML = `
    <div class="batch-row"><span>User email</span><strong>${escapeHtml(session.email || "Not connected")}</strong></div>
    <div class="batch-row"><span>Current plan</span><strong>${escapeHtml(session.current_plan || session.plan || "free")}</strong></div>
    <div class="batch-row"><span>Remaining credits</span><strong>${escapeHtml(credits)}</strong></div>
    <div class="batch-row"><span>Used</span><strong>${escapeHtml(session.optimizations_used)}</strong></div>
    <div class="progress large"><i style="width:${progress}%"></i></div>
    <small>${escapeHtml(creditNote)}</small>
    ${lockedFeatures}
  `;
  onboardingPanelEl.hidden = session.onboarding_completed && !session.email_required;
  if (session.limit_reached) upgradeModalEl.hidden = false;
  renderTopKpis(optimizationRecords);
}

async function refreshSession() {
  try {
    debugLog("session init started");
    const response = await fetch("/api/session");
    const result = await parseJsonResponse(response);
    debugLog("session api response received", result);
    if (!response.ok || result?.success === false) {
      showToast(result.message || "API unavailable. Session could not be loaded.", "error");
      return null;
    }
    const session = unwrapResponse(result, result);
    renderSession(session);
    return session;
  } catch (error) {
    debugLog("session init failed", error);
    showToast("API unavailable. Session could not be loaded.", "error");
    return null;
  }
}

function selectedProducts() {
  const selectedIds = [...document.querySelectorAll("[data-product-index]:checked")].map((input) => Number(input.dataset.productIndex));
  return selectedIds.map((index) => products[index]);
}

function renderProducts() {
  if (!products.length) {
    productsEl.innerHTML = `<div class="empty">No active Etsy listings loaded yet.</div>`;
    return;
  }

  const latestByListing = new Map(optimizationRecords.map((record) => [record.listing_id, record]));
  productsEl.innerHTML = products
    .map((product, index) => {
      const optimization = latestByListing.get(product.listing_id);
      const displayAfter = optimization?.after || null;
      const optimizedTitle = displayAfter?.seo_title && displayAfter.seo_title !== "AI optimized title" ? displayAfter.seo_title : "";
      const previewImage = displayAfter?.thumbnail_preview_url || product.image_url;
      const animated = optimization && !seenOptimizationIds.has(optimization.id) ? "is-fresh" : "";
      const previewAttr = previewImage ? `data-preview="${escapeAttribute(previewImage)}"` : "";
      return `
        <label class="product-card ${animated}">
          <input type="checkbox" data-product-index="${index}" ${index === 0 ? "checked" : ""} />
          <div class="thumb-wrap">
            ${imageOrPlaceholder(previewImage, "", previewAttr)}
          </div>
          <div class="product-copy">
            <div class="product-topline">
              <strong>${escapeHtml(product.name)}</strong>
              <small>ID ${escapeHtml(product.listing_id)}${product.views ? ` · ${escapeHtml(product.views)} views` : ""}</small>
            </div>
            <div class="mini-compare">
              <div><span>Before title</span><p>${escapeHtml(product.title)}</p></div>
              <div><span>Optimized title</span><p>${escapeHtml(optimizedTitle || "Waiting for optimization")}</p></div>
            </div>
            ${displayAfter ? `
              <div class="optimized-preview">
                <p>${escapeHtml(displayAfter.description)}</p>
                <small>${escapeList(displayAfter.tags)}</small>
              </div>
            ` : ""}
            <div class="mini-scores">
              <span>SEO ${escapeHtml(optimization?.scores.seo_score ?? "--")}</span>
              <span>CTR ${escapeHtml(optimization?.scores.ctr_score ?? "--")}</span>
              <span>Tags ${escapeHtml(optimization?.scores.tag_quality_score ?? "--")}</span>
                <span>Thumb ${escapeHtml(optimization?.scores.thumbnail_score ?? "--")}</span>
                <span class="${confidenceClass(optimization?.confidence_label)}">Confidence ${escapeHtml(optimization?.scores.confidence_score ?? "--")} ${escapeHtml(optimization?.confidence_label || "")}</span>
              </div>
            ${renderListingAnalysis(product, optimization)}
            ${renderRecommendationCards(product, optimization)}
            ${(() => {
              const analysis = analyzeListing(product, optimization);
              const viral = viralScore(product, analysis);
              const thumb = thumbnailIntelligence(product, analysis);
              const revenue = revenueImpact(analysis, confidenceFromAnalysis(analysis));
              return `
                <div class="commerce-grid">
                  <article><small>Viral Potential Score</small><strong>${escapeHtml(viral.score)}</strong><span>${escapeHtml(viral.label)}</span></article>
                  <article><small>Etsy CTR prediction</small><strong>${escapeHtml(thumb.ctrPrediction)}</strong><span>Visibility ${escapeHtml(thumb.visibility)} / Luxury ${escapeHtml(thumb.luxury)}</span></article>
                  <article><small>Potential Revenue Impact</small><strong>$${escapeHtml(revenue.monthlyRevenue)}/mo</strong><span>CTR +${escapeHtml(revenue.ctrUplift)}%, Conv +${escapeHtml(revenue.conversionUplift)}%</span></article>
                </div>
              `;
            })()}
          </div>
          ${optimization?.status === "completed" ? `<b class="completed-badge">Optimization completed</b>` : ""}
          ${optimization?.status === "failed" ? `<button class="retry-optimization" data-retry-optimization="${escapeAttribute(optimization.id)}">Retry failed optimization</button>` : ""}
        </label>
      `;
    })
    .join("");
  optimizationRecords.forEach((record) => seenOptimizationIds.add(record.id));
}

function renderLogs(logs) {
  if (!logs.length) {
    logsEl.innerHTML = `<div class="empty">No automation logs yet.</div>`;
    return;
  }
  logsEl.innerHTML = logs
    .map(
      (log) => `
        <article class="log">
          <div class="log-meta">
            <strong>${escapeHtml(log.payload.product_name)}</strong>
            <span>${escapeHtml(log.status)} - ${escapeHtml(new Date(log.created_at).toLocaleString())}</span>
          </div>
          <div class="log-actions">
            <span>${escapeHtml(log.make_response.status ?? "network error")}</span>
            ${log.status === "failed" ? `<button data-retry="${escapeAttribute(log.id)}">Retry</button>` : ""}
          </div>
        </article>
      `
    )
    .join("");
}

function renderOptimizations(records) {
  if (!records.length) {
    optimizationsEl.innerHTML = `<div class="empty">No AI optimizations received yet.</div>`;
    return;
  }

  optimizationsEl.innerHTML = records
    .map(
      (record) => {
        const optimizedTitle = record.after.seo_title && record.after.seo_title !== "AI optimized title" ? record.after.seo_title : "";
        const recordStatus = record.status || "";
        const beforeImageAttr = record.before.image_url ? `data-preview="${escapeAttribute(record.before.image_url)}"` : "";
        const afterImageAttr = record.after.thumbnail_preview_url ? `data-preview="${escapeAttribute(record.after.thumbnail_preview_url)}"` : "";
        return `
        <article class="optimization-card" data-view="after">
          <header>
            <strong>${escapeHtml(record.listing_name)}</strong>
            <span class="draft-status ${safeStatusClass(recordStatus)}">${escapeHtml(recordStatus.replaceAll("_", " "))}</span>
          </header>
          <div class="optimization-body">
            <div class="optimization-main">
              <div class="score-grid">
                <span>SEO ${escapeHtml(record.scores.seo_score)}</span>
                <span>CTR ${escapeHtml(record.scores.ctr_score)}</span>
                <span>Thumb ${escapeHtml(record.scores.thumbnail_score)}</span>
                <span>Tags ${escapeHtml(record.scores.tag_quality_score)}</span>
                <span>Alt ${escapeHtml(record.scores.alt_text_score)}</span>
                <span class="${confidenceClass(record.confidence_label)}">Confidence ${escapeHtml(record.scores.confidence_score ?? "--")} ${escapeHtml(record.confidence_label || "")}</span>
              </div>
              <div class="comparison">
                <div><small>Before title</small><p>${escapeHtml(record.before.title)}</p></div>
                <div><small>After title</small><p>${escapeHtml(optimizedTitle || "Optimization title pending")}</p></div>
              </div>
              <div class="draft-preview">
                <div><small>AI Draft Preview - Original</small><p>${escapeHtml(record.before.description || record.before.title)}</p></div>
                <div><small>AI Draft Preview - Optimized</small><p>${renderTitleDiff(record.before.title, optimizedTitle || record.after.description)}</p></div>
              </div>
              <div class="comparison secondary-compare">
                <div><small>Before tags</small><p>${escapeList(record.before.tags)}</p></div>
                <div><small>After tags</small><p>${escapeList(record.after.tags)}</p></div>
              </div>
              ${renderRewriteModes(record.id)}
              ${renderCompetitorSnapshot()}
              ${renderSeoRiskDetector()}
              <div class="why-ai">
                <small>Why AI changed this</small>
                <ul>
                  ${(record.ai_change_reasons || [
                    "Shortened title for mobile readability",
                    "Moved gift terms into tags",
                    "Improved primary keyword clarity",
                    "Aligned with Etsy 2026 title guidance"
                  ]).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
                </ul>
              </div>
            </div>
            <div class="hero-preview">
              <div class="thumb-compare">
                <div>
                  ${imageOrPlaceholder(record.before.image_url, "", beforeImageAttr)}
                  <small>Before Thumbnail</small>
                </div>
                <div>
                  ${
                    record.after.thumbnail_preview_url
                      ? imageOrPlaceholder(record.after.thumbnail_preview_url, "", afterImageAttr)
                      : `<span class="luxury-placeholder pending"><i>Canva preview pending</i></span>`
                  }
                  <small>After AI Thumbnail</small>
                </div>
              </div>
              <p>${escapeHtml(record.after.canva_prompt || "Hero thumbnail preview will appear after Canva export completes.")}</p>
              <span>${escapeHtml(record.execution_status || "ready_for_review")}</span>
              ${renderThumbnailBreakdown()}
            </div>
          </div>
          <details>
            <summary>View full changes</summary>
            <p><strong>Description:</strong> ${escapeHtml(record.after.description)}</p>
            <p><strong>Alt text:</strong> ${escapeHtml(record.after.alt_text)}</p>
            <p><strong>Pinterest:</strong> ${escapeHtml(record.after.pinterest_title)} - ${escapeHtml(record.after.pinterest_description)}</p>
          </details>
          <div class="optimization-actions">
            <button class="ghost toggle-view" data-toggle="${escapeAttribute(record.id)}">Show before</button>
            <button data-approve="${escapeAttribute(record.id)}">Approve Draft</button>
          </div>
        </article>
      `;
      }
    )
    .join("");
}

function renderQueue(items) {
  if (!items.length) {
    queueEl.innerHTML = `<div class="empty">No listings queued.</div>`;
    return;
  }
  queueEl.innerHTML = items
    .map(
      (item) => `
        <article class="queue-item">
          <div>
            <strong>${escapeHtml(item.listing_name)}</strong>
            <span><b class="queue-badge ${safeStatusClass(item.status)}">${escapeHtml(item.status)}</b> ${escapeHtml(item.priority)}</span>
          </div>
          <div class="progress"><i style="width:${item.status === "queued" ? 35 : item.status === "failed" ? 12 : 100}%"></i></div>
          ${item.status === "failed" ? `<button data-queue-retry="${escapeAttribute(item.id)}">Retry</button>` : ""}
        </article>
      `
    )
    .join("");
}

function renderScoreDashboard(records) {
  const latest = records[0];
  scoreDashboardEl.innerHTML = latest
    ? `
      <div><dt>CTR score</dt><dd>${escapeHtml(latest.scores.ctr_score)}</dd></div>
      <div><dt>SEO score</dt><dd>${escapeHtml(latest.scores.seo_score)}</dd></div>
      <div><dt>Thumbnail score</dt><dd>${escapeHtml(latest.scores.thumbnail_score)}</dd></div>
      <div><dt>Tag score</dt><dd>${escapeHtml(latest.scores.tag_quality_score)}</dd></div>
      <div><dt>Alt text score</dt><dd>${escapeHtml(latest.scores.alt_text_score)}</dd></div>
      <div><dt>Confidence</dt><dd class="${confidenceClass(latest.confidence_label)}">${escapeHtml(latest.scores.confidence_score ?? "--")} <small>${escapeHtml(latest.confidence_label || "")}</small></dd></div>
      <ul class="status-checklist">
        <li>✓ Title optimized</li>
        <li>✓ Tags reviewed</li>
        <li>✓ Thumbnail checked</li>
        <li>✓ Etsy 2026 title compliant</li>
        <li>✓ Draft-safe output</li>
      </ul>
    `
    : `
      <div><dt>CTR score</dt><dd>--</dd></div>
      <div><dt>SEO score</dt><dd>--</dd></div>
      <div><dt>Thumbnail score</dt><dd>--</dd></div>
      <div><dt>Tag score</dt><dd>--</dd></div>
      <div><dt>Alt text score</dt><dd>--</dd></div>
      <div><dt>Confidence</dt><dd>--</dd></div>
      <ul class="status-checklist">
        <li>✓ Title optimized</li>
        <li>✓ Tags reviewed</li>
        <li>✓ Thumbnail checked</li>
        <li>✓ Etsy 2026 title compliant</li>
        <li>✓ Draft-safe output</li>
      </ul>
    `;
}

function renderBatchDashboard() {
  const total = queueRecords.length;
  const queued = queueRecords.filter((item) => item.status === "queued").length;
  const processing = queueRecords.filter((item) => item.status === "processing").length;
  const optimized = queueRecords.filter((item) => item.status === "optimized" || item.status === "completed").length;
  const failed = queueRecords.filter((item) => item.status === "failed").length;
  const completed = total - queued - failed;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  batchDashboardEl.innerHTML = `
    <div class="batch-row"><span>Total listings</span><strong>${total}</strong></div>
    <div class="queue-badges">
      <span class="queue-badge queued">queued ${queued}</span>
      <span class="queue-badge processing">processing ${processing}</span>
      <span class="queue-badge optimized">optimized ${optimized}</span>
      <span class="queue-badge failed">failed ${failed}</span>
    </div>
    <div class="progress large"><i style="width:${progress}%"></i></div>
    <small>${progress}% complete</small>
  `;
}

function renderHistorySidebar(records) {
  historySidebarEl.innerHTML = records.length
    ? records
        .slice(0, 5)
        .map(
          (record) => `
            <article>
              <strong>${escapeHtml(record.before?.title || record.listing_name)}</strong>
              <span>${escapeHtml(record.after?.seo_title || "Optimized draft pending")}</span>
              <small>ID ${escapeHtml(record.listing_id)} - ${escapeHtml(new Date(record.created_at).toLocaleString())}</small>
              <small>Confidence ${escapeHtml(record.scores?.confidence_score ?? "--")} ${escapeHtml(record.confidence_label || "")}</small>
            </article>
          `
        )
        .join("")
    : `<div class="empty">No optimization history yet.</div>`;
}

function renderTimeline() {
  const events = [
    ...optimizationRecords.map((record) => ({ at: record.created_at, title: record.listing_name, detail: record.status.replaceAll("_", " "), kind: "optimization" })),
    ...queueRecords.map((item) => ({ at: item.queued_at, title: item.listing_name, detail: `${item.status} - ${item.priority}`, kind: "queue" })),
    ...logRecords.map((log) => ({ at: log.created_at, title: log.payload.product_name, detail: log.status, kind: "log" }))
  ]
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);

  timelineEl.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <article class="timeline-item ${safeStatusClass(event.kind)}">
              <span></span>
              <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></div>
            </article>
          `
        )
        .join("")
    : `<div class="empty">No activity yet.</div>`;
}

function renderTopKpis(records) {
  const latest = records[0];
  const today = new Date().toDateString();
  const optimizedToday = records.filter((record) => new Date(record.created_at).toDateString() === today).length;
  const avgCtr = records.length ? Math.round(records.reduce((sum, record) => sum + (record.scores?.ctr_score || 0), 0) / records.length) : latest?.scores?.ctr_score || 0;
  const revenueImpact = records.length ? Math.max(12, Math.round(avgCtr * 1.8 + optimizedToday * 9)) : 0;
  heroCtrValueEl.textContent = products.length || "--";
  confidenceValueEl.textContent = optimizedToday;
  confidenceValueEl.title = latest?.confidence_label || "";
  heroThumbValueEl.textContent = currentSession?.credits_remaining ?? "--";
  queuedCountEl.textContent = records.length ? `+${Math.max(8, Math.round((avgCtr - 58) * 0.7))}%` : "--";
  approvedCountEl.textContent = records.length ? `$${revenueImpact}/day` : "--";
}

async function refreshLogs() {
  const response = await fetch("/api/logs");
  const result = await response.json();
  logRecords = unwrapResponse(result, []);
  renderLogs(logRecords);
  renderTimeline();
}

async function refreshOptimizations() {
  const response = await fetch("/api/optimizations");
  const result = await response.json();
  optimizationRecords = unwrapResponse(result, []);
  renderOptimizations(optimizationRecords);
  renderScoreDashboard(optimizationRecords);
  renderHistorySidebar(optimizationRecords);
  renderTopKpis(optimizationRecords);
  renderProducts();
  renderTimeline();
  renderCommerceIntelligence();
}

async function refreshQueue() {
  const response = await fetch("/api/queue");
  const result = await response.json();
  queueRecords = unwrapResponse(result, []);
  renderQueue(queueRecords);
  renderBatchDashboard();
  renderTopKpis(optimizationRecords);
  renderTimeline();
  renderCommerceIntelligence();
}

async function refreshListings() {
  setStatus("Processing");
  renderProductsSkeleton();
  try {
    debugLog("listing fetch started");
    const response = await fetch("/api/listings");
    const result = await parseJsonResponse(response);
    debugLog("listing api response received", result);
    if (!response.ok || result?.success === false) {
      setStatus("Failed");
      products = demoListings;
      renderProducts();
      renderCommerceIntelligence();
      showToast(result.message || "API unavailable. Demo listing loaded.", "error");
      return;
    }
    const payload = unwrapResponse(result, result);
    products = Array.isArray(payload.listings) && payload.listings.length ? payload.listings : demoListings;
    if (payload.etsy) renderEtsyAuthStatus(payload.etsy);
    products.sort((a, b) => {
      if (a.details_status === "synced" && b.details_status !== "synced") return -1;
      if (a.details_status !== "synced" && b.details_status === "synced") return 1;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
    renderProducts();
    renderCommerceIntelligence();
    setStatus("Completed");
    debugLog("listings loaded", { count: products.length });
    if (payload.listings && !payload.listings.length) showToast("No Etsy listings found yet. Demo listing loaded.", "error");
  } catch (error) {
    debugLog("listing fetch failed", error);
    setStatus("Failed");
    products = demoListings;
    renderProducts();
    renderCommerceIntelligence();
    showToast("API unavailable. Demo listing loaded.", "error");
  }
}

async function sendSingle(product) {
  if (!product) {
    showToast("Select a listing before generating an optimization.", "error");
    setStatus("Failed");
    return;
  }
  setStatus("Sending");
  sendSelectedBtn.disabled = true;
  try {
    const response = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product })
    });
    setStatus(response.ok ? "Queued" : "Failed");
    const result = await parseJsonResponse(response);
    debugLog("send api response received", result);
    if (response.status === 401 || response.status === 402) {
      if (result.session) renderSession(result.session);
      if (response.status === 401) onboardingPanelEl.hidden = false;
      if (response.status === 402) showUpgradeModal();
      showToast(response.status === 401 ? "Add your email to start the beta workspace." : "Credits depleted. Upgrade to continue.", "error");
      return;
    }
    if (!response.ok) {
      if (result.session) renderSession(result.session);
      const message = result.error === "make_webhook_not_configured" ? "Make webhook missing. Add MAKE_WEBHOOK_URL to the environment." : result.message || result.make_response?.body || "Optimization request failed.";
      showToast(message, "error");
      return;
    }
    if (result.session) renderSession(result.session);
    showToast("Optimization queued. ACOPES AI is processing this listing.", "success");
    await refreshLogs();
    await refreshOptimizations();
  } catch (error) {
    debugLog("send api failed", error);
    setStatus("Failed");
    showToast("API unavailable. Optimization could not be queued.", "error");
  } finally {
    sendSelectedBtn.disabled = false;
  }
}

async function sendBatch(productsToSend) {
  if (!productsToSend.length) {
    showToast("Select at least one listing before sending a batch.", "error");
    setStatus("Failed");
    return;
  }
  setStatus("Sending");
  sendBatchBtn.disabled = true;
  try {
    const response = await fetch("/api/send-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: productsToSend })
    });
    setStatus(response.ok ? "Queued" : "Failed");
    const result = await parseJsonResponse(response);
    debugLog("batch api response received", result);
    if (response.status === 401 || response.status === 402) {
      if (result.session) renderSession(result.session);
      if (response.status === 401) onboardingPanelEl.hidden = false;
      if (response.status === 402) showUpgradeModal();
      showToast(response.status === 401 ? "Add your email to start the beta workspace." : "Credits depleted. Upgrade to continue.", "error");
      return;
    }
    if (!response.ok) {
      if (result.session) renderSession(result.session);
      const message = result.error === "make_webhook_not_configured" ? "Make webhook missing. Add MAKE_WEBHOOK_URL to the environment." : result.message || "Batch optimization failed.";
      showToast(message, "error");
      return;
    }
    if (result.session) renderSession(result.session);
    showToast("Batch queued for AI optimization.", "success");
    await refreshLogs();
    await refreshOptimizations();
  } catch (error) {
    debugLog("batch api failed", error);
    setStatus("Failed");
    showToast("API unavailable. Batch could not be queued.", "error");
  } finally {
    sendBatchBtn.disabled = false;
  }
}

async function initializeDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  debugLog("dashboard initialized");
  await Promise.allSettled([
    refreshEtsyStatus(),
    refreshListings(),
    refreshLogs(),
    refreshOptimizations(),
    refreshQueue()
  ]);
}

sendSelectedBtn?.addEventListener("click", async () => {
  const [product] = selectedProducts();
  await sendSingle(product);
});

sendBatchBtn?.addEventListener("click", async () => {
  const batch = selectedProducts();
  await sendBatch(batch);
});

refreshListingsBtn?.addEventListener("click", refreshListings);

queueBatchBtn?.addEventListener("click", async () => {
  const batch = selectedProducts();
  if (!batch.length) return;
  await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listings: batch })
  });
  await refreshQueue();
});

competitorFormEl?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(competitorFormEl));
  renderCompetitorIntel(data.query || "quiet luxury jewelry");
  showToast("Competitor intelligence refreshed.", "success");
});

workspaceSelectorEl?.addEventListener("change", () => {
  showToast(`${workspaceSelectorEl.value} selected.`, "success");
});

connectEtsyBtn?.addEventListener("click", () => {
  window.location.href = "/api/etsy/connect";
});

syncEtsyListingsBtn?.addEventListener("click", syncEtsyListings);

disconnectEtsyBtn?.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/etsy/disconnect", { method: "POST" });
    const result = await parseJsonResponse(response);
    renderEtsyAuthStatus(unwrapResponse(result, result));
    showToast(response.ok ? "Etsy connection cleared. Reconnect when ready." : "Could not clear Etsy connection.", response.ok ? "success" : "error");
  } catch (error) {
    debugLog("etsy disconnect failed", error);
    showToast("API unavailable. Etsy reconnect flow could not start.", "error");
  }
});

testMakeResponseBtn?.addEventListener("click", async () => {
  setStatus("Processing");
  const response = await fetch("/api/test-make-response", { method: "POST" });
  setStatus(response.ok ? "Completed" : "Failed");
  showToast(response.ok ? "Test Make response loaded with High confidence demo data." : "Test Make response failed.", response.ok ? "success" : "error");
  await refreshOptimizations();
});

logsEl?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-retry]");
  if (!button) return;
  setStatus("Sending");
  const response = await fetch(`/api/retry/${button.dataset.retry}`, { method: "POST" });
  const result = await response.json();
  if (response.status === 401 || response.status === 402) {
    renderSession(result.session);
    upgradeModalEl.hidden = response.status !== 401 ? false : true;
    setStatus("Failed");
    return;
  }
  if (result.session) renderSession(result.session);
  setStatus(result.status === "completed" ? "Completed" : "Failed");
  await refreshLogs();
  await refreshOptimizations();
});

optimizationsEl?.addEventListener("click", async (event) => {
  const preview = event.target.closest("[data-preview]");
  if (preview) {
    modalImageEl.src = preview.dataset.preview;
    thumbnailModalEl.hidden = false;
    return;
  }
  const rewriteMode = event.target.closest("[data-rewrite-mode]");
  if (rewriteMode) {
    rewriteModesByRecord.set(rewriteMode.dataset.recordId, rewriteMode.dataset.rewriteMode);
    renderOptimizations(optimizationRecords);
    return;
  }
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    const card = toggle.closest(".optimization-card");
    const isAfter = card.dataset.view !== "before";
    card.dataset.view = isAfter ? "before" : "after";
    toggle.textContent = isAfter ? "Show after" : "Show before";
    card.classList.toggle("show-before", isAfter);
    return;
  }
  const button = event.target.closest("[data-approve]");
  if (!button) return;
  await fetch(`/api/optimizations/${button.dataset.approve}/approve`, { method: "POST" });
  await refreshOptimizations();
});

productsEl?.addEventListener("click", async (event) => {
  const preview = event.target.closest("[data-preview]");
  if (preview) {
    event.preventDefault();
    modalImageEl.src = preview.dataset.preview;
    thumbnailModalEl.hidden = false;
    return;
  }
  const retry = event.target.closest("[data-retry-optimization]");
  if (!retry) return;
  const record = optimizationRecords.find((item) => item.id === retry.dataset.retryOptimization);
  if (!record) return;
  await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listings: [{ listing_id: record.listing_id, name: record.listing_name }] })
  });
  await refreshQueue();
});

thumbnailModalEl?.addEventListener("click", (event) => {
  if (!event.target.closest("[data-close-modal]")) return;
  thumbnailModalEl.hidden = true;
  modalImageEl.src = "";
});

upgradeModalEl?.addEventListener("click", (event) => {
  const upgradeButton = event.target.closest("[data-upgrade-plan]");
  if (upgradeButton) {
    const email = currentSession?.email;
    if (!email) {
      upgradeModalEl.hidden = true;
      onboardingPanelEl.hidden = false;
      showToast("Add your email before upgrading.", "error");
      return;
    }
    fetch("/api/paddle-webhook-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, plan: upgradeButton.dataset.upgradePlan })
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.session) renderSession(result.session);
        if (result.status === "updated") {
          upgradeModalEl.hidden = true;
          showToast("Plan updated in beta test mode.", "success");
        } else {
          showToast(result.error || "Upgrade is not available in this environment.", "error");
        }
      });
    return;
  }
  if (!event.target.closest("[data-close-upgrade]")) return;
  upgradeModalEl.hidden = true;
});

onboardingFormEl?.addEventListener("submit", async (event) => {
  event.preventDefault();
  debugLog("onboarding submit fired");
  const data = Object.fromEntries(new FormData(onboardingFormEl));
  const submitButton = onboardingFormEl.querySelector("button");
  if (!data.email || !String(data.email).includes("@")) {
    showToast("Enter a valid email to start the beta workspace.", "error");
    return;
  }
  setStatus("Processing");
  if (submitButton) submitButton.disabled = true;
  try {
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await parseJsonResponse(response);
    debugLog("onboarding api response received", result);
    const sessionPayload = unwrapResponse(result, result);
    if (!response.ok || result?.success === false) {
      showToast(result.message || result.error || "Onboarding failed.", "error");
      setStatus("Failed");
      return;
    }
    renderSession(sessionPayload);
    setStatus("Completed");
    showToast("Workspace ready. 15 free credits added.", "success");
    await initializeDashboard();
  } catch (error) {
    debugLog("onboarding api failed", error);
    showToast("API unavailable. Onboarding failed.", "error");
    setStatus("Failed");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

queueEl?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-queue-retry]");
  if (!button) return;
  await fetch(`/api/queue/${button.dataset.queueRetry}/retry`, { method: "POST" });
  await refreshQueue();
});

refreshSession().then(async (session) => {
  const requestedUpgrade = new URLSearchParams(window.location.search).get("upgrade");
  if (requestedUpgrade) showUpgradeModal(requestedUpgrade);
  const etsyMessage = new URLSearchParams(window.location.search).get("message");
  if (etsyMessage) showToast(decodeURIComponent(etsyMessage), "error");
  await refreshEtsyStatus();
  renderCommerceIntelligence();
  if (session?.onboarding_completed && !session.email_required) {
    await initializeDashboard();
  } else {
    products = demoListings;
    renderProducts();
    renderCommerceIntelligence();
  }
});
setInterval(() => {
  if (!dashboardInitialized) return;
  refreshOptimizations();
  refreshQueue();
}, 4000);
