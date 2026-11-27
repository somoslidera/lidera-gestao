// Teste das setas ‹ › e do caminho clicável no topo (Início › Estoque › Lista de Compras). Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node rotas-setas.mjs
//
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(AQUI, "../../_site");
const PRINTS = join(AQUI, "prints");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const arq = resolve(SITE, "." + p);
    if (!arq.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] || "application/octet-stream" });
    res.end(await readFile(arq));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const falhas = [];
const nav = await chromium.launch();
await mkdir(PRINTS, { recursive: true });

function checa(cond, msg) { if (!cond) falhas.push(msg); return !!cond; }
const espera = (pag, ms = 350) => pag.waitForTimeout(ms);
//   Confere: no Dashboard não há caminho e ‹ › ficam inativos; trocar de tela e de aba mostra Início › Área › Aba;
//   clicar no caminho abre a tela; ‹ volta (como o voltar do navegador) e › avança; ‹ fica inativo na 1ª tela;
//   a seta e o caminho não aparecem na tela de login; sem erro de JS e sem rolagem lateral no celular.

async function rodar(largura) {
  const L = `${largura}`;
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  ctx.setDefaultTimeout(8000);
  ctx.setDefaultNavigationTimeout(45000);
  const pag = await ctx.newPage();
  const erros = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("dialog", (d) => d.dismiss());
  const est = () => pag.evaluate(() => ({ c: current, et: estoqueTab, ft: finTab, h: location.hash,
    tr: (document.getElementById("rotaTrilha").innerText || "").replace(/\s*›\s*/g, " › ").replace(/\s+/g, " ").trim(),
    setas: getComputedStyle(document.getElementById("rotaSetas")).display !== "none",
    v: document.getElementById("rnVoltar").disabled, a: document.getElementById("rnAvancar").disabled }));
  const menu = async (rota) => {
    if (largura < 600) { await pag.locator(".menu-btn").click(); await espera(pag, 250); }
    await pag.locator(`#nav a[data-route="${rota}"]`).click(); await espera(pag);
  };
  const aba = async (t) => { await pag.locator("#view .pill-filter.tabs button", { hasText: t }).first().click(); await espera(pag); };
  const semRolagem = async (onde) => { if (largura >= 600) return;
    const s = await pag.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    checa(s <= 1, `${L} ${onde}: a página rola na horizontal (${s}px)`); };

  await pag.goto(BASE + "/", { waitUntil: "load" });
  await espera(pag, 2500);
  let e = await est();
  checa(e.c === "dashboard" && e.tr === "", `${L}: no Dashboard o caminho deveria estar vazio (${e.tr})`);
  checa(e.setas && e.v && e.a, `${L}: no início as setas deveriam aparecer inativas ${JSON.stringify(e)}`);

  await menu("estoque");
  await pag.evaluate(() => { if (estoqueTab !== "contagem") { estoqueTab = "contagem"; viewEstoque(); } });
  await espera(pag);
  await aba("Lista de Compras");
  e = await est();
  checa((largura < 600 ? e.tr === "Início › Lista de Compras" : /^Início › .+ › Lista de Compras$/.test(e.tr)), `${L}: caminho na Lista de Compras: "${e.tr}"`);
  checa(!e.v && e.a, `${L}: depois de navegar, ‹ ativo e › inativo ${JSON.stringify(e)}`);
  await pag.screenshot({ path: join(PRINTS, `rotas-setas-${largura}.png`) });
  await semRolagem("Lista de Compras");

  // ‹ volta para a Posição; › avança de novo para a Lista de Compras
  await pag.locator("#rnVoltar").click(); await espera(pag, 500);
  e = await est();
  checa(e.c === "estoque" && e.et === "contagem" && /› Posição$/.test(e.tr), `${L}: ‹ deveria voltar à Posição ${JSON.stringify(e)}`);
  checa(!e.a, `${L}: depois de voltar, › deveria ficar ativo`);
  await pag.locator("#rnAvancar").click(); await espera(pag, 500);
  e = await est();
  checa(e.et === "compras" && e.h === "#/estoque/lista-de-compras" && e.a, `${L}: › deveria avançar à Lista de Compras ${JSON.stringify(e)}`);

  // clicar na área do caminho abre a 1ª aba; clicar em Início abre o Dashboard
  if (largura >= 600) { await pag.locator("#rotaTrilha a", { hasText: "Estoque" }).click(); } else { await pag.locator("#view .pill-filter.tabs button", { hasText: "Posição" }).first().click(); } await espera(pag);
  e = await est();
  checa(e.c === "estoque" && e.et === "contagem" && e.h === "#/estoque/posicao", `${L}: clicar em Estoque no caminho ${JSON.stringify(e)}`);
  await menu("financeiro");
  await aba("DRE");
  e = await est();
  checa(e.tr === (largura < 600 ? "Início › DRE" : "Início › Financeiro › DRE"), `${L}: caminho no DRE: "${e.tr}"`);
  await semRolagem("DRE");
  if (largura >= 600) { await pag.locator("#rotaTrilha a", { hasText: "Financeiro" }).click(); } else { await pag.locator("#view .pill-filter.tabs button", { hasText: "Visão Geral" }).first().click(); } await espera(pag);
  e = await est();
  checa(e.ft === "visao" && e.h === "#/financeiro/visao-geral", `${L}: clicar em Financeiro no caminho ${JSON.stringify(e)}`);
  await pag.locator("#rotaTrilha a", { hasText: "Início" }).click(); await espera(pag);
  e = await est();
  checa(e.c === "dashboard" && e.h === "#/dashboard" && e.tr === "", `${L}: clicar em Início ${JSON.stringify(e)}`);

  // tela sem abas: Início › Fichas Técnicas
  await menu("fichas");
  e = await est();
  checa(/^Início › [^›]+$/.test(e.tr) && !/›.*›/.test(e.tr), `${L}: caminho em Fichas Técnicas: "${e.tr}"`);

  // ‹ até o início fica inativo e não sai do app
  for (let i = 0; i < 20; i++) { const d = await pag.evaluate(() => document.getElementById("rnVoltar").disabled); if (d) break; await pag.locator("#rnVoltar").click(); await espera(pag, 400); }
  e = await est();
  checa(e.v && pag.url().startsWith(BASE), `${L}: ‹ até o começo deveria parar no app ${pag.url()} ${JSON.stringify(e)}`);

  checa(!erros.length, `${L}: erro de JS: ${erros.join(" | ")}`);
  await ctx.close();
}

for (const largura of [1280, 390]) {
  try { await rodar(largura); } catch (err) { falhas.push(`${largura}: o teste parou: ${String(err).split("\n").slice(0, 4).join(" / ")}`); }
}
await nav.close(); srv.close();
if (falhas.length) { console.error("rotas-setas: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log("rotas-setas: ok (1280 e 390 px)");
