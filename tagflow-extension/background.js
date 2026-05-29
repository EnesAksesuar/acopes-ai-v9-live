'use strict';

// ── TagFlow backend (Vercel) ──────────────────────────────────────────────────
const TAGFLOW_BACKEND = 'https://acopes-ai-v9-live.vercel.app';

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Etsy listing page (unchanged — Etsy scraping, no auth needed)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchListingData(url) {
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': navigator.userAgent } });
    const html = await res.text();
    let tags = [], title = '';

    // JSON-LD
    const ldMatches = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) || [];
    for (const script of ldMatches) {
      try {
        const json = JSON.parse(script.replace(/<script[^>]*>/, '').replace('</script>', ''));
        if (json.keywords) tags = json.keywords.split(',').map(t => t.trim()).filter(Boolean);
        if (json.name && !title) title = json.name;
      } catch (_) {}
    }

    // Fallback: tags from page state
    if (!tags.length) {
      const tagMatch = html.match(/"tags":\s*\[([^\]]+)\]/);
      if (tagMatch) {
        try {
          tags = JSON.parse('[' + tagMatch[1] + ']')
            .filter(t => typeof t === 'string').map(t => t.trim());
        } catch (_) {}
      }
    }

    // Fallback title
    if (!title) {
      const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
      if (og) title = og[1].replace(' | Etsy', '').trim();
    }

    return { tags: tags.slice(0, 13), title };
  } catch (err) {
    return { tags: [], title: '', error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Call TagFlow backend /api/tagflow/analyze
// Extension → backend → auth/plan/credit check → Anthropic → response
// ─────────────────────────────────────────────────────────────────────────────
async function callTagflowAnalyze(token, prompt, maxTokens) {
  console.log('[BACKGROUND] callTagflowAnalyze → backend');
  const res = await fetch(`${TAGFLOW_BACKEND}/api/tagflow/analyze`, {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      'authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ prompt, max_tokens: maxTokens || 1000 })
  });

  const data = await res.json();
  console.log('[ANALYZE RESPONSE]', { status: res.status, success: data.success, credits: data.credits });

  if (!res.ok || !data.success) {
    return {
      error:   data.error || `HTTP ${res.status}`,
      upgrade: data.upgrade || false,
      credits: data.credits || null
    };
  }
  return { text: data.text, credits: data.credits };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify JWT token via /api/tagflow/user/me
// ─────────────────────────────────────────────────────────────────────────────
async function verifyTagflowToken(token) {
  const res  = await fetch(`${TAGFLOW_BACKEND}/api/tagflow/user/me`, {
    headers: { 'authorization': 'Bearer ' + token }
  });
  const data = await res.json();
  console.log('[BACKGROUND] verifyToken result:', data);
  if (!res.ok || !data.success) return { success: false, error: data.error || 'Token geçersiz.' };
  return { success: true, ...data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Message listener
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  console.log('[BACKGROUND MESSAGE]', msg.type || msg.action);

  // ── Etsy listing fetch (unchanged) ──────────────────────────────────────
  if (msg.type === 'FETCH_LISTING') {
    fetchListingData(msg.url)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // ── AI analyze → TagFlow backend ────────────────────────────────────────
  if (msg.type === 'CALL_CLAUDE') {
    const { prompt, maxTokens } = msg.payload || {};
    chrome.storage.local.get('tagflowToken', function (s) {
      const token = s.tagflowToken;
      if (!token) {
        sendResponse({ error: 'Giriş yapılmamış. TagFlow ayarlarından oturum açın.' });
        return;
      }
      callTagflowAnalyze(token, prompt, maxTokens)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // ── Token verify (options page TEST_KEY → user/me) ───────────────────────
  if (msg.type === 'TEST_KEY') {
    const token = msg.token || msg.apiKey;
    console.log('[BACKGROUND] verifying tagflow token');
    verifyTagflowToken(token)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});
