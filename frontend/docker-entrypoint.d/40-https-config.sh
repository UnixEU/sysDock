#!/bin/sh
set -eu

CERT_DIR="/etc/nginx/certs"
NGINX_CONFIG_PATH="/etc/nginx/conf.d/default.conf"
HTTP_LISTEN_PORT="${FRONTEND_HTTP_CONTAINER_PORT:-80}"
HTTPS_EXTERNAL_PORT="${FRONTEND_HOST_PORT:-443}"
LISTEN_PORT="${FRONTEND_CONTAINER_PORT:-443}"
SERVER_NAME="${FRONTEND_SERVER_NAME:-localhost}"
CERT_FILE="${FRONTEND_TLS_CERT_FILENAME:-custom-server.crt}"
KEY_FILE="${FRONTEND_TLS_KEY_FILENAME:-custom-server.key}"

validate_filename() {
  value="$1"
  label="$2"

  if [ -z "$value" ]; then
    return 0
  fi

  case "$value" in
    */*|*..*)
      echo "$label must be a file name inside $CERT_DIR, not a path: $value" >&2
      exit 1
      ;;
  esac
}

validate_filename "$CERT_FILE" "FRONTEND_TLS_CERT_FILENAME"
validate_filename "$KEY_FILE" "FRONTEND_TLS_KEY_FILENAME"

CERT_PATH="$CERT_DIR/$CERT_FILE"
KEY_PATH="$CERT_DIR/$KEY_FILE"
NGINX_MAIN_CONFIG_PATH="/etc/nginx/nginx.conf"

if [ ! -f "$CERT_PATH" ]; then
  echo "TLS certificate file not found: $CERT_PATH" >&2
  exit 1
fi

if [ ! -f "$KEY_PATH" ]; then
  echo "TLS key file not found: $KEY_PATH" >&2
  exit 1
fi

REDIRECT_PORT_SUFFIX=""
if [ "$HTTPS_EXTERNAL_PORT" != "443" ]; then
  REDIRECT_PORT_SUFFIX=":$HTTPS_EXTERNAL_PORT"
fi

cat > "$NGINX_CONFIG_PATH" <<EOF
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    server_tokens off;

    map \$http_upgrade \$connection_upgrade {
        default upgrade;
        '' close;
    }

    server {
        listen ${HTTP_LISTEN_PORT};
        server_name ${SERVER_NAME};
        return 301 https://\$host${REDIRECT_PORT_SUFFIX}\$request_uri;
    }

    server {
        listen ${LISTEN_PORT} ssl;
        http2 on;
        server_name ${SERVER_NAME};
        root /usr/share/nginx/html;
        index index.html;

        ssl_certificate ${CERT_PATH};
        ssl_certificate_key ${KEY_PATH};
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:10m;
        ssl_session_tickets off;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers off;

        gzip on;
        gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

        location / {
            try_files \$uri \$uri/ /index.html;
        }

        location ~ ^/api/docker/containers/.+/logs/stream$ {
            proxy_pass http://backend:8000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            proxy_set_header Host \$host;
            proxy_cache_bypass \$http_upgrade;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_buffering off;
            proxy_read_timeout 3600s;
            add_header X-Accel-Buffering no;
        }

        location ~ ^/api/docker/containers/.+/exec/ws$ {
            proxy_pass http://backend:8000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            proxy_set_header Host \$host;
            proxy_cache_bypass \$http_upgrade;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_buffering off;
            proxy_read_timeout 3600s;
            proxy_send_timeout 3600s;
            add_header X-Accel-Buffering no;
        }

        location /api {
            proxy_pass http://backend:8000;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header X-Frame-Options "DENY" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
EOF

cp "$NGINX_CONFIG_PATH" "$NGINX_MAIN_CONFIG_PATH"
