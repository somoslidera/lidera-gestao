// Teste do aviso de itens não contados na contagem física (#27): modal do Flow com a lista,
// "Voltar e contar" (não salva e leva ao 1º em branco), "Salvar sem eles" (saldo fica como está)
// e "Zerar os não contados" (2ª confirmação com o valor; grava 0). A contagem salva guarda quem
// ficou de fora e como, e estContagemVer mostra. Roda contra o _site/ (sem banco), em 1280 e 390 px.
//
//   python3 ../preview_build.py && node contagem-aviso.mjs
//
// Monta na demonstração (só no navegador) uma contagem de 10 itens com saldo 5 e custo 2,
// mais 1 item com saldo 0 (em branco não conta como "não contado"). Preenche 7 e deixa 3 em branco.
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

function checa(cond, msg) { if (!cond) falhas.push(msg); return cond; }

// abre uma contagem nova com os 7 primeiros preenchidos (contado = livro, "confere")
async function abrirContagem(pag, ids) {
  await pag.evaluate((ids) => {
    estContDraft = null; estContQ = ""; estContCat = ""; estContFiltro = "todos";
    estContagemNova();
    ids.slice(0, 7).forEach((id) => { estContDraft.vals[id] = "5"; });
    estContagemNova();
  }, ids);
  await pag.waitForTimeout(200);
}
const salvar = (pag) => pag.locator(".modal-foot button", { hasText: "Salvar contagem" }).click();

