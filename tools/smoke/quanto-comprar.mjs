// Teste da aba Estoque › Quanto comprar (#49): "quanto comprar para N porções" numa aba própria, com o resultado em lista.
// Confere: a aba vem logo depois de Lista de Compras e tem endereço próprio (#/estoque/quanto-comprar); só aparece para quem
// tem a permissão "Lista de compras" (Compras vê, Estoquista não, nem pelo endereço); o preparado com 8 ingredientes do
// cenário do Simular dá 8 linhas com quantidade e unidade em colunas separadas, saldo atual e falta comprar (arredondado
// pela embalagem); com preparado, gramas por porção e perda ficam travados; o modo à mão continua dando o bruto com a perda;
// a Lista de Compras perde a calculadora e ganha o atalho; imprimir sai com a lista; sem erro de JS, sem banco e sem
// rolagem lateral, em 1280 e 390 px.
//
//   python3 ../preview_build.py && node quanto-comprar.mjs
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
const espera = (pag, ms = 400) => pag.waitForTimeout(ms);
const semRolagem = (pag) => pag.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const abas = (pag) => pag.evaluate(() => [...document.querySelectorAll("#view .pill-filter.tabs button")].map((b) => b.textContent.trim()));

// esperado para 20 porções de 250 g (= 5 kg = 1 lote do Molho da casa): [insumo, quantidade, un, falta comprar]
const LINHAS = [
  ["Tomate italiano", "3", "kg", "1 kg"],        // saldo 2
  ["Cebola", "0,8", "kg", "0,8 kg"],
  ["Alho", "0,1", "kg", "tem no estoque"],     // saldo 0,5
  ["Azeite", "0,2", "lt", "0,5 lt"],              // garrafa (GF) de 0,5 L
  ["Ovo", "6", "un", "30 un"],                  // saldo 2, bandeja de 30
  ["Creme de leite", "0,6", "kg", "0,6 kg"],
  ["Sal", "0,03", "kg", "tem no estoque"],
  ["Manjericão", "40", "gr", "40 gr"],
];

