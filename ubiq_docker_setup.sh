#!/bin/bash
# ubiq_docker_setup.sh
# Run once on the EC2 server (or add to docker-compose entrypoint).
# Creates the restricted bridge network that all sandbox containers use.
#
# Usage:
#   chmod +x ubiq_docker_setup.sh
#   sudo ./ubiq_docker_setup.sh

set -e

NETWORK_NAME="ubiq_sandbox"

echo "→ Checking for Docker network: $NETWORK_NAME"

if docker network ls --format '{{.Name}}' | grep -q "^${NETWORK_NAME}$"; then
    echo "  ✓ Network '${NETWORK_NAME}' already exists — skipping."
else
    echo "  Creating network '${NETWORK_NAME}'..."
    docker network create \
        --driver bridge \
        --opt com.docker.network.bridge.name=br_ubiq_sandbox \
        --subnet 172.28.0.0/16 \
        --ip-range 172.28.5.0/24 \
        "$NETWORK_NAME"
    echo "  ✓ Network '${NETWORK_NAME}' created."
fi

# Block sandbox containers from reaching the EC2 metadata endpoint (169.254.169.254).
# This prevents a compromised container from reading IAM credentials.
echo ""
echo "→ Blocking EC2 metadata endpoint from sandbox network..."

# Add iptables rule if not already present
if ! iptables -C FORWARD -i br_ubiq_sandbox -d 169.254.169.254 -j DROP 2>/dev/null; then
    iptables -I FORWARD -i br_ubiq_sandbox -d 169.254.169.254 -j DROP
    echo "  ✓ EC2 metadata blocked."
else
    echo "  ✓ EC2 metadata block already in place."
fi

# Make iptables rule persistent across reboots (Ubuntu/Debian)
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save
    echo "  ✓ iptables rules saved."
else
    echo "  ⚠ Install 'iptables-persistent' to persist these rules across reboots:"
    echo "    sudo apt-get install -y iptables-persistent"
fi

echo ""
echo "✓ Docker sandbox setup complete."
echo "  Sandbox containers will use network: $NETWORK_NAME"
echo "  Open ports 8100-8899 in your EC2 Security Group if not already done."