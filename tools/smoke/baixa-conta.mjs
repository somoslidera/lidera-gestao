// Baixa com a forma e a data reais (#25) nas contas de CUSTO FIXO e MANUAL (DB.fin.contasPagar), com clique de verdade no "○ Pago"
// da lista de Contas a Pagar, na Demo (sem banco), em 1280 e 390 px. O DRE fica no vencimento; o Fluxo conta na data do pagamento.
//
//   python3 ../preview_build.py && node baixa-conta.mjs
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
  await pag.evaluate(() => { go("financeiro"); finTab = "pagar"; viewFinanceiro(); });
  const c0 = await pag.evaluate(() => {
    const c = (DB.fin.contasPagar || [])[0]; if (!c) throw new Error("a Demo não gerou conta de custo fixo"); c.pago = false; c.forma = "Boleto"; delete c.pagoEm; delete c.pagoForma; rmContaLanc(c.id); save(); viewFinanceiro();
    return { id: c.id, venc: c.vencimento }; });
  const estado = () => pag.evaluate((id) => { const c = DB.fin.contasPagar.find((x) => x.id === id); const l = DB.lancamentos.find((x) => x.fromConta === id);
    return { pago: !!c.pago, pagoEm: c.pagoEm || "", pagoForma: c.pagoForma || "", forma: c.forma, lData: l ? l.data : null, caixa: l ? liqDe(l)[0].data : null }; }, c0.id);
  const btnLista = () => pag.locator(`[onclick="contaToggle('contasPagar',0)"]`).first();

  // 1) clique real no "○ Pago" da lista: abre o modal com a forma prevista e a data de hoje
  checa(await btnLista().count() === 1, `${largura}: não achei o botão de baixa da conta na lista`);
  await btnLista().click(); await pag.waitForTimeout(300);
  checa(await pag.locator("#bx_forma").count() === 1, `${largura}: modal de baixa não abriu na conta de custo fixo`);
  checa(await pag.locator("#bx_forma").inputValue() === "Boleto", `${largura}: forma prevista não veio marcada`);
  checa(await pag.locator("#bx_data").inputValue() === await pag.evaluate(() => hojeISO()), `${largura}: data padrão não é hoje`);
  checa(!(await estado()).pago, `${largura}: marcou como paga antes de confirmar`);
  await pag.selectOption("#bx_forma", "PIX");
  await pag.fill("#bx_data", await pag.evaluate(() => diasSoma(hojeISO(), 3)));
  await pag.click("#bx_ok"); await pag.waitForTimeout(200);
  checa(!(await estado()).pago, `${largura}: aceitou data no futuro`);
  await pag.fill("#bx_data", ontem);
  await pag.screenshot({ path: join(PRINTS, `baixa-conta-${largura}.png`) });
  await pag.click("#bx_ok"); await pag.waitForTimeout(300);
  let e = await estado();
  checa(e.pago && e.pagoEm === ontem && e.pagoForma === "PIX", `${largura}: a conta não ficou paga com PIX em ontem: ${JSON.stringify(e)}`);
  checa(e.forma === "Boleto", `${largura}: a forma prevista da conta mudou (${e.forma})`);
  checa(e.lData === c0.venc, `${largura}: o DRE saiu do vencimento (${e.lData} ≠ ${c0.venc})`);
  checa(e.caixa === ontem, `${largura}: o Fluxo de Caixa não conta na data do pagamento (${e.caixa})`);
  checa(/pago: PIX em/.test(await pag.locator("body").innerText()), `${largura}: a lista não mostra a forma efetiva`);

  // 2) no modal da conta: mostra a efetiva, desfazer limpa e volta ao vencimento
  await pag.evaluate(() => contaModal("contasPagar", 0)); await pag.waitForTimeout(200);
  checa(/Pago em PIX no dia/.test(await pag.locator(".modal").innerText()), `${largura}: o modal da conta não mostra a forma efetiva`);
  await pag.locator(".modal-foot button", { hasText: "Desfazer a baixa" }).click(); await pag.waitForTimeout(300);
  e = await estado();
  checa(!e.pago && !e.pagoEm && !e.pagoForma && e.lData === null, `${largura}: desfazer não limpou: ${JSON.stringify(e)}`);

  // 3) baixa pelo modal da conta: abre o modal de baixa e, ao confirmar, volta à conta
  await pag.locator(".modal-foot button", { hasText: "Marcar como paga" }).click(); await pag.waitForTimeout(200);
  checa(await pag.locator("#bx_forma").count() === 1, `${largura}: o botão do modal da conta não abriu a baixa`);
  await pag.selectOption("#bx_forma", "Dinheiro"); await pag.click("#bx_ok"); await pag.waitForTimeout(300);
  checa(/Pago em Dinheiro no dia/.test(await pag.locator(".modal").innerText()), `${largura}: não voltou ao modal da conta com a baixa`);
  e = await estado();
  checa(e.pago && e.pagoForma === "Dinheiro" && e.caixa === await pag.evaluate(() => hojeISO()), `${largura}: baixa pelo modal da conta errada: ${JSON.stringify(e)}`);
  await pag.evaluate(() => closeModal());

  checa(erros.length === 0, `${largura}: erro JS: ${erros.join(" | ")}`);
  checa(dialogos.length === 0, `${largura}: dialogo do navegador: ${dialogos.join(" | ")}`);
  checa(banco.length === 0, `${largura}: chamou o banco: ${banco[0]}`);
  await ctx.close();
}

for (const w of [1280, 390]) await rodar(w);
await nav.close(); srv.close();
if (falhas.length) { console.error("FALHOU\n- " + falhas.join("\n- ")); process.exit(1); }
console.log("OK: baixa com forma e data reais nas contas de custo fixo e manual (1280 e 390)");
