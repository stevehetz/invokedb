#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server, run as root (deploy.sh bootstrap pipes it over
# SSH). Safe to rerun. The provider's cloud firewall does the port filtering: Docker bypasses ufw.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl unattended-upgrades
dpkg-reconfigure -fnoninteractive unattended-upgrades

# Docker Engine + compose plugin, from Docker's apt repo
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# Swap, so the image builds don't run out of memory on a small server
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

# SSH: keys only
cat > /etc/ssh/sshd_config.d/99-invokedb.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl reload ssh

mkdir -p /opt/invokedb
echo "Bootstrap done: $(docker --version), $(docker compose version)"
