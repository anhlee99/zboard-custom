// Small stroke icons, 24x24 grid.
const PATHS = {
  note: 'M5 3h10l4 4v14H5z M15 3v4h4 M8 11h8 M8 15h8',
  todo: 'M4 6l2 2 3-3 M4 13l2 2 3-3 M12 7h8 M12 14h8 M4 20h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  board: 'M3 4h18v16H3z M3 9h18 M9 9v11',
  column: 'M4 3h7v18H4z M13 3h7v11h-7z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  copy: 'M8 8h12v12H8z M16 8V4H4v12h4',
  front: 'M8 8h12v12H8z M4 4h10v2 M4 4v10h2',
  open: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.1.9-2 2-2H17a4 4 0 0 0 4-4c0-4.1-4-7.2-9-7.2z M7.5 11.5h.01 M9.5 7.5h.01 M14.5 7.5h.01',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7z M7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8 M6 20h8 M14 4l-4 16',
  underline: 'M7 4v7a5 5 0 0 0 10 0V4 M5 20h14',
  strike: 'M5 12h14 M16 6a4 3 0 0 0-4-2c-2.5 0-4 1.3-4 3 0 4 8 3 8 7 0 1.7-1.5 3-4 3a4 3 0 0 1-4-2',
  heading: 'M6 4v16 M18 4v16 M6 12h12',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  camera: 'M4 7h4l2-3h4l2 3h4v13H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  x: 'M6 6l12 12 M18 6L6 18',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  check: 'M5 12l5 5 9-10',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  home: 'M3 11l9-7 9 7 M5 10v10h14V10',
  inbox: 'M3 13h5l2 3h4l2-3h5 M5 5h14l2 8v7H3v-7z',
};

export function Icon({ name, size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
