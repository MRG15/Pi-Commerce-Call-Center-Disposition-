// Builds a CSV in the browser from the rows on screen and downloads it.
export type CsvColumn<T> = [header: string, value: (row: T) => unknown];

function cell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const lines = [columns.map(c => cell(c[0])).join(','), ...rows.map(r => columns.map(c => cell(c[1](r))).join(','))];
  // BOM so Excel opens ₹ and other non-ASCII text correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
