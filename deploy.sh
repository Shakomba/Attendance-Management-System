#!/usr/bin/env bash
# Usage: ./deploy.sh <droplet-ip>
# Example: ./deploy.sh 164.90.123.45
set -euo pipefail

DROPLET_IP=${1:?Usage: ./deploy.sh <droplet-ip>}
REMOTE_DIR=/opt/ams
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

echo "==> Syncing code to root@$DROPLET_IP:$REMOTE_DIR ..."
rsync -avz --progress \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.venv*' \
  --exclude='backend/.venv*' \
  --exclude='frontend/dist' \
  -e "ssh $SSH_OPTS" \
  . root@$DROPLET_IP:$REMOTE_DIR/

echo "==> Generating JWT secret if not already set ..."
ssh $SSH_OPTS root@$DROPLET_IP bash <<ENVSSH
  set -e
  cd $REMOTE_DIR
  if [ ! -f .env ]; then
    JWT_SECRET=\$(openssl rand -hex 64)
    cat > .env <<EOF
JWT_SECRET_KEY=\$JWT_SECRET
VITE_API_BASE_URL=http://$DROPLET_IP:8000
CORS_ORIGINS=http://$DROPLET_IP
EOF
    echo "Created .env with a fresh JWT secret."
  else
    # Ensure VITE_API_BASE_URL reflects current IP
    grep -q "VITE_API_BASE_URL" .env || echo "VITE_API_BASE_URL=http://$DROPLET_IP:8000" >> .env
    echo ".env already exists — skipping regeneration."
  fi
ENVSSH

echo "==> Pulling images and starting services ..."
ssh $SSH_OPTS root@$DROPLET_IP "
  cd $REMOTE_DIR
  docker compose pull --ignore-buildable 2>/dev/null || true
  docker compose up -d --build --remove-orphans
"

echo ""
echo "✓ Deployed successfully!"
echo "  Frontend : http://$DROPLET_IP"
echo "  Backend  : http://$DROPLET_IP:8000"
echo "  API docs : http://$DROPLET_IP:8000/docs"
