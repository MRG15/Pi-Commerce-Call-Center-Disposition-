import { normalizeStatus } from './status';

export type AnalyticsBucket =
  | 'CONNECTED'
  | 'NOT_CONNECTED'
  | 'CALLBACK'
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'PAYMENT_DONE'
  | 'PAYMENT_ISSUE'
  | 'TECHNICAL_ISSUE'
  | 'WHATSAPP_HANDOFF'
  | 'FB_LINKING_ISSUE'
  | 'VISIT_REQUESTED';

function parts(r:any) {
  return [r.l0_label_snapshot,r.l1_label_snapshot,r.l2_label_snapshot,r.status_raw]
    .filter(Boolean)
    .map((v:string)=>normalizeStatus(v))
    .filter(Boolean) as string[];
}

function hasExact(p:string[], values:string[]) {
  return p.some(v=>values.includes(v));
}

export function classifyCall(r:any): Set<AnalyticsBucket> {
  const p=parts(r);
  const out=new Set<AnalyticsBucket>();

  const nonConnected=hasExact(p,['call not picked','voice mail','voicemail']);
  if(nonConnected) out.add('NOT_CONNECTED'); else if(p.length) out.add('CONNECTED');

  if(p.some(v=>v.includes('callback')||v==='call back')) out.add('CALLBACK');

  const notInterested=p.some(v=>v==='not interested' || v.includes('not interested'));
  if(notInterested) out.add('NOT_INTERESTED');
  const interested=!notInterested && (hasExact(p,['interested','cx on process']) || p.some(v=>v.includes('interested')));
  if(interested) out.add('INTERESTED');

  if(hasExact(p,['payment done'])) out.add('PAYMENT_DONE');

  const paymentIssue=hasExact(p,['payment not processing','payment issue']);
  if(paymentIssue) out.add('PAYMENT_ISSUE');

  const technicalIssue=paymentIssue || hasExact(p,[
    'technical blocker',
    'technical blocker (see remark)',
    'pi icon not visible in p4b',
    'blank / non-loading home page',
    'facebook login failing',
    'no facebook business page',
    'facebook page link failing',
    'ad not being generated'
  ]);
  if(technicalIssue) out.add('TECHNICAL_ISSUE');

  if(hasExact(p,['taken to whatsapp for closure','enrolled via whatsapp']) || r.whatsapp_handoff===true) out.add('WHATSAPP_HANDOFF');
  if(hasExact(p,['facebook login failing','no facebook business page','facebook page link failing','fb linking issue','facebook linking issue'])) out.add('FB_LINKING_ISSUE');
  if(p.some(v=>v.includes('field visit'))) out.add('VISIT_REQUESTED');

  return out;
}

export function hasBucket(r:any,bucket:AnalyticsBucket){return classifyCall(r).has(bucket);}
