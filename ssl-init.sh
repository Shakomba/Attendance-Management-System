#!/usr/bin/env bash
# Run this ONCE on the server after first deploy to get SSL certificates.
# Usage: bash ssl-init.sh your@email.com
set -euo pipefail

EMAIL=${1:?Usage: bash ssl-init.sh your@email.com}
DOMAIN="attendify.tech"

echo "==> Starting nginx in HTTP-only mode for ACME challenge ..."
# Temporarily use a minimal HTTP-only nginx config for the challenge
docker run --rm -d --name tmp_nginx \
  -p 80:80 \
  -v "$(pwd)/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "certbot_www:/var/www/certbot" \
  --network attendify-tech_ams_net \
  nginx:1.27-alpine 2>/dev/null || true

echo "==> Requesting certificates for $DOMAIN and api.$DOMAIN ..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "api.$DOMAIN"

docker stop tmp_nginx 2>/dev/null || true

echo "==> Starting all services with SSL ..."
docker compose up -d

echo ""
echo "✓ SSL certificates installed."
echo "  Renew anytime with: docker compose run --rm certbot renew"
echo "  Add to crontab:     0 3 * * * cd /opt/attendify && docker compose run --rm certbot renew && docker compose restart nginx"
