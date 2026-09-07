import type { ReactElement } from 'react';
import { CATEGORIES, normalizeCategory, type Category } from './categories';

export interface CategoryMeta {
  label: string;
  icon: ReactElement;
  badgeClass: string;
}

function categoryIcon(category: string, paths: ReactElement | ReactElement[]) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0"
      data-category-icon={category}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      {paths}
    </svg>
  );
}

export const CATEGORY_ICONS: Record<Category, ReactElement> = {
  search: categoryIcon('search', [
    <circle key="lens" cx="11" cy="11" r="6" />,
    <path key="handle" d="m16 16 4 4" />,
  ]),
  weather: categoryIcon('weather', [
    <circle key="sun" cx="12" cy="12" r="4" />,
    <path key="rays" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />,
  ]),
  finance: categoryIcon('finance', [
    <path key="card" d="M4 7h16v10H4z" />,
    <path key="stripe" d="M4 10h16" />,
    <path key="detail" d="M8 15h4" />,
  ]),
  ai: categoryIcon('ai', [
    <rect key="chip" x="7" y="7" width="10" height="10" rx="2" />,
    <path key="pins" d="M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4" />,
  ]),
  data: categoryIcon('data', [
    <ellipse key="top" cx="12" cy="6" rx="7" ry="3" />,
    <path key="body" d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />,
    <path key="middle" d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />,
  ]),
  compute: categoryIcon('compute', [
    <rect key="core" x="8" y="8" width="8" height="8" rx="1" />,
    <path key="pins" d="M4 10h4m-4 4h4m12-4h-4m4 4h-4M10 4v4m4-4v4m-4 12v-4m4 4v-4" />,
  ]),
};

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  search: {
    label: 'Search',
    icon: CATEGORY_ICONS.search,
    badgeClass: 'bg-blue-50 text-blue-700',
  },
  weather: {
    label: 'Weather',
    icon: CATEGORY_ICONS.weather,
    badgeClass: 'bg-sky-50 text-sky-700',
  },
  finance: {
    label: 'Finance',
    icon: CATEGORY_ICONS.finance,
    badgeClass: 'bg-emerald-50 text-emerald-700',
  },
  ai: {
    label: 'AI',
    icon: CATEGORY_ICONS.ai,
    badgeClass: 'bg-violet-50 text-violet-700',
  },
  data: {
    label: 'Data',
    icon: CATEGORY_ICONS.data,
    badgeClass: 'bg-amber-50 text-amber-700',
  },
  compute: {
    label: 'Compute',
    icon: CATEGORY_ICONS.compute,
    badgeClass: 'bg-rose-50 text-rose-700',
  },
};

const UNKNOWN_CATEGORY_META: CategoryMeta = {
  label: 'Unknown',
  icon: categoryIcon('unknown', [
    <circle key="circle" cx="12" cy="12" r="8" />,
    <path key="mark" d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" />,
    <path key="dot" d="M12 17h.01" />,
  ]),
  badgeClass: 'bg-gray-50 text-gray-700',
};

export const CATEGORY_FILTERS: { label: string; value: Category | 'all' }[] = [
  { label: 'All', value: 'all' },
  ...CATEGORIES.map((value) => ({
    label: CATEGORY_META[value].label,
    value,
  })),
];

export function getCategoryMeta(category: Category | string | undefined): CategoryMeta {
  const normalized = category ? normalizeCategory(category) : undefined;
  if (normalized && Object.hasOwn(CATEGORY_META, normalized)) {
    return CATEGORY_META[normalized];
  }

  return UNKNOWN_CATEGORY_META;
}
