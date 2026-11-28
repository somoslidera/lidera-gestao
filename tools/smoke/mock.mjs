// Teste do restaurante fictício do preview (tools/preview_mock.js): ao abrir o preview PADRÃO (sem ?demo=base),
// nenhuma tela principal abre vazia ou só com zeros, não há erro de JavaScript, nenhuma chamada ao banco,
// nenhuma rolagem lateral em 390 px e os saldos do estoque batem com o livro (DB.estoqueMov).
// Também confere que ?demo=base continua abrindo a demo simples e ?vazio=1 a base vazia.
// Roda contra o _site/ (sem banco), em 1280 e 390 px:
//
//   python3 ../preview_build.py && node mock.mjs
//
// Prints em tools/smoke/prints/mock-<tela>-<largura>.png.
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

// frases de tela vazia que não podem aparecer no preview padrão
const VAZIO = [/Nada a comprar/i, /Ainda não há/i, /Nenhum lançamento/i, /Nenhuma contagem/i, /Nenhuma requisição/i, /Nenhuma produção/i,
  /Sem meta de faturamento/i, /sem receita no período/i, /Sem receita no período/i, /Nenhum funcionário/i, /Nenhum desperdício/i, /Nenhuma movimentação/i,
  /Nenhuma conta/i, /Nenhum item/i, /Nenhuma baixa/i, /Nenhuma ficha/i];

