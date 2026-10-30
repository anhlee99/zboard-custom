#!/usr/bin/env bash
# Step 8 checks: the zboard CLI against the test server (zb-test-serve: localhost:3000, data in /tmp/zb-e2e).
set -u
. ~/.nvm/nvm.sh >/dev/null
cd ~/zboard
FAILS=0
check() { if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3 (got '$1', want '$2')"; FAILS=$((FAILS+1)); fi; }
has() { if printf '%s' "$1" | grep -qF -- "$2"; then echo "PASS $3"; else echo "FAIL $3 (no '$2' in: $(printf '%s' "$1" | head -c 400))"; FAILS=$((FAILS+1)); fi; }
hasnt() { if printf '%s' "$1" | grep -qF -- "$2"; then echo "FAIL $3 (found '$2')"; FAILS=$((FAILS+1)); else echo "PASS $3"; fi; }

export DATA_DIR=/tmp/zb-e2e XDG_CONFIG_HOME=/tmp/zb-cli-config NO_COLOR=1
unset ZBOARD_URL ZBOARD_TOKEN SSH_CONNECTION SSH_TTY TMUX WT_SESSION TERM_PROGRAM KITTY_WINDOW_ID
rm -rf /tmp/zb-cli-config /tmp/zb-cli-out && mkdir -p /tmp/zb-cli-out
Z() { node cli/zboard.js "$@"; }
TOKEN=$(cat /tmp/zb-e2e/cli-token)
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' localhost:3000/api/boards/root \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0));console.log(JSON.stringify({ids:d.cards.map(c=>c.id)}))' \
  | curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @- localhost:3000/api/cards/delete >/dev/null

# --- no setup: connects through DATA_DIR/cli-token ---
out=$(Z whoami)
has "$out" "/tmp/zb-e2e/cli-token" "no setup: uses DATA_DIR/cli-token"
has "$out" "connected" "whoami reports connected"

# --- create, list, read ---
out=$(Z "new board Minis; cd Minis; new note Hello **world** and _more_; new todo Paint list; new column Backlog; new note In the column --in Backlog; ls")
has "$out" "Created #1 Hello world and more" "new note"
has "$out" "todo    Paint list" "new todo"
has "$out" "column  Backlog" "new column"
has "$out" "    4  note    In the column" "new note --in <column> nests it"
check "$(Z 'cd Minis; cat 1')" "Hello **world** and _more_" "cat shows the note as markdown-ish text"
check "$(Z 'Minis; pwd')" "/Home/Minis" "typing a board name enters it"
check "$(Z 'cd Minis; cd ..; pwd')" "/Home" "cd .."
check "$(Z 'cd /Home/Minis; pwd')" "/Home/Minis" "cd /Home/a/b"
check "$(Z 'cd 1; pwd')" "/Home/Minis" "cd by number"
check "$(Z 'cd Minis; cd /; cd -; pwd' | tail -1)" "/Home/Minis" "cd -"
has "$(Z tree)" "└── Minis" "tree"
has "$(printf 'cd Minis\nls\n' | Z)" "Backlog" "piped script"
has "$(Z 'cd Minis; ls -l')" "$(date +%Y)" "ls -l adds ids and dates"

# --- edit round trip through $EDITOR ---
cat >/tmp/zb-cli-out/ed.sh <<'EOF'
#!/bin/sh
sed -i 's/Hello/Hi there/' "$1"
printf '# Heading\n- first bullet\n- second [link](https://example.com)\n' >> "$1"
EOF
chmod +x /tmp/zb-cli-out/ed.sh
check "$(EDITOR=/tmp/zb-cli-out/ed.sh Z 'cd Minis; edit 1')" "Saved." "edit via \$EDITOR"
html=$(curl -s -H "Authorization: Bearer $TOKEN" "localhost:3000/api/search?q=there" | node -e 'const r=JSON.parse(require("fs").readFileSync(0)).results[0];console.log(r.id)')
html=$(curl -s -H "Authorization: Bearer $TOKEN" "localhost:3000/api/boards/$(curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/boards | node -e 'console.log(JSON.parse(require("fs").readFileSync(0)).boards.find(b=>b.title==="Minis").id)')" | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(d.cards.find(c=>c.id==='$html').data.html)")
check "$html" '<div>Hi there <b>world</b> and <u>more</u></div><h3>Heading</h3><ul><li>first bullet</li><li>second <a href="https://example.com">link</a></li></ul>' "edited text saved as note HTML"
check "$(EDITOR=true Z 'cd Minis; edit 1')" "No changes." "unchanged edit round-trips exactly"
out=$(Z 'cd Minis; cat 1')
has "$out" "- second [link](https://example.com)" "cat shows the edited note"

printf '#!/bin/sh\nprintf -- "- [ ] milk\\n- [x] eggs\\n" >> "$1"\n' >/tmp/zb-cli-out/todo.sh && chmod +x /tmp/zb-cli-out/todo.sh
EDITOR=/tmp/zb-cli-out/todo.sh Z 'cd Minis; edit Paint list' >/dev/null
check "$(Z 'cd Minis; check Paint list milk')" "[x] milk" "check (unquoted names with spaces)"
check "$(Z 'cd Minis; uncheck Paint list 2')" "[ ] eggs" "uncheck by item number"
has "$(Z 'cd Minis; cat Paint list')" "[x] milk" "to-do shows ticks"

# --- rename, mv, cp, rm with names that contain spaces ---
Z 'new board Paint ideas' >/dev/null
check "$(Z 'cd Paint ideas; pwd')" "/Home/Paint ideas" "cd to an unquoted name with spaces"
has "$(Z 'cd Minis; mv Paint list /Paint ideas')" 'Moved "Paint list" to /Home/Paint ideas.' "mv <card> <board> without quotes"
has "$(Z 'cd Paint ideas; ls')" "Paint list" "card arrived"
has "$(Z 'cp Minis Paint ideas')" 'Copied "Minis"' "cp copies a board card"
has "$(Z 'cd Paint ideas; cd Minis; ls')" "Backlog" "the copy has the board's contents"
Z 'cd Paint ideas; rename Paint list Shopping' >/dev/null
has "$(Z 'cd Paint ideas; ls')" "Shopping" "rename"
Z 'cd Paint ideas; rm Shopping' >/dev/null
hasnt "$(Z 'cd Paint ideas; ls')" "Shopping" "rm (no prompt outside the shell)"

# --- search, tags, saved ---
Z 'cd Minis; new note Paint the #minis tonight' >/dev/null
has "$(Z 'search tonight')" "/Home/Minis" "search shows where"
has "$(Z tags)" "#minis" "tags"
has "$(Z saved)" "Nothing saved." "saved"

# --- upload, get (Windows-safe names), view ---
node -e '
const zlib=require("zlib");const w=40,h=30;const row=Buffer.alloc(1+w*3);for(let x=0;x<w;x++)row.set([200,40,40],1+x*3);
const t=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc=b=>{let c=0xffffffff;for(const x of b)c=t[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0};
const ch=(ty,d)=>{const td=Buffer.concat([Buffer.from(ty),d]);const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",ih),ch("IDAT",zlib.deflateSync(Buffer.concat(Array(h).fill(row)))),ch("IEND",Buffer.alloc(0))]);
require("fs").writeFileSync("/tmp/zb-cli-out/a:b?c*.png",png);require("fs").writeFileSync("/tmp/zb-cli-out/CON.png",png);require("fs").writeFileSync("/tmp/zb-cli-out/red dot.png",png);'
has "$(Z "new board Pics; cd Pics; upload /tmp/zb-cli-out/a:b?c*.png /tmp/zb-cli-out/CON.png /tmp/zb-cli-out/red dot.png")" "Uploaded 3 images." "upload (path with a space unquoted)"
mkdir -p /tmp/zb-cli-out/dl && cd /tmp/zb-cli-out/dl
node ~/zboard/cli/zboard.js 'cd Pics; get 1; get 2; get 3' >/dev/null
cd ~/zboard
check "$(ls /tmp/zb-cli-out/dl | sort | tr '\n' ' ')" "_CON.png abc.png red dot.png " "get strips : ? * and avoids CON"
cmp -s "/tmp/zb-cli-out/dl/red dot.png" "/tmp/zb-cli-out/red dot.png" && echo "PASS get downloads the original" || { echo "FAIL get downloads the original"; FAILS=$((FAILS+1)); }
out=$(SSH_CONNECTION="1 2 3 4" TERM=xterm-256color Z 'cd Pics; view 3')
has "$out" "▀" "over SSH: truecolor half-blocks"
if printf '%s' "$out" | grep -qE $'\e\\[38;2;(19[0-9]|20[0-9]);(3[0-9]|4[0-9]);(3[0-9]|4[0-9])m'; then echo "PASS half-blocks carry the image colours"; else echo "FAIL half-blocks carry the image colours"; FAILS=$((FAILS+1)); fi
has "$(SSH_CONNECTION=x TERM_PROGRAM=iTerm.app Z 'cd Pics; view 3')" $'\e]1337;File=inline=1' "iTerm2/WezTerm: inline image protocol"
has "$(SSH_CONNECTION=x TERM=xterm-kitty Z 'cd Pics; view 3')" $'\e_Ga=T,f=100' "kitty/Ghostty: graphics protocol"
has "$(SSH_CONNECTION=x TERM=xterm-kitty TMUX=/tmp/t Z 'cd Pics; view 3')" "▀" "inside tmux: half-blocks"
has "$(SSH_CONNECTION=x TERM_PROGRAM=WezTerm WT_SESSION=1 Z 'cd Pics; view 3')" "▀" "Windows Terminal: half-blocks"
has "$(SSH_CONNECTION=x Z 'cd Pics; info 3')" "40×30" "info shows the file"

# --- library bits ---
check "$(node -e 'const z=require("./cli/zboard.js");console.log([z.safeName("a:b?c*.png"),z.safeName("nul"),z.safeName("COM1.txt"),z.safeName("x<y>|z\"")].join(" "))')" "abc.png _nul _COM1.txt xyz" "safe file names"
check "$(node -e 'require("./cli/zboard.js").complete("cd Mi").then(r=>console.log(r[0].join()))')" "Minis/" "Tab completion: board names"
check "$(node -e 'require("./cli/zboard.js").complete("ca").then(r=>console.log(r[0].join()))')" "cat" "Tab completion: commands"
check "$(node -e 'require("./cli/zboard.js").complete("new b").then(r=>console.log(r[0].join()))')" "board" "Tab completion: card types"

# --- login, config order, logout ---
out=$(printf 'testpw\n' | Z login http://localhost:3000)
has "$out" "Signed in to http://localhost:3000" "login with the app password"
check "$(stat -c %a /tmp/zb-cli-config/zboard/config.json)" "600" "config saved with mode 600"
has "$(Z whoami)" "/tmp/zb-cli-config/zboard/config.json" "config.json beats cli-token"
has "$(ZBOARD_URL=http://localhost:3000 ZBOARD_TOKEN=wrong Z whoami 2>&1)" "rejected the token from ZBOARD_URL + ZBOARD_TOKEN" "env vars come first"
has "$(Z logout)" "Still connected through /tmp/zb-e2e/cli-token" "logout falls back to the token file"
has "$(printf 'wrong\n' | Z login http://localhost:3000 2>&1)" "Wrong password" "login with a wrong password fails clearly"
has "$(DATA_DIR=/nonexistent Z ls 2>&1)" "Not connected" "no token anywhere: clear message"

echo "FAILS=$FAILS"
