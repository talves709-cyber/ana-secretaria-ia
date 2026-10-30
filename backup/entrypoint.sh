#!/bin/bash
# Prepara o ambiente do cron (que não herda variáveis) e fica em primeiro plano.
set -euo pipefail

# Fuso do agendamento: o cron usa /etc/localtime
if [ -n "${TZ:-}" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
fi

# O cron roda os jobs sem as variáveis do contêiner: salvamos para o backup.sh ler
export -p > /etc/backup.env
chmod 600 /etc/backup.env

echo "Backup agendado (cron: 03:00 ${TZ:-UTC}). Destino: ${BACKUP_DESTINO:-<nao definido>}"
exec cron -f
