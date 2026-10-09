'use client';
import type { SortDir, SortState } from '@/lib/sort';

// "Sort by [x] [↓ Highest first]  then by [y] [↓ Newest first]". The second level appears only
// once a first sort is chosen; each direction is a small toggle button.
export default function SortPicker<K extends string>({ options, value, onChange, dateKeys = [] }: {
  options: [K, string][]; value: SortState<K>; onChange: (v: SortState<K>) => void; dateKeys?: K[];
}) {
  const label = (k: K | '', d: SortDir) => dateKeys.includes(k as K) ? (d === 'desc' ? 'Newest first' : 'Oldest first') : (d === 'desc' ? 'Highest first' : 'Lowest first');
  const flip = (d: SortDir): SortDir => (d === 'desc' ? 'asc' : 'desc');
  return <div className="sort-picker">
    <select value={value.by} onChange={e => onChange({ ...value, by: e.target.value as K | '', by2: value.by2 === e.target.value ? '' : value.by2 })}>
      <option value="">Default order</option>
      {options.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
    </select>
    {value.by && <button type="button" className="sort-dir" onClick={() => onChange({ ...value, dir: flip(value.dir) })}>{value.dir === 'desc' ? '↓' : '↑'} {label(value.by, value.dir)}</button>}
    {value.by && <select value={value.by2} onChange={e => onChange({ ...value, by2: e.target.value as K | '' })}>
      <option value="">Then by: —</option>
      {options.filter(([k]) => k !== value.by).map(([k, l]) => <option key={k} value={k}>Then by: {l}</option>)}
    </select>}
    {value.by && value.by2 && <button type="button" className="sort-dir" onClick={() => onChange({ ...value, dir2: flip(value.dir2) })}>{value.dir2 === 'desc' ? '↓' : '↑'} {label(value.by2, value.dir2)}</button>}
  </div>;
}
