import { useRef, useState } from 'react';

// Card colour: a background behind the card (around a see-through picture too) or a strip
// across its top. null = no colour (transparent).
export const PALETTE = ['#ffffff', '#5b6170', '#b9bcc2', '#5fd8c8', '#7ed957', '#d98a5c', '#ffd44f', '#ff8f45', '#ff5a52', '#ff73d6', '#a56cf5', '#4fc1ff', '#5a86f7', null];
const RECENT_KEY = 'zb:recent-colors';
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

function recent() {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []).filter(isHex).slice(0, 5);
  } catch {
    return [];
  }
}
function remember(c) {
  if (!isHex(c) || PALETTE.includes(c)) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recent().filter((x) => x !== c)].slice(0, 5)));
  } catch {}
}

export default function ColorPicker({ bg, strip, showStrip = true, onBg, onStrip }) {
  const [tab, setTab] = useState('bg');
  const [recents, setRecents] = useState(recent);
  const customTimer = useRef(0);
  const current = tab === 'bg' ? bg : strip;
  const pick = (c) => {
    remember(c);
    setRecents(recent());
    (tab === 'bg' ? onBg : onStrip)(c);
  };
  const swatch = (c, k) => (
    <button
      key={k}
      className={'cp-swatch' + (c ? '' : ' none') + ((current || null) === c ? ' on' : '')}
      style={c ? { background: c } : undefined}
      onClick={() => pick(c)}
      data-tip={c || 'No colour'}
      aria-label={c ? `Colour ${c}` : 'No colour'}
    />
  );
  return (
    <div className="cp" onPointerDown={(e) => e.stopPropagation()}>
      {showStrip && (
        <div className="cp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'bg'} className={tab === 'bg' ? 'on' : ''} onClick={() => setTab('bg')}>
            <span className="cp-tab-icon bg" style={{ background: isHex(bg) ? bg : undefined }} />
            Background
          </button>
          <button role="tab" aria-selected={tab === 'strip'} className={tab === 'strip' ? 'on' : ''} onClick={() => setTab('strip')}>
            <span className="cp-tab-icon strip">
              <span style={{ background: isHex(strip) ? strip : undefined }} />
            </span>
            Top strip
          </button>
        </div>
      )}
      <div className="cp-grid">{PALETTE.map((c, i) => swatch(c, i))}</div>
      {recents.length > 0 && <div className="cp-grid cp-recent">{recents.map((c) => swatch(c, c))}</div>}
      <label className="cp-custom">
        <span className="cp-wheel" />
        Custom colour…
        <input
          type="color"
          defaultValue={isHex(current) ? current : '#5a86f7'}
          // The system picker reports every drag step; apply once it rests, so one choice is one undo step.
          onChange={(e) => {
            const v = e.target.value.toLowerCase();
            clearTimeout(customTimer.current);
            customTimer.current = setTimeout(() => pick(v), 250);
          }}
          aria-label="Custom colour"
        />
      </label>
    </div>
  );
}
