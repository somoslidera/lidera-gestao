import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!

    // 1) quem está chamando precisa ser admin
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: ud } = await asUser.auth.getUser()
    const uid = ud?.user?.id
    if (!uid) return json({ error: 'nao autenticado' }, 401)

    const admin = createClient(url, service)
    const { data: perfil } = await admin.from('perfis').select('papel').eq('id', uid).single()
    if (!perfil || perfil.papel !== 'admin') return json({ error: 'somente admin' }, 403)

    // 2) dados de entrada
    const { nome, responsavel, email, senha } = await req.json()
    if (!nome || !email) return json({ error: 'informe nome e email' }, 400)
    const pass = (senha && String(senha).length >= 6)
      ? String(senha)
      : ('Flow' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10))

    // 3) cria o usuario (login) ja confirmado
    const { data: created, error: e1 } = await admin.auth.admin.createUser({
      email, password: pass, email_confirm: true,
    })
    if (e1) return json({ error: 'login: ' + e1.message }, 400)
    const newId = created.user!.id

    // 4) cria o restaurante (organizacao)
    const { data: org, error: e2 } = await admin.from('organizacoes')
      .insert({ nome, responsavel: responsavel || '', email_contato: email, status: 'ativo' })
      .select('id').single()
    if (e2) return json({ error: 'org: ' + e2.message }, 400)

    // 5) vincula o perfil do novo usuario a organizacao
    await admin.from('perfis').update({ org_id: org.id, nome: responsavel || nome, papel: 'cliente' }).eq('id', newId)

    return json({ ok: true, email, senha: pass, org_id: org.id })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
