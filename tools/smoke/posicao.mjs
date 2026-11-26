// Teste da aba Estoque → Posição (D15/D18): colunas "Última compra" e "Em pacotes",
// filtro de unidade e scorecards clicáveis. Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node posicao.mjs
//
// Monta na demonstração (só no navegador) um caso de cada: produto com embalagem,
// produto em kg que chegou numa nota em CX sem embalagem, e produto com preço subindo.
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
  const erros = [];
  const banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // caso de teste, só no navegador
  const ids = await pag.evaluate(() => {
    const ins = Object.values(DB.insumos).filter((i) => estEstocavel(i) && i.noEstoque !== false && i.uni === "kg");
    const [a, b, c] = ins;
    a.embNome = "PCT"; a.embQtd = 1; a.estoqueAtual = 12;
    delete b.embNome; b.embQtd = 0; b.estoqueAtual = 5;
    DB.lancamentos.push({ id: "t-sememb", data: hojeISO(), grupo: "CMV", valor: 50, insumoId: b.id, qtd: 2, uni: "CX" });
    c.cmp = 10; c.preco = 13; c.qtd = 1;
    estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueUniF = ""; estoqueKpiF = "";
    go("estoque");
    return { a: a.nome, b: b.nome, c: c.nome, cat: a.cat };
  });
  await pag.waitForTimeout(400);

  const ths = await pag.locator("table.est-pos thead th").allTextContents();
  checa(ths.some((t) => /Última compra/.test(t)), `${largura}: falta a coluna Última compra`);
  checa(ths.some((t) => /Em pacotes/.test(t)), `${largura}: falta a coluna Em pacotes`);
  const corpo = await pag.locator("#estoqueTbody").innerText();
  checa(/12 × 1 kg/.test(corpo), `${largura}: "12 × 1 kg" não aparece para ${ids.a}`);
  checa(/sem embalagem/.test(corpo), `${largura}: "sem embalagem" não aparece para ${ids.b}`);
  checa(await pag.locator("text=Total em kg").count() === 0, `${largura}: Total em kg apareceu sem categoria`);
  await pag.screenshot({ path: join(PRINTS, `posicao-${largura}.png`), fullPage: largura < 600 });

  // scorecard Sem embalagem filtra
  await pag.locator(".kpi", { hasText: "Sem embalagem" }).click();
  await pag.waitForTimeout(300);
  const linhas = await pag.locator("#estoqueTbody tr").count();
  checa(linhas === 1, `${largura}: filtro Sem embalagem deixou ${linhas} linha(s), esperado 1`);
  await pag.screenshot({ path: join(PRINTS, `posicao-sememb-${largura}.png`) });
  await pag.locator(".kpi", { hasText: "Sem embalagem" }).click();

  // scorecard Preço subiu filtra
  await pag.locator(".kpi", { hasText: "Preço subiu" }).click();
  await pag.waitForTimeout(300);
  const txtPreco = await pag.locator("#estoqueTbody").innerText();
  checa(txtPreco.includes(ids.c) && /▲/.test(txtPreco), `${largura}: Preço subiu não mostra ${ids.c} com ▲`);
  await pag.locator(".kpi", { hasText: "Preço subiu" }).click();

  // categoria escolhida → Total em kg aparece e filtra kg
  await pag.evaluate((cat) => { estoqueFiltro = cat; viewEstoque(); }, ids.cat);
  await pag.waitForTimeout(300);
  checa(await pag.locator(".kpi", { hasText: "Total em kg" }).count() === 1, `${largura}: Total em kg não apareceu com categoria`);
  await pag.locator(".kpi", { hasText: "Total em kg" }).click();
  await pag.waitForTimeout(300);
  const unis = await pag.evaluate(() => (window.EST_POS_FILT || []).map((x) => x.uni));
  checa(unis.length > 0 && unis.every((u) => u === "kg"), `${largura}: Total em kg não filtrou só kg`);
  await pag.screenshot({ path: join(PRINTS, `posicao-cat-kg-${largura}.png`) });

  // celular: sem rolagem horizontal da página
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
if (falhas.length) { console.error("posicao: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`posicao: ok (prints em ${PRINTS})`);
