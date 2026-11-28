// Teste do topo da aba Estoque → Posição (#48): três faixas, de cima para baixo,
//   1. KPIs de valor (.kpi-grid.kpi5)
//   2. status e alertas (#estPosStatus), com os chips Conferir embalagem, Preço subiu e Total em kg
//   3. uma barra de filtros só (#estPosBar), com "Colunas: Essencial · Completa" na mesma linha no computador
// Em 1440 e 1280 px nenhuma faixa fica com metade da largura vazia; em 390 px a ordem é a mesma e a página
// não rola de lado. Os chips filtram e limpam como os cartões de antes; sem podeVerValores() não há
// "Preço subiu" nem valores. Roda contra o _site/ (sem banco).
//
//   python3 ../preview_build.py && node posicao-topo.mjs
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

// mede as três faixas: posição, e para cada linha visual de itens, quanto da largura da faixa ela ocupa
const mede = () => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width }; };
  const linhas = (el, itens) => {
    if (!el) return [];
    const fx = el.getBoundingClientRect();
    const L = [];
    itens.filter((x) => x.offsetParent).forEach((x) => {
      const b = x.getBoundingClientRect();
      // mesma linha visual = se sobrepõem na vertical (itens centralizados com alturas diferentes)
      let l = L.find((q) => b.top < q.bottom - 2 && b.bottom > q.top + 2);
      if (!l) { l = { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; L.push(l); }
      l.left = Math.min(l.left, b.left); l.right = Math.max(l.right, b.right);
      l.top = Math.min(l.top, b.top); l.bottom = Math.max(l.bottom, b.bottom);
    });
    return L.map((l) => ({ top: Math.round(l.top), ocupa: (l.right - l.left) / fx.width }));
  };
  const kpis = document.querySelector("#view .kpi-grid.kpi5") || document.querySelector("#view .kpi-grid");
  const status = document.getElementById("estPosStatus");
  const barra = document.getElementById("estPosBar");
  const cols = document.getElementById("estPosCols");
  const tab = document.querySelector("table.est-pos");
  const itensBarra = barra ? [...barra.children] : [];
  return {
    kpis: r(kpis), status: r(status), barra: r(barra), cols: r(cols), tab: r(tab && tab.closest(".card")),
    colsNaBarra: !!(barra && cols && barra.contains(cols)),
    primeiroFiltro: r(itensBarra[0]),
    linhasKpi: linhas(kpis, kpis ? [...kpis.children] : []),
    linhasStatus: linhas(status, status ? [...status.children] : []),
    linhasBarra: linhas(barra, itensBarra),
    cartaoAntigo: [...document.querySelectorAll("#view .kpi")].some((k) => /Conferir embalagem|Preço subiu|Total em kg/.test(k.textContent)),
    chips: [...document.querySelectorAll("#estPosStatus .est-chip")].map((c) => c.dataset.kpif),
    sobra: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  await pag.waitForTimeout(1500);

  // caso de teste só no navegador: um produto que entrou em CX sem embalagem (Conferir embalagem) e um com preço subindo
  const caso = await pag.evaluate(() => {
    const ins = Object.values(DB.insumos).filter((i) => estEstocavel(i) && i.noEstoque !== false && i.uni === "kg");
    const [b, c] = ins;
    delete b.embNome; b.embQtd = 0; b.estoqueAtual = 5;
    DB.lancamentos.push({ id: "t-topo-sememb", data: hojeISO(), grupo: "CMV", valor: 50, insumoId: b.id, qtd: 2, uni: "CX" });
    c.cmp = 10; c.preco = 13; c.qtd = 1;
    estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueUniF = ""; estoqueKpiF = ""; estoqueCmvF = "todos";
    document.documentElement.style.scrollBehavior = "auto";
    go("estoque");
    return { cat: b.cat, b: b.nome, c: c.nome };
  });
  await pag.waitForTimeout(500);

  const confere = async (rot) => {
    const m = await pag.evaluate(mede);
    checa(m.status && m.barra, `${largura} ${rot}: faltou a faixa de status (#estPosStatus) ou a barra de filtros (#estPosBar)`);
    checa(!m.cartaoAntigo, `${largura} ${rot}: Conferir embalagem / Preço subiu / Total em kg ainda são cartões de KPI soltos`);
    checa(m.colsNaBarra, `${largura} ${rot}: "Colunas" não está dentro da barra de filtros`);
    // ordem de cima para baixo: KPIs, status, filtros, tabela
    if (m.kpis && m.status && m.barra && m.tab)
      checa(m.kpis.bottom <= m.status.top + 1 && m.status.bottom <= m.barra.top + 1 && m.barra.bottom <= m.tab.top + 1,
        `${largura} ${rot}: ordem das faixas trocada (kpis ${m.kpis.top}, status ${m.status.top}, filtros ${m.barra.top}, tabela ${m.tab.top})`);
    if (largura >= 1200) {
      // nenhuma faixa com metade da largura vazia (cada linha de itens ocupa pelo menos metade da faixa)
      [["KPIs", m.linhasKpi], ["status", m.linhasStatus], ["filtros", m.linhasBarra]].forEach(([n, L]) =>
        L.forEach((l, i) => checa(l.ocupa >= 0.5, `${largura} ${rot}: linha ${i + 1} da faixa ${n} ocupa só ${Math.round(l.ocupa * 100)}% da largura`)));
      checa(m.linhasBarra.length === 1, `${largura} ${rot}: a barra de filtros quebrou em ${m.linhasBarra.length} linhas`);
      if (m.cols && m.primeiroFiltro) checa(Math.abs(m.cols.top - m.primeiroFiltro.top) < 10, `${largura} ${rot}: "Colunas" não está na mesma linha dos filtros`);
    }
    checa(m.sobra <= 1, `${largura} ${rot}: a página rola na horizontal (${m.sobra}px)`);
    return m;
  };

  let m = await confere("sem categoria");
  console.log(`  ${largura}: linhas KPIs ${m.linhasKpi.length} · status ${m.linhasStatus.length} · filtros ${m.linhasBarra.length} · chips ${m.chips.join(",")}`);
  checa(m.chips.includes("confemb") && m.chips.includes("preco") && !m.chips.includes("kg"), `${largura}: chips sem categoria ${JSON.stringify(m.chips)} (esperado confemb e preco, sem kg)`);
  await pag.screenshot({ path: join(PRINTS, `posicao-topo-${largura}.png`), fullPage: largura < 600 });

  // chips filtram e limpam como antes
  const chip = (k) => pag.locator(`#estPosStatus .est-chip[data-kpif="${k}"]`);
  if (await chip("confemb").count()) {
    await chip("confemb").click(); await pag.waitForTimeout(250);
    const f = await pag.evaluate(() => ({ k: estoqueKpiF, n: (window.EST_POS_FILT || []).map((x) => x.nome), on: document.querySelector('#estPosStatus .est-chip[data-kpif="confemb"]').classList.contains("on") }));
    checa(f.k === "confemb" && f.on && f.n.includes(caso.b), `${largura}: chip Conferir embalagem não filtrou (${JSON.stringify(f)})`);
    await chip("confemb").click(); await pag.waitForTimeout(250);
    checa(await pag.evaluate(() => estoqueKpiF === ""), `${largura}: clicar de novo em Conferir embalagem não limpou`);
  }
  if (await chip("preco").count()) {
    await chip("preco").click(); await pag.waitForTimeout(250);
    const f = await pag.evaluate(() => ({ k: estoqueKpiF, n: (window.EST_POS_FILT || []).map((x) => x.nome) }));
    checa(f.k === "preco" && f.n.includes(caso.c), `${largura}: chip Preço subiu não filtrou (${JSON.stringify(f)})`);
    await confere("Preço subiu ligado");
    await pag.screenshot({ path: join(PRINTS, `posicao-topo-preco-${largura}.png`), fullPage: largura < 600 });
    await chip("preco").click(); await pag.waitForTimeout(250);
    checa(await pag.evaluate(() => estoqueKpiF === ""), `${largura}: clicar de novo em Preço subiu não limpou`);
  }

  // com categoria: chip Total em kg
  await pag.evaluate((cat) => { estoqueFiltro = cat; viewEstoque(); }, caso.cat);
  await pag.waitForTimeout(300);
  m = await confere("com categoria");
  checa(m.chips.includes("kg"), `${largura}: Total em kg não apareceu com categoria`);
  if (await chip("kg").count()) {
    await chip("kg").click(); await pag.waitForTimeout(250);
    const u = await pag.evaluate(() => ({ f: estoqueUniF, u: (window.EST_POS_FILT || []).map((x) => x.uni) }));
    checa(u.f === "kg" && u.u.length > 0 && u.u.every((x) => x === "kg"), `${largura}: Total em kg não filtrou só kg`);
    await pag.screenshot({ path: join(PRINTS, `posicao-topo-kg-${largura}.png`), fullPage: largura < 600 });
    await chip("kg").click(); await pag.waitForTimeout(250);
    checa(await pag.evaluate(() => estoqueUniF === ""), `${largura}: clicar de novo em Total em kg não limpou`);
  }
  await pag.evaluate(() => { estoqueFiltro = "Todos"; viewEstoque(); });

  // filtro de unidade é uma lista (como Categoria), dentro da barra; escolher kg filtra só kg e "Todas" limpa
  const ud = await pag.evaluate(() => {
    const dd = document.querySelector("#estPosBar #estUniDd");
    if (!dd) return { tem: false };
    mselChama("estUniDd", "kg");
    const u = (window.EST_POS_FILT || []).map((x) => x.uni), f = estoqueUniF, rot = (document.querySelector("#estUniDd .v") || {}).textContent;
    mselChama("estUniDd", "");
    return { tem: true, f, u, rot, limpo: estoqueUniF === "" };
  });
  checa(ud.tem, `${largura}: a lista "Unidade" não está na barra de filtros`);
  if (ud.tem) {
    checa(ud.f === "kg" && ud.u.length > 0 && ud.u.every((x) => x === "kg"), `${largura}: Unidade = kg não filtrou só kg`);
    checa(/kg/.test(ud.rot || ""), `${largura}: a lista "Unidade" não mostra kg escolhido (${ud.rot})`);
    checa(ud.limpo, `${largura}: Unidade = Todas não limpou o filtro`);
  }

  // sem podeVerValores(): sem Preço subiu e sem valores em reais no topo
  const sv = await pag.evaluate(() => {
    MEMBRO_PERMS = ["estoque"]; MEMBRO_SUB = { posicao: true, valores: false };
    viewEstoque();
    const chips = [...document.querySelectorAll("#estPosStatus .est-chip")].map((c) => c.dataset.kpif);
    const st = document.getElementById("estPosStatus");
    const topo = [...document.querySelectorAll("#view .kpi-grid")].map((g) => g.textContent).join(" ") + " " + (st ? st.textContent : "");
    return { chips, reais: /R\$/.test(topo.replace(/divergência[^|]*/g, "")) };
  });
  checa(!sv.chips.includes("preco"), `${largura}: sem valores, o chip Preço subiu aparece`);
  checa(sv.chips.includes("confemb"), `${largura}: sem valores, o chip Conferir embalagem sumiu`);
  checa(!sv.reais, `${largura}: sem valores, aparece valor em reais no topo`);
  await confere("sem valores");
  await pag.screenshot({ path: join(PRINTS, `posicao-topo-semvalores-${largura}.png`), fullPage: largura < 600 });
  await pag.evaluate(() => { MEMBRO_PERMS = null; MEMBRO_SUB = null; viewEstoque(); });

  checa(!erros.length, `${largura}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${largura}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

for (const l of [1440, 1280, 390]) await rodar(l);
await nav.close();
srv.close();
if (falhas.length) { console.error("posicao-topo: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`posicao-topo: ok (prints em ${PRINTS})`);
