#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Postiz einrichten & starten – ein Befehl für alles
#
#  Auf deinem Rechner:        ./setup.sh
#  Auf einem Server (HTTPS):  ./setup.sh --server social.deine-domain.de
#  Laptop + Cloudflare-Tunnel: ./setup.sh --tunnel social.deine-domain.de
#                              (fragt einmal nach dem Tunnel-Token)
#  Nur .env anlegen:          ./setup.sh --no-start
#
#  Mehrfach ausführen ist ungefährlich: vorhandene Passwörter bleiben erhalten.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN=""
TUNNEL_DOMAIN=""
START=1
while [ $# -gt 0 ]; do
  case "$1" in
    --server) DOMAIN="${2:-}"; shift 2 || { echo "✗ Bitte Domain angeben: ./setup.sh --server social.deine-domain.de"; exit 1; } ;;
    --tunnel) TUNNEL_DOMAIN="${2:-}"; shift 2 || { echo "✗ Bitte Domain angeben: ./setup.sh --tunnel social.deine-domain.de"; exit 1; } ;;
    --no-start) START=0; shift ;;
    -h|--help) sed -n '3,11p' "$0"; exit 0 ;;
    *) echo "✗ Unbekannte Option: $1"; exit 1 ;;
  esac
done
clean_domain() { local d="${1#https://}"; d="${d#http://}"; printf '%s' "${d%%/*}"; }
DOMAIN="$(clean_domain "$DOMAIN")"
TUNNEL_DOMAIN="$(clean_domain "$TUNNEL_DOMAIN")"

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

random_secret() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-40}"; }

# Setzt KEY=VALUE in .env (portabel für macOS und Linux, ohne sed -i)
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" .env; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > "$tmp"
  else
    cat .env > "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > .env; rm -f "$tmp"
}
get_env() { { grep "^$1=" .env || true; } | head -1 | cut -d= -f2-; }

# ── 1. Voraussetzungen ─────────────────────────────────────────────────────
if [ "$START" = 1 ]; then
  say "Prüfe Docker"
  if ! command -v docker >/dev/null 2>&1; then
    echo "  ✗ Docker fehlt. Installieren: https://www.docker.com/products/docker-desktop/"
    echo "    (Server: curl -fsSL https://get.docker.com | sh)"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "  ✗ Docker ist installiert, läuft aber nicht. Docker Desktop öffnen und 1 Minute warten."
    exit 1
  fi
  docker compose version >/dev/null 2>&1 || { echo "  ✗ 'docker compose' fehlt – Docker aktualisieren."; exit 1; }
  ok "Docker läuft"
fi

# ── 2. Einstellungen (.env) ────────────────────────────────────────────────
say "Einstellungen"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  ok ".env neu angelegt"
else
  ok ".env vorhanden – bestehende Passwörter bleiben unverändert"
fi
for key in JWT_SECRET POSTGRES_PASSWORD TEMPORAL_DB_PASSWORD; do
  current="$(get_env "$key")"
  if [ -z "$current" ] || [ "$current" = "CHANGE_ME" ]; then
    set_env "$key" "$(random_secret 48)"
    ok "$key sicher erzeugt"
  fi
done

if [ -n "$DOMAIN" ]; then
  set_env POSTIZ_URL "https://${DOMAIN}"
  set_env POSTIZ_DOMAIN "$DOMAIN"
  set_env NOT_SECURED ""
  ok "Server-Modus: https://${DOMAIN}"
fi
if [ -n "$TUNNEL_DOMAIN" ]; then
  set_env POSTIZ_URL "https://${TUNNEL_DOMAIN}"
  set_env POSTIZ_DOMAIN ""
  set_env NOT_SECURED ""
  if [ -z "$(get_env CLOUDFLARE_TUNNEL_TOKEN)" ]; then
    if [ -t 0 ]; then
      printf '  Tunnel-Token einfügen (wird nicht angezeigt) und Enter drücken: '
      read -rs token; echo
      token="$(printf '%s' "$token" | tr -d '[:space:]')"
      token="${token##*--token}"   # falls der ganze Befehl aus Cloudflare eingefügt wurde
      [ -n "$token" ] || { echo "  ✗ Kein Token eingegeben."; exit 1; }
      set_env CLOUDFLARE_TUNNEL_TOKEN "$token"
    else
      echo "  ✗ CLOUDFLARE_TUNNEL_TOKEN fehlt in .env"; exit 1
    fi
  fi
  ok "Tunnel-Modus: https://${TUNNEL_DOMAIN}"
fi
URL="$(get_env POSTIZ_URL)"
DOMAIN="$(get_env POSTIZ_DOMAIN)"
TUNNEL_TOKEN="$(get_env CLOUDFLARE_TUNNEL_TOKEN)"

if grep -q "=CHANGE_ME" .env; then echo "  ✗ In .env steht noch CHANGE_ME"; exit 1; fi
echo "SETUP_OK"

[ "$START" = 1 ] || exit 0

# ── 3. Starten ─────────────────────────────────────────────────────────────
PROFILE=()
[ -n "$DOMAIN" ] && PROFILE=(--profile https)
[ -n "$TUNNEL_TOKEN" ] && PROFILE=(--profile tunnel)
say "Starte Postiz (beim ersten Mal 5–10 Minuten Download)"
docker compose ${PROFILE[@]+"${PROFILE[@]}"} up -d

say "Warte, bis Postiz bereit ist"
for i in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' postiz 2>/dev/null || echo starting)"
  # Oberfläche gesund UND Backend antwortet (401 = "kein API-Schlüssel" = läuft)
  if command -v curl >/dev/null 2>&1; then
    api="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4007/api/public/v1/is-connected 2>/dev/null || true)"
  else
    api=401
  fi
  if [ "$status" = "healthy" ] && [ "$api" = "401" ]; then
    ok "Postiz ist bereit!"
    echo
    echo "  👉 Öffne im Browser:  ${URL}"
    echo "     Lege dort dein Konto an – es ist das einzige, weitere Registrierungen sind gesperrt."
    echo "     Nächster Schritt: ANLEITUNG.md, Kapitel 3"
    exit 0
  fi
  printf '.'; sleep 10
done
echo
echo "  ⚠ Postiz braucht ungewöhnlich lange. Status ansehen:  docker compose ps"
echo "    Protokoll:  docker compose logs --tail 50 postiz"
exit 1
