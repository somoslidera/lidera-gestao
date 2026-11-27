// Teste do tema visual opcional (#45, protótipo): Configurações → Aparência.
//  1. Seletor DESLIGADO (padrão): o Flow fica idêntico à main. Compara, contra um _site montado da main
//     (merge-base), os estilos computados de todos os elementos e o print, no Dashboard, Posição e
//     Contagem física, em 1280 e 390 px, claro e escuro. Também confere que o body não ganha data-tema
//     e que nenhuma fonte extra é carregada.
//  2. Cada direção LIGADA (gala, linho, marinho), nas mesmas telas (e na janela de Nova contagem), em
//     1280 e 390 px, claro e escuro: sem rolagem lateral, sem erro de JavaScript, número do KPI na fonte
//     nova com algarismos tabulares e sem corte (valor na casa dos milhões), contraste mínimo do texto
//     (4,5:1; 3:1 para texto grande), medido nos pixels do print.
//  3. O seletor em Configurações liga, troca e desliga o tema, e a escolha fica no aparelho após recarregar.
// Prints de cada direção × tela × claro/escuro em prints/tema-*.png.
//
//   python3 ../preview_build.py && node tema.mjs
//   (FLOW_TEMA_BASE=<ref> troca a referência da parte 1; padrão: merge-base com origin/main)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../..");
const SITE = join(RAIZ, "_site");
const PRINTS = join(AQUI, "prints");
const TEMAS = ["gala", "linho", "marinho"];
const MODOS = ["light", "dark"];
const LARGURAS = [1280, 390];
const TELAS = ["dashboard", "posicao", "contar"];
const falhas = [];
const avisos = [];
const checa = (cond, msg) => { if (!cond) falhas.push(msg); };

// ---------- servidores (_site desta branch e _site da main) ----------
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
async function servir(raiz) {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const arq = resolve(raiz, "." + p);
      if (!arq.startsWith(raiz)) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] || "application/octet-stream" });
      res.end(await readFile(arq));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  return { srv, url: `http://127.0.0.1:${srv.address().port}` };
}
const git = (...a) => execFileSync("git", ["-C", RAIZ, ...a], { encoding: "utf8" }).trim();
let ref = process.env.FLOW_TEMA_BASE;
if (!ref) { try { ref = git("merge-base", "HEAD", "origin/main"); } catch { ref = "origin/main"; } }
const TMP = await mkdtemp(join(tmpdir(), "flow-tema-"));
const tar = execFileSync("git", ["-C", RAIZ, "archive", ref, "index.html", "pdv", "versao.json", "tools/preview_build.py", "tools/preview_simulacao.js"], { maxBuffer: 256 * 1024 * 1024 });
execFileSync("tar", ["-x", "-C", TMP], { input: tar });
execFileSync("python3", [join(TMP, "tools/preview_build.py"), "--out", join(TMP, "_site")], { stdio: "ignore" });
const atual = await servir(SITE);
const base = await servir(join(TMP, "_site"));

const nav = await chromium.launch();
await mkdir(PRINTS, { recursive: true });

async function abrir(url, largura, modo, tema) {
  const movel = largura < 600;
  const ctx = await nav.newContext({ viewport: { width: largura, height: movel ? 844 : 900 }, ...(movel ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([m, t]) => { try { localStorage.setItem("flow_theme", m); if (t) localStorage.setItem("flow_tema", t); } catch (e) {} }, [modo, tema || ""]);
  const pag = await ctx.newPage();
  const erros = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  await pag.goto(url + "/", { waitUntil: "load" });
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  await pag.evaluate(() => document.fonts.ready);
  await pag.waitForTimeout(400);
  return { ctx, pag, erros };
}
// abre a tela; a faixa PREVIEW e o botão Simular (só do preview) ficam escondidos para o print e o contraste
async function irPara(pag, tela) {
  await pag.evaluate((t) => {
    if (document.querySelector(".modal-overlay")) closeModal();
    if (t === "dashboard") go("dashboard");
    else { go("estoque"); estoqueTab = t === "posicao" ? "contagem" : "contar"; viewEstoque(); if (t === "contar-janela") estContagemNova(); }
    document.documentElement.style.scrollBehavior = "auto";
    ["flowPreviewFaixa", "fsimBtn"].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = "hidden"; });
  }, tela);
  await pag.waitForTimeout(500);
  await pag.evaluate(() => document.fonts.ready);
  await pag.waitForTimeout(150);
}

