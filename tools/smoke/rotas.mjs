// Teste do endereço por tela (#/rota/aba) e do voltar/avançar do navegador. Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node rotas.mjs
//
// Confere: menu e abas (Estoque, Financeiro) atualizam o endereço; voltar/avançar voltam à tela e à aba certas;
// voltar com modal aberto fecha o modal e fica na tela; recarregar em #/estoque/contar abre a Contagem física;
// endereço inválido cai na tela padrão; ?parâmetros ficam; membro (flowSim) com endereço de área proibida cai na
// área liberada e o endereço é corrigido; voltar antes do início sai do app; sem erro de JS e sem rolagem lateral.
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

async function rodar(largura) {
  const L = `${largura}`;
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  ctx.setDefaultTimeout(8000);
  ctx.setDefaultNavigationTimeout(45000);
  const pag = await ctx.newPage();
  const erros = [];
  const banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => d.dismiss());

  const hash = () => pag.evaluate(() => location.hash);
  const estado = () => pag.evaluate(() => ({ c: current, et: estoqueTab, ft: finTab, h: location.hash, s: location.search,
    modal: !!document.querySelector("#modalRoot .modal-overlay"), conf: !!document.getElementById("uxConfirm"),
    abaOn: ((document.querySelector("#view .pill-filter.tabs button.on") || {}).textContent || "").trim() }));
  const voltar = async () => { await pag.evaluate(() => history.back()); await espera(pag, 450); };
  const avancar = async () => { await pag.evaluate(() => history.forward()); await espera(pag, 450); };
  const menu = async (rota) => {   // clica no menu de verdade (no celular, abre o menu lateral antes)
    if (largura < 600) { await pag.locator(".menu-btn").click(); await espera(pag, 250); }
    await pag.locator(`#nav a[data-route="${rota}"]`).click();
    await espera(pag);
  };
  const aba = async (texto) => { await pag.locator("#view .pill-filter.tabs button", { hasText: texto }).first().click(); await espera(pag); };
  const semRolagem = async (onde) => {
    if (largura >= 600) return;
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    checa(sobra <= 1, `${L} ${onde}: a página rola na horizontal (${sobra}px)`);
  };

  // abrir: o endereço ganha a tela padrão e mantém o ?parâmetro
  await pag.goto(BASE + "/?demo=base&v=123", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await espera(pag, 2500);
  let e = await estado();
  checa(e.h === "#/dashboard" && e.c === "dashboard", `${L}: ao abrir, o endereço não ficou #/dashboard (${e.h}, tela ${e.c})`);

  // menu e abas atualizam o endereço
  await menu("financeiro");
  await pag.evaluate(() => { if (finTab !== "visao") { finTab = "visao"; viewFinanceiro(); } });
  await espera(pag);
  e = await estado();
  checa(e.h === "#/financeiro/visao-geral", `${L}: menu Financeiro deu ${e.h}`);
  await aba("DRE");
  e = await estado();
  checa(e.h === "#/financeiro/dre" && e.ft === "dre", `${L}: aba DRE deu ${e.h} (finTab ${e.ft})`);
  await semRolagem("DRE");
  await menu("estoque");
  await pag.evaluate(() => { if (estoqueTab !== "contagem") { estoqueTab = "contagem"; viewEstoque(); } });
  await espera(pag);
  e = await estado();
  checa(e.h === "#/estoque/posicao" && e.et === "contagem", `${L}: menu Estoque deu ${e.h} (aba ${e.et})`);
  await aba("Contagem física");
  e = await estado();
  checa(e.h === "#/estoque/contar" && e.et === "contar", `${L}: aba Contagem física deu ${e.h}`);
  checa(e.s === "?demo=base&v=123", `${L}: o ?parâmetro sumiu do endereço (${e.s})`);
  await pag.screenshot({ path: join(PRINTS, `rotas-contar-${largura}.png`) });
  await semRolagem("Contagem física");
  // a mesma tela de novo não empilha
  const n0 = await pag.evaluate(() => history.length);
  await menu("estoque");
  await pag.evaluate(() => viewEstoque());
  await espera(pag);
  checa(await pag.evaluate(() => history.length) === n0, `${L}: abrir a mesma tela empilhou outra entrada`);

  // voltar e avançar
  await voltar();
  e = await estado();
  checa(e.c === "estoque" && e.et === "contagem" && e.h === "#/estoque/posicao" && e.abaOn === "Posição", `${L}: voltar 1 deveria dar Estoque › Posição: ${JSON.stringify(e)}`);
  await voltar();
  e = await estado();
  checa(e.c === "financeiro" && e.ft === "dre" && e.h === "#/financeiro/dre" && e.abaOn === "DRE", `${L}: voltar 2 deveria dar Financeiro › DRE: ${JSON.stringify(e)}`);
  await voltar();
  e = await estado();
  checa(e.c === "financeiro" && e.ft === "visao" && e.h === "#/financeiro/visao-geral", `${L}: voltar 3 deveria dar Financeiro › Visão Geral: ${JSON.stringify(e)}`);
  await voltar();
  e = await estado();
  checa(e.c === "dashboard" && e.h === "#/dashboard", `${L}: voltar 4 deveria dar o Dashboard: ${JSON.stringify(e)}`);
  await avancar();
  await avancar();
  e = await estado();
  checa(e.c === "financeiro" && e.ft === "dre" && e.h === "#/financeiro/dre", `${L}: avançar 2× deveria dar Financeiro › DRE: ${JSON.stringify(e)}`);
  await avancar();
  e = await estado();
  checa(e.c === "estoque" && e.et === "contagem", `${L}: avançar deveria dar Estoque › Posição: ${JSON.stringify(e)}`);
  await avancar();
  e = await estado();
  checa(e.c === "estoque" && e.et === "contar" && e.abaOn === "Contagem física", `${L}: avançar deveria dar Contagem física: ${JSON.stringify(e)}`);

  // voltar com modal aberto: fecha o modal e fica na tela; o voltar seguinte vai para a tela anterior
  await pag.locator("#topActions .btn-primary").first().click();   // Nova contagem
  await espera(pag);
  checa((await estado()).modal, `${L}: Nova contagem não abriu o modal`);
  await pag.screenshot({ path: join(PRINTS, `rotas-modal-${largura}.png`) });
  await voltar();
  e = await estado();
  checa(!e.modal && e.c === "estoque" && e.et === "contar" && e.h === "#/estoque/contar", `${L}: voltar com modal aberto não fechou o modal na mesma tela: ${JSON.stringify(e)}`);
  await voltar();
  e = await estado();
  checa(e.c === "estoque" && e.et === "contagem", `${L}: depois de fechar o modal, voltar não foi para a Posição: ${JSON.stringify(e)}`);
  // modal fechado pelo X: um voltar só já vai para a tela anterior (a entrada do modal não fica no caminho)
  await avancar();
  await pag.locator("#topActions .btn-primary").first().click();
  await espera(pag);
  const temX = await pag.evaluate(() => { const x = document.querySelector("#modalRoot .modal-head .x"); if (x) x.click(); else closeModal(); return !!x; });
  await espera(pag);
  checa(!(await estado()).modal, `${L}: o X (${temX}) não fechou o modal`);
  await voltar();
  e = await estado();
  checa(e.c === "estoque" && e.et === "contagem", `${L}: modal fechado pelo X: voltar não foi direto para a Posição: ${JSON.stringify(e)}`);
  // confirmação (uxConfirma) por cima: o voltar fecha só a confirmação
  await pag.evaluate(() => uxConfirma({ titulo: "Teste", texto: "teste do voltar" }, () => {}));
  await espera(pag);
  checa((await estado()).conf, `${L}: a confirmação não abriu`);
  await voltar();
  e = await estado();
  checa(!e.conf && e.c === "estoque" && e.et === "contagem", `${L}: voltar com confirmação aberta: ${JSON.stringify(e)}`);

  // janela sem X (obriga uma escolha, como "Alterações não enviadas"): o voltar e o Esc não fecham; o voltar é absorvido
  await pag.evaluate(() => modal(`<div class="modal-head"><h3>Teste sem X</h3></div><div class="modal-body">escolha uma opção</div><div class="modal-foot"><button class="btn btn-primary" id="tsOk" onclick="closeModal()">Ok</button></div>`, true));
  await espera(pag);
  await voltar();
  e = await estado();
  checa(e.modal && e.c === "estoque" && e.et === "contagem" && e.h === "#/estoque/posicao", `${L}: voltar fechou a janela sem X ou trocou de tela: ${JSON.stringify(e)}`);
  await pag.keyboard.press("Escape");
  await espera(pag, 200);
  checa((await estado()).modal, `${L}: Esc fechou a janela sem X`);
  await voltar();
  e = await estado();
  checa(e.modal && e.c === "estoque" && e.et === "contagem", `${L}: 2º voltar com janela sem X: ${JSON.stringify(e)}`);
  await pag.locator("#tsOk").click();
  await espera(pag);
  await voltar();
  e = await estado();
  checa(!e.modal && e.c === "financeiro" && e.ft === "dre", `${L}: depois de escolher na janela sem X, voltar não foi para Financeiro › DRE: ${JSON.stringify(e)}`);
  await menu("estoque");
  await aba("Contagem física");

  // aviso de não contados: no 2º passo ("Zerar…?") o voltar volta ao 1º, como o Esc; depois fecha o aviso; depois a contagem
  const itCont = await pag.evaluate(() => {
    const its = estoqueItens().map((x) => x.ins).filter((i) => i.noEstoque !== false).slice(0, 3);
    its.forEach((i) => { i.estoqueAtual = 5; delete i.estoquePor; });
    estContDraft = null; estContQ = ""; estContCat = ""; estContFiltro = "todos";
    estContagemNova(); estContDraft.vals[its[0].id] = "5"; estContagemNova();
    return its.length;
  });
  await espera(pag, 250);
  await pag.locator(".modal-foot button", { hasText: "Salvar contagem" }).click();
  await espera(pag);
  const aviso = pag.locator("#uxConfirm.ec-falta");
  if (checa(itCont === 3 && await aviso.count() === 1, `${L}: o aviso de não contados não abriu (${itCont} itens)`)) {
    await aviso.locator("button", { hasText: "Zerar os não contados" }).click();
    await espera(pag, 200);
    checa(await pag.evaluate(() => document.getElementById("uxConfirm").dataset.p) === "2", `${L}: o aviso não foi ao 2º passo`);
    await voltar();
    const p = await pag.evaluate(() => { const c = document.getElementById("uxConfirm"); return { p: c && c.dataset.p, modal: !!document.querySelector("#modalRoot .modal-overlay"), h: location.hash, n: DB.contagens.length }; });
    checa(p.p === "1" && p.modal && p.h === "#/estoque/contar", `${L}: voltar no 2º passo do aviso não voltou ao 1º: ${JSON.stringify(p)}`);
    await voltar();
    e = await estado();
    checa(!e.conf && e.modal && e.h === "#/estoque/contar", `${L}: voltar no 1º passo do aviso: ${JSON.stringify(e)}`);
    await voltar();
    e = await estado();
    checa(!e.modal && e.c === "estoque" && e.et === "contar", `${L}: voltar depois do aviso não fechou a contagem: ${JSON.stringify(e)}`);
  }

  // seletor de categoria dentro do lançamento: o voltar fecha só o seletor
  await pag.evaluate(() => { finTab = "lanc"; go("financeiro"); });
  await espera(pag);
  await pag.evaluate(() => lancarModal());
  await espera(pag);
  const cb = pag.locator("#modalRoot .cat-btn >> visible=true").first();
  if (checa(await cb.count() === 1, `${L}: o lançamento não tem o seletor de categoria`)) {
    await cb.click();
    await espera(pag, 250);
    checa(await pag.locator("#catpick").count() === 1, `${L}: o seletor de categoria não abriu`);
    await voltar();
    e = await estado();
    checa(await pag.locator("#catpick").count() === 0 && e.modal && e.c === "financeiro" && e.h === "#/financeiro/lancamentos", `${L}: voltar com o seletor de categoria aberto: ${JSON.stringify(e)}`);
  }
  await voltar();
  e = await estado();
  checa(!e.modal && e.c === "financeiro" && e.ft === "lanc", `${L}: voltar não fechou o lançamento: ${JSON.stringify(e)}`);

  // modal aberto vence a regra de "entrada de outro cliente": fecha o modal e fica
  await pag.evaluate(() => history.replaceState(Object.assign({}, history.state, { o: "outro-cliente" }), "", location.href));
  await pag.locator("#topActions .btn-primary").first().click();   // Lançar
  await espera(pag);
  await voltar();
  e = await estado();
  checa(!e.modal && e.c === "financeiro" && e.h === "#/financeiro/lancamentos" && pag.url().startsWith(BASE), `${L}: modal + entrada de outro cliente: ${JSON.stringify(e)}`);
  await pag.evaluate(() => history.replaceState(Object.assign({}, history.state, { o: null }), "", location.href));

  // go() com a tela de login por cima (ex.: mudar de celular para computador no login) não mexe no endereço nem no pendente
  const h0 = await hash();
  const pend = await pag.evaluate(() => { showLogin(); ROTA_PEND = { alvo: rotaLer("#/estoque/contar") }; go("dashboard"); return { h: location.hash, p: !!(ROTA_PEND && ROTA_PEND.alvo) }; });
  checa(pend.h === h0 && pend.p, `${L}: go() com o login na tela mexeu no endereço ou no pendente: ${JSON.stringify(pend)}`);
  await pag.setViewportSize({ width: largura < 600 ? 1280 : 390, height: 844 });
  await espera(pag, 400);
  await pag.setViewportSize({ width: largura, height: largura < 600 ? 844 : 900 });
  await espera(pag, 400);
  const pend2 = await pag.evaluate(() => ({ h: location.hash, p: !!(ROTA_PEND && ROTA_PEND.alvo) }));
  checa(pend2.h === h0 && pend2.p, `${L}: o resize com o login na tela mexeu no endereço ou no pendente: ${JSON.stringify(pend2)}`);
  await pag.evaluate(() => { hideLogin(); go("dashboard"); });   // "entrou": abre a tela pendente
  await espera(pag);
  e = await estado();
  checa(e.c === "estoque" && e.et === "contar" && e.h === "#/estoque/contar", `${L}: depois do login a tela pendente não abriu: ${JSON.stringify(e)}`);

  // painel Lidera/consultor: ao cair no painel, o endereço recarregado não vale para o 1º "Abrir app"
  const adm = await pag.evaluate(async () => { ROTA_PEND = { alvo: rotaLer("#/financeiro/dre") }; try { await showAdmin(); } catch (err) {}
    const r = { alvo: ROTA_PEND && ROTA_PEND.alvo, h: location.hash };
    document.getElementById("adminScreen").style.display = "none"; go("dashboard"); r.depois = location.hash; r.c = current; return r; });
  checa(adm.alvo === null && adm.h === "" && adm.c === "dashboard" && adm.depois === "#/dashboard", `${L}: painel herdou a rota do endereço: ${JSON.stringify(adm)}`);
  erros.splice(0, erros.length, ...erros.filter((x) => !/sb|supabase|null/i.test(x)));   // showAdmin sem banco falha depois de esconder o app (esperado no preview)

  // impressão da tela continua saindo
  const impr = await pag.evaluate(() => { const p = window.print; let ok = false; window.print = () => { ok = ((document.getElementById("printArea") || {}).textContent || "").length > 20; }; try { imprimirTela(); } finally { window.print = p; } return ok; });
  checa(impr, `${L}: imprimirTela não montou a folha`);

  // # digitado na barra de endereço abre a tela; # inválido corrige para a tela atual
  await pag.evaluate(() => { location.hash = "#/financeiro/lancamentos"; });
  await espera(pag, 450);
  e = await estado();
  checa(e.c === "financeiro" && e.ft === "lanc" && e.h === "#/financeiro/lancamentos", `${L}: # digitado não abriu Lançamentos: ${JSON.stringify(e)}`);
  await pag.evaluate(() => { location.hash = "#/nao-existe"; });
  await espera(pag, 450);
  e = await estado();
  checa(e.c === "financeiro" && e.h === "#/financeiro/lancamentos", `${L}: # inválido digitado: ${JSON.stringify(e)}`);

  // recarregar em #/estoque/contar abre a Contagem física
  await pag.evaluate(() => history.replaceState(null, "", location.pathname + "#/estoque/contar"));
  await pag.reload({ waitUntil: "load" });
  await espera(pag, 2000);
  e = await estado();
  checa(e.c === "estoque" && e.et === "contar" && e.h === "#/estoque/contar" && e.abaOn === "Contagem física", `${L}: recarregar em #/estoque/contar: ${JSON.stringify(e)}`);
  // voltar com modal aberto logo na primeira tela: fecha o modal e não sai do app
  await pag.locator("#topActions .btn-primary").first().click();
  await espera(pag);
  await voltar();
  e = await estado().catch(() => null);
  checa(e && !e.modal && e.c === "estoque" && pag.url().startsWith(BASE), `${L}: na 1ª tela, voltar com modal saiu do app ou não fechou: ${JSON.stringify(e)} ${pag.url()}`);

  // abrir com endereço inválido: tela padrão, sem erro
  for (const [h, esperado, tela] of [["#/nao-existe", "#/dashboard", "dashboard"], ["#/estoque/xyz", "#/estoque/posicao", "estoque"], ["#/financeiro/dre", "#/financeiro/dre", "financeiro"], ["#/produtos", "#/produtos", "insumos"]]) {
    await pag.goto("about:blank");
    await pag.goto(BASE + "/" + h, { waitUntil: "load" });
    await espera(pag, 1800);
    e = await estado();
    checa(e.h === esperado && e.c === tela, `${L}: abrir ${h} deu ${e.h} (tela ${e.c}), esperado ${esperado}`);
  }
  // voltar antes do início: o navegador sai do app
  await pag.goto("about:blank");
  await pag.goto(BASE + "/#/estoque", { waitUntil: "load" });
  await espera(pag, 1800);
  await pag.evaluate(() => history.back());
  await espera(pag, 800);
  checa(pag.url() === "about:blank", `${L}: voltar antes do início não saiu do app (${pag.url()})`);

  // membro: endereço de área proibida cai na área liberada e o endereço é corrigido
  await pag.goto(BASE + "/#/dashboard", { waitUntil: "load" });
  await espera(pag, 1800);
  checa(await pag.evaluate(() => window.flowSim.aplicar({ nivel: "operador" })), `${L}: flowSim não aplicou o Operador`);
  await espera(pag);
  const perms = await pag.evaluate(() => MEMBRO_PERMS.slice());
  checa(!perms.includes("financeiro") && !perms.includes("dashboard"), `${L}: o Operador deveria ficar sem Financeiro e Dashboard (${perms})`);
  e = await estado();
  checa(e.c === perms[0] && e.h === "#/produtos", `${L}: membro entrou em ${e.c} com ${e.h}`);
  await pag.evaluate(() => { location.hash = "#/financeiro/dre"; });
  await espera(pag, 450);
  e = await estado();
  checa(e.c === perms[0] && e.h === "#/produtos", `${L}: membro com # do Financeiro: tela ${e.c}, endereço ${e.h}`);
  await pag.evaluate(() => history.replaceState(null, "", location.pathname + "#/financeiro"));
  await pag.reload({ waitUntil: "load" });
  await espera(pag, 2000);
  e = await estado();
  checa(e.c === perms[0] && e.h === "#/produtos", `${L}: membro recarregando em #/financeiro: tela ${e.c}, endereço ${e.h}`);
  // área liberada com aba: abre a aba
  await pag.evaluate(() => history.replaceState(null, "", location.pathname + "#/estoque/contar"));
  await pag.reload({ waitUntil: "load" });
  await espera(pag, 2000);
  e = await estado();
  checa(e.c === "estoque" && e.et === "contar" && e.h === "#/estoque/contar", `${L}: membro recarregando em #/estoque/contar: ${JSON.stringify(e)}`);
  await pag.screenshot({ path: join(PRINTS, `rotas-membro-${largura}.png`) });
  await semRolagem("membro");
  await Promise.all([pag.waitForEvent("load"), pag.evaluate(() => window.flowSim.dono())]);
  await espera(pag, 1500);

  checa(!erros.length, `${L}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${L}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

for (const largura of [1280, 390]) {
  try { await rodar(largura); } catch (err) { falhas.push(`${largura}: o teste parou: ${String(err).split("\n").slice(0, 4).join(" / ")}`); }
}
await nav.close();
srv.close();
if (falhas.length) { console.error("rotas: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`rotas: ok (prints em ${PRINTS})`);
