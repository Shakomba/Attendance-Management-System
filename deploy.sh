#!/usr/bin/env bash
# Deploy to a DigitalOcean GPU droplet.
# Usage: ./deploy.sh <droplet-ip>
# Example: ./deploy.sh 164.90.123.45
#
# Prerequisites on the droplet (run once manually):
#   apt-get install -y docker.io docker-compose-plugin
#   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
#   curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
#     sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
#     tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
#   apt-get update && apt-get install -y nvidia-container-toolkit
#   nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
set -euo pipefail

DROPLET_IP=${1:?Usage: ./deploy.sh <droplet-ip>}
REMOTE_DIR=/opt/attendify
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

echo "==> Syncing code to root@$DROPLET_IP:$REMOTE_DIR ..."
rsync -avz --progress \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.venv*' \
  --exclude='frontend/dist' \
  --exclude='.env' \
  -e "ssh $SSH_OPTS" \
  . root@$DROPLET_IP:$REMOTE_DIR/

echo "==> Ensuring .env exists on server ..."
ssh $SSH_OPTS root@$DROPLET_IP bash <<'ENVSSH'
  set -e
  cd /opt/attendify
  if [ ! -f .env ]; then
    echo "ERROR: .env file missing on server."
    echo "Create /opt/attendify/.env with:"
    echo "  JWT_SECRET_KEY=<openssl rand -hex 64>"
    echo "  MSSQL_SA_PASSWORD=<strong password>"
    echo "  SMTP_USER=..."
    echo "  SMTP_PASSWORD=..."
    exit 1
  fi
  echo ".env found."
ENVSSH

echo "==> Transferring Docker image to server ..."
docker save ams_backend_gpu:latest | ssh $SSH_OPTS root@$DROPLET_IP "docker load"

echo "==> Starting services ..."
ssh $SSH_OPTS root@$DROPLET_IP "
  cd $REMOTE_DIR
  docker compose up -d --build --remove-orphans
"

echo ""
echo "==> First deploy? Run this to get SSL certificates:"
echo "    ssh root@$DROPLET_IP"
echo "    cd $REMOTE_DIR && bash ssl-init.sh"
echo ""
echo "✓ Deployed!"
echo "  App : https://attendify.tech"
echo "  API : https://api.attendify.tech"
echo "  Docs: https://api.attendify.tech/docs"
