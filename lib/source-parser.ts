import ExcelJS from 'exceljs';
import path from 'path';

export const AUTHORITATIVE_SHEETS = [
  'Highly interested cx (Umesh)',
  'Highly interested cx (Sheena)',
  'Highly Interested CX (Ashish)',
] as const;

export const EXCLUDED_SHEETS = ['New Remarks (Umesh)','Deep Calling','Sheet5'] as const;
export const TRACKING_SHEETS = ['High Intent Lead','Ashish Calling (Link FB Page)','Technical Issue'] as const;

export type ParsedCall = {
  customerId: string;
  sheet: string;
  row: number;
  sourceCallNum: string;
  sourceType: 'standard_call'|'legacy_followup';
  date: string;
  agentName: string | null;
  statusRaw: string | null;
  whatHappened: string | null;
  remark: string | null;
  sourceKey: string;
};

export type CustomerSeed = {
  customerId: string;
  merchantName?: string | null;
  phone?: string | null;
  category?: string | null;
  subCategory?: string | null;
  funnelStage?: string | null;
  contactPriority?: string | null;
};

export type LegacyFlag = {
  customerId: string;
  sheet: string;
  row: number;
  callOverWa?: string|null;
  entryPointIssue?: string|null;
  insightsIssue?: string|null;
  fbLinkingIssue?: string|null;
  adsCreativeIssue?: string|null;
  paymentIssue?: string|null;
  wantsVisit?: string|null;
  wantsSampleOverWa?: string|null;
  fbPageLinkingPending?: string|null;
  legacyTotalTouches?: string|null;
  legacyLastContact?: string|null;
  legacyCurrentStatus?: string|null;
  raw: Record<string, unknown>;
};

function cellText(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
  if (typeof v === 'object' && 'result' in v) return cellText(v.result);
  return String(v).trim() || null;
}

export function normalizeCustomerId(v: any): string | null {
  const t = cellText(v);
  if (!t) return null;
  const stripped = /^\d+\.0$/.test(t) ? t.slice(0,-2) : t;
  if (!/^\d+$/.test(stripped)) return null;
  return stripped;
}

export function normalizeDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  }
  const t = cellText(v);
  if (!t) return null;
  const slashParts = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashParts) {
    const [,a,b,y] = slashParts;
    const day = Number(a) > 12 ? Number(a) : Number(b) > 12 ? Number(b) : Number(a);
    const month = Number(a) > 12 ? Number(b) : Number(b) > 12 ? Number(a) : Number(b);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  const dashParts = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashParts) {
    const [,a,b,y] = dashParts;
    const day = Number(a) > 12 ? Number(a) : Number(b) > 12 ? Number(b) : Number(a);
    const month = Number(a) > 12 ? Number(b) : Number(b) > 12 ? Number(a) : Number(b);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
  }
  return null;
}

function rowRaw(ws: ExcelJS.Worksheet, rowNum: number) {
  const out: Record<string,unknown> = {};
  const row = ws.getRow(rowNum);
  ws.getRow(1).eachCell({includeEmpty:false}, (cell,col) => {
    const h = cellText(cell.value) || `Column ${col}`;
    out[h] = row.getCell(col).value as any;
  });
  return out;
}

