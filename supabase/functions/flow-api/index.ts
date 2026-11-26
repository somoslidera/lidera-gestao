// ============================================================================
// Flow API · v1  ·  Edge Function (Supabase / Deno)
// ----------------------------------------------------------------------------
// API pública do Flow. Cada restaurante usa um TOKEN próprio (gerado no painel
// admin, tabela public.flow_api_keys). A função valida o token, descobre de qual
// organização é, e só mexe naquele restaurante.
//
// Endpoints (prefixo: /functions/v1/flow-api):
//   POST /v1/lancamentos   -> lança uma venda/compra (entrada de dados)
//   POST /v1/produtos      -> cria/atualiza um produto
//   GET  /v1/lancamentos   -> lista lançamentos (filtro ?de=YYYY-MM-DD&ate=...)
//   GET  /v1/resumo        -> faturamento, CMV e lucro do mês (?mes=YYYY-MM)
//   GET  /v1/produtos      -> lista de produtos/preços
//   POST /v1/vendas        -> vendas por prato vindas do PDV (qualquer sistema): {data, itens:[{codigo|nome, qtd}]}
//                             o Flow casa com a ficha técnica (código no PDV, vínculo salvo ou nome) e dá baixa no estoque
//   GET  /v1/fichas        -> pratos (fichas técnicas) com código no PDV, para o integrador mapear
//
// Autenticação: header  Authorization: Bearer <TOKEN>   (ou ?token=<TOKEN>)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// service_role: ignora o RLS. Fica SÓ no servidor, nunca é exposto ao cliente.
const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const erro = (msg: string, status = 400) => json({ ok: false, erro: msg }, status);

function uid() {
  return "x" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function grupoTipo(dados: any, grupo: string): string {
  const c = dados?.categorias?.[grupo];
  if (c?.tipo) return c.tipo;
  return grupo === "Receita" ? "receita" : "despesa";
}

// Lê o token, retorna { org, dados } ou null.
async function autenticar(req: Request) {
  const url = new URL(req.url);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const token = bearer || url.searchParams.get("token") || "";
  if (!token) return null;
  const { data } = await admin
    .from("flow_api_keys")
    .select("org_id, revogado")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revogado) return null;
  const { data: org } = await admin
    .from("organizacoes")
    .select("id, nome, status, dados, atualizado_em")
    .eq("id", data.org_id)
    .maybeSingle();
  if (!org) return null;
  return org;
}

