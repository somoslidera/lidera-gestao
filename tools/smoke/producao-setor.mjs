// Teste da produção por setor: o chefe da produção registra produção e o que é gravado
// é o que a tela mostra (bruto sai da Produção, porcionado entra na Produção). Depois ele
// devolve ao principal pelo retorno. Origem/destino fora do setor dele são recusados.
// Dono continua com o padrão (principal → estoque de vendas). Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node producao-setor.mjs
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
  pag.on("dialog", (d) => d.accept());
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // cenário: principal, Produção (setor de produção) e Churrascaria (as vendas baixam dela)
  const subId = await pag.evaluate(() => {
    DB.fin.armazens = [
      { id: EST_ARM_PRINCIPAL, nome: "Estoque principal" },
      { id: "producao", nome: "Produção", producao: true },
      { id: "churrascaria", nome: "Churrascaria" },
    ];
    estCfg().armVendas = "churrascaria";
    DB.producoes = [];
    const prep = Object.values(DB.insumos).find((i) => i.tipo === "preparado" && (i.comps || []).some(([c]) => DB.insumos[c] && estEstocavel(DB.insumos[c])));
    prep.estocavel = true; prep.rendMin = 0;
    return prep.id;
  });

  const perfil = (p) => pag.evaluate((p) => {
    MEMBRO_PERMS = p.perms; MEMBRO_NIVEL = p.nivel; MEMBRO_SETORES = p.setores;
    MEMBRO_SUB = p.nivel ? Object.assign({}, NIVEIS[p.nivel].sub) : null; MEMBRO_NOME = p.nome;
    estProdDraft = null; closeModal && closeModal();
  }, p);

  // abre a janela, lê o que a tela mostra e o rascunho, e registra pelo botão
  const registrar = async (rotulo, print) => {
    await pag.evaluate((id) => { estoqueTab = "producao"; go("estoque"); estProducaoModal(id); }, subId);
    await pag.waitForTimeout(300);
    const tela = await pag.evaluate(() => {
      const sel = (id) => { const s = document.querySelector("#" + id); return s ? { v: s.value, txt: s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : "", ops: [...s.options].map((o) => o.value) } : null; };
      return { de: sel("pr_de"), para: sel("pr_para"), draftDe: estProdDraft.armDe, draftPara: estProdDraft.armPara };
    });
    if (print) await pag.screenshot({ path: join(PRINTS, `producao-setor-${rotulo}-${largura}.png`), fullPage: largura < 600 });
    if (largura < 600) {
      const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      checa(sobra <= 1, `${largura} ${rotulo}: a página rola na horizontal (${sobra}px)`);
    }
    const n0 = await pag.evaluate(() => estProducoes().length);
    await pag.locator(".modal-foot .btn-primary", { hasText: "Registrar produção" }).click();
    await pag.waitForTimeout(300);
    const gravado = await pag.evaluate((n0) => {
      const p = estProducoes()[estProducoes().length - 1];
      if (estProducoes().length === n0) return null;
      const movs = estMovs().filter((m) => m.origem === "producao" && m.refId === p.id);
      return { armDe: p.armDe, armPara: p.armPara, saidas: [...new Set(movs.filter((m) => m.q < 0).map((m) => m.arm))], entradas: [...new Set(movs.filter((m) => m.q > 0).map((m) => m.arm))] };
    }, n0);
    return { tela, gravado };
  };

  // 1) chefe da produção
  await perfil({ perms: ["estoque"], nivel: "chefe", setores: ["producao"], nome: "Chefe Produção" });
  let r = await registrar("chefe", true);
  checa(r.tela.de && r.tela.de.v === r.tela.draftDe, `${largura} chefe: a tela mostra origem ${r.tela.de && r.tela.de.v}, o rascunho tem ${r.tela.draftDe}`);
  checa(r.tela.para && r.tela.para.v === r.tela.draftPara, `${largura} chefe: a tela mostra destino ${r.tela.para && r.tela.para.v}, o rascunho tem ${r.tela.draftPara}`);
  checa(r.tela.de && JSON.stringify(r.tela.de.ops) === '["producao"]', `${largura} chefe: a origem oferece ${JSON.stringify(r.tela.de && r.tela.de.ops)}`);
  checa(r.gravado, `${largura} chefe: não registrou a produção`);
  if (r.gravado) {
    checa(r.gravado.armDe === "producao" && r.gravado.armPara === "producao", `${largura} chefe: gravou ${r.gravado.armDe} → ${r.gravado.armPara}, a tela mostrava Produção → Produção`);
    checa(JSON.stringify(r.gravado.saidas) === '["producao"]', `${largura} chefe: o bruto saiu de ${JSON.stringify(r.gravado.saidas)}`);
    checa(JSON.stringify(r.gravado.entradas) === '["producao"]', `${largura} chefe: o porcionado entrou em ${JSON.stringify(r.gravado.entradas)}`);
  }
  // pela função direta: rascunho com armazém fora do setor é recusado
  const recusa = await pag.evaluate((id) => {
    const n0 = estProducoes().length;
    estProdDraft = null; estProducaoModal(id); estProdDraft.armDe = EST_ARM_PRINCIPAL; estProducaoSalvar();
    const a = estProducoes().length - n0;
    closeModal(); estProdDraft = null; estProducaoModal(id); estProdDraft.armPara = "churrascaria"; estProducaoSalvar();
    const b = estProducoes().length - n0;
    closeModal(); estProdDraft = null;
    return { a, b };
  }, subId);
  checa(recusa.a === 0, `${largura} chefe: gravou produção tirando o bruto do principal`);
  checa(recusa.b === 0, `${largura} chefe: gravou produção pondo o porcionado na Churrascaria`);
  // pela ordem de produção (o rascunho vem do opProduzir)
  const op = await pag.evaluate((id) => {
    DB.ordensProducao = [{ id: "op-p", data: hojeISO(), para: "producao", itens: [{ subId: id, qtdUni: 2, produzido: 0 }], obs: "" }];
    estProdDraft = null; opProduzir("op-p", 0);
    return { de: estProdDraft.armDe, para: estProdDraft.armPara, tela: document.querySelector("#pr_para").value };
  }, subId);
  checa(op.de === "producao" && op.para === "producao" && op.tela === op.para, `${largura} chefe pela ordem: rascunho ${op.de} → ${op.para}, tela ${op.tela}`);
  await perfil({ perms: null, nivel: "", setores: null, nome: "" });

  // 2) dono: padrão de hoje (principal → estoque de vendas)
  r = await registrar("dono", false);
  checa(r.tela.draftDe === "principal" && r.tela.draftPara === "churrascaria", `${largura} dono: rascunho ${r.tela.draftDe} → ${r.tela.draftPara}`);
  checa(r.gravado && r.gravado.armDe === "principal" && r.gravado.armPara === "churrascaria", `${largura} dono: gravou ${JSON.stringify(r.gravado)}`);

  checa(!erros.length, `${largura}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${largura}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

await rodar(1280);
await rodar(390);
await nav.close();
srv.close();
if (falhas.length) { console.error("producao-setor: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`producao-setor: ok (prints em ${PRINTS})`);
