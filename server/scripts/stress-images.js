// Stress test: fill a new board with image cards cloned from images already uploaded.
//
//   node server/scripts/stress-images.js 1000              1000 cards, cycling through existing images
//   node server/scripts/stress-images.js --each 20         20 cards per existing image
//   node server/scripts/stress-images.js 1000 --title "Big board"
//   node server/scripts/stress-images.js 1000 --shared     reuse the original files (no copies on disk)
//   node server/scripts/stress-images.js --cleanup         remove every stress board, its cards and copied files
//
// By default every card gets its own real file copy (original + thumbnail), like real uploads.
// Created boards are recorded in meta.stress_boards so --cleanup can undo everything.
// Reads DATA_DIR like the server (run with --env-file=.env, or use stress-test.sh).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, newId } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const dir = (d) => path.join(DATA_DIR, d);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const count = Number(args.find((a, i) => /^\d+$/.test(a) && !['--each', '--title'].includes(args[i - 1])));

if (!fs.existsSync(path.join(DATA_DIR, 'zboard.db'))) {
  console.error(`No ZBoard database in ${DATA_DIR}. Set DATA_DIR or start the server once.`);
  process.exit(1);
}
const store = createStore(path.join(DATA_DIR, 'zboard.db'));
const records = JSON.parse(store.getMeta('stress_boards') || '[]');

function removeFile(f) {
  for (const p of [dir('files') + `/${f.id}${f.ext}`, dir('thumbs') + `/${f.id}.webp`, dir('minis') + `/${f.id}.webp`]) fs.rmSync(p, { force: true });
  store.db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  store.db.prepare('DELETE FROM drive_files WHERE local_id = ?').run(f.id);
}

if (flag('--cleanup')) {
  let cards = 0;
  let files = 0;
  for (const r of records) {
    if (store.getCard(r.card)) cards += store.deleteCards([r.card]).snapshot.cards.length;
    for (const id of r.files) {
      const f = store.getFile(id);
      if (f) {
        removeFile(f);
        files++;
      }
    }
  }
  store.setMeta('stress_boards', '[]');
  console.log(`Removed ${records.length} stress board(s), ${cards} card(s), ${files} copied file(s).`);
  store.close();
  process.exit(0);
}

const images = store.allFiles().filter((f) => f.width && f.height && fs.existsSync(dir('thumbs') + `/${f.id}.webp`) && !records.some((r) => r.files.includes(f.id)));
if (!images.length) {
  console.error('No images to clone. Upload a few images to ZBoard first.');
  process.exit(1);
}
const each = Number(option('--each')) || 0;
const total = each ? each * images.length : count || 1000;
const shared = flag('--shared');
const title = option('--title') || `Stress ${total}`;
const started = Date.now();

const t0 = Date.now();
const [boardCard] = store.createCards('root', [{ type: 'board', title, x: 40 + records.length * 180, y: 40 }]);
const boardId = boardCard.data.boardId;
const copied = [];
const cols = Math.ceil(Math.sqrt(total * 1.6));
const cards = [];
for (let i = 0; i < total; i++) {
  const src = each ? images[Math.floor(i / each)] : images[i % images.length];
  let fileId = src.id;
  if (!shared) {
    fileId = newId();
    fs.copyFileSync(dir('files') + `/${src.id}${src.ext}`, dir('files') + `/${fileId}${src.ext}`);
    fs.copyFileSync(dir('thumbs') + `/${src.id}.webp`, dir('thumbs') + `/${fileId}.webp`);
    if (src.display_ext) fs.copyFileSync(dir('files') + `/${src.id}${src.display_ext}`, dir('files') + `/${fileId}${src.display_ext}`);
    store.insertFile({ ...src, id: fileId, created_at: Date.now() });
    copied.push(fileId);
  }
  cards.push({ type: 'image', x: (i % cols) * 260, y: Math.floor(i / cols) * 260, w: 240, data: { fileId, caption: '' } });
}
store.createCards(boardId, cards);
records.push({ board: boardId, card: boardCard.id, files: copied, title, created_at: started });
store.setMeta('stress_boards', JSON.stringify(records));
console.log(`Board "${title}" with ${total} image cards (${shared ? 'shared files' : `${copied.length} file copies`}) in ${Date.now() - t0} ms.`);
console.log(`Open it: #/b/${boardId}`);
store.close();
