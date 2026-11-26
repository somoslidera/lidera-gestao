// Edge Function: ler-nota (v2.1, 16/10/2026: raciocínio médio na 1ª leitura, alto só se não fechar; registro de uso em ia_uso)
// Recebe a foto/PDF de uma nota de compra, envia ao Gemini e devolve os itens já mapeados nas
// categorias do restaurante, MAIS os totais da nota (ICMS-ST, IPI, frete, seguro, outras despesas,
// desconto e total a pagar) para o Flow colocar no custo dos produtos e fechar com o valor da nota.
// Confere a leitura (qtd x unitário = total do item; soma dos itens = total dos produtos) e, se não
// fechar, lê de novo com um modelo mais forte e fica com a leitura que bate.
// A chave do Gemini fica SÓ aqui (secret do servidor), nunca no front-end.
//
// Deploy:
//   supabase functions deploy ler-nota --project-ref <ref> --use-api
//   supabase secrets set GEMINI_API_KEY=xxxxx
//   (opcional) GEMINI_MODEL (padrão gemini-3-flash-preview) e GEMINI_MODEL_FORTE (padrão gemini-3.1-pro-preview)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
// Testado em 02/10/2026 com DANFE fotografado (Coca-Cola FEMSA): 2.5-flash inventava números; 3-flash leu centavo por centavo.
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3-flash-preview";
const MODEL_FORTE = Deno.env.get("GEMINI_MODEL_FORTE") || "gemini-3.1-pro-preview";
const MODEL_RESERVA = "gemini-2.5-flash";   // se um modelo preview sair do ar (404), cai neste
const LIMITE_MS = 135000;                    // a função tem ~150 s; as duas leituras precisam caber aqui
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// preço estimado (US$ por milhão de tokens: entrada, saída incluindo raciocínio) e câmbio, só para acompanhar o custo no painel
const PRECO_USD: Record<string, [number, number]> = { "gemini-3-flash-preview": [0.5, 3], "gemini-3.1-pro-preview": [2, 12], "gemini-2.5-flash": [0.3, 2.5] };
const FX_BRL = 5.4;
function custoBRL(uso: { modelo: string; entrada: number; saida: number; raciocinio: number }[]) {
  return uso.reduce((s, u) => { const p = PRECO_USD[u.modelo] || [0.5, 3]; return s + (u.entrada * p[0] + (u.saida + u.raciocinio) * p[1]) / 1e6 * FX_BRL; }, 0);
}
async function registrarUso(info: { orgId: string; email: string; modo: string; uso: any[]; revisada: boolean; ms: number; ok: boolean }) {
  if (!SUPABASE_SERVICE || !SUPABASE_URL) return;
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE);
    const uso = info.uso || [];
    await admin.from("ia_uso").insert({
      org_id: info.orgId || null, email: info.email || "", modo: info.modo, modelos: [...new Set(uso.map((u: any) => u.modelo))].join("+"),
      chamadas: uso.length, entrada: uso.reduce((s: number, u: any) => s + (u.entrada || 0), 0), saida: uso.reduce((s: number, u: any) => s + (u.saida || 0), 0),
      raciocinio: uso.reduce((s: number, u: any) => s + (u.raciocinio || 0), 0), custo_est: Math.round(custoBRL(uso) * 10000) / 10000, revisada: info.revisada, ok: info.ok, ms: info.ms,
    });
  } catch (_e) { /* registro é melhor esforço */ }
}
// Token de teste TEMPORÁRIO (só existe enquanto o secret estiver definido). Sem o secret, o caminho não existe.
const TEST_TOKEN = Deno.env.get("LERNOTA_TEST_TOKEN") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lernota-teste",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

