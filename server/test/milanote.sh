#!/usr/bin/env bash
# Milanote import: a small account converted into a board tree. Runs against a throwaway server on :3200.
set -euo pipefail
. ~/.nvm/nvm.sh >/dev/null
cd "$(dirname "$0")/.."
D=$(mktemp -d)
fuser -k 3200/tcp 2>/dev/null || true
APP_PASSWORD=testpw PORT=3200 DATA_DIR=$D/data BACKUP_DIR=$D/bk node --disable-warning=ExperimentalWarning src/index.js >$D/log 2>&1 &
PID=$!
trap 'kill $PID; rm -rf $D' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null localhost:3200/ && break; sleep 0.25; done
T=$(cat $D/data/cli-token)
B=http://localhost:3200
fail() { echo "FAIL - $1"; tail -5 $D/log; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' $B/api/import/milanote)
[ "$code" = 401 ] && echo "ok - needs login" || fail "no login: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"rootId":"x","elements":[]}' $B/api/import/milanote)
[ "$code" = 400 ] && echo "ok - unknown root refused" || fail "bad root: $code"

node -e 'require("sharp")({create:{width:40,height:30,channels:3,background:"#c33"}}).png().toFile(process.argv[1])' $D/a.png
FID=$(curl -s -H "Authorization: Bearer $T" -F "file=@$D/a.png;filename=IMG_1.png" $B/api/upload | node -pe 'JSON.parse(require("fs").readFileSync(0)).file.id')
node test/milanote-payload.mjs "$FID" >$D/p.json
curl -s -H "Authorization: Bearer $T" -H 'content-type: application/json' --data-binary @$D/p.json $B/api/import/milanote >$D/out.json
node test/milanote-check.mjs $D/out.json "$T" || fail "converted boards"