async function rodar(L) {
  const ctx = await nav.newContext({ viewport: { width: L, height: L < 600 ? 844 : 900 }, ...(L < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await espera(pag, 2500);

  // ---- cenário: preparado com 8 ingredientes (painel Simular) ----
  await pag.evaluate(() => window.flowSim.receita8());
  await espera(pag, 600);

  // ---- a aba: depois de Lista de Compras, endereço próprio ----
  await pag.evaluate(() => { estoqueTab = "compras"; go("estoque"); });
  await espera(pag);
  const ab = await abas(pag);
  const iL = ab.indexOf("Lista de Compras"), iQ = ab.indexOf("Quanto comprar");
  checa(iQ >= 0 && iQ === iL + 1, `${L}: a aba "Quanto comprar" deveria vir logo depois de Lista de Compras (${ab.join(" | ")})`);

  // Lista de Compras: sem a calculadora, com o atalho
  checa(await pag.locator("#view #lcc_sub, #view #lcc_n").count() === 0, `${L}: a Lista de Compras ainda tem a calculadora`);
  const atalho = pag.locator(".lc-calc-link a");
  checa(await atalho.count() === 1, `${L}: falta o atalho "Calcular porções →" na Lista de Compras`);
  if (await atalho.count()) { await atalho.click(); await espera(pag); }
  let st = await pag.evaluate(() => ({ tab: estoqueTab, h: location.hash }));
  checa(st.tab === "porcoes" && st.h === "#/estoque/quanto-comprar", `${L}: o atalho abriu ${st.tab} em ${st.h}`);
  checa(await pag.locator(".pill-filter.tabs button.on").innerText().catch(() => "") === "Quanto comprar", `${L}: a aba não ficou marcada`);

  // recarregar pelo endereço abre a aba
  await pag.reload({ waitUntil: "load" });
  await espera(pag, 2000);
  st = await pag.evaluate(() => ({ c: current, tab: estoqueTab }));
  checa(st.c === "estoque" && st.tab === "porcoes", `${L}: recarregar #/estoque/quanto-comprar abriu ${st.c}/${st.tab}`);
  checa(await pag.locator("#view #lcc_res .qc-vazio").count() === 1, `${L}: sem porções deveria pedir as porções`);
  await pag.screenshot({ path: join(PRINTS, `quanto-comprar-vazio-${L}.png`), fullPage: true });

  // ---- com preparado: 8 linhas, quantidade e unidade separadas ----
  await pag.selectOption("#view #lcc_sub", "sim-r8");
  await pag.fill("#view #lcc_n", "20");
  await espera(pag, 200);
  const trav = await pag.evaluate(() => ({ g: document.querySelector("#view #lcc_g").disabled, p: document.querySelector("#view #lcc_p").disabled, gv: document.querySelector("#view #lcc_g").value }));
  checa(trav.g && trav.p, `${L}: com preparado, gramas por porção e perda deveriam ficar travados (${JSON.stringify(trav)})`);
  checa(trav.gv === "250", `${L}: gramas por porção deveria mostrar a porção do preparado (250), veio ${trav.gv}`);
  const cab = await pag.locator("#view #lcc_cab").innerText().catch(() => "");
  checa(/20 porções de Molho da casa \(demo\) = 5 kg prontos/.test(cab), `${L}: cabeçalho do resultado: ${JSON.stringify(cab)}`);
  const linhas = await pag.evaluate(() => [...document.querySelectorAll("#view #lcc_tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.trim().replace(/\s+/g, " "))));
  checa(linhas.length === 8, `${L}: deveriam ser 8 linhas, vieram ${linhas.length}`);
  LINHAS.forEach(([nome, q, u, falta], k) => {
    const r = linhas[k] || [];
    checa(r[0] === nome && r[1] === q && r[2] === u && (r[4] || "").startsWith(falta), `${L}: linha ${k + 1} esperada ${nome} · ${q} · ${u} · ${falta}, veio ${JSON.stringify(r)}`);
  });
  checa(/1 GF/.test((linhas[3] || [])[4] || "") && /1 BDJ/.test((linhas[4] || [])[4] || ""), `${L}: falta comprar sem a embalagem (GF/BDJ)`);
  const rod = await pag.locator("#view #lcc_res").innerText();
  checa(/Rendimento da receita: 5000 gr por lote/.test(rod.replace(/\./g, "")), `${L}: rodapé do rendimento: ${JSON.stringify(rod.slice(-200))}`);
  checa(!/ingrediente\(s\) informados/.test(rod), `${L}: rodapé antigo ("a cada N ingrediente(s)") ainda aparece`);
  checa(await semRolagem(pag), `${L}: rolagem lateral com o resultado`);
  if (L < 600) {
    const cartao = await pag.evaluate(() => getComputedStyle(document.querySelector("#view #lcc_tbody tr")).display);
    checa(cartao === "grid", `${L}: no celular a linha deveria virar cartão (display ${cartao})`);
  }
  await pag.screenshot({ path: join(PRINTS, `quanto-comprar-preparado-${L}.png`), fullPage: true });

  // trocar de aba e voltar mantém o que foi digitado
  await pag.evaluate(() => { estoqueTab = "compras"; viewEstoque(); estoqueTab = "porcoes"; viewEstoque(); });
  await espera(pag, 200);
  checa(await pag.locator("#view #lcc_tbody tr").count() === 8 && await pag.inputValue("#view #lcc_n") === "20", `${L}: voltar à aba perdeu o cálculo`);

  // imprimir: folha com o título e as 8 linhas, sem os campos
  await pag.evaluate(() => { window.print = () => {}; });
  await pag.locator('#topActions button:has-text("Imprimir")').click();
  await espera(pag, 300);
  const folha = await pag.evaluate(() => { const a = document.getElementById("printArea"); return a ? { t: a.innerText, n: a.querySelectorAll(".qc-tab tbody tr").length, inp: a.querySelectorAll("input,select").length } : null; });
  checa(folha && /Quanto comprar/.test(folha.t) && folha.n === 8 && folha.inp === 0, `${L}: impressão: ${JSON.stringify(folha && { n: folha.n, inp: folha.inp, t: folha.t.slice(0, 120) })}`);

  // ---- à mão: bruto com a perda ----
  await pag.selectOption("#view #lcc_sub", "");
  await espera(pag, 100);
  const livre = await pag.evaluate(() => !document.querySelector("#view #lcc_g").disabled && !document.querySelector("#view #lcc_p").disabled);
  checa(livre, `${L}: à mão, gramas e perda deveriam voltar a ficar livres`);
  await pag.fill("#view #lcc_n", "10");
  await pag.fill("#view #lcc_g", "180");
  await pag.fill("#view #lcc_p", "25");
  await espera(pag, 200);
  const mao = await pag.locator("#view #lcc_res").innerText();
  checa(/10 porções de 180 g = 1,8 kg prontos/.test(mao), `${L}: à mão, cabeçalho: ${JSON.stringify(mao.slice(0, 120))}`);
  const bruto = await pag.locator("#view #lcc_res .qc-bruto").innerText().catch(() => "");
  checa(bruto.trim() === "2,4", `${L}: à mão, bruto com 25% de perda deveria ser 2,4 kg, veio ${JSON.stringify(bruto)}`);
  checa(await semRolagem(pag), `${L}: rolagem lateral à mão`);
  await pag.screenshot({ path: join(PRINTS, `quanto-comprar-mao-${L}.png`), fullPage: true });

  // ---- permissão: Compras vê; Estoquista não (nem pela aba, nem pelo endereço) ----
  checa(await pag.evaluate(() => window.flowSim.aplicar({ nivel: "compras" })), `${L}: flowSim não aplicou Compras`);
  await espera(pag, 600);
  await pag.evaluate(() => { estoqueTab = "porcoes"; go("estoque"); });
  await espera(pag);
  st = await pag.evaluate(() => ({ tab: estoqueTab, h: location.hash, ab: [...document.querySelectorAll("#view .pill-filter.tabs button")].map((b) => b.textContent.trim()) }));
  checa(st.ab.includes("Quanto comprar") && st.tab === "porcoes" && st.h === "#/estoque/quanto-comprar", `${L}: Compras deveria ver a aba (${JSON.stringify(st)})`);

  checa(await pag.evaluate(() => window.flowSim.aplicar({ nivel: "estoquista", setores: ["principal"] })), `${L}: flowSim não aplicou Estoquista`);
  await espera(pag, 600);
  await pag.evaluate(() => { estoqueTab = "porcoes"; go("estoque"); });
  await espera(pag);
  st = await pag.evaluate(() => ({ tab: estoqueTab, h: location.hash, ab: [...document.querySelectorAll("#view .pill-filter.tabs button")].map((b) => b.textContent.trim()), calc: !!document.querySelector("#view #lcc_sub") }));
  checa(!st.ab.includes("Quanto comprar") && st.tab !== "porcoes" && !st.calc && st.h !== "#/estoque/quanto-comprar", `${L}: Estoquista não deveria ver a aba (${JSON.stringify(st)})`);
  await pag.evaluate(() => { location.hash = "#/estoque/quanto-comprar"; });
  await espera(pag, 600);
  st = await pag.evaluate(() => ({ tab: estoqueTab, h: location.hash, calc: !!document.querySelector("#view #lcc_sub") }));
  checa(st.tab !== "porcoes" && !st.calc && st.h !== "#/estoque/quanto-comprar", `${L}: Estoquista abriu a aba pelo endereço (${JSON.stringify(st)})`);

  await Promise.all([pag.waitForEvent("load"), pag.evaluate(() => window.flowSim.dono())]);
  await espera(pag, 1500);

  checa(!erros.length, `${L}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${L}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

for (const w of [1280, 390]) {
  try { await rodar(w); } catch (e) { falhas.push(`${w}: o teste quebrou: ${String(e).split("\n")[0]}`); }
}
await nav.close();
srv.close();
if (falhas.length) { console.error("quanto-comprar: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`quanto-comprar: ok (prints em ${PRINTS})`);
