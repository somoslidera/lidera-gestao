// Flow instalável como app no celular (#62). Roda contra o _site/ (sem banco).
//
//   python3 ../preview_build.py && node pwa.mjs
//
// Confere: manifest e ícones (tamanhos reais), meta tags do iPhone, service worker ativo que NÃO guarda a
// página e não mexe no /pdv/, tela "Sem internet", safe areas (simuladas com --sa-*), dica de instalar no
// iPhone (Safari) e no Android (pedido do Chrome), app instalado (sem dica, link externo abre fora) e o
// computador igual a antes. 1280 e 390 px, sem rolagem lateral, sem erro de JS e sem chamada ao banco.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(AQUI, "../../_site");
const PRINTS = join(AQUI, "prints");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png" };
let DERRUBADO = false;   // simula "sem internet": o setOffline do Playwright não derruba os fetch do service worker
const srv = createServer(async (req, res) => {
  if (DERRUBADO) { req.socket.destroy(); return; }
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const arq = resolve(SITE, "." + p);
    if (!arq.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    const corpo = await readFile(arq);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : corpo);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const falhas = [];
const checa = (cond, msg) => { if (!cond) falhas.push(msg); };
await mkdir(PRINTS, { recursive: true });

// ---------- 1. arquivos do site ----------
const pngLado = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const man = JSON.parse(await readFile(join(SITE, "manifest.webmanifest"), "utf-8"));
for (const k of ["name", "short_name", "start_url", "scope", "display", "background_color", "theme_color", "icons"]) checa(man[k], `manifest sem ${k}`);
checa(man.display === "standalone", "manifest: display não é standalone");
const tam = (s) => man.icons.find((i) => i.sizes === s && (i.purpose || "any").includes("any"));
checa(tam("192x192") && tam("512x512"), "manifest sem ícone 192 e 512 (any)");
checa(man.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"), "manifest sem ícone maskable 512");
for (const i of man.icons) {
  const [w, h] = pngLado(await readFile(join(SITE, i.src)));
  checa(`${w}x${h}` === i.sizes, `ícone ${i.src} tem ${w}x${h}, manifest diz ${i.sizes}`);
}
const [aw, ah] = pngLado(await readFile(join(SITE, "icons/apple-touch-icon.png")));
checa(aw === 180 && ah === 180, `apple-touch-icon com ${aw}x${ah}`);
const html = await readFile(join(SITE, "index.html"), "utf-8");
for (const t of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon" sizes="180x180"', 'name="apple-mobile-web-app-capable" content="yes"',
  'name="apple-mobile-web-app-status-bar-style"', 'name="apple-mobile-web-app-title" content="Flow"', "viewport-fit=cover"]) checa(html.includes(t), `index.html sem ${t}`);
const wf = await readFile(resolve(AQUI, "../../.github/workflows/pages.yml"), "utf-8");
checa(/manifest\.webmanifest/.test(wf) && /sw\.js/.test(wf) && /cp -R icons/.test(wf), "pages.yml não publica manifest, sw.js e icons/");

const nav = await chromium.launch();
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

async function abrir(opts = {}, init) {
  const ctx = await nav.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, userAgent: opts.ua, isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
  if (init) await ctx.addInitScript(init);
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForFunction(() => typeof go === "function" && document.querySelector(".topbar"));
  return { ctx, pag, erros, banco };
}
const fim = async (nome, { ctx, pag, erros, banco }) => {
  checa(!erros.length, `${nome}: erro de JS: ${erros.join(" | ")}`);
  checa(!banco.length, `${nome}: chamou o banco`);
  checa(await pag.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${nome}: rolagem lateral`);
  await ctx.close();
};

// ---------- 2. service worker ----------
{
  const s = await abrir({ viewport: { width: 1280, height: 900 } });
  const { pag, ctx } = s;
  const escopo = await pag.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  checa(escopo === BASE + "/", `service worker com escopo ${escopo}`);
  await pag.reload({ waitUntil: "load" });
  checa(await pag.evaluate(() => !!navigator.serviceWorker.controller), "service worker não controla a página depois de recarregar");
  const chaves = await pag.evaluate(async () => { const r = []; for (const k of await caches.keys()) for (const q of await (await caches.open(k)).keys()) r.push(new URL(q.url).pathname); return r; });
  checa(!chaves.some((p) => p === "/" || p.endsWith(".html")), `a página entrou no cache: ${chaves.join(", ")}`);
  // /pdv/ passa direto pela rede (não pelo service worker da raiz)
  const vistos = [];
  pag.on("response", (r) => { if (new URL(r.url()).pathname.startsWith("/pdv")) vistos.push(r.fromServiceWorker()); });
  await pag.goto(BASE + "/pdv/", { waitUntil: "load" });
  checa(vistos.length && vistos.every((x) => x === false), `/pdv/ respondido pelo service worker da raiz (${vistos})`);
  // versao.json e HEAD do verChecar vão à rede
  const v = await pag.evaluate(async () => (await fetch("/versao.json?v=" + Date.now(), { cache: "no-store" })).ok);
  checa(v, "versao.json não respondeu com o service worker ativo");
  // sem internet: tela própria, não o erro do navegador
  await pag.goto(BASE + "/", { waitUntil: "load" });
  DERRUBADO = true;
  await pag.reload({ waitUntil: "load" }).catch(() => {});
  const txt = await pag.evaluate(() => document.body.innerText);
  checa(/Sem internet agora/.test(txt), `sem internet não mostrou a tela do Flow: ${txt.slice(0, 80)}`);
  await pag.screenshot({ path: join(PRINTS, "pwa-offline-1280.png") });
  DERRUBADO = false;
  await ctx.close();
}

// ---------- 3. computador igual a antes ----------
{
  const s = await abrir({ viewport: { width: 1280, height: 900 } });
  const r = await s.pag.evaluate(() => ({ pad: getComputedStyle(document.body).paddingTop, main: document.querySelector(".main").getBoundingClientRect().height, h: innerHeight,
    faixa: getComputedStyle(document.body, "::before").height, dica: !!document.getElementById("pwaAviso"), pwa: document.documentElement.classList.contains("pwa") }));
  checa(r.pad === "0px", `1280: body ganhou padding (${r.pad})`);
  checa(Math.abs(r.main - r.h) < 1, `1280: .main com ${r.main}px numa janela de ${r.h}px`);
  checa(r.faixa === "0px", `1280: faixa da barra de status com ${r.faixa}`);
  await s.pag.evaluate(() => pwaDicaChecar());
  checa(!(await s.pag.$("#pwaAviso")), "1280: dica de instalar apareceu no computador");
  checa(!r.pwa, "1280: html.pwa no navegador comum");
  await fim("1280", s);
}

// ---------- 4. safe areas (iPhone com notch, simulado) ----------
for (const escuro of [false, true]) {
  const nome = `390 safe area${escuro ? " escuro" : ""}`;
  const s = await abrir({ ua: IPHONE, mobile: true });
  const r = await s.pag.evaluate(async (escuro) => {
    if (escuro) applyTheme("dark");
    const st = document.documentElement.style; st.setProperty("--sa-t", "47px"); st.setProperty("--sa-b", "34px");
    go("estoque"); await new Promise((r) => setTimeout(r, 300));
    const top = document.querySelector(".topbar").getBoundingClientRect().top;
    const faixa = getComputedStyle(document.body, "::before");
    toggleSidebar(true); await new Promise((r) => setTimeout(r, 400));
    const nav = document.querySelector("#sidebar .brand").getBoundingClientRect().top;
    const foot = getComputedStyle(document.querySelector(".side-foot")).paddingBottom;
    toggleSidebar(false); await new Promise((r) => setTimeout(r, 400));
    const cont = getComputedStyle(document.querySelector(".content")).paddingBottom;
    const setas = getComputedStyle(document.getElementById("rotaSetas")).display;
    return { top, fh: faixa.height, fbg: faixa.backgroundColor, nav, foot, cont, setas };
  }, escuro);
  checa(r.top >= 47, `${nome}: topo começa em ${r.top}px, embaixo da barra de status`);
  checa(r.fh === "47px", `${nome}: faixa da barra de status com ${r.fh}`);
  checa(r.fbg === (escuro ? "rgb(14, 22, 38)" : "rgb(29, 53, 115)"), `${nome}: faixa com cor ${r.fbg}`);
  checa(r.nav >= 47, `${nome}: menu lateral começa em ${r.nav}px`);
  checa(parseFloat(r.foot) >= 34 + 14, `${nome}: rodapé do menu sem a barra de gestos (${r.foot})`);
  checa(parseFloat(r.cont) >= 34 + 12, `${nome}: conteúdo sem a barra de gestos (${r.cont})`);
  checa(r.setas !== "none", `${nome}: setas ‹ › escondidas (sem barra do navegador não há como voltar)`);
  await s.pag.screenshot({ path: join(PRINTS, `pwa-safearea-390${escuro ? "-escuro" : ""}.png`) });
  await fim(nome, s);
}

// ---------- 5. dica no iPhone (Safari) ----------
{
  const s = await abrir({ ua: IPHONE, mobile: true });
  await s.pag.evaluate(() => pwaDicaChecar());
  const t = await s.pag.$eval("#pwaAviso", (e) => e.innerText).catch(() => "");
  checa(/Adicionar à Tela de Início/.test(t), `iPhone: dica não apareceu (${t})`);
  await s.pag.screenshot({ path: join(PRINTS, "pwa-dica-iphone-390.png") });
  await s.pag.click("#pwaAviso >> text=Entendi");
  checa(!(await s.pag.$("#pwaAviso")), "iPhone: Entendi não fechou a dica");
  await s.pag.evaluate(() => pwaDicaChecar());
  checa(!(await s.pag.$("#pwaAviso")), "iPhone: dica voltou depois de fechada");
  await fim("iPhone dica", s);
}
// Chrome no iPhone não instala: sem dica
{
  const s = await abrir({ ua: IPHONE.replace("Version/17.5", "CriOS/129.0") , mobile: true });
  await s.pag.evaluate(() => pwaDicaChecar());
  checa(!(await s.pag.$("#pwaAviso")), "Chrome no iPhone: dica apareceu (só o Safari instala)");
  await fim("iPhone Chrome", s);
}

// ---------- 6. dica no Android (pedido do Chrome) ----------
{
  const s = await abrir({ ua: ANDROID, mobile: true });
  await s.pag.evaluate(() => pwaDicaChecar());
  checa(!(await s.pag.$("#pwaAviso")), "Android: dica sem o pedido de instalação do Chrome");
  await s.pag.evaluate(() => { const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = () => { window.__pediu = true; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); dispatchEvent(e); pwaDicaChecar(); });
  const t = await s.pag.$eval("#pwaAviso", (e) => e.innerText).catch(() => "");
  checa(/Instalar/.test(t), `Android: dica não apareceu (${t})`);
  await s.pag.screenshot({ path: join(PRINTS, "pwa-dica-android-390.png") });
  await s.pag.click("#pwaAviso >> text=Instalar");
  checa(await s.pag.evaluate(() => window.__pediu === true), "Android: Instalar não chamou o pedido do Chrome");
  checa(!(await s.pag.$("#pwaAviso")), "Android: dica não fechou depois de Instalar");
  await fim("Android dica", s);
}

// ---------- 7. app instalado ----------
{
  const s = await abrir({ ua: IPHONE, mobile: true }, () => Object.defineProperty(navigator, "standalone", { get: () => true }));
  const r = await s.pag.evaluate(() => {
    pwaDicaChecar();
    const a = document.createElement("a"); a.href = "https://exemplo.invalid/"; a.textContent = "fora"; document.body.appendChild(a);
    const b = document.createElement("a"); b.href = "#/estoque"; b.textContent = "dentro"; document.body.appendChild(b);
    const para = (e) => e.preventDefault(); document.addEventListener("click", para);
    a.click(); b.click(); document.removeEventListener("click", para);
    return { pwa: document.documentElement.classList.contains("pwa"), dica: !!document.getElementById("pwaAviso"), fora: a.target, dentro: b.target };
  });
  checa(r.pwa, "instalado: html sem a classe pwa");
  checa(!r.dica, "instalado: dica de instalar apareceu no app já instalado");
  checa(r.fora === "_blank", "instalado: link para outro site não abre fora do app");
  checa(r.dentro === "", "instalado: link interno ganhou target");
  await fim("instalado", s);
}

await nav.close();
srv.close();
if (falhas.length) { console.error("FALHOU:\n- " + falhas.join("\n- ")); process.exit(1); }
console.log("pwa: ok (manifest, ícones, iOS, service worker, /pdv/, offline, safe areas, dica iPhone/Android, instalado, 1280 sem mudança)");
