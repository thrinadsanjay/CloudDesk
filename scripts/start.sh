#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  echo "Docker is not available. Add this user to the docker group or configure passwordless sudo." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if ! grep -qE '^TOKEN_KEY=.+' .env || grep -qE '^TOKEN_KEY=$' .env; then
  KEY="$(openssl rand -hex 16)"
  if grep -qE '^TOKEN_KEY=' .env; then
    sed -i "s/^TOKEN_KEY=.*/TOKEN_KEY=${KEY}/" .env
  else
    printf '\nTOKEN_KEY=%s\n' "$KEY" >> .env
  fi
  echo "Generated TOKEN_KEY"
fi

if ! grep -qE '^DISPLAY_HOSTNAME=.+' .env; then
  printf '\nDISPLAY_HOSTNAME=%s\n' "$(hostname -s 2>/dev/null || hostname || echo desktop)" >> .env
fi

if ! grep -qE '^ADMIN_USER=.+' .env; then
  printf '\nADMIN_USER=admin\n' >> .env
fi
if ! grep -qE '^ADMIN_PASSWORD=.+' .env || grep -qE '^ADMIN_PASSWORD=$' .env; then
  ADMIN_PASS="$(openssl rand -hex 8)"
  if grep -qE '^ADMIN_PASSWORD=' .env; then
    sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASS}/" .env
  else
    printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASS" >> .env
  fi
  echo "Generated ADMIN_PASSWORD (user: admin)"
  echo "  Sign in at the gateway as: admin / ${ADMIN_PASS}"
fi

mkdir -p data certs
HOST_IP="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)"
HOST_NAME="$(hostname -s 2>/dev/null || hostname || echo localhost)"
if [[ ! -s certs/cert.pem || ! -s certs/key.pem ]]; then
  SAN="DNS:localhost,DNS:${HOST_NAME},IP:127.0.0.1"
  if [[ -n "${HOST_IP}" ]]; then
    SAN="${SAN},IP:${HOST_IP}"
  fi
  openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
    -keyout certs/key.pem \
    -out certs/cert.pem \
    -subj "/CN=${HOST_NAME}" \
    -addext "subjectAltName=${SAN}"
  chmod 644 certs/cert.pem
  chmod 640 certs/key.pem
  echo "Generated TLS certificate (${SAN})"
fi

"${DOCKER[@]}" compose up --build -d

PORT="$(grep -E '^WEB_PORT=' .env | cut -d= -f2- | tr -d '"' || true)"
PORT="${PORT:-9080}"

echo
echo "Cloud Desktop is starting."
echo "  HTTP:   http://127.0.0.1:${PORT}"
if [[ -n "${HOST_IP}" ]]; then
  echo "          http://${HOST_IP}:${PORT}"
fi
echo "  HTTPS:  https://127.0.0.1:9443"
if [[ -n "${HOST_IP}" ]]; then
  echo "          https://${HOST_IP}:9443"
fi
echo
echo "Use the HTTP URL if you do not want a certificate warning."
  echo "User login:  http://${HOST_IP:-127.0.0.1}:${PORT}"
  echo "Admin users can switch to the console after signing in."
echo "Logs: ${DOCKER[*]} compose logs -f"
