// Two-level sorting shared by the onboarding and CSM lists.
export type SortDir = 'desc' | 'asc';
export type SortState<K extends string> = { by: K | ''; dir: SortDir; by2: K | ''; dir2: SortDir };
export const NO_SORT = { by: '', dir: 'desc', by2: '', dir2: 'desc' } as const;

type Level<T> = { value: (row: T) => number | string | null; dir: SortDir };

// Sorts by each level in turn; empty values always go last. Returns rows unchanged with no levels.
export function multiSort<T>(rows: T[], levels: Level<T>[]): T[] {
  if (!levels.length) return rows;
  return [...rows].sort((a, b) => {
    for (const l of levels) {
      const x = l.value(a), y = l.value(b);
      const xe = x === null || x === '', ye = y === null || y === '';
      if (xe && ye) continue;
      if (xe) return 1;
      if (ye) return -1;
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (d) return l.dir === 'desc' ? -d : d;
    }
    return 0;
  });
}
