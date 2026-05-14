#!/bin/sh
set -eu

TLS_DOMAINS="${DRIFT_TLS_DOMAINS:-}"
TLS_EMAIL="${DRIFT_TLS_EMAIL:-}"
TLS_STAGING="${DRIFT_TLS_STAGING:-0}"
ACME_WEBROOT="/var/www/certbot"
NGINX_CONF="/etc/nginx/conf.d/drift.conf"
NODE_PID=""
REFRESH_PID=""
STARTUP_REFRESH_MODE="${DRIFT_STARTUP_REFRESH_MODE:-background}"

log() {
  printf '%s\n' "$*" >&2
}

cleanup() {
  if [ -n "${REFRESH_PID}" ] && kill -0 "${REFRESH_PID}" 2>/dev/null; then
    kill "${REFRESH_PID}" 2>/dev/null || true
    wait "${REFRESH_PID}" 2>/dev/null || true
  fi

  if [ -n "${NODE_PID}" ] && kill -0 "${NODE_PID}" 2>/dev/null; then
    kill "${NODE_PID}" 2>/dev/null || true
    wait "${NODE_PID}" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

normalize_domains() {
  printf '%s' "${TLS_DOMAINS}" | tr ',;' '  ' | tr '\n' ' '
}

primary_domain() {
  for domain in $(normalize_domains); do
    printf '%s\n' "${domain}"
    return 0
  done
  return 1
}

cert_path_for() {
  domain="$1"
  printf '/etc/letsencrypt/live/%s/fullchain.pem' "${domain}"
}

key_path_for() {
  domain="$1"
  printf '/etc/letsencrypt/live/%s/privkey.pem' "${domain}"
}

run_as_nextjs() {
  if [ "$(id -u)" = "0" ] && command -v su >/dev/null 2>&1; then
    su -s /bin/sh nextjs -c "cd /app && $*"
  else
    sh -c "$*"
  fi
}

write_http_nginx_config() {
  domains="$(normalize_domains)"
  [ -n "${domains}" ] || domains="_"

  cat > "${NGINX_CONF}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${domains};

    location /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT:-3000};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300;
    }
}
EOF
}

write_https_nginx_config() {
  primary="$(primary_domain || true)"
  [ -n "${primary}" ] || return 0
  cert_path="$(cert_path_for "${primary}")"
  key_path="$(key_path_for "${primary}")"
  domains="$(normalize_domains)"

  [ -s "${cert_path}" ] && [ -s "${key_path}" ] || return 0

  cat > "${NGINX_CONF}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${domains};

    location /.well-known/acme-challenge/ {
        root ${ACME_WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name ${domains};

    ssl_certificate ${cert_path};
    ssl_certificate_key ${key_path};
    ssl_session_timeout 1d;
    ssl_session_cache shared:DRIFTSSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://127.0.0.1:${PORT:-3000};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300;
    }
}
EOF
}

public_ips() {
  {
    curl -4fsS --max-time 4 https://api.ipify.org 2>/dev/null || true
    curl -6fsS --max-time 4 https://api64.ipify.org 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
}

domain_points_here() {
  domain="$1"
  ips="$2"

  [ -n "${ips}" ] || return 1
  for resolved_ip in $(dig +short A "${domain}" 2>/dev/null; dig +short AAAA "${domain}" 2>/dev/null); do
    for local_ip in ${ips}; do
      if [ "${resolved_ip}" = "${local_ip}" ]; then
        return 0
      fi
    done
  done
  return 1
}

viable_tls_domains() {
  ips="$(public_ips)"
  if [ -z "${ips}" ]; then
    log "TLS: skipped; could not determine this instance's public IP."
    return 0
  fi

  for domain in $(normalize_domains); do
    if domain_points_here "${domain}" "${ips}"; then
      printf '%s\n' "${domain}"
    else
      log "TLS: skipped ${domain}; DNS does not point at this instance."
    fi
  done
}

run_certbot_if_viable() {
  domains="$(viable_tls_domains)"
  [ -n "${domains}" ] || return 0

  certbot_domains=""
  for domain in ${domains}; do
    certbot_domains="${certbot_domains} -d ${domain}"
  done

  email_args="--register-unsafely-without-email"
  if [ -n "${TLS_EMAIL}" ]; then
    email_args="--email ${TLS_EMAIL}"
  fi

  staging_args=""
  if [ "${TLS_STAGING}" = "1" ]; then
    staging_args="--staging"
  fi

  log "TLS: checking Let's Encrypt certificate for: $(printf '%s' "${domains}" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  certbot certonly --webroot -w "${ACME_WEBROOT}" ${certbot_domains} ${email_args} ${staging_args} --agree-tos --non-interactive --keep-until-expiring --expand \
    || log "TLS: certificate request failed; continuing with HTTP only."
}

start_nginx_if_available() {
  command -v nginx >/dev/null 2>&1 || return 0
  mkdir -p "${ACME_WEBROOT}" /run/nginx
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  write_http_nginx_config
  nginx -t
  nginx
}

reload_nginx() {
  command -v nginx >/dev/null 2>&1 || return 0
  nginx -t && nginx -s reload
}

run_startup_refresh() {
  run_as_nextjs "python3 scripts/ensure_startup_data.py" \
    || log "Startup data refresh failed; continuing to serve bundled data."
}

case "${STARTUP_REFRESH_MODE}" in
  strict)
    run_as_nextjs "python3 scripts/ensure_startup_data.py"
    ;;
  skip|disabled|off)
    log "Startup data refresh skipped."
    ;;
  background|*)
    run_startup_refresh &
    REFRESH_PID="$!"
    ;;
esac

run_as_nextjs "node server.js" &
NODE_PID="$!"

if [ "$(id -u)" = "0" ]; then
  start_nginx_if_available || log "TLS: nginx startup failed; direct app port remains available."
  run_certbot_if_viable
  write_https_nginx_config
  reload_nginx || true
fi

wait "${NODE_PID}"
