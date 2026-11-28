#!/usr/bin/env bash
# Backup do banco do Flow: pg_dump -> tar -> criptografado com age -> Cloudflare R2.
#
# Roda no GitHub Action "Backup do banco" (.github/workflows/backup.yml).
# O repositório é PÚBLICO e os logs do Actions também: este script nunca imprime
# dado, URL de conexão nem segredo. Só nome, tamanho e sha256 do arquivo.
#
# Variáveis (secrets do Actions):
#   FLOW_BACKUP_DB_URL     postgresql://backup_ro.<ref>:<senha>@<pooler>:5432/postgres?sslmode=require
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# Opcional: BACKUP_SO_LOCAL=1 gera o arquivo em ./_backup e não envia (teste local).
#
# Restaurar: tools/backup/COMO-RESTAURAR.md
set -euo pipefail
set +x

AQUI="$(cd "$(dirname "$0")" && pwd)"
CHAVE_PUBLICA="$(tr -d '[:space:]' < "$AQUI/chave-publica.age.txt")"
: "${FLOW_BACKUP_DB_URL:?falta o secret FLOW_BACKUP_DB_URL}"

PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
CARIMBO="$(date -u +%Y-%m-%dT%H%MZ)"
NOME="flow-${CARIMBO}.tar.age"
TRAB="$(mktemp -d)"
trap 'rm -rf "$TRAB"' EXIT
mkdir "$TRAB/dump"

echo "== pg_dump ($("$PG_DUMP" --version))"

# 1. public: estrutura + dados de todo o app (Flow, e também Hub e Social, que dividem o projeto).
"$PG_DUMP" "$FLOW_BACKUP_DB_URL" --format=custom --schema=public \
  --file="$TRAB/dump/public.dump"

# 2. auth e storage: só dados (logins dos usuários e índice dos arquivos de anexos).
#    A estrutura desses schemas é do Supabase e já existe em qualquer projeto novo.
"$PG_DUMP" "$FLOW_BACKUP_DB_URL" --format=custom --data-only \
  --schema=auth --schema=storage \
  --file="$TRAB/dump/auth-storage.dump"

# 3. cron.job: as rotinas agendadas (só dados), para recriar à mão se preciso.
"$PG_DUMP" "$FLOW_BACKUP_DB_URL" --format=custom --data-only --table=cron.job \
  --file="$TRAB/dump/cron-job.dump"

# Conferência: cada arquivo tem que abrir no pg_restore e ter conteúdo.
for f in "$TRAB"/dump/*.dump; do
  n=$("$PG_RESTORE" --list "$f" | grep -c 'TABLE DATA' || true)
  t=$(wc -c < "$f" | tr -d ' ')
  echo "   $(basename "$f"): ${t} bytes, ${n} tabelas com dados"
  [ "$t" -gt 1000 ] || { echo "ERRO: $(basename "$f") vazio"; exit 1; }
done
"$PG_RESTORE" --list "$TRAB/dump/public.dump" | grep -q 'TABLE DATA public organizacoes ' \
  || { echo "ERRO: public.dump sem a tabela organizacoes"; exit 1; }

{
  echo "carimbo=$CARIMBO"
  echo "pg_dump=$("$PG_DUMP" --version)"
  (cd "$TRAB/dump" && shasum -a 256 ./*.dump 2>/dev/null || sha256sum ./*.dump)
} > "$TRAB/dump/MANIFESTO.txt"

echo "== criptografando"
tar -C "$TRAB/dump" -cf - . | age -r "$CHAVE_PUBLICA" -o "$TRAB/$NOME"
TAM=$(wc -c < "$TRAB/$NOME" | tr -d ' ')
SHA=$( (shasum -a 256 "$TRAB/$NOME" 2>/dev/null || sha256sum "$TRAB/$NOME") | cut -c1-64)
echo "   $NOME  ${TAM} bytes  sha256 ${SHA}"

if [ "${BACKUP_SO_LOCAL:-0}" = "1" ]; then
  mkdir -p _backup && cp "$TRAB/$NOME" "_backup/$NOME"
  echo "== BACKUP_SO_LOCAL=1: salvo em _backup/$NOME (não enviado)"
  exit 0
fi

: "${R2_ACCOUNT_ID:?falta R2_ACCOUNT_ID}" "${R2_ACCESS_KEY_ID:?falta R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?falta R2_SECRET_ACCESS_KEY}" "${R2_BUCKET:?falta R2_BUCKET}"

echo "== enviando para o R2"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto AWS_EC2_METADATA_DISABLED=true
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
aws s3 cp "$TRAB/$NOME" "s3://${R2_BUCKET}/flow/${NOME}" --endpoint-url "$ENDPOINT" --only-show-errors

# Reler: o arquivo tem que estar lá com o mesmo tamanho.
LA=$(aws s3api head-object --bucket "$R2_BUCKET" --key "flow/${NOME}" --endpoint-url "$ENDPOINT" \
  --query ContentLength --output text)
[ "$LA" = "$TAM" ] || { echo "ERRO: no R2 tem ${LA} bytes, esperado ${TAM}"; exit 1; }
echo "== ok: flow/${NOME} no R2 (${LA} bytes)"
