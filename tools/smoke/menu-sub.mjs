// Teste do menu lateral com subpáginas (estilo Vercel, decisão D23): Estoque & Compras e Financeiro ganham a seta ›;
// clicar no nome abre a tela e expande, clicar na seta só expande ou recolhe (gira 90°); subitem abre a tela na aba certa
// (e no endereço certo) e fica destacado; a Folha é subitem do Financeiro e continua em RH (não é mais item solto em FINANCEIRO);
// perfis sem permissão não veem o subitem (flowSim); modo de edição pelo lápis (olho oculta, cadeado nos obrigatórios,
// recarregar lembra); Configurações → Menu lateral e "Restaurar padrão"; menu escondido no computador (botão no topo e
// Ctrl/Cmd+B, lembrado ao recarregar, KPIs reajustados) em 1280 e 1024 px; Sair no rodapé do menu (e no topo com o menu
// escondido) pede confirmação (Cancelar: no preview não desloga). Sem rolagem lateral e sem erro de JS, em 1280 e 390 px.
// Prints: claro e escuro, computador e celular, menu aberto, modo de edição e menu escondido.
//
//   python3 ../preview_build.py && node menu-sub.mjs
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

async function abrir(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/?demo=base", { waitUntil: "load" });   // demo simples (sem tools/preview_mock.js)
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  await pag.waitForTimeout(1500);
  return { ctx, pag, erros, banco };
}
async function recarregar(pag) {
  await pag.reload({ waitUntil: "load" });
  await pag.waitForFunction(() => typeof go === "function" && typeof DB === "object" && DB);
  await pag.waitForTimeout(1200);
}
async function fechar(s, rot) {
  checa(!s.erros.length, `${rot}: erro de JavaScript: ${s.erros[0]}`);
  checa(!s.banco.length, `${rot}: requisição ao Supabase: ${s.banco[0]}`);
  await s.ctx.close();
}
const cel = (l) => l < 600;
const sobra = (pag) => pag.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const gaveta = async (pag, l) => { if (cel(l)) { await pag.evaluate(() => toggleSidebar(true)); await pag.waitForTimeout(350); } };
const gavetaAberta = (pag) => pag.evaluate(() => document.getElementById("sidebar").classList.contains("open"));
const item = (pag, r) => pag.locator(`#nav a[data-route="${r}"]`).first();
const seta = (pag, r) => pag.locator(`#nav a[data-route="${r}"] .nav-chev`);
const sub = (pag, id) => pag.locator(`#nav [data-sub="${id}"]`);
const aberto = (pag, r) => pag.evaluate((r) => { const b = document.querySelector(`#nav .nav-sub[data-sub-de="${r}"]`); return !!b && b.classList.contains("aberto") && !b.hidden; }, r);
const subsDe = (pag, r) => pag.evaluate((r) => [...document.querySelectorAll(`#nav .nav-sub[data-sub-de="${r}"] [data-sub]`)].map((a) => a.dataset.sub), r);
const giro = (pag, r) => pag.evaluate((r) => { const c = document.querySelector(`#nav a[data-route="${r}"] .nav-chev`); const m = getComputedStyle(c).transform; if (!m || m === "none") return 0; const v = m.match(/matrix\(([^)]+)\)/)[1].split(",").map(Number); return Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI); }, r);
const blocoMenu = (pag, rot) => pag.evaluate((r) => { const out = []; let em = false;
  for (const e of document.querySelectorAll("#nav > *")) { if (e.classList.contains("lbl")) { em = e.textContent.trim() === r; continue; } if (em && e.dataset.route) out.push(e.dataset.route); }
  return out; }, rot);
async function alvoToque(pag, loc) { const b = await loc.first().boundingBox(); return b ? Math.min(b.width, b.height) : 0; }
async function escuro(pag, on) { await pag.evaluate((on) => applyTheme(on ? "dark" : "light"), on); await pag.waitForTimeout(150); }

