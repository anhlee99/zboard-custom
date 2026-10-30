import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MIN = 0.04; // smallest crop side, as a fraction of the picture

// Quarter turns move the crop box with the picture.
const turnRight = (c) => ({ x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w });
const turnLeft = (c) => ({ x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w });

// Image in its rotated box (rw x rh), filling `box` exactly. Shared with the card.
export function rotatedImgStyle(rotate, rw, rh) {
  if (rotate % 180 === 0) return { position: 'absolute', inset: 0, width: '100%', height: '100%', transform: rotate ? `rotate(${rotate}deg)` : undefined };
  return { position: 'absolute', left: '50%', top: '50%', width: `${(rh / rw) * 100}%`, height: `${(rw / rh) * 100}%`, maxWidth: 'none', transform: `translate(-50%, -50%) rotate(${rotate}deg)` };
}

// Crop and rotate without touching the original: the card keeps { crop, rotate } and the
// board draws the picture through them. Undo works like any other change.
export default function ImageEditor({ fileId, file, crop: crop0, rotate: rotate0, onSave, onClose }) {
  const [rot, setRot] = useState(rotate0 || 0);
  const [crop, setCrop] = useState(crop0 || { x: 0, y: 0, w: 1, h: 1 });
  const drag = useRef(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('resize', on);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const W = file?.width || 1;
  const H = file?.height || 1;
  const rw = rot % 180 ? H : W;
  const rh = rot % 180 ? W : H;
  const k = Math.min(Math.min(vp.w - 48, 900) / rw, (vp.h * 0.62) / rh);
  const dw = rw * k;
  const dh = rh * k;

  const start = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, c: crop };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / dw;
    const dy = (e.clientY - d.sy) / dh;
    let { x, y, w, h } = d.c;
    if (d.mode === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      if (d.mode.includes('w')) {
        const nx = clamp(x + dx, 0, x + w - MIN);
        w += x - nx;
        x = nx;
      }
      if (d.mode.includes('e')) w = clamp(w + dx, MIN, 1 - x);
      if (d.mode.includes('n')) {
        const ny = clamp(y + dy, 0, y + h - MIN);
        h += y - ny;
        y = ny;
      }
      if (d.mode.includes('s')) h = clamp(h + dy, MIN, 1 - y);
    }
    setCrop({ x, y, w, h });
  };
  const end = () => (drag.current = null);

  const full = crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
  const save = () => onSave({ crop: full ? null : crop, rotate: rot });
  const pct = (v) => `${v * 100}%`;

  return (
    <div className="overlay img-edit-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="img-edit" role="dialog" aria-label="Edit image">
        <div className="img-edit-stage" style={{ width: dw, height: dh }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          {/* Picture and shade are clipped to the frame; the crop box and its handles are not, so corner handles stay grabbable. */}
          <div className="img-edit-clip">
            <img src={`/files/${fileId}/thumb`} alt="" draggable={false} style={rotatedImgStyle(rot, rw, rh)} />
            <div className="crop-shade" style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }} />
          </div>
          <div className="crop-box" style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }} onPointerDown={start('move')} data-testid="crop-box">
            <div className="crop-grid" />
            {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((m) => (
              <div key={m} className={`crop-handle h-${m}`} onPointerDown={start(m)} data-handle={m} />
            ))}
          </div>
        </div>
        <div className="img-edit-bar">
          <button
            className="icon-btn"
            onClick={() => {
              setRot((r) => (r + 270) % 360);
              setCrop((c) => turnLeft(c));
            }}
            data-tip="Rotate left"
            aria-label="Rotate left"
          >
            <Icon name="rotateLeft" size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              setRot((r) => (r + 90) % 360);
              setCrop((c) => turnRight(c));
            }}
            data-tip="Rotate right"
            aria-label="Rotate right"
          >
            <Icon name="rotateRight" size={18} />
          </button>
          <button
            className="img-edit-reset"
            onClick={() => {
              setRot(0);
              setCrop({ x: 0, y: 0, w: 1, h: 1 });
            }}
          >
            Reset
          </button>
          <span className="img-edit-gap" />
          <button className="img-edit-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="img-edit-save" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
