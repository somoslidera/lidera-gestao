// Teste do tema escuro nos campos de data/mês: o ícone do calendário fica claro (color-scheme dark)
// e o mês ("novembro de 2026") cabe inteiro. Dashboard, Financeiro e DRE, em 1280 e 390 px, sem rolagem lateral.
//
//   python3 ../preview_build.py && node escuro-calendario.mjs
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
  const erros = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  await pag.evaluate(() => document.body.classList.add("dark"));
  for (const rota of ["dashboard", "financeiro", "dre"]) {
    await pag.evaluate((r) => go(r), rota);
    await pag.waitForTimeout(600);
    const r = await pag.evaluate(() => {
      const cs = getComputedStyle(document.body).colorScheme;
      const meses = [...document.querySelectorAll('#view input[type=month], #topActions input[type=month]')].filter((e) => e.offsetParent);
      const cortados = meses.filter((e) => { e.value = "2026-11"; return e.scrollWidth > e.clientWidth + 1; }).length;
      const lateral = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      return { cs, n: meses.length, cortados, lateral };
    });
    checa(/dark/.test(r.cs), `${largura} ${rota}: tema escuro sem color-scheme dark (${r.cs})`);
    checa(r.cortados === 0, `${largura} ${rota}: ${r.cortados} de ${r.n} campos de mês cortados`);
    checa(!r.lateral, `${largura} ${rota}: rolagem lateral`);
    await pag.screenshot({ path: join(PRINTS, `escuro-${rota}-${largura}.png`) });
  }
  checa(!erros.length, `${largura}: erro de JavaScript: ${erros.join(" | ")}`);
  await ctx.close();
}

for (const l of [1280, 390]) await rodar(l);
await nav.close(); srv.close();
if (falhas.length) { console.log("escuro-calendario: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`escuro-calendario: ok (prints em ${PRINTS})`);