function montarPrompt(catList: string, fornList: string): string {
  return `Você lê notas fiscais de compra de um restaurante (DANFE de NF-e, cupom fiscal / NFC-e, nota de mercado, recibo) e extrai os dados para lançamento de custo.

A imagem pode estar girada (de lado ou de cabeça para baixo): leia na orientação correta.

## Itens
Extraia CADA produto como uma linha. Para cada item:
- descricao: nome do produto como está na nota, legível.
- codigo: código do produto na nota, se houver.
- quantidade: a QUANTIDADE COMERCIAL da linha (coluna "QUANT" / "QTDE"). Pode ter até 4 casas decimais: "2,0000" = 2; "0,435" = 0.435.
- unidade_nota: a unidade como está na nota (CX, UN, KG, FD, PCT, L, DZ, SC, BD...).
- unidade: converta para EXATAMENTE uma destas: kg, g, L, ml, un. Caixa, fardo, pacote, dúzia e peça = un.
- itens_por_embalagem: quantas unidades vêm em UMA embalagem, quando a descrição ou a unidade indicar. Ex.: "LT 350ml 6U" = 6; "CX C/06" = 6; "C/12" = 12; "12X1L" = 12; "FD 6UN" = 6; "PCT 10UN" = 10. Use 1 quando não houver. NÃO multiplique a quantidade por isso.
- valor_unitario: preço unitário da linha. Pode ter até 10 casas decimais: "13,800000" = 13.8; "32,175000" = 32.175.
- valor: o VALOR TOTAL DO PRODUTO na linha (coluna "VALOR TOTAL", "V. TOTAL", "VL. TOT", "VALOR"), que é quantidade x valor_unitario. Use ponto como separador decimal. Nunca negativo.
  ATENÇÃO, no DANFE NÃO use como valor as colunas: "BC ICMS" / "B. CÁLC. ICMS", "BC ICMS ST", "VALOR ICMS", "V. ICMS ST", "VALOR IPI", "CUSTO TOTAL", "VALOR LÍQUIDO" nem alíquotas.
- desconto: desconto do item (coluna "DESC" / "DESCONTO"), 0 se não houver.
- outras_despesas: despesas acessórias do item (coluna "DESPESAS ACESSÓRIAS" / "OUTRAS"), 0 se não houver.
- icms_st: valor do ICMS-ST do item (coluna "V. ICMS ST" / "VALOR ICMS ST" / "ICMS-ST"), 0 se não houver ou não legível.
- ipi: valor do IPI do item (coluna "VALOR IPI" / "V. IPI"), 0 se não houver.
- categoria: EXATAMENTE UMA das categorias abaixo (nome idêntico). Compra de insumo/mercado normalmente é a de CMV / custo de mercadoria.
- subcategoria: uma das subcategorias daquela categoria, se alguma combinar; senão vazio.

## Totais da nota
No DANFE ficam no quadro "CÁLCULO DO IMPOSTO"; no cupom, no rodapé. Preencha 0 quando não existir:
- valor_produtos: "VALOR TOTAL DOS PRODUTOS" (soma dos itens).
- frete: "VALOR DO FRETE" (inclui taxa de entrega cobrada na nota).
- seguro: "VALOR DO SEGURO".
- desconto: "DESCONTO" total da nota.
- outras_despesas: "OUTRAS DESPESAS ACESSÓRIAS".
- ipi: "VALOR DO IPI" / "VALOR TOTAL DO IPI".
- icms_st: "VALOR DO ICMS SUBSTITUIÇÃO" / "V. ICMS ST" / "ICMS ST".
- fcp_st: "VALOR DO FCP ST", se houver.
- valor_total_nota: "VALOR TOTAL DA NOTA" (DANFE) ou o TOTAL A PAGAR (cupom). É o valor que o restaurante paga.
O ICMS normal ("VALOR DO ICMS") NÃO é custo extra: ele já está dentro do preço. Não o coloque em nenhum campo acima.

## Cabeçalho
- fornecedor: nome do emitente.${fornList ? " Se for um destes já cadastrados, use o nome idêntico: " + fornList + "." : ""}
- data: data de emissão, formato YYYY-MM-DD.
- nf: número da nota ("NF-e Nº", "NOTA FISCAL Nº", "Nº", "COO", "Extrato nº"). Só dígitos, sem pontos e sem zeros à esquerda: "Nº 003.647.812" = "3647812"; "000.012.345" = "12345". Não confunda com CNPJ, chave de acesso de 44 dígitos, série, protocolo, pedido ou número do caixa.
- chave_acesso: a CHAVE DE ACESSO de 44 dígitos (DANFE e NFC-e), só os dígitos, sem espaços. Vazio se não houver.
- tipo_documento: "danfe", "cupom" ou "outro".

## Conferência obrigatória antes de responder
1. Para cada item, quantidade x valor_unitario deve dar o valor (diferença de centavos é aceitável). Se não der, releia a linha.
2. A soma dos "valor" de todos os itens deve dar valor_produtos. Se não der, procure a linha que ficou de fora ou foi lida errada.
3. valor_total_nota deve ser igual a valor_produtos + frete + seguro + outras_despesas + ipi + icms_st + fcp_st - desconto.
4. Não invente itens. Não coloque como item linhas de total, troco, forma de pagamento, frete ou impostos.
5. Se a imagem estiver ilegível, devolva itens vazio.

Categorias disponíveis:
${catList || "(nenhuma cadastrada; use a que achar mais adequada)"}`;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    tipo_documento: { type: "STRING" },
    fornecedor: { type: "STRING" },
    data: { type: "STRING" },
    nf: { type: "STRING" },
    chave_acesso: { type: "STRING" },
    itens: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          descricao: { type: "STRING" },
          codigo: { type: "STRING" },
          quantidade: { type: "NUMBER" },
          unidade_nota: { type: "STRING" },
          unidade: { type: "STRING" },
          itens_por_embalagem: { type: "NUMBER" },
          valor_unitario: { type: "NUMBER" },
          valor: { type: "NUMBER" },
          desconto: { type: "NUMBER" },
          outras_despesas: { type: "NUMBER" },
          icms_st: { type: "NUMBER" },
          ipi: { type: "NUMBER" },
          categoria: { type: "STRING" },
          subcategoria: { type: "STRING" },
        },
        required: ["descricao", "valor", "categoria"],
      },
    },
    totais: {
      type: "OBJECT",
      properties: {
        valor_produtos: { type: "NUMBER" },
        frete: { type: "NUMBER" },
        seguro: { type: "NUMBER" },
        desconto: { type: "NUMBER" },
        outras_despesas: { type: "NUMBER" },
        ipi: { type: "NUMBER" },
        icms_st: { type: "NUMBER" },
        fcp_st: { type: "NUMBER" },
        valor_total_nota: { type: "NUMBER" },
      },
    },
  },
  required: ["itens"],
};

