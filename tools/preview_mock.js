/* Restaurante fictício COMPLETO do PREVIEW (tools/preview_build.py injeta este arquivo só no _site/).
   O index.html de produção NÃO tem nada disto, e DEMO_SPECS/buildDemoDados (que também criam as demos de
   verdade no painel admin) não mudam. Na primeira visita ao preview, o preview_build.py monta a demo de
   sempre (buildDemoDados(DEMO_SPECS[0])) e chama flowPreviewMock.montar(), que completa essa demo com
   ~3 meses de histórico: estoque pelo livro, fichas, financeiro, folha, buffet, desperdícios, checklists e
   notificações. Com ?demo=base o preview abre só a demo de sempre (os smokes antigos usam isso); com
   ?vazio=1, a base vazia.

   Regras:
   - Tudo determinístico: datas relativas a "hoje" e números de um gerador com semente fixa (nada de
     Math.random solto). Os ids (uid()) variam, os valores não.
   - Grava pelos caminhos oficiais do app: estMov / estEntradaDeLanc / estBaixaVendas / estProduzir /
     estTransferir / estPerdaDeDesp (saldo sempre pelo livro, via estAplicaSaldo), aplicarLiquidacoes,
     gerarRecorrentesMes + syncContaLanc, revendaSync, notificar, chkBuildDefaults.
   - Só nomes inventados e genéricos (Colaborador 1, Sócio 1, Distribuidora Exemplo, Hortifrúti Demo…).
   - Toda tela nova traz aqui, no mesmo PR, os dados que a deixam visível no preview. */
