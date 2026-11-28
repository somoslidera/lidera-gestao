// Teste da margem % sobre a "Média do dia da semana" na requisição (Estoque → Requisições).
// Média conhecida × 1,2 = esperado; trocar 20% → 40% não acumula; voltar a 0% devolve a média;
// prato digitado à mão fica fora da margem; "Repetir a última" não leva margem. Em 1280 e 390 px.
//
//   python3 ../preview_build.py && node req-margem.mjs
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
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // cenário: principal + Cozinha; vendas de 2 semanas no mesmo dia da semana → média A=10, B=25, C=7
  const ids = await pag.evaluate(() => {
    DB.fin.armazens = [{ id: EST_ARM_PRINCIPAL, nome: "Estoque principal" }, { id: "cozinha", nome: "Cozinha" }];
    estCfg().armVendas = "cozinha";
    const [a, b, c] = fichasVendaveis().slice().sort((x, y) => (x.cat || "").localeCompare(y.cat || "") || x.nome.localeCompare(y.nome));
    const h = hojeISO();
    DB.vendasBaixa = [
      { id: "vb1", data: diasSoma(h, -7), itens: [{ fichaId: a.id, qtd: 10 }, { fichaId: b.id, qtd: 20 }, { fichaId: c.id, qtd: 7 }] },
      { id: "vb2", data: diasSoma(h, -14), itens: [{ fichaId: a.id, qtd: 10 }, { fichaId: b.id, qtd: 30 }, { fichaId: c.id, qtd: 7 }] },
    ];
    // requisição anterior, para o "Repetir a última"
    DB.requisicoes = [{ id: "rq-ant", data: diasSoma(h, -7), turno: "dia", de: EST_ARM_PRINCIPAL, para: "cozinha", status: "retirada", pratos: [[a.id, 3], [b.id, 4]], itens: [], obs: "", criadoEm: new Date().toISOString(), transfId: "", por: "Outro" }];
    estoqueTab = "requisicoes"; go("estoque"); estReqNova();
    return { a: a.id, b: b.id, c: c.id, r: estReqSel };
  });
  await pag.waitForTimeout(300);
  const pratos = () => pag.evaluate((ids) => { const r = DB.requisicoes.find((x) => x.id === ids.r); const m = Object.fromEntries(r.pratos); return { a: m[ids.a] || 0, b: m[ids.b] || 0, c: m[ids.c] || 0, margem: r.margem || 0, painel: !!document.querySelector(".rq-margem"), tela: document.querySelector(`#rq_pratos input[onchange*="'${ids.a}'"]`)?.value }; }, ids);
  const esperado = (p, a, b, c, msg) => checa(p.a === a && p.b === b && p.c === c, `${largura} ${msg}: A=${p.a} B=${p.b} C=${p.c}, esperado ${a}/${b}/${c}`);

  checa(!(await pratos()).painel, `${largura}: a margem aparece antes de usar a média`);
  await pag.getByRole("button", { name: "Média do dia da semana" }).click();
  await pag.waitForTimeout(300);
  let p = await pratos();
  esperado(p, 10, 25, 7, "média");
  checa(p.painel && p.margem === 0, `${largura}: depois da média, painel=${p.painel} margem=${p.margem} (esperado painel e 0%)`);
  const botoes = await pag.locator(".rq-margem [data-margem]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  checa(JSON.stringify(botoes) === JSON.stringify(["+10%", "+20%", "+30%", "+40%", "+50%", "+60%"]), `${largura}: atalhos ${JSON.stringify(botoes)}`);
  checa(await pag.locator('.rq-margem input[type="range"][min="0"][max="100"]').count() === 1, `${largura}: falta a barra de 0 a 100%`);
  if (!botoes.length) { await ctx.close(); return; }   // sem o painel, o resto não tem como rodar

  await pag.locator('.rq-margem [data-margem="20"]').click();
  await pag.waitForTimeout(300);
  p = await pratos();
  esperado(p, 12, 30, 9, "+20%");   // 10×1,2=12 · 25×1,2=30 · 7×1,2=8,4 → 9 (para cima)
  checa(p.tela === "12", `${largura}: a tela mostra ${p.tela} para A com +20%`);
  checa(/\+20%/.test(await pag.locator("#rq_margem_v").innerText()), `${largura}: o valor da barra não mostra +20%`);
  await pag.screenshot({ path: join(PRINTS, `req-margem-${largura}.png`), fullPage: largura < 600 });

  await pag.locator('.rq-margem [data-margem="40"]').click();
  await pag.waitForTimeout(300);
  p = await pratos();
  esperado(p, 14, 35, 10, "20% → 40% (não acumula)");   // 10×1,4 · 25×1,4 · 7×1,4=9,8 → 10

  // barra de arrastar: 0% volta à média; 25% recalcula da média
  const arrasta = async (v) => { await pag.locator("#rq_margem").fill(String(v)); await pag.waitForTimeout(300); };
  await arrasta(0);
  p = await pratos();
  esperado(p, 10, 25, 7, "barra em 0%");
  await arrasta(25);
  p = await pratos();
  esperado(p, 13, 32, 9, "barra em 25%");   // 12,5→13 · 31,25→32 · 8,75→9
  checa(/\+25%/.test(await pag.locator("#rq_margem_v").innerText()), `${largura}: o valor da barra não mostra +25%`);

  // prato digitado à mão fica fora da margem
  await pag.evaluate((ids) => estReqPrato(ids.r, ids.a, "50"), ids);
  await pag.evaluate((ids) => estReqMargem(ids.r, 10), ids);
  p = await pratos();
  esperado(p, 50, 28, 8, "à mão + 10%");   // A fica 50 · 27,5→28 · 7,7→8

  // "Repetir a última" copia sem margem e some com o painel
  await pag.getByRole("button", { name: "Repetir a última" }).click();
  await pag.waitForTimeout(300);
  p = await pratos();
  esperado(p, 3, 4, 0, "Repetir a última");
  checa(!p.painel && p.margem === 0, `${largura}: depois de Repetir a última, painel=${p.painel} margem=${p.margem}`);

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
if (falhas.length) { console.error("req-margem: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`req-margem: ok (prints em ${PRINTS})`);
