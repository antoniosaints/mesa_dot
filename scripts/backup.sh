#!/usr/bin/env bash
set -euo pipefail
: "${MYSQL_BACKUP_CONFIG:?Defina um arquivo client MySQL com credenciais protegidas}"
: "${MYSQL_DATABASE:?Defina MYSQL_DATABASE}"
mkdir -p backups
umask 077
output="backups/${MYSQL_DATABASE}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
mysqldump --defaults-extra-file="$MYSQL_BACKUP_CONFIG" --single-transaction --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE" | gzip > "$output"
printf 'Backup concluído: %s\n' "$output"
