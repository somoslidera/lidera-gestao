// Baixa com a forma e a data reais (#25, parte B): critério de aceite da issue, na Demo (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node baixa.mjs
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
  const erros = [], banco = [], dialogos = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("dialog", (d) => { dialogos.push(d.message()); d.dismiss(); });
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  const ontem = await pag.evaluate(() => diasSoma(hojeISO(), -1));
  await pag.evaluate(() => {
    go("financeiro");
    const g = Object.keys(DB.categorias).find((x) => x !== "CMV" && grupoTipo(x) !== "receita");
    DB.lancamentos = (DB.lancamentos || []).filter((l) => !/^bx/.test(l.id));
    const mk = (id, nf, desc) => ({ id, data: diasSoma(hojeISO(), -20), grupo: g, sub: "", descricao: desc, nfe: nf, fornecedor: "Fornecedor teste", valor: 200, forma: "Boleto",
      liquidacoes: [{ data: diasSoma(hojeISO(), -2), valor: 100, pago: false }, { data: diasSoma(hojeISO(), 28), valor: 100, pago: false }] });
    DB.lancamentos.push(mk("bx1", "B-25", "Conta a prazo"), mk("bx2", "B-26", "Outra conta"), mk("bx3", "B-27", "Mais uma"));
    save();
  });
  const estado = (id) => pag.evaluate((id) => { const l = DB.lancamentos.find((x) => x.id === id); return { q: l.liquidacoes, b: baixaDe(id, 0), caixa: liqDe(l)[0].data }; }, id);

  // 1) dar baixa: abre o modal do Flow, forma prevista pré-selecionada, data de hoje
  await pag.evaluate(() => liqTogglePagoMulti("bx1", 0));
  await pag.waitForTimeout(300);
  checa(await pag.locator("#bx_forma").count() === 1, `${largura}: modal de baixa não abriu`);
  checa(await pag.locator("#bx_forma").inputValue() === "Boleto", `${largura}: forma prevista não veio marcada`);
  checa(await pag.locator("#bx_data").inputValue() === await pag.evaluate(() => hojeISO()), `${largura}: data padrão não é hoje`);
  await pag.selectOption("#bx_forma", "PIX");
  await pag.fill("#bx_data", ontem);
  await pag.screenshot({ path: join(PRINTS, `baixa-${largura}.png`) });
  // data no futuro é recusada
  await pag.fill("#bx_data", await pag.evaluate(() => diasSoma(hojeISO(), 3)));
  await pag.click("#bx_ok"); await pag.waitForTimeout(200);
  checa(!(await estado("bx1")).q[0].pago, `${largura}: aceitou data no futuro`);
  await pag.fill("#bx_data", ontem);
  await pag.click("#bx_ok"); await pag.waitForTimeout(300);
  let e = await estado("bx1");
  checa(e.q[0].pago && e.q[0].pagoEm === ontem, `${largura}: parcela não ficou paga em ontem (${e.q[0].pagoEm})`);
  checa(e.b && e.b.forma === "PIX" && e.b.data === ontem, `${largura}: registro da baixa errado: ${JSON.stringify(e.b)}`);
  checa(e.caixa === ontem, `${largura}: Fluxo de Caixa não conta na data do pagamento (${e.caixa})`);
  checa(!e.q[1].pago, `${largura}: 2a parcela foi baixada junto`);
  checa(await pag.evaluate(() => DB.lancamentos.find((x) => x.id === "bx1").forma) === "Boleto", `${largura}: forma prevista do lançamento mudou`);

  // 2) detalhe mostra prevista x efetiva
  const abreDet = () => pag.evaluate(() => { const l = DB.lancamentos.find((x) => x.id === "bx1"); bolIrPara(l.liquidacoes[0].data);
    const i = (window._liqG || []).findIndex((g) => g.ids.includes("bx1") && g.idx === 0); if (i >= 0) liqDetalhe(i); return i; });
  checa(await abreDet() >= 0, `${largura}: não achei a parcela na lista`);
  await pag.waitForTimeout(300);
  const det = await pag.locator(".modal").innerText();
  checa(/previsto: Boleto/.test(det) && /pago: PIX em/.test(det), `${largura}: detalhe não mostra prevista x efetiva`);

  // 3) editar a nota (muda a descrição) não apaga forma nem data
  await pag.evaluate(() => { closeModal(); editNota("bx1"); lancDraft[0].desc = "Conta a prazo (editada)"; });
  await pag.locator(".modal-foot .btn-primary").last().click(); await pag.waitForTimeout(400);
  e = await estado("bx1");
  checa(e.q[0].pago && e.q[0].pagoEm === ontem && e.b && e.b.forma === "PIX" && e.caixa === ontem, `${largura}: editar a nota apagou a baixa: ${JSON.stringify(e)}`);

  // 4) desfazer pelo detalhe limpa as duas
  await abreDet(); await pag.waitForTimeout(200);
  await pag.locator(".modal-foot button", { hasText: "Desfazer a baixa" }).click(); await pag.waitForTimeout(300);
  e = await estado("bx1");
  checa(!e.q[0].pago && !e.q[0].pagoEm && !e.b, `${largura}: desfazer não limpou: ${JSON.stringify(e)}`);
  checa(e.caixa === e.q[0].data, `${largura}: desfeita, a parcela não voltou ao vencimento no Fluxo`);

  // 5) baixa pelo detalhe: o botão abre o modal e, ao confirmar, volta ao detalhe
  await pag.locator(".modal-foot button", { hasText: "Marcar como paga" }).click(); await pag.waitForTimeout(200);
  await pag.selectOption("#bx_forma", "Dinheiro"); await pag.click("#bx_ok"); await pag.waitForTimeout(300);
  checa(/pago: Dinheiro em/.test(await pag.locator(".modal").innerText()), `${largura}: não voltou ao detalhe com a baixa`);
  await pag.evaluate(() => closeModal());

  // 6) em lote: uma forma e uma data para todos
  await pag.evaluate(() => baixaModal({ alvos: [{ ids: ["bx2"], idx: 0 }, { ids: ["bx3"], idx: 0 }], volta: "lista" }));
  await pag.waitForTimeout(200);
  checa(/2 pagamentos/.test(await pag.locator(".modal").innerText()), `${largura}: título do lote errado`);
  const outra = await pag.evaluate(() => [...document.querySelectorAll("#bx_forma option")].map((o) => o.value).find((v) => !/^(PIX|Boleto|Dinheiro)$/.test(v)));
  await pag.selectOption("#bx_forma", outra); await pag.fill("#bx_data", ontem); await pag.click("#bx_ok"); await pag.waitForTimeout(300);
  for (const id of ["bx2", "bx3"]) { const x = await estado(id); checa(x.q[0].pago && x.b && x.b.forma === outra && x.caixa === ontem, `${largura}: lote não baixou ${id}`); }

  checa(erros.length === 0, `${largura}: erro JS: ${erros.join(" | ")}`);
  checa(dialogos.length === 0, `${largura}: dialogo do navegador: ${dialogos.join(" | ")}`);
  checa(banco.length === 0, `${largura}: chamou o banco: ${banco[0]}`);
  await ctx.close();
}

for (const w of [1280, 390]) await rodar(w);
await nav.close(); srv.close();
if (falhas.length) { console.error("FALHOU\n- " + falhas.join("\n- ")); process.exit(1); }
console.log("OK: baixa com forma e data reais (1280 e 390)");
