// Teste de "Subprodutos em lote" (Fichas Técnicas → Mais): começa com todos os preparados marcados,
// o dono desmarca o que é feito na hora, aplica com resumo. Só administrador vê o botão.
// Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node subprodutos.mjs
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

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [], dialogos = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => { dialogos.push(d.message()); d.accept(); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // cenário só no navegador: 3 preparados, um já subproduto com saldo
  const ids = await pag.evaluate(() => {
    const mk = (nome, estocavel, saldo) => { const id = uid(); DB.insumos[id] = { id, nome, cat: "Teste", tipo: "preparado", uni: "g", rendimento: 1000, comps: [], estocavel, estoqueAtual: saldo }; return id; };
    const a = mk("ZZ Molho base", false, 0), b = mk("ZZ Farofa da casa", false, 0), c = mk("ZZ Vinagrete", true, 350);
    MEMBRO_PERMS = null; MEMBRO_NIVEL = ""; go("fichas");
    return { a, b, c };
  });
  await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => document.querySelector("#topActions").innerHTML.includes("subprodLoteModal")), `${largura}: dono não vê o botão Subprodutos em lote`);

  // abre: todos marcados
  await pag.evaluate(() => { _slSel = null; _slQ = "ZZ "; subprodLoteModal(); });
  await pag.waitForTimeout(300);
  const marcados = await pag.locator(".modal input[type=checkbox]:checked").count();
  checa(marcados === 3, `${largura}: esperava 3 marcados ao abrir (filtro ZZ), veio ${marcados}`);
  await pag.screenshot({ path: join(PRINTS, `subprodutos-${largura}.png`), fullPage: false });

  // desmarca Vinagrete (feito na hora; tinha saldo) e aplica
  await pag.locator(".modal label", { hasText: "ZZ Vinagrete" }).locator("input").uncheck();
  // o demo tem outros preparados fora do filtro "ZZ": também nascem marcados, e o resumo avisa
  const fora = await pag.evaluate(() => subprodLotePreps().filter((i) => !i.nome.startsWith("ZZ ") && !i.estocavel).length);
  const resumo = await pag.locator("#sl_resumo").innerText();
  checa(resumo.includes(`${2 + fora} passa`), `${largura}: resumo inesperado: ${resumo}`);
  checa(!fora || resumo.includes(`${fora} dessas mudanças estão fora do filtro`), `${largura}: resumo não avisa ${fora} fora do filtro: ${resumo}`);
  await pag.locator(".modal-foot .btn-primary", { hasText: "Aplicar" }).click();
  await pag.waitForTimeout(300);
  const r = await pag.evaluate((ids) => ({ a: DB.insumos[ids.a].estocavel, b: DB.insumos[ids.b].estocavel, c: DB.insumos[ids.c].estocavel, pa: DB.insumos[ids.a].estoquePor }), ids);
  checa(r.a === true && r.b === true, `${largura}: os marcados não viraram subproduto`);
  checa(r.c === false, `${largura}: o desmarcado continuou subproduto`);
  checa(r.pa && typeof r.pa === "object", `${largura}: subproduto novo sem estoquePor`);
  checa(dialogos.length === 1 && dialogos[0].includes(`${2 + fora} preparado`) && (!fora || dialogos[0].includes(`${fora} dessas mudanças`)) && /1 com saldo/.test(dialogos[0]) && /ZZ Vinagrete/.test(dialogos[0]), `${largura}: confirmação inesperada: ${dialogos[0]}`);

  // cancelar no confirm não muda nada
  await pag.evaluate(() => { _slSel = null; _slQ = "ZZ "; subprodLoteModal(); });
  await pag.waitForTimeout(200);
  pag.removeAllListeners("dialog"); pag.on("dialog", (d) => d.dismiss());
  await pag.locator(".modal label", { hasText: "ZZ Molho base" }).locator("input").uncheck();
  await pag.locator(".modal-foot .btn-primary", { hasText: "Aplicar" }).click();
  await pag.waitForTimeout(200);
  checa(await pag.evaluate((id) => DB.insumos[id].estocavel, ids.a) === true, `${largura}: cancelar a confirmação mudou o dado`);
  await pag.evaluate(() => { _slSel = null; closeModal(); });

  // gerente não vê o botão e não consegue abrir
  const g = await pag.evaluate(() => { MEMBRO_PERMS = ["fichas", "estoque"]; MEMBRO_NIVEL = "gerente"; go("fichas"); const btn = document.querySelector("#topActions").innerHTML.includes("subprodLoteModal"); subprodLoteModal(); const abriu = !!document.querySelector("#sl_resumo"); MEMBRO_PERMS = null; MEMBRO_NIVEL = ""; return { btn, abriu }; });
  checa(!g.btn && !g.abriu, `${largura}: gerente vê ou abre o lote (${JSON.stringify(g)})`);

  if (largura < 600) {
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checa(sobra <= 1, `${largura}: a página rola na horizontal (${sobra}px)`);
  }
  checa(!erros.length, `${largura}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${largura}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

await rodar(1280);
await rodar(390);
await nav.close();
srv.close();
if (falhas.length) { console.error("subprodutos: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`subprodutos: ok (prints em ${PRINTS})`);
