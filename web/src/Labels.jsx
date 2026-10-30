import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './icons.jsx';

// Labels are short names on cards. Each name always gets the same colour.
const LABEL_COLORS = ['#c45ba0', '#e2553f', '#d97a2b', '#b58a12', '#3f9b5e', '#2f9a9c', '#4f6fd8', '#8a5cc9'];
export function labelColor(name) {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}
// Same rule as the server: a label is also the #tag with spaces as dashes.
export const labelTag = (label) => String(label).trim().toLowerCase().replace(/\s+/g, '-');

// Chips on a card. They are tag chips, so clicking one searches for it.
export function LabelChips({ labels }) {
  if (!labels?.length) return null;
  return (
    <div className="card-labels">
      {labels.map((l) => (
        <span key={l} className="label-chip tag-chip" data-tag={labelTag(l)} style={{ background: labelColor(l) }} title={`Find cards labelled “${l}”`}>
          {l}
        </span>
      ))}
    </div>
  );
}

// Pick labels for the selection. `current` maps label -> 'all' | 'some'.
export default function LabelPicker({ current, onToggle, onClose }) {
  const [known, setKnown] = useState([]);
  const [q, setQ] = useState('');
  const input = useRef(null);
  useEffect(() => {
    api('GET', '/api/labels')
      .then((r) => setKnown(r.labels.map((x) => x.label)))
      .catch(() => {});
    input.current?.focus();
  }, []);
  const all = useMemo(() => [...new Set([...Object.keys(current), ...known])], [current, known]);
  const term = q.trim().toLowerCase();
  const shown = term ? all.filter((l) => l.toLowerCase().includes(term)) : all;
  const exact = all.some((l) => l.toLowerCase() === term);

  const add = () => {
    const name = q.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!name) return;
    const existing = all.find((l) => l.toLowerCase() === name.toLowerCase());
    onToggle(existing || name, true);
    setQ('');
  };

  return (
    <div className="label-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="label-search">
        <Icon name="search" size={15} />
        <input
          ref={input}
          value={q}
          placeholder="Find or create a label"
          aria-label="Find or create a label"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            else if (e.key === 'Escape') onClose();
          }}
        />
      </div>
      <div className="label-list scrolls">
        {shown.map((l) => (
          <button key={l} className={'label-row' + (current[l] ? ' on' : '')} onClick={() => onToggle(l, current[l] !== 'all')} aria-label={'Label ' + l} aria-pressed={current[l] === 'all'}>
            <span className="label-check">{current[l] === 'all' ? '✓' : current[l] === 'some' ? '–' : ''}</span>
            <span className="label-chip" style={{ background: labelColor(l) }}>
              {l}
            </span>
          </button>
        ))}
        {term && !exact && (
          <button className="label-row label-new" onClick={add}>
            <Icon name="plus" size={14} /> Create “{q.trim().slice(0, 30)}”
          </button>
        )}
        {!shown.length && !term && <div className="label-empty">No labels yet. Type a name and press Enter.</div>}
      </div>
    </div>
  );
}