// tela: [endereço, nome, mínimo de números diferentes de zero, conferência extra (roda na página, devolve "" ou o erro), ação antes (sub-aba)]
const TELAS = [
  ["#/dashboard", "dashboard", 12, `(()=>{const t=document.querySelector('#view').innerText;const f=totaisGerais(periodoRange()).faturamento;
     if(!(f>0))return 'faturamento do período zerado';
     if(!document.querySelectorAll('.dsh-chart svg rect').length)return 'gráfico dos 6 meses vazio';
     if(dashMeses(periodoRange(),6).filter(m=>m.rec>0).length<3)return 'menos de 3 meses com receita no gráfico';
     if(!(metaCompraSemana().meta>0))return 'compra da semana sem meta';
     if(!(metaPeriodo(periodoRange()).realista>0))return 'sem meta de faturamento';
     return '';})()`],
  ["#/financeiro/visao-geral", "fin-visao", 10, ""],
  ["#/financeiro/lancamentos", "fin-lancamentos", 20, "", "lancAba='feitos';viewFinanceiro()"],
  ["#/financeiro/contas-a-pagar", "fin-pagar", 8, `(()=>{const v=liqDoPeriodo('pagar','2000-01-01','2100-01-01');if(!v.some(x=>!x.liq.pago&&x.liq.data<hojeISO()))return 'nenhuma conta a pagar vencida';if(!v.some(x=>!x.liq.pago&&x.liq.data>=hojeISO()))return 'nenhuma conta a pagar a vencer';if(!v.some(x=>x.liq.pago))return 'nenhuma conta paga';if(!Object.keys(DB.boletos||{}).length)return 'sem boletos';return '';})()`],
  ["#/financeiro/contas-a-receber", "fin-receber", 6, `(()=>{const c=DB.fin.contasReceber||[];if(!c.some(x=>!x.recebido&&x.vencimento<hojeISO()))return 'nenhuma conta a receber vencida';if(!c.some(x=>x.recebido))return 'nenhuma conta recebida';return '';})()`],
  ["#/financeiro/fluxo-de-caixa", "fin-fluxo", 10, ""],
  ["#/financeiro/dre", "fin-dre", 20, `(()=>{const gs=['CMV','Mão-de-Obra','Encargos Sociais','Benefícios','Impostos','Despesas Prediais','Terceiros','Utilidades','Publicidade','Materiais','Despesas Gerais','Despesas Financeiras'];
     const ym=hojeISO().slice(0,7);const p=ym.split('-');const ant=new Date(+p[0],+p[1]-2,1);const ymA=ant.getFullYear()+'-'+String(ant.getMonth()+1).padStart(2,'0');
     const ls=(DB.lancamentos||[]).filter(l=>l.data.slice(0,7)===ymA);const falta=gs.filter(g=>!ls.some(l=>l.grupo===g&&l.valor>0));if(falta.length)return 'grupos do DRE sem lançamento no mês passado: '+falta.join(', ');
     const rec=ls.filter(l=>l.grupo==='Receita').reduce((s,l)=>s+l.valor,0),cmv=ls.filter(l=>l.grupo==='CMV').reduce((s,l)=>s+l.valor,0);const pct=cmv/rec*100;if(!(pct>=27&&pct<=36))return 'CMV lançado do mês passado fora de 27–36%: '+pct.toFixed(1);return '';})()`],
  ["#/financeiro/custos-fixos", "fin-custosfixos", 0, `(()=>(DB.fin.custosFixos||[]).length>=6&&document.querySelectorAll('#view input').length>=12?'':'poucos custos fixos')()`],
  ["#/dre", "dre", 20, ""],
  ["#/estoque/posicao", "est-posicao", 40, `(()=>{const it=estoqueItens();if(it.length<30)return 'só '+it.length+' produtos no estoque';
     if(!it.some(x=>x.comprar))return 'nenhum abaixo do ponto de pedido';if(!it.some(x=>Math.abs(x.atual)<0.0005))return 'nenhum zerado';
     if(!it.some(x=>x.min>0&&x.crit>0))return 'sem ideal e crítico';if(!it.some(x=>estCompraAtiva(x.ins)))return 'nenhum comprado aguardando chegada';
     if(!it.some(x=>estPrecoVar(x)>0.15))return 'nenhum com preço que subiu';if(!estConfEmbMap().size)return 'nenhum com embalagem a conferir';
     if(!['kg','L','un'].every(u=>it.some(x=>x.uni===u)))return 'faltam unidades kg, L ou un';if(it.filter(x=>insEmb(x.ins)).length<5)return 'poucos produtos com embalagem';
     if(estArmazens().length<3)return 'menos de 3 armazéns';return '';})()`],
  ["#/estoque/movimentacoes", "est-mov", 20, ""],
  ["#/estoque/contar", "est-contar", 6, `(()=>{const c=estContagens();if(c.length<2)return 'menos de 2 contagens';if(!c.some(x=>(x.naoContados||[]).length))return 'nenhuma contagem com itens não contados';return '';})()`],
  ["#/estoque/producao", "est-producao", 8, `(()=>estProducoes().length>=5&&Object.values(DB.insumos).some(i=>i.tipo==='preparado'&&i.estocavel&&prepPorcao(i)&&(i.comps||[]).length>=8)?'':'poucas produções ou falta preparado com 8 ingredientes e porção')()`],
  ["#/estoque/requisicoes", "est-requisicoes", 4, `(()=>{const r=estRequisicoes();return r.some(x=>x.status==='solicitada')&&r.some(x=>x.status==='retirada')?'':'faltam requisições abertas ou concluídas';})()`],
  ["#/estoque/baixa-por-vendas", "est-baixa", 6, `(()=>estBaixas().length>=5?'':'poucas baixas por vendas')()`],
  ["#/estoque/vendas-por-produto", "est-vendaspdv", 0, ""],
  ["#/estoque/lista-de-compras", "est-compras", 6, ""],
  ["#/estoque/historico-de-compras", "est-historico", 10, ""],
  ["#/fichas-tecnicas", "fichas", 20, `(()=>{const fs=Object.values(DB.fichas);if(fs.length<10)return 'só '+fs.length+' fichas';if(!fs.some(f=>fRev(f)))return 'sem revenda';if(!fs.some(f=>f.precos&&Object.keys(f.precos).length>=2))return 'sem preço por canal';return '';})()`],
  ["#/folha", "folha", 10, `(()=>{const fs=DB.fin.funcionarios||[];if(fs.length<6)return 'menos de 6 colaboradores';const ym=hojeISO().slice(0,7);
     if(!(DB.lancamentos||[]).some(l=>(l.fromFunc||'').startsWith('fe_')))return 'sem encargos lançados';if(fs.some(f=>!/^(Colaborador|Sócio) \\d+$/.test(f.nome)))return 'nome de colaborador fora do padrão genérico';return '';})()`],
  ["#/buffet", "buffet", 6, ""],
  ["#/desperdicios", "desperdicios", 6, `(()=>(DB.desperdicios||[]).length>=5?'':'poucos desperdícios')()`],
  ["#/checklists", "checklists", 0, `(()=>Object.keys(DB.checklistReg||{}).length?'':'checklists sem registro')()`],
];

