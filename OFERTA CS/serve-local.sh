#!/usr/bin/env bash
# Servidor local OFERTA CS (API PHP + SPA)
# Uso: ./serve-local.sh [porta]
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8840}"
HOST="127.0.0.1"
echo "OFERTA CS → http://${HOST}:${PORT}/"
echo "Login: http://${HOST}:${PORT}/login"
echo "Pare com Ctrl+C"
exec php -S "${HOST}:${PORT}" dev-router.php