#!/usr/bin/env bash
# Unused-file cleanup against e2e/mock-google.mjs, with CLEANUP_AFTER_DAYS=0 so only the
# "older than every kept backup" rule decides. Throwaway server on :3200.
set -euo pipefail
. ~/.nvm/nvm.sh >/dev/null
cd "$(dirname "$0")/.."
D=$(mktemp -d)
fuser -k 3200/tcp 4556/tcp 2>/dev/null || true
MOCK_PORT=4556 node ../e2e/mock-google.mjs >$D/mock.log 2>&1 &
MOCK=$!
APP_PASSWORD=testpw PORT=3200 DATA_DIR=$D/data BACKUP_DIR=$D/bk BACKUP_KEEP=2 BACKUP_CRON=off \
  CLEANUP_CRON=off CLEANUP_AFTER_DAYS=0 \
  GOOGLE_CLIENT_ID=test-id GOOGLE_CLIENT_SECRET=test-secret GOOGLE_BACKUP_PASSPHRASE=test-passphrase \
  GOOGLE_OAUTH_BASE=http://localhost:4556 GOOGLE_API_BASE=http://localhost:4556 \
  node --disable-warning=ExperimentalWarning src/index.js >$D/log 2>&1 &
PID=$!
trap 'kill $PID $MOCK 2>/dev/null; rm -rf $D' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null localhost:3200/ && break; sleep 0.25; done
T=$(cat $D/data/cli-token)
H="Authorization: Bearer $T"
B=http://localhost:3200
J='content-type: application/json'
ok() { echo "ok - $1"; }
fail() { echo "FAIL - $1"; tail -5 $D/log; exit 1; }
jq_() { node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }

pic() { # upload a picture, return its file id
  node -e 'require("sharp")({create:{width:120,height:90,channels:3,background:process.argv[2]}}).png().toFile(process.argv[1])' $D/$1.png "$2"
  curl -s -H "$H" -F "file=@$D/$1.png" $B/api/upload | jq_ 'd.file.id'
}
card() { curl -s -H "$H" -H "$J" -d "{\"type\":\"image\",\"x\":0,\"y\":0,\"data\":{\"fileId\":\"$1\"}}" $B/api/boards/root/cards | jq_ 'd.card.id'; }
gone() { curl -s -o /dev/null -w '%{http_code}' -H "$H" $B/files/$1; }
onDrive() { curl -s localhost:4556/__state | jq_ "d.files.some((f) => f.name.startsWith('$1')) ? 'yes' : 'no'"; }
clean() { curl -s -X POST -H "$H" $B/api/cleanup; }
localBackup() { sleep 1.1; curl -s -X POST -H "$H" $B/api/backup | jq_ 'd.status.snapshot'; } # snapshot names are per second

A=$(pic a '#c33'); Bf=$(pic b '#3c3')
CA=$(card $A); CB=$(card $Bf)
curl -s -X POST -H "$H" $B/api/drive/connect >/dev/null
for i in $(seq 1 40); do curl -s -H "$H" $B/api/drive | grep -q '"connected":true' && break; sleep 0.5; done
curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null
localBackup >/dev/null
[ "$(onDrive $Bf)" = yes ] && ok "both pictures backed up to Drive" || fail "drive upload"
# Local backups with nothing new to copy still make a new snapshot each time (they used to repeat the first).
S1=$(localBackup); S2=$(localBackup)
[ -n "$S1" ] && [ "$S1" != "$S2" ] && ok "back-to-back local backups with no new pictures make two snapshots" || fail "local backup repeated $S1"

# B's card goes: B waits, because the kept backups still have that card.
curl -s -H "$H" -H "$J" -d "{\"ids\":[\"$CB\"]}" $B/api/cards/delete >/dev/null
R=$(clean)
[ "$(echo "$R" | jq_ 'd.unused.count + "/" + d.last_removed')" = "1/0" ] && ok "a deleted card's picture waits while older backups exist" || fail "wait: $R"
[ "$(gone $Bf)" = 200 ] && [ "$(onDrive $Bf)" = yes ] && ok "it is still here and on Drive" || fail "kept"