async function rodar(largura) {
  const ctx = await nav.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 900 } });
  const pag = await ctx.newPage();
  const erros = [], banco = [];
  pag.on("pageerror", (e) => erros.push(String(e)));
  pag.on("request", (r) => { if (/supabase\.co|preview-sem-banco\.invalid/.test(r.url())) banco.push(r.url()); });
  await pag.goto(BASE + "/", { waitUntil: "load" });
  await pag.waitForTimeout(2000);
  const L = `${largura}px`;

  const ini = await pag.evaluate(() => ({ mock: !!DB._previewMock, nome: DB.conta && DB.conta.restaurante, sino: getComputedStyle(document.getElementById('bellWrap') || document.body).display !== 'none', notifs: (DB.notificacoes || []).length }));
  checa(ini.mock && ini.nome, `${L}: o preview padrão não abriu com o restaurante fictício completo ${JSON.stringify(ini)}`);
  checa(ini.notifs >= 3 && ini.sino, `${L}: sem notificações no sino ${JSON.stringify(ini)}`);

  // o livro: o saldo de cada produto (total e por armazém) é a soma das movimentações
  const livro = await pag.evaluate(() => {
    const soma = {}; (DB.estoqueMov || []).forEach((m) => { const k = m.insumoId; soma[k] = soma[k] || { t: 0, a: {} }; soma[k].t += +m.q || 0; soma[k].a[m.arm || 'principal'] = (soma[k].a[m.arm || 'principal'] || 0) + (+m.q || 0); });
    const ruins = [];
    Object.values(DB.insumos).forEach((i) => { if (!estEstocavel(i)) return; const s = soma[i.id] || { t: 0, a: {} };
      if (Math.abs((+i.estoqueAtual || 0) - s.t) > 0.002) ruins.push(i.nome + ': saldo ' + i.estoqueAtual + ' × livro ' + s.t.toFixed(3));
      const por = estPor(i); new Set(Object.keys(por).concat(Object.keys(s.a))).forEach((a) => { if (Math.abs((+por[a] || 0) - (s.a[a] || 0)) > 0.002) ruins.push(i.nome + ' em ' + a + ': ' + (por[a] || 0) + ' × livro ' + (s.a[a] || 0).toFixed(3)); }); });
    return { ruins, n: (DB.estoqueMov || []).length, neg: estNegativos().map((x) => x.ins.nome + '@' + x.arm) };
  });
  checa(livro.n > 500, `${L}: livro do estoque com poucas movimentações (${livro.n})`);
  checa(!livro.ruins.length, `${L}: saldo diferente do livro: ${livro.ruins.slice(0, 5).join(' | ')}`);
  checa(!livro.neg.length, `${L}: saldo negativo: ${livro.neg.join(', ')}`);

  for (const [h, nome, minNum, extra, antes] of TELAS) {
    await pag.goto(BASE + "/" + h, { waitUntil: "load" });
    await pag.waitForTimeout(700);
    if (antes) { await pag.evaluate(antes); await pag.waitForTimeout(300); }
    const r = await pag.evaluate((extra) => {
      const v = document.querySelector('#view'); const t = v ? v.innerText : '';
      const nums = (t.match(/\d[\d.]*(,\d+)?/g) || []).filter((x) => /[1-9]/.test(x));
      let ex = ''; if (extra) { try { ex = eval(extra); } catch (e) { ex = 'erro na conferência: ' + e.message; } }
      return { t: t.slice(0, 20000), n: nums.length, lat: document.documentElement.scrollWidth > document.documentElement.clientWidth, ex, cur: typeof current !== 'undefined' ? current : '' };
    }, extra);
    checa(r.t.trim().length > 40, `${L} ${nome}: tela vazia`);
    checa(r.n >= minNum, `${L} ${nome}: só ${r.n} números diferentes de zero (mínimo ${minNum})`);
    const vaz = VAZIO.filter((re) => re.test(r.t)).map(String);
    checa(!vaz.length, `${L} ${nome}: mostra estado vazio (${vaz.join(', ')})`);
    if (largura < 600) checa(!r.lat, `${L} ${nome}: rolagem lateral`);
    checa(!r.ex, `${L} ${nome}: ${r.ex}`);
    await pag.screenshot({ path: join(PRINTS, `mock-${nome}-${largura}.png`) });
  }
  checa(!erros.length, `${L}: erro de JavaScript: ${erros.slice(0, 3).join(' | ')}`);
  checa(!banco.length, `${L}: ${banco.length} chamada(s) ao banco, ex.: ${banco[0]}`);
  await ctx.close();
}

// ?demo=base continua a demo simples; ?vazio=1, a base vazia
async function variantes() {
  for (const [q, conf] of [["?demo=base", (x) => !x.mock && x.nome && x.ins > 0 && x.ins < 20], ["?vazio=1", (x) => !x.mock && x.ins < 20]]) {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 } });
    const pag = await ctx.newPage(); const erros = [];
    pag.on("pageerror", (e) => erros.push(String(e)));
    await pag.goto(BASE + "/" + q, { waitUntil: "load" }); await pag.waitForTimeout(1500);
    const x = await pag.evaluate(() => ({ mock: !!DB._previewMock, nome: DB.conta && DB.conta.restaurante, ins: Object.keys(DB.insumos || {}).length }));
    checa(conf(x), `${q}: não abriu como esperado ${JSON.stringify(x)}`);
    checa(!erros.length, `${q}: erro de JavaScript: ${erros[0]}`);
    await ctx.close();
  }
}

await rodar(1280);
await rodar(390);
await variantes();
await nav.close();
srv.close();
if (falhas.length) { console.error("mock: FALHOU\n - " + falhas.join("\n - ")); process.exit(1); }
console.log(`mock: ok (restaurante fictício completo em ${TELAS.length} telas, 1280 e 390 px; livro do estoque confere; prints em ${PRINTS})`);
