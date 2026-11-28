// Teste da requisição por setor: o chefe de setor só requisita para o(s) setor(es) dele,
// pela tela e pelas funções (estReqNova, estReqSet, estReqEnviar, opGerarRequisicao).
// Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node req-setor.mjs
//
// Monta no navegador 3 setores além do principal (Churrascaria, Cozinha, Bar) e simula os
// perfis trocando MEMBRO_PERMS / MEMBRO_NIVEL / MEMBRO_SUB / MEMBRO_SETORES.
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
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => d.accept("teste"));
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForTimeout(2500);

  // cenário: principal + 3 setores; as vendas baixam da Cozinha (é o destino padrão da requisição)
  await pag.evaluate(() => {
    DB.fin.armazens = [
      { id: EST_ARM_PRINCIPAL, nome: "Estoque principal" },
      { id: "churrascaria", nome: "Churrascaria" },
      { id: "cozinha", nome: "Cozinha" },
      { id: "bar", nome: "Bar" },
    ];
    estCfg().armVendas = "cozinha";
    DB.requisicoes = [];
    // um rascunho da Cozinha, feito por outra pessoa
    DB.requisicoes.push({ id: "rq-cozinha", data: hojeISO(), turno: "dia", de: EST_ARM_PRINCIPAL, para: "cozinha", status: "aberta", pratos: [], itens: [], obs: "", criadoEm: new Date().toISOString(), transfId: "", por: "Outro" });
    const ins = Object.values(DB.insumos).find((i) => estEstocavel(i) && i.noEstoque !== false && i.tipo !== "preparado");
    DB.requisicoes.find((r) => r.id === "rq-cozinha").itens = [{ insumoId: ins.id, nec: 1, tem: 0, qtd: 1, manual: true }];
    // uma ordem de produção para a Cozinha, com um preparado que tem receita
    const prep = Object.values(DB.insumos).find((i) => i.tipo === "preparado" && (i.comps || []).length);
    DB.ordensProducao = [{ id: "op-cozinha", data: hojeISO(), para: "cozinha", itens: [{ subId: prep.id, qtdUni: 5, produzido: 0 }], obs: "" }];
  });

  const perfil = (p) => pag.evaluate((p) => {
    MEMBRO_PERMS = p.perms; MEMBRO_NIVEL = p.nivel; MEMBRO_SETORES = p.setores;
    MEMBRO_SUB = p.nivel ? Object.assign({}, NIVEIS[p.nivel].sub) : null; MEMBRO_NOME = p.nome;
    estReqSel = null; closeModal && closeModal();
  }, p);

  // estado útil depois de cada ação
  const estado = () => pag.evaluate(() => ({
    n: DB.requisicoes.length,
    sel: estReqSel,
    ultima: DB.requisicoes[DB.requisicoes.length - 1],
    opcoes: [...document.querySelectorAll("#rq_para option")].map((o) => o.value),
    cozinha: DB.requisicoes.find((r) => r.id === "rq-cozinha"),
    lista: [...document.querySelectorAll("table tbody tr")].map((t) => t.innerText).join(" | "),
    editor: !!document.querySelector("#rq_para"),
    st: Object.fromEntries(DB.requisicoes.map((r) => [r.id, r.status])),
  }));

  // 1) chefe da churrascaria
  await perfil({ perms: ["estoque"], nivel: "chefe", setores: ["churrascaria"], nome: "Chefe Churrascaria" });
  let d = await pag.evaluate(() => ({ dest: estReqSetoresDestino().map((a) => a.id), criar: pode("req_criar"), separar: pode("req_separar") }));
  checa(JSON.stringify(d.dest) === '["churrascaria"]', `${largura} chefe: destinos ${JSON.stringify(d.dest)}, esperado só churrascaria`);
  checa(d.criar && !d.separar, `${largura} chefe: permissões erradas ${JSON.stringify(d)}`);
  await pag.evaluate(() => { estoqueTab = "requisicoes"; go("estoque"); });
  await pag.waitForTimeout(300);
  let e = await estado();
  checa(!/Cozinha/.test(e.lista), `${largura} chefe: a lista mostra a requisição da Cozinha`);
  await pag.evaluate(() => estReqNova());
  await pag.waitForTimeout(300);
  e = await estado();
  checa(e.n === 2 && e.ultima.para === "churrascaria", `${largura} chefe: Nova requisição foi para ${e.ultima && e.ultima.para}, esperado churrascaria`);
  checa(JSON.stringify(e.opcoes) === '["churrascaria"]', `${largura} chefe: o campo "Para" oferece ${JSON.stringify(e.opcoes)}`);
  const de = await pag.evaluate(() => { const s = document.querySelector("#rq_de"); return { v: s.value, dis: s.disabled, txt: s.options[s.selectedIndex].text }; });
  checa(de.v === "principal" && de.dis, `${largura} chefe: o campo "De" mostra ${JSON.stringify(de)}, esperado o principal travado`);
  await pag.screenshot({ path: join(PRINTS, `req-setor-chefe-${largura}.png`), fullPage: largura < 600 });
  const nova = e.ultima.id;
  // pela função direta: trocar o destino para outro setor
  await pag.evaluate((id) => { estReqSet(id, "para", "cozinha"); estReqSet(id, "para", EST_ARM_PRINCIPAL); estReqSet(id, "de", "churrascaria"); }, nova);
  e = await estado();
  checa(e.ultima.para === "churrascaria", `${largura} chefe: estReqSet trocou o destino para ${e.ultima.para}`);
  checa(e.ultima.de === "principal", `${largura} chefe: estReqSet trocou a origem para ${e.ultima.de}`);
  // pela função direta: abrir, mexer e enviar o rascunho da Cozinha
  await pag.evaluate(() => { estReqAbrir("rq-cozinha"); });
  await pag.waitForTimeout(200);
  e = await estado();
  checa(!(e.sel === "rq-cozinha" && e.editor), `${largura} chefe: abriu o rascunho da Cozinha`);
  await pag.evaluate(() => { estReqSet("rq-cozinha", "obs", "mexi"); estReqEnviar("rq-cozinha"); });
  e = await estado();
  checa(e.cozinha.status === "aberta" && e.cozinha.obs === "", `${largura} chefe: mexeu/enviou o rascunho da Cozinha (${e.cozinha.status}, "${e.cozinha.obs}")`);
  // pela ordem de produção de outro setor
  await pag.evaluate(() => { MEMBRO_SUB.producao = true; opGerarRequisicao("op-cozinha"); });
  e = await estado();
  checa(e.n === 2, `${largura} chefe: gerou requisição para a Cozinha pela ordem de produção`);
  // enviar a própria funciona (com um item)
  await pag.evaluate((id) => { const r = DB.requisicoes.find((x) => x.id === id); r.itens = JSON.parse(JSON.stringify(DB.requisicoes.find((x) => x.id === "rq-cozinha").itens)); estReqEnviar(id); }, nova);
  e = await estado();
  checa(DB_status(e, nova) === "solicitada", `${largura} chefe: não conseguiu enviar a própria requisição`);

  // 2) chefe sem setor marcado (membro antigo, ou criado quando só havia um armazém)
  await perfil({ perms: ["estoque"], nivel: "chefe", setores: [], nome: "Chefe sem setor" });
  const antes = (await estado()).n;
  await pag.evaluate(() => estReqNova());
  e = await estado();
  checa(e.n === antes, `${largura} chefe sem setor: criou requisição para ${e.ultima.para}`);
  d = await pag.evaluate(() => estReqSetoresDestino().map((a) => a.id));
  checa(d.length === 0, `${largura} chefe sem setor: destinos ${JSON.stringify(d)}`);

  // 3) estoquista do principal: não cria, mas vê e separa a fila inteira
  await perfil({ perms: ["insumos", "estoque", "cmv"], nivel: "estoquista", setores: ["principal"], nome: "Estoquista" });
  const antesEst = (await estado()).n;
  await pag.evaluate(() => estReqNova());
  e = await estado();
  checa(e.n === antesEst, `${largura} estoquista: criou requisição`);
  await pag.evaluate(() => { estReqSel = null; estoqueTab = "requisicoes"; go("estoque"); });
  await pag.waitForTimeout(300);
  e = await estado();
  checa(/Churrascaria/.test(e.lista) && /Cozinha/.test(e.lista), `${largura} estoquista: a lista não mostra todos os setores`);
  await pag.evaluate((id) => estReqIniciar(id), nova);
  e = await estado();
  checa(DB_status(e, nova) === "separando", `${largura} estoquista: não iniciou a separação`);
  await pag.screenshot({ path: join(PRINTS, `req-setor-estoquista-${largura}.png`), fullPage: largura < 600 });

  // 4) dono: escolhe qualquer setor
  await perfil({ perms: null, nivel: "", setores: null, nome: "" });
  const antesDono = (await estado()).n;
  await pag.evaluate(() => estReqNova());
  await pag.waitForTimeout(200);
  e = await estado();
  checa(e.n === antesDono + 1, `${largura} dono: não criou requisição`);
  checa(["churrascaria", "cozinha", "bar"].every((s) => e.opcoes.includes(s)), `${largura} dono: o campo "Para" oferece ${JSON.stringify(e.opcoes)}`);
  await pag.evaluate((id) => estReqSet(id, "para", "bar"), e.ultima.id);
  e = await estado();
  checa(e.ultima.para === "bar", `${largura} dono: não trocou o destino para o Bar`);
  await pag.evaluate(() => opGerarRequisicao("op-cozinha"));
  e = await estado();
  checa(e.n === antesDono + 2 && e.ultima.para === "cozinha", `${largura} dono: não gerou a requisição da ordem de produção`);

  if (largura < 600) {
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checa(sobra <= 1, `${largura}: a página rola na horizontal (${sobra}px)`);
  }
  checa(!erros.length, `${largura}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${largura}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}
function DB_status(e, id) { return e.st[id]; }

await rodar(1280);
await rodar(390);
await nav.close();
srv.close();
if (falhas.length) { console.error("req-setor: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`req-setor: ok (prints em ${PRINTS})`);