let THINK_TESTE = "";
// consumo de tokens de cada chamada (vai na resposta, para acompanhar o custo)
const USO: { modelo: string; entrada: number; saida: number; raciocinio: number }[] = [];
async function chamarGemini(modelo: string, prompt: string, mime: string, dataB64: string, prazoMs = 120000, think = "high"): Promise<{ ok: boolean; status: number; detalhe: string; parsed?: any }> {
  const fim = Date.now() + Math.max(5000, prazoMs);
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: dataB64 } }] }],
    // Gemini 3: temperatura padrão (1.0) e raciocínio "high", como o Google recomenda; temperatura 0 fez o modelo travar em repetição nos testes.
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA,
      ...(/^gemini-3/.test(modelo) ? { thinkingConfig: { thinkingLevel: THINK_TESTE || think } } : { temperature: 0 }) },
  };
  let lastStatus = 0, lastDetail = "";
  for (let tent = 0; tent < 4; tent++) {
    const resta = fim - Date.now();
    if (resta < 4000) return { ok: false, status: 504, detalhe: "tempo esgotado" };
    let resp: Response;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), resta);
    try {
      resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (_e) {
      clearTimeout(tm);
      if (ctl.signal.aborted) return { ok: false, status: 504, detalhe: "tempo esgotado" };
      if (tent < 3) { await new Promise((r) => setTimeout(r, 1500 * (tent + 1))); continue; }
      return { ok: false, status: 502, detalhe: "Não foi possível contatar a IA" };
    }
    clearTimeout(tm);
    if (resp.ok) {
      let g: any; try { g = await resp.json(); } catch { return { ok: false, status: 502, detalhe: "Resposta inválida da IA" }; }
      const um = g?.usageMetadata || {};
      USO.push({ modelo, entrada: num(um.promptTokenCount), saida: num(um.candidatesTokenCount), raciocinio: num(um.thoughtsTokenCount) });
      const parts = g?.candidates?.[0]?.content?.parts || [];
      const txt = parts.map((p: any) => p?.text || "").join("");
      try { return { ok: true, status: 200, detalhe: "", parsed: JSON.parse(txt) }; }
      catch { return { ok: false, status: 502, detalhe: "Não consegui interpretar a nota" }; }
    }
    lastStatus = resp.status;
    lastDetail = await resp.text().catch(() => "");
    // 429 = limite de requisições, 503 = Gemini sobrecarregado: espera e tenta de novo
    if ((resp.status === 429 || resp.status === 503) && tent < 3) {
      const ra = Number(resp.headers.get("retry-after")) || 0;
      await new Promise((r) => setTimeout(r, Math.min(ra > 0 ? ra * 1000 : 3000 * Math.pow(2, tent), 20000, Math.max(0, fim - Date.now() - 5000))));
      continue;
    }
    break;
  }
  return { ok: false, status: lastStatus, detalhe: lastDetail.slice(0, 300) };
}

