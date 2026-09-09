#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

docker compose --project-directory "$PROJECT_ROOT" up --build --detach
printf '%s\n' "Project Management MVP is available at http://127.0.0.1:8000"
