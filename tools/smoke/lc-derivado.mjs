// Teste da Lista de compras: quanto do bruto vai para cada preparado.
// Monta no navegador uma costela bruta e preparados feitos dela (um deles por dentro de outro) e confere
// que o detalhe por preparado soma o mesmo que "inclui X para preparados", em 1280 e 390 px.
//
//   python3 ../preview_build.py && node lc-derivado.mjs
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


// cenário: costela bruta (kg) que vira 3 preparados direto e 1 por dentro de outro (risoto ← costela desfiada ← bruta)
const ESPERADO = { "Costela p/4 (teste)": 5, "Costela p/2 (teste)": 3.125, "Risoto de costela (teste)": 0.9, "Costela desfiada (teste)": 0.75 };
const BRUTO = "Costela bruta (teste)";

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [];
  const banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  const calc = await pag.evaluate((BRUTO) => {
    const base = { cat: "Carnes", noEstoque: true, preco: 40, qtd: 1, cmp: 40 };
    const bruto = Object.assign({}, base, { id: "t-bruta", nome: BRUTO, uni: "kg", estoqueMin: 0, estoqueAtual: 0 });
    const sub = (id, nome, comps, min, atual) => Object.assign({}, base, { id, nome, uni: "kg", tipo: "preparado", estocavel: true, rendimento: 1, comps, estoqueMin: min, estoqueAtual: atual });
    DB.insumos[bruto.id] = bruto;
    DB.insumos["t-p2"] = sub("t-p2", "Costela p/2 (teste)", [["t-bruta", 1250]], 4, 1.5);      // falta 2,5 kg → 3,125 kg de bruta
    DB.insumos["t-p4"] = sub("t-p4", "Costela p/4 (teste)", [["t-bruta", 1250]], 6, 2);        // falta 4 kg → 5 kg
    DB.insumos["t-desf"] = sub("t-desf", "Costela desfiada (teste)", [["t-bruta", 1500]], 0.5, 0);  // ideal próprio 0,5 kg
    DB.insumos["t-ris"] = sub("t-ris", "Risoto de costela (teste)", [["t-desf", 300]], 2, 0);   // falta 2 kg → 0,6 kg de desfiada
    // desfiada: 0,5 (dela) + 0,6 (do risoto) = 1,1 kg → 1,65 kg de bruta, repartidos 0,75 / 0,9
    const x = estoqueItens().find((i) => i.ins.id === "t-bruta");
    estoqueTab = "compras"; go("estoque");
    return { derivado: x.derivado, por: x.derivPor || null };
  }, BRUTO);
  checa(Math.abs(calc.derivado - 9.775) < 0.001, `${largura}: derivado ${calc.derivado}, esperado 9,775 kg (o total não pode mudar)`);
  checa(calc.por, `${largura}: a lista não guarda a origem por preparado (derivPor)`);
  if (calc.por) {
    const soma = Object.values(calc.por).reduce((a, b) => a + b, 0);
    checa(Math.abs(soma - calc.derivado) < 0.001, `${largura}: soma por preparado ${soma} ≠ derivado ${calc.derivado}`);
  }
  await pag.waitForTimeout(300);

  const linha = pag.locator(`tr[data-n="${BRUTO}"]`);
  checa(await linha.count() === 1, `${largura}: ${BRUTO} não está na Lista de compras`);
  const det = linha.locator("details.lc-deriv");
  checa(await det.count() === 1, `${largura}: falta o detalhe por preparado na linha da costela`);
  if (await det.count() === 1) {
    const resumo = await det.locator("summary").innerText();
    const dono = await det.evaluate((d) => d.parentElement.innerText);
    checa(/inclui 9,775 kg/.test(dono) && /4 preparados/.test(resumo), `${largura}: resumo "${dono.split("\n")[0]}" / "${resumo}"`);
    await det.locator("summary").scrollIntoViewIfNeeded();
    await det.locator("summary").click();
    await pag.waitForTimeout(200);
    const itens = await det.locator(".lc-deriv-i").evaluateAll((els) => els.map((e) => ({ t: e.innerText, vis: e.getBoundingClientRect().height > 0 })));
    checa(itens.length === 4 && itens.every((i) => i.vis), `${largura}: detalhe aberto com ${itens.length} linha(s) visíveis`);
    for (const [nome, q] of Object.entries(ESPERADO)) {
      const it = itens.find((i) => i.t.includes(nome));
      const num = it ? parseFloat(it.t.replace(nome, "").replace(/[^\d,]/g, "").replace(",", ".")) : NaN;
      checa(Math.abs(num - q) < 0.001, `${largura}: ${nome} mostra ${it ? it.t.replace(/\s+/g, " ") : "nada"}, esperado ${q} kg`);
    }
    checa(itens[0] && itens[0].t.includes("Costela p/4"), `${largura}: o maior (p/4) não vem primeiro`);
    await linha.scrollIntoViewIfNeeded();
    await pag.screenshot({ path: join(PRINTS, `lc-derivado-${largura}.png`) });
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
if (falhas.length) { console.error("lc-derivado: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`lc-derivado: ok (prints em ${PRINTS})`);
