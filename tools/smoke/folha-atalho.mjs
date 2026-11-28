// Teste do acesso à Folha a partir do Financeiro (issue #20, menu atualizado pela decisão D23): no menu, a Folha é
// subpágina do Financeiro (não é mais item solto no grupo FINANCEIRO) e continua como item em RH; na Visão Geral do Financeiro (e ao lado de botão que já existe),
// "Folha de pagamento" em #topActions abre a Folha; na Folha, "← Financeiro" volta para a Visão Geral e o texto
// diz que os lançamentos entram no DRE em Mão-de-Obra (link só para quem abre o DRE). Só aparece para quem tem a
// área Folha; quem tem só a Folha não ganha o Financeiro. Perfis pelo flowSim (mesmo login de membro). Roda contra o _site/, em 1280 e 390 px.
//
//   python3 ../preview_build.py && node folha-atalho.mjs
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
function checa(cond, msg) { if (!cond) falhas.push(msg); }

// menu: só os blocos que importam (FINANCEIRO = só o Financeiro, com a Folha como subpágina; RH continua com a Folha)
const blocoMenu = (pag, rot) => pag.evaluate((r) => { const out = []; let em = false;
  for (const e of document.querySelectorAll("#nav > *")) { if (e.classList.contains("lbl")) { em = e.textContent.trim() === r; continue; } if (em && e.dataset.route) out.push(e.dataset.route); }
  return out; }, rot);

async function abrir(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForTimeout(2500);
  return { ctx, pag, erros, banco };
}
const irFin = (pag, tab) => pag.evaluate((t) => { finTab = t; go("financeiro"); }, tab).then(() => pag.waitForTimeout(300));
const atalho = (pag, r) => pag.locator(`#topActions [data-atalho="${r}"]`);
const sobra = (pag) => pag.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const rota = (pag) => pag.evaluate(() => current);
async function visivelNaTela(pag, loc) {   // visível e dentro da janela, sem precisar rolar nada
  if (!(await loc.count()) || !(await loc.first().isVisible())) return false;
  const b = await loc.first().boundingBox(); const w = pag.viewportSize();
  return !!b && b.x >= 0 && b.x + b.width <= w.width + 1 && b.y >= 0 && b.y + b.height <= w.height;
}
async function fechar(s, rot) {
  checa(!s.erros.length, `${rot}: erro de JavaScript: ${s.erros[0]}`);
  checa(!s.banco.length, `${rot}: requisição ao Supabase: ${s.banco[0]}`);
  await s.ctx.close();
}

