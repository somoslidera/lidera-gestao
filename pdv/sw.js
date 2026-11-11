/* Flow PDV: guarda a casca do aplicativo para abrir sem internet. Vale só para a pasta /pdv/. */
const C='fpdv-v1';
const BASE=new URL('./',self.location).pathname;
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2']).catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('fpdv-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  const casca=(u.origin===self.location.origin&&u.pathname.startsWith(BASE))||u.hostname==='cdn.jsdelivr.net'||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
  if(!casca)return;
  e.respondWith(fetch(r).then(resp=>{if(resp&&(resp.ok||resp.type==='opaque')){const cp=resp.clone();caches.open(C).then(c=>c.put(r,cp));}return resp;})
    .catch(()=>caches.match(r,{ignoreSearch:u.origin===self.location.origin}).then(m=>m||(r.mode==='navigate'?caches.match('./'):Response.error()))));});
