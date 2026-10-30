// Drawing strokes. A stroke is { c: colour, s: size, p: [x, y, pressure, x, y, pressure, …] }
// in the drawing's own units; the card shows them scaled to its width (vw = natural width).
// Same file as web/src/ink.js, so the board and the terminal render drawings alike.
import { getStroke } from 'perfect-freehand';

export const INK_SIZES = [3, 6, 12, 24];
export const INK_COLORS = ['#23221f', '#8e8e93', '#38bdb0', '#6dd36d', '#e08a4c', '#f6c445', '#f2783c', '#ef4444', '#ec6fcf', '#a26bf0', '#4fb7f5', '#4f7cf7', '#ffffff'];

const outlines = new WeakMap();

function points(st) {
  const out = [];
  for (let i = 0; i + 2 < st.p.length; i += 3) out.push([st.p[i], st.p[i + 1], st.p[i + 2]]);
  return out;
}

// Polygon around the stroke, tapered by pen pressure (or simulated speed for a mouse).
export function strokeOutline(st) {
  let o = outlines.get(st);
  if (!o) {
    const pts = points(st);
    const real = pts.some((p) => p[2] !== 0.5);
    o = getStroke(pts, { size: st.s, thinning: 0.55, smoothing: 0.5, streamline: 0.4, simulatePressure: !real, last: true });
    outlines.set(st, o);
  }
  return o;
}

export function strokePath(st) {
  const o = strokeOutline(st);
  if (!o.length) return '';
  const avg = (a, b) => ((a + b) / 2).toFixed(2);
  let d = `M${o[0][0].toFixed(2)},${o[0][1].toFixed(2)} Q`;
  for (let i = 0; i < o.length; i++) {
    const [x0, y0] = o[i];
    const [x1, y1] = o[(i + 1) % o.length];
    d += `${x0.toFixed(2)},${y0.toFixed(2)} ${avg(x0, x1)},${avg(y0, y1)} `;
  }
  return d + 'Z';
}

// Box around all strokes, padded by half the stroke size.
export function inkBounds(strokes) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const st of strokes) {
    const r = st.s / 2 + 1;
    for (let i = 0; i + 2 < st.p.length; i += 3) {
      x1 = Math.min(x1, st.p[i] - r);
      y1 = Math.min(y1, st.p[i + 1] - r);
      x2 = Math.max(x2, st.p[i] + r);
      y2 = Math.max(y2, st.p[i + 1] + r);
    }
  }
  return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Move and scale strokes: (x, y) -> (x * k + dx, y * k + dy); sizes scale too.
export function mapStrokes(strokes, k, dx, dy) {
  return strokes.map((st) => {
    const p = st.p.slice();
    for (let i = 0; i + 2 < p.length; i += 3) {
      p[i] = Math.round((p[i] * k + dx) * 10) / 10;
      p[i + 1] = Math.round((p[i + 1] * k + dy) * 10) / 10;
    }
    return { ...st, s: Math.round(st.s * k * 100) / 100, p };
  });
}

// The whole drawing as an SVG document (for the terminal and exports).
export function drawingSvg(data, width) {
  const vw = data.vw || 1;
  const vh = data.vh || 1;
  const w = width || vw;
  const paths = (data.strokes || []).map((st) => `<path d="${strokePath(st)}" fill="${st.c || '#23221f'}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round((w * vh) / vw)}" viewBox="0 0 ${vw} ${vh}">${paths}</svg>`;
}
