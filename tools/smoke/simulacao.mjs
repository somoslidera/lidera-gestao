// Teste do painel "Simular" do preview (tools/preview_simulacao.js, injetado pelo preview_build.py).
// Roda contra o _site/ (sem banco), em 1280 e 390 px:
//   - o painel existe no _site e NÃO existe no index.html do repo;
//   - cenário "Restaurante com setores" + perfil Chefe de setor com 1 setor: o menu esconde as áreas
//     não liberadas e a Estoque → Posição mostra só o saldo desse setor;
//   - "Voltar a dono" restaura o menu e todos os estoques.
//
//   python3 ../preview_build.py && node simulacao.mjs
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(AQUI, "../../_site");
const REPO_INDEX = resolve(AQUI, "../../index.html");
const PRINTS = join(AQUI, "prints");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };
const falhas = [];
function checa(cond, msg) { if (!cond) falhas.push(msg); }

// 1) o index.html do repo (produção) não pode ter nada do painel
const prod = await readFile(REPO_INDEX, "utf-8");
for (const marca of ["fsimBtn", "flowSim", "flow_preview_sim", "preview_simulacao", "Simulação do preview"]) {
  checa(!prod.includes(marca), `index.html do repo contém "${marca}" (o painel é só do preview)`);
}
const site = await readFile(join(SITE, "index.html"), "utf-8");
checa(site.includes("fsimBtn") && site.includes("copiado de entrarComoCliente"), "_site/index.html sem o painel Simular");

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
const nav = await chromium.launch();
await mkdir(PRINTS, { recursive: true });

