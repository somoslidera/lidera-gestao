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
  const abrir = (extra) => pag.evaluate((extra) => {
    const outro = Object.keys(DB.categorias || {}).find((g) => g !== "CMV" && grupoTipo(g) !== "receita");
    if (!outro) return { erro: "o demo não tem grupo de despesa fora do CMV (DB.categorias)" };
    closeModal(); go("financeiro"); lancarModal();
    const mk = (o) => Object.assign(lmBlank(), { fornecedor: "Fornecedor teste", nf: "T-26" }, o);
    lancDraft = [mk({ grupo: "CMV", desc: "Coco ralado avulso", qtd: 2, vun: 15.5 }),
                 mk({ grupo: "CMV", desc: "Embalagem <b>marmita</b>", qtd: 10, vun: 1.2 }),
                 mk({ grupo: outro, desc: "Gás", qtd: 1, vun: 120 })];
    if (extra === "permuta") Object.assign(lancDraft[2], { forma: permutaFormaNome(), fornecedor: "" });
    if (extra === "bonif") lmTipoNota = "bonif";
    lmPagtoModo = "depois"; renderLmRows();
    return { n: DB.lancamentos.length };
  }, extra || "");
  const salvar = pag.locator(".modal-foot .btn-primary");
  const box = pag.locator("#uxConfirm .ux-conf-box");
  const fecharAviso = async () => { if (await box.count()) await box.locator("button", { hasText: "Voltar e vincular" }).click(); await pag.waitForTimeout(200); };

  const a0 = await abrir();
  if (a0.erro) { falhas.push(`${largura}: ${a0.erro}`); await ctx.close(); return; }

  // 0a) validação antes do aviso: permuta sem fornecedor barra e o aviso nem abre
  await abrir("permuta");
  await salvar.click();
  await pag.waitForTimeout(500);   // o aviso ignora cliques nos primeiros 400 ms
  checa(await pag.locator("#uxConfirm").count() === 0, `${largura}: o aviso abriu antes da validação de permuta`);

  // 0b) nota de bonificação: o texto não diz que entra no DRE e os valores são só referência
  await abrir("bonif");
  await salvar.click();
  await pag.waitForTimeout(500);   // o aviso ignora cliques nos primeiros 400 ms
  const tb = await box.innerText().catch(() => "");
  checa(/não entra no DRE nem no caixa/.test(tb) && !/entra no Financeiro e no DRE/.test(tb), `${largura}: texto errado na bonificação: ${tb.slice(0, 160)}`);
  checa(/ref\. R\$/.test(tb), `${largura}: na bonificação o valor não aparece como referência`);
  checa(/em amarelo na nota/.test(tb), `${largura}: bonificação sem a frase do amarelo`);
  await fecharAviso();
  await pag.evaluate(() => { lmTipoNota = "compra"; });

  // 0c) clique duplo em Lançar: o 2º clique não fecha o aviso pelo fundo
  await abrir();
  await salvar.dblclick();
  await pag.waitForTimeout(500);
  checa(await box.count() === 1, `${largura}: clique duplo em Lançar fechou o aviso sem salvar`);
  checa(await pag.evaluate(() => DB.lancamentos.filter((l) => l.nfe === "T-26").length) === 0, `${largura}: clique duplo em Lançar confirmou o aviso e salvou`);
  await pag.mouse.click(5, 5);   // clique no fundo, depois dos 400 ms: este aviso não fecha pelo fundo
  await pag.waitForTimeout(200);
  checa(await box.count() === 1, `${largura}: o aviso fechou com clique no fundo`);
  await fecharAviso();

  // 1) Voltar e vincular: não salva nada
  const antes = (await abrir()).n;
  await salvar.click();
  await pag.waitForTimeout(500);   // o aviso ignora cliques nos primeiros 400 ms
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
  await pag.waitForTimeout(500);
  await pag.locator("#uxConfirm button", { hasText: "Lançar sem vínculo" }).click();
  await pag.waitForTimeout(800);
  // a confirmação de data ou de NF repetida pode vir depois: não deve existir neste caso
  checa(await pag.locator("#uxConfirm").count() === 0, `${largura}: um aviso continuou aberto depois de "Lançar sem vínculo"`);
  const salvo = await pag.evaluate(() => ({ n: DB.lancamentos.length, nf: DB.lancamentos.filter((l) => l.nfe === "T-26").length }));
  checa(salvo.n - antes === 3, `${largura}: Lançar sem vínculo criou ${salvo.n - antes} lançamento(s), esperado 3`);
  checa(salvo.nf === 3, `${largura}: ${salvo.nf} lançamento(s) com nfe T-26, esperado 3`);

  // 3) Edição: abre o modal com "Salvar sem vínculo"
  const editou = await pag.evaluate(() => { const l = DB.lancamentos.find((x) => /Coco ralado avulso/.test(x.descricao || "")); if (!l) return false; closeModal(); editNota(l.id); return !!lmEdit; }).catch(() => false);
  if (editou) {
    await pag.waitForTimeout(400);
    await pag.locator(".modal-foot .btn-primary").click();
    await pag.waitForTimeout(500);
    const t2 = await pag.locator("#uxConfirm").innerText().catch(() => "");
    checa(/Salvar sem vínculo/.test(t2), `${largura}: na edição o modal não abriu com "Salvar sem vínculo"`);
    checa(/em amarelo na nota/.test(t2), `${largura}: na edição o texto não fala do amarelo`);
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