async function sairMostraConfirmacao(pag, loc, rot) {   // só a confirmação: no preview não desloga de verdade (Cancelar)
  checa(await loc.isVisible(), `${rot}: o botão Sair não aparece`);
  checa((await loc.getAttribute("title")) === "Sair" && (await loc.getAttribute("aria-label")) === "Sair", `${rot}: o botão Sair sem dica/aria-label`);
  const antes = await pag.evaluate(() => current);
  await loc.click(); await pag.waitForTimeout(300);
  const c = pag.locator("#uxConfirm");
  checa(await c.isVisible() && /Sair do Flow/.test(await c.innerText()), `${rot}: Sair não pediu confirmação`);
  await c.locator('[data-a="0"]').click(); await pag.waitForTimeout(250);
  checa(await pag.locator("#uxConfirm").count() === 0 && await pag.evaluate(() => current) === antes, `${rot}: Cancelar no Sair não ficou no app`);
}
async function dono(largura) {
  const rot = `${largura} dono`;
  const s = await abrir(largura); const { pag } = s;
  await pag.evaluate(() => { try { localStorage.removeItem("flow_menu_abertos"); localStorage.removeItem("flow_menu_ocultos_local"); } catch (e) {} });
  await pag.evaluate(() => go("dashboard")); await pag.waitForTimeout(300);
  await gaveta(pag, largura);
  // seta só onde há subpáginas
  checa(await seta(pag, "estoque").isVisible(), `${rot}: Estoque & Compras sem a seta`);
  checa(await seta(pag, "financeiro").isVisible(), `${rot}: Financeiro sem a seta`);
  checa(await seta(pag, "dashboard").count() === 0, `${rot}: Dashboard ganhou seta`);
  checa(!(await aberto(pag, "estoque")), `${rot}: Estoque começou aberto sem ser a tela atual`);
  if (cel(largura)) {
    // a seta desenha 28 px e a área de toque (::after) vai a 44 px: confere pelo ponto tocado, não pela caixa
    const toque = await pag.evaluate(() => { const c = document.querySelector('#nav a[data-route="estoque"] .nav-chev'), b = c.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      return [[-21, 0], [21, 0], [0, -21], [0, 21]].every(([dx, dy]) => { const e = document.elementFromPoint(Math.min(x + dx, innerWidth - 1), y + dy); return !!e && !!e.closest(".nav-chev"); }) || [x, b.width]; });
    checa(toque === true, `${rot}: a seta tem menos de 44 px de toque (${toque})`);
    checa(await pag.evaluate(() => { const a = document.querySelector('#nav a[data-route="estoque"]'); return a.getBoundingClientRect().height < 50; }), `${rot}: "Estoque & Compras" quebrou em duas linhas`);
  }
  // seta: só expande, não abre a tela; gira 90°
  await seta(pag, "estoque").click(); await pag.waitForTimeout(300);
  checa(await aberto(pag, "estoque"), `${rot}: a seta não expandiu o Estoque`);
  checa(await pag.evaluate(() => current) === "dashboard", `${rot}: a seta abriu a tela (rota ${await pag.evaluate(() => current)})`);
  checa(await giro(pag, "estoque") === 90, `${rot}: a seta não girou 90° (${await giro(pag, "estoque")})`);
  if (cel(largura)) checa(await gavetaAberta(pag), `${rot}: a seta fechou a gaveta`);
  const esperado = await pag.evaluate(() => estAbasPermitidas().map(([k]) => "estoque:" + k));
  checa(JSON.stringify(await subsDe(pag, "estoque")) === JSON.stringify(esperado), `${rot}: os subitens do Estoque não são as abas permitidas: ${JSON.stringify(await subsDe(pag, "estoque"))}`);
  const subIco = await pag.evaluate(() => document.querySelectorAll('#nav .nav-sub [data-sub] svg').length);
  checa(subIco === 0, `${rot}: subitem com ícone`);
  if (cel(largura)) checa(await alvoToque(pag, sub(pag, "estoque:compras")) >= 44, `${rot}: subitem com menos de 44 px de toque`);
  await pag.mouse.move(5, 5); await pag.waitForTimeout(200);
  await pag.screenshot({ path: join(PRINTS, `menu-sub-aberto-${largura}.png`) });
  await escuro(pag, true); await pag.screenshot({ path: join(PRINTS, `menu-sub-aberto-${largura}-escuro.png`) }); await escuro(pag, false);
  await seta(pag, "estoque").click(); await pag.waitForTimeout(300);
  checa(!(await aberto(pag, "estoque")), `${rot}: a seta não recolheu o Estoque`);
  checa(await giro(pag, "estoque") === 0, `${rot}: a seta não voltou`);
  await seta(pag, "estoque").click(); await pag.waitForTimeout(300);
  // subitem abre a aba certa, no endereço certo, destacada, e fecha a gaveta
  await sub(pag, "estoque:compras").click(); await pag.waitForTimeout(400);
  let st = await pag.evaluate(() => ({ r: current, t: estoqueTab, h: location.hash }));
  checa(st.r === "estoque" && st.t === "compras" && st.h === "#/estoque/lista-de-compras", `${rot}: subitem Lista de Compras abriu ${JSON.stringify(st)}`);
  checa(await sub(pag, "estoque:compras").evaluate((a) => a.classList.contains("on") && a.getAttribute("aria-current") === "page"), `${rot}: o subitem da aba atual não ficou destacado`);
  checa(await pag.evaluate(() => document.querySelectorAll("#nav .nav-sa.on").length) === 1, `${rot}: mais de um subitem destacado`);
  if (cel(largura)) checa(!(await gavetaAberta(pag)), `${rot}: clicar no subitem não fechou a gaveta`);
  // aba trocada dentro da tela: o destaque acompanha
  await pag.evaluate(() => { estoqueTab = "mov"; viewEstoque(); }); await pag.waitForTimeout(200);
  checa(await sub(pag, "estoque:mov").evaluate((a) => a.classList.contains("on")), `${rot}: trocar a aba na tela não mudou o destaque`);
  // clicar no nome do Financeiro: abre a tela e expande
  await gaveta(pag, largura);
  await item(pag, "financeiro").click({ position: { x: 40, y: 12 } }); await pag.waitForTimeout(400);
  checa(await pag.evaluate(() => current) === "financeiro", `${rot}: clicar em Financeiro não abriu a tela`);
  await gaveta(pag, largura);
  checa(await aberto(pag, "financeiro"), `${rot}: clicar no nome não expandiu o Financeiro`);
  const finEsp = await pag.evaluate(() => [...finTabsPermitidas(finTabsLista()).map(([k]) => "financeiro:" + k), "financeiro:folha"]);
  checa(JSON.stringify(await subsDe(pag, "financeiro")) === JSON.stringify(finEsp), `${rot}: subitens do Financeiro: ${JSON.stringify(await subsDe(pag, "financeiro"))}`);
  await sub(pag, "financeiro:fluxo").click(); await pag.waitForTimeout(400);
  st = await pag.evaluate(() => ({ r: current, t: finTab, h: location.hash }));
  checa(st.r === "financeiro" && st.t === "fluxo" && st.h === "#/financeiro/fluxo-de-caixa", `${rot}: subitem Fluxo de Caixa abriu ${JSON.stringify(st)}`);
  checa(await sub(pag, "financeiro:fluxo").evaluate((a) => a.classList.contains("on")), `${rot}: Fluxo de Caixa não ficou destacado`);
  // Folha: subitem do Financeiro, item em RH, fora do grupo FINANCEIRO
  const fin = await blocoMenu(pag, "FINANCEIRO"), rh = await blocoMenu(pag, "RH");
  checa(JSON.stringify(fin) === '["financeiro"]', `${rot}: o grupo FINANCEIRO tem itens soltos além do Financeiro: ${JSON.stringify(fin)}`);
  checa(rh.includes("folha"), `${rot}: a Folha saiu do RH: ${JSON.stringify(rh)}`);
  await gaveta(pag, largura);
  await sub(pag, "financeiro:folha").click(); await pag.waitForTimeout(400);
  checa(await pag.evaluate(() => current === "folha" && location.hash === "#/folha"), `${rot}: o subitem Folha não abriu a Folha`);
  checa(await pag.locator('#topActions [data-atalho="financeiro"]').count() === 1, `${rot}: a Folha perdeu o "← Financeiro"`);
  checa(await pag.evaluate(() => document.querySelector('#nav a[data-route="folha"]').classList.contains("active")), `${rot}: o item Folha do RH não ficou marcado`);
  // recarregar lembra aberto/fechado
  await pag.evaluate(() => { estoqueTab = "contagem"; go("estoque"); }); await pag.waitForTimeout(300);
  await gaveta(pag, largura);
  await seta(pag, "financeiro").click(); await pag.waitForTimeout(250);   // recolhe o Financeiro
  await recarregar(pag); await gaveta(pag, largura);
  checa(await aberto(pag, "estoque"), `${rot}: depois de recarregar, a tela atual (Estoque) não veio aberta`);
  checa(!(await aberto(pag, "financeiro")), `${rot}: depois de recarregar, o Financeiro recolhido voltou aberto`);
  checa(await sub(pag, "estoque:contagem").evaluate((a) => a.classList.contains("on")), `${rot}: depois de recarregar, a aba atual não está destacada`);
  // modo de edição pelo lápis
  const lapis = pag.locator("#nav [data-nav-editar]");
  checa(await lapis.isVisible() && await lapis.locator("svg").count() === 1, `${rot}: sem o botão do lápis no menu`);
  if (cel(largura)) checa(await alvoToque(pag, lapis) >= 44, `${rot}: o lápis tem menos de 44 px de toque`);
  await lapis.click(); await pag.waitForTimeout(300);
  checa(await aberto(pag, "financeiro") && await aberto(pag, "estoque"), `${rot}: no modo de edição os grupos não abriram`);
  const nItens = await pag.evaluate(() => [...document.querySelectorAll("#nav a[data-route]")].filter((a) => a.style.display !== "none").length);
  const nCad = await pag.evaluate(() => [...document.querySelectorAll("#nav a[data-route] .nav-lock")].filter((l) => l.offsetParent).length);
  checa(nItens > 10 && nCad === nItens, `${rot}: cadeado em ${nCad} de ${nItens} itens obrigatórios`);
  checa(await pag.locator("#nav .nav-sub [data-sub] .nav-olho").count() === (await subsDe(pag, "financeiro")).length + (await subsDe(pag, "estoque")).length, `${rot}: subitem sem o olho no modo de edição`);
  if (cel(largura)) checa(await alvoToque(pag, pag.locator('#nav [data-sub="estoque:historico"] .nav-olho')) >= 44, `${rot}: o olho tem menos de 44 px de toque`);
  // obrigatório não oculta
  await pag.locator('#nav a[data-route="cmv"] .nav-lock').click(); await pag.waitForTimeout(200);
  checa(await pag.evaluate(() => current) === "estoque", `${rot}: clicar no cadeado abriu a tela`);
  checa(await item(pag, "cmv").isVisible(), `${rot}: o item obrigatório sumiu`);
  await pag.locator('#nav [data-sub="estoque:historico"] .nav-olho').click(); await pag.waitForTimeout(200);
  await pag.locator('#nav [data-sub="financeiro:folha"] .nav-olho').click(); await pag.waitForTimeout(200);
  checa(await sub(pag, "estoque:historico").evaluate((a) => a.classList.contains("oculto")), `${rot}: o olho não marcou o subitem como oculto`);
  checa(await pag.evaluate(() => current) === "estoque", `${rot}: no modo de edição, ocultar abriu outra tela`);
  await pag.mouse.move(5, 5); await pag.evaluate(() => { document.getElementById("nav").scrollTop = 0; }); await pag.waitForTimeout(250);
  await pag.screenshot({ path: join(PRINTS, `menu-sub-edicao-${largura}.png`) });
  await escuro(pag, true); await pag.screenshot({ path: join(PRINTS, `menu-sub-edicao-${largura}-escuro.png`) }); await escuro(pag, false);
  checa(await sobra(pag) <= 1, `${rot}: rolagem lateral no modo de edição (${await sobra(pag)}px)`);
  await pag.locator("#nav [data-nav-pronto]").first().click(); await pag.waitForTimeout(250);
  checa(await pag.locator("#nav .nav-lock").count() === 0, `${rot}: "Pronto" não saiu do modo de edição`);
  checa(await sub(pag, "estoque:historico").count() === 0, `${rot}: o subitem oculto continua no menu`);
  checa(await sub(pag, "financeiro:folha").count() === 0, `${rot}: a Folha oculta continua no Financeiro`);
  checa(await item(pag, "folha").count() === 1, `${rot}: ocultar a Folha do Financeiro tirou a Folha do RH`);
  await recarregar(pag); await gaveta(pag, largura);
  checa(await sub(pag, "estoque:historico").count() === 0, `${rot}: depois de recarregar, o subitem oculto voltou`);
  checa(await pag.evaluate(() => JSON.parse(localStorage.getItem("flow_menu_ocultos_local") || "[]").includes("estoque:historico")), `${rot}: a preferência não ficou no aparelho (flow_menu_ocultos_local)`);
  // a aba continua dentro da tela
  await pag.evaluate(() => { estoqueTab = "historico"; go("estoque"); }); await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => estoqueTab === "historico" && [...document.querySelectorAll("#view .pill-filter button, #view .tabs button")].some((b) => /Histórico de compras/.test(b.textContent))), `${rot}: a aba oculta do menu sumiu de dentro da tela`);
  // Configurações → Menu lateral
  await pag.evaluate(() => { contaTab = "menu"; go("conta"); }); await pag.waitForTimeout(300);
  const card = pag.locator("#view [data-menu-lateral]");
  checa(await card.isVisible(), `${rot}: sem a seção Menu lateral nas Configurações`);
  checa(!(await card.locator('[data-nav-item="estoque:historico"]').isChecked()), `${rot}: Configurações não mostra o subitem oculto desmarcado`);
  checa(await card.locator('[data-nav-item="estoque:compras"]').isChecked(), `${rot}: Configurações mostra subitem visível desmarcado`);
  checa(await card.locator(".nm-chip").count() > 10, `${rot}: Configurações não lista os itens obrigatórios`);
  checa(await card.locator('input[type=checkbox]').count() === (await pag.evaluate(() => navSubItens("financeiro").length + navSubItens("estoque").length)), `${rot}: há checkbox para item obrigatório`);
  await card.locator('[data-nav-item="estoque:historico"]').check(); await pag.waitForTimeout(250);
  await gaveta(pag, largura);
  checa(await sub(pag, "estoque:historico").count() === 1, `${rot}: marcar em Configurações não devolveu o subitem ao menu`);
  if (cel(largura)) { await pag.evaluate(() => toggleSidebar(false)); await pag.waitForTimeout(400); }
  checa(await sobra(pag) <= 1, `${rot}: Configurações → Menu lateral rola na horizontal (${await sobra(pag)}px)`);
  await pag.screenshot({ path: join(PRINTS, `menu-sub-config-${largura}.png`), fullPage: false });
  await pag.locator("#view [data-nav-restaurar]").click(); await pag.waitForTimeout(250);
  checa(await pag.evaluate(() => navOcultos().length === 0), `${rot}: "Restaurar padrão" não limpou os ocultos`);
  checa(await pag.locator("#view [data-menu-lateral] [data-nav-item]:not(:checked)").count() === 0, `${rot}: depois de "Restaurar padrão" ainda há subitem desmarcado`);
  checa(await sub(pag, "financeiro:folha").count() === 1, `${rot}: depois de "Restaurar padrão" a Folha não voltou ao Financeiro`);
  checa(await sobra(pag) <= 1, `${rot}: rolagem lateral (${await sobra(pag)}px)`);
  // Sair no rodapé do menu (no celular, dentro da gaveta, com 44 px)
  await gaveta(pag, largura);
  const sairMenu = pag.locator(".side-foot .side-sair");
  const ed = await pag.evaluate(() => { const e = document.querySelector(".side-foot .foot-acts .side-edit"); return [e.scrollWidth, e.clientWidth]; });
  checa(ed[0] <= ed[1] + 1, `${rot}: "Editar dados do negócio" cortado ao lado do Sair (${ed})`);
  if (cel(largura)) checa(await alvoToque(pag, sairMenu) >= 44, `${rot}: o Sair tem menos de 44 px de toque`);
  checa(!(await pag.locator("#sairTopo").isVisible()), `${rot}: o Sair do topo aparece com o menu à vista`);
  await sairMostraConfirmacao(pag, sairMenu, rot);
  await pag.screenshot({ path: join(PRINTS, `menu-sub-sair-${largura}.png`) });
  await fechar(s, rot);
}