async function rodar(largura) {
  const L = `${largura}px`;
  const alt = largura < 600 ? 844 : 900;
  const ctx = await nav.newContext({ viewport: { width: largura, height: alt } });
  const pag = await ctx.newPage();
  const erros = [];
  const banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  pag.on("dialog", (d) => d.dismiss()); // "Registrar no CMV?" depois de salvar: não
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // caso de teste, só no navegador: 10 itens com saldo 5 e custo 2 + 1 item com saldo 0
  const ids = await pag.evaluate(() => {
    // a demonstração tem poucos produtos: cria 11 cópias de teste em 2 categorias e tira o resto da contagem
    const base = Object.values(DB.insumos).find((i) => estEstocavel(i) && i.tipo !== "preparado");
    Object.values(DB.insumos).forEach((i) => { i.noEstoque = false; });
    const usados = [];
    for (let k = 0; k < 11; k++) { const id = "t-cont-" + k; DB.insumos[id] = { ...base, id, nome: "Produto teste " + String(k).padStart(2, "0"), cat: k % 2 ? "Teste B" : "Teste A", grupo: "CMV" }; usados.push(DB.insumos[id]); }
    usados.forEach((i, k) => { i.noEstoque = true; i.cmp = 2; i.estoqueAtual = k < 10 ? 5 : 0; delete i.estoquePor; });
    DB.contagens = [];
    estoqueTab = "contar"; go("estoque");
    const ordem = estoqueItens().filter((x) => usados.includes(x.ins)).sort((a, b) => (a.cat || "").localeCompare(b.cat || "") || a.nome.localeCompare(b.nome)).map((x) => x.ins.id);
    const zero = usados[10].id;
    return { dez: ordem.filter((id) => id !== zero), zero };
  });
  const dez = ids.dez; const brancos = dez.slice(7);
  checa(dez.length === 10, `${L}: o caso de teste não montou 10 itens (${dez.length})`);

  // 1) salvar com 3 em branco → modal com os 3 (o item de saldo 0 não aparece)
  await abrirContagem(pag, dez);
  await salvar(pag);
  await pag.waitForTimeout(300);
  const aviso = pag.locator("#uxConfirm.ec-falta");
  const temAviso = checa(await aviso.count() === 1, `${L}: o modal de itens não contados não apareceu`);
  if (temAviso) {
    checa(/3 itens não foram contados/.test(await aviso.locator(".ux-conf-t").innerText()), `${L}: título não diz "3 itens não foram contados"`);
    const lista = await aviso.locator(".ec-falta-it").evaluateAll((els) => els.map((e) => e.dataset.id));
    checa(lista.length === 3 && brancos.every((id) => lista.includes(id)), `${L}: a lista tem ${JSON.stringify(lista)}, esperado os 3 em branco`);
    checa(!lista.includes(ids.zero), `${L}: item com saldo 0 em branco entrou como não contado`);
    checa(/livro 5/.test(await aviso.innerText()), `${L}: a lista não mostra o saldo de livro`);
    checa(await aviso.locator(".ec-falta-cab").count() >= 1, `${L}: a lista não está agrupada por categoria`);
    const foco = await pag.evaluate(() => document.activeElement && document.activeElement.textContent);
    checa(/Voltar e contar/.test(foco || ""), `${L}: "Voltar e contar" não é o botão padrão (foco em "${foco}")`);
    const box = await aviso.locator(".ux-conf-box").boundingBox();
    checa(box && box.x >= 0 && box.x + box.width <= largura + 1 && box.y >= 0 && box.y + box.height <= alt + 1, `${L}: o modal sai da tela ${JSON.stringify(box)}`);
    if (largura < 600) {
      const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      checa(sobra <= 1, `${L}: a página rola na horizontal com o modal (${sobra}px)`);
    }
    await pag.screenshot({ path: join(PRINTS, `contagem-aviso-${largura}.png`) });

    // 2) Voltar e contar: não salva e foca o 1º em branco
    await aviso.locator("button", { hasText: "Voltar e contar" }).click();
    await pag.waitForTimeout(300);
    const r = await pag.evaluate(() => ({ n: DB.contagens.length, modal: !!document.querySelector("#ec_rows"), aviso: !!document.getElementById("uxConfirm"),
      foco: ((document.activeElement && document.activeElement.closest("[data-id]")) || { dataset: {} }).dataset.id || null }));
    checa(r.n === 0, `${L}: "Voltar" salvou a contagem`);
    checa(r.modal && !r.aviso, `${L}: "Voltar" não voltou para a contagem`);
    checa(r.foco === brancos[0], `${L}: "Voltar" focou ${r.foco}, esperado o 1º em branco ${brancos[0]}`);
  }

  // 3) Salvar sem eles: 7 itens, saldo dos 3 intacto, registra "mantido"
  await abrirContagem(pag, dez);
  await salvar(pag);
  await pag.waitForTimeout(300);
  if (checa(await aviso.count() === 1, `${L}: modal não apareceu (Salvar sem eles)`)) {
    await aviso.locator("button", { hasText: "Salvar sem eles" }).click();
    await pag.waitForTimeout(500);
    const r = await pag.evaluate((b) => { const c = DB.contagens[DB.contagens.length - 1] || {}; return { n: DB.contagens.length, itens: (c.itens || []).length,
      nc: (c.naoContados || []).map((x) => x.trat), saldo: b.map((id) => +DB.insumos[id].estoqueAtual) }; }, brancos);
    checa(r.n === 1 && r.itens === 7, `${L}: "Salvar sem eles" salvou ${r.itens} itens (esperado 7)`);
    checa(r.saldo.every((v) => v === 5), `${L}: "Salvar sem eles" mexeu no saldo dos não contados ${JSON.stringify(r.saldo)}`);
    checa(r.nc.length === 3 && r.nc.every((t) => t === "mantido"), `${L}: não registrou os 3 como "mantido" ${JSON.stringify(r.nc)}`);
  }

  // 4) Zerar: 2ª confirmação com o valor, salva 10 com os 3 em 0 e a divergência inclui o valor deles
  await abrirContagem(pag, dez);
  await salvar(pag);
  await pag.waitForTimeout(300);
  if (checa(await aviso.count() === 1, `${L}: modal não apareceu (Zerar)`)) {
    await aviso.locator("button", { hasText: "Zerar os não contados" }).click();
    await pag.waitForTimeout(300);
    const conf = pag.locator("#uxConfirm");
    const txt = await conf.innerText();
    checa(/30,00/.test(txt), `${L}: a 2ª confirmação não mostra a perda de R$ 30,00: ${txt.replace(/\s+/g, " ")}`);
    checa(await pag.evaluate(() => { const c = document.getElementById("uxConfirm"); return !!c && +getComputedStyle(c).zIndex > 500; }), `${L}: a 2ª confirmação fica atrás da janela da contagem`);
    const n0 = await pag.evaluate(() => DB.contagens.length);
    await pag.screenshot({ path: join(PRINTS, `contagem-aviso-zerar-${largura}.png`) });
    await conf.locator("button", { hasText: "Zerar e salvar" }).click();
    await pag.waitForTimeout(500);
    const r = await pag.evaluate((b) => { const c = DB.contagens[DB.contagens.length - 1] || {}; return { n: DB.contagens.length, id: c.id, itens: (c.itens || []).length, total: c.totalDif,
      zer: (c.itens || []).filter((x) => b.includes(x.insumoId)).map((x) => x.contado), nc: (c.naoContados || []).map((x) => x.trat), saldo: b.map((id) => +DB.insumos[id].estoqueAtual) }; }, brancos);
    checa(r.n === n0 + 1 && r.itens === 10, `${L}: "Zerar" salvou ${r.itens} itens (esperado 10)`);
    checa(r.zer.length === 3 && r.zer.every((v) => v === 0), `${L}: os 3 não ficaram com contado 0 ${JSON.stringify(r.zer)}`);
    checa(r.saldo.every((v) => v === 0), `${L}: o saldo dos 3 não foi para 0 ${JSON.stringify(r.saldo)}`);
    checa(Math.abs(r.total + 30) < 0.005, `${L}: divergência ${r.total}, esperado -30`);
    checa(r.nc.length === 3 && r.nc.every((t) => t === "zerado"), `${L}: não registrou os 3 como "zerado" ${JSON.stringify(r.nc)}`);

    // 5) estContagemVer mostra quem ficou de fora e como
    await pag.evaluate((id) => estContagemVer(id), r.id);
    await pag.waitForTimeout(300);
    const ver = await pag.locator("#modalRoot .modal").innerText();
    checa(/3 itens ficaram de fora/.test(ver) && /zerado/.test(ver), `${L}: estContagemVer não mostra os não contados zerados`);
    await pag.screenshot({ path: join(PRINTS, `contagem-aviso-ver-${largura}.png`) });
    const mant = await pag.evaluate(() => DB.contagens[0].id);
    await pag.evaluate((id) => { closeModal(); estContagemVer(id); }, mant);
    await pag.waitForTimeout(200);
    checa(/mantido/.test(await pag.locator("#modalRoot .modal").innerText()), `${L}: estContagemVer não mostra os não contados mantidos`);
    if (largura < 600) {
      const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      checa(sobra <= 1, `${L}: estContagemVer rola na horizontal (${sobra}px)`);
    }
    await pag.evaluate(() => closeModal());
  }

  // 6) contagem por setor: "não contado" é só o que aquele setor mostra
  const setor = await pag.evaluate(() => {
    flowSim.setores();
    const arm = setoresSemPrincipal()[0]; if (!arm) return null;
    estContDraft = null; estContFiltro = "todos"; estContQ = ""; estContCat = "";
    estContagemNova(); estContDraft.arm = arm.id; estContDraft.vals = {}; estContagemNova();
    const vis = estContItensDe(arm.id).map((x) => x.ins.id);
    const F = estContFaltam().map((x) => x.ins.id);
    closeModal(); estContDraft = null;
    return { fora: F.filter((id) => !vis.includes(id)).length, todosNoSetor: F.every((id) => prodNoSetor(DB.insumos[id], arm.id)) };
  }).catch((e) => ({ erro: String(e) }));
  if (setor && !setor.erro) checa(setor.fora === 0 && setor.todosNoSetor, `${L}: contagem por setor listou item de fora do setor ${JSON.stringify(setor)}`);
  else checa(false, `${L}: não deu para montar o cenário de setores ${JSON.stringify(setor)}`);

  checa(!erros.length, `${L}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${L}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

await rodar(1280);
await rodar(390);
await nav.close();
srv.close();
if (falhas.length) { console.error("contagem-aviso: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`contagem-aviso: ok (prints em ${PRINTS})`);
