#!/bin/bash
# Gera o dump do banco "ana" e envia para $BACKUP_DESTINO via rclone.
# Qualquer falha encerra com código != 0 (e o arquivo parcial é descartado).
set -euo pipefail

: "${BACKUP_DESTINO:?defina BACKUP_DESTINO (ex.: gdrive:ana-backups)}"
: "${POSTGRES_USER:?defina POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}"

export PGHOST="${POSTGRES_HOST:-postgres}"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGDATABASE="${POSTGRES_DB:-ana}"

nome="ana-$(date +%Y-%m-%d-%H%M).sql.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[backup] gerando $nome"
pg_dump | gzip > "$tmp/$nome"

# Dump vazio ou truncado não pode virar "backup bom"
gzip -t "$tmp/$nome"
[ -s "$tmp/$nome" ] || { echo "[backup] arquivo vazio" >&2; exit 1; }

echo "[backup] enviando para $BACKUP_DESTINO"
rclone copy "$tmp/$nome" "$BACKUP_DESTINO"

echo "[backup] apagando backups com mais de 30 dias"
rclone delete "$BACKUP_DESTINO" --min-age 30d --include "ana-*.sql.gz" --drive-use-trash=false

echo "[backup] ok: $nome"
