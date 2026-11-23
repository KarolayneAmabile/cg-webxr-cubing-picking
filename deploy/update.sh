#!/usr/bin/env bash
# Roda na VPS, chamado pelo deploy do GitHub Actions através do AWS SSM:
# baixa a imagem nova, reinicia o contêiner e confere se o site responde.
# Mesmo esquema do deploy/update.sh do calico.
# Env: CUBING_IMAGE (ghcr.io/<dono>/<repo>), IMAGE_TAG (padrão latest),
#      GHCR_USER + GHCR_TOKEN (token temporário para baixar a imagem privada).
set -euo pipefail
cd "$(dirname "$0")"
IMAGE="${CUBING_IMAGE:?set CUBING_IMAGE}"
TAG="${IMAGE_TAG:-latest}"

# o compose.yml lê o nome da imagem daqui (também serve para rodar à mão depois)
echo "CUBING_IMAGE=$IMAGE" > .env

# o contêiner entra na rede calico_web (criada pela pilha do calico, compartilhada só
# com o Caddy); sem ela, o Caddy não teria como alcançá-lo
if ! docker network inspect calico_web >/dev/null 2>&1; then
	echo "network calico_web not found: deploy the calico stack (with the web network) first" >&2
	exit 1
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
	echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:?}" --password-stdin >/dev/null
	trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi
docker pull --quiet "$IMAGE:$TAG"
docker tag "$IMAGE:$TAG" "$IMAGE:latest"

docker compose up -d --remove-orphans
docker image prune -f >/dev/null

# espera a versão nova responder
for _ in $(seq 1 15); do
	if docker compose exec -T web wget -q -O /dev/null http://localhost/ 2>/dev/null; then
		echo "deployed $IMAGE:$TAG"
		exit 0
	fi
	sleep 2
done
echo "the site did not answer after the restart" >&2
docker compose logs --tail 40 web >&2
exit 1
