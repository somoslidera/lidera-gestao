// Edge Function: ler-nota
// Recebe a foto/PDF de uma nota de compra, envia ao Gemini e devolve os itens
// já mapeados nas categorias existentes do restaurante.
// A chave do Gemini fica SÓ aqui (secret do servidor), nunca no front-end.
//
// Deploy:
//   supabase functions deploy ler-nota
//   supabase secrets set GEMINI_API_KEY=xxxxx   (pegue em https://aistudio.google.com/apikey)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!GEMINI_KEY) return json({ error: "Servidor sem chave do Gemini configurada" }, 500);

  // Exige um usuário autenticado (evita que a função vire uma API aberta que drena a cota).
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Não autenticado" }, 401);
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return json({ error: "Sessão inválida" }, 401);
  } catch (_e) {
    return json({ error: "Falha na autenticação" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Corpo inválido" }, 400); }
  const { mime, dataB64, categorias, fornecedores } = body || {};
  if (!dataB64 || !mime) return json({ error: "Envie uma imagem ou PDF" }, 400);

  const catList = (categorias || []).map((c: any) =>
    `- ${c.nome} (${c.tipo || "despesa"})${(c.subs && c.subs.length) ? " | subcategorias: " + c.subs.join(", ") : ""}`
  ).join("\n");
  const fornList = (fornecedores || []).filter(Boolean).join(", ");

  const prompt = `Você é um assistente que lê notas fiscais, cupons e comprovantes de compra de um restaurante e extrai os itens para lançamento financeiro.

Extraia CADA produto/item comprado como uma linha separada. Para cada item retorne:
- descricao: nome do produto como aparece na nota (limpo e legível)
- valor: valor TOTAL do item em reais (quantidade x preço unitário), como número. Use ponto como separador decimal. Nunca negativo.
- categoria: escolha EXATAMENTE UMA das categorias da lista abaixo (copie o nome idêntico). Compra de mercado / insumos normalmente é a categoria de CMV / custo de mercadoria.
- subcategoria: escolha uma das subcategorias daquela categoria, se alguma combinar; senão deixe vazio.

Também extraia:
- fornecedor: nome do estabelecimento/mercado que emitiu a nota.${fornList ? " Se for um destes já cadastrados, use o nome idêntico: " + fornList + "." : ""}
- data: data da compra no formato YYYY-MM-DD. Se não houver, deixe vazio.

Categorias disponíveis:
${catList || "(nenhuma cadastrada — use a que achar mais adequada)"}

Regras:
- Ignore linhas que não são produtos (subtotal, total, troco, desconto geral, formas de pagamento, impostos destacados).
- Não invente itens que não estão na nota.
- Se a imagem estiver ilegível, retorne a lista de itens vazia.`;

  const geminiBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: dataB64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          fornecedor: { type: "STRING" },
          data: { type: "STRING" },
          itens: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                descricao: { type: "STRING" },
                valor: { type: "NUMBER" },
                categoria: { type: "STRING" },
                subcategoria: { type: "STRING" },
              },
              required: ["descricao", "valor", "categoria"],
            },
          },
        },
        required: ["itens"],
      },
    },
  };

  let resp: Response;
  try {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) },
    );
  } catch (_e) {
    return json({ error: "Não foi possível contatar a IA" }, 502);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return json({ error: "A IA retornou erro (" + resp.status + ")", detalhe: t.slice(0, 300) }, 502);
  }

  let g: any;
  try { g = await resp.json(); } catch { return json({ error: "Resposta inválida da IA" }, 502); }
  const txt = g?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let parsed: any;
  try { parsed = JSON.parse(txt); } catch { return json({ error: "Não consegui interpretar a nota" }, 502); }

  const itens = Array.isArray(parsed.itens)
    ? parsed.itens.map((it: any) => ({
        descricao: String(it.descricao || "").slice(0, 120),
        valor: Math.abs(Number(it.valor) || 0),
        categoria: String(it.categoria || ""),
        subcategoria: String(it.subcategoria || ""),
      })).filter((it: any) => it.descricao || it.valor)
    : [];

  return json({ fornecedor: parsed.fornecedor || "", data: parsed.data || "", itens });
});
