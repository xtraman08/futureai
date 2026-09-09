#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

docker compose --project-directory "$PROJECT_ROOT" down
printf '%s\n' "Project Management MVP stopped. Local data was preserved."
