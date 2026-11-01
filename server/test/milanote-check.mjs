// Checks what /api/import/milanote made from milanote-payload.mjs.
import fs from 'node:fs';

const out = JSON.parse(fs.readFileSync(process.argv[2]));
const T = process.argv[3];
const get = (p) => fetch('http://localhost:3200' + p, { headers: { authorization: 'Bearer ' + T } }).then((r) => r.json());
const ok = (c, m) => {
  if (!c) {
    console.log('FAIL - ' + m, JSON.stringify(out).slice(0, 800));
    process.exit(1);
  }
  console.log('ok - ' + m);
};

ok(out.boards === 2 && out.arrows === 1, 'two boards and one arrow');
ok(out.skipped.length === 2 && out.skipped.some((s) => s.id === 'I2') && out.skipped.some((s) => s.id === 'L2'), 'missing picture and loose line reported');
ok(out.notes.some((n) => /highlight/.test(n)), 'highlight noted');
const home = await get('/api/boards/' + out.boardId);
const types = home.cards.map((c) => c.type).sort().join(',');
ok(types === 'board,drawing,note', `home: sub-board, drawing, clone as note (${types})`);
const draw = home.cards.find((c) => c.type === 'drawing');
ok(draw.x === 700 && draw.y === 240 && draw.w === 13, 'drawing placed and sized');
const sub = home.cards.find((c) => c.type === 'board');
ok(sub.x === 50 && sub.y === 30 && sub.child.cover.value === '🐷' && sub.child.cover.bg === '#7cd651', 'sub-board cover from icon and colour');
const s = await get('/api/boards/' + sub.data.boardId);
const by = (t) => s.cards.filter((c) => c.type === t);
const note = by('note')[0];
ok(note.data.html === '<p><a href="https://x.test">Ez &lt;Skin&gt;</a></p>' && note.color === '#fb5656' && note.x === 510, 'note text, link, colour');
const img = by('image').find((c) => c.x === 100);
ok(img.w === 460 && img.data.caption === 'Orc skin' && img.data.labels[0] === 'Skin', 'image width, caption, label');
const clip = by('image').find((c) => c.x === 300);
ok(!clip.data.caption && clip.data.source_url === 'https://pinterest.com/p/1', 'clipper caption became the source link');
const hid = by('image').find((c) => c.x === 600);
ok(!hid.data.caption && hid.data.alt === 'secret note', 'hidden caption kept as alt text');
ok(by('todo')[0].data.items[0].done === true && by('todo')[0].data.items[0].text === 'Base', 'to-do items');
ok(by('color')[0].data.hex === '#ecbc1c' && by('color')[0].data.name === 'Fuel Yellow', 'colour card');
const col = by('column')[0];
ok(col && by('link')[0].column_id === col.id && by('link')[0].data.site === 'YouTube', 'unsorted tray became a column');
ok(s.arrows.length === 1 && s.arrows[0].data.end === true && s.arrows[0].data.start === false, 'arrow ends');
