#!/bin/bash
# One-time server setup for bog-hopper
# Run this on the VPS as root, from /opt/bog-hopper
set -e

echo "==> Setting up bare repo for deploys..."
git clone --bare /opt/bog-hopper /opt/bog-hopper.git
cp deploy/post-receive /opt/bog-hopper.git/hooks/post-receive
chmod +x /opt/bog-hopper.git/hooks/post-receive

echo "==> Installing systemd service..."
cp deploy/bog-hopper.service /etc/systemd/system/bog-hopper.service
systemctl daemon-reload
systemctl enable bog-hopper
systemctl start bog-hopper

echo "==> Adding Caddy config..."
cat deploy/Caddyfile >> /etc/caddy/Caddyfile
systemctl restart caddy

echo ""
echo "==> Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add DNS A record for boghopper.evangriffiths.org -> this server's IP"
echo "  2. Add DEPLOY_SSH_KEY + TS_AUTHKEY secrets to the GitHub repo for auto-deploy"
