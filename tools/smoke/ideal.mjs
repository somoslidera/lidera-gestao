// Teste da trava do estoque ideal e crítico: só dono, Lidera, administrador da equipe
// ou quem tem a permissão "Alterar estoque ideal e crítico" marcada.
// Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node ideal.mjs
//
// Simula os perfis só no navegador, trocando MEMBRO_PERMS / MEMBRO_NIVEL / MEMBRO_SUB.
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

// perfis: [nome, perms (null = dono), nivel, sub, pode?]
const PERFIS = [
  ["dono", null, "", null, true],
  ["admin da equipe", ["estoque", "insumos"], "admin", null, true],
  ["gerente (modelo do nível)", ["estoque", "insumos"], "gerente", "SUB_OPER", false],
  ["personalizado antigo (sem a chave)", ["estoque", "insumos"], "personalizado", { posicao: true, mov: true, compras: true }, false],
  ["personalizado com a chave", ["estoque", "insumos"], "personalizado", { posicao: true, ideal_editar: true }, true],
];

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => d.dismiss());
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // modelos dos níveis
  const niv = await pag.evaluate(() => ({ g: NIVEIS.gerente.sub.ideal_editar, o: NIVEIS.operador.sub.ideal_editar, a: NIVEIS.admin.sub.ideal_editar, tem: ESTOQUE_SUBS.some(([k]) => k === "ideal_editar") }));
  checa(niv.tem, `${largura}: falta a chave ideal_editar em ESTOQUE_SUBS`);
  checa(niv.g === false && niv.o === false, `${largura}: gerente/operador ganharam ideal_editar pelo modelo`);
  checa(niv.a === true, `${largura}: admin perdeu ideal_editar no modelo`);

  for (const [nome, perms, nivel, sub, pode] of PERFIS) {
    const r = await pag.evaluate(({ perms, nivel, sub }) => {
      MEMBRO_PERMS = perms; MEMBRO_NIVEL = nivel; MEMBRO_SETORES = null;
      MEMBRO_SUB = sub === "SUB_OPER" ? Object.assign({}, SUB_OPER) : sub;
      const ins = Object.values(DB.insumos).find((i) => estEstocavel(i) && i.noEstoque !== false && i.tipo !== "preparado");
      ins.estoqueMin = 7; ins.estoqueCrit = 2;
      estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueUniF = ""; estoqueKpiF = "";
      go("estoque");
      const campos = document.querySelectorAll('#estoqueTbody input[oninput*="estIdealSet"]').length;
      estIdealSet(ins.id, "estoqueMin", "99");
      const depoisPosicao = ins.estoqueMin;
      editInsumo(ins.id);
      const trav = !!(document.querySelector("#i_estmin") && document.querySelector("#i_estmin").disabled);
      const cmp = document.querySelector("#i_estmin"); if (cmp) { cmp.disabled = false; cmp.value = "55"; }
      saveInsumo(ins.id);
      const depoisCadastro = DB.insumos[ins.id].estoqueMin;
      typeof closeModal === 'function' && closeModal();
      return { campos, depoisPosicao, trav, depoisCadastro, podeIdeal: podeIdeal() };
    }, { perms, nivel, sub });
    checa(r.podeIdeal === pode, `${largura} ${nome}: podeIdeal()=${r.podeIdeal}, esperado ${pode}`);
    if (pode) {
      checa(r.campos > 0, `${largura} ${nome}: sem campo de ideal na Posição`);
      checa(r.depoisPosicao === 99, `${largura} ${nome}: não gravou pela Posição`);
      checa(!r.trav, `${largura} ${nome}: campo travado no cadastro`);
      checa(r.depoisCadastro === 55, `${largura} ${nome}: não gravou pelo cadastro (${r.depoisCadastro})`);
    } else {
      checa(r.campos === 0, `${largura} ${nome}: campo de ideal editável na Posição (${r.campos})`);
      checa(r.depoisPosicao === 7, `${largura} ${nome}: gravou pela Posição (${r.depoisPosicao})`);
      checa(r.trav, `${largura} ${nome}: campo não travado no cadastro`);
      checa(r.depoisCadastro === 7, `${largura} ${nome}: gravou pelo cadastro mesmo travado (${r.depoisCadastro})`);
    }
    if (nome.startsWith("gerente")) {
      await pag.evaluate(() => { estoqueTab = "contagem"; go("estoque"); });
      await pag.waitForTimeout(300);
      await pag.screenshot({ path: join(PRINTS, `ideal-travado-${largura}.png`), fullPage: largura < 600 });
    }
  }
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
if (falhas.length) { console.error("ideal: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`ideal: ok (prints em ${PRINTS})`);
