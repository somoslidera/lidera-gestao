// Teste do aviso de item de CMV sem produto vinculado (#26): modal do Flow no lugar do confirm()
// do navegador, ao lançar e ao editar. Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node semvinculo.mjs
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
  await pag.waitForTimeout(2500);

  // nota com 2 itens de CMV sem produto + 1 despesa que não é CMV
  const abrir = () => pag.evaluate(() => {
    go("financeiro"); lancarModal();
    const mk = (o) => Object.assign(lmBlank(), { fornecedor: "Fornecedor teste", nf: "T-26" }, o);
    lancDraft = [mk({ grupo: "CMV", desc: "Coco ralado avulso", qtd: 2, vun: 15.5 }),
                 mk({ grupo: "CMV", desc: "Embalagem <b>marmita</b>", qtd: 10, vun: 1.2 }),
                 mk({ grupo: Object.keys(DB.categorias).find((g) => g !== "CMV" && grupoTipo(g) !== "receita"), desc: "Gás", qtd: 1, vun: 120 })];
    lmPagtoModo = "depois"; renderLmRows();
    return DB.lancamentos.length;
  });

  // 1) Voltar e vincular: não salva nada
  const antes = await abrir();
  await pag.locator(".modal-foot .btn-primary").click();
  await pag.waitForTimeout(300);
  const box = pag.locator("#uxConfirm .ux-conf-box");
  checa(await box.count() === 1, `${largura}: o modal do Flow não abriu`);
  const txt = await box.innerText();
  checa(/2 itens de CMV estão sem produto vinculado/.test(txt), `${largura}: título errado: ${txt.slice(0, 80)}`);
  checa(/Coco ralado avulso/.test(txt) && /Embalagem <b>marmita<\/b>/.test(txt), `${largura}: lista não mostra os 2 itens (ou não escapou o HTML)`);
  checa(!/Gás/.test(txt), `${largura}: listou item que não é CMV`);
  checa(await box.locator(".ux-conf-ico svg").count() === 1, `${largura}: falta o ícone de alerta`);
  await pag.screenshot({ path: join(PRINTS, `semvinculo-${largura}.png`) });
  await box.locator("button", { hasText: "Voltar e vincular" }).click();
  await pag.waitForTimeout(300);
  checa(await pag.locator("#uxConfirm").count() === 0, `${largura}: modal não fechou no Voltar`);
  checa(await pag.locator("#lm_rows").count() === 1, `${largura}: a nota fechou no Voltar`);
  checa(await pag.evaluate(() => DB.lancamentos.length) === antes, `${largura}: Voltar salvou lançamento`);

  // 2) Lançar sem vínculo: salva os 3
  await pag.locator(".modal-foot .btn-primary").click();
  await pag.waitForTimeout(300);
  await pag.locator("#uxConfirm button", { hasText: "Lançar sem vínculo" }).click();
  await pag.waitForTimeout(800);
  // a confirmação de data ou de NF repetida pode vir depois: não deve existir neste caso
  const depois = await pag.evaluate(() => DB.lancamentos.filter((l) => l.nfe === "T-26" || l.nf === "T-26" || /Coco ralado avulso|marmita|Gás/.test(l.descricao || "")).length);
  checa(depois >= 3, `${largura}: Lançar sem vínculo salvou ${depois} de 3`);

  // 3) Edição: abre o modal com "Salvar sem vínculo"
  const editou = await pag.evaluate(() => { const l = DB.lancamentos.find((x) => /Coco ralado avulso/.test(x.descricao || "")); if (!l) return false; closeModal(); editNota(l.id); return !!lmEdit; }).catch(() => false);
  if (editou) {
    await pag.waitForTimeout(400);
    await pag.locator(".modal-foot .btn-primary").click();
    await pag.waitForTimeout(300);
    const t2 = await pag.locator("#uxConfirm").innerText().catch(() => "");
    checa(/Salvar sem vínculo/.test(t2), `${largura}: na edição o modal não abriu com "Salvar sem vínculo"`);
    await pag.screenshot({ path: join(PRINTS, `semvinculo-edicao-${largura}.png`) });
  } else falhas.push(`${largura}: não abriu a edição da nota (editNota)`);

  checa(dialogos.length === 0, `${largura}: diálogo do navegador apareceu: ${dialogos.join(" | ")}`);
  checa(erros.length === 0, `${largura}: erros JS: ${erros.join(" | ")}`);
  checa(banco.length === 0, `${largura}: tentou falar com o banco`);
  await ctx.close();
}

for (const w of [1280, 390]) await rodar(w);
await nav.close(); srv.close();
if (falhas.length) { console.log("FALHOU\n- " + falhas.join("\n- ")); process.exit(1); }
console.log("OK · prints em tools/smoke/prints/semvinculo-*.png");
