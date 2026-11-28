// Teste de "Subprodutos em lote" (Fichas Técnicas → Mais): começa com todos os preparados marcados,
// o dono desmarca o que é feito na hora, aplica com resumo. Só administrador vê o botão.
// É um recurso por cliente (DB.recursos.subprodLote): desligado, ninguém vê nem abre; só a Lidera
// (admin/consultor dentro da conta, ADMIN_MODE) vê o interruptor em Configurações → Conta.
// Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node subprodutos.mjs
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
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => { dialogos.push(d.message()); d.accept(); });
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForTimeout(2500);

  // cenário só no navegador: 3 preparados, um já subproduto com saldo
  const ids = await pag.evaluate(() => {
    const mk = (nome, estocavel, saldo) => { const id = uid(); DB.insumos[id] = { id, nome, cat: "Teste", tipo: "preparado", uni: "g", rendimento: 1000, comps: [], estocavel, estoqueAtual: saldo }; return id; };
    const a = mk("ZZ Molho base", false, 0), b = mk("ZZ Farofa da casa", false, 0), c = mk("ZZ Vinagrete", true, 350);
    MEMBRO_PERMS = null; MEMBRO_NIVEL = ""; delete DB.recursos; go("fichas");
    return { a, b, c };
  });
  await pag.waitForTimeout(300);

  // recurso desligado (padrão): nem o dono vê o botão, e o modal recusa
  const off = await pag.evaluate(() => { const btn = document.querySelector("#topActions").innerHTML.includes("subprodLoteAbrir"); _slSel = null; subprodLoteModal(); const abriu = !!document.querySelector("#sl_resumo"); if (abriu) closeModal(); return { btn, abriu }; });
  checa(!off.btn, `${largura}: recurso desligado, mas o dono vê o botão Subprodutos em lote`);
  checa(!off.abriu, `${largura}: recurso desligado, mas o modal abriu`);

  // interruptor: o dono não vê; dentro da conta como cliente também não; a Lidera (ADMIN_MODE + admin/consultor) vê
  const sw = await pag.evaluate(() => {
    const ver = () => { contaTab = "conta"; go("conta"); return !!document.querySelector("input[data-recurso=subprodLote]"); };
    const dono = ver();
    ADMIN_MODE = true; PERFIL = { papel: "cliente" }; const cliente = ver();
    PERFIL = { papel: "consultor" }; const consultor = ver();
    PERFIL = { papel: "admin" }; const admin = ver();
    const titulo = document.querySelector("#view").innerText.includes("Recursos liberados para esta conta (só a Lidera vê)");
    return { dono, cliente, consultor, admin, titulo };
  });
  checa(!sw.dono, `${largura}: o dono vê o interruptor de recursos`);
  checa(!sw.cliente, `${largura}: perfil cliente com ADMIN_MODE vê o interruptor`);
  checa(sw.consultor && sw.admin, `${largura}: a Lidera não vê o interruptor (${JSON.stringify(sw)})`);
  checa(sw.titulo, `${largura}: falta o título da seção de recursos`);
  if (sw.admin) {
    await pag.screenshot({ path: join(PRINTS, `recursos-${largura}.png`), fullPage: largura < 600 });
    await pag.locator("input[data-recurso=subprodLote]").check();
    await pag.waitForTimeout(200);
  }
  const ligou = await pag.evaluate(() => { const r = { on: !!(DB.recursos && DB.recursos.subprodLote === true), salvo: (JSON.parse(localStorage.getItem(STORE_KEY) || "{}").recursos || {}).subprodLote === true }; ADMIN_MODE = false; PERFIL = null; MEMBRO_PERMS = null; MEMBRO_NIVEL = ""; go("fichas"); return r; });
  checa(ligou.on, `${largura}: ligar o interruptor não gravou DB.recursos.subprodLote`);
  checa(ligou.salvo, `${largura}: ligar o interruptor não salvou`);
  await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => document.querySelector("#topActions").innerHTML.includes("subprodLoteAbrir")), `${largura}: recurso ligado, mas o dono não vê o botão Subprodutos em lote`);

  // abre: todos marcados
  await pag.evaluate(() => { _slSel = null; _slQ = "ZZ "; subprodLoteModal(); });
  await pag.waitForTimeout(300);
  const marcados = await pag.locator(".modal label:visible input[type=checkbox]:checked").count();
  checa(marcados === 3, `${largura}: esperava 3 marcados ao abrir (filtro ZZ), veio ${marcados}`);
  await pag.screenshot({ path: join(PRINTS, `subprodutos-${largura}.png`), fullPage: false });

  // desmarca Vinagrete (feito na hora; tinha saldo) e aplica
  await pag.locator(".modal label", { hasText: "ZZ Vinagrete" }).locator("input").uncheck();
  // o demo tem outros preparados fora do filtro "ZZ": também nascem marcados, e o resumo avisa
  const fora = await pag.evaluate(() => subprodLotePreps().filter((i) => !i.nome.startsWith("ZZ ") && !i.estocavel).length);
  const resumo = await pag.locator("#sl_resumo").innerText();
  checa(resumo.includes(`${2 + fora} passa`), `${largura}: resumo inesperado: ${resumo}`);
  checa(!fora || resumo.includes(`${fora} dessas mudanças estão fora do filtro`), `${largura}: resumo não avisa ${fora} fora do filtro: ${resumo}`);
  await pag.locator(".modal-foot .btn-primary", { hasText: "Aplicar" }).click();
  await pag.waitForTimeout(200);
  checa(!(await pag.evaluate(() => DB.insumos[Object.keys(DB.insumos).find((k) => DB.insumos[k].nome === "ZZ Vinagrete")].estocavel === false)), `${largura}: aplicou antes de confirmar`);
  const conf = await pag.locator("#uxConfirm").innerText().catch(() => "");
  dialogos.push(conf);
  await pag.locator('#uxConfirm [data-a="1"]').click();
  await pag.waitForTimeout(300);
  const r = await pag.evaluate((ids) => ({ a: DB.insumos[ids.a].estocavel, b: DB.insumos[ids.b].estocavel, c: DB.insumos[ids.c].estocavel, pa: DB.insumos[ids.a].estoquePor }), ids);
  checa(r.a === true && r.b === true, `${largura}: os marcados não viraram subproduto`);
  checa(r.c === false, `${largura}: o desmarcado continuou subproduto`);
  checa(r.pa && typeof r.pa === "object", `${largura}: subproduto novo sem estoquePor`);
  checa(dialogos.length === 1 && dialogos[0].includes(`${2 + fora} preparado`) && (!fora || dialogos[0].includes(`${fora} dessas mudanças`)) && /1 com saldo/.test(dialogos[0]) && /ZZ Vinagrete/.test(dialogos[0]) && /nada é zerado/.test(dialogos[0]) && !/começa em zero/.test(dialogos[0]), `${largura}: confirmação inesperada: ${dialogos[0]}`);

  // cancelar no confirm não muda nada
  await pag.evaluate(() => { _slSel = null; _slQ = "ZZ "; subprodLoteModal(); });
  await pag.waitForTimeout(200);
  await pag.locator(".modal label", { hasText: "ZZ Molho base" }).locator("input").uncheck();
  await pag.locator(".modal-foot .btn-primary", { hasText: "Aplicar" }).click();
  await pag.waitForTimeout(200);
  await pag.locator('#uxConfirm [data-a="0"]').click();
  await pag.waitForTimeout(200);
  checa(await pag.evaluate((id) => DB.insumos[id].estocavel, ids.a) === true, `${largura}: cancelar a confirmação mudou o dado`);
  await pag.evaluate(() => { _slSel = null; closeModal(); });

  // fechar no X guarda a seleção, mas o botão sempre reabre do zero (tudo marcado, sem filtro)
  await pag.evaluate(() => { _slSel = new Set(); _slQ = "ZZ "; subprodLoteModal(); closeModal(); subprodLoteAbrir(); });
  await pag.waitForTimeout(200);
  const reab = await pag.evaluate(() => ({ sel: _slSel.size, total: subprodLotePreps().length, q: _slQ }));
  checa(reab.sel === reab.total && reab.q === "", `${largura}: reabrir pelo botão não começou do zero ${JSON.stringify(reab)}`);
  // digitar na busca e clicar direto em "Desmarcar todos": o clique não pode se perder
  await pag.locator(".modal input[placeholder='Buscar preparado']").fill("ZZ ");
  await pag.locator(".modal button", { hasText: "Desmarcar todos" }).click();
  await pag.waitForTimeout(200);
  const desm = await pag.evaluate(() => ({ zz: subprodLotePreps().filter((i) => i.nome.startsWith("ZZ ") && _slSel.has(i.id)).length, outros: subprodLotePreps().filter((i) => !i.nome.startsWith("ZZ ") && !_slSel.has(i.id)).length, vis: [...document.querySelectorAll("#sl_lista label")].filter((l) => l.style.display !== "none").length, zzTotal: subprodLotePreps().filter((i) => i.nome.startsWith("ZZ ")).length }));
  checa(desm.zz === 0 && desm.outros === 0 && desm.vis === desm.zzTotal, `${largura}: busca + Desmarcar todos falhou ${JSON.stringify(desm)}`);
  await pag.evaluate(() => { _slSel = null; closeModal(); });

  // gerente não vê o botão e não consegue abrir
  const g = await pag.evaluate(() => { MEMBRO_PERMS = ["fichas", "estoque"]; MEMBRO_NIVEL = "gerente"; go("fichas"); const btn = document.querySelector("#topActions").innerHTML.includes("subprodLoteAbrir"); subprodLoteModal(); const abriu = !!document.querySelector("#sl_resumo"); MEMBRO_PERMS = null; MEMBRO_NIVEL = ""; return { btn, abriu }; });
  checa(!g.btn && !g.abriu, `${largura}: gerente vê ou abre o lote (${JSON.stringify(g)})`);

  // a Lidera desliga: o botão some de novo e o modal recusa
  const desl = await pag.evaluate(() => {
    ADMIN_MODE = true; PERFIL = { papel: "admin" }; contaTab = "conta"; go("conta");
    const cx = document.querySelector("input[data-recurso=subprodLote]"); const marcado = !!(cx && cx.checked);
    if (cx) { cx.checked = false; cx.dispatchEvent(new Event("change")); }
    ADMIN_MODE = false; PERFIL = null; go("fichas");
    const btn = document.querySelector("#topActions").innerHTML.includes("subprodLoteAbrir");
    _slSel = null; subprodLoteModal(); const abriu = !!document.querySelector("#sl_resumo"); if (abriu) closeModal();
    return { marcado, valor: DB.recursos && DB.recursos.subprodLote, btn, abriu };
  });
  checa(desl.marcado, `${largura}: o interruptor não aparece marcado com o recurso ligado`);
  checa(desl.valor === false && !desl.btn && !desl.abriu, `${largura}: desligar não escondeu o recurso (${JSON.stringify(desl)})`);

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
if (falhas.length) { console.error("subprodutos: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`subprodutos: ok (prints em ${PRINTS})`);