async function dono(largura) {
  const rot = `${largura} dono`;
  const s = await abrir(largura); const { pag } = s;
  const fin = await blocoMenu(pag, "FINANCEIRO"), rh = await blocoMenu(pag, "RH");
  checa(JSON.stringify(fin) === '["financeiro"]', `${rot}: o grupo FINANCEIRO do menu tem item solto além do Financeiro: ${JSON.stringify(fin)}`);
  checa(rh.includes("folha"), `${rot}: a Folha saiu do grupo RH: ${JSON.stringify(rh)}`);
  const icones = await pag.evaluate(() => [...document.querySelectorAll('#nav a[data-route="folha"]')].map((a) => (a.querySelector("svg") || {}).outerHTML));
  checa(icones.length === 1 && icones[0], `${rot}: a Folha do RH sem ícone ou repetida (${icones.length})`);
  const nomes = await pag.evaluate(() => [...document.querySelectorAll('#nav a[data-route="folha"], #nav [data-sub="financeiro:folha"]')].map((a) => a.textContent.trim()));
  checa(nomes.length === 2 && nomes.every((n) => n === "Folha de Pagamento"), `${rot}: a Folha não está em RH e dentro do Financeiro com o mesmo nome: ${JSON.stringify(nomes)}`);
  for (const tab of ["visao", "lanc"]) {
    await irFin(pag, tab);
    checa(await visivelNaTela(pag, atalho(pag, "folha")), `${rot}: no Financeiro (${tab}) o atalho "Folha de pagamento" não aparece na tela`);
  }
  // abas sem botão próprio não ganham uma linha a mais no topo só pelo atalho
  for (const tab of ["fluxo", "dre", "conc"]) {
    await irFin(pag, tab);
    checa(await atalho(pag, "folha").count() === 0, `${rot}: na aba ${tab} o atalho criou botão no topo`);
    if (largura < 600) checa(await pag.evaluate(() => getComputedStyle(document.getElementById("topActions")).display === "none"), `${rot}: na aba ${tab} o topo ganhou uma linha vazia`);
  }
  const ico = await pag.evaluate(() => { finTab = "visao"; go("financeiro"); const b = document.querySelector('#topActions [data-atalho="folha"] svg'), m = document.querySelector('#nav a[data-route="folha"] svg'); return !!b && !!m && b.innerHTML === m.innerHTML; });
  checa(ico, `${rot}: o botão e o menu não usam o mesmo ícone da Folha`);
  await irFin(pag, "visao");
  checa(await sobra(pag) <= 1, `${rot}: o Financeiro rola na horizontal (${await sobra(pag)}px)`);
  await pag.screenshot({ path: join(PRINTS, `folha-atalho-financeiro-${largura}.png`) });
  if (await atalho(pag, "folha").count()) await atalho(pag, "folha").click();
  await pag.waitForTimeout(400);
  checa(await rota(pag) === "folha" && (await pag.locator("#pageTitle").textContent()) === "Folha de Pagamento", `${rot}: o atalho não abriu a Folha (rota ${await rota(pag)})`);
  checa(await pag.evaluate(() => [...document.querySelectorAll('#nav a[data-route="folha"]')].every((a) => a.classList.contains("active")) && document.querySelector('#nav [data-sub="financeiro:folha"]').classList.contains("on")), `${rot}: a Folha do menu (RH e dentro do Financeiro) não ficou marcada`);
  checa(await visivelNaTela(pag, atalho(pag, "financeiro")), `${rot}: na Folha não há "← Financeiro" na tela`);
  const dre = await pag.locator("[data-folha-dre]").innerText().catch(() => "");
  checa(/DRE/.test(dre) && /Mão-de-Obra/.test(dre), `${rot}: a Folha não diz que os lançamentos entram no DRE em Mão-de-Obra (${dre})`);
  checa(await sobra(pag) <= 1, `${rot}: a Folha rola na horizontal (${await sobra(pag)}px)`);
  await pag.screenshot({ path: join(PRINTS, `folha-atalho-folha-${largura}.png`) });
  if (await atalho(pag, "financeiro").count()) await atalho(pag, "financeiro").click();
  await pag.waitForTimeout(400);
  checa(await pag.evaluate(() => current === "financeiro" && finTab === "visao"), `${rot}: "← Financeiro" não voltou à Visão Geral do Financeiro`);
  // mesmo vindo de outra aba, a volta é para a Visão Geral
  await irFin(pag, "fluxo"); await pag.evaluate(() => go("folha")); await pag.waitForTimeout(300);
  if (await atalho(pag, "financeiro").count()) await atalho(pag, "financeiro").click();
  await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => current === "financeiro" && finTab === "visao"), `${rot}: vindo do Fluxo, "← Financeiro" não abriu a Visão Geral`);
  // o link do DRE na Folha abre o DRE dentro do Financeiro
  await pag.evaluate(() => go("folha")); await pag.waitForTimeout(300);
  if (await pag.locator("[data-folha-dre] a").count()) await pag.locator("[data-folha-dre] a").click();
  await pag.waitForTimeout(400);
  checa(await pag.evaluate(() => current === "financeiro" && finTab === "dre"), `${rot}: o link "DRE do Financeiro" não abriu o DRE`);
  await fechar(s, rot);
}