(function(){
  'use strict';
  if(typeof sb!=='undefined'&&sb)return;                       // nunca roda conectado a banco

  /* gerador com semente fixa (mulberry32) */
  function semente(s){return function(){s|=0;s=(s+0x6D2B79F5)|0;var t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
  function r2(v){return Math.round((+v||0)*100)/100;}
  function r3(v){return Math.round((+v||0)*1000)/1000;}

  var FORN={atac:'Atacado Exemplo',acou:'Açougue Demo',hort:'Hortifrúti Demo',lat:'Laticínios Exemplo',dist:'Distribuidora Exemplo',emb:'Embalagens Demo',pesc:'Pescados Demo'};
  /* fornecedor: dia(s) da semana da entrega (0=dom), dias de cobertura, condição de pagamento */
  var ROTA={atac:{dias:[2],cob:12,pag:{parcelas:2},bol:true},acou:{dias:[1,4],cob:6,pag:{dias:21},bol:true},hort:{dias:[2,5],cob:6,pag:null},
    lat:{dias:[3],cob:10,pag:{dias:14},bol:false},dist:{dias:[4],cob:11,pag:{dias:28},bol:true},emb:{dias:[1],cob:18,pag:{dias:28},bol:false},pesc:{dias:[3],cob:8,pag:{dias:7},bol:false}};

  /* produtos novos: chave, nome, categoria, unidade, preço, fornecedor, subcategoria do DRE, [embalagem, qtd] */
  var NOVOS=[
    ['acucar','Açúcar refinado','Grãos','kg',4.6,'atac','Mercearia'],
    ['sal','Sal refinado','Temperos','kg',2.3,'atac','Temperos'],
    ['farinha','Farinha de trigo','Grãos','kg',4.9,'atac','Mercearia',['PCT',5]],
    ['macarrao','Macarrão espaguete','Grãos','kg',7.4,'atac','Mercearia',['PCT',0.5]],
    ['farofa','Farinha de mandioca','Grãos','kg',8.9,'atac','Mercearia'],
    ['extrato','Extrato de tomate','Molhos','kg',11.5,'atac','Molhos'],
    ['leitecond','Leite condensado','Mercearia','kg',19.8,'atac','Mercearia',['CX',7.9]],
    ['cafe','Café torrado e moído','Mercearia','kg',38,'atac','Mercearia',['PCT',0.5]],
    ['ovos','Ovos brancos','Proteínas','un',0.79,'atac','Proteína - Aves',['CX',30]],
    ['linguica','Linguiça toscana','Proteínas','kg',24.9,'acou','Proteína - Suína'],
    ['costela','Costela bovina','Proteínas','kg',29.9,'acou','Proteína - Bovina'],
    ['bacon','Bacon em cubos','Proteínas','kg',33.9,'acou','Proteína - Suína'],
    ['tilapia','Filé de tilápia','Proteínas','kg',44.9,'pesc','Proteína - Frutos do Mar'],
    ['cebola','Cebola','Hortifruti','kg',4.9,'hort','Hortifruti'],
    ['alho','Alho descascado','Temperos','kg',29.9,'hort','Temperos'],
    ['alface','Alface crespa','Hortifruti','un',3.2,'hort','Hortifruti'],
    ['cenoura','Cenoura','Hortifruti','kg',4.8,'hort','Hortifruti'],
    ['limao','Limão taiti','Hortifruti','kg',5.9,'hort','Hortifruti'],
    ['cheiro','Cheiro-verde (maço)','Hortifruti','un',2.5,'hort','Hortifruti'],
    ['laranja','Laranja pera','Hortifruti','kg',3.9,'hort','Hortifruti'],
    ['manteiga','Manteiga','Frios e Laticínios','kg',46.9,'lat','Laticínios'],
    ['leite','Leite integral','Frios e Laticínios','L',5.3,'lat','Laticínios',['CX',12]],
    ['parmesao','Queijo parmesão','Frios e Laticínios','kg',64,'lat','Laticínios'],
    ['creme','Creme de leite','Frios e Laticínios','kg',17.9,'lat','Laticínios'],
    ['agua','Água mineral 500 ml','Bebidas','un',1.35,'dist','Bebidas',['FD',12]],
    ['cerveja','Cerveja long neck 355 ml','Bebidas','un',4.9,'dist','Bebidas',['CX',24]],
    ['marmitex','Marmitex nº 8 com tampa','Embalagens','un',1.3,'emb','Embalagens',['PCT',100]]
  ];
  /* produtos da demo de sempre: como achar, subcategoria certa, fornecedor e embalagem */
  var DA_BASE=[['arroz',/^arroz/i,'Grãos','atac',['PCT',5]],['feijao',/^feij/i,'Grãos','atac'],['contra',/contrafil/i,'Proteína - Bovina','acou'],['frango',/frango/i,'Proteína - Aves','acou'],
    ['batata',/batata/i,'Hortifruti','hort'],['tomate',/^tomate/i,'Hortifruti','hort'],['oleo',/óleo/i,'Óleos','atac',['CX',18]],['queijo',/mussarela/i,'Laticínios','lat'],['refri',/refrigerante/i,'Bebidas','dist',['FD',12]]];

  /* fichas novas: nome, categoria, preço balcão, iFood, delivery próprio, [[chave, qtd na unidade-base]], vendas por semana, extra */
  var FICHAS=[
    ['Prato executivo de frango','Prato Principal',32.9,38.9,35.9,[['arroz',150],['feijao',80],['frango',180],['alface',0.2],['tomate',40],['oleo',10],['sal',3]],140],
    ['Feijoada completa','Prato Principal',39.9,46.9,42.9,[['feijoada',400],['arroz',120],['farofa',40],['laranja',80]],70],
    ['Bife à parmegiana','Prato Principal',44.9,52.9,48.9,[['contra',180],['ovos',1],['farinha',30],['queijo',60],['molho',120],['oleo',40],['arroz',120],['batata',150]],60],
    ['Espaguete ao sugo','Massas',29.9,35.9,32.9,[['macarrao',130],['molho',180],['parmesao',15],['manteiga',10]],50],
    ['Tilápia grelhada com legumes','Prato Principal',42.9,49.9,46.9,[['tilapia',200],['cenoura',80],['batata',100],['manteiga',15],['limao',20],['arroz',120],['sal',3]],45],
    ['Marmita do dia','Delivery',24.9,29.9,26.9,[['arroz',150],['feijao',90],['frango',120],['batata',80],['oleo',15],['cenoura',30],['vinagrete',60],['marmitex',1]],120,{emb:0}],
    ['Pudim de leite','Sobremesa',12.9,15.9,13.9,[['leitecond',80],['leite',80],['ovos',1],['acucar',25]],80],
    ['Suco de laranja 400 ml','Bebidas',9.9,12.9,10.9,[['laranja',600],['acucar',20]],150],
    ['Café expresso','Bebidas',5.5,0,0,[['cafe',8],['acucar',5]],300]
  ];
  var VENDAS_BASE={'Arroz branco':220,'Feijão preto':170,'Contrafilé grelhado':125,'Estrogonofe de frango':160,'Batata frita':180};
  var REVENDA=[['refri',7,200],['cerveja',12.9,120],['agua',5,160]];   // chave, preço, vendas por semana

  function montar(){
    if(typeof DB==='undefined'||!DB||!DB.insumos)return false;
    var R=semente(20261127);
    var rnd=function(a,b){return a+(b-a)*R();};
    var HOJE=hojeISO();
    var dow=function(iso){return new Date(iso+'T12:00:00').getDay();};
    var ymDe=function(iso){return iso.slice(0,7);};
    var fimDoMes=function(ym){var p=ym.split('-');return ym+'-'+pad2(new Date(+p[0],+p[1],0).getDate());};
    var ymSoma=function(ym,n){var p=ym.split('-');var d=new Date(+p[0],+p[1]-1+n,1);return d.getFullYear()+'-'+pad2(d.getMonth()+1);};
    var YM=ymDe(HOJE),YM0=ymSoma(YM,-2);
    var INI=YM0+'-01';
    var MESES=[YM0,ymSoma(YM,-1),YM];
    var horaDe=function(n){return pad2(8+(n%10))+':'+pad2((n*17)%60);};
    var emISO=function(iso,hh){return new Date(iso+'T'+(hh||'10:00')+':00').toISOString();};

    try{normData();}catch(e){}
    DB._previewMock=1;
    DB.conta=DB.conta||{};DB.conta.nome='Sócio 1';
    var f=DB.fin;
    /* ---------- base: tira o que a demo simples tinha só no mês atual (o histórico é refeito aqui) ---------- */
    DB.lancamentos=[];DB.desperdicios=[];DB.cmvRegistros=[];DB.estoqueMov=[];DB.contagens=[];DB.vendasBaixa=[];DB.producoes=[];DB.transferencias=[];DB.requisicoes=[];DB.notificacoes=[];
    f.contasPagar=[];f.contasReceber=[];f.recGerados={};
    f.diasTrabalho=[0,1,2,3,4,5,6];                              // self-service aberto todos os dias (almoço)
    f.fornecedores=Object.keys(FORN).map(function(k){return {id:'forn-'+k,nome:FORN[k],contato:''};});
    f.canais=[{id:'ifood',nome:'iFood',taxa:27,mix:8},{id:'proprio',nome:'Delivery próprio',taxa:0,mix:4}];
    f.meios=[{id:'mrPix',nome:'PIX',tipo:'PIX',taxa:0,prazo:0},{id:'mrCred',nome:'Cartão de Crédito',tipo:'Crédito',taxa:3.2,prazo:30},{id:'mrDeb',nome:'Cartão de Débito',tipo:'Débito',taxa:1.99,prazo:1},
      {id:'mrDin',nome:'Dinheiro',tipo:'Dinheiro',taxa:0,prazo:0},{id:'mrVR',nome:'Cartão Alimentação',tipo:'Voucher',taxa:5.5,prazo:30},{id:'mrIfood',nome:'iFood',tipo:'Crédito',taxa:3.5,regra:'semanal',diaSemana:3,corte:7}];
    try{sincronizarMeios();}catch(e){}
    f.contasBancarias=[{id:'cb-principal',nome:'Conta corrente (banco exemplo)',saldo:38500}];
    /* armazéns: principal, Produção (a cozinha que produz os preparados) e Bar; bebidas entram direto no Bar */
    f.armazens=[{id:EST_ARM_PRINCIPAL,nome:'Estoque principal'},{id:'producao',nome:'Produção',producao:true},{id:'bar',nome:'Bar'}];
    catEntradaMap()[catSetorKey('CMV','Bebidas')]='bar';
    catSetoresMap()[catSetorKey('CMV','Bebidas')]=['bar'];

    /* ---------- produtos ---------- */
    var K={};
    DA_BASE.forEach(function(b){var ins=Object.values(DB.insumos).find(function(i){return i.tipo!=='preparado'&&b[1].test(i.nome||'');});if(!ins)return;K[b[0]]=ins;
      ins.sub=b[2];ins.fornecedor=FORN[b[3]];ins._f=b[3];if(b[4]){ins.embNome=b[4][0];ins.embQtd=b[4][1];}});
    NOVOS.forEach(function(a){var id='mock-'+a[0];var ins={id:id,nome:a[1],cat:a[2],grupo:'CMV',sub:a[6],tipo:'pronto',uni:a[3],preco:a[4],qtd:1,fornecedor:FORN[a[5]],_f:a[5]};
      if(a[7]){ins.embNome=a[7][0];ins.embQtd=a[7][1];}DB.insumos[id]=ins;K[a[0]]=ins;});
    var C=function(k){return K[k]&&K[k].id;};
    /* preparados: estrogonofe (já existia) vira subproduto; feijoada com 9 ingredientes; molho; vinagrete (não estocável) */
    var est=Object.values(DB.insumos).find(function(i){return i.tipo==='preparado'&&/estrogonofe/i.test(i.nome||'');});
    if(est){Object.assign(est,{estocavel:true,porcaoBase:220,porcaoNome:'porção',rendimento:3000,uni:'g',comps:[[C('frango'),1300],[C('creme'),400],[C('cebola'),180],[C('tomate'),200],[C('oleo'),60],[C('sal'),18]]});K.estrog=est;}
    var prep=function(id,nome,cat,sub,uni,rend,comps,extra){var p=Object.assign({id:id,nome:nome,cat:cat,grupo:'CMV',sub:sub,tipo:'preparado',uni:uni,rendimento:rend,comps:comps.map(function(c){return [C(c[0]),c[1]];}).filter(function(c){return c[0];}),fornecedor:'',modoPreparo:[],utensilios:'',tempoPreparo:''},extra||{});DB.insumos[id]=p;return p;};
    K.feijoada=prep('mock-feijoada','Feijoada (base)','Molhos','Grãos','kg',12,[['feijao',2500],['linguica',1500],['costela',2000],['bacon',600],['cebola',500],['alho',120],['oleo',150],['sal',60],['cheiro',4]],{estocavel:true,porcaoBase:400,porcaoNome:'porção',tempoPreparo:'3 h'});
    K.molho=prep('mock-molho','Molho de tomate da casa','Molhos','Molhos','kg',5,[['tomate',4000],['extrato',800],['cebola',400],['alho',60],['oleo',100],['sal',30],['acucar',40]],{estocavel:true,porcaoBase:150,porcaoNome:'concha',tempoPreparo:'1 h'});
    K.vinagrete=prep('mock-vinagrete','Vinagrete','Molhos','Hortifruti','g',900,[['tomate',500],['cebola',250],['cheiro',1],['limao',150]]);

    /* ---------- fichas ---------- */
    var semana={};   // fichaId -> pratos por semana (antes da escala)
    /* pratos do buffet (da demo de sempre): o preço da porção é o peso dela ao preço do quilo do buffet */
    var kgBuffet=+((DB.buffet||{}).precoVendaKg)||45.9;
    Object.values(DB.fichas).forEach(function(fi){if(!VENDAS_BASE[fi.nome])return;semana[fi.id]=VENDAS_BASE[fi.nome];fi.precos=Object.assign({},fi.precos||{});
      var g=(fi.comps||[]).reduce(function(t,c){var i=DB.insumos[c[0]];return t+((i&&(BASE[i.uni]==='g'||BASE[i.uni]==='ml'))?(+c[1]||0):0);},0);
      if(g>0)fi.precoVenda=r2(g/1000*kgBuffet);});
    FICHAS.forEach(function(a,i){var id='mock-ficha-'+(i+1);var x=a[7]||{};
      DB.fichas[id]={id:id,nome:a[0],cat:a[1],porcoes:1,custoEmbalagem:x.emb!=null?x.emb:(a[3]?1.1:0),precoVenda:a[2],precoIfood:a[3]||0,precos:a[3]?{ifood:a[3],proprio:a[4]}:{},vendasMes:0,tempoPreparo:12,utensilios:'',modoPreparo:[],padraoFinalizacao:'',comps:a[5].map(function(c){return [C(c[0]),c[1]];}).filter(function(c){return c[0];})};
      semana[id]=a[6];});
    REVENDA.forEach(function(rv){var ins=K[rv[0]];if(!ins)return;ins.revenda=true;var fi=revendaSync(ins);if(!fi)return;fi.precoVenda=rv[1];fi.cat='Bebidas';fi.armVenda='bar';semana[fi.id]=rv[2];});
    /* escala: o consumo pelas fichas fica perto de 31% da receita (CMV) */
    var RECEITA_DIA=5450,FATOR_DIA=[1.3,0.82,0.9,0.95,1.0,1.1,1.22];
    var custoPrato=function(fi){var acc=estExplodir(fi,1);var s=0;Object.keys(acc).forEach(function(id){var i=DB.insumos[id];if(!i)return;s+=acc[id]*(i.tipo==='preparado'?estCustoAtual(i):custoUnitCompra(i));});return s;};
    var vSemana=0;Object.keys(semana).forEach(function(id){vSemana+=semana[id]*custoPrato(DB.fichas[id]);});
    var escala=vSemana>0?(RECEITA_DIA*7.29*0.33)/vSemana:1;
    Object.keys(semana).forEach(function(id){semana[id]=Math.max(1,Math.round(semana[id]*escala));DB.fichas[id].vendasMes=Math.round(semana[id]*4.3);});

    /* consumo diário previsto de cada produto (venda direta + o que as produções gastam), na unidade dele */
    var uso={};
    var somaUso=function(acc,mult){Object.keys(acc).forEach(function(id){uso[id]=(uso[id]||0)+acc[id]*mult;});};
    Object.keys(semana).forEach(function(id){somaUso(estExplodir(DB.fichas[id],semana[id]/7),1);});
    ['estrog','feijoada','molho'].forEach(function(k){var s=K[k];if(!s||!uso[s.id])return;estReceitaPara(s,uso[s.id]).forEach(function(x){uso[x.insumoId]=(uso[x.insumoId]||0)+x.q;});});

    /* ideal e crítico, em números redondos como alguém digitaria */
    var redondo=function(v,i){if(i.uni==='un'||v>=10)return Math.ceil(v);if(i.tipo==='preparado'&&i.uni==='g')return Math.ceil(v/100)*100;return Math.ceil(v*2)/2;};
    Object.values(DB.insumos).forEach(function(i){if(!estEstocavel(i)||!uso[i.id])return;var r=ROTA[i._f];var cob=r?r.cob:4;
      i.estoqueMin=redondo(Math.max(1,uso[i.id]*cob),i);i.estoqueCrit=redondo(Math.max(0.5,uso[i.id]*cob*0.35),i);});
    /* alguns com o ponto de pedido alto (sempre aparecem na Lista de Compras) e dois que zeram na contagem de hoje */
    ['acucar','ovos','parmesao','cenoura','cerveja','linguica'].forEach(function(k){var i=K[k];if(i&&i.estoqueMin)i.estoqueCrit=redondo(i.estoqueMin*0.92,i);});
    var ZERA=['alface','cheiro'];
    /* produção sai em lotes: a compra cobre também um lote inteiro do que vai para os preparados */
    var LOTE={},porLote={};
    ['estrog','feijoada','molho'].forEach(function(k){var s=K[k];if(!s||!uso[s.id])return;var lote=(+s.rendimento||1);LOTE[k]=Math.max(lote,Math.ceil(uso[s.id]*5/lote)*lote);
      estReceitaPara(s,LOTE[k]).forEach(function(x){porLote[x.insumoId]=(porLote[x.insumoId]||0)+x.q*1.05;});});

    /* ---------- livro: saldo inicial (implantação) ---------- */
    var D0=diasSoma(INI,-1);
    Object.values(DB.insumos).forEach(function(i){if(!estEstocavel(i)||!uso[i.id]||i.tipo==='preparado')return;var r=ROTA[i._f];var q=r3(uso[i.id]*(r?r.cob:4)*rnd(0.6,0.9));if(i.uni==='un')q=Math.ceil(q);
      estMov('ajuste',i.id,0,{delta:q,custo:custoUnitCompra(i),arm:estArmEntradaDe(i),data:D0,hora:'07:30',origem:'manual',motivo:'Saldo inicial',obs:'implantação do estoque'});});
    ['estrog','feijoada','molho'].forEach(function(k){var s=K[k];if(!s||!uso[s.id])return;var q=r3(uso[s.id]*2);estMov('ajuste',s.id,0,{delta:q,custo:estCustoAtual(s),arm:EST_ARM_PRINCIPAL,data:D0,hora:'07:30',origem:'manual',motivo:'Saldo inicial',obs:'implantação do estoque'});});

    var valorEstoque=function(){var s=0;Object.values(DB.insumos).forEach(function(i){if(!estEstocavel(i))return;s+=(+i.estoqueAtual||0)*estCustoAtual(i);});return r2(s);};
    var eiMes={};eiMes[YM0]=valorEstoque();

    /* ---------- helpers do financeiro ---------- */
    var nfSeq={atac:48110,acou:7302,hort:2210,lat:15540,dist:88021,emb:3305,pesc:941};
    var linhaBoleto=function(){var d='';for(var k=0;k<44;k++)d+=Math.floor(R()*10);return '99990.'+d.slice(0,5)+' '+d.slice(5,10)+'.'+d.slice(10,16)+' '+d.slice(16,21)+'.'+d.slice(21,27)+' '+d.slice(27,28)+' '+d.slice(28,42);};
    var vencidasPagar=0;
    var baixaLiq=function(l,podeVencer){(l.liquidacoes||[]).forEach(function(q){if(q.data<=HOJE){
      if(podeVencer&&vencidasPagar<3&&q.data>=diasSoma(HOJE,-6)&&q.data<HOJE){vencidasPagar++;return;}   // poucas contas vencidas, recentes
      q.pago=true;q.pagoEm=q.data;}});};
    var despesa=function(data,g,sub,desc,valor,forma){if(data>HOJE||!(valor>0))return null;var l={id:uid(),data:data,grupo:g,sub:sub,descricao:desc,valor:r2(valor),forma:forma||'PIX',fornecedor:''};DB.lancamentos.push(l);return l;};

    var precoHoje=function(i,data){var dias=gpDias(INI,data)||0;var base=+i._p0||+i.preco||0;return r2(base*(1+dias*0.0006)*rnd(0.97,1.03));};
    Object.values(DB.insumos).forEach(function(i){if(i.tipo!=='preparado')i._p0=custoUnitCompra(i);});
    var tomateSobe=null;   // a última compra do tomate veio bem mais cara ("Preço subiu" na Posição)
    var ultimaHort=null;for(var dd=HOJE;dd>=diasSoma(HOJE,-6);dd=diasSoma(dd,-1)){if(ROTA.hort.dias.indexOf(dow(dd))>=0){ultimaHort=dd;break;}}
    var limaoCx=false;

    function comprar(data,fk){var r=ROTA[fk];var itens=[];
      Object.values(DB.insumos).forEach(function(i){if(i._f!==fk||!uso[i.id])return;
        if(i===K.linguica&&data>diasSoma(HOJE,-3))return;   // a última compra da linguiça está a caminho (marcada como comprada)
        var alvo=uso[i.id]*r.cob+(porLote[i.id]||0);var falta=alvo-(+i.estoqueAtual||0);if(falta<uso[i.id]*0.8)return;
        var q=i.uni==='un'?Math.ceil(falta):Math.ceil(falta*2)/2;var emb=insEmb(i);var nEmb=null;if(emb){nEmb=Math.max(1,Math.ceil(q/emb.qtd-1e-9));q=r3(nEmb*emb.qtd);}
        itens.push({i:i,q:q,nEmb:nEmb,emb:emb});});
      if(!itens.length)return;
      nfSeq[fk]++;var nf=String(nfSeq[fk]);var forn=FORN[fk];var cond=r.pag?(r.pag.parcelas?{parcelas:r.pag.parcelas}:{vencimento:diasSoma(data,r.pag.dias)}):null;
      itens.forEach(function(it){var i=it.i;var pu=precoHoje(i,data);
        if(i===K.tomate&&data===ultimaHort){pu=r2(pu*1.6);tomateSobe=pu;}
        var valor=r2(pu*it.q);
        var l={id:uid(),data:data,grupo:'CMV',sub:i.sub||i.cat||'',descricao:i.nome,valor:valor,insumoId:i.id,qtd:it.emb?it.nEmb:it.q,uni:it.emb?it.emb.nome:i.uni,forma:cond?'Boleto':'PIX',fornecedor:forn,nfe:nf};
        if(cond)aplicarLiquidacoes(l,cond);
        if(r.bol)(l.liquidacoes||[]).forEach(function(q){q.bol={linha:linhaBoleto(),em:data,por:'Colaborador 7'};});
        baixaLiq(l,!!cond);
        DB.lancamentos.push(l);
        estEntradaDeLanc(l,i,it.q,valor);          // a entrada vai pelo livro ANTES de atualizar o preço
        i.preco=pu;i.qtd=1;});
      if(fk==='hort'&&data===ultimaHort&&!limaoCx&&K.limao){limaoCx=true;   // chegou em CX e o limão não tem embalagem: "Conferir embalagem"
        DB.lancamentos.push({id:uid(),data:data,grupo:'CMV',sub:'Hortifruti',descricao:'LIMAO TAHITI CX',valor:58,insumoId:K.limao.id,qtd:1,uni:'CX',forma:'PIX',fornecedor:forn,nfe:nf});}
    }

    /* produção: requisição da Produção (sai do principal, entra na Produção) e produção que volta ao principal */
    var reqN=0;
    function produzir(data,k){var s=K[k];if(!s||!uso[s.id])return;var saldo=estSaldoArm(s,EST_ARM_PRINCIPAL);if(saldo>uso[s.id]*2.5)return;
      var qtd=LOTE[k];
      var comps=estReceitaPara(s,qtd);
      var itensReq=comps.map(function(c){var i=DB.insumos[c.insumoId];var q=c.q*1.05;q=i&&i.uni==='un'?Math.ceil(q):r3(q);return {insumoId:c.insumoId,qtd:q,entregue:q};});
      reqN++;var hh=horaDe(reqN);
      var req={id:uid(),data:data,turno:'dia',de:EST_ARM_PRINCIPAL,para:'producao',status:'retirada',pratos:[],itens:itensReq,obs:'Produção de '+s.nome,criadoEm:emISO(data,'07:'+pad2(reqN%50)),
        enviadaEm:emISO(data,'07:'+pad2(reqN%50+5)),separadoPor:'Colaborador 7',prontaEm:emISO(data,'08:00'),retiradaEm:emISO(data,'08:20'),concluidoPor:'Colaborador 7',por:'Colaborador 1',transfId:''};
      var t=estTransferir(data,EST_ARM_PRINCIPAL,'producao',itensReq.map(function(x){return {insumoId:x.insumoId,q:x.qtd};}),'Requisição do dia',{origem:'requisicao',reqId:req.id});
      if(t)req.transfId=t.id;DB.requisicoes.push(req);
      var p=estProduzir({subId:s.id,qtd:qtd,data:data,armDe:'producao',armPara:EST_ARM_PRINCIPAL,comps:comps,obs:'',por:'Colaborador 2',esperado:qtd});
      void p;void hh;}

    var ultBaixa=D0;
    function baixar(data){var dias=gpDias(ultBaixa,data)||1;ultBaixa=data;
      var itens=Object.keys(semana).map(function(id){return {fichaId:id,qtd:Math.max(0,Math.round(semana[id]*dias/7*rnd(0.92,1.08)))};}).filter(function(x){return x.qtd>0;});
      estBaixaVendas(data,itens,'Vendas do PDV ('+dias+' dia'+(dias>1?'s':'')+')',{origem:'manual'});}

    var MOTIVOS=[['tomate','Maturação/perda','Descarte',3],['alface','Murchou','Descarte',6],['contra','Ponto passado no buffet','Descarte',2.2],['frango','Sobra do buffet','Descarte',2.5],['estrog','Sobra do buffet','Descarte',1800],['batata','Brotou','Descarte',4],['leite','Vencido','Descarte',3]];
    var despN=0;
    function desperdicio(data){var m=MOTIVOS[despN%MOTIVOS.length];despN++;var i=K[m[0]];if(!i)return;var qtd=r3(m[3]*rnd(0.7,1.2));if(i.uni==='un')qtd=Math.max(1,Math.round(qtd));
      var cu=estCustoAtual(i);var dz={id:uid(),data:data,tipo:'insumo',refId:i.id,nome:i.nome,qtd:qtd,unidade:i.uni,custoUnit:r2(cu),custoTotal:r2(qtd*cu),motivo:m[1],responsavel:'Colaborador '+(1+despN%3),acao:m[2]};
      DB.desperdicios.push(dz);estPerdaDeDesp(dz);}

    function contagem(data,parcial){var itens=[],nao=[];var arm=EST_ARM_PRINCIPAL;
      Object.values(DB.insumos).forEach(function(i){if(!estEstocavel(i)||!uso[i.id])return;var teo=r3(estSaldoArm(i,arm));
        var ehZera=parcial&&ZERA.some(function(k){return K[k]===i;});
        if(parcial&&!ehZera&&R()<0.25){if(teo>0)nao.push({insumoId:i.id,teorico:teo,trat:'mantido'});return;}
        if(teo<=0&&!ehZera)return;
        var cont=ehZera?0:r3(teo*rnd(0.955,1.01));if(i.uni==='un'||(i.tipo!=='preparado'&&insEmb(i)&&i.uni==='un'))cont=Math.round(cont);
        var dif=r3(cont-teo);itens.push({insumoId:i.id,teorico:teo,contado:cont,dif:dif,valorDif:r2(dif*estCustoAtual(i))});});
      var c={id:uid(),data:data,arm:arm,itens:itens,obs:parcial?'Contagem de hoje (parte do estoque)':'Contagem de fim de mês',totalDif:r2(itens.reduce(function(s,x){return s+x.valorDif;},0)),por:'Colaborador 7',em:emISO(data,parcial?'09:40':'16:30')};
      if(nao.length)c.naoContados=nao;
      itens.forEach(function(x){if(x.dif)estMov('ajuste',x.insumoId,0,{delta:x.dif,arm:arm,origem:'contagem',refId:c.id,data:data,hora:parcial?'09:40':'16:30',motivo:'Contagem física',obs:x.dif<0?'faltou na contagem':'sobrou na contagem'});});
      DB.contagens.push(c);return c;}

    /* ---------- custos fixos (viram contas a pagar todo mês) ---------- */
    f.custosFixos=(f.custosFixos||[]).map(function(c){return Object.assign(c,{desde:YM0});});
    [['Internet e telefone',189,'Utilidades','Telefonia / Internet',8],['Dedetização',280,'Terceiros','Limpeza / Higiene',12],['Sistema do PDV',199,'Terceiros','Informática / TI',5],['IPTU (parcela)',420,'Despesas Prediais','IPTU',20]]
      .forEach(function(a,i){f.custosFixos.push({id:'mock-cf-'+(i+1),nome:a[0],valor:a[1],grupo:a[2],sub:a[3],diaVenc:a[4],desde:YM0,forma:'Boleto'});});

    /* ---------- folha: 8 colaboradores CLT + sócio ---------- */
    var CARGOS=[['Cozinheiro(a) chefe','Cozinha',3800],['Cozinheiro(a)','Cozinha',2900],['Auxiliar de cozinha','Cozinha',2200],['Auxiliar de cozinha','Cozinha',2100],['Atendente de caixa','Salão',2050],['Garçom / garçonete','Salão',2150],['Estoquista','Estoque',2350],['Auxiliar de limpeza','Apoio',1850]];
    f.funcionarios=CARGOS.map(function(a,i){var fu=demoFunc('Colaborador '+(i+1),a[0],a[2]);fu.id='mock-func-'+(i+1);fu.categoria=a[1];fu.vt=220;fu.desde=YM0;fu.freq='mensal';fu.forma='PIX';fu.pagosMes={};return fu;});
    var socio=demoFunc('Sócio 1','Sócio-administrador',8000,'Sócio');socio.id='mock-func-socio';socio.desde=YM0;socio.freq='mensal';socio.forma='PIX';socio.pagosMes={};f.funcionarios.push(socio);
    function folhaMes(ym){f.funcionarios.forEach(function(fu,ix){var data=ym+'-05';if(data>HOJE)return;if(ym===YM&&ix===4)return;   // um pagamento do mês ainda em aberto
      var m=custoFuncionario(fu,ym);fu.pagosMes[ym]=true;
      DB.lancamentos.push({id:uid(),fromFunc:'fn_'+fu.id+'|'+ym,data:data,grupo:'Mão-de-Obra',sub:fu.regime==='Sócio'?'Pró-labore':'Salários',descricao:fu.nome+' · líquido',valor:r2(m.liquido),forma:'PIX'});
      funcDespItens(fu,ym).forEach(function(it){if(!it.on||!(it.v>0))return;var d=it.k==='vt'?ym+'-05':ym+'-20';if(d>HOJE)return;
        DB.lancamentos.push({id:uid(),fromFunc:funcDespKey(fu,ym,it.k),data:d,grupo:it.g,sub:it.s,descricao:it.nome+' · '+fu.nome+' · '+ymLabel(ym),valor:it.v,forma:'PIX',fornecedor:''});});});}

    /* ---------- simulação dia a dia ---------- */
    var receitaMes={};
    var MIX=[['mrPix',0.28],['mrCred',0.30],['mrDeb',0.17],['mrDin',0.08],['mrVR',0.07],['mrIfood',0.10]];
    var mesAtual=null;
    for(var d=INI;d<=HOJE;d=diasSoma(d,1)){
      var ym=ymDe(d),w=dow(d);
      if(ym!==mesAtual){mesAtual=ym;eiMes[ym]=eiMes[ym]!=null?eiMes[ym]:valorEstoque();
        gerarRecorrentesMes(ym);(f.contasPagar||[]).forEach(function(c){if(c.mesRef===ym&&/Energia|Água|Gás/.test(c.descricao||''))c.valor=r2(c.valor*rnd(0.92,1.1));});
        folhaMes(ym);}
      /* receita do dia, um lançamento por meio */
      var mesIdx=MESES.indexOf(ym);var tot=RECEITA_DIA*FATOR_DIA[w]*(1+0.03*mesIdx)*rnd(0.9,1.1);receitaMes[ym]=(receitaMes[ym]||0)+tot;
      MIX.forEach(function(mx){var m=meioPorId(mx[0]);if(!m)return;var v=r2(tot*mx[1]*rnd(0.85,1.15));
        var l={id:uid(),data:d,grupo:'Receita',sub:m.nome,descricao:'Vendas · '+m.nome,valor:v,forma:m.nome,meioId:m.id,fornecedor:''};aplicarLiquidacoes(l,{});
        (l.liquidacoes||[]).forEach(function(q){if(q.data<=HOJE&&!(m.id==='mrIfood'&&q.data>=diasSoma(HOJE,-7)&&q.data<HOJE)){q.pago=true;q.pagoEm=q.data;}});
        DB.lancamentos.push(l);});
      /* compras do dia */
      Object.keys(ROTA).forEach(function(fk){if(ROTA[fk].dias.indexOf(w)>=0&&(fk!=='emb'||gpDias(INI,d)%14<7))comprar(d,fk);});
      /* produção, vendas, perdas */
      ['feijoada','molho','estrog'].forEach(function(k){produzir(d,k);});
      if(w===3||w===0||d===HOJE)baixar(d);
      if(gpDias(INI,d)%9===4)desperdicio(d);
      /* despesas variáveis */
      var dia=+d.slice(8,10);
      if(dia===20)despesa(d,'Impostos','Simples Nacional','DAS Simples Nacional',(receitaMes[ymSoma(ym,-1)]||RECEITA_DIA*30)*0.062,'Boleto');
      if(dia===3)despesa(d,'Publicidade','Marketing Digital','Agência de marketing digital',2800);
      if(dia===15)despesa(d,'Publicidade','Publicidade e Propaganda','Impulsionamento nas redes',r2(rnd(800,1100)));
      if(dia===6||dia===21)despesa(d,'Materiais','Material de Limpeza','Material de limpeza',r2(rnd(420,780)));
      if(dia===12)despesa(d,'Materiais','Material de Cozinha','Utensílios de cozinha',r2(rnd(250,420)));
      if(dia===9)despesa(d,'Despesas Prediais','Manutenção Predial','Manutenção da coifa',r2(rnd(380,620)));
      if(dia===17)despesa(d,'Despesas Gerais','Manutenção Geral','Conserto de equipamento',r2(rnd(600,1400)));
      if(dia===25)despesa(d,'Despesas Gerais','Despesas Diversas','Pequenas despesas do mês',r2(rnd(200,380)),'Dinheiro');
      if(dia===10)despesa(d,'Despesas Gerais','Associações / Sindicatos','Contribuição sindical patronal',120,'Boleto');
      if(dia===28)despesa(d,'Despesas Financeiras','Tarifas Bancárias','Tarifas do banco',r2(rnd(120,160)),'Débito em conta');
      if(w===6)despesa(d,'Terceiros','Motoboy / Delivery','Motoboys da semana',r2(rnd(560,720)));
      /* contas fixas que vencem hoje: pagas no dia (sobram as que ainda vão vencer e uma vencida) */
      (f.contasPagar||[]).forEach(function(c){if(c.vencimento===d&&!c.pago){if(ym===YM&&/Internet/.test(c.descricao||'')&&d<HOJE&&d>=diasSoma(HOJE,-10))return;if(d<=HOJE){c.pago=true;syncContaLanc('contasPagar',c);}}});
      /* fim de mês: contagem e Controle de CMV */
      if(d===fimDoMes(ym)&&d<HOJE){contagem(d,false);
        var compras=DB.lancamentos.filter(function(l){return l.grupo==='CMV'&&ymDe(l.data)===ym;}).reduce(function(s,l){return s+(+l.valor||0);},0);
        var ef=valorEstoque();DB.cmvRegistros.push({id:'mock-cmv-'+ym,data:d,ei:eiMes[ym],compras:r2(compras),ef:ef,vendas:r2(receitaMes[ym])});eiMes[ymSoma(ym,1)]=ef;}
    }
    contagem(HOJE,true);   // contagem de hoje: parte do estoque, com itens não contados (mantidos) e dois zerados

    /* ---------- metas de faturamento ---------- */
    MESES.concat([ymSoma(YM,1)]).forEach(function(ym,i){var base=RECEITA_DIA*30.4*(1+0.03*i);var cfg=metasAno(ym.slice(0,4));
      cfg.meses[ym]={minimo:Math.round(base*0.92/1000)*1000,realista:Math.round(base*1.02/1000)*1000,desafiador:Math.round(base*1.12/1000)*1000};});

    /* ---------- contas a receber ---------- */
    f.contasReceber=[
      {id:'mock-cr-1',descricao:'Evento corporativo · Empresa Exemplo',grupo:'Receita',sub:'Outras Receitas',vencimento:diasSoma(HOJE,12),valor:4800,recebido:false,forma:'PIX'},
      {id:'mock-cr-2',descricao:'Convênio de refeições · Empresa Demo',grupo:'Receita',sub:'Outras Receitas',vencimento:diasSoma(HOJE,-4),valor:3250,recebido:false,forma:'Boleto'},
      {id:'mock-cr-3',descricao:'Festa de aniversário (buffet fechado)',grupo:'Receita',sub:'Outras Receitas',vencimento:diasSoma(HOJE,-15),valor:2100,recebido:true,forma:'PIX'}];
    f.contasReceber.forEach(function(c){if(c.recebido)syncContaLanc('contasReceber',c);});

    /* ---------- estoque: comprado aguardando chegada, requisições abertas ---------- */
    if(K.linguica)K.linguica.compra={status:'comprado',qtd:r3(K.linguica.estoqueMin||10),fornecedor:FORN.acou,previsao:diasSoma(HOJE,2),em:emISO(HOJE,'08:15'),por:'Colaborador 7'};
    var reqHoje=function(id,para,status,itens,extra){var r=Object.assign({id:id,data:HOJE,turno:'dia',de:EST_ARM_PRINCIPAL,para:para,status:status,pratos:[],itens:itens.filter(function(x){return x.insumoId;}),obs:'',criadoEm:emISO(HOJE,'07:40'),transfId:'',por:'Colaborador 1'},extra||{});DB.requisicoes.push(r);return r;};
    reqHoje('mock-req-1','producao','solicitada',[{insumoId:C('tomate'),qtd:6},{insumoId:C('cebola'),qtd:3},{insumoId:C('frango'),qtd:8},{insumoId:C('creme'),qtd:2}],{enviadaEm:emISO(HOJE,'07:45'),obs:'Para o almoço'});
    reqHoje('mock-req-2','bar','pronta',[{insumoId:C('laranja'),qtd:10},{insumoId:C('limao'),qtd:2},{insumoId:C('acucar'),qtd:2}],{enviadaEm:emISO(HOJE,'07:50'),separandoEm:emISO(HOJE,'08:05'),prontaEm:emISO(HOJE,'08:25'),separadoPor:'Colaborador 7',por:'Colaborador 6'});
    reqHoje('mock-req-3','producao','aberta',[{insumoId:C('feijao'),qtd:5},{insumoId:C('linguica'),qtd:3}],{obs:'Rascunho para amanhã'});

    /* ---------- equipe com acesso ---------- */
    var subDe=function(N){return Object.fromEntries(ESTOQUE_SUBS.map(function(a){return [a[0],N&&N.sub?!!N.sub[a[0]]:true];}));};
    [['mock-m-1','Colaborador 1','gerente',[]],['mock-m-2','Colaborador 2','producao',['producao']],['mock-m-3','Colaborador 7','estoquista',[EST_ARM_PRINCIPAL]]].forEach(function(a){var nivel=NIVEIS[a[2]]?a[2]:'gerente';var N=NIVEIS[nivel];
      DB.equipe=(DB.equipe||[]).filter(function(m){return m.id!==a[0];});
      DB.equipe.push({id:a[0],nome:a[1],email:a[0]+'@restaurante-demo.invalid',senha:'',nivel:nivel,permissoes:N.perms.slice(),setores:a[3].slice(),sub:subDe(N)});});

    /* ---------- buffet: os últimos 21 dias, hoje incluído (o mapa já vem da demo) ---------- */
    var bf=DB.buffet||{};var kg=+bf.precoVendaKg||45.9;
    if((bf.cubas||[]).length){DB.buffetDias={};for(var k=20;k>=0;k--){var iso=diasSoma(HOJE,-k);var cons=0;
      var itens=bf.cubas.map(function(c,i){var a=+c.pesoKg||0,nr=(i+k)%3,v=((i+k)%4===0)?+(a*0.15).toFixed(1):'',dc=((i*3+k)%5===0)?+(a*0.1).toFixed(1):'';cons+=a*(1+nr)-(+v||0)-(+dc||0);
        return {id:'mock-bd-'+k+'-'+i,c:c.id,f:c.fichaId,n:'',a:a,r:Array(nr).fill(a),v:v,d:dc};});
      var kgV=+(cons*rnd(0.9,0.97)).toFixed(1);DB.buffetDias[iso]={itens:itens,pk:kg,kgV:kgV,pes:Math.round(kgV/0.48),eq:+(cons*0.04).toFixed(1),vnd:+(kgV*kg*rnd(1.0,1.06)).toFixed(2)};}}

    /* ---------- checklists (folha do mês) e notificações ---------- */
    try{DB.checklists=chkBuildDefaults();DB.checklistReg={};
      DB.checklists.slice(0,3).forEach(function(cl,ci){for(var k=12;k>=1;k--){var dia=diasSoma(HOJE,-k);var reg=chkReg(cl.id,dia);
        (cl.secoes||[]).forEach(function(s){(s.tarefas||[]).forEach(function(t,ti){var x=R();reg.st[t.id]=x<0.86?'ok':x<0.93?'in':'no';void ti;});});void ci;}});}catch(e){}
    var notif=function(alvo,titulo,texto,quando,extra){var n=notificar(alvo,titulo,texto,extra||{});if(n){n.criadoEm=quando;n.por=n.por||'Colaborador 7';}};
    notif({perm:'req_separar'},'Requisição nova: Produção','4 item(ns) · '+fmtDataBR(HOJE)+' · pedido por Colaborador 1',emISO(HOJE,'07:45'),{rota:'estoque',tab:'requisicoes',reqId:'mock-req-1'});
    notif({setor:'bar'},'Requisição pronta para retirada: Bar','3 item(ns) separados por Colaborador 7',emISO(HOJE,'08:25'),{rota:'estoque',tab:'requisicoes',reqId:'mock-req-2'});
    notif({perm:'compras'},'Linguiça toscana marcada como comprada','Chega em '+fmtDataBR(diasSoma(HOJE,2)),emISO(HOJE,'08:15'),{rota:'estoque',tab:'compras'});
    notif({admin:true},'Contagem salva com divergência','Contagem de hoje · itens não contados mantidos',emISO(HOJE,'09:40'),{rota:'estoque',tab:'contar'});
    notif({perm:'financeiro'},'Contas vencidas','Há boletos de fornecedor vencidos nos últimos dias',emISO(diasSoma(HOJE,-1),'18:00'),{rota:'financeiro',tab:'pagar'});

    /* limpa as marcas internas da simulação */
    Object.values(DB.insumos).forEach(function(i){delete i._f;delete i._p0;});
    void tomateSobe;
    try{normData();}catch(e){}
    return true;
  }

  window.flowPreviewMock={montar:montar};
  /* o sino de notificações só aparece com nuvem; no preview rico ele aparece (gancho que o index.html já tem: window.__MOCK) */
  try{if(DB&&DB._previewMock){window.__MOCK=true;if(typeof renderBell==='function')renderBell();}}catch(e){}
})();
