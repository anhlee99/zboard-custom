import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { INK_COLORS, INK_SIZES, inkBounds, mapStrokes, strokePath } from './ink.js';

// Last pen colour and size, remembered between drawings (per browser).
const remembered = () => {
  try {
    return JSON.parse(localStorage.getItem('zb:ink') || 'null') || {};
  } catch {
    return {};
  }
};

const MIN_SIZE = 1;
const MAX_SIZE = 48;

// Distance from point (px, py) to segment a-b.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function hits(st, x, y, slack) {
  const p = st.p;
  const r = st.s / 2 + slack;
  if (p.length < 6) return Math.hypot(x - p[0], y - p[1]) <= r;
  for (let i = 0; i + 5 < p.length; i += 3) if (segDist(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= r) return true;
  return false;
}

// Full-board drawing mode. Strokes are in world units while editing; the board turns them
// into a drawing card on Save. Wheel and trackpad still pan and zoom underneath.
export default function DrawLayer({ view, canvasRef, initial, frame, onSave, onCancel }) {
  const mem = remembered();
  const [strokes, setStrokes] = useState(initial);
  const [live, setLive] = useState(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(INK_COLORS.includes(mem.c) ? mem.c : INK_COLORS[0]);
  // Older saves stored a size index 0-3; now it is the stroke width itself.
  const [size, setSize] = useState(mem.s >= MIN_SIZE && mem.s <= MAX_SIZE && mem.s > 3 ? mem.s : INK_SIZES[mem.s] || 6);
  const [sel, setSel] = useState(() => new Set());
  const [box, setBox] = useState(null);
  const [shift, setShift] = useState(null); // live offset of the selection while moving it
  const [pop, setPop] = useState(null);
  const [, setTick] = useState(0);
  const hist = useRef({ undo: [], redo: [] });
  const cur = useRef(strokes);
  cur.current = strokes;
  const viewRef = useRef(view);
  viewRef.current = view;
  const g = useRef(null);
  const changed = hist.current.undo.length > 0;

  useEffect(() => {
    try {
      localStorage.setItem('zb:ink', JSON.stringify({ c: color, s: size }));
    } catch {}
  }, [color, size]);

  const commit = (next) => {
    hist.current.undo.push(cur.current);
    hist.current.redo = [];
    setStrokes(next);
  };
  const undo = () => {
    const h = hist.current;
    if (!h.undo.length) return;
    h.redo.push(cur.current);
    setStrokes(h.undo.pop());
    setSel(new Set());
  };
  const redo = () => {
    const h = hist.current;
    if (!h.redo.length) return;
    h.undo.push(cur.current);
    setStrokes(h.redo.pop());
    setSel(new Set());
  };
  const removeSelected = () => {
    if (!sel.size) return;
    commit(cur.current.filter((_, i) => !sel.has(i)));
    setSel(new Set());
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input:not([type=range]), textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (pop) setPop(null);
        else onCancel();
      } else if (mod && k === 'z' && !e.shiftKey) undo();
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redo();
      else if (mod && k === 's') onSave(cur.current);
      else if (mod) return;
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
      else if (k === 'p' || k === 'b') setTool('pen');
      else if (k === 'v') setTool('select');
      else if (k === 'e') setTool('eraser');
      else if (e.key === '[') setSize((v) => Math.max(MIN_SIZE, Math.round(v / 1.25)));
      else if (e.key === ']') setSize((v) => Math.min(MAX_SIZE, Math.max(v + 1, Math.round(v * 1.25))));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const toWorld = (cx, cy) => {
    const r = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.s, y: (cy - r.top - v.y) / v.s };
  };
  const topHit = (w) => {
    const list = cur.current;
    for (let i = list.length - 1; i >= 0; i--) if (hits(list[i], w.x, w.y, 6 / viewRef.current.s)) return i;
    return -1;
  };

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // middle / right button: let the board pan
    if (g.current) {
      // A second finger: drop the stroke in progress.
      g.current = null;
      setLive(null);
      return;
    }
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setPop(null);
    const w = toWorld(e.clientX, e.clientY);
    const pr = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    if (tool === 'pen') {
      g.current = { type: 'pen', id: e.pointerId, stroke: { c: color, s: size, p: [w.x, w.y, pr] } };
      setLive(g.current.stroke);
    } else if (tool === 'eraser') {
      g.current = { type: 'erase', id: e.pointerId, before: cur.current };
      eraseAt(w);
    } else {
      const i = topHit(w);
      if (i >= 0) {
        const next = e.shiftKey ? new Set(sel) : sel.has(i) ? sel : new Set();
        next.add(i);
        setSel(next);
        g.current = { type: 'move', id: e.pointerId, from: w, sel: next };
      } else {
        g.current = { type: 'box', id: e.pointerId, from: w, base: e.shiftKey ? sel : new Set() };
        if (!e.shiftKey) setSel(new Set());
      }
    }
  };

  const eraseAt = (w) => {
    const keep = cur.current.filter((st) => !hits(st, w.x, w.y, 4 / viewRef.current.s));
    if (keep.length !== cur.current.length) {
      cur.current = keep;
      setStrokes(keep);
    }
  };

  const onMove = (e) => {
    const gs = g.current;
    if (!gs || e.pointerId !== gs.id) return;
    const evs = e.nativeEvent.getCoalescedEvents?.() || [];
    const samples = evs.length ? evs : [e.nativeEvent];
    if (gs.type === 'pen') {
      const p = gs.stroke.p;
      const minStep = 0.6 / viewRef.current.s;
      for (const ev of samples) {
        const w = toWorld(ev.clientX, ev.clientY);
        if (Math.hypot(w.x - p[p.length - 3], w.y - p[p.length - 2]) < minStep) continue;
        if (p.length >= 15000) break;
        p.push(Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10, ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5);
      }
      gs.stroke = { ...gs.stroke, p };
      setLive(gs.stroke);
    } else if (gs.type === 'erase') {
      for (const ev of samples) eraseAt(toWorld(ev.clientX, ev.clientY));
    } else if (gs.type === 'move') {
      const w = toWorld(e.clientX, e.clientY);
      setShift({ x: w.x - gs.from.x, y: w.y - gs.from.y });
    } else if (gs.type === 'box') {
      const w = toWorld(e.clientX, e.clientY);
      const b = { x: Math.min(gs.from.x, w.x), y: Math.min(gs.from.y, w.y), w: Math.abs(w.x - gs.from.x), h: Math.abs(w.y - gs.from.y) };
      setBox(b);
      const next = new Set(gs.base);
      cur.current.forEach((st, i) => {
        const r = inkBounds([st]);
        if (r && r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y) next.add(i);
      });
      setSel(next);
    }
  };

  const onUp = (e) => {
    const gs = g.current;
    if (!gs || e.pointerId !== gs.id) return;
    g.current = null;
    if (gs.type === 'pen') {
      setLive(null);
      if (e.type !== 'pointercancel') commit([...cur.current, gs.stroke]);
    } else if (gs.type === 'erase') {
      if (cur.current.length !== gs.before.length) {
        hist.current.undo.push(gs.before);
        hist.current.redo = [];
        setTick((t) => t + 1);
      }
    } else if (gs.type === 'move') {
      const d = shift;
      setShift(null);
      if (d && (d.x || d.y)) commit(cur.current.map((st, i) => (gs.sel.has(i) ? mapStrokes([st], 1, d.x, d.y)[0] : st)));
    } else if (gs.type === 'box') {
      setBox(null);
    }
  };

  const selBounds = sel.size ? inkBounds(strokes.filter((_, i) => sel.has(i))) : null;
  const cursor = tool === 'pen' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'default';
  const w8 = 1 / view.s;

  return (
    <div className={frame ? 'draw-layer on-image' : 'draw-layer'}>
      <svg className="draw-svg" style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="draw-surface">
        {frame && (
          <path
            className="draw-dim"
            fillRule="evenodd"
            d={`M-9999,-9999H99999V99999H-9999Z M${view.x + frame.x * view.s},${view.y + frame.y * view.s}h${frame.w * view.s}v${frame.h * view.s}h${-frame.w * view.s}Z`}
          />
        )}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
          {frame && (
            <defs>
              <clipPath id="draw-frame">
                <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} />
              </clipPath>
            </defs>
          )}
          {frame && <rect className="draw-frame" x={frame.x} y={frame.y} width={frame.w} height={frame.h} strokeWidth={1.5 * w8} />}
          <g clipPath={frame ? 'url(#draw-frame)' : undefined}>
            {strokes.map((st, i) => (
              <path key={i} d={strokePath(st)} fill={st.c} transform={shift && sel.has(i) ? `translate(${shift.x} ${shift.y})` : undefined} />
            ))}
            {live && <path d={strokePath(live)} fill={live.c} />}
          </g>
          {selBounds && (
            <rect
              className="draw-sel"
              x={selBounds.x - 4 * w8 + (shift?.x || 0)}
              y={selBounds.y - 4 * w8 + (shift?.y || 0)}
              width={selBounds.w + 8 * w8}
              height={selBounds.h + 8 * w8}
              strokeWidth={1.5 * w8}
              strokeDasharray={`${5 * w8} ${4 * w8}`}
            />
          )}
          {box && <rect className="draw-box" x={box.x} y={box.y} width={box.w} height={box.h} strokeWidth={w8} />}
        </g>
      </svg>

      <div className="draw-bar" role="toolbar" aria-label="Drawing tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} data-tip="Pen (P)" aria-label="Pen">
          <Icon name="draw" size={18} />
        </button>
        <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} data-tip="Select and move strokes (V)" aria-label="Select strokes">
          <Icon name="pointer" size={18} />
        </button>
        <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')} data-tip="Eraser (E)" aria-label="Eraser">
          <Icon name="eraser" size={18} />
        </button>
        <span className="draw-sep" />
        <div className="draw-popwrap">
          <button onClick={() => setPop(pop === 'color' ? null : 'color')} data-tip="Colour" aria-label="Pen colour">
            <span className="draw-color" style={{ background: color }} />
          </button>
          {pop === 'color' && (
            <div className="draw-pop draw-colors">
              {INK_COLORS.map((c) => (
                <button
                  key={c}
                  className={c === color ? 'on' : ''}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setPop(null);
                    if (sel.size) commit(cur.current.map((st, i) => (sel.has(i) ? { ...st, c } : st)));
                  }}
                  aria-label={'Pen colour ' + c}
                />
              ))}
              <label className="draw-custom" data-tip="Custom colour">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom pen colour" />
              </label>
            </div>
          )}
        </div>
        <div className="draw-popwrap">
          <button onClick={() => setPop(pop === 'size' ? null : 'size')} data-tip="Stroke size ([ and ])" aria-label="Stroke size">
            <span className="draw-dot" style={{ width: Math.min(22, Math.max(3, size)), height: Math.min(22, Math.max(3, size)), background: color }} />
          </button>
          {pop === 'size' && (
            <div className="draw-pop draw-size-pop">
              <div className="draw-size-preview">
                <span className="draw-dot" style={{ width: Math.min(56, size * view.s), height: Math.min(56, size * view.s), background: color }} />
              </div>
              <input
                type="range"
                min={MIN_SIZE}
                max={MAX_SIZE}
                step="1"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                // Releasing the slider resizes selected strokes too.
                onPointerUp={() => sel.size && commit(cur.current.map((st, i) => (sel.has(i) ? { ...st, s: size } : st)))}
                onKeyUp={() => sel.size && commit(cur.current.map((st, i) => (sel.has(i) ? { ...st, s: size } : st)))}
                aria-label="Stroke size slider"
              />
              <span className="draw-size-num">{size}</span>
            </div>
          )}
        </div>
        <span className="draw-sep" />
        <button onClick={undo} disabled={!hist.current.undo.length} data-tip="Undo (Ctrl+Z)" aria-label="Undo stroke">
          <Icon name="undo" size={18} />
        </button>
        <button onClick={redo} disabled={!hist.current.redo.length} data-tip="Redo (Ctrl+Y)" aria-label="Redo stroke">
          <Icon name="redo" size={18} />
        </button>
        <span className="draw-sep draw-sep-actions" />
        <div className="draw-actions">
          <button className="draw-cancel" onClick={onCancel}>
            {changed ? 'Discard' : 'Cancel'}
          </button>
          <button className="draw-save" onClick={() => onSave(cur.current)} disabled={!changed}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
