#!/usr/bin/env bash
# Google Drive backup progress: while a backup runs, /api/drive reports pictures done of total and
# bytes done, then the snapshot phase; afterwards progress is gone. Uses e2e/mock-google.mjs
# (uploads slowed to 300 ms) and a throwaway server on :3200.
set -euo pipefail
. ~/.nvm/nvm.sh >/dev/null
cd "$(dirname "$0")/.."
D=$(mktemp -d)
fuser -k 3200/tcp 4556/tcp 2>/dev/null || true
MOCK_PORT=4556 MOCK_UPLOAD_MS=300 node ../e2e/mock-google.mjs >$D/mock.log 2>&1 &
MOCK=$!
APP_PASSWORD=testpw PORT=3200 DATA_DIR=$D/data BACKUP_DIR=$D/bk \
  GOOGLE_CLIENT_ID=test-id GOOGLE_CLIENT_SECRET=test-secret GOOGLE_BACKUP_PASSPHRASE=test-passphrase \
  GOOGLE_OAUTH_BASE=http://localhost:4556 GOOGLE_API_BASE=http://localhost:4556 \
  node --disable-warning=ExperimentalWarning src/index.js >$D/log 2>&1 &
PID=$!
trap 'kill $PID $MOCK 2>/dev/null; rm -rf $D' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null localhost:3200/ && break; sleep 0.25; done
T=$(cat $D/data/cli-token)
H="Authorization: Bearer $T"
B=http://localhost:3200
fail() { echo "FAIL - $1"; tail -5 $D/log; exit 1; }

# Six pictures of different sizes.
for i in 1 2 3 4 5 6; do
  node -e 'require("sharp")({create:{width:200*+process.argv[2],height:150,channels:3,background:{r:40*+process.argv[2],g:90,b:160}}}).png().toFile(process.argv[1])' $D/p$i.png $i
  curl -s -H "$H" -F "file=@$D/p$i.png" $B/api/upload >/dev/null
done

# Connect: the mock approves the device sign-in on the second poll.
curl -s -X POST -H "$H" $B/api/drive/connect >/dev/null
for i in $(seq 1 40); do curl -s -H "$H" $B/api/drive | grep -q '"connected":true' && break; sleep 0.5; done
curl -s -H "$H" $B/api/drive | grep -q '"connected":true' && echo "ok - connected" || fail "connect"

# A first full backup (the POST returns when it is done), then two more pictures, then watch a second one.
curl -s -X POST -H "$H" $B/api/drive/sync | grep -q '"last_copied":6' && echo "ok - first backup copies all 6" || fail "first backup"
for i in 7 8; do
  node -e 'require("sharp")({create:{width:640,height:480,channels:3,background:"#36c"}}).png().toFile(process.argv[1])' $D/p$i.png
  curl -s -H "$H" -F "file=@$D/p$i.png" $B/api/upload >/dev/null
done
curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null &
SYNC=$!
: >$D/seen
for i in $(seq 1 60); do curl -s -H "$H" $B/api/drive >>$D/seen; echo >>$D/seen; sleep 0.1; done
wait $SYNC
curl -s -H "$H" $B/api/drive >$D/after

node - $D/seen $D/after <<'JS'
const fs = require('fs');
const seen = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const ok = (c, m, x = '') => { console.log((c ? 'ok - ' : 'FAIL - ') + m + (c ? '' : ' ' + x)); if (!c) process.exitCode = 1; };
const files = seen.filter((s) => s.running && s.progress?.phase === 'files').map((s) => s.progress);
ok(files.length > 0, 'progress is reported while pictures upload', JSON.stringify(seen.slice(0, 3)));
ok(files.every((p) => p.total === 2 && p.total_bytes > 0), 'total counts only the pictures not yet in Drive (2 new)', JSON.stringify(files));
ok(files.some((p) => p.done === 1 && p.bytes > 0 && p.bytes < p.total_bytes), 'a halfway point is seen (1 of 2, bytes part done)', JSON.stringify(files));
const order = seen.filter((s) => s.progress).map((s) => s.progress.done);
ok(order.every((d, i) => i === 0 || d >= order[i - 1]), 'progress only goes forward', JSON.stringify(order));
ok(seen.some((s) => s.progress?.phase === 'snapshot'), 'then the snapshot phase is shown');
ok(!after.running && after.progress === null && after.last_copied === 2 && after.files_copied === 8, 'when done, progress is cleared and 8 pictures are in Drive', JSON.stringify(after));
JS