export async function parseWorkbook(filePath = path.join(process.cwd(),'source','Disposition Sheet - Sellers.xlsx')) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const customers = new Map<string,CustomerSeed>();
  const flags: LegacyFlag[] = [];
  const rawCalls: ParsedCall[] = [];
  const countsBySheet: Record<string,{customers:Set<string>,standard:number,followup:number}> = {};

  for (const sheetName of AUTHORITATIVE_SHEETS) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) throw new Error(`Missing authoritative sheet: ${sheetName}`);
    const isAshish = sheetName.includes('Ashish');
    const isSheena = sheetName.includes('Sheena');
    countsBySheet[sheetName] = {customers:new Set(),standard:0,followup:0};

    const customerCol = isAshish ? 14 : 3;
    const currentStatusCol = isAshish ? 2 : 4;
    const totalTouchesCol = isAshish ? 3 : 5;
    const lastContactCol = isAshish ? 4 : 6;

    for (let r=2; r<=ws.rowCount; r++) {
      const customerId = normalizeCustomerId(ws.getRow(r).getCell(customerCol).value);
      if (!customerId) continue;
      countsBySheet[sheetName].customers.add(customerId);

      const seed: CustomerSeed = {customerId};
      if (isAshish) {
        seed.merchantName = cellText(ws.getRow(r).getCell(12).value);
        seed.phone = cellText(ws.getRow(r).getCell(13).value);
        seed.category = cellText(ws.getRow(r).getCell(15).value);
        seed.subCategory = cellText(ws.getRow(r).getCell(16).value);
        seed.funnelStage = cellText(ws.getRow(r).getCell(17).value);
        seed.contactPriority = cellText(ws.getRow(r).getCell(18).value);
      }
      const existing = customers.get(customerId) || {customerId};
      customers.set(customerId, {
        customerId,
        merchantName: existing.merchantName || seed.merchantName || null,
        phone: existing.phone || seed.phone || null,
        category: existing.category || seed.category || null,
        subCategory: existing.subCategory || seed.subCategory || null,
        funnelStage: existing.funnelStage || seed.funnelStage || null,
        contactPriority: existing.contactPriority || seed.contactPriority || null,
      });

      const start = isAshish ? 19 : 16;
      for (let n=1; n<=7; n++) {
        let dateCol:number, whatCol:number|null, remarkCol:number, statusCol:number;
        if (isAshish && n >= 5) {
          dateCol = 35 + (n-5)*3; whatCol = null; remarkCol = dateCol+1; statusCol = dateCol+2;
        } else {
          dateCol = start + (n-1)*4; whatCol = dateCol+1; remarkCol = dateCol+2; statusCol = dateCol+3;
        }
        const date = normalizeDate(ws.getRow(r).getCell(dateCol).value);
        if (!date) continue;
        const agentName = isAshish ? 'Ashish' : (cellText(ws.getRow(r).getCell(2).value) || (isSheena ? 'Sheena' : 'Umesh'));
        rawCalls.push({
          customerId, sheet:sheetName, row:r, sourceCallNum:`Call ${n}`, sourceType:'standard_call', date,
          agentName,
          statusRaw:cellText(ws.getRow(r).getCell(statusCol).value),
          whatHappened:whatCol ? cellText(ws.getRow(r).getCell(whatCol).value) : null,
          remark:cellText(ws.getRow(r).getCell(remarkCol).value),
          sourceKey:`${sheetName}|${r}|CALL${n}`,
        });
        countsBySheet[sheetName].standard++;
      }

      if (isSheena) {
        for (let n=1; n<=3; n++) {
          const dateCol = 44 + (n-1)*2;
          const remarkCol = dateCol+1;
          const date = normalizeDate(ws.getRow(r).getCell(dateCol).value);
          if (!date) continue;
          rawCalls.push({
            customerId, sheet:sheetName, row:r, sourceCallNum:`Callback ${n}`, sourceType:'legacy_followup', date,
            agentName:cellText(ws.getRow(r).getCell(2).value) || 'Sheena', statusRaw:null, whatHappened:null,
            remark:cellText(ws.getRow(r).getCell(remarkCol).value), sourceKey:`${sheetName}|${r}|CB${n}`,
          });
          countsBySheet[sheetName].followup++;
        }
      }

      const f: LegacyFlag = isAshish ? {
        customerId,sheet:sheetName,row:r,
        entryPointIssue:cellText(ws.getRow(r).getCell(5).value),
        insightsIssue:cellText(ws.getRow(r).getCell(6).value),
        fbLinkingIssue:cellText(ws.getRow(r).getCell(7).value),
        paymentIssue:cellText(ws.getRow(r).getCell(8).value),
        adsCreativeIssue:cellText(ws.getRow(r).getCell(9).value),
        wantsVisit:cellText(ws.getRow(r).getCell(10).value),
        wantsSampleOverWa:cellText(ws.getRow(r).getCell(11).value),
        legacyTotalTouches:cellText(ws.getRow(r).getCell(totalTouchesCol).value),
        legacyLastContact:cellText(ws.getRow(r).getCell(lastContactCol).value),
        legacyCurrentStatus:cellText(ws.getRow(r).getCell(currentStatusCol).value), raw:rowRaw(ws,r),
      } : {
        customerId,sheet:sheetName,row:r,
        callOverWa:cellText(ws.getRow(r).getCell(7).value),
        entryPointIssue:cellText(ws.getRow(r).getCell(8).value),
        insightsIssue:cellText(ws.getRow(r).getCell(9).value),
        fbLinkingIssue:cellText(ws.getRow(r).getCell(10).value),
        adsCreativeIssue:cellText(ws.getRow(r).getCell(11).value),
        paymentIssue:cellText(ws.getRow(r).getCell(12).value),
        wantsVisit:cellText(ws.getRow(r).getCell(13).value),
        wantsSampleOverWa:cellText(ws.getRow(r).getCell(14).value),
        fbPageLinkingPending:cellText(ws.getRow(r).getCell(15).value),
        legacyTotalTouches:cellText(ws.getRow(r).getCell(totalTouchesCol).value),
        legacyLastContact:cellText(ws.getRow(r).getCell(lastContactCol).value),
        legacyCurrentStatus:cellText(ws.getRow(r).getCell(currentStatusCol).value), raw:rowRaw(ws,r),
      };
      flags.push(f);
    }
  }

  const sourceRank: Record<string,number> = {
    'Highly interested cx (Umesh)': 1,
    'Highly interested cx (Sheena)': 2,
    'Highly Interested CX (Ashish)': 3,
  };
  const callNumRank = (x:string) => {
    const m=x.match(/(\d+)/); return m ? Number(m[1]) : 99;
  };
  const typeRank = (x:ParsedCall['sourceType']) => x === 'standard_call' ? 0 : 1;

  rawCalls.sort((a,b) => a.customerId.localeCompare(b.customerId) || a.date.localeCompare(b.date) ||
    (sourceRank[a.sheet]-sourceRank[b.sheet]) || typeRank(a.sourceType)-typeRank(b.sourceType) ||
    callNumRank(a.sourceCallNum)-callNumRank(b.sourceCallNum) || a.row-b.row);

  const numbered = rawCalls.map(c => ({...c, attemptNumber:0, callSeq:0}));
  let lastCustomer=''; let attempt=0; let lastDate=''; let seq=0;
  for (const c of numbered) {
    if (c.customerId !== lastCustomer) { lastCustomer=c.customerId; attempt=0; lastDate=''; seq=0; }
    attempt++;
    if (c.date !== lastDate) { lastDate=c.date; seq=1; } else seq++;
    c.attemptNumber=attempt; c.callSeq=seq;
  }

  return { workbook:wb, customers:[...customers.values()], calls:numbered, flags, countsBySheet };
}
