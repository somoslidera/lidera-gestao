/* Flow: service worker da raiz (#62). Existe para o Flow poder ser instalado como app no celular
   e, quando a internet cai, abrir uma tela "Sem internet" em vez do erro do navegador.

   Regras (não afrouxar):
   - A página (index.html) vem SEMPRE da rede e nunca é guardada em cache: ninguém fica preso numa
     versão velha e o aviso de versão nova continua valendo. O Flow não funciona sem internet (o banco
     e as bibliotecas vêm da rede), então abrir uma cópia velha sem rede só quebraria a tela.
   - Só GET do próprio site. Banco (Supabase), CDNs e qualquer outro domínio passam direto.
   - Não toca no /pdv/: o Flow PDV tem o service worker dele (pdv/sw.js) e não pode ser impactado.
   - Não toca no versao.json nem em HEAD (o verChecar confere a versão no servidor). */
const C = 'flow-v1';
const BASE = new URL('./', self.location).pathname;          // "/" no ar e no preview
const ICONES = ['icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(ICONES)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('flow-') && k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(BASE)) return;   // banco, CDN, fontes: direto
  const resto = u.pathname.slice(BASE.length);
  if (resto === 'pdv' || resto.startsWith('pdv/')) return;                         // Flow PDV: tem o service worker dele
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(offline));                                        // rede sempre; sem rede, aviso
    return;
  }
  if (resto.startsWith('icons/')) {
    e.respondWith(fetch(r).then(resp => {
      if (resp && resp.ok) { const cp = resp.clone(); caches.open(C).then(c => c.put(r, cp)).catch(() => {}); }
      return resp;
    }).catch(() => caches.match(r).then(m => m || Response.error())));
  }
  // o resto (versao.json, manifest, sw.js…) segue direto para a rede, como sem service worker
});

function offline() {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#1D3573">
<title>Flow · sem internet</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#1D3573;color:#fff;font:15px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px}
button{margin-top:18px;background:#A48A57;color:#1b1304;border:0;border-radius:10px;padding:12px 20px;font:600 15px system-ui}</style></head>
<body><div><img src="icons/icon-192.png" alt="" width="72" height="72" style="border-radius:16px">
<p>Sem internet agora.<br>Confira a conexão e tente de novo.</p>
<button onclick="location.reload()">Tentar de novo</button></div></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
