#!/usr/bin/env bash
# Wrapper for stress-images.js that reads the repo's .env (DATA_DIR) like the server does.
#   ./server/scripts/stress-test.sh 1000
#   ./server/scripts/stress-test.sh --cleanup
set -e
cd "$(dirname "$0")/../.."
exec node --disable-warning=ExperimentalWarning --env-file-if-exists=.env server/scripts/stress-images.js "$@"
