#!/usr/bin/env bash
# The full backup (plan.js): due every N days (here a "day" is 8 s), this PC first, then the same
# snapshot on Google Drive (e2e/mock-google.mjs). Throwaway server on :3200.
set -euo pipefail
. ~/.nvm/nvm.sh >/dev/null
cd "$(dirname "$0")/.."
D=$(mktemp -d)
fuser -k 3200/tcp 4556/tcp 2>/dev/null || true
MOCK_PORT=4556 node ../e2e/mock-google.mjs >$D/mock.log 2>&1 &
MOCK=$!
APP_PASSWORD=testpw PORT=3200 DATA_DIR=$D/data BACKUP_DIR=$D/bk CLEANUP_CRON=off ZB_TEST_DAY_MS=8000 ZB_TEST_CHECK_MS=400 \
  GOOGLE_CLIENT_ID=test-id GOOGLE_CLIENT_SECRET=test-secret GOOGLE_BACKUP_PASSPHRASE=test-passphrase \
  GOOGLE_OAUTH_BASE=http://localhost:4556 GOOGLE_API_BASE=http://localhost:4556 \
  node --disable-warning=ExperimentalWarning src/index.js >$D/log 2>&1 &
PID=$!
trap 'chmod -R u+w $D 2>/dev/null; kill $PID $MOCK 2>/dev/null; rm -rf $D' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null localhost:3200/ && break; sleep 0.25; done
T=$(cat $D/data/cli-token)
H="Authorization: Bearer $T"
B=http://localhost:3200
J='content-type: application/json'
ok() { echo "ok - $1"; }
fail() { echo "FAIL - $1"; tail -5 $D/log; exit 1; }
jq_() { node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }
plan() { curl -s -H "$H" $B/api/backup; }
driveSnaps() { curl -s localhost:4556/__state | jq_ 'd.snapshots.map((s) => s.name).join(" ")'; }

node -e 'require("sharp")({create:{width:120,height:90,channels:3,background:"#c33"}}).png().toFile(process.argv[1])' $D/a.png
F=$(curl -s -H "$H" -F "file=@$D/a.png" $B/api/upload | jq_ 'd.file.id')
curl -s -H "$H" -H "$J" -d "{\"type\":\"image\",\"x\":0,\"y\":0,\"data\":{\"fileId\":\"$F\"}}" $B/api/boards/root/cards >/dev/null

# Never backed up: one runs by itself shortly after start-up (Drive isn't connected yet).
for i in $(seq 1 20); do [ "$(plan | jq_ 'd.last ? d.last.reason : ""')" = scheduled ] && break; sleep 0.25; done
P=$(plan)
[ "$(echo "$P" | jq_ 'd.last.reason + "/" + d.last.local.ok + "/" + d.last.drive + "/" + d.every_days')" = "scheduled/true/null/1" ] \
  && ok "a first backup runs by itself after start-up (default: every 1 day)" || fail "first: $P"
[ -f "$D/bk/db/$(echo "$P" | jq_ 'd.last.local.snapshot')" ] && ok "its snapshot is in the local backup folder" || fail "local file"

curl -s -X POST -H "$H" $B/api/drive/connect >/dev/null
for i in $(seq 1 40); do curl -s -H "$H" $B/api/drive | grep -q '"connected":true' && break; sleep 0.5; done
FIRST=$(echo "$P" | jq_ 'd.last.at')

# Not again before it's due.
sleep 2
[ "$(plan | jq_ 'd.last.at')" = "$FIRST" ] && ok "not again before it is due" || fail "ran early"

# Due ("a day" later): this PC first, then the same snapshot on Google Drive.
for i in $(seq 1 60); do [ "$(plan | jq_ 'd.last.at')" != "$FIRST" ] && [ "$(plan | jq_ 'd.running')" = false ] && break; sleep 0.25; done
P=$(plan)
L=$(echo "$P" | jq_ 'd.last.local.snapshot'); R=$(echo "$P" | jq_ 'd.last.drive && d.last.drive.snapshot')
[ "$(echo "$P" | jq_ 'd.last.local.ok + "/" + d.last.drive.ok')" = "true/true" ] && [ "$R" = "$L.enc" ] \
  && ok "once due it runs again: this PC, then the same snapshot on Google Drive ($R)" || fail "due run: $P"
driveSnaps | grep -q "$L.enc" && ok "that snapshot is really in Drive" || fail "not in drive: $(driveSnaps)"
[ "$(echo "$P" | jq_ 'd.next_due === d.last_ok_at + 8000')" = true ] && ok "next one is due an interval later" || fail "next_due: $P"

# The interval is set from the Menu: 1 to 30 days.
code() { curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$H" -H "$J" -d "{\"every_days\":$1}" $B/api/backup; }
[ "$(code 0)/$(code 31)/$(code 1.5)" = "400/400/400" ] && ok "intervals outside 1-30 whole days are refused" || fail "validation"
[ "$(code 7)" = 200 ] && [ "$(plan | jq_ 'd.every_days + "/" + (d.next_due === d.last_ok_at + 7 * 8000)')" = "7/true" ] && ok "every 7 days is saved and moves the next one" || fail "set 7"

# Back up now does both.
sleep 1.1
N=$(curl -s -X POST -H "$H" $B/api/backup)
[ "$(echo "$N" | jq_ 'd.result.reason + "/" + d.result.local.ok + "/" + d.result.drive.ok + "/" + (d.result.drive.snapshot === d.result.local.snapshot + ".enc") + "/" + d.status.ok')" = "manual/true/true/true/true" ] \
  && ok "Back up now: this PC, then the same snapshot on Drive" || fail "back up now: $N"

# A failing local part doesn't stop the Drive part.
sleep 1.1
chmod a-w $D/bk/db
N=$(curl -s -X POST -H "$H" $B/api/backup)
chmod u+w $D/bk/db
[ "$(echo "$N" | jq_ 'd.result.local.ok + "/" + d.result.drive.ok + "/" + !!d.result.local.error')" = "false/true/true" ] \
  && ok "if the local part fails, Google Drive still gets a backup (and the error is shown)" || fail "local fail: $N"
grep -q "Full backup (scheduled)" $D/log && grep -q "Full backup (manual)" $D/log && ok "runs are logged" || fail "log"
