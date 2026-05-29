// ACOPES TagFlow v2 — Etsy Page Overlay
// Injects "Analiz Et" button on every product card

(function () {
  if (window.__tfLoaded) return;
  window.__tfLoaded = true;

  let activeOverlay = null;

  // ── DETAIL PAGE HELPERS ───────────────────────────────────────────
  function isDetailPage() {
    return /\/listing\/\d+/.test(window.location.pathname);
  }

  function getDetailTitle() {
    const selectors = [
      'h1[data-buy-box-listing-title]',
      '[data-product-details-title-and-translation-target] h1',
      '.wt-text-body-03.wt-text-bold',
      'h1.wt-text-body-03',
      'h1'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return document.title.replace(/ \| Etsy.*$/, '').trim();
  }

  function injectDetailButton() {
    if (document.querySelector('.tf-detail-btn')) return;
    const title = getDetailTitle();
    console.log('[DETAIL PAGE DETECTED]', window.location.pathname);
    console.log('[DETAIL TITLE]', title);

    const btn = document.createElement('button');
    btn.className = 'tf-detail-btn';
    btn.innerHTML = '<span class="tf-dot"></span>TagFlow Analiz';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOverlay(null, window.location.href, title);
    });

    const targets = [
      '[data-region="buy-box"]',
      '.wt-buybox',
      '.listing-page-buy-box',
      'h1[data-buy-box-listing-title]',
      'h1'
    ];
    let injected = false;
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el && el.parentNode) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin:8px 0;';
        wrap.appendChild(btn);
        el.parentNode.insertBefore(wrap, el.nextSibling);
        injected = true;
        break;
      }
    }
    if (!injected) {
      btn.style.cssText = 'position:fixed!important;bottom:20px;right:20px;z-index:99999;';
      document.body.appendChild(btn);
    }
  }

  // ── SELECTORS for Etsy listing cards ──────────────────────────────
  const CARD_SELECTORS = [
    '[data-listing-id]',
    '.v2-listing-card',
    '[data-palette-listing-id]',
    '.js-merch-stash-check-listing',
    'li[class*="listing"]',
  ];

  function findCards() {
    for (const sel of CARD_SELECTORS) {
      const cards = document.querySelectorAll(sel);
      if (cards.length > 0) return Array.from(cards);
    }
    return [];
  }

  function getCardLink(card) {
    const a = card.querySelector('a[href*="/listing/"]');
    return a ? a.href : null;
  }

  function getCardTitle(card) {
    const el = card.querySelector(
      'h3, .v2-listing-card__title, [class*="title"], [class*="listing-link"] span'
    );
    return el ? el.textContent.trim() : '';
  }

  function getPageCompetitorTitles() {
    const all = [];
    document.querySelectorAll(
      '.v2-listing-card__title, h3[class*="listing"], [data-listing-id] h3'
    ).forEach(el => {
      const t = el.textContent.trim();
      if (t && !all.includes(t)) all.push(t);
    });
    return all.slice(0, 15);
  }

  // ── INJECT ANALYZE BUTTONS ────────────────────────────────────────
  function injectButtons() {
    const cards = findCards();
    cards.forEach(card => {
      if (card.querySelector('.tf-btn')) return; // already injected
      if (!card.style.position || card.style.position === 'static') {
        card.style.position = 'relative';
      }
      card.classList.add('tf-card-wrap');

      const btn = document.createElement('button');
      btn.className = 'tf-btn';
      btn.innerHTML = '<span class="tf-dot"></span>TagFlow Analiz';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url   = getCardLink(card);
        const title = getCardTitle(card);
        openOverlay(card, url, title);
      });
      card.appendChild(btn);
    });
  }

  // ── OVERLAY: OPEN ─────────────────────────────────────────────────
  function openOverlay(card, listingUrl, title) {
    closeOverlay();
    console.log('[POPUP OPEN]', { url: listingUrl, title: (title || '').slice(0, 60) });

    const panel = document.createElement('div');
    panel.className = 'tf-overlay';
    panel.id = 'tf-main-overlay';

    // Position: fixed viewport coordinates (no scrollY offset)
    if (card) {
      const rect = card.getBoundingClientRect();
      const left = Math.min(rect.right + 10, window.innerWidth - 360);
      const top  = Math.max(Math.min(rect.top, window.innerHeight - 120), 60);
      panel.style.left = left + 'px';
      panel.style.top  = top + 'px';
    } else {
      // Detail page: top-right
      panel.style.right = '20px';
      panel.style.top   = '80px';
    }

    panel.innerHTML = `
      <div class="tf-ov-header">
        <div class="tf-ov-logo">
          <div class="tf-ov-logo-icon">🏷️</div>
          <div>
            <div class="tf-ov-logo-text">ACOPES AI · TagFlow</div>
            <div class="tf-ov-logo-sub">Tag Rakabet Analizi</div>
          </div>
        </div>
        <button class="tf-close-btn" id="tf-close">✕</button>
      </div>
      <div class="tf-ov-body">
        <div class="tf-prod-title">${escHtml(title || 'Ürün başlığı yükleniyor...')}</div>
        <div id="tf-content">
          <div class="tf-loading">
            <div class="tf-spinner"></div>
            <div class="tf-loading-text">Taglar analiz ediliyor...</div>
            <div class="tf-loading-sub">Rakip verisi toplanıyor</div>
          </div>
        </div>
      </div>
      <div class="tf-ov-footer" id="tf-footer" style="display:none"></div>
    `;

    document.body.appendChild(panel);
    activeOverlay = panel;

    panel.querySelector('#tf-close').addEventListener('click', closeOverlay);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', outsideClick);
    }, 100);

    // Start analysis
    analyze(panel, listingUrl, title);
  }

  function outsideClick(e) {
    if (activeOverlay && !activeOverlay.contains(e.target) && !e.target.classList.contains('tf-btn')) {
      closeOverlay();
    }
  }

  function closeOverlay() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    document.removeEventListener('click', outsideClick);
  }

  // ── ANALYZE ───────────────────────────────────────────────────────
  async function analyze(panel, listingUrl, cardTitle) {
    const content = panel.querySelector('#tf-content');

    try {
      // 1. Check login token (saved as 'tagflowToken' by tagflow_opts.js)
      const stored = await chrome.storage.local.get('tagflowToken');
      if (!stored.tagflowToken) {
        showError(content, 'Giriş yapılmamış.<br><small>TagFlow ikonuna tıklayıp oturum açın.</small>');
        return;
      }

      // 2. Fetch listing page for real tags
      let tags = [];
      let realTitle = cardTitle;

      if (listingUrl) {
        content.querySelector('.tf-loading-sub').textContent = 'Listing sayfası okunuyor...';
        const fetchResult = await chrome.runtime.sendMessage({
          type: 'FETCH_LISTING',
          url: listingUrl
        });
        if (fetchResult?.tags?.length) tags = fetchResult.tags;
        if (fetchResult?.title) realTitle = fetchResult.title;
        // Update title in panel
        const titleEl = panel.querySelector('.tf-prod-title');
        if (titleEl && realTitle) titleEl.textContent = realTitle;
      }

      // 3. Collect page-level competitor titles
      const competitorTitles = getPageCompetitorTitles().filter(t => t !== realTitle);

      content.querySelector('.tf-loading-sub').textContent = 'AI rakabet skoru hesaplıyor...';

      // 4. Call Claude for competition analysis
      const tagsForAnalysis = tags.length ? tags : ['(tag bulunamadı — başlık analiz ediliyor)'];

      const prompt = `You are an Etsy SEO expert. Analyze these tags from an Etsy listing and score their competition level.

Product title: "${realTitle}"
Current tags: ${tagsForAnalysis.join(', ')}
Similar products on the same page (competitor titles):
${competitorTitles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}

For each tag, assign:
- competition: "low" (niche, specific, under-used), "med" (moderate), or "high" (very common, saturated)
- score: 1-100 where 100 = highest competition (hardest to rank for)

Also add 3-5 OPPORTUNITY tags (not currently used but low competition and high buyer intent based on the product and competitors).

Respond ONLY with this JSON (no markdown):
{
  "analyzed": [
    {"tag": "tag name", "competition": "low|med|high", "score": 45}
  ],
  "opportunities": [
    {"tag": "new tag", "competition": "low", "score": 20}
  ],
  "insight": "2 sentence summary: what patterns you see, which tags to prioritize"
}`;

      const result = await chrome.runtime.sendMessage({
        type: 'CALL_CLAUDE',
        payload: { prompt }
      });

      console.log('[UI RESPONSE]', result);

      if (!result) {
        console.log('[UI ERROR] result undefined — SW crashed or no handler');
        throw new Error('Background yanıt vermedi. Extension\'ı yeniden yükleyin.');
      }
      if (result.error) {
        console.log('[UI ERROR]', result.error);
        // Show upgrade CTA if credit limit hit
        if (result.upgrade) {
          showError(content, '⚡ ' + escHtml(result.error) +
            '<br><small><a href="https://tagflow.acopesai.com/upgrade" target="_blank" style="color:#854d0e">Premium\'a geç →</a></small>');
          return;
        }
        throw new Error(result.error);
      }
      if (!result.text) {
        console.log('[UI ERROR] result.text boş:', result);
        throw new Error('Boş yanıt döndürdü.');
      }

      const cleaned = result.text.replace(/```json|```/g, '').trim();
      let data;
      try {
        data = JSON.parse(cleaned);
      } catch (parseErr) {
        console.log('[UI ERROR] JSON parse hatası:', parseErr.message, '| raw:', cleaned.slice(0, 200));
        throw new Error('AI yanıtı parse edilemedi: ' + parseErr.message);
      }

      renderResults(panel, data, tags);

      // Show credit counter after analysis
      if (result.credits) updateCreditDisplay(panel, result.credits);

    } catch (err) {
      showError(content, 'Hata: ' + escHtml(err.message));
    }
  }

  // ── RENDER RESULTS ────────────────────────────────────────────────
  function renderResults(panel, data, originalTags) {
    const content = panel.querySelector('#tf-content');
    const footer  = panel.querySelector('#tf-footer');

    const analyzed      = data.analyzed     || [];
    const opportunities = data.opportunities || [];
    const insight       = data.insight       || '';

    // Sort: low first
    const order = { low: 0, med: 1, high: 2 };
    analyzed.sort((a, b) => order[a.competition] - order[b.competition]);

    let html = '';

    if (analyzed.length) {
      const low  = analyzed.filter(t => t.competition === 'low').length;
      const med  = analyzed.filter(t => t.competition === 'med').length;
      const high = analyzed.filter(t => t.competition === 'high').length;

      html += `
        <div class="tf-section-lbl">
          Mevcut Taglar
          <span style="font-size:10px;font-weight:400;color:#9ca3af">
            <span style="color:#166534">🟢${low}</span>
            <span style="color:#854d0e"> 🟡${med}</span>
            <span style="color:#991b1b"> 🔴${high}</span>
          </span>
        </div>
        <div class="tf-tag-list" id="tf-analyzed-list">
          ${analyzed.map(t => tagRowHtml(t)).join('')}
        </div>`;
    }

    if (opportunities.length) {
      html += `
        <div class="tf-section-lbl" style="margin-top:12px">
          💡 Fırsat Tagları (Düşük Rekabet)
        </div>
        <div class="tf-tag-list" id="tf-opp-list">
          ${opportunities.map(t => tagRowHtml(t, true)).join('')}
        </div>`;
    }

    if (insight) {
      html += `
        <div class="tf-insight">
          <div class="tf-insight-title">📊 Analiz</div>
          ${escHtml(insight)}
        </div>`;
    }

    content.innerHTML = html;

    // Click to copy individual tags
    content.querySelectorAll('.tf-tag-row').forEach(row => {
      row.addEventListener('click', () => {
        const tag = row.dataset.tag;
        navigator.clipboard.writeText(tag).catch(() => {});
        row.classList.add('copied');
        row.querySelector('.tf-copy-ico').textContent = '✓';
        setTimeout(() => {
          row.classList.remove('copied');
          row.querySelector('.tf-copy-ico').textContent = '⧉';
        }, 1500);
      });
    });

    // Footer buttons
    footer.style.display = 'flex';
    const lowTags = [...(data.analyzed || []), ...(data.opportunities || [])]
      .filter(t => t.competition === 'low')
      .map(t => t.tag);
    const allTags = [...(data.analyzed || []), ...(data.opportunities || [])].map(t => t.tag);

    footer.innerHTML = `
      <button class="tf-btn-copy-low" id="tf-copy-low" title="Sadece düşük rekabetli tagları kopyala">
        🟢 Düşük Rek. Kopyala (${lowTags.length})
      </button>
      <button class="tf-btn-copy-all" id="tf-copy-all">Tümü ⧉</button>
    `;

    footer.querySelector('#tf-copy-low').addEventListener('click', () => {
      navigator.clipboard.writeText(lowTags.join(', ')).catch(() => {});
      const btn = footer.querySelector('#tf-copy-low');
      btn.classList.add('done');
      btn.textContent = '✓ Kopyalandı!';
      setTimeout(() => { btn.classList.remove('done'); btn.textContent = `🟢 Düşük Rek. Kopyala (${lowTags.length})`; }, 2000);
    });

    footer.querySelector('#tf-copy-all').addEventListener('click', () => {
      navigator.clipboard.writeText(allTags.join(', ')).catch(() => {});
      const btn = footer.querySelector('#tf-copy-all');
      btn.textContent = '✓ Tamam';
      setTimeout(() => { btn.textContent = 'Tümü ⧉'; }, 2000);
    });
  }

  function tagRowHtml(t, isOpportunity = false) {
    const lvl   = t.competition || 'med';
    const score = Math.min(100, Math.max(1, t.score || 50));
    const label = { low: '🟢 Düşük', med: '🟡 Orta', high: '🔴 Yüksek' }[lvl];
    const opp   = isOpportunity ? ' style="background:#f0fdf4;border-color:#bbf7d0"' : '';
    return `
      <div class="tf-tag-row" data-tag="${escHtml(t.tag)}"${opp}>
        <span class="tf-tag-name">${escHtml(t.tag)}</span>
        <div class="tf-tag-right">
          <div class="tf-score-bar">
            <div class="tf-score-fill ${lvl}" style="width:${score}%"></div>
          </div>
          <span class="tf-badge ${lvl}">${label}</span>
          <span class="tf-copy-ico">⧉</span>
        </div>
      </div>`;
  }

  // ── Credit counter (shown after analysis) ────────────────────────
  function updateCreditDisplay(panel, credits) {
    const existing = panel.querySelector('#tf-credit-bar');
    if (existing) existing.remove();
    if (!credits || credits.remaining === null) return; // unlimited plan

    const used  = credits.used_today  || 0;
    const limit = credits.daily_limit || 15;
    const rem   = credits.remaining   || 0;
    const pct   = Math.min(100, Math.round((used / limit) * 100));

    const bar = document.createElement('div');
    bar.id = 'tf-credit-bar';
    bar.style.cssText = 'padding:8px 14px;border-top:1px solid #f3f4f6;font-size:11px;color:#6b7280;display:flex;align-items:center;gap:8px;';
    bar.innerHTML = `
      <div style="flex:1;height:4px;background:#f3f4f6;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${pct > 80 ? '#f59e0b' : '#1D9E75'};border-radius:4px"></div>
      </div>
      <span>${used}/${limit} analiz</span>
      ${rem <= 3 ? '<a href="https://tagflow.acopesai.com/upgrade" target="_blank" style="color:#854d0e;font-weight:700;text-decoration:none">⚡ Yükselt</a>' : ''}
    `;
    // Append inside overlay, after footer
    const footer = panel.querySelector('#tf-footer') || panel.querySelector('.tf-ov-footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(bar, footer.nextSibling);
  }

  function showError(container, html) {
    container.innerHTML = `
      <div class="tf-error">
        <div class="tf-error-ico">⚠️</div>
        ${html}
      </div>`;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── MUTATION OBSERVER: listing grid + detail page ────────────────
  const observer = new MutationObserver(() => {
    if (isDetailPage()) injectDetailButton();
    else injectButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial inject
  if (isDetailPage()) {
    setTimeout(injectDetailButton, 800);
    setTimeout(injectDetailButton, 2500);
  } else {
    setTimeout(injectButtons, 800);
    setTimeout(injectButtons, 2000);
  }

})();
