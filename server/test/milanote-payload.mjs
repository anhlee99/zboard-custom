// A small Milanote account as the page script sends it (one of each kind of item).
const fileId = process.argv[2];
const doc = (text, marks) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] }] });
const at = (parentId, x, y, score, section = 'CANVAS') => ({ parentId, section, position: { x, y, score } });

const elements = [
  { id: 'H', elementType: 'BOARD', content: { title: 'Home' }, location: {} },
  { id: 'S', elementType: 'BOARD', content: { title: 'Paint Skin', color: 'GREEN', icon: { id: 'pig' } }, location: at('H', 5, 3, 1) },
  { id: 'N1', elementType: 'CARD', content: { color: '#fb5656', textContent: doc('Ez <Skin>', [{ type: 'highlight', attrs: { color: 'orange' } }, { type: 'link', attrs: { href: 'https://x.test' } }]) }, location: at('S', 51, 32, 2) },
  { id: 'I1', elementType: 'IMAGE', content: { width: 46, labels: ['L1'], file: { filename: 'IMG_1.png' }, caption: doc('Orc skin') }, location: at('S', 10, 10, 3) },
  { id: 'I2', elementType: 'IMAGE', content: {}, location: at('S', 1, 1, 4) },
  { id: 'I3', elementType: 'IMAGE', content: { showCaption: false, caption: doc('From pinterest.com', [{ type: 'link', attrs: { href: 'https://pinterest.com/p/1' } }]) }, location: at('S', 30, 1, 4) },
  { id: 'I4', elementType: 'IMAGE', content: { showCaption: false, caption: doc('secret note') }, location: at('S', 60, 1, 4) },
  { id: 'K1', elementType: 'LINK', content: { link: { url: 'https://www.youtube.com/watch?v=abc', title: 'NMM' }, provider: { name: 'YouTube' } }, location: { parentId: 'S', section: 'INBOX', position: { index: 0 } } },
  {
    id: 'T1',
    elementType: 'TASK_LIST',
    content: { textContent: { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Base' }] }] }] }] } },
    location: at('S', 80, 0, 5),
  },
  { id: 'C1', elementType: 'COLOR_SWATCH', content: { color: { value: '#ecbc1c' }, caption: doc('Fuel Yellow') }, location: at('S', 70, 62, 6) },
  { id: 'X1', elementType: 'CLONE', content: { linkTo: 'N1', clonedElementType: 'CARD' }, location: at('H', 40, 0, 2) },
  { id: 'A1', elementType: 'ANNOTATION', content: { width: 1.5, drawing: { width: 9, height: 18, paths: [{ size: 8, color: null, points: [[5, 9, 0], [6, 9, 0]] }] } }, location: at('H', 70, 24, 3) },
  { id: 'L1', elementType: 'LINE', content: { start: { elementId: 'N1' }, end: { elementId: 'I1' }, startStyle: 'NONE', endStyle: 'ARROW', lineStyle: 'SOLID', lineWeight: 2 }, location: at('S', 0, 0, 9) },
  { id: 'L2', elementType: 'LINE', content: { start: { elementId: 'N1' }, end: { x: 1, y: 1 } }, location: at('S', 0, 0, 10) },
  { id: 'Z', elementType: 'CARD', content: {}, location: { parentId: 'S', section: 'TRASH' } },
];
console.log(JSON.stringify({ rootId: 'H', title: 'From Milanote', labels: { L1: 'Skin' }, files: { I1: fileId, I3: fileId, I4: fileId }, elements }));
