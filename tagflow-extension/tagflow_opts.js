'use strict';

(function () {

  const BACKEND = 'https://acopes-ai-v9-live.vercel.app';

  // ── Elements ──────────────────────────────────────────────────────────────
  const emailEl      = document.getElementById('emailInput');
  const passwordEl   = document.getElementById('passwordInput');
  const loginBtn     = document.getElementById('loginBtn');
  const switchMode   = document.getElementById('switchMode');
  const logoutBtn    = document.getElementById('logoutBtn');
  const loginView    = document.getElementById('loginView');
  const loggedInView = document.getElementById('loggedInView');
  const cardTitle    = document.getElementById('cardTitle');
  const toastEl      = document.getElementById('toast');
  const userEmailEl  = document.getElementById('userEmail');
  const planBadgeEl  = document.getElementById('planBadge');
  const creditBarEl  = document.getElementById('creditBar');
  const usedNumEl    = document.getElementById('usedNum');
  const limitNumEl   = document.getElementById('limitNum');
  const upgradeCtaEl = document.getElementById('upgradeCta');

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

  // ── Show logged-in UI ─────────────────────────────────────────────────────
  function showLoggedIn(data) {
    loginView.style.display    = 'none';
    loggedInView.style.display = 'block';
    cardTitle.textContent      = 'Hesabınız';

    userEmailEl.textContent = data.email || '';
    const plan = (data.plan || 'free').toLowerCase();
    planBadgeEl.textContent = plan.toUpperCase();
    planBadgeEl.className   = 'plan-badge ' + plan;

    if (data.daily_limit === -1 || data.remaining === null) {
      // Unlimited plan
      document.getElementById('creditWrap').style.display = 'none';
    } else {
      const used  = data.used_today  || 0;
      const limit = data.daily_limit || 15;
      const pct   = Math.min(100, Math.round((used / limit) * 100));
      creditBarEl.style.width = pct + '%';
      usedNumEl.textContent   = used;
      limitNumEl.textContent  = limit;
      upgradeCtaEl.style.display = (limit - used <= 3 && plan === 'free') ? 'flex' : 'none';
    }
  }

  // ── Show logged-out UI ────────────────────────────────────────────────────
  function showLoggedOut() {
    loginView.style.display    = 'block';
    loggedInView.style.display = 'none';
    cardTitle.textContent      = isSignup ? 'Ücretsiz Kayıt' : 'Giriş Yap';
  }

  // ── API call helper ───────────────────────────────────────────────────────
  async function api(path, body, token) {
    const opts = {
      method:  body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' }
    };
    if (token)  opts.headers['authorization'] = 'Bearer ' + token;
    if (body)   opts.body = JSON.stringify(body);
    const res  = await fetch(BACKEND + path, opts);
    const data = await res.json();
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

  // ── Enter key support ─────────────────────────────────────────────────────
  [emailEl, passwordEl].forEach(el => {
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });
  });

})();
