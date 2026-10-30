#!/usr/bin/env bash
# Step 1 checks against a throwaway data dir on port 3999.
set -u
. ~/.nvm/nvm.sh >/dev/null
cd ~/zboard/server
export APP_PASSWORD=testpw PORT=3999 DATA_DIR=/tmp/zb-test
rm -rf /tmp/zb-test /tmp/zb-img; mkdir -p /tmp/zb-img
B=http://localhost:3999
NODE="node --disable-warning=ExperimentalWarning"
FAILS=0
check() { if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3 (got '$1', want '$2')"; FAILS=$((FAILS+1)); fi; }
j() { node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=eval(process.argv[1]);console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
start() { $NODE src/index.js >>/tmp/zb.log 2>&1 & SP=$!; for i in $(seq 1 50); do curl -s -o /dev/null $B/api/me && return; sleep 0.1; done; }
: >/tmp/zb.log
start

check "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/login -H 'content-type: application/json' -d '{"password":"nope"}')" 401 "wrong password -> 401"
curl -s -c /tmp/zbc -X POST $B/api/login -H 'content-type: application/json' -d '{"password":"testpw"}' >/dev/null
check "$(curl -s -b /tmp/zbc -o /dev/null -w '%{http_code}' $B/api/me)" 200 "right password -> cookie works"
check "$(curl -s -o /dev/null -w '%{http_code}' $B/api/boards)" 401 "no auth -> 401"
check "$(curl -s -o /dev/null -w '%{http_code}' $B/files/whatever1)" 401 "/files guarded"
TOKEN=$(tr -d '\n' </tmp/zb-test/cli-token)
check "$(stat -c %a /tmp/zb-test/cli-token)" 600 "cli-token mode 600"
A=(-H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'X-Client-Id: tester')
check "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" $B/api/me)" 200 "bearer works without cookie"
check "$(curl -s "${A[@]}" $B/api/boards/root | j o.board.title)" Home "root board is Home"

# live sync listener
curl -s -N -H "Authorization: Bearer $TOKEN" "$B/api/events?board=root" >/tmp/zb-sse.txt & SSE=$!
sleep 0.5

post() { curl -s "${A[@]}" -X POST "$B$1" -d "$2"; }
N1=$(post /api/boards/root/cards '{"type":"note","x":10,"y":20,"data":{"html":"<p>hello</p>"}}' | j o.card.id)
N2=$(post /api/boards/root/cards '{"type":"note","x":300,"y":20,"data":{"html":"<p>two</p>"}}' | j o.card.id)
R=$(post /api/boards/root/cards '{"type":"board","title":"Minis","x":600,"y":20}')
BC=$(echo "$R" | j o.card.id); CB=$(echo "$R" | j o.card.data.boardId)
check "$(echo "$R" | j o.card.child.title)" Minis "board card creates child board"
check "$(curl -s "${A[@]}" $B/api/boards | j 'o.boards.find(b=>b.id==="'$CB'").parent_id')" root "child board listed with parent_id"
AR=$(post /api/boards/root/arrows "{\"from_card\":\"$N1\",\"to_card\":\"$N2\",\"label\":\"next\"}" | j o.arrow.id)
check "$(curl -s "${A[@]}" $B/api/boards/root | j o.arrows.length)" 1 "arrow created"

# many cards with client ids
check "$(post /api/boards/root/cards '{"cards":[{"id":"client-a1","type":"todo","data":{"items":[]}},{"id":"client-a2","type":"link","data":{"url":"https://example.com"}}]}' | j 'o.cards.map(c=>c.id).join()')" "client-a1,client-a2" "batch create with client ids"

# columns
COL=$(post /api/boards/root/cards '{"type":"column","x":900,"y":0,"data":{"title":"Todo"}}' | j o.card.id)
S1=$(post /api/boards/root/cards "{\"type\":\"note\",\"column_id\":\"$COL\"}" | j o.card.sort)
S2=$(post /api/boards/root/cards "{\"type\":\"note\",\"column_id\":\"$COL\"}" | j o.card.sort)
check "$S1 $S2" "1 2" "column cards get increasing sort"

# move note into child board: arrow goes, card leaves root
curl -s "${A[@]}" -X PATCH $B/api/cards -d "{\"cards\":[{\"id\":\"$N1\",\"board_id\":\"$CB\",\"x\":5,\"y\":5}]}" >/dev/null
check "$(curl -s "${A[@]}" $B/api/boards/$CB | j 'o.cards.map(c=>c.id).join()')" "$N1" "note moved into child board"
check "$(curl -s "${A[@]}" $B/api/boards/root | j 'o.cards.some(c=>c.id==="'$N1'")')" false "note gone from root"
check "$(curl -s "${A[@]}" $B/api/boards/root | j o.arrows.length)" 0 "arrow across boards removed"
check "$(curl -s "${A[@]}" $B/api/boards/$CB | j 'o.breadcrumbs.map(b=>b.title).join("/")')" "Home/Minis" "breadcrumbs"
check "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -X PATCH $B/api/cards -d "{\"cards\":[{\"id\":\"$BC\",\"board_id\":\"$CB\"}]}")" 400 "board can't move inside itself"

# copyFrom deep-copies
CP=$(post /api/boards/root/cards "{\"type\":\"board\",\"copyFrom\":\"$CB\"}" | j o.card.data.boardId)
check "$(curl -s "${A[@]}" $B/api/boards/$CP | j 'o.board.title+":"+o.cards.length')" "Minis:1" "copyFrom deep-copies board"

# delete board card + restore
SNAP=$(post /api/cards/delete "{\"ids\":[\"$BC\"]}")
check "$(echo "$SNAP" | j 'o.snapshot.boards.length+":"+o.snapshot.cards.length')" "1:2" "delete snapshot holds board + cards"
check "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" $B/api/boards/$CB)" 404 "child board gone after delete"
curl -s "${A[@]}" -X POST $B/api/restore -d "$SNAP" >/dev/null
check "$(curl -s "${A[@]}" $B/api/boards/$CB | j 'o.cards.map(c=>c.id).join()')" "$N1" "restore brings board and card back"

