// Teste da aba Estoque → Posição (D15/D18): colunas "Essencial" (padrão) e "Completa", "Última compra"
// e "Em pacotes", filtro de unidade e scorecards clicáveis. Roda contra o _site/ (sem banco), em 1280 e 390 px.
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
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForTimeout(2500);

  // caso de teste, só no navegador
  const ids = await pag.evaluate(() => {
    const ins = Object.values(DB.insumos).filter((i) => estEstocavel(i) && i.noEstoque !== false && i.uni === "kg");
    const [a, b, c, d] = ins;
    const salvos = [a, b, c, d].map((i) => ({ id: i.id, nome: i.nome }));   // para achar os mesmos produtos depois de recarregar
    a.embNome = "PCT"; a.embQtd = 1; a.estoqueAtual = 12;
    // a: entrou em PCT com 1 kg por pacote e o nome não diz 1 kg → "confira?"
    DB.lancamentos.push({ id: "t-um", data: hojeISO(), grupo: "CMV", valor: 30, insumoId: a.id, qtd: 3, uni: "PCT" });
    // d: mesmo caso, mas o nome diz 1KG → não entra
    d.nome = d.nome + " 1KG"; d.embNome = "PCT"; d.embQtd = 1;
    DB.lancamentos.push({ id: "t-um-ok", data: hojeISO(), grupo: "CMV", valor: 30, insumoId: d.id, qtd: 3, uni: "PCT" });
    delete b.embNome; b.embQtd = 0; b.estoqueAtual = 5;
    DB.lancamentos.push({ id: "t-sememb", data: hojeISO(), grupo: "CMV", valor: 50, insumoId: b.id, qtd: 2, uni: "CX" });
    c.cmp = 10; c.preco = 13; c.qtd = 1;
    estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueUniF = ""; estoqueKpiF = "";
    go("estoque");
    return { a: a.nome, b: b.nome, c: c.nome, d: d.nome, cat: a.cat, salvos, fornC: insFornAtual(c) };
  });
  await pag.waitForTimeout(400);

  const cab = () => pag.evaluate(() => [...document.querySelectorAll("table.est-pos thead th")].map((th) => th.textContent.replace(/[↑↓]/g, "").trim()));
  const SO_COMPLETA = ["Categoria", "Subcategoria", "Fornecedor", "Custo médio", "Última compra", "Custo por porção"];
  const temSub = await pag.evaluate(() => estSubprodutos().length > 0);
  const larguraTabela = () => pag.evaluate(() => document.querySelector("table.est-pos").scrollWidth);
  // no celular a tabela vira cartões e o cabeçalho fica escondido: clica pelo DOM (mesmo onclick do th)
  const clicaTh = (rot) => pag.evaluate((r) => [...document.querySelectorAll("table.est-pos thead th")].find((th) => th.textContent.trim().startsWith(r)).click(), rot);
  const colsOn = () => pag.evaluate(() => (document.querySelector("#estPosCols button.on") || {}).textContent || "");

  // Essencial é o padrão: sem as 6 colunas, com "Compra" logo depois de Crítico
  let ths = await cab();
  checa(await colsOn() === "Essencial", `${largura}: a visão padrão não é Essencial (${await colsOn()})`);
  SO_COMPLETA.forEach((c) => checa(!ths.includes(c), `${largura}: Essencial mostra a coluna ${c}`));
  checa(!ths.includes("Compra"), `${largura}: coluna Compra aparece sem nenhum item marcado como comprado`);
  checa(ths.includes("Em pacotes") && ths.includes("Cobertura"), `${largura}: Essencial perdeu Em pacotes ou Cobertura`);
  const lEss = await larguraTabela();
  await pag.screenshot({ path: join(PRINTS, `posicao-essencial-${largura}.png`), fullPage: largura < 600 });
  if (largura < 600) {
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checa(sobra <= 1, `${largura} Essencial: a página rola na horizontal (${sobra}px)`);
  }
  // ordenar e buscar na Essencial
  await clicaTh("Insumo");
  await pag.waitForTimeout(200);
  let nomesOrd = await pag.evaluate(() => (window.EST_POS_FILT || []).map((x) => x.nome.toLowerCase()));
  checa(nomesOrd.length > 2 && nomesOrd.every((n, i) => !i || nomesOrd[i - 1] <= n), `${largura}: ordenar por Insumo não ordenou na Essencial`);
  await clicaTh("Crítico");
  await pag.waitForTimeout(200);
  checa(await pag.evaluate(() => SORT.estoque.k === "crit" && (window.EST_POS_FILT || []).every((x, i, L) => !i || (L[i - 1].crit || 0) <= (x.crit || 0))), `${largura}: ordenar por Crítico não ordenou`);
  await pag.locator("#estBusca").fill(ids.c);
  await pag.waitForTimeout(200);
  let vis = await pag.evaluate(() => [...document.querySelectorAll("#estoqueTbody tr")].filter((tr) => tr.style.display !== "none").map((tr) => tr.children[0].innerText));
  checa(vis.length >= 1 && vis.every((t) => t.includes(ids.c)), `${largura}: busca na Essencial mostrou ${JSON.stringify(vis)}`);
  // busca por fornecedor, que a Essencial não mostra (mesmo critério da impressão)
  if (ids.fornC && ids.fornC !== "Sem fornecedor") {
    await pag.locator("#estBusca").fill(ids.fornC);
    await pag.waitForTimeout(200);
    vis = await pag.evaluate(() => [...document.querySelectorAll("#estoqueTbody tr")].filter((tr) => tr.style.display !== "none").map((tr) => tr.children[0].innerText));
    checa(vis.some((t) => t.includes(ids.c)), `${largura}: busca por fornecedor (${ids.fornC}) na Essencial não achou ${ids.c}`);
  } else checa(false, `${largura}: o produto de teste ${ids.c} não tem fornecedor para testar a busca`);
  await pag.locator("#estBusca").fill(ids.cat);
  await pag.waitForTimeout(200);
  checa(await pag.evaluate(() => [...document.querySelectorAll("#estoqueTbody tr")].some((tr) => tr.style.display !== "none")), `${largura}: busca por categoria (${ids.cat}) na Essencial não achou nada`);
  await pag.locator("#estBusca").fill("");
  await pag.evaluate(() => { buscaEst = ""; filtrarLinhas(document.getElementById("estBusca"), "#estoqueTbody"); });
  // coluna Compra só com marca ativa, logo depois de Crítico
  const cmp = await pag.evaluate((id) => { const i = DB.insumos[id]; i.compra = { status: "comprado", qtd: 1, fornecedor: "", previsao: "", em: new Date().toISOString(), por: "teste" }; viewEstoque();
    const t = [...document.querySelectorAll("table.est-pos thead th")].map((th) => th.textContent.replace(/[↑↓]/g, "").trim()); delete i.compra; viewEstoque(); return t; }, ids.salvos[0].id);
  checa(cmp[cmp.indexOf("Crítico") + 1] === "Compra", `${largura}: com item comprado, Compra não vem logo depois de Crítico: ${JSON.stringify(cmp)}`);

  // Completa: tudo de volta
  await pag.locator('#estPosCols button[data-cols="completa"]').click();
  await pag.waitForTimeout(300);
  ths = await cab();
  SO_COMPLETA.filter((c) => c !== "Custo por porção" || temSub).forEach((c) => checa(ths.includes(c), `${largura}: Completa sem a coluna ${c}`));
  checa(ths.includes("Em pacotes"), `${largura}: falta a coluna Em pacotes`);
  const lComp = await larguraTabela();
  if (largura >= 600) checa(lEss < lComp, `${largura}: Essencial (${lEss}px) não ficou mais estreita que a Completa (${lComp}px)`);
  console.log(`  ${largura}: largura da tabela Essencial ${lEss}px · Completa ${lComp}px`);
  await pag.screenshot({ path: join(PRINTS, `posicao-completa-${largura}.png`), fullPage: largura < 600 });
  // ordenar por Fornecedor e buscar na Completa
  await clicaTh("Fornecedor");
  await pag.waitForTimeout(200);
  checa(await pag.evaluate(() => SORT.estoque.k === "fornecedor"), `${largura}: ordenar por Fornecedor não pegou na Completa`);
  await pag.locator("#estBusca").fill(ids.c);
  await pag.waitForTimeout(200);
  vis = await pag.evaluate(() => [...document.querySelectorAll("#estoqueTbody tr")].filter((tr) => tr.style.display !== "none").map((tr) => tr.children[0].innerText));
  checa(vis.length >= 1 && vis.every((t) => t.includes(ids.c)), `${largura}: busca na Completa mostrou ${JSON.stringify(vis)}`);
  await pag.locator("#estBusca").fill("");
  await pag.evaluate(() => { buscaEst = ""; });
  if (largura < 600) {
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checa(sobra <= 1, `${largura} Completa: a página rola na horizontal (${sobra}px)`);
  }
  // impressão da Posição continua saindo (relatório próprio, não depende das colunas da tela)
  const impr = await pag.evaluate(() => { const p = window.print; let ok = false; window.print = () => { ok = /Posição do estoque/.test((document.getElementById("printArea") || {}).textContent || ""); }; try { imprimirTela(); } finally { window.print = p; } return ok; });
  checa(impr, `${largura}: a impressão da Posição não montou o relatório`);

  // quem não vê valores: Completa sem as colunas de custo
  const semVal = await pag.evaluate(() => {
    MEMBRO_PERMS = ["estoque"]; MEMBRO_SUB = { posicao: true, valores: false };
    viewEstoque();
    const t = [...document.querySelectorAll("table.est-pos thead th")].map((th) => th.textContent.replace(/[↑↓]/g, "").trim());
    MEMBRO_PERMS = null; MEMBRO_SUB = null; viewEstoque();
    return t;
  });
  checa(semVal.includes("Fornecedor") && !semVal.includes("Custo médio") && !semVal.includes("Última compra") && !semVal.includes("Custo por porção"), `${largura}: sem valores, a Completa mostrou ${JSON.stringify(semVal)}`);

  // a escolha é por usuário: outra pessoa no mesmo aparelho começa na Essencial
  const outro = await pag.evaluate(() => { const n = DONO_UID; DONO_UID = "usuario-de-teste"; viewEstoque(); const on = document.querySelector("#estPosCols button.on").textContent; DONO_UID = n; viewEstoque(); return on; });
  checa(outro === "Essencial", `${largura}: outro usuário herdou a visão ${outro}`);

  // recarregar a página lembra a Completa
  await pag.reload({ waitUntil: "load" });
  await pag.waitForTimeout(2500);
  await pag.evaluate(() => { estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueUniF = ""; estoqueKpiF = ""; go("estoque"); });
  await pag.waitForTimeout(400);
  checa(await colsOn() === "Completa" && (await cab()).includes("Categoria"), `${largura}: depois de recarregar, a escolha Completa não foi lembrada`);
  // localStorage bloqueado: não quebra, troca vale na sessão
  const bloq = await pag.evaluate(() => { const g = Storage.prototype.getItem, s = Storage.prototype.setItem; Storage.prototype.getItem = () => { throw new Error("bloqueado"); }; Storage.prototype.setItem = () => { throw new Error("bloqueado"); };
    try { estPosColsSet("essencial"); const a = document.querySelector("#estPosCols button.on").textContent; estPosColsSet("completa"); return a + "/" + document.querySelector("#estPosCols button.on").textContent; } finally { Storage.prototype.getItem = g; Storage.prototype.setItem = s; } });
  checa(bloq === "Essencial/Completa", `${largura}: com o armazenamento bloqueado a troca deu ${bloq}`);
  // voltar para Essencial com a ordenação numa coluna que continua: mantém a ordem
  await pag.evaluate(() => { SORT.estoque = { k: "crit", d: -1 }; });
  await pag.locator('#estPosCols button[data-cols="essencial"]').click();
  await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => SORT.estoque.k === "crit" && SORT.estoque.d === -1), `${largura}: Essencial trocou a ordem por Crítico, que continua visível`);
  // ordenação numa coluna que some: volta à ordem padrão
  await pag.locator('#estPosCols button[data-cols="completa"]').click();
  await pag.waitForTimeout(200);
  await pag.evaluate(() => { SORT.estoque = { k: "fornecedor", d: 1 }; });
  await pag.locator('#estPosCols button[data-cols="essencial"]').click();
  await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => SORT.estoque.k === "comprar"), `${largura}: Essencial ficou ordenada por coluna escondida`);
  // refaz o caso de teste depois do recarregamento (a demonstração não salvou as mudanças)
  const achou = await pag.evaluate(({ salvos }) => {
    const acha = (s) => DB.insumos[s.id] || Object.values(DB.insumos).find((i) => i.nome === s.nome || i.nome === s.nome.replace(/ 1KG$/, ""));
    const [A, B, C, D] = salvos.map(acha);
    if (!A || !B || !C || !D) return false;
    A.embNome = "PCT"; A.embQtd = 1; A.estoqueAtual = 12;
    DB.lancamentos.push({ id: "t-um", data: hojeISO(), grupo: "CMV", valor: 30, insumoId: A.id, qtd: 3, uni: "PCT" });
    if (!/1KG$/.test(D.nome)) D.nome = D.nome + " 1KG"; D.embNome = "PCT"; D.embQtd = 1;
    DB.lancamentos.push({ id: "t-um-ok", data: hojeISO(), grupo: "CMV", valor: 30, insumoId: D.id, qtd: 3, uni: "PCT" });
    delete B.embNome; B.embQtd = 0; B.estoqueAtual = 5;
    DB.lancamentos.push({ id: "t-sememb", data: hojeISO(), grupo: "CMV", valor: 50, insumoId: B.id, qtd: 2, uni: "CX" });
    C.cmp = 10; C.preco = 13; C.qtd = 1;
    viewEstoque();
    return true;
  }, ids);
  checa(achou, `${largura}: depois de recarregar, não achou os produtos de teste pelos ids/nomes`);
  await pag.waitForTimeout(300);
  const corpo = await pag.locator("#estoqueTbody").innerText();
  checa(/12 × 1 kg/.test(corpo), `${largura}: "12 × 1 kg" não aparece para ${ids.a}`);
  checa(/sem embalagem/.test(corpo), `${largura}: "sem embalagem" não aparece para ${ids.b}`);
  checa(/confira\?/.test(corpo), `${largura}: "confira?" não aparece para ${ids.a}`);
  checa(await pag.locator("text=Total em kg").count() === 0, `${largura}: Total em kg apareceu sem categoria`);
  await pag.screenshot({ path: join(PRINTS, `posicao-${largura}.png`), fullPage: largura < 600 });

  // scorecard Conferir embalagem filtra: a (1 kg por pacote) e b (sem embalagem), não d (nome diz 1KG)
  await pag.locator(".kpi", { hasText: "Conferir embalagem" }).click();
  await pag.waitForTimeout(300);
  const nomes = await pag.evaluate(() => (window.EST_POS_FILT || []).map((x) => x.nome));
  checa(nomes.length === 2 && nomes.includes(ids.a) && nomes.includes(ids.b), `${largura}: Conferir embalagem filtrou ${JSON.stringify(nomes)}, esperado ${ids.a} e ${ids.b}`);
  await pag.screenshot({ path: join(PRINTS, `posicao-confemb-${largura}.png`) });
  await pag.locator(".kpi", { hasText: "Conferir embalagem" }).click();

  // scorecard Preço subiu filtra
  await pag.locator(".kpi", { hasText: "Preço subiu" }).click();
  await pag.waitForTimeout(300);
  const txtPreco = await pag.locator("#estoqueTbody").innerText();
  checa(txtPreco.includes(ids.c) && /▲/.test(txtPreco), `${largura}: Preço subiu não mostra ${ids.c} com ▲`);
  checa((await cab()).includes("Última compra"), `${largura}: Preço subiu na Essencial não mostra a coluna Última compra`);
  await clicaTh("Custo médio");
  await pag.waitForTimeout(200);
  checa(await pag.evaluate(() => SORT.estoque.k === "custo"), `${largura}: ordenar por Custo médio no Preço subiu não pegou`);
  await pag.locator(".kpi", { hasText: "Preço subiu" }).click();
  await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => SORT.estoque.k === "comprar"), `${largura}: desligar Preço subiu na Essencial manteve a ordem por Custo médio, que sumiu`);

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
