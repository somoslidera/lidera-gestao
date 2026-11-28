// Teste dos cartões de KPI: valor longo (milhões, com centavos) não pode ficar cortado no cartão,
// em 1024, 1280 e 390 px (e em 1024 e 1280 com o menu lateral escondido), no Dashboard e na Posição do estoque,
// no tema atual e em cada tema opcional (#45), claro e escuro. Roda contra o _site/ (sem banco).
//
//   python3 ../preview_build.py && node kpi.mjs
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

async function rodar(largura, tema = "", modo = "light", semMenu = false) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  await ctx.addInitScript(([t, m]) => { try { localStorage.setItem("flow_theme", m); if (t) localStorage.setItem("flow_tema", t); } catch (e) {} }, [tema, modo]);
  // menu lateral escondido no computador (botão no topo, lembrado por aparelho): o conteúdo fica mais largo
  if (semMenu) await ctx.addInitScript(() => { try { localStorage.setItem("flow_menu_escondido", "1"); } catch (e) {} });
  const pag = await ctx.newPage();
  const erros = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  if (semMenu) checa(await pag.evaluate(() => document.body.classList.contains("side-off")), `${largura} sem menu: o menu lateral não ficou escondido`);
  const rot = `${largura}${tema ? ` ${tema} ${modo}` : ""}${semMenu ? " sem menu" : ""}`;
  for (const rota of ["dashboard", "estoque"]) {
    await pag.evaluate((r) => go(r), rota);
    await pag.waitForTimeout(600);
    await pag.evaluate(() => document.fonts.ready);
    const r = await pag.evaluate(() => {
      const vals = [...document.querySelectorAll("#view .kpi .k-val, #view .dsh-kpi-val")].filter((e) => e.offsetParent);
      const textos = ["R$ 9.999.999,99", "R$ 13.860,00", "-R$ 276.988,23"];
      let cortados = 0;
      for (const txt of textos) {
        vals.forEach((e) => { e.textContent = txt; });
        kpiFit(document.getElementById("view"));
        cortados += vals.filter((e) => {
          const k = e.closest(".kpi,.dsh-kpi").getBoundingClientRect(), v = e.getBoundingClientRect();
          return e.scrollWidth > e.clientWidth || v.right > k.right + 0.5 || parseFloat(getComputedStyle(e).fontSize) < 12;
        }).length;
      }
      vals.forEach((e) => { e.textContent = textos[0]; }); kpiFit(document.getElementById("view"));
      return { n: vals.length, cortados, tam: vals.map((e) => getComputedStyle(e).fontSize) };
    });
    checa(r.n > 0, `${rot} ${rota}: nenhum KPI na tela`);
    checa(r.cortados === 0, `${rot} ${rota}: ${r.cortados} de ${r.n} KPIs com valor cortado (${r.tam.join(",")})`);
    await pag.screenshot({ path: join(PRINTS, `kpi-${tema ? tema + "-" + modo + "-" : ""}${rota}-${largura}${semMenu ? "-semmenu" : ""}.png`) });
  }
  checa(!erros.length, `${rot}: erro de JavaScript: ${erros.join(" | ")}`);
  await ctx.close();
}

for (const l of [1024, 1280, 390]) await rodar(l);
for (const l of [1024, 1280]) await rodar(l, "", "light", true);   // menu lateral escondido
// tema visual opcional (#45): a fonte nova dos números não pode voltar a cortar valor
for (const t of ["gala", "linho", "marinho"]) for (const m of ["light", "dark"]) for (const l of [1024, 1280, 390]) await rodar(l, t, m);
await nav.close(); srv.close();
if (falhas.length) { console.log("kpi: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`kpi: ok (prints em ${PRINTS})`);
