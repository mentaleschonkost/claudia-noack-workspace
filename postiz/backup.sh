#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Sicherung: Datenbank + hochgeladene Bilder/Videos + Einstellungen
#
#  ./backup.sh                  → legt backups/postiz-JJJJ-MM-TT_HHMM.tar.gz an
#  ./backup.sh --restore DATEI  → spielt eine Sicherung zurück (überschreibt!)
#
#  Automatisch jede Nacht um 3 Uhr (Server):  crontab -e  und diese Zeile einfügen
#    0 3 * * * cd /pfad/zu/postiz && ./backup.sh >/dev/null 2>&1
#  Es werden die letzten 14 Sicherungen behalten.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
KEEP=14
DB_USER=postiz-user
DB_NAME=postiz-db-local

if [ "${1:-}" = "--restore" ]; then
  FILE="${2:?Welche Datei? ./backup.sh --restore backups/postiz-....tar.gz}"
  [ -f "$FILE" ] || { echo "✗ $FILE nicht gefunden"; exit 1; }
  read -r -p "Aktuelle Daten werden überschrieben. Wirklich? (ja/nein) " a
  [ "$a" = "ja" ] || { echo "Abgebrochen."; exit 0; }
  TMP="$(mktemp -d)"; tar -xzf "$FILE" -C "$TMP"
  docker compose stop postiz
  docker exec -i postiz-postgres psql -q -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  docker exec -i postiz-postgres psql -q -U "$DB_USER" -d "$DB_NAME" < "$TMP/datenbank.sql" >/dev/null
  docker compose start postiz
  docker cp "$TMP/uploads/." postiz:/uploads/
  [ -f "$TMP/env" ] && [ ! -f .env ] && cp "$TMP/env" .env
  rm -rf "$TMP"
  echo "✓ Sicherung zurückgespielt."
  exit 0
fi

STAMP="$(date +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

docker exec postiz-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner > "$TMP/datenbank.sql"
[ -s "$TMP/datenbank.sql" ] || { echo "✗ Datenbank-Sicherung ist leer – läuft Postiz?"; exit 1; }
mkdir -p "$TMP/uploads"
docker cp postiz:/uploads/. "$TMP/uploads/" 2>/dev/null || true
cp .env "$TMP/env"

OUT="backups/postiz-${STAMP}.tar.gz"
tar -czf "$OUT" -C "$TMP" .
chmod 600 "$OUT"
# Alte Sicherungen aufräumen
ls -1t backups/postiz-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
echo "✓ Sicherung: $OUT ($(du -h "$OUT" | cut -f1))"
echo "  Tipp: Kopiere sie ab und zu auf einen anderen Rechner/Cloud-Speicher."