async function membro(largura, perfil, rot, espera) {
  const s = await abrir(largura); const { pag } = s;
  const ok = await pag.evaluate((p) => flowSim.aplicar(p), perfil);
  await pag.waitForTimeout(600);
  checa(ok === true, `${largura} ${rot}: flowSim.aplicar não entrou no perfil`);
  if (espera.financeiro) {
    for (const tab of espera.restrito ? ["lanc"] : ["visao", "lanc"]) {
      await irFin(pag, tab);
      checa(await rota(pag) === "financeiro", `${largura} ${rot}: não abriu o Financeiro`);
      const tem = await atalho(pag, "folha").count();
      checa(espera.folha ? tem === 1 : tem === 0, `${largura} ${rot}: no Financeiro (${tab}) o atalho da Folha ${tem ? "aparece" : "não aparece"}`);
    }
    checa(await sobra(pag) <= 1, `${largura} ${rot}: o Financeiro rola na horizontal`);
  }
  // RH (item) + dentro do Financeiro (subpágina, só para quem também abre o Financeiro)
  const folhaMenu = await pag.evaluate(() => [...document.querySelectorAll('#nav a[data-route="folha"]')].filter((a) => getComputedStyle(a).display !== "none").length + document.querySelectorAll('#nav .nav-sub:not([hidden]) [data-sub="financeiro:folha"]').length);
  checa(folhaMenu === (espera.folha ? (espera.financeiro ? 2 : 1) : 0), `${largura} ${rot}: ${folhaMenu} item(ns) Folha no menu`);
  if (!espera.folha) {
    await pag.evaluate(() => go("folha")); await pag.waitForTimeout(300);
    checa(await rota(pag) !== "folha", `${largura} ${rot}: sem a área Folha, abriu a Folha`);
  } else {
    await pag.evaluate(() => go("folha")); await pag.waitForTimeout(300);
    checa(await rota(pag) === "folha", `${largura} ${rot}: com a área Folha, não abriu a Folha`);
    const volta = await atalho(pag, "financeiro").count();
    checa(espera.financeiro ? volta === 1 : volta === 0, `${largura} ${rot}: na Folha o "← Financeiro" ${volta ? "aparece" : "não aparece"}`);
    const linkDre = await pag.locator("[data-folha-dre] a").count();
    checa(espera.dre ? linkDre === 1 : linkDre === 0, `${largura} ${rot}: na Folha o DRE ${linkDre ? "é link" : "não é link"}`);
    checa(/Mão-de-Obra/.test(await pag.locator("[data-folha-dre]").innerText().catch(() => "")), `${largura} ${rot}: a Folha não diz que os salários entram em Mão-de-Obra`);
    if (espera.dre) {
      await pag.locator("[data-folha-dre] a").click(); await pag.waitForTimeout(300);
      checa(await pag.evaluate(() => (current === "financeiro" && finTab === "dre") || current === "dre"), `${largura} ${rot}: o link do DRE não abriu o DRE`);
      await pag.evaluate(() => go("folha")); await pag.waitForTimeout(300);
    } else if (espera.financeiro) {
      // sem DRE: go('dre') cairia em Lançamentos; por isso o texto fica sem link
      checa(await pag.evaluate(() => !podeAbrirDre()), `${largura} ${rot}: podeAbrirDre() liberou o DRE sem acesso`);
    }
    if (!espera.financeiro) {
      checa(await pag.evaluate(() => getComputedStyle(document.querySelector('#nav a[data-route="financeiro"]')).display === "none"), `${largura} ${rot}: o Financeiro apareceu no menu`);
      await pag.evaluate(() => go("financeiro")); await pag.waitForTimeout(300);
      checa(await rota(pag) === "folha", `${largura} ${rot}: só com a Folha, abriu o Financeiro (rota ${await rota(pag)})`);
    }
    checa(await sobra(pag) <= 1, `${largura} ${rot}: a Folha rola na horizontal`);
  }
  await fechar(s, `${largura} ${rot}`);
}

const SUB_FIN = { fin_nota: true, fin_pagto: true, fin_completo: true };
for (const largura of [1280, 390]) {
  await dono(largura);
  await membro(largura, { nivel: "financeiro" }, "nível Financeiro", { financeiro: true, folha: true, dre: true });
  await membro(largura, { nivel: "personalizado", permissoes: ["dashboard", "financeiro", "dre"], sub: SUB_FIN }, "financeiro sem folha", { financeiro: true, folha: false });
  await membro(largura, { nivel: "compras" }, "nível Compras", { financeiro: true, folha: false, restrito: true });
  await membro(largura, { nivel: "personalizado", permissoes: ["financeiro", "folha"], sub: { fin_nota: true, fin_completo: false } }, "financeiro restrito + folha, sem DRE", { financeiro: true, folha: true, restrito: true, dre: false });
  await membro(largura, { nivel: "personalizado", permissoes: ["financeiro", "folha", "dre"], sub: { fin_nota: true, fin_completo: false } }, "financeiro restrito + folha + DRE", { financeiro: true, folha: true, restrito: true, dre: true });
  await membro(largura, { nivel: "personalizado", permissoes: ["folha"], sub: {} }, "só folha", { financeiro: false, folha: true, dre: false });
}
await nav.close();
srv.close();
if (falhas.length) { console.error("folha-atalho: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`folha-atalho: ok (prints em ${PRINTS})`);
