#!/usr/bin/env bash
# Stress test from the repo root: ./stress-test.sh 1000   |   ./stress-test.sh --cleanup
exec "$(dirname "$0")/server/scripts/stress-test.sh" "$@"
