#!/bin/sh
# Start the backend, wait until it answers, then run the web server in the foreground on $PORT (default 7860).
set -e
mkdir -p "$TC_DATA_DIR"
if [ -z "$TC_SECRET_KEY" ]; then
  # No secret configured: generate one per container start (sign-ins reset on restart, but tokens cannot be forged).
  TC_SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
  export TC_SECRET_KEY
fi
cd /home/user/app/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
for i in $(seq 1 120); do
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)" 2>/dev/null && break
  sleep 1
done
cd /home/user/app/frontend
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-7860}"
