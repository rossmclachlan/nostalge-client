#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/rossmclachlan/nostalge-client.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLONE_DIR="$SCRIPT_DIR/.nostalge-client-src"
DIST_DIR="$SCRIPT_DIR/dist"

# Clone or pull the latest source
if [ -d "$CLONE_DIR/.git" ]; then
    echo "Pulling latest changes..."
    git -C "$CLONE_DIR" pull
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$CLONE_DIR"
fi

cd "$CLONE_DIR"

# Set PocketBase URL to relative /api so nginx proxies it
export VITE_POCKETBASE_URL=/api

# Install dependencies and build
echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

# Copy build output to web/dist
echo "Copying build output to $DIST_DIR..."
rm -rf "$DIST_DIR"
cp -r dist "$DIST_DIR"

echo "Deploy complete. Run 'docker compose up -d' to start the services."
