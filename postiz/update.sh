#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Postiz aktualisieren – sicher: erst Sicherung, dann Update
#
#  ./update.sh            → neueste offizielle Version (wird in .env gemerkt)
#  ./update.sh v2.25.0    → genau diese Version
#
#  Zurück zur alten Version, falls etwas nicht klappt:
#    ./update.sh <alte-version>   und ggf.  ./backup.sh --restore backups/<datei>
#  Versionen & Änderungen: https://github.com/gitroomhq/postiz-app/releases
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

# Neueste Version aus der GitHub-Weiterleitung lesen (…/releases/tag/v2.25.0 → v2.25.0)
tag_from_headers() { tr -d '\r' | awk 'tolower($1)=="location:" {n=split($2,a,"/"); print a[n]}' | tail -1; }

CURRENT="$(grep '^POSTIZ_VERSION=' .env | cut -d= -f2- || true)"
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(curl -fsSI https://github.com/gitroomhq/postiz-app/releases/latest 2>/dev/null | tag_from_headers || true)"
  [ -n "$TARGET" ] || { echo "✗ Neueste Version nicht ermittelbar. Bitte direkt angeben: ./update.sh v2.25.0"; exit 1; }
fi
if [ "$TARGET" = "$CURRENT" ] && [ -z "${1:-}" ]; then
  echo "✓ Du hast schon die neueste Version ($CURRENT)."
  exit 0
fi
echo "▸ Update: ${CURRENT:-?} → $TARGET"
tmp="$(mktemp)"
if grep -q '^POSTIZ_VERSION=' .env; then
  awk -v v="$TARGET" 'BEGIN{FS=OFS="="} $1=="POSTIZ_VERSION" {print "POSTIZ_VERSION=" v; next} {print}' .env > "$tmp"
else
  cat .env > "$tmp"; echo "POSTIZ_VERSION=$TARGET" >> "$tmp"
fi
cat "$tmp" > .env; rm -f "$tmp"

echo "▸ 1/3 Sicherung"
bash ./backup.sh

PROFILE=()
grep -q '^POSTIZ_DOMAIN=.\+' .env && PROFILE=(--profile https)
grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.\+' .env && PROFILE=(--profile tunnel)

echo "▸ 2/3 Neue Version herunterladen"
docker compose ${PROFILE[@]+"${PROFILE[@]}"} pull

echo "▸ 3/3 Neu starten"
docker compose ${PROFILE[@]+"${PROFILE[@]}"} up -d
docker image prune -f >/dev/null
echo "✓ Update gestartet. In 2–3 Minuten ist Postiz wieder da (Status: docker compose ps)."
