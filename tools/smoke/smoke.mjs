// Smoke do preview: abre o Flow e o PDV montados pelo preview_build.py e confere que
// (1) a tela carrega, (2) a faixa de preview aparece e (3) NENHUMA requisição sai para o Supabase.
// Tira prints em 1280 px e em 390 px (regra D9: toda mudança de tela anexa o print de 390 px no PR).
//
//   cd tools/smoke && npm ci && npx playwright install chromium   (só na 1ª vez)
//   python3 ../preview_build.py && node smoke.mjs
//
// Saída: tools/smoke/prints/*.png e código 1 se algo falhar.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(AQUI, "../../_site");
const PRINTS = join(AQUI, "prints");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const srv = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const arq = resolve(SITE, "." + p);
    if (!arq.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    const corpo = await readFile(arq);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] || "application/octet-stream" });
    res.end(corpo);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${srv.address().port}`;

const falhas = [];
const navegador = await chromium.launch();
await mkdir(PRINTS, { recursive: true });

async function abrir(caminho, largura, nome, checar) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const banco = [];
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  const erros = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  await pag.goto(BASE + caminho, { waitUntil: "load" });
  await pag.waitForTimeout(2500);
  if (banco.length) falhas.push(`${nome}: ${banco.length} requisição(ões) ao Supabase, ex.: ${banco[0]}`);
  if (erros.length) falhas.push(`${nome}: erro de JavaScript: ${erros[0]}`);
  try { await checar(pag); } catch (e) { falhas.push(`${nome}: ${e.message}`); }
  await pag.screenshot({ path: join(PRINTS, `${nome}.png`) });
  await ctx.close();
}

const flow = async (pag) => {
  const faixa = await pag.locator("#flowPreviewFaixa").innerText();
  if (!/PREVIEW/.test(faixa)) throw new Error(`faixa de preview diferente do esperado: ${faixa}`);
  const conectado = await pag.evaluate(() => typeof sb !== "undefined" && !!sb);
  if (conectado) throw new Error("o cliente do Supabase foi criado (sb != null)");
  const nome = await pag.evaluate(() => (typeof DB !== "undefined" && DB.conta && DB.conta.restaurante) || "");
  if (!nome) throw new Error("a demonstração não carregou (DB.conta.restaurante vazio)");
};
const pdv = async (pag) => {
  const demo = await pag.evaluate(() => typeof DEMO !== "undefined" && DEMO === true);
  if (!demo) throw new Error("PDV fora do modo demonstração");
};

await abrir("/", 1280, "flow-1280", flow);
await abrir("/", 390, "flow-390", flow);
await abrir("/pdv/", 390, "pdv-390", pdv);

await navegador.close();
srv.close();

if (falhas.length) {
  console.error("smoke: FALHOU\n - " + falhas.join("\n - "));
  process.exit(1);
}
console.log(`smoke: ok (Flow e PDV sem banco; prints em ${PRINTS})`);
