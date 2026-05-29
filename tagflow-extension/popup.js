document.addEventListener('DOMContentLoaded', async () => {
  // Check for TagFlow login token (SaaS auth — stored by tagflow_opts.js)
  const { tagflowToken } = await chrome.storage.local.get('tagflowToken');
  const area = document.getElementById('statusArea');

  if (tagflowToken) {
    area.innerHTML = `
      <div class="status-card">
        <div class="status-ico">✅</div>
        <div class="status-title">Hazır!</div>
        <div class="status-sub">Giriş yapıldı. Etsy'de herhangi bir ürünün üzerine gelip <strong>TagFlow Analiz</strong> butonuna tıklayın.</div>
      </div>`;
  } else {
    area.innerHTML = `
      <div class="warn-card">
        <div class="status-ico">⚠️</div>
        <div class="warn-title">Giriş Yapılmamış</div>
        <div class="warn-sub">Analiz yapmak için Ayarlar'dan ücretsiz hesap oluşturun veya giriş yapın.</div>
      </div>`;
  }

  document.getElementById('goEtsy').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.etsy.com/search?q=jewelry' });
  });
  document.getElementById('goSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('fr').addEventListener('click', () => chrome.runtime.openOptionsPage());
});