# delete with arrow + restore
AR2=$(post /api/boards/root/arrows "{\"from_card\":\"$N2\",\"to_card\":\"$COL\"}" | j o.arrow.id)
SNAP=$(post /api/cards/delete "{\"ids\":[\"$COL\"]}")
check "$(echo "$SNAP" | j 'o.snapshot.cards.length+":"+o.snapshot.arrows.length')" "3:1" "deleting column takes its cards and arrow"
curl -s "${A[@]}" -X POST $B/api/restore -d "$SNAP" >/dev/null
check "$(curl -s "${A[@]}" $B/api/boards/root | j 'o.arrows.length+":"+o.cards.filter(c=>c.column_id==="'$COL'").length')" "1:2" "restore brings column, cards, arrow back"

# arrows patch/delete
check "$(curl -s "${A[@]}" -X PATCH $B/api/arrows/$AR2 -d '{"label":"why"}' | j o.arrow.label)" why "arrow patch"
check "$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" -X DELETE $B/api/arrows/$AR2)" 200 "arrow delete"
check "$(curl -s "${A[@]}" -X PATCH $B/api/boards/$CB -d '{"title":"Minis 2"}' | j o.board.title)" "Minis 2" "board rename"

# uploads
$NODE -e '
const sharp=require("sharp");
const bg={r:200,g:30,b:30};
sharp({create:{width:2000,height:1500,channels:3,background:bg}}).jpeg().toFile("/tmp/zb-img/plain.jpg");
// stored landscape 1600x1000 with EXIF orientation 6 (rotate 90): upright is portrait
sharp({create:{width:1600,height:1000,channels:3,background:{r:30,g:30,b:200}}}).withMetadata({orientation:6}).jpeg().toFile("/tmp/zb-img/phone.jpg");
'
head -c 5000 /dev/urandom >/tmp/zb-img/broken.heic
U1=$(curl -s -H "Authorization: Bearer $TOKEN" -F file=@/tmp/zb-img/plain.jpg $B/api/upload | j o.file.id)
U2J=$(curl -s -H "Authorization: Bearer $TOKEN" -F file=@/tmp/zb-img/phone.jpg $B/api/upload)
U2=$(echo "$U2J" | j o.file.id)
check "$(echo "$U2J" | j 'o.file.width+"x"+o.file.height')" "1000x1600" "EXIF photo size reported upright"
curl -s -H "Authorization: Bearer $TOKEN" $B/files/$U2/thumb -o /tmp/zb-img/t2.webp
curl -s -H "Authorization: Bearer $TOKEN" $B/files/$U1/thumb -o /tmp/zb-img/t1.webp
curl -s -H "Authorization: Bearer $TOKEN" $B/files/$U1/mini -o /tmp/zb-img/m1.webp
dims() { $NODE -e 'require("sharp")(process.argv[1]).metadata().then(m=>console.log(m.format+" "+m.width+"x"+m.height))' "$1"; }
check "$(dims /tmp/zb-img/t2.webp)" "webp 500x800" "EXIF thumb upright, <= 800"
check "$(dims /tmp/zb-img/t1.webp)" "webp 800x600" "plain thumb <= 800"
check "$(dims /tmp/zb-img/m1.webp)" "webp 256x192" "mini 256 made on request"
check "$(curl -s -H "Authorization: Bearer $TOKEN" $B/files/$U1 | cmp -s - /tmp/zb-img/plain.jpg && echo same)" same "original stored unmodified"
check "$(curl -s -H "Authorization: Bearer $TOKEN" $B/api/files/$U1/info | j o.file.ext)" .jpg "file info"
H=$(curl -s -w ' %{http_code}' -H "Authorization: Bearer $TOKEN" -F file=@/tmp/zb-img/broken.heic $B/api/upload)
echo "     heic response: $H"
check "$(echo "$H" | awk '{print $NF}')" 415 "undecodable HEIC -> 415"
check "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" $B/api/me)" 200 "server still up after HEIC"
check "$(ls /tmp/zb-test/files | wc -l)" 2 "broken HEIC not left on disk"
check "$(curl -s "${A[@]}" "$B/api/boards/root?files=1" -o /dev/null -w '%{http_code}')" 200 "?files=1"