// perfis: os subitens são exatamente as abas que o perfil pode abrir
async function membro(largura, perfil, rot, espera) {
  const s = await abrir(largura); const { pag } = s;
  const ok = await pag.evaluate((p) => flowSim.aplicar(p), perfil);
  await pag.waitForTimeout(700);
  checa(ok === true, `${largura} ${rot}: flowSim.aplicar não entrou no perfil`);
  await pag.evaluate(() => { NAV_EDIT = true; navSubAtualiza(); });   // edição mostra todos os subitens permitidos
  const r = await pag.evaluate(() => ({
    est: [...document.querySelectorAll('#nav .nav-sub[data-sub-de="estoque"]:not([hidden]) [data-sub]')].map((a) => a.dataset.sub.split(":")[1]),
    fin: [...document.querySelectorAll('#nav .nav-sub[data-sub-de="financeiro"]:not([hidden]) [data-sub]')].map((a) => a.dataset.sub.split(":")[1]),
    estOk: rotaPodeTela("estoque") ? estAbasPermitidas().map(([k]) => k) : [],
    finOk: rotaPodeTela("financeiro") ? [...finTabsPermitidas(finTabsLista()).map(([k]) => k), ...(rotaPodeTela("folha") ? ["folha"] : [])] : [],
    todasEst: EST_ABAS.map(([k]) => k),
  }));
  const so = (l) => (l.length >= 2 ? l : []);   // uma subpágina só não vira lista
  checa(JSON.stringify(r.est) === JSON.stringify(so(r.estOk)), `${largura} ${rot}: Estoque mostra ${JSON.stringify(r.est)}, pode ${JSON.stringify(r.estOk)}`);
  checa(JSON.stringify(r.fin) === JSON.stringify(so(r.finOk)), `${largura} ${rot}: Financeiro mostra ${JSON.stringify(r.fin)}, pode ${JSON.stringify(r.finOk)}`);
  if (espera.estFaltando) checa(espera.estFaltando.every((k) => !r.est.includes(k)), `${largura} ${rot}: vê subitem proibido do Estoque (${espera.estFaltando})`);
  if (espera.finFaltando) checa(espera.finFaltando.every((k) => !r.fin.includes(k)), `${largura} ${rot}: vê subitem proibido do Financeiro (${espera.finFaltando})`);
  if (espera.semSetaFin) checa(await pag.evaluate(() => { const c = document.querySelector('#nav a[data-route="financeiro"] .nav-chev'); return !c || c.style.display === "none"; }), `${largura} ${rot}: Financeiro com seta sem ter subpáginas`);
  await pag.evaluate(() => { NAV_EDIT = false; navSubAtualiza(); });
  checa(await sobra(pag) <= 1, `${largura} ${rot}: rolagem lateral`);
  await fechar(s, `${largura} ${rot}`);
}