function normalizar(p: any) {
  const itens = (Array.isArray(p?.itens) ? p.itens : []).map((it: any) => {
    const quantidade = Math.abs(num(it.quantidade)) || 1;
    const valor = Math.abs(num(it.valor));
    const unit = Math.abs(num(it.valor_unitario));
    const emb = Math.round(Math.abs(num(it.itens_por_embalagem)));
    return {
      descricao: String(it.descricao || "").slice(0, 120),
      codigo: String(it.codigo || "").slice(0, 40),
      quantidade,
      unidade_nota: String(it.unidade_nota || "").slice(0, 12),
      unidade: ["kg", "g", "L", "ml", "un"].includes(String(it.unidade || "")) ? String(it.unidade) : "un",
      itens_por_embalagem: emb > 1 && emb <= 500 ? emb : 1,
      valor_unitario: unit,
      valor,
      desconto: Math.abs(num(it.desconto)),
      outras_despesas: Math.abs(num(it.outras_despesas)),
      icms_st: Math.abs(num(it.icms_st)),
      ipi: Math.abs(num(it.ipi)),
      categoria: String(it.categoria || ""),
      subcategoria: String(it.subcategoria || ""),
    };
  }).filter((it: any) => it.descricao || it.valor);
  const t = p?.totais || {};
  const totais = {
    valor_produtos: Math.abs(num(t.valor_produtos)), frete: Math.abs(num(t.frete)), seguro: Math.abs(num(t.seguro)),
    desconto: Math.abs(num(t.desconto)), outras_despesas: Math.abs(num(t.outras_despesas)), ipi: Math.abs(num(t.ipi)),
    icms_st: Math.abs(num(t.icms_st)), fcp_st: Math.abs(num(t.fcp_st)), valor_total_nota: Math.abs(num(t.valor_total_nota)),
  };
  // A chave de acesso tem dígito verificador: se for válida, o número da NF sai dela (posições 26 a 34), sem erro de leitura.
  const chave = String(p?.chave_acesso || "").replace(/\D/g, "");
  const chaveOk = chaveValida(chave);
  let nf = String(p?.nf || "").replace(/\D/g, "").replace(/^0+/, "");
  if (chaveOk) nf = chave.slice(25, 34).replace(/^0+/, "") || nf;
  return {
    tipo_documento: String(p?.tipo_documento || ""), fornecedor: String(p?.fornecedor || ""), data: String(p?.data || ""),
    nf, chave_acesso: chaveOk ? chave : "", itens, totais,
  };
}

