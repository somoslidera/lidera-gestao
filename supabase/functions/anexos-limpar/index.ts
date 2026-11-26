// @ts-nocheck
// ============================================================================
// anexos-limpar · Edge Function (Supabase / Deno) · 12/11/2026
// ----------------------------------------------------------------------------
// Limpeza automática dos anexos do Flow (boletos e comprovantes no bucket privado "anexos").
// Regra pedida pelo dono: apagar 2 anos depois do pagamento. A função é conservadora de propósito:
// um arquivo só sai se tiver MAIS de GUARDA_DIAS (730) de idade E uma destas for verdade:
//   (a) ele está ligado a uma parcela ou conta paga há mais de GUARDA_DIAS;
//   (b) nada no Flow aponta mais para ele (anexo removido, nota ou conta apagada).
// Arquivo ligado a parcela EM ABERTO nunca é apagado, por mais velho que seja.
// Depois de apagar, tira a citação do anexo de dados.boletos (função SQL anexos_tirar).
// Ações (POST JSON): {acao:'simular', hoje?:'AAAA-MM-DD'}  só conta e mostra o que sairia
//                    {acao:'cron'}                          apaga de verdade
// Auth: header x-cron = ANEXOS_CRON_SECRET. Não tem acesso por usuário.
// Deploy: supabase functions deploy anexos-limpar --project-ref fvcbxorfstqqeewocxkf --use-api --no-verify-jwt
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("ANEXOS_CRON_SECRET") || "";
const admin = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
const BUCKET = "anexos";
const GUARDA_DIAS = 730;
const MAX_APAGAR = 2000; // por rodada

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

/* ---- decisão pura (testada fora do Deno): devolve os caminhos que podem sair ----
   arquivos: [{path, criado:'AAAA-MM-DD'}]   dados: {boletos, lancamentos, contasPagar, contasReceber}   hoje:'AAAA-MM-DD' */
// deno-lint-ignore no-explicit-any
function decidir(arquivos: any, dados: any, hoje: any, guarda: any) {
  const dia = (s) => Math.floor(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / 86400000);
  const H = dia(hoje), sair = [], motivos = {};
  const lancs = {}; (Array.isArray(dados.lancamentos) ? dados.lancamentos : []).forEach((l) => { if (l && l.id) lancs[l.id] = l; });
  const contas = {}; [].concat(Array.isArray(dados.contasPagar) ? dados.contasPagar : [], Array.isArray(dados.contasReceber) ? dados.contasReceber : []).forEach((c) => { if (c && c.id) contas[c.id] = c; });
  // para cada caminho citado: 'aberto' (não mexe), data do pagamento, ou 'sumiu' (nota/conta não existe mais)
  const cit = {};
  const bol = dados.boletos && typeof dados.boletos === "object" && !Array.isArray(dados.boletos) ? dados.boletos : {};
  Object.values(bol).forEach((r) => {
    if (!r || !Array.isArray(r.anexos) || !r.anexos.length) return;
    let estado = "sumiu";
    if (r.conta) { const c = contas[r.conta]; if (c) estado = (c.pago || c.recebido) ? String(c.pagoEm || c.recebidoEm || c.vencimento || "") : "aberto"; }
    else {
      const ls = (Array.isArray(r.ids) ? r.ids : []).map((id) => lancs[id]).filter(Boolean);
      if (ls.length) {
        const qs = ls.map((l) => (Array.isArray(l.liquidacoes) ? l.liquidacoes : [])[+r.idx || 0]).filter(Boolean);
        if (!qs.length) estado = "sumiu"; // a parcela não existe mais nessa posição
        else if (qs.some((q) => !q.pago)) estado = "aberto";
        else estado = qs.map((q) => String(q.pagoEm || q.data || "")).sort().slice(-1)[0];
      }
    }
    if (estado !== "aberto" && estado !== "sumiu" && !/^\d{4}-\d{2}-\d{2}/.test(estado)) estado = "aberto"; // paga sem data conhecida: não arrisca
    r.anexos.forEach((a) => { if (a && a.path) { const ant = cit[a.path]; cit[a.path] = (ant === "aberto" || estado === "aberto") ? "aberto" : (ant && ant !== "sumiu" && estado !== "sumiu" ? (ant > estado ? ant : estado) : (ant && ant !== "sumiu" ? ant : estado)); } });
  });
  arquivos.forEach((f) => {
    if (!f || !f.path || !f.criado) return;
    if (H - dia(f.criado) <= guarda) return; // arquivo novo: nunca sai
    const e = cit[f.path];
    if (e === undefined) { sair.push(f.path); motivos[f.path] = "sem vínculo"; return; }
    if (e === "aberto") return;
    if (e === "sumiu") { sair.push(f.path); motivos[f.path] = "nota ou conta apagada"; return; }
    if (H - dia(e) > guarda) { sair.push(f.path); motivos[f.path] = "paga em " + e.slice(0, 10); }
  });
  return { sair, motivos };
}
/* ---- fim da decisão pura ---- */

