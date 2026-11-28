// Teste da produção por setor. O perfil entra pelo flowSim (mesmo trecho do login de membro).
// - Chefe da produção (nível "producao", setor de produção + um de vendas): grava o que a tela mostra
//   (bruto sai da Produção, porcionado entra na Produção), também pela ordem de produção.
// - Origem/destino fora dos setores dele são recusados, inclusive setor apagado e select adulterado,
//   e a recusa vem antes do aviso de "Quantidade fora do comum".
// - Chefe de setor (sem a permissão "producao"): não vê o botão e não grava.
// - Personalizado com permissão, só com setor de vendas: sem saldo lá, avisa e não abre; com saldo, usa o setor dele.
// - Sem setor nenhum: avisa e não abre.
// - Dono continua com o padrão (principal → estoque de vendas). Roda contra o _site/ (sem banco), em 1280 e 390 px.
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
  let dialogos = 0;
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => { dialogos++; d.accept(); });
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForFunction(() => window.flowSim && typeof DB === "object" && DB.insumos && Object.keys(DB.insumos).length > 0);

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
    save();
    return prep.id;
  });

  const perfil = async (st) => {
    const ok = await pag.evaluate((st) => { closeModal && closeModal(); estProdDraft = null; return window.flowSim.aplicar(st); }, st);
    checa(ok, `${largura}: flowSim não aplicou ${JSON.stringify(st)}`);
    await pag.waitForFunction(() => MEMBRO_PERMS !== null);
  };
  const abrir = async (id) => {
    await pag.evaluate((id) => { closeModal(); estProdDraft = null; estoqueTab = "producao"; go("estoque"); estProducaoModal(id); }, id);
    return pag.evaluate(() => !!document.querySelector("#pr_qtd"));
  };
  const ultimoToast = () => pag.evaluate(() => { const t = [...document.querySelectorAll("#toastRoot .toast")]; return t.length ? t[t.length - 1].textContent : ""; });

  // abre a janela, lê o que a tela mostra e o rascunho, e registra pelo botão
  const registrar = async (rotulo, print) => {
    await pag.evaluate((id) => { closeModal(); estProdDraft = null; estoqueTab = "producao"; go("estoque"); estProducaoModal(id); }, subId);
    await pag.waitForSelector("#pr_qtd");
    const tela = await pag.evaluate(() => {
      const sel = (id) => { const s = document.querySelector("#" + id); return s ? { v: s.value, ops: [...s.options].map((o) => o.value) } : null; };
      return { de: sel("pr_de"), para: sel("pr_para"), draftDe: estProdDraft.armDe, draftPara: estProdDraft.armPara };
    });
    if (print) await pag.screenshot({ path: join(PRINTS, `producao-setor-${rotulo}-${largura}.png`), fullPage: largura < 600 });
    if (largura < 600) {
      const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      checa(sobra <= 1, `${largura} ${rotulo}: a página rola na horizontal (${sobra}px)`);
    }
    const n0 = await pag.evaluate(() => estProducoes().length);
    await pag.locator(".modal-foot .btn-primary", { hasText: "Registrar produção" }).click();
    await pag.waitForFunction((n0) => estProducoes().length > n0, n0, { timeout: 3000 }).catch(() => {});
    const gravado = await pag.evaluate((n0) => {
      if (estProducoes().length === n0) return null;
      const p = estProducoes()[estProducoes().length - 1];
      const movs = estMovs().filter((m) => m.origem === "producao" && m.refId === p.id);
      return { armDe: p.armDe, armPara: p.armPara, saidas: [...new Set(movs.filter((m) => m.q < 0).map((m) => m.arm))], entradas: [...new Set(movs.filter((m) => m.q > 0).map((m) => m.arm))] };
    }, n0);
    return { tela, gravado };
  };

  // 1) dono: padrão de hoje (principal → estoque de vendas)
  let r = await registrar("dono", false);
  checa(r.tela.draftDe === "principal" && r.tela.draftPara === "churrascaria", `${largura} dono: rascunho ${r.tela.draftDe} → ${r.tela.draftPara}`);
  checa(r.gravado && r.gravado.armDe === "principal" && r.gravado.armPara === "churrascaria", `${largura} dono: gravou ${JSON.stringify(r.gravado)}`);

  // 2) chefe da produção (nível de verdade), com setor de produção e um de vendas
  await perfil({ nivel: "producao", setores: ["producao", "churrascaria"] });
  r = await registrar("producao", true);
  checa(r.tela.de && r.tela.de.v === r.tela.draftDe, `${largura} produção: a tela mostra origem ${r.tela.de && r.tela.de.v}, o rascunho tem ${r.tela.draftDe}`);
  checa(r.tela.para && r.tela.para.v === r.tela.draftPara, `${largura} produção: a tela mostra destino ${r.tela.para && r.tela.para.v}, o rascunho tem ${r.tela.draftPara}`);
  checa(r.tela.de && JSON.stringify(r.tela.de.ops) === '["producao","churrascaria"]', `${largura} produção: a origem oferece ${JSON.stringify(r.tela.de && r.tela.de.ops)}`);
  checa(r.tela.draftDe === "producao", `${largura} produção: origem ${r.tela.draftDe}, esperado o setor de produção`);
  checa(r.gravado, `${largura} produção: não registrou a produção`);
  if (r.gravado) {
    checa(r.gravado.armDe === r.tela.de.v && r.gravado.armPara === r.tela.para.v, `${largura} produção: gravou ${r.gravado.armDe} → ${r.gravado.armPara}, a tela mostrava ${r.tela.de.v} → ${r.tela.para.v}`);
    checa(JSON.stringify(r.gravado.saidas) === JSON.stringify([r.tela.de.v]), `${largura} produção: o bruto saiu de ${JSON.stringify(r.gravado.saidas)}`);
    checa(JSON.stringify(r.gravado.entradas) === JSON.stringify([r.tela.para.v]), `${largura} produção: o porcionado entrou em ${JSON.stringify(r.gravado.entradas)}`);
  }
  // select adulterado com o principal e quantidade fora do comum: recusa antes do confirm
  checa(await abrir(subId), `${largura} produção: a janela não abriu`);
  dialogos = 0;
  const adult = await pag.evaluate(() => {
    const n0 = estProducoes().length; const s = document.querySelector("#pr_de");
    const o = document.createElement("option"); o.value = EST_ARM_PRINCIPAL; o.textContent = "Estoque principal"; s.appendChild(o); s.value = EST_ARM_PRINCIPAL;
    const sub = DB.insumos[estProdDraft.subId]; document.querySelector("#pr_qtd").value = String((+sub.rendimento || 1) * 100);
    estProducaoSalvar(); return estProducoes().length - n0;
  });
  checa(adult === 0, `${largura} produção: gravou com a origem adulterada para o principal`);
  checa(dialogos === 0, `${largura} produção: o aviso de quantidade apareceu antes da recusa de setor`);
  // rascunho com armazém fora do setor e sem a janela aberta: recusa
  const recusa = await pag.evaluate((id) => {
    const n0 = estProducoes().length;
    closeModal(); estProdDraft = null; estProducaoModal(id); closeModal(); estProdDraft.armPara = "churrascaria"; estProdDraft.armDe = EST_ARM_PRINCIPAL; estProducaoSalvar();
    return estProducoes().length - n0;
  }, subId);
  checa(recusa === 0, `${largura} produção: gravou produção tirando o bruto do principal`);
  // pela ordem de produção (o rascunho vem do opProduzir)
  const op = await pag.evaluate((id) => {
    closeModal(); DB.ordensProducao = [{ id: "op-p", data: hojeISO(), para: "producao", itens: [{ subId: id, qtdUni: 2, produzido: 0 }], obs: "" }];
    estProdDraft = null; opProduzir("op-p", 0);
    return { de: estProdDraft.armDe, para: estProdDraft.armPara, telaDe: document.querySelector("#pr_de").value, telaPara: document.querySelector("#pr_para").value };
  }, subId);
  checa(op.de === "producao" && op.telaDe === op.de && op.telaPara === op.para && ["producao", "churrascaria"].includes(op.para), `${largura} produção pela ordem: rascunho ${op.de} → ${op.para}, tela ${op.telaDe} → ${op.telaPara}`);

  // 3) setor apagado no cadastro do membro: não vale como setor
  await perfil({ nivel: "producao", setores: ["apagado", "producao"] });
  const apag = await pag.evaluate((id) => {
    closeModal(); estProdDraft = null; estProducaoModal(id); closeModal();
    estProdDraft.armDe = "apagado"; estProdDraft.armPara = "apagado"; estProducaoModal(id);   // mesmo subproduto: o rascunho fica
    const r = { de: estProdDraft.armDe, para: estProdDraft.armPara, ops: [...document.querySelector("#pr_de").options].map((o) => o.value) };
    closeModal(); estProdDraft.armDe = "apagado"; const n0 = estProducoes().length; estProducaoSalvar(); r.gravou = estProducoes().length - n0;
    return r;
  }, subId);
  checa(apag.de === "producao" && apag.para === "producao", `${largura} setor apagado: rascunho ficou ${apag.de} → ${apag.para}`);
  checa(JSON.stringify(apag.ops) === '["producao"]', `${largura} setor apagado: a origem oferece ${JSON.stringify(apag.ops)}`);
  checa(apag.gravou === 0, `${largura} setor apagado: gravou produção com origem no setor apagado`);

  // 4) chefe de setor: sem a permissão "producao"
  await perfil({ nivel: "chefe", setores: ["producao"] });
  const chefe = await pag.evaluate((id) => {
    closeModal(); estProdDraft = null; estKardex(id); const botaoKardex = [...document.querySelectorAll(".modal button")].some((b) => /Produzir/.test(b.textContent));
    closeModal(); estProdDraft = null; estProducaoModal(id); const abriu = !!document.querySelector("#pr_qtd");
    const rd = +DB.insumos[id].rendimento || 1; estProdDraft = { subId: id, data: hojeISO(), qtd: rd, armDe: "producao", armPara: "producao", comps: estReceitaPara(DB.insumos[id], rd).map((x) => ({ insumoId: x.insumoId, q: x.q })), obs: "", forn: "" };
    const n0 = estProducoes().length; estProducaoSalvar(); const gravou = estProducoes().length - n0; estProdDraft = null;
    return { botaoKardex, abriu, gravou, aba: estAbasPermitidas().some(([k]) => k === "producao") };
  }, subId);
  checa(!chefe.botaoKardex, `${largura} chefe: o kardex mostra "Produzir"`);
  checa(!chefe.abriu, `${largura} chefe: a janela de produção abriu`);
  checa(chefe.gravou === 0, `${largura} chefe: gravou produção sem a permissão`);
  checa(!chefe.aba, `${largura} chefe: vê a aba Produção`);

  // 5) personalizado com a permissão, só com setor de vendas
  await perfil({ nivel: "personalizado", permissoes: ["estoque"], setores: ["churrascaria"] });
  checa(!(await abrir(subId)), `${largura} só vendas sem saldo: a janela abriu`);
  checa(/não tem setor de produção vinculado/.test(await ultimoToast()), `${largura} só vendas sem saldo: aviso "${await ultimoToast()}"`);
  await pag.evaluate((id) => {
    const c = estReceitaPara(DB.insumos[id], 1).map((x) => DB.insumos[x.insumoId]).find((i) => i && estEstocavel(i));
    estMov("entrada", c.id, 10, { arm: "churrascaria", origem: "simulacao", obs: "teste" });
  }, subId);
  checa(await abrir(subId), `${largura} só vendas com saldo: a janela não abriu`);
  const sv = await pag.evaluate(() => ({ de: estProdDraft.armDe, para: estProdDraft.armPara, telaDe: document.querySelector("#pr_de").value }));
  checa(sv.de === "churrascaria" && sv.para === "churrascaria" && sv.telaDe === sv.de, `${largura} só vendas com saldo: ${JSON.stringify(sv)}`);

  // 6) sem setor nenhum
  await perfil({ nivel: "producao", setores: [] });
  checa(!(await abrir(subId)), `${largura} sem setor: a janela abriu`);
  checa(/não tem setor vinculado/.test(await ultimoToast()), `${largura} sem setor: aviso "${await ultimoToast()}"`);

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