function chaveValida(c: string): boolean {
  if (!/^\d{44}$/.test(c)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(c[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11; const dv = (r === 0 || r === 1) ? 0 : 11 - r;
  return dv === Number(c[43]);
}

// Confere a leitura: soma dos itens x total dos produtos, total da nota x componentes, linhas qtd x unitário.
function conferir(d: ReturnType<typeof normalizar>) {
  const soma = r2(d.itens.reduce((s: number, i: any) => s + i.valor, 0));
  const t = d.totais;
  const tolProd = 0.06;   // a soma dos itens tem que dar o total dos produtos no centavo (só arredondamento)
  const bateProdutos = t.valor_produtos > 0 ? Math.abs(soma - t.valor_produtos) <= tolProd : null;
  const compNota = r2(t.valor_produtos + t.frete + t.seguro + t.outras_despesas + t.ipi + t.icms_st + t.fcp_st - t.desconto);
  const bateNota = t.valor_total_nota > 0 && t.valor_produtos > 0 ? Math.abs(compNota - t.valor_total_nota) <= 0.06 : null;
  const linhasRuins = d.itens.filter((i: any) => i.valor_unitario > 0 && Math.abs(i.quantidade * i.valor_unitario - i.valor) > Math.max(0.05, i.valor * 0.01)).length;
  // nota = quanto a leitura é confiável (maior é melhor)
  let pontos = 0;
  if (bateProdutos === true) pontos += 4; else if (bateProdutos === false) pontos -= 4;
  if (bateNota === true) pontos += 2; else if (bateNota === false) pontos -= 1;
  pontos -= linhasRuins;
  if (!d.itens.length) pontos -= 10;
  return { soma_itens: soma, valor_produtos: t.valor_produtos, bate_produtos: bateProdutos, bate_nota: bateNota, linhas_divergentes: linhasRuins, pontos };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!GEMINI_KEY) return json({ error: "Servidor sem chave do Gemini configurada" }, 500);

  // Exige um usuário autenticado (evita que a função vire uma API aberta que drena a cota).
  const teste = !!TEST_TOKEN && req.headers.get("x-lernota-teste") === TEST_TOKEN;
  let emailUser = "";
  if (!teste) {
    try {
      const auth = req.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Não autenticado" }, 401);
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await sb.auth.getUser(token);
      if (!user) return json({ error: "Sessão inválida" }, 401);
      emailUser = user.email || "";
    } catch (_e) {
      return json({ error: "Falha na autenticação" }, 401);
    }
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Corpo inválido" }, 400); }
  const { mime, dataB64, categorias, fornecedores, modo, orgId } = body || {};
  if (!dataB64 || !mime) return json({ error: "Envie uma imagem ou PDF" }, 400);

  // Modo rápido: só descobre a rotação da foto (o Flow gira antes de mandar ler; foto de lado derruba a precisão).
  if (modo === "orientacao") {
    const pr = `Esta é a foto de um documento (nota fiscal, DANFE ou cupom). O TOPO do documento é onde fica o cabeçalho: nome do emitente, título "DANFE"/"NOTA FISCAL", canhoto de recebimento. As letras ficam em pé quando o topo está em cima.
Olhando a foto como ela está, em qual borda da IMAGEM está o topo do documento? Responda "cima", "direita", "baixo" ou "esquerda".`;
    const sch = { type: "OBJECT", properties: { topo: { type: "STRING", enum: ["cima", "direita", "baixo", "esquerda"] } }, required: ["topo"] };
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: pr }, { inline_data: { mime_type: mime, data: dataB64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: sch, ...(/^gemini-3/.test(MODEL) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) } }),
      });
      if (!resp.ok) return json({ rotacao: 0, aviso: "orientação indisponível (" + resp.status + ")" });
      const g = await resp.json();
      const txt = (g?.candidates?.[0]?.content?.parts || []).map((x: any) => x?.text || "").join("");
      // graus para girar NO SENTIDO HORÁRIO até o topo ficar em cima
      const topo = String(JSON.parse(txt).topo || "cima");
      const rot = ({ cima: 0, direita: 270, baixo: 180, esquerda: 90 } as Record<string, number>)[topo] ?? 0;
      const um = g?.usageMetadata || {};
      const usoO = { modelo: MODEL, entrada: num(um.promptTokenCount), saida: num(um.candidatesTokenCount), raciocinio: num(um.thoughtsTokenCount) };
      await registrarUso({ orgId: String(orgId || ""), email: emailUser, modo: "orientacao", uso: [usoO], revisada: false, ms: 0, ok: true });
      return json({ rotacao: rot, topo, uso: usoO });
    } catch (_e) { return json({ rotacao: 0, aviso: "orientação indisponível" }); }
  }

  const catList = (categorias || []).map((c: any) =>
    `- ${c.nome} (${c.tipo || "despesa"})${(c.subs && c.subs.length) ? " | subcategorias: " + c.subs.join(", ") : ""}`).join("\n");
  const fornList = (fornecedores || []).filter(Boolean).join(", ");
  const prompt = montarPrompt(catList, fornList);

  // 1ª leitura (rápida). No modo de teste dá para forçar o modelo pelo header x-lernota-modelo.
  const t0 = Date.now();
  USO.length = 0;
  THINK_TESTE = (teste && req.headers.get("x-lernota-thinking")) || "";
  let modelo1 = (teste && req.headers.get("x-lernota-modelo")) || MODEL;
  // raciocínio "medium" custa menos da metade do "high" em tokens de saída; o "high" só entra se a conferência não fechar
  let r1 = await chamarGemini(modelo1, prompt, mime, dataB64, 70000, "medium");
  if (!r1.ok && r1.status === 400 && /thinking/i.test(r1.detalhe)) r1 = await chamarGemini(modelo1, prompt, mime, dataB64, 70000, "high");
  if (!r1.ok && r1.status === 404 && modelo1 !== MODEL_RESERVA) { modelo1 = MODEL_RESERVA; r1 = await chamarGemini(modelo1, prompt, mime, dataB64, 70000); }
  if (!r1.ok) {
    const limite = r1.status === 429 || r1.status === 503;
    await registrarUso({ orgId: String(orgId || ""), email: emailUser, modo: "nota", uso: USO.slice(), revisada: false, ms: Date.now() - t0, ok: false });
    return json({ error: limite ? "A IA esta recebendo muitas notas ao mesmo tempo. Aguarde alguns segundos e tente de novo." : ("A IA retornou erro (" + r1.status + ")"), rate_limit: limite, detalhe: r1.detalhe }, limite ? 429 : 502);
  }
  let d = normalizar(r1.parsed);
  let conf = conferir(d);
  let modelo = modelo1;

  const naoFechou = (c: any, dd: any) => c.bate_produtos === false || c.linhas_divergentes > 0 || !dd.itens.length || (c.bate_produtos === null && c.bate_nota === false);
  let precisaRever = naoFechou(conf, d);
  // Não fechou? mesma leitura com raciocínio alto (ainda no modelo rápido); fica a que bater melhor.
  if (precisaRever && /^gemini-3/.test(modelo1)) {
    const resta = LIMITE_MS - (Date.now() - t0);
    if (resta > 40000) {
      const r1b = await chamarGemini(modelo1, prompt, mime, dataB64, Math.min(resta - 30000, 70000), "high");
      if (r1b.ok) { const d1b = normalizar(r1b.parsed); const c1b = conferir(d1b); if (c1b.pontos > conf.pontos) { d = d1b; conf = c1b; } }
      precisaRever = naoFechou(conf, d);
    }
  }
  // Ainda não fechou? 2ª leitura com o modelo mais forte; fica a que bater melhor.
  if (precisaRever && MODEL_FORTE && MODEL_FORTE !== modelo1) {
    const resta = LIMITE_MS - (Date.now() - t0);
    const r2_ = resta > 25000 ? await chamarGemini(MODEL_FORTE, prompt, mime, dataB64, resta) : { ok: false, status: 504, detalhe: "sem tempo" };
    if (r2_.ok) {
      const d2 = normalizar(r2_.parsed);
      const c2 = conferir(d2);
      if (c2.pontos > conf.pontos) { d = d2; conf = c2; modelo = MODEL_FORTE; }
    }
  }

  // compatibilidade: campos antigos (descricao, valor, quantidade, unidade, categoria, subcategoria) continuam iguais
  await registrarUso({ orgId: String(orgId || ""), email: emailUser, modo: "nota", uso: USO.slice(), revisada: precisaRever, ms: Date.now() - t0, ok: true });
  return json({ ...d, conferencia: { ...conf, modelo, revisada: precisaRever, custo_est: Math.round(custoBRL(USO) * 100) / 100, uso: USO.slice() } });
});
