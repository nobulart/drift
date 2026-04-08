#!/bin/sh
set -eu

python3 scripts/ensure_startup_data.py
exec node server.js