const rotasVisiveis = (pag) => pag.evaluate(() =>
  [...document.querySelectorAll("#nav a[data-route]")].filter((a) => a.style.display !== "none").map((a) => a.dataset.route));

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [];
  const banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2500);

  // botão existe, diz "Simular" e não cobre a faixa PREVIEW
  const btn = pag.locator("#fsimBtn");
  checa(await btn.count() === 1, `${largura}: botão Simular não existe`);
  checa((await btn.innerText()).trim() === "Simular", `${largura}: botão deveria dizer "Simular"`);
  const [bb, fb] = await Promise.all([btn.boundingBox(), pag.locator("#flowPreviewFaixa").boundingBox()]);
  checa(bb && fb && bb.y + bb.height <= fb.y, `${largura}: botão Simular cobre a faixa PREVIEW`);
  const todasRotas = await rotasVisiveis(pag);

  // abre o painel, roda o cenário de setores pelo botão
  await btn.click();
  await pag.waitForTimeout(200);
  checa(await pag.locator("#fsimPainel >> text=Nada aqui vai para o banco: tudo fica neste navegador.").count() === 1, `${largura}: falta o lembrete no painel`);
  await pag.locator("#fsimSetoresCen").click();
  await pag.waitForTimeout(300);
  const arms = await pag.evaluate(() => estArmazens().map((a) => a.id));
  checa(["principal", "cozinha", "pizzaria", "churrascaria"].every((a) => arms.includes(a)), `${largura}: cenário não criou os setores (${arms})`);
  await pag.screenshot({ path: join(PRINTS, `simulacao-painel-${largura}.png`) });

  // escolhe Chefe de setor só com a Cozinha, pela tela do painel
  await pag.locator("#fsimNivel").selectOption("chefe");
  await pag.waitForTimeout(150);
  await pag.locator('#fsimSetores input[data-setor="cozinha"]').check();
  await pag.locator("#fsimAplicar").click();
  await pag.waitForTimeout(400);

  checa(/Simulando: Chefe de setor · Cozinha/.test(await btn.innerText()), `${largura}: selo não mostra "Simulando: Chefe de setor · Cozinha"`);
  const vis = await rotasVisiveis(pag);
  checa(vis.length === 1 && vis[0] === "estoque", `${largura}: menu do chefe deveria ter só Estoque, tem ${JSON.stringify(vis)}`);
  const estado = await pag.evaluate(() => ({ p: MEMBRO_PERMS, s: MEMBRO_SETORES, n: MEMBRO_NIVEL, c: current }));
  checa(estado.n === "chefe" && JSON.stringify(estado.s) === '["cozinha"]' && estado.c === "estoque", `${largura}: login simulado diferente do esperado ${JSON.stringify(estado)}`);
  checa(await pag.evaluate(() => { go("financeiro"); return current; }) === "estoque", `${largura}: chefe conseguiu abrir o Financeiro`);

  await pag.evaluate(() => { estoqueTab = "contagem"; estoqueFiltro = "Todos"; estoqueArmF = ""; go("estoque"); });
  await pag.waitForTimeout(300);
  const ths = (await pag.locator("table.est-pos thead th").allTextContents()).map((t) => t.trim());
  checa(ths.includes("Cozinha"), `${largura}: Posição sem a coluna Cozinha (${ths})`);
  checa(!ths.some((t) => /^(Principal|Pizzaria|Churrascaria|Total)$/.test(t)), `${largura}: Posição mostra outro estoque para o chefe (${ths})`);
  const corpo = await pag.locator("#estoqueTbody").innerText();
  checa(!/Queijo mussarela|Farinha de trigo|Massa de pizza/.test(corpo), `${largura}: Posição do chefe da Cozinha mostra produto da Pizzaria`);
  checa(/Arroz tipo 1/.test(corpo), `${largura}: Posição do chefe da Cozinha não mostra o Arroz`);
  checa(await pag.locator("text=Saldo de").first().innerText().then((t) => /Cozinha/.test(t)).catch(() => false), `${largura}: falta o aviso "Saldo de Cozinha"`);
  if (largura < 600) {
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    checa(sobra <= 1, `${largura}: a página rola na horizontal (${sobra}px)`);
  }
  await pag.screenshot({ path: join(PRINTS, `simulacao-chefe-${largura}.png`), fullPage: largura < 600 });

  // recarregar mantém a simulação (o membro de teste fica gravado só neste navegador)
  await pag.reload({ waitUntil: "load" });
  await pag.waitForTimeout(1500);
  checa(JSON.stringify(await rotasVisiveis(pag)) === '["estoque"]', `${largura}: simulação não voltou depois de recarregar`);

  // voltar a dono
  await pag.locator("#fsimBtn").click();
  await pag.waitForTimeout(200);
  await Promise.all([pag.waitForEvent("load"), pag.locator("#fsimDono").click()]);
  await pag.waitForTimeout(1500);
  checa((await pag.locator("#fsimBtn").innerText()).trim() === "Simular", `${largura}: selo continuou depois de voltar a dono`);
  checa(JSON.stringify(await rotasVisiveis(pag)) === JSON.stringify(todasRotas), `${largura}: menu do dono não voltou inteiro`);
  const dono = await pag.evaluate(() => ({ p: MEMBRO_PERMS, eq: (DB.equipe || []).some((m) => m.id === "sim-preview") }));
  checa(dono.p === null && !dono.eq, `${largura}: voltar a dono deixou membro de teste ou permissões (${JSON.stringify(dono)})`);
  await pag.evaluate(() => { estoqueTab = "contagem"; go("estoque"); });
  await pag.waitForTimeout(300);
  const thsDono = (await pag.locator("table.est-pos thead th").allTextContents()).map((t) => t.trim());
  checa(["Principal", "Cozinha", "Pizzaria", "Churrascaria"].every((a) => thsDono.includes(a)), `${largura}: dono não vê todos os estoques (${thsDono})`);
  await pag.screenshot({ path: join(PRINTS, `simulacao-dono-${largura}.png`) });

  // cenário de pacotes não quebra a Posição
  await pag.evaluate(() => window.flowSim.pacotes());
  await pag.waitForTimeout(300);
  checa(/sem embalagem/.test(await pag.locator("#estoqueTbody").innerText()), `${largura}: cenário de pacotes não mostrou "sem embalagem"`);

  checa(!erros.length, `${largura}: erro de JavaScript: ${erros[0]}`);
  checa(!banco.length, `${largura}: requisição ao Supabase: ${banco[0]}`);
  await ctx.close();
}

await rodar(1280);
await rodar(390);
await nav.close();
srv.close();
if (falhas.length) { console.error("simulacao: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`simulacao: ok (prints em ${PRINTS})`);
