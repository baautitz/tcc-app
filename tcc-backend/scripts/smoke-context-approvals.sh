#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

container_id=""
database_user="tcc_smoke"
database_name="tcc_context_smoke"
database_password="smoke_$$_$(date +%s)"
image="${TCC_SMOKE_POSTGRES_IMAGE:-postgres:18-alpine}"

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm --force "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mapfile -t published_ports < <(python3 - <<'PY'
import socket

sockets = []
ports = []
for _ in range(2):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sockets.append(sock)
    ports.append(sock.getsockname()[1])
for sock in sockets:
    sock.close()
for port in ports:
    print(port)
PY
)
database_port="${published_ports[0]}"
external_database_port="${published_ports[1]}"

container_id="$(docker run --rm --detach \
  --env "POSTGRES_USER=$database_user" \
  --env "POSTGRES_PASSWORD=$database_password" \
  --env "POSTGRES_DB=$database_name" \
  --publish "127.0.0.1:$database_port:5432" \
  --publish "127.0.0.1:$external_database_port:5432" \
  "$image")"

ready=false
for _ in $(seq 1 60); do
  if docker exec "$container_id" pg_isready -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "The disposable PostgreSQL container did not become ready." >&2
  exit 1
fi

database_url="postgres://$database_user:$database_password@127.0.0.1:$database_port/$database_name"
export DATABASE_URL="$database_url"
export CREDENTIAL_ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
export TCC_SMOKE_EXTERNAL_PORT="$external_database_port"

npm run db:migrate
TCC_POSTGRES_INTEGRATION=1 npm test -- tests/http/ai-context-proposals.integration.test.ts
