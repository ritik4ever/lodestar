function icon(size: number, paths: React.ReactElement | React.ReactElement[]) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths}
    </svg>
  );
}

export function EmptyRegistryIcon() {
  return icon(40, [
    <path key="body" d="M4 7l8-3 8 3v10l-8 3-8-3V7z" />,
    <polyline key="line1" points="4 7 12 10 20 7" />,
    <line key="line2" x1="12" y1="10" x2="12" y2="20" />,
    <line key="line3" x1="8" y1="8.5" x2="8" y2="14.5" />,
  ]);
}

export function EmptyAgentsIcon() {
  return icon(40, [
    <circle key="head" cx="12" cy="8" r="4.5" />,
    <path key="body" d="M3 21c0-4.5 4-8 9-8s9 3.5 9 8" />,
    <path key="plus" d="M12 6v4m-2-2h4" strokeWidth={2} />,
  ]);
}

export function SearchEmptyIcon() {
  return icon(40, [
    <circle key="lens" cx="10.5" cy="10.5" r="6.5" />,
    <line key="handle" x1="15.5" y1="15.5" x2="21" y2="21" />,
    <line key="dash1" x1="7" y1="10.5" x2="14" y2="10.5" strokeWidth={2} />,
  ]);
}

export function CategoryEmptyIcon() {
  return icon(40, [
    <rect key="box" x="3" y="3" width="18" height="18" rx="2" />,
    <line key="h1" x1="8" y1="9" x2="16" y2="9" />,
    <line key="h2" x1="8" y1="13" x2="14" y2="13" />,
    <line key="h3" x1="8" y1="17" x2="12" y2="17" />,
    <circle key="star" cx="18" cy="17" r="2" />,
  ]);
}