// menu escondido no computador (1280 e 1024); no celular continua a gaveta
async function escondido(largura) {
  const rot = `${largura} menu escondido`;
  const s = await abrir(largura); const { pag } = s;
  await pag.evaluate(() => go("dashboard")); await pag.waitForTimeout(300);
  const btn = pag.locator("#sideBtn");
  if (cel(largura)) {
    checa(!(await btn.isVisible()), `${rot}: o botão de esconder aparece no celular`);
    checa(await pag.locator(".topbar .menu-btn").isVisible(), `${rot}: o ☰ sumiu no celular`);
    await fechar(s, rot); return;
  }
  checa(await btn.isVisible(), `${rot}: sem o botão de esconder o menu`);
  const pos0 = await btn.boundingBox();
  const kpiOk = () => pag.evaluate(() => [...document.querySelectorAll("#view .kpi")].filter((k) => k.offsetParent).every((k) => k.classList.contains("kpi-estreito") === (k.getBoundingClientRect().width < 200)));
  const largMain = () => pag.evaluate(() => document.querySelector(".main").getBoundingClientRect().width);
  const w0 = await largMain();
  const tit = () => pag.evaluate(() => document.getElementById("pageTitle").getBoundingClientRect().left);
  const t0 = await tit();
  await btn.click(); await pag.waitForTimeout(450);
  const r1 = await pag.evaluate(() => { const b = document.getElementById("sidebar").getBoundingClientRect(); return { off: document.body.classList.contains("side-off"), dir: b.right, vis: getComputedStyle(document.getElementById("sidebar")).visibility, pressed: document.getElementById("sideBtn").getAttribute("aria-pressed") }; });
  checa(r1.off && r1.dir <= 0.5 && r1.vis === "hidden" && r1.pressed === "true", `${rot}: o menu não escondeu ${JSON.stringify(r1)}`);
  checa(Math.abs((await largMain()) - largura) <= 1 && (await largMain()) > w0, `${rot}: o conteúdo não ocupou a largura toda (${await largMain()} de ${largura})`);
  const pos1 = await btn.boundingBox();
  checa(Math.abs(pos1.y - pos0.y) < 1, `${rot}: o botão mudou de altura`);
  checa(pos1.x < 60, `${rot}: com o menu escondido o botão não está no canto esquerdo (${pos1.x})`);
  checa(await kpiOk(), `${rot}: os KPIs não se reajustaram depois de esconder`);
  checa(t0 - (await tit()) > 200, `${rot}: o título do topo não acompanhou a largura nova (${t0} → ${await tit()})`);
  checa(await sobra(pag) <= 1, `${rot}: rolagem lateral com o menu escondido`);
  await pag.evaluate(() => { estoqueTab = "contagem"; go("estoque"); }); await pag.waitForTimeout(400);
  checa(await pag.evaluate(() => document.querySelector("#rotaTrilha").getBoundingClientRect().left < 220 && document.querySelector("#rotaTrilha").textContent.includes("Posição")), `${rot}: o caminho clicável não acompanhou a largura nova`);
  await sairMostraConfirmacao(pag, pag.locator("#sairTopo"), `${rot} (Sair no topo)`);
  await pag.screenshot({ path: join(PRINTS, `menu-sub-escondido-${largura}.png`) });
  await escuro(pag, true); await pag.screenshot({ path: join(PRINTS, `menu-sub-escondido-${largura}-escuro.png`) }); await escuro(pag, false);
  await recarregar(pag);
  checa(await pag.evaluate(() => document.body.classList.contains("side-off")), `${rot}: recarregar não lembrou o menu escondido`);
  checa(Math.abs((await largMain()) - largura) <= 1, `${rot}: depois de recarregar o conteúdo não ocupa a largura toda`);
  // mesmo botão, mesmo lugar: traz de volta
  await btn.click(); await pag.waitForTimeout(450);
  checa(await pag.evaluate(() => !document.body.classList.contains("side-off") && document.getElementById("sidebar").getBoundingClientRect().left >= 0), `${rot}: o botão não trouxe o menu de volta`);
  await pag.evaluate(() => go("dashboard")); await pag.waitForTimeout(400);
  checa(await kpiOk(), `${rot}: os KPIs não se reajustaram depois de mostrar o menu`);
  await recarregar(pag);
  checa(await pag.evaluate(() => !document.body.classList.contains("side-off")), `${rot}: recarregar escondeu o menu de novo`);
  // atalho Ctrl/Cmd+B (não age dentro de campo de texto)
  await pag.locator("body").click({ position: { x: 600, y: 400 } }).catch(() => {});
  await pag.keyboard.press("Control+b"); await pag.waitForTimeout(350);
  checa(await pag.evaluate(() => document.body.classList.contains("side-off")), `${rot}: Ctrl+B não escondeu o menu`);
  await pag.keyboard.press("Meta+b"); await pag.waitForTimeout(350);
  checa(await pag.evaluate(() => !document.body.classList.contains("side-off")), `${rot}: Cmd+B não trouxe o menu`);
  await pag.evaluate(() => { const i = document.createElement("input"); i.id = "tst_b"; document.getElementById("view").prepend(i); i.focus(); });
  await pag.keyboard.press("Control+b"); await pag.waitForTimeout(300);
  checa(await pag.evaluate(() => !document.body.classList.contains("side-off")), `${rot}: Ctrl+B dentro de um campo escondeu o menu`);
  await pag.evaluate(() => localStorage.setItem("flow_menu_escondido", "0"));
  await fechar(s, rot);
}

for (const largura of [1280, 390]) {
  await dono(largura);
  await membro(largura, { nivel: "estoquista" }, "nível Estoquista", { estFaltando: ["compras", "historico"] });
  await membro(largura, { nivel: "compras" }, "nível Compras (Financeiro só Lançamentos)", { finFaltando: ["visao", "dre", "folha"], semSetaFin: true });
  await membro(largura, { nivel: "personalizado", permissoes: ["dashboard", "financeiro", "dre"], sub: { fin_nota: true, fin_pagto: true, fin_completo: true } }, "financeiro sem folha", { finFaltando: ["folha"] });
  await membro(largura, { nivel: "personalizado", permissoes: ["financeiro", "folha"], sub: { fin_nota: true, fin_completo: false } }, "financeiro restrito + folha", { finFaltando: ["visao", "dre"] });
}
for (const largura of [1280, 1024, 390]) await escondido(largura);
await nav.close();
srv.close();
if (falhas.length) { console.error("menu-sub: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`menu-sub: ok (prints em ${PRINTS})`);