async function listarPasta(prefixo: string) {
  const out: { name: string; id: string | null; created_at?: string; metadata?: { size?: number } }[] = [];
  for (let off = 0; off < 100000; off += 1000) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefixo, { limit: 1000, offset: off, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error("listar " + prefixo + ": " + error.message);
    out.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  if (!CRON_SECRET || req.headers.get("x-cron") !== CRON_SECRET) return json({ erro: "não autorizado" }, 401);
  let body: { acao?: string; hoje?: string } = {}; try { body = await req.json(); } catch (_) { /* vazio */ }
  const real = body.acao === "cron";
  const hoje = (!real && body.hoje && /^\d{4}-\d{2}-\d{2}$/.test(body.hoje)) ? body.hoje : new Date().toISOString().slice(0, 10);
  const resumo = { ok: true, real, hoje, guarda_dias: GUARDA_DIAS, orgs: 0, arquivos: 0, bytes: 0, a_apagar: 0, apagados: 0, citacoes_tiradas: 0, por_org: [] as unknown[], erros: [] as string[] };
  try {
    const raiz = await listarPasta("");
    for (const pasta of raiz) {
      if (pasta.id !== null) continue; // arquivo solto na raiz: as regras de envio não deixam existir; não mexe
      const org = pasta.name; if (!/^[0-9a-f-]{36}$/i.test(org)) continue;
      const arquivos: { path: string; criado: string }[] = []; let bytes = 0;
      for (const ano of await listarPasta(org)) {
        if (ano.id !== null) continue;
        for (const f of await listarPasta(org + "/" + ano.name)) { if (f.id === null) continue; arquivos.push({ path: org + "/" + ano.name + "/" + f.name, criado: String(f.created_at || "").slice(0, 10) }); bytes += +(f.metadata?.size || 0); }
      }
      if (!arquivos.length) continue;
      resumo.orgs++; resumo.arquivos += arquivos.length; resumo.bytes += bytes;
      const { data: o, error } = await admin.from("organizacoes").select("id, boletos:dados->boletos, lancamentos:dados->lancamentos, contasPagar:dados->fin->contasPagar, contasReceber:dados->fin->contasReceber").eq("id", org).maybeSingle();
      if (error) { resumo.erros.push(org + ": " + error.message); continue; }
      // org apagada: tudo vira "sem vínculo" e segue a mesma regra de idade
      const d = decidir(arquivos, o || {}, hoje, GUARDA_DIAS);
      resumo.a_apagar += d.sair.length;
      resumo.por_org.push({ org, arquivos: arquivos.length, mb: +(bytes / 1048576).toFixed(2), a_apagar: d.sair.length, exemplo: d.sair.slice(0, 3).map((p) => p.slice(37) + " (" + d.motivos[p] + ")") });
      if (real && d.sair.length && resumo.apagados < MAX_APAGAR) {
        const lote = d.sair.slice(0, MAX_APAGAR - resumo.apagados);
        for (let i = 0; i < lote.length; i += 100) {
          const parte = lote.slice(i, i + 100);
          const rm = await admin.storage.from(BUCKET).remove(parte);
          if (rm.error) { resumo.erros.push(org + ": apagar: " + rm.error.message); break; }
          resumo.apagados += parte.length;
          if (o) { const t = await admin.rpc("anexos_tirar", { p_org: org, p_paths: parte }); if (t.error) resumo.erros.push(org + ": tirar citação: " + t.error.message); else resumo.citacoes_tiradas += +(t.data || 0); }
        }
      }
    }
  } catch (e) { resumo.ok = false; resumo.erros.push(String((e as Error)?.message || e)); }
  return json(resumo, resumo.ok ? 200 : 500);
});
