'use strict';

(function () {

  const BACKEND = 'https://acopes-ai-production.up.railway.app';

  // ── Elements ──────────────────────────────────────────────────────────────
  const emailEl          = document.getElementById('emailInput');
  const passwordEl       = document.getElementById('passwordInput');
  const loginBtn         = document.getElementById('loginBtn');
  const switchMode       = document.getElementById('switchMode');
  const logoutBtn        = document.getElementById('logoutBtn');
  const loginView        = document.getElementById('loginView');
  const loggedInView     = document.getElementById('loggedInView');
  const cardTitle        = document.getElementById('cardTitle');
  const toastEl          = document.getElementById('toast');
  const userEmailEl      = document.getElementById('userEmail');
  const planBadgeEl      = document.getElementById('planBadge');
  const creditBarEl      = document.getElementById('creditBar');
  const usedNumEl        = document.getElementById('usedNum');
  const limitNumEl       = document.getElementById('limitNum');
  const upgradeCtaEl     = document.getElementById('upgradeCta');
  const upgradeCtaLink   = document.getElementById('upgradeCtaLink');
  const renewalRowEl     = document.getElementById('renewalRow');
  const renewalDateEl    = document.getElementById('renewalDate');
  const upgradeSectionEl = document.getElementById('upgradeSection');
  const btnUpgradePremium= document.getElementById('btnUpgradePremium');
  const btnUpgradePower  = document.getElementById('btnUpgradePower');
  const bestPlanEl       = document.getElementById('bestPlan');

  // ── State ─────────────────────────────────────────────────────────────────
  let isSignup = false;

  // ── Toast ─────────────────────────────────────────────────────────────────
  let _t = null;
  function toast(msg, type) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast ' + (type || 'ok');
    toastEl.style.display = 'block';
    clearTimeout(_t);
    if (type !== 'err') _t = setTimeout(() => { toastEl.style.display = 'none'; }, 4000);
  }

  // ── Plan display names ────────────────────────────────────────────────────
  const PLAN_NAMES = { free: 'FREE', premium: 'PREMIUM', power: 'POWER SELLER' };

  // ── Show logged-in UI ─────────────────────────────────────────────────────
  function showLoggedIn(data) {
    loginView.style.display    = 'none';
    loggedInView.style.display = 'block';
    cardTitle.textContent      = 'Hesabınız';

    // ── User + plan badge ───────────────────────────────────────────────────
    userEmailEl.textContent = data.email || '';
    const plan = (data.plan || 'free').toLowerCase();
    planBadgeEl.textContent = PLAN_NAMES[plan] || plan.toUpperCase();
    planBadgeEl.className   = 'plan-badge ' + plan;

    // ── Credit bar ──────────────────────────────────────────────────────────
    const used  = data.used_today  || 0;
    const limit = data.daily_limit || 15;
    const pct   = Math.min(100, Math.round((used / limit) * 100));
    creditBarEl.style.width = pct + '%';
    usedNumEl.textContent   = used;
    limitNumEl.textContent  = limit.toLocaleString();

    // Low-credit warning (free plan, ≤ 3 remaining)
    const remaining = typeof data.remaining === 'number' ? data.remaining : (limit - used);
    if (upgradeCtaEl) {
      const showWarn = plan === 'free' && remaining <= 3;
      upgradeCtaEl.style.display = showWarn ? 'flex' : 'none';
      if (upgradeCtaLink) upgradeCtaLink.href = `https://tagflow.acopesai.com/upgrade?plan=premium`;
    }

    // ── Renewal date (paid plans) ───────────────────────────────────────────
    if (renewalRowEl && renewalDateEl) {
      if (data.subscription_renewal && plan !== 'free') {
        renewalDateEl.textContent = new Date(data.subscription_renewal).toLocaleDateString('tr-TR');
        renewalRowEl.style.display = 'block';
      } else {
        renewalRowEl.style.display = 'none';
      }
    }

    // ── Upgrade buttons ─────────────────────────────────────────────────────
    if (upgradeSectionEl && btnUpgradePremium && btnUpgradePower && bestPlanEl) {
      if (plan === 'free') {
        upgradeSectionEl.style.display = 'flex';
        btnUpgradePremium.style.display = '';
        btnUpgradePower.style.display   = '';
        bestPlanEl.style.display        = 'none';
      } else if (plan === 'premium') {
        upgradeSectionEl.style.display  = 'flex';
        btnUpgradePremium.style.display = 'none';
        btnUpgradePower.style.display   = '';
        bestPlanEl.style.display        = 'none';
      } else {
        // power — best plan
        upgradeSectionEl.style.display = 'none';
        bestPlanEl.style.display       = 'block';
      }
    }
  }

  // ── Show logged-out UI ────────────────────────────────────────────────────
  function showLoggedOut() {
    loginView.style.display    = 'block';
    loggedInView.style.display = 'none';
    cardTitle.textContent      = isSignup ? 'Ücretsiz Kayıt' : 'Giriş Yap';
  }

  // ── API call helper (safe JSON parsing) ──────────────────────────────────
  async function api(path, body, token) {
    const opts = {
      method:  body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' }
    };
    if (token)  opts.headers['authorization'] = 'Bearer ' + token;
    if (body)   opts.body = JSON.stringify(body);
    const res  = await fetch(BACKEND + path, opts);

    // Read raw text first — res.json() throws an opaque error if the server
    // returns HTML (e.g. a proxy 404 or crash page). This gives us the body.
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      // Not JSON — surface status + first 200 chars so the bug is visible
      throw new Error(`HTTP ${res.status} — sunucu beklenmedik yanıt döndürdü: ${text.slice(0, 200)}`);
    }
    return { ok: res.ok, status: res.status, data };
  }

  // ── Load state on page open ───────────────────────────────────────────────
  chrome.storage.local.get('tagflowToken', async function (s) {
    const token = s.tagflowToken;
    if (!token) { showLoggedOut(); return; }

    // Verify token + fetch fresh credit info
    try {
      const { ok, data } = await api('/api/tagflow/user/me', null, token);
      if (ok && data.success) {
        showLoggedIn(data);
      } else {
        // Token expired / invalid → clear and show login
        chrome.storage.local.remove('tagflowToken');
        showLoggedOut();
      }
    } catch {
      showLoggedOut();
    }
  });

  // ── Toggle signup / login mode ────────────────────────────────────────────
  switchMode.addEventListener('click', function () {
    isSignup = !isSignup;
    cardTitle.textContent = isSignup ? 'Ücretsiz Kayıt' : 'Giriş Yap';
    loginBtn.textContent  = isSignup ? 'Kayıt Ol' : 'Giriş Yap';
    switchMode.textContent = isSignup ? '← Zaten hesabın var mı? Giriş yap' : 'Hesabın yok mu? Ücretsiz kayıt ol →';
    toastEl.style.display = 'none';
  });

  // ── Login / Signup ────────────────────────────────────────────────────────
  loginBtn.addEventListener('click', async function () {
    const email    = (emailEl.value || '').trim();
    const password = (passwordEl.value || '').trim();
    if (!email || !password) { toast('Email ve şifre gerekli.', 'err'); return; }

    loginBtn.disabled    = true;
    loginBtn.textContent = 'Bekleniyor...';

    try {
      const endpoint = isSignup ? '/api/tagflow/auth/signup' : '/api/tagflow/auth/login';
      const { ok, data } = await api(endpoint, { email, password });

      if (ok && data.success) {
        chrome.storage.local.set({ tagflowToken: data.token }, function () {
          toast('✅ ' + (isSignup ? 'Hesap oluşturuldu!' : 'Giriş başarılı!'), 'ok');
          showLoggedIn(data);
        });
      } else {
        toast('❌ ' + (data.error || 'Bir hata oluştu.'), 'err');
      }
    } catch (e) {
      toast('❌ Bağlantı hatası: ' + e.message, 'err');
    }

    loginBtn.disabled    = false;
    loginBtn.textContent = isSignup ? 'Kayıt Ol' : 'Giriş Yap';
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  logoutBtn.addEventListener('click', function () {
    chrome.storage.local.remove('tagflowToken', function () {
      isSignup = false;
      showLoggedOut();
      toast('Çıkış yapıldı.', 'ok');
    });
  });

  // ── Upgrade handlers ──────────────────────────────────────────────────────
  async function handleUpgrade(plan) {
    const s = await chrome.storage.local.get('tagflowToken');
    if (!s.tagflowToken) { toast('Önce giriş yapın.', 'err'); return; }

    const btn = plan === 'power' ? btnUpgradePower : btnUpgradePremium;
    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Bekleniyor...</span>'; }

    try {
      const { ok, data } = await api('/api/tagflow/billing/create-checkout', { plan }, s.tagflowToken);
      if (ok && data.success && data.checkout_url) {
        // Open checkout in a new tab (placeholder or live Paddle URL)
        chrome.tabs.create({ url: data.checkout_url });
        if (data.placeholder) toast('ℹ️ Ödeme altyapısı yapılandırılmadı. Yakında aktif olacak.', 'ok');
      } else {
        toast('❌ ' + (data.error || 'Checkout oluşturulamadı.'), 'err');
      }
    } catch (e) {
      toast('❌ Bağlantı hatası: ' + e.message, 'err');
    }

    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }

  if (btnUpgradePremium) btnUpgradePremium.addEventListener('click', () => handleUpgrade('premium'));
  if (btnUpgradePower)   btnUpgradePower.addEventListener('click',   () => handleUpgrade('power'));

  // ── Enter key support ─────────────────────────────────────────────────────
  [emailEl, passwordEl].forEach(el => {
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });
  });

})();