# Used again (undo): its clock stops.
CB2=$(card $Bf)
[ "$(clean | jq_ 'd.unused.count')" = 0 ] && ok "used again, it is no longer waiting" || fail "clock reset"
curl -s -H "$H" -H "$J" -d "{\"ids\":[\"$CB2\"]}" $B/api/cards/delete >/dev/null
clean >/dev/null

# Newer backups everywhere: two local (keeps 2) and 31 on Drive (keeps 30), so none predates B going unused.
localBackup >/dev/null; localBackup >/dev/null
for i in $(seq 1 31); do curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null; done
R=$(clean)
[ "$(echo "$R" | jq_ 'd.last_removed + "/" + d.unused.count + "/" + d.running')" = "1/0/false" ] && ok "once every kept backup is newer, it is removed" || fail "remove: $R"
[ "$(gone $Bf)" = 404 ] && ok "gone from the server" || fail "server copy"
[ "$(onDrive $Bf)" = no ] && ok "gone from Google Drive" || fail "drive copy"
ls $D/data/files $D/data/thumbs $D/data/minis $D/bk/files | grep -q "$Bf" && fail "local copies remain" || ok "original, previews and local backup copy are gone"
[ "$(gone $A)" = 200 ] && [ "$(onDrive $A)" = yes ] && ok "the picture still in use is untouched" || fail "A"

# "Clean up now": decided by what the kept backups contain, Drive ones included.
Df=$(pic d '#c3c'); CD=$(card $Df)
curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null      # a Drive snapshot with D's card
localBackup >/dev/null
curl -s -H "$H" -H "$J" -d "{\"ids\":[\"$CD\"]}" $B/api/cards/delete >/dev/null
localBackup >/dev/null; localBackup >/dev/null             # local backups no longer have it (keeps 2)
curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null
C=$(curl -s -X POST -H "$H" $B/api/cleanup/check)
[ "$(echo "$C" | jq_ "d.files.some((f) => f.id === '$Df') + '/' + d.kept_by_backup + '/' + d.checked.drive")" = "false/1/30" ] \
  && ok "check: a picture an older Drive backup still contains is held back (30 Drive backups read)" || fail "check held: $C"
for i in $(seq 1 30); do curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null; done
C=$(curl -s -X POST -H "$H" $B/api/cleanup/check)
[ "$(echo "$C" | jq_ "d.files.some((f) => f.id === '$Df') + '/' + d.count + '/' + (d.bytes > 0)")" = "true/1/true" ] && ok "check: once that backup is replaced, it is offered for removal" || fail "check offer: $C"
[ "$(gone $Df)" = 200 ] && ok "checking alone removes nothing" || fail "check removed"
R=$(curl -s -H "$H" -H "$J" -d "{\"ids\":[\"$Df\",\"$A\"]}" $B/api/cleanup/remove)
[ "$(echo "$R" | jq_ 'd.removed + "/" + (d.freed > 0)')" = "1/true" ] && ok "remove: the confirmed picture is removed (an in-use one in the list is ignored)" || fail "remove now: $R"
[ "$(gone $Df)/$(onDrive $Df)/$(gone $A)/$(onDrive $A)" = "404/no/200/yes" ] && ok "remove: gone here and from Drive; the in-use picture untouched" || fail "remove effects"

# A picture on Drive is kept while Drive is disconnected (its copy there couldn't be removed).
Cf=$(pic c '#33c'); CC=$(card $Cf)
curl -s -X POST -H "$H" $B/api/drive/sync >/dev/null
curl -s -H "$H" -H "$J" -d "{\"ids\":[\"$CC\"]}" $B/api/cards/delete >/dev/null
clean >/dev/null
curl -s -X POST -H "$H" $B/api/drive/disconnect >/dev/null
localBackup >/dev/null; localBackup >/dev/null
R=$(clean)
[ "$(echo "$R" | jq_ 'd.last_removed + "/" + d.unused.count')" = "0/1" ] && [ "$(gone $Cf)" = 200 ] && ok "with Drive disconnected, a picture backed up there is kept" || fail "disconnected: $R"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$H" $B/api/cleanup/check)
[ "$code" = 409 ] && [ "$(gone $Cf)" = 200 ] && ok "clean up now refuses while Drive is disconnected" || fail "check while disconnected: $code"
grep -q "Cleanup (manual)" $D/log && grep -q "Cleanup (clean up now)" $D/log && ok "runs are logged" || fail "log"
