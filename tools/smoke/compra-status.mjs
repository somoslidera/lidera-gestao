// Teste do "Comprado / aguardando chegada": a compradora marca na Lista de Compras que o item
// já foi comprado e todos veem (Lista, Posição e Requisição) até a mercadoria chegar.
// Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node compra-status.mjs
//
// Confere: marcar pela Lista (mini-form), tag na Lista / Posição / Requisição, "Itens a comprar"
// sem os comprados, nota lançada e entrada manual limpam a marca (re-salvar a mesma nota não),
// o "×" limpa, e quem não tem a permissão "Lista de compras" não marca nem limpa.
// Perfis simulados só no navegador, trocando MEMBRO_PERMS / MEMBRO_SUB.
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

async function semRolagem(pag, largura, onde) {
  if (largura >= 600) return;
  const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  checa(sobra <= 1, `${largura} ${onde}: a página rola na horizontal (${sobra}px)`);
}
const itensAComprar = (pag) => pag.evaluate(() => {
  const k = [...document.querySelectorAll(".kpi")].find((e) => /Itens a comprar/.test(e.textContent));
  return k ? parseInt(k.querySelector(".k-val").textContent, 10) : null;
});

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => d.dismiss());
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // 4 produtos zerados, abaixo do ideal (entram na Lista de Compras); um 2º armazém para a requisição
  const ids = await pag.evaluate(() => {
    MEMBRO_PERMS = null; MEMBRO_SUB = null; MEMBRO_SETORES = null;
    const L = Object.values(DB.insumos).filter((i) => estEstocavel(i) && i.noEstoque !== false && i.tipo !== "preparado").slice(0, 5);
    L.forEach((i) => { i.estoqueMin = 10; i.estoqueCrit = 0; i.estoqueAtual = 0; delete i.estoquePor; delete i.compra; i.qtdPedir = ""; });
    const arms = estArmazens(); if (!arms.some((a) => a.id !== EST_ARM_PRINCIPAL)) arms.push({ id: "cozinha", nome: "Cozinha" });
    estCfg().entradas = true;
    estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueUniF = ""; estoqueKpiF = ""; estoqueCmvF = "todos"; buscaEst = "";
    go("estoque");
    return L.map((i) => ({ id: i.id, nome: i.nome }));
  });
  const [A, B, C, D, E] = ids;
  await pag.waitForTimeout(300);
  const antes = await itensAComprar(pag);
  checa(antes != null && antes >= 5, `${largura}: Itens a comprar antes = ${antes}`);

  // ---- marcar A pela Lista, com o mini-form ----
  await pag.evaluate(() => { estoqueTab = "compras"; LC_Q = ""; viewEstoque(); });
  await pag.waitForTimeout(300);
  const btnA = pag.locator(`button[onclick="estCompraModal('${A.id}')"]`);
  checa(await btnA.count() === 1, `${largura}: falta "Marcar como comprado" na Lista para ${A.nome}`);
  if (await btnA.count()) {
    await btnA.click();
    await pag.waitForTimeout(200);
    const qDef = await pag.locator("#cp_q").inputValue().catch(() => "");
    const qPedir = await pag.evaluate((id) => String((estoqueItens().find((y) => y.ins.id === id) || {}).qtdPedir), A.id);
    checa(qDef !== "" && parseFloat(qDef) === parseFloat(qPedir), `${largura}: quantidade padrão ${qDef}, esperado Qtd a pedir ${qPedir}`);
    await pag.locator("#cp_f").fill("Fornecedor Teste");
    const prev = await pag.evaluate(() => diasSoma(hojeISO(), 2));
    await pag.locator("#cp_d").fill(prev);
    if (largura < 600) await pag.screenshot({ path: join(PRINTS, `compra-modal-${largura}.png`) });
    await pag.locator("#cp_ok").click();
    await pag.waitForTimeout(300);
    const c = await pag.evaluate((id) => DB.insumos[id].compra, A.id);
    checa(c && c.status === "comprado" && c.fornecedor === "Fornecedor Teste" && c.previsao === prev && c.em && "por" in c, `${largura}: ins.compra gravado errado ${JSON.stringify(c)}`);
  }
  // B sem previsão
  await pag.evaluate((id) => { estCompraModal(id); document.getElementById("cp_d").value = ""; estCompraSalvar(id); }, B.id);
  await pag.waitForTimeout(300);
  const lista = await pag.locator("#view").innerText();
  checa(/2 comprados aguardando chegada/.test(lista), `${largura}: Lista não mostra "2 comprados aguardando chegada"`);
  checa(/Comprado · chega \d\d\/\d\d/.test(lista), `${largura}: Lista sem "Comprado · chega dd/mm"`);
  checa(/Comprado em \d\d\/\d\d/.test(lista), `${largura}: Lista sem "Comprado em dd/mm"`);
  checa(/atualizado em/.test(lista), `${largura}: Lista sem "atualizado em"`);
  checa(await pag.locator(`button[onclick="estCompraModal('${A.id}')"]`).count() === 0, `${largura}: ${A.nome} continua entre os itens para comprar`);
  await pag.screenshot({ path: join(PRINTS, `compra-lista-${largura}.png`), fullPage: largura < 600 });
  await semRolagem(pag, largura, "Lista");

  // ---- Posição: tag junto ao nome e contagem sem os comprados ----
  await pag.evaluate(() => { estoqueTab = "contagem"; viewEstoque(); });
  await pag.waitForTimeout(300);
  const celA = await pag.locator(`#estoqueTbody tr[data-ins="${A.id}"] td`).first().innerText().catch(() => "");
  checa(/Comprado · chega \d\d\/\d\d/.test(celA) && /atualizado em/.test(celA), `${largura}: Posição sem a tag em ${A.nome}: ${JSON.stringify(celA)}`);
  const depois = await itensAComprar(pag);
  checa(depois === antes - 2, `${largura}: Itens a comprar ${depois}, esperado ${antes - 2}`);
  const aviso = await pag.locator("#view").innerText();
  checa(/2 comprado\(s\) aguardando chegada/.test(aviso), `${largura}: aviso da Posição sem "2 comprado(s) aguardando chegada"`);
  await pag.screenshot({ path: join(PRINTS, `compra-posicao-${largura}.png`), fullPage: largura < 600 });
  await semRolagem(pag, largura, "Posição");

  // ---- Requisição: item zerado com compra ativa ----
  const temReq = await pag.evaluate(({ a, c }) => {
    const para = setoresSemPrincipal()[0].id;
    const r = { id: "t-req", data: hojeISO(), turno: "dia", de: EST_ARM_PRINCIPAL, para, status: "aberta", pratos: [], obs: "", criadoEm: new Date().toISOString(), transfId: "", por: "teste",
      itens: [{ insumoId: a, nec: 1, tem: 0, qtd: 1, manual: true }, { insumoId: c, nec: 1, tem: 0, qtd: 1, manual: true }] };
    estRequisicoes().push(r); estReqSel = r.id; estoqueTab = "requisicoes"; viewEstoque();
    return true;
  }, { a: A.id, c: C.id });
  await pag.waitForTimeout(300);
  const req = await pag.locator("#rq_itens").innerText().catch(() => "");
  checa(temReq && /aguardando chegada \(comprado em \d\d\/\d\d/.test(req), `${largura}: Requisição sem "aguardando chegada (comprado em dd/mm)"`);
  checa((req.match(/aguardando chegada/g) || []).length === 1, `${largura}: Requisição marcou item sem compra`);
  await pag.screenshot({ path: join(PRINTS, `compra-requisicao-${largura}.png`), fullPage: largura < 600 });
  // a tabela da requisição já rola na horizontal no celular (antes desta mudança); o aviso não pode alargar
  if (largura < 600) {
    const larg = await pag.evaluate(() => { const com = document.documentElement.scrollWidth; document.querySelectorAll(".est-compra-req").forEach((e) => { e.style.display = "none"; }); const sem = document.documentElement.scrollWidth; document.querySelectorAll(".est-compra-req").forEach((e) => { e.style.display = ""; }); return { com, sem }; });
    checa(larg.com <= larg.sem, `${largura} Requisição: o aviso alargou a página (${larg.sem} → ${larg.com}px)`);
  }
  // seletor do item avulso
  await pag.evaluate(() => estReqAddItem("t-req"));
  await pag.waitForTimeout(200);
  await pag.locator("#ra_prod").fill(A.nome);
  const dica = await pag.locator("#ra_compra").innerText().catch(() => "");
  checa(/aguardando chegada \(comprado em/.test(dica), `${largura}: item avulso sem o aviso de aguardando chegada`);
  await pag.evaluate(() => { closeModal(); estReqSel = null; });

  // ---- nota lançada limpa (mesmo com data antiga); re-salvar a mesma nota não limpa ----
  const nota = await pag.evaluate(({ a }) => {
    const ins = DB.insumos[a];
    const nv = { id: "t-nf-1", data: hojeISO(), fornecedor: "Fornecedor Teste", nfe: "123", insumoId: a, valor: 50, grupo: "CMV" };
    DB.lancamentos.push(nv); estEntradaDeLanc(nv, ins, 5, 50);
    const limpouNova = ins.compra === null;
    ins.compra = { status: "comprado", qtd: 3, fornecedor: "", previsao: "", em: new Date().toISOString(), por: "teste" };
    estEntradaDeLanc(nv, ins, 5, 50);  // editar a mesma nota
    const manteveEdicao = estCompraAtiva(ins);
    const velha = { id: "t-nf-velha", data: diasSoma(hojeISO(), -30), fornecedor: "X", insumoId: a, valor: 10, grupo: "CMV" };
    DB.lancamentos.push(velha); estEntradaDeLanc(velha, ins, 1, 10);
    const limpouVelha = ins.compra === null;
    return { limpouNova, manteveEdicao, limpouVelha };
  }, { a: A.id });
  checa(nota.limpouNova, `${largura}: nota lançada não limpou a marca`);
  checa(nota.manteveEdicao, `${largura}: re-salvar a mesma nota limpou a marca nova`);
  checa(nota.limpouVelha, `${largura}: nota com data antiga não limpou a marca`);

  // ---- entrada manual pela tela de movimentação limpa ----
  await pag.evaluate((b) => { estMovModal("entrada", b); estMovBulkSet(b, "4"); }, B.id);
  await pag.waitForTimeout(200);
  await pag.locator('#modalRoot button[onclick^="estMovSalvar"]').first().click();
  await pag.waitForTimeout(300);
  checa(await pag.evaluate((b) => DB.insumos[b].compra === null && (+DB.insumos[b].estoqueAtual || 0) > 0, B.id), `${largura}: entrada manual não limpou a marca de ${B.nome}`);

  // ---- "×" limpa ----
  await pag.evaluate((c) => { const i = DB.insumos[c]; i.compra = { status: "comprado", qtd: 2, fornecedor: "", previsao: "", em: new Date().toISOString(), por: "teste" }; estoqueTab = "contagem"; viewEstoque(); }, C.id);
  await pag.waitForTimeout(300);
  const x = pag.locator(`#estoqueTbody tr[data-ins="${C.id}"] .est-compra-x`);
  checa(await x.count() === 1, `${largura}: falta o × na tag de ${C.nome}`);
  if (await x.count()) {
    await x.click();
    await pag.locator('#uxConfirm [data-a="1"]').click();
    await pag.waitForTimeout(300);
    checa(await pag.evaluate((c) => DB.insumos[c].compra === null, C.id), `${largura}: × não limpou a marca`);
  }

  // ---- sem a permissão "Lista de compras": vê a tag, não marca nem limpa ----
  const semPerm = await pag.evaluate(({ d, e }) => {
    DB.insumos[d].compra = { status: "comprado", qtd: 1, fornecedor: "", previsao: "", em: new Date().toISOString(), por: "teste" };
    MEMBRO_PERMS = ["estoque"]; MEMBRO_SETORES = null; MEMBRO_SUB = { posicao: true, mov: true, contagem: true, compras: false };
    estoqueTab = "contagem"; viewEstoque();
    const tag = !!document.querySelector(`#estoqueTbody tr[data-ins="${d}"] .est-compra`);
    const xis = document.querySelectorAll(".est-compra-x").length;
    closeModal(); estCompraModal(e); const abriu = !!document.querySelector("#cp_q");
    estCompraSalvar(e); const marcou = estCompraAtiva(DB.insumos[e]);
    estCompraLimpar(d); const conf = !!document.getElementById("uxConfirm");
    const limpou = !estCompraAtiva(DB.insumos[d]);
    // com a permissão: marca
    MEMBRO_SUB = { posicao: true, compras: true };
    estCompraModal(e); const abriuCom = !!document.querySelector("#cp_q"); estCompraSalvar(e); const marcouCom = estCompraAtiva(DB.insumos[e]);
    MEMBRO_PERMS = null; MEMBRO_SUB = null;
    return { tag, xis, abriu, marcou, conf, limpou, abriuCom, marcouCom };
  }, { d: D.id, e: E.id });
  checa(semPerm.tag, `${largura}: sem permissão não vê a tag`);
  checa(semPerm.xis === 0, `${largura}: sem permissão vê o ×`);
  checa(!semPerm.abriu && !semPerm.marcou, `${largura}: sem permissão conseguiu marcar comprado`);
  checa(!semPerm.conf && !semPerm.limpou, `${largura}: sem permissão conseguiu limpar`);
  checa(semPerm.abriuCom && semPerm.marcouCom, `${largura}: com a permissão não marcou`);

  checa(!erros.length, `${largura}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${largura}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

for (const w of [1280, 390]) {
  try { await rodar(w); } catch (e) { falhas.push(`${w}: o teste quebrou: ${String(e).split("\n")[0]}`); }
}
await nav.close();
srv.close();
if (falhas.length) { console.error("compra-status: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`compra-status: ok (prints em ${PRINTS})`);
