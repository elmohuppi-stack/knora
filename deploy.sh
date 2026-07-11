#!/bin/bash
set -e

HOST="${1:-$DEPLOY_HOST}"
if [ -z "$HOST" ]; then
  echo "Usage: ./deploy.sh <user@host>"
  echo "Or set DEPLOY_HOST environment variable"
  exit 1
fi

echo "🚀 Deploying Knora to $HOST ..."

rsync -avz --delete \
  --exclude .env \
  --exclude node_modules \
  --exclude .git \
  --exclude drizzle \
  ./ "$HOST:/var/www/knora/"

ssh "$HOST" "cd /var/www/knora && docker compose up -d --build"

echo "✅ Deployed successfully!"
echo "   Frontend: https://knora.elmarhepp.de"
echo "   API:      https://knora-api.elmarhepp.de"
