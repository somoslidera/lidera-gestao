// Editar a nota não pode apagar quando a parcela foi paga nem a conciliação com o banco (#25, PR A).
// Abre a nota pelo editar e salva, nas duas rotas: por item e "nota inteira". Roda contra o _site/ (sem banco).
//
//   python3 ../preview_build.py && node editarpago.mjs
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
  const prep = () => pag.evaluate(() => {
    go("financeiro");
    const g = Object.keys(DB.categorias).find((x) => x !== "CMV" && grupoTipo(x) !== "receita");
    const mk = (id, desc, v) => ({ id, data: "2026-11-02", grupo: g, sub: "", descricao: desc, nfe: "T-25", fornecedor: "Fornecedor teste", valor: v, forma: "Boleto",
      liquidacoes: [{ data: "2026-11-10", valor: v / 2, pago: true, pagoEm: "2026-11-09", conc: { tx: "tx-" + id, data: "2026-11-09" } },
                    { data: "2026-12-10", valor: v / 2, pago: false }] });
    DB.lancamentos = (DB.lancamentos || []).filter((l) => l.nfe !== "T-25");
    DB.lancamentos.push(mk("t25a", "Item A", 100), mk("t25b", "Item B", 60));
  });
  const ler = () => pag.evaluate(() => ["t25a", "t25b"].map((id) => (DB.lancamentos.find((l) => l.id === id) || {}).liquidacoes));
  const confere = async (rota) => {
    const ls = await ler();
    ls.forEach((q, k) => {
      const nome = `${largura} ${rota} item ${k + 1}`;
      checa(q && q.length === 2, `${nome}: perdeu parcelas`);
      if (!q || q.length !== 2) return;
      checa(q[0].pago === true, `${nome}: 1a parcela deixou de estar paga`);
      checa(q[0].pagoEm === "2026-11-09", `${nome}: data de pagamento sumiu (${q[0].pagoEm})`);
      checa(q[0].conc && /^tx-/.test(q[0].conc.tx), `${nome}: conciliacao com o banco sumiu`);
      checa(!q[1].pago && !q[1].pagoEm && !q[1].conc, `${nome}: 2a parcela ganhou pagamento que nao tinha`);
    });
  };

  // 1) editar a nota e salvar sem mexer em nada
  await prep();
  await pag.evaluate(() => editNota("t25a"));
  await pag.waitForTimeout(400);
  await pag.locator(".modal-foot .btn-primary").last().click();
  await pag.waitForTimeout(500);
  await confere("editar");

  // 2) editar a nota, abrir "parcelar nota inteira", concluir sem mudar e salvar
  await prep();
  await pag.evaluate(() => { editNota("t25a"); lmNotaParcelar(); lmParcFechar(-1); });
  await pag.waitForTimeout(400);
  await pag.locator(".modal-foot .btn-primary").last().click();
  await pag.waitForTimeout(500);
  await confere("nota inteira");

  checa(erros.length === 0, `${largura}: erro JS: ${erros.join(" | ")}`);
  checa(dialogos.length === 0, `${largura}: dialogo do navegador: ${dialogos.join(" | ")}`);
  checa(banco.length === 0, `${largura}: chamou o banco: ${banco[0]}`);
  await ctx.close();
}

for (const w of [1280, 390]) await rodar(w);
await nav.close(); srv.close();
if (falhas.length) { console.error("FALHOU\n- " + falhas.join("\n- ")); process.exit(1); }
console.log("OK: editar a nota mantem data de pagamento e conciliacao (1280 e 390)");
