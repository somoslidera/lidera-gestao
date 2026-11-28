// Prints lado a lado (claro | escuro) de uma direção do tema opcional (#45), para comparar no PR.
// Dashboard, Estoque → Posição, Contagem física e a janela de Nova contagem, em 1280 e 390 px.
// Também confere, em 390 px, que os alvos de toque das telas de operação têm pelo menos 44 px de altura.
//
//   python3 ../preview_build.py && node tema-lado.mjs [gala|linho|marinho]     (padrão: gala)
//   Saída: prints/lado-<tema>-<tela>-<largura>.png
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITE = join(resolve(AQUI, "../.."), "_site");
const PRINTS = join(AQUI, "prints");
const tema = process.argv[2] || "gala";
const TELAS = ["dashboard", "posicao", "contar", "contar-janela"];
const falhas = [];

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
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
const url = `http://127.0.0.1:${srv.address().port}`;
await mkdir(PRINTS, { recursive: true });
const nav = await chromium.launch();

async function captura(largura, modo) {
  const movel = largura < 600;
  const ctx = await nav.newContext({ viewport: { width: largura, height: movel ? 844 : 900 }, deviceScaleFactor: 2, ...(movel ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(([m, t]) => { try { localStorage.setItem("flow_theme", m); localStorage.setItem("flow_tema", t); } catch (e) {} }, [modo, tema]);
  const pag = await ctx.newPage();
  pag.on("pageerror", (e) => falhas.push(`${modo} ${largura}: erro de JavaScript: ${e}`));
  await pag.goto(url + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  const out = {};
  for (const tela of TELAS) {
    await pag.evaluate((t) => {
      if (document.querySelector(".modal-overlay")) closeModal();
      if (t === "dashboard") go("dashboard");
      else { go("estoque"); estoqueTab = t === "posicao" ? "contagem" : "contar"; viewEstoque(); if (t === "contar-janela") estContagemNova(); }
      ["flowPreviewFaixa", "fsimBtn"].forEach((id) => { const e = document.getElementById(id); if (e) e.style.visibility = "hidden"; });
    }, tela);
    await pag.waitForTimeout(600);
    await pag.evaluate(() => document.fonts.ready);
    await pag.waitForTimeout(250);
    if (movel && tela !== "dashboard") {
      const baixos = await pag.evaluate(() => {
        const raiz = document.querySelector(".modal") || document.getElementById("view");
        return [...raiz.querySelectorAll("button,input,select,a.btn")].filter((e) => e.offsetParent && e.type !== "checkbox" && e.type !== "radio")
          .map((e) => ({ r: e.getBoundingClientRect(), n: (e.innerText || e.placeholder || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30) }))
          .filter((x) => x.r.height < 43.5 && x.r.width > 0).map((x) => `${x.n} (${Math.round(x.r.height)} px)`);
      });
      if (baixos.length) falhas.push(`${modo} ${largura} ${tela}: alvo de toque menor que 44 px: ${[...new Set(baixos)].slice(0, 8).join("; ")}`);
    }
    out[tela] = (await pag.screenshot()).toString("base64");
  }
  await ctx.close();
  return out;
}

for (const largura of [1280, 390]) {
  const claro = await captura(largura, "light"), escuro = await captura(largura, "dark");
  const ctx = await nav.newContext({ viewport: { width: largura * 2 + 72, height: (largura < 600 ? 844 : 900) + 48 }, deviceScaleFactor: 2 });
  const pag = await ctx.newPage();
  for (const tela of TELAS) {
    await pag.setContent(`<body style="margin:0;padding:24px;display:flex;gap:24px;background:#1b1d24"><img src="data:image/png;base64,${claro[tela]}" style="width:${largura}px;border-radius:10px"><img src="data:image/png;base64,${escuro[tela]}" style="width:${largura}px;border-radius:10px"></body>`);
    await pag.waitForFunction(() => [...document.images].every((i) => i.complete));
    await pag.screenshot({ path: join(PRINTS, `lado-${tema}-${tela}-${largura}.png`) });
  }
  await ctx.close();
}
await nav.close(); srv.close();
if (falhas.length) { console.log(`tema-lado: FALHOU (${falhas.length})\n - ` + falhas.join("\n - ")); process.exit(1); }
console.log(`tema-lado: ok (${tema}: ${TELAS.length} telas × 1280 e 390 px, claro | escuro; alvos de toque de 44 px conferidos; prints em ${PRINTS})`);