// Grava as alterações no dados do restaurante com trava de versão (evita
// sobrescrever quem edita no app ao mesmo tempo). Tenta de novo 1x em conflito.
async function salvar(orgId: string, mutar: (d: any) => void, esperado: string | null) {
  for (let i = 0; i < 3; i++) {
    const { data: cur } = await admin
      .from("organizacoes").select("dados, atualizado_em").eq("id", orgId).maybeSingle();
    const dados = cur?.dados || {};
    mutar(dados);
    const agora = new Date().toISOString();
    let q = admin.from("organizacoes").update({ dados, atualizado_em: agora }).eq("id", orgId);
    q = q.eq("atualizado_em", cur?.atualizado_em ?? esperado);
    const { data: ok } = await q.select("id").maybeSingle();
    if (ok) return true;              // gravou
    esperado = null;                  // conflito: relê e tenta de novo
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  // rota = tudo depois de /flow-api
  const rota = url.pathname.replace(/^.*\/flow-api/, "").replace(/\/+$/, "") || "/";

  const org: any = await autenticar(req);
  if (!org) return erro("Token inválido ou ausente.", 401);
  if (org.status === "suspenso") return erro("Acesso suspenso para este restaurante.", 403);
  const dados = org.dados || {};

  try {
    // ---------------- ENTRADA: lançar venda/compra ----------------
    if (req.method === "POST" && rota === "/v1/lancamentos") {
      const b = await req.json().catch(() => ({}));
      const valor = Number(b.valor);
      if (!isFinite(valor)) return erro("Informe 'valor' numérico.");
      // atalho: tipo:'venda' -> Receita ; senão usa grupo/sub informados
      let grupo = b.grupo, sub = b.sub;
      if (b.tipo === "venda") { grupo = "Receita"; sub = sub || b.forma || "Outras Receitas"; }
      if (b.tipo === "compra") { grupo = "CMV"; sub = sub || "Entrada de Produtos"; }
      if (!grupo) return erro("Informe 'grupo' (ex.: Receita, CMV) ou 'tipo' (venda/compra).");
      const lanc = {
        id: uid(),
        data: (b.data || new Date().toISOString().slice(0, 10)),
        grupo, sub: sub || "",
        descricao: b.descricao || (b.tipo === "venda" ? "Venda (API)" : "Lançamento (API)"),
        valor, forma: b.forma || "", fornecedor: b.fornecedor || "",
      };
      const ok = await salvar(org.id, (d: any) => { d.lancamentos = d.lancamentos || []; d.lancamentos.push(lanc); }, org.atualizado_em);
      if (!ok) return erro("Não foi possível gravar (tente de novo).", 409);
      return json({ ok: true, lancamento: lanc });
    }

    // ---------------- ENTRADA: vendas por prato (PDV) ----------------
    // Fica em dados.vendasPendentes; o app processa ao abrir o Estoque: acha a ficha, explode a ficha técnica
    // até os itens com estoque (subprodutos ou brutos) e baixa no armazém de vendas. Item sem ficha fica
    // aguardando vínculo na tela "Baixa por vendas" (vincula uma vez, as próximas entram sozinhas).
    if (req.method === "POST" && rota === "/v1/vendas") {
      const b = await req.json().catch(() => ({}));
      const data = String(b.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return erro("Informe 'data' no formato YYYY-MM-DD.");
      const itensIn = Array.isArray(b.itens) ? b.itens : [];
      const itens = itensIn.map((it: any) => ({
        codigo: String(it.codigo ?? it.sku ?? it.id ?? "").trim().slice(0, 40),
        nome: String(it.nome ?? it.descricao ?? it.produto ?? "").trim().slice(0, 120),
        qtd: Number(it.qtd ?? it.quantidade ?? 0),
        valor: Number(it.valor ?? it.total ?? 0) || 0,
      })).filter((it: any) => (it.codigo || it.nome) && isFinite(it.qtd) && it.qtd > 0);
      if (!itens.length) return erro("Envie 'itens' com {codigo ou nome, qtd}.");
      const lote = { id: uid(), data, pdv: String(b.pdv || "").slice(0, 40), origem: "api", recebidoEm: new Date().toISOString(), itens };
      // receita opcional: total do dia por forma de pagamento (não lança prato a prato).
      // Cada forma casa com um meio de pagamento do Flow pelo nome (cria se não existir), igual às integrações Takeat/Suitable.
      // Reenviar a MESMA chave (ex.: bitbar-2026-11-06) substitui a receita do dia e o lote ainda não baixado; lote já baixado não é refeito.
      const receitas = Array.isArray(b.receitas) ? b.receitas : [];
      const chave = b.chave ? String(b.chave).slice(0, 80) : "";
      let nLanc = 0, loteStatus = "novo";
      const norm = (x: any) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const ok = await salvar(org.id, (d: any) => {
        nLanc = 0; loteStatus = "novo";
        d.vendasPendentes = Array.isArray(d.vendasPendentes) ? d.vendasPendentes : [];
        d.lancamentos = Array.isArray(d.lancamentos) ? d.lancamentos : [];
        d.fin = d.fin || {}; if (!Array.isArray(d.fin.meios)) d.fin.meios = [];
        if (b.pdv && !d.fin.pdvNome) d.fin.pdvNome = String(b.pdv).slice(0, 40);
        d._apiChaves = Array.isArray(d._apiChaves) ? d._apiChaves : [];
        if (chave) {
          (lote as any).chave = chave;
          const idx = d.vendasPendentes.findIndex((x: any) => x.chave === chave);
          if (idx >= 0) { d.vendasPendentes[idx] = lote; loteStatus = "substituido"; }
          else if (d._apiChaves.includes(chave)) { loteStatus = "ja_baixado"; }
          else d.vendasPendentes.push(lote);
          if (!d._apiChaves.includes(chave)) d._apiChaves.push(chave);
          if (d._apiChaves.length > 600) d._apiChaves = d._apiChaves.slice(-600);
          d.lancamentos = d.lancamentos.filter((l: any) => l.apiChave !== chave);
        } else d.vendasPendentes.push(lote);
        for (const r of receitas) {
          const valor = Math.round((Number(r.valor) || 0) * 100) / 100; if (!(valor > 0)) continue;
          const nome = String(r.forma || "Outras Receitas").trim().slice(0, 40) || "Outras Receitas";
          let meio = d.fin.meios.find((m: any) => norm(m.nome) === norm(nome));
          if (!meio) { meio = { id: "mr" + uid(), nome, tipo: "Outros", taxa: 0, prazo: 0, fromApi: true }; d.fin.meios.push(meio); }
          const l: any = { id: uid(), data, grupo: "Receita", sub: meio.nome, descricao: "Vendas " + (b.pdv ? b.pdv + " " : "") + data, valor, forma: meio.nome, meioId: meio.id, fornecedor: "", fromApi: true };
          if (chave) l.apiChave = chave; if (Number(r.pedidos) > 0) l.nPedidos = Number(r.pedidos);
          d.lancamentos.push(l); nLanc++;
        }
      }, org.atualizado_em);
      if (!ok) return erro("Não foi possível gravar (tente de novo).", 409);
      return json({ ok: true, lote: lote.id, loteStatus, itens: itens.length, receitas: nLanc, aviso: "As baixas de estoque acontecem quando o restaurante abre o Flow; itens sem ficha vinculada ficam aguardando na aba Baixa por vendas." });
    }

    // ---------------- SAÍDA: fichas técnicas (pratos) ----------------
    if (req.method === "GET" && rota === "/v1/fichas") {
      const lista = Object.values(dados.fichas || {}).map((f: any) => ({ id: f.id, nome: f.nome, categoria: f.cat || "", codigo_pdv: f.codPdv || "", preco_venda: f.precoVenda || 0 }));
      return json({ ok: true, total: lista.length, fichas: lista });
    }

    // ---------------- ENTRADA: criar/atualizar produto ----------------
    if (req.method === "POST" && rota === "/v1/produtos") {
      const b = await req.json().catch(() => ({}));
      const nome = (b.nome || "").trim();
      if (!nome) return erro("Informe 'nome' do produto.");
      const sub = (b.subcategoria || b.categoria || b.sub || "").trim();
      const item = {
        id: uid(), nome, cat: sub || "Mercearia", grupo: "CMV", sub: sub || "Mercearia",
        tipo: "pronto", uni: (b.unidade || b.uni || "un"),
        preco: Number(b.preco) || 0, qtd: Number(b.quantidade || b.qtd) || 1,
        fornecedor: b.fornecedor || "", noEstoque: true,
      };
      const ok = await salvar(org.id, (d: any) => {
        d.insumos = d.insumos || {};
        // atualiza se já existir produto com o mesmo nome (evita duplicar)
        const existente = Object.values(d.insumos).find((x: any) => x && x.tipo !== "preparado" && (x.nome || "").toLowerCase() === nome.toLowerCase()) as any;
        if (existente) { existente.preco = item.preco; existente.uni = item.uni; if (item.fornecedor) existente.fornecedor = item.fornecedor; if (sub) { existente.sub = sub; existente.cat = sub; existente.grupo = "CMV"; } item.id = existente.id; }
        else d.insumos[item.id] = item;
      }, org.atualizado_em);
      if (!ok) return erro("Não foi possível gravar (tente de novo).", 409);
      return json({ ok: true, produto: item });
    }

    // ---------------- SAÍDA: lançamentos por período ----------------
    if (req.method === "GET" && rota === "/v1/lancamentos") {
      const de = url.searchParams.get("de") || "0000-00-00";
      const ate = url.searchParams.get("ate") || "9999-99-99";
      const lista = (dados.lancamentos || [])
        .filter((l: any) => (l.data || "") >= de && (l.data || "") <= ate)
        .map((l: any) => ({ id: l.id, data: l.data, grupo: l.grupo, sub: l.sub, descricao: l.descricao, valor: l.valor, forma: l.forma, fornecedor: l.fornecedor }));
      return json({ ok: true, total: lista.length, lancamentos: lista });
    }

    // ---------------- SAÍDA: resumo do mês ----------------
    if (req.method === "GET" && rota === "/v1/resumo") {
      const mes = url.searchParams.get("mes") || new Date().toISOString().slice(0, 7);
      const doMes = (dados.lancamentos || []).filter((l: any) => (l.data || "").slice(0, 7) === mes);
      let faturamento = 0, cmv = 0, despesas = 0;
      for (const l of doMes) {
        const v = Number(l.valor) || 0;
        if (grupoTipo(dados, l.grupo) === "receita") faturamento += v;
        else { despesas += v; if (l.grupo === "CMV") cmv += v; }
      }
      const lucro = faturamento - despesas;
      const cmvPct = faturamento > 0 ? +(100 * cmv / faturamento).toFixed(2) : null;
      return json({ ok: true, mes, faturamento: +faturamento.toFixed(2), despesas: +despesas.toFixed(2), cmv_valor: +cmv.toFixed(2), cmv_pct: cmvPct, lucro: +lucro.toFixed(2), lancamentos_no_mes: doMes.length });
    }

    // ---------------- SAÍDA: produtos ----------------
    if (req.method === "GET" && rota === "/v1/produtos") {
      const lista = Object.values(dados.insumos || {})
        .filter((i: any) => i && i.tipo !== "preparado")
        .map((i: any) => ({ id: i.id, nome: i.nome, categoria: i.grupo || "CMV", subcategoria: i.sub || i.cat || "", preco: i.preco || 0, unidade: i.uni || "un", fornecedor: i.fornecedor || "" }));
      return json({ ok: true, total: lista.length, produtos: lista });
    }

    // ---------------- raiz: ping ----------------
    if (req.method === "GET" && (rota === "/" || rota === "/v1")) {
      return json({ ok: true, api: "Flow API v1", restaurante: dados?.conta?.restaurante || org.nome, endpoints: ["POST /v1/lancamentos", "POST /v1/vendas", "POST /v1/produtos", "GET /v1/lancamentos", "GET /v1/resumo", "GET /v1/produtos", "GET /v1/fichas"] });
    }

    return erro("Rota não encontrada: " + req.method + " " + rota, 404);
  } catch (e) {
    return erro("Erro interno: " + ((e as Error)?.message || e), 500);
  }
});