// ---------- 1. desligado = igual à main ----------
const PROPS = ["color", "background-color", "background-image", "font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "line-height", "padding", "margin", "border-top", "border-bottom", "border-left", "border-right", "border-radius", "box-shadow", "width", "height", "display", "opacity", "backdrop-filter", "font-variant-numeric"];
async function retrato(pag) {
  return pag.evaluate((props) => {
    const els = [document.body, ...document.body.querySelectorAll("*")].filter((e) => !["SCRIPT", "STYLE", "LINK"].includes(e.tagName) && !e.closest("#fsimPainel"));
    return {
      tema: document.body.getAttribute("data-tema"),
      fontes: [...document.querySelectorAll('link[id^="temaFonte"]')].length,
      linhas: els.map((e) => { const cs = getComputedStyle(e); return e.tagName + (e.id && !e.closest("svg") ? "#" + e.id : "") + "|" + props.map((p) => cs.getPropertyValue(p)).join("|"); }),
    };
  }, PROPS);
}
let comparacoes = 0;
for (const largura of LARGURAS) for (const modo of MODOS) {
  const a = await abrir(atual.url, largura, modo, "");
  const b = await abrir(base.url, largura, modo, "");
  for (const tela of TELAS) {
    await irPara(a.pag, tela); await irPara(b.pag, tela);
    const ra = await retrato(a.pag), rb = await retrato(b.pag);
    const nome = `desligado ${largura} ${modo} ${tela}`;
    checa(ra.tema === null, `${nome}: body ganhou data-tema="${ra.tema}"`);
    checa(ra.fontes === 0, `${nome}: carregou fonte do tema sem ninguém escolher`);
    checa(ra.linhas.length === rb.linhas.length, `${nome}: ${ra.linhas.length} elementos aqui, ${rb.linhas.length} na main`);
    const i = ra.linhas.findIndex((l, k) => l !== rb.linhas[k]);
    checa(i < 0, `${nome}: estilo diferente da main no elemento ${i}:\n     aqui: ${ra.linhas[i]}\n     main: ${rb.linhas[i]}`);
    const pa = await a.pag.screenshot(), pb = await b.pag.screenshot();
    checa(pa.equals(pb), `${nome}: o print difere da main`);
    comparacoes++;
  }
  checa(!a.erros.length, `desligado ${largura} ${modo}: erro de JavaScript: ${a.erros.join(" | ")}`);
  await a.ctx.close(); await b.ctx.close();
}

// ---------- 2. cada direção ligada ----------
// mede contraste nos pixels do print: fundo = cor que mais aparece em 4 pontos ao redor do texto
async function contraste(ctx, pag, nome) {
  const itens = await pag.evaluate(() => {
    const vis = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 1) return false; } return true; };
    const out = [];
    const raizes = [document.getElementById("view"), document.querySelector(".topbar"), document.querySelector(".modal")].filter(Boolean);
    const W = innerWidth, H = innerHeight;
    raizes.forEach((r) => r.querySelectorAll("*").forEach((e) => {
      if (e.closest("svg,select,option,textarea,.tc-vazio")) return;
      const tn = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn.length || !vis(e)) return;
      const rg = document.createRange(); rg.selectNodeContents(tn[0]);
      const q = rg.getClientRects()[0]; if (!q || q.width < 2) return;
      if (q.left < 6 || q.top < 4 || q.right > W - 6 || q.bottom > H - 4) return;
      const cs = getComputedStyle(e);
      // texto por cima de outro elemento posicionado (ex.: rótulo sobre gráfico) fica de fora
      const topo = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      if (!topo || !(topo === e || e.contains(topo))) return;
      out.push({ txt: tn[0].textContent.trim().slice(0, 40), cor: cs.color, fs: parseFloat(cs.fontSize), fw: parseInt(cs.fontWeight) || 400,
        pts: [[q.left - 4, q.top + q.height / 2], [q.right + 4, q.top + q.height / 2], [q.left + q.width / 2, q.top - 2], [q.left + q.width / 2, q.bottom + 2],
          [q.left - 4, q.top + 2], [q.left - 4, q.bottom - 2], [q.right + 4, q.top + 2], [q.right + 4, q.bottom - 2], [q.left + q.width / 4, q.top - 2], [q.right - q.width / 4, q.bottom + 2]] });
    }));
    return out;
  });
  const png = (await pag.screenshot()).toString("base64");
  const aux = await ctx.newPage();
  const vw = await pag.evaluate(() => innerWidth);
  const res = await aux.evaluate(async ({ png, itens, vw }) => {
    const img = new Image(); img.src = "data:image/png;base64," + png; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const k = img.width / vw || 1;
    const px = (x, y) => { const d = g.getImageData(Math.max(0, Math.min(img.width - 1, Math.round(x * k))), Math.max(0, Math.min(img.height - 1, Math.round(y * k))), 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
    const rgb = (s) => { const m = s.match(/[\d.]+/g).map(Number); return m; };
    const ruins = [];
    for (const it of itens) {
      const ps = it.pts.map(([x, y]) => px(x, y));
      const perto = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
      let fundo = ps[0], melhor = -1;
      ps.forEach((p) => { const n = ps.filter((q) => perto(p, q)).length; if (n > melhor) { melhor = n; fundo = p; } });
      const m = rgb(it.cor); let cor = m.slice(0, 3); const al = m.length > 3 ? m[3] : 1;
      if (al < 1) cor = cor.map((v, i) => v * al + fundo[i] * (1 - al));
      const l1 = lum(cor), l2 = lum(fundo), cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const grande = it.fs >= 24 || (it.fs >= 18.66 && it.fw >= 700);
      if (cr < (grande ? 3 : 4.5)) ruins.push(`"${it.txt}" ${cr.toFixed(2)}:1 (${it.cor} sobre rgb(${fundo.join(",")}))`);
    }
    return { n: itens.length, ruins };
  }, { png, itens, vw });
  await aux.close();
  checa(res.n > 5, `${nome}: contraste sem texto para medir (${res.n})`);
  checa(!res.ruins.length, `${nome}: contraste baixo em ${res.ruins.length} texto(s): ${res.ruins.slice(0, 6).join("; ")}`);
  return res.n;
}
async function kpi(pag, nome, tema) {
  await pag.evaluate(async (tema) => { const fam = { gala: "Geist", linho: "Figtree", marinho: "Geist" }[tema]; try { await document.fonts.load(`600 20px "${fam}"`, "0123"); } catch (e) {} kpiFit(document.getElementById("view")); }, tema);
  const r = await pag.evaluate((tema) => {
    const vals = [...document.querySelectorAll("#view .kpi .k-val, #view .dsh-kpi-val")].filter((e) => e.offsetParent);
    if (!vals.length) return { n: 0 };
    const cs = getComputedStyle(vals[0]);
    const fonte = cs.fontFamily, tab = cs.fontVariantNumeric;
    const fam = { gala: "Geist", linho: "Figtree", marinho: "Geist" }[tema];
    const carregada = document.fonts.check(`600 20px "${fam}"`, "0123456789");
    const textos = ["R$ 9.999.999,99", "R$ 13.860,00", "-R$ 276.988,23"];
    const orig = vals.map((e) => e.textContent);
    let cortados = 0;
    for (const txt of textos) {
      vals.forEach((e) => { e.textContent = txt; });
      kpiFit(document.getElementById("view"));
      cortados += vals.filter((e) => {
        const k = e.closest(".kpi,.dsh-kpi").getBoundingClientRect(), v = e.getBoundingClientRect();
        return e.scrollWidth > e.clientWidth || v.right > k.right + 0.5 || parseFloat(getComputedStyle(e).fontSize) < 12;
      }).length;
    }
    vals.forEach((e, i) => { e.textContent = orig[i]; }); kpiFit(document.getElementById("view"));
    return { n: vals.length, cortados, fonte, tab, fam, carregada };
  }, tema);
  if (!r.n) return;
  checa(r.fonte.startsWith(`"${r.fam}"`) || r.fonte.startsWith(r.fam), `${nome}: número do KPI não está na fonte do tema (${r.fonte})`);
  checa(/tabular-nums/.test(r.tab), `${nome}: número do KPI sem algarismos tabulares (${r.tab})`);
  if (!r.carregada) avisos.push(`${nome}: a fonte ${r.fam} não carregou (sem internet?); medido com a fonte reserva`);
  checa(r.cortados === 0, `${nome}: ${r.cortados} valor(es) de KPI cortado(s) com valor longo`);
}
let medidos = 0, telasLigadas = 0;
for (const tema of TEMAS) for (const modo of MODOS) for (const largura of LARGURAS) {
  const { ctx, pag, erros } = await abrir(atual.url, largura, modo, tema);
  for (const tela of [...TELAS, "contar-janela"]) {
    await irPara(pag, tela);
    const nome = `${tema} ${modo} ${largura} ${tela}`;
    const est = await pag.evaluate(() => ({ tema: document.body.getAttribute("data-tema"), dark: document.body.classList.contains("dark"),
      lateral: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    checa(est.tema === tema, `${nome}: body sem data-tema="${tema}" (${est.tema})`);
    checa(est.dark === (modo === "dark"), `${nome}: modo claro/escuro trocado`);
    checa(est.lateral <= 0, `${nome}: rolagem lateral de ${est.lateral}px`);
    await pag.screenshot({ path: join(PRINTS, `tema-${tema}-${modo === "dark" ? "escuro" : "claro"}-${tela}-${largura}.png`) });
    medidos += await contraste(ctx, pag, nome);
    if (tela !== "contar-janela") await kpi(pag, nome, tema);
    telasLigadas++;
  }
  checa(!erros.length, `${tema} ${modo} ${largura}: erro de JavaScript: ${erros.join(" | ")}`);
  await ctx.close();
}

// ---------- 3. o seletor em Configurações ----------
for (const largura of LARGURAS) {
  const { ctx, pag, erros } = await abrir(atual.url, largura, "light", "");
  await pag.evaluate(() => { go("conta"); contaTab = "aparencia"; viewConta(); });
  await pag.waitForTimeout(300);
  const ops = await pag.locator(".tm-op").count();
  checa(ops === 4, `seletor ${largura}: ${ops} opções (esperado Atual + 3 direções)`);
  checa(await pag.locator(".tm-op.on").first().innerText().then((t) => t.includes("Atual")), `seletor ${largura}: "Atual" não vem marcado por padrão`);
  await pag.locator(".tm-op", { hasText: "Noite de gala" }).click();
  checa(await pag.evaluate(() => document.body.dataset.tema === "gala" && localStorage.getItem("flow_tema") === "gala"), `seletor ${largura}: escolher Noite de gala não ligou o tema`);
  await pag.screenshot({ path: join(PRINTS, `tema-seletor-${largura}.png`) });
  await pag.reload({ waitUntil: "load" });
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  checa(await pag.evaluate(() => document.body.dataset.tema === "gala"), `seletor ${largura}: a escolha não ficou após recarregar`);
  await pag.evaluate(() => { go("conta"); contaTab = "aparencia"; viewConta(); });
  await pag.locator(".tm-op", { hasText: "Marinho moderno" }).click();
  checa(await pag.evaluate(() => document.body.dataset.tema === "marinho"), `seletor ${largura}: trocar para Marinho moderno não funcionou`);
  await pag.locator(".tm-op", { hasText: "Atual" }).click();
  checa(await pag.evaluate(() => !document.body.hasAttribute("data-tema") && localStorage.getItem("flow_tema") === null), `seletor ${largura}: voltar para Atual não desligou o tema`);
  const lat = await pag.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  checa(lat <= 0, `seletor ${largura}: rolagem lateral de ${lat}px`);
  checa(!erros.length, `seletor ${largura}: erro de JavaScript: ${erros.join(" | ")}`);
  await ctx.close();
}

await nav.close(); atual.srv.close(); base.srv.close();
await rm(TMP, { recursive: true, force: true });
avisos.forEach((a) => console.log("aviso: " + a));
if (falhas.length) { console.log(`tema: FALHOU (${falhas.length})\n - ` + falhas.join("\n - ")); process.exit(1); }
console.log(`tema: ok (desligado = main em ${comparacoes} telas; ${telasLigadas} telas com tema, ${medidos} textos com contraste medido; prints em ${PRINTS})`);
