/* Painel "Simular" do PREVIEW (tools/preview_build.py injeta este arquivo só no _site/).
   O index.html de produção NÃO tem nada disto. Tudo aqui roda no navegador de quem abriu o preview:
   nada vai para o banco (no preview não existe banco: sb = null).

   Perfil: cria um membro fictício em DB.equipe e roda o MESMO trecho do login de membro do Flow
   (copiado de entrarComoCliente pelo preview_build.py na hora do build; se o login mudar, o trecho
   copiado muda junto, e se o build não achar o trecho, ele falha).
   Cenários: montam dados fictícios na demonstração, só no navegador. */
(function(){
  'use strict';
  if(typeof sb!=='undefined'&&sb)return;                       // nunca roda conectado a banco
  if(typeof DB==='undefined'||typeof NIVEIS==='undefined')return;

  var SIM_KEY='flow_preview_sim_v1';
  var SIM_ID='sim-preview';
  var SIM_EMAIL='simulacao@preview.invalid';

  /* ===== trecho do login de membro (entrarComoCliente), copiado pelo preview_build.py ===== */
  function loginComo(email){
    /*@@TRECHO_LOGIN@@*/
    return true;
  }

  function lerEstado(){try{return JSON.parse(localStorage.getItem(SIM_KEY)||'null');}catch(e){return null;}}
  function gravarEstado(st){try{if(st)localStorage.setItem(SIM_KEY,JSON.stringify(st));else localStorage.removeItem(SIM_KEY);}catch(e){}}
  function h(s){return typeof esc==='function'?esc(s):String(s==null?'':s);}
  function subCompleto(N){return Object.fromEntries(ESTOQUE_SUBS.map(function(a){return [a[0],N&&N.sub?!!N.sub[a[0]]:true];}));}
  function rotulo(st){if(!st)return 'Dono';var N=NIVEIS[st.nivel]||NIVEIS.personalizado;var s=(st.setores||[]).map(function(id){return estArmNome(id);});return N.label+(s.length&&st.nivel!=='admin'?' · '+s.join(', '):'');}

  /* membro fictício, no mesmo formato que saveMembro grava */
  function membroDe(st){
    var N=NIVEIS[st.nivel]||NIVEIS.personalizado;
    var m={id:SIM_ID,nome:'Simulação do preview',email:SIM_EMAIL,senha:'',nivel:st.nivel,
      permissoes:st.nivel==='personalizado'?(st.permissoes||[]).slice():N.perms.slice(),
      setores:st.nivel==='admin'?[]:(st.setores||[]).slice(),
      sub:st.nivel==='personalizado'?Object.assign(subCompleto(null),st.sub||{}):subCompleto(N)};
    if(st.nivel==='admin')m.permissoes=NIVEIS.admin.perms.slice();
    return m;
  }
  function porMembro(st){
    DB.equipe=(DB.equipe||[]).filter(function(x){return x.id!==SIM_ID;});
    if(st)DB.equipe.push(membroDe(st));
  }

  /* entra como o membro de teste. Garante o membro na Equipe antes do login copiado e nunca deixa o ramo
     de dono fixar DB.conta.email com o e-mail fictício. Devolve false se o login não entrou como membro. */
  function entrar(st){
    porMembro(st);
    DB.conta=DB.conta||{};var emailAntes=DB.conta.email;
    var ok=loginComo(SIM_EMAIL);
    if(emailAntes===undefined)delete DB.conta.email;else DB.conta.email=emailAntes;
    if(ok===undefined)return false;                             // telaMensagem: perfil sem área
    if(!MEMBRO_PERMS){toast('A simulação caiu no acesso de dono: o membro de teste não foi achado');return false;}
    return true;
  }
  function desfazer(msg){porMembro(null);save();gravarEstado(null);if(msg)toast(msg);setTimeout(function(){location.reload();},msg?1200:0);}
  function aplicar(st){
    if(!st||st.nivel==='dono'){voltarDono();return true;}
    var m=membroDe(st);
    if(!m.permissoes.length){toast('Esse perfil não tem nenhuma área liberada');return false;}   // valida antes de gravar
    gravarEstado(st);
    if(!entrar(st)){desfazer('Não deu para entrar com esse perfil; voltando a dono');return false;}
    save();selo();return true;
  }
  function voltarDono(){
    porMembro(null);save();gravarEstado(null);
    location.reload();                                          // dono = abrir o app de novo, como no login real
  }

  /* ===== cenários de dados (só neste navegador) ===== */
  function garantirArm(id,nome,extra){var arms=estArmazens();var a=arms.find(function(x){return x.id===id;});if(!a){a=Object.assign({id:id,nome:nome},extra||{});arms.push(a);}else Object.assign(a,extra||{});return a;}
  function entradaSeVazio(ins,q,arm){if(!ins||!estEstocavel(ins))return;if(Math.abs(estSaldoArm(ins,arm||EST_ARM_PRINCIPAL))>0.0005)return;
    estMov('entrada',ins.id,q,{arm:arm||EST_ARM_PRINCIPAL,origem:'simulacao',obs:'cenário do preview'});}
  function qPadrao(ins){var u=(ins.uni||'').toLowerCase();return u==='un'?48:(u==='g'||u==='ml'||u==='gr')?5000:20;}
  function insPorNome(re){return Object.values(DB.insumos).find(function(i){return re.test(i.nome||'');});}

  function cenarioSetores(){
    garantirArm('cozinha','Cozinha',{producao:true});garantirArm('pizzaria','Pizzaria');garantirArm('churrascaria','Churrascaria');
    var m=catSetoresMap();
    var vinc={'Hortifruti':['cozinha'],'Grãos':['cozinha'],'Molhos':['cozinha'],'Proteínas':['cozinha','churrascaria'],'Frios e Laticínios':['pizzaria'],'Massas':['pizzaria'],'Óleos':['cozinha','pizzaria','churrascaria']};
    Object.keys(vinc).forEach(function(sub){m[catSetorKey('CMV',sub)]=vinc[sub].slice();});
    // produtos da pizzaria (fictícios, id fixo para não duplicar)
    if(!DB.insumos['sim-farinha'])DB.insumos['sim-farinha']={id:'sim-farinha',nome:'Farinha de trigo',cat:'Massas',grupo:'CMV',sub:'Massas',tipo:'pronto',uni:'kg',preco:4.9,qtd:1,fornecedor:'Atacadão'};
    var oleo=insPorNome(/óleo/i);
    if(!DB.insumos['sim-massa'])DB.insumos['sim-massa']={id:'sim-massa',nome:'Massa de pizza',cat:'Massas',grupo:'CMV',sub:'Massas',tipo:'preparado',estocavel:true,uni:'g',rendimento:5000,
      comps:[['sim-farinha',3000]].concat(oleo?[[oleo.id,100]]:[]),setores:['pizzaria'],fornecedor:'',modoPreparo:[],utensilios:'',tempoPreparo:''};
    var est=insPorNome(/estrogonofe/i);if(est&&est.tipo==='preparado'){est.estocavel=true;}
    // estoque: entra no principal e vai uma parte para cada setor (pelo livro, como no app)
    Object.values(DB.insumos).forEach(function(i){if(estEstocavel(i)&&i.tipo!=='preparado')entradaSeVazio(i,qPadrao(i));});
    var hoje=hojeISO();
    setoresSemPrincipal().forEach(function(a){
      var ja=estTransfs().some(function(t){return t.origem==='simulacao'&&t.para===a.id;});if(ja)return;
      var itens=Object.values(DB.insumos).filter(function(i){return estEstocavel(i)&&i.tipo!=='preparado'&&prodNoSetor(i,a.id);})
        .map(function(i){return {insumoId:i.id,q:Math.max(1,Math.round(qPadrao(i)/5))};});
      if(itens.length)estTransferir(hoje,EST_ARM_PRINCIPAL,a.id,itens,'cenário do preview',{origem:'simulacao'});
    });
    var massa=DB.insumos['sim-massa'];if(massa&&!estSaldoArm(massa,'pizzaria'))estMov('ajuste',massa.id,0,{delta:4000,arm:'pizzaria',origem:'simulacao',obs:'cenário do preview'});
    if(est&&est.estocavel&&!estSaldoArm(est,'cozinha'))estMov('ajuste',est.id,0,{delta:3000,arm:'cozinha',origem:'simulacao',obs:'cenário do preview'});
    save();refazer();toast('Restaurante com setores: Cozinha, Pizzaria e Churrascaria');
  }

  function cenarioPacotes(){
    var hoje=hojeISO();
    function lanc(id,ins,qtd,uni,valor){if(!ins||DB.lancamentos.some(function(l){return l.id===id;}))return;
      DB.lancamentos.push({id:id,data:hoje,grupo:'CMV',sub:ins.sub||ins.cat||'',descricao:'Compra de demonstração · '+ins.nome,valor:valor,insumoId:ins.id,qtd:qtd,uni:uni,forma:'',fornecedor:ins.fornecedor||''});}
    var arroz=insPorNome(/arroz/i),oleo=insPorNome(/óleo/i),refri=insPorNome(/refrigerante/i),feijao=insPorNome(/feijão/i),tomate=insPorNome(/tomate/i);
    if(arroz){arroz.embNome='PCT';arroz.embQtd=5;entradaSeVazio(arroz,30);lanc('sim-pct-arroz',arroz,6,'PCT',156);}          // pacote de 5 kg
    if(oleo){oleo.embNome='CX';oleo.embQtd=18;entradaSeVazio(oleo,36);lanc('sim-cx-oleo',oleo,2,'CX',270);}                 // caixa com 18 L
    if(refri){refri.embNome='FD';refri.embQtd=12;entradaSeVazio(refri,48);lanc('sim-fd-refri',refri,4,'FD',153.6);}          // fardo com 12 latas
    if(feijao){feijao.embNome='PCT';feijao.embQtd=1;entradaSeVazio(feijao,10);lanc('sim-pct-feijao',feijao,10,'PCT',78);}    // 1 kg por pacote: "confira?"
    if(tomate){delete tomate.embNome;tomate.embQtd=0;entradaSeVazio(tomate,8);lanc('sim-cx-tomate',tomate,2,'CX',95);}       // chegou em CX sem embalagem
    save();refazer();toast('Produtos em pacote e caixa prontos (veja Estoque › Posição)');
  }

  /* preparado com porção e 8 ingredientes (Estoque › Quanto comprar): fictício, id fixo para não duplicar */
  function cenarioReceita8(){
    var itens=[['sim-r8-tomate','Tomate italiano','Hortifruti','kg',3000,2],['sim-r8-cebola','Cebola','Hortifruti','kg',800,0],['sim-r8-alho','Alho','Hortifruti','kg',100,0.5],
      ['sim-r8-azeite','Azeite','Óleos','L',200,0,'GF',0.5],['sim-r8-ovo','Ovo','Frios e Laticínios','un',6,2,'BDJ',30],['sim-r8-creme','Creme de leite','Frios e Laticínios','kg',600,0],
      ['sim-r8-sal','Sal','Grãos','kg',30,5],['sim-r8-manj','Manjericão','Hortifruti','g',40,0]];
    itens.forEach(function(x){if(!DB.insumos[x[0]]){var o={id:x[0],nome:x[1],cat:x[2],grupo:'CMV',sub:x[2],tipo:'pronto',uni:x[3],preco:10,qtd:1,fornecedor:'Fornecedor Demo',noEstoque:true};if(x[6]){o.embNome=x[6];o.embQtd=x[7];}DB.insumos[x[0]]=o;}
      if(x[5])entradaSeVazio(DB.insumos[x[0]],x[5]);});
    if(!DB.insumos['sim-r8'])DB.insumos['sim-r8']={id:'sim-r8',nome:'Molho da casa (demo)',cat:'Molhos',grupo:'CMV',sub:'Molhos',tipo:'preparado',estocavel:true,uni:'g',rendimento:5000,porcaoBase:250,porcaoNome:'porção',
      comps:itens.map(function(x){return [x[0],x[4]];}),fornecedor:'',modoPreparo:[],utensilios:'',tempoPreparo:''};
    save();refazer();toast('Preparado com 8 ingredientes pronto (veja Estoque › Quanto comprar)');
  }

  function zerarDemo(){
    fechar();
    uxConfirma({titulo:'Zerar e recarregar a demonstração?',texto:'Apaga o que você fez neste preview (só neste navegador) e abre o restaurante de demonstração do zero.',sim:'Zerar',nao:'Cancelar',perigo:true},function(){
      try{localStorage.removeItem(STORE_KEY);localStorage.removeItem('flow_preview_demo_v1');}catch(e){}
      gravarEstado(null);location.reload();
    });
  }

  function carregarArquivo(inp){
    var f=inp.files&&inp.files[0];if(!f)return;
    var r=new FileReader();
    r.onload=function(){
      var j=null;try{j=JSON.parse(r.result);}catch(e){}
      var ok=function(x){return !!(x&&x.insumos&&x.fichas);};          // mesma checagem do importarBackup
      var d=ok(j)?j:(j&&ok(j.dados)?j.dados:null);
      if(!d){toast('Arquivo não parece um Flow exportado (falta "insumos" ou "fichas")');return;}
      var st=lerEstado();DB=d;
      try{localStorage.setItem('flow_preview_demo_v1','1');}catch(e){}
      fechar();
      if(st){if(!entrar(st)){desfazer('Não deu para entrar com o perfil simulado; voltando a dono');return;}}
      save();if(!st)go('dashboard');
      toast('Arquivo aberto só neste navegador');
    };
    r.readAsText(f);
  }

  function refazer(){var st=lerEstado();if(st){if(!entrar(st)){desfazer('Não deu para entrar com o perfil simulado; voltando a dono');return;}save();}else{try{go(current||'dashboard');}catch(e){go('dashboard');}}renderPainel();}

  /* ===== interface ===== */
  var css=document.createElement('style');
  css.textContent=[
    '#fsimBtn{position:fixed;right:12px;bottom:36px;z-index:300;max-width:calc(100vw - 24px);border:1px solid #A48A57;background:#fff;color:#1D3573;border-radius:999px;padding:6px 12px;font:600 12px/1.2 Inter,system-ui,sans-serif;box-shadow:0 4px 14px rgba(16,32,63,.18);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92}',
    '#fsimBtn:hover{opacity:1}',
    '#fsimBtn.on{background:#A48A57;color:#fff;border-color:#A48A57}',
    '#fsimBg{position:fixed;inset:0;z-index:1160;background:rgba(16,32,63,.35)}',
    '#fsimPainel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;z-index:1170;background:#fff;color:#1b2540;box-shadow:-8px 0 30px rgba(16,32,63,.25);display:flex;flex-direction:column;font:13px/1.4 Inter,system-ui,sans-serif}',
    '#fsimPainel .fs-h{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e6e8ef}',
    '#fsimPainel .fs-h b{font:700 16px/1.2 Fraunces,Georgia,serif;color:#1D3573}',
    '#fsimPainel .fs-x{border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#5b6478;padding:4px 8px}',
    '#fsimPainel .fs-c{overflow-y:auto;padding:12px 16px 24px;flex:1}',
    '#fsimPainel .fs-aviso{background:#fdf3e1;border:1px solid #e9c98d;color:#7a4b06;border-radius:10px;padding:8px 10px;font-weight:600;margin-bottom:12px}',
    '#fsimPainel .fs-t{font-weight:700;color:#1D3573;margin:14px 0 6px;text-transform:uppercase;font-size:11px;letter-spacing:.06em}',
    '#fsimPainel .fs-d{color:#5b6478;font-size:12px;margin:4px 0 8px}',
    '#fsimPainel select,#fsimPainel .fs-btn{width:100%;box-sizing:border-box;min-height:40px;border-radius:10px;border:1px solid #cfd4e0;padding:8px 10px;font:inherit;background:#fff;color:inherit}',
    '#fsimPainel .fs-btn{cursor:pointer;text-align:left;margin-top:6px}',
    '#fsimPainel .fs-btn.pri{background:#1D3573;color:#fff;border-color:#1D3573;text-align:center;font-weight:600}',
    '#fsimPainel .fs-row{display:flex;gap:8px}#fsimPainel .fs-row .fs-btn{flex:1 1 0;width:0;text-align:center}',
    '#fsimPainel .fs-ck{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}',
    '#fsimPainel .fs-ck label{display:flex;gap:6px;align-items:flex-start;font-size:12.5px;cursor:pointer}',
    '#fsimPainel .fs-ck input{width:16px;height:16px;margin-top:1px;accent-color:#1D3573;flex:none}',
    '#fsimPainel .fs-ag{font-size:12px;color:#5b6478;margin-top:8px}',
    '@media(max-width:640px){#fsimBtn{bottom:46px;right:8px}#fsimPainel{top:auto;left:0;width:auto;max-height:88vh;border-radius:16px 16px 0 0}#fsimPainel .fs-ck{grid-template-columns:1fr}#fsimPainel .fs-c{padding-bottom:64px}#fsimPainel select{font-size:16px}}'
  ].join('\n');
  document.head.appendChild(css);

  var btn=document.createElement('button');btn.id='fsimBtn';btn.type='button';btn.onclick=abrir;document.body.appendChild(btn);
  function selo(){var st=lerEstado();btn.classList.toggle('on',!!st);btn.textContent=st?'Simulando: '+rotulo(st):'Simular';btn.title=st?'Você está vendo o Flow como '+rotulo(st)+'. Clique para trocar ou voltar a dono.':'Simular outro perfil de usuário ou outro cenário de dados (só neste preview)';}

  var rasc=null;   // escolha no painel antes de aplicar
  function abrir(){var st=lerEstado();rasc=st?JSON.parse(JSON.stringify(st)):{nivel:'dono',setores:[]};renderPainel(true);}
  function fechar(){['fsimBg','fsimPainel'].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});}

  function renderPainel(forcar){
    var p=document.getElementById('fsimPainel');if(!p&&!forcar)return;
    if(!rasc)rasc={nivel:'dono',setores:[]};
    if(!p){var bg=document.createElement('div');bg.id='fsimBg';bg.onclick=fechar;document.body.appendChild(bg);p=document.createElement('div');p.id='fsimPainel';p.setAttribute('role','dialog');document.body.appendChild(p);}
    var st=lerEstado();var nv=rasc.nivel;var N=NIVEIS[nv];
    var opts='<option value="dono"'+(nv==='dono'?' selected':'')+'>Dono (acesso total)</option>'+Object.keys(NIVEIS).map(function(k){return '<option value="'+k+'"'+(nv===k?' selected':'')+'>'+h(NIVEIS[k].label)+'</option>';}).join('');
    var multi=estMultiArm();
    var setoresHTML=(nv!=='dono'&&nv!=='admin')?'<div class="fs-t">Setores do membro</div>'+(multi?'<div class="fs-ck" id="fsimSetores">'+estArmazens().map(function(a){return '<label><input type="checkbox" data-setor="'+h(a.id)+'"'+((rasc.setores||[]).includes(a.id)?' checked':'')+'> '+h(a.nome)+'</label>';}).join('')+'</div>':'<div class="fs-d">Este restaurante tem um estoque só, então o setor não muda nada. Para testar setores, use o cenário "Restaurante com setores" abaixo.</div>'):'';
    var persHTML=nv==='personalizado'?'<div class="fs-t">Áreas</div><div class="fs-ck" id="fsimPerms">'+ACESSOS.map(function(a){return '<label><input type="checkbox" data-perm="'+a[0]+'"'+((rasc.permissoes||[]).includes(a[0])?' checked':'')+'> '+h(a[1])+'</label>';}).join('')+'</div>'+
      '<div class="fs-t">Permissões</div><div class="fs-ck" id="fsimSubs">'+ESTOQUE_SUBS.map(function(a){return '<label><input type="checkbox" data-sub="'+a[0]+'"'+(!rasc.sub||rasc.sub[a[0]]?' checked':'')+'> '+h(a[1])+'</label>';}).join('')+'</div>':'';
    p.innerHTML='<div class="fs-h"><b>Simular</b><button type="button" class="fs-x" aria-label="Fechar" id="fsimFechar">×</button></div><div class="fs-c">'+
      '<div class="fs-aviso">Nada aqui vai para o banco: tudo fica neste navegador.</div>'+
      '<div class="fs-d">Agora: <b>'+h(rotulo(st))+'</b></div>'+
      '<div class="fs-t">Perfil de quem está logado</div><select id="fsimNivel">'+opts+'</select>'+
      '<div class="fs-d">'+(nv==='dono'?'Dono do restaurante: vê tudo.':h(N?N.desc:''))+'</div>'+setoresHTML+persHTML+
      '<div class="fs-row"><button type="button" class="fs-btn pri" id="fsimAplicar">Aplicar perfil</button>'+(st?'<button type="button" class="fs-btn" id="fsimDono">Voltar a dono</button>':'')+'</div>'+
      '<div class="fs-ag">O perfil entra como um membro de teste na Equipe ("Simulação do preview") e passa pelo mesmo código do login de membro.</div>'+
      '<div class="fs-t">Cenários de dados</div>'+
      '<button type="button" class="fs-btn" id="fsimSetoresCen">Restaurante com setores<div class="fs-d" style="margin:2px 0 0">Cozinha, Pizzaria e Churrascaria, com produtos e preparados vinculados e saldo em cada um</div></button>'+
      '<button type="button" class="fs-btn" id="fsimPacotes">Produtos em pacote e caixa<div class="fs-d" style="margin:2px 0 0">Arroz em PCT, óleo em CX, refrigerante em FD e notas em CX para conferir</div></button>'+
      '<button type="button" class="fs-btn" id="fsimReceita8">Preparado com 8 ingredientes<div class="fs-d" style="margin:2px 0 0">Molho da casa com porção de 250 g, ovo em bandeja e azeite em garrafa, para o Quanto comprar</div></button>'+
      '<button type="button" class="fs-btn" id="fsimZerar">Zerar e recarregar demonstração</button>'+
      '<label class="fs-btn" style="display:block">Abrir um arquivo .json exportado<div class="fs-d" style="margin:2px 0 0">Só lê o arquivo escolhido, neste navegador. Nada é enviado. Nunca coloque esse arquivo no repositório.</div><input type="file" accept=".json,application/json" id="fsimArq" style="display:none"></label>'+
      '</div>';
    var q=function(id){return document.getElementById(id);};
    q('fsimFechar').onclick=fechar;
    q('fsimNivel').onchange=function(){var n=this.value;var N2=NIVEIS[n];lerChecks();var ant=rasc.nivel;rasc.nivel=n;
      if(n==='personalizado'){if(ant!=='personalizado'){var base=(ant&&ant!=='dono'&&NIVEIS[ant])||NIVEIS.gerente;rasc.permissoes=base.perms.slice();rasc.sub=subCompleto(base);}}
      else{delete rasc.permissoes;delete rasc.sub;}
      if(n!=='personalizado')rasc.setores=(N2&&N2.setorPrincipal)?[EST_ARM_PRINCIPAL]:[];   // setores recomeçam do padrão do nível
      renderPainel();};
    q('fsimAplicar').onclick=function(){lerChecks();
      if(rasc.nivel==='dono'){if(st)voltarDono();else fechar();return;}
      var m=membroDe(rasc);
      if(!m.permissoes.length){toast('Escolha ao menos uma área');return;}
      if(rasc.nivel!=='admin'&&m.permissoes.includes('estoque')&&estMultiArm()&&(m.sub.req_criar||m.sub.contagem||m.sub.posicao)&&!m.setores.length){toast('Escolha ao menos um setor (como no cadastro de membro)');return;}
      var novo={nivel:rasc.nivel,setores:m.setores.slice()};if(rasc.nivel==='personalizado'){novo.permissoes=m.permissoes.slice();novo.sub=Object.assign({},m.sub);}
      fechar();aplicar(novo);};
    if(q('fsimDono'))q('fsimDono').onclick=voltarDono;
    q('fsimSetoresCen').onclick=cenarioSetores;
    q('fsimPacotes').onclick=cenarioPacotes;
    q('fsimReceita8').onclick=cenarioReceita8;
    q('fsimZerar').onclick=zerarDemo;
    q('fsimArq').onchange=function(){carregarArquivo(this);};
  }
  function lerChecks(){
    var s=document.querySelectorAll('#fsimSetores input[data-setor]');if(s.length)rasc.setores=[].map.call([].filter.call(s,function(c){return c.checked;}),function(c){return c.dataset.setor;});
    var pm=document.querySelectorAll('#fsimPerms input[data-perm]');if(pm.length)rasc.permissoes=[].map.call([].filter.call(pm,function(c){return c.checked;}),function(c){return c.dataset.perm;});
    var sb2=document.querySelectorAll('#fsimSubs input[data-sub]');if(sb2.length)rasc.sub=Object.fromEntries([].map.call(sb2,function(c){return [c.dataset.sub,c.checked];}));
  }

  /* API para o teste automatizado (tools/smoke/simulacao.mjs) e para quem preferir o console */
  window.flowSim={aplicar:function(st){return aplicar(st);},dono:voltarDono,setores:cenarioSetores,pacotes:cenarioPacotes,receita8:cenarioReceita8,estado:lerEstado,abrir:abrir};

  // recarregou com uma simulação ligada: entra de novo como o membro de teste
  var st0=lerEstado();
  // o login de verdade abre a tela do endereço (#/…): o login simulado também, respeitando as permissões do perfil
  if(st0){try{if(typeof rotaLer==='function')ROTA_PEND={alvo:rotaLer(location.hash)};}catch(e){}}
  if(st0){if(entrar(st0))save();else desfazer('A simulação salva não abriu; voltando a dono');}
  selo();
})();
