import { useState } from 'react';

// Board covers: an emoji or a few letters on a colour, or a two-colour pair (background + text).
export const COVER_ICONS = [
  '🎨', '🖌️', '🖍️', '✏️', '📐', '🧪', '🔥', '💧', '⚡', '🌿', '🍄', '🌋',
  '👹', '👺', '🧌', '🐉', '🐲', '💀', '🧟', '🧛', '🧙', '🧝', '🛡️', '⚔️',
  '🏹', '🪓', '🔨', '⚙️', '🤖', '👾', '🚀', '🛸', '🐗', '🐺', '🦇', '🕷️',
  '🐷', '🐸', '🐙', '🦴', '🏰', '🗺️', '📚', '📷', '🎬', '🎵', '🎮', '🎲',
  '⭐', '❤️', '✅', '📌', '💡', '🏠', '✋', '👁️', '🌙', '☀️', '❄️', '🌊',
];

export const SOLIDS = ['#8e8e93', '#4b5563', '#38bdb0', '#6dd36d', '#e08a4c', '#f6c445', '#f2783c', '#ef4444', '#ec6fcf', '#a26bf0', '#4fb7f5', '#4f7cf7'];

export const PAIRS = [
  ['#e8735a', '#3b1d14'],
  ['#1f2937', '#f59e0b'],
  ['#7c2d12', '#fde68a'],
  ['#0f4c75', '#bbe1fa'],
  ['#3c2a21', '#e8c39e'],
  ['#14532d', '#bbf7d0'],
  ['#fde68a', '#92400e'],
  ['#e0e7ff', '#3730a3'],
  ['#fce7f3', '#9d174d'],
  ['#111827', '#ffffff'],
  ['#f5f5f4', '#1c1917'],
  ['#d6c4b0', '#5a3e2b'],
];

// Readable text colour for a background.
export function inkFor(bg) {
  const n = parseInt(bg.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1f2937' : '#ffffff';
}

export function initials(title) {
  const words = String(title || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return 'B';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 4).map((w) => [...w][0]).join('').toUpperCase();
}

// The coloured tile on a board card. `cover` may be null (plain board icon).
export function CoverTile({ cover, fallback }) {
  const style = cover?.bg ? { background: cover.bg, color: cover.fg || inkFor(cover.bg) } : undefined;
  let inner = fallback;
  if (cover?.kind === 'icon' && cover.value) inner = <span className="cover-emoji">{cover.value}</span>;
  else if (cover?.kind === 'text' && cover.value) inner = <span className={`cover-text len-${Math.min(4, [...cover.value].length)}`}>{cover.value}</span>;
  return (
    <div className={cover?.bg ? 'board-icon has-cover' : 'board-icon'} style={style}>
      {inner}
    </div>
  );
}

export default function CoverPicker({ cover, title, onChange, onClose }) {
  const [tab, setTab] = useState(cover?.kind === 'text' ? 'text' : 'icon');
  const current = cover || { kind: null, value: '', bg: null, fg: null };
  const set = (patch) => onChange({ ...current, ...patch });
  const ini = initials(title);
  const suggestions = [...new Set([ini, ini.slice(0, 2), [...ini][0], String(title || '').trim().slice(0, 3).toUpperCase()].filter(Boolean))];

  return (
    <div className="cover-pop" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Board cover">
      <div className="cover-head">
        <CoverTile cover={current} fallback={<span className="cover-text len-1">{[...ini][0]}</span>} />
        <div className="cover-tabs">
          <button className={tab === 'icon' ? 'on' : ''} onClick={() => setTab('icon')}>
            Icon
          </button>
          <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>
            Text
          </button>
        </div>
        <button className="cover-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {tab === 'icon' ? (
        <>
          <div className="cover-icons">
            {COVER_ICONS.map((ic) => (
              <button key={ic} className={current.kind === 'icon' && current.value === ic ? 'on' : ''} onClick={() => set({ kind: 'icon', value: ic })} aria-label={'Icon ' + ic}>
                {ic}
              </button>
            ))}
          </div>
          <input
            className="cover-input"
            placeholder="Or paste any emoji (Win + .)"
            defaultValue={current.kind === 'icon' && !COVER_ICONS.includes(current.value) ? current.value : ''}
            onChange={(e) => e.target.value.trim() && set({ kind: 'icon', value: e.target.value.trim() })}
          />
        </>
      ) : (
        <>
          <div className="cover-suggest">
            {suggestions.map((s) => (
              <button key={s} className={current.kind === 'text' && current.value === s ? 'on' : ''} onClick={() => set({ kind: 'text', value: s })}>
                {s}
              </button>
            ))}
          </div>
          <input
            className="cover-input"
            maxLength={4}
            placeholder="Up to 4 letters"
            defaultValue={current.kind === 'text' ? current.value : ''}
            onChange={(e) => set({ kind: e.target.value.trim() ? 'text' : null, value: e.target.value.trim() })}
            aria-label="Cover text"
          />
        </>
      )}

      <div className="cover-label">Colour</div>
      <div className="cover-swatches">
        {SOLIDS.map((bg) => (
          <button key={bg} className={current.bg === bg && !current.fg ? 'swatch on' : 'swatch'} style={{ background: bg }} onClick={() => set({ bg, fg: null })} aria-label={'Colour ' + bg} />
        ))}
      </div>
      <div className="cover-label">Colour pairs</div>
      <div className="cover-swatches">
        {PAIRS.map(([bg, fg]) => (
          <button
            key={bg + fg}
            className={current.bg === bg && current.fg === fg ? 'swatch pair on' : 'swatch pair'}
            style={{ background: `linear-gradient(135deg, ${bg} 50%, ${fg} 50%)` }}
            onClick={() => set({ bg, fg })}
            aria-label={`Colour pair ${bg} ${fg}`}
          />
        ))}
        <label className="swatch custom" data-tip="Custom colour" aria-label="Custom colour">
          <input type="color" value={current.bg || '#4f7cf7'} onChange={(e) => set({ bg: e.target.value, fg: null })} />
        </label>
      </div>
      <button className="cover-reset" onClick={() => onChange(null)}>
        Reset to plain board
      </button>
    </div>
  );
}
