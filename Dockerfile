# Imagem de produção: só os arquivos estáticos do site, servidos por um Caddy
# mínimo na porta 80. O HTTPS fica com o Caddy do calico, na frente deste
# contêiner (ver deploy/compose.yml). É a mesma versão de Caddy que já roda na VPS.
FROM caddy:2.8.4-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/
COPY css /srv/css
COPY js /srv/js
COPY lib /srv/lib
EXPOSE 80
