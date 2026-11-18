// Guarda o app no aparelho para funcionar sem internet
const VERSAO = 'orc-v1';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'tabela-pdf.js', 'config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const EXTERNOS = [FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(async c => {
    await c.addAll(ARQUIVOS);
    await Promise.all(EXTERNOS.map(u => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const proprio = url.origin === location.origin;
  const biblioteca = url.href.startsWith('https://www.gstatic.com/firebasejs/') || url.href.startsWith('https://cdn.jsdelivr.net/npm/pdfjs-dist');
  if (!proprio && !biblioteca) return; // login e banco de dados vão direto para a internet

  if (biblioteca) {
    // bibliotecas com versão fixa: usa a cópia guardada
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(VERSAO).then(c => c.put(req, cp)); }
      return res;
    })));
    return;
  }
  // arquivos do app: tenta a internet (para pegar atualização) e cai na cópia guardada
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(VERSAO).then(c => c.put(req, cp)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