# SSE received writes with client id
sleep 0.3; kill $SSE 2>/dev/null
check "$(grep -c '^event: cards' /tmp/zb-sse.txt | awk '{print ($1>0)?"yes":"no"}')" yes "SSE got cards events"
check "$(grep -c '"clientId":"tester"' /tmp/zb-sse.txt | awk '{print ($1>0)?"yes":"no"}')" yes "SSE events carry X-Client-Id"
check "$(grep -c '^event: delete' /tmp/zb-sse.txt | awk '{print ($1>0)?"yes":"no"}')" yes "SSE got delete events"
check "$(grep -c '^event: arrows' /tmp/zb-sse.txt | awk '{print ($1>0)?"yes":"no"}')" yes "SSE got arrows events"

# token rotation
NEW=$(curl -s "${A[@]}" -X POST $B/api/token/rotate | j o.token)
check "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" $B/api/me)" 401 "old token rejected after rotate"
check "$(tr -d '\n' </tmp/zb-test/cli-token)" "$NEW" "cli-token rewritten"
TOKEN=$NEW; A=(-H "Authorization: Bearer $TOKEN" -H 'content-type: application/json')

# persistence + second server
BEFORE=$(curl -s "${A[@]}" $B/api/boards/root | j o.cards.length)
kill $SP; wait $SP 2>/dev/null
start
check "$(curl -s "${A[@]}" $B/api/boards/root | j o.cards.length)" "$BEFORE" "data persists across restart"
$NODE src/index.js >/tmp/zb-2nd.log 2>&1; RC=$?
check "$RC" 1 "second server on same port exits with error"
echo "     2nd server said: $(cat /tmp/zb-2nd.log)"
kill $SP; wait $SP 2>/dev/null
echo "server log errors: $(grep -ci error /tmp/zb.log)"
echo "FAILS=$FAILS"
