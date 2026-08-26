import type postgres from 'postgres';

const tree: Record<string, any> = {
  'Interested': {
    'Payment done': [],
    'Callback — mid-pitch': [],
    'Taken to WhatsApp for closure': ['Enrolled via WhatsApp','Technical blocker (see remark)','Creative not satisfactory','Callback needed'],
    'Technical blocker': ['Pi icon not visible in P4B','Blank / non-loading home page','Facebook login failing','No Facebook business page','Facebook page link failing','Ad not being generated','Payment not processing'],
    'Pricing concern': ['₹799 too high','Wants free trial','No recurring subscription','Pay-per-spend only','Unclear what fee covers','Cheaper agency'],
    'Creative not satisfactory': ['Image not relevant','Text/language wrong','Wants to upload own','Wants more variants','Logo/brand issue'],
    'Wants assisted support / field visit': [],
    'CX on Process': [],
  },
  'Not Interested': {
    'No need for advertising': [],
    'Already advertising (self/agency)': [],
    'Price too high': [],
    "Doesn't trust / suspects fraud": [],
    'Not active on FB/IG': [],
    'Prior Paytm grievance': ['Soundbox issue','Settlement/payout issue','Billing/refund dispute','Other Paytm grievance'],
    'Business type not suited': [],
    'Declined without reason': [],
  },
  'Callback — pre-pitch': {
    'Customer at counter': [],
    'Asked for specific time': [],
    'Driving / travelling': [],
    'Language mismatch': [],
    'Owner not available': [],
  },
  'Wrong contact / not operational': {
    'Wrong number': [],
    'Different business': [],
    'Business shut down': [],
    'Employee, not decision-maker': [],
  },
  'Voicemail': {},
  'Disconnected': {},
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,80);

export async function seedDispositions(sql: postgres.Sql) {
  async function upsert(code: string, label: string, level: number, parentId: string | null, sort: number) {
    const rows = await sql`
      INSERT INTO disposition_nodes (code,label,level,parent_id,sort_order,active)
      VALUES (${code},${label},${level},${parentId}::uuid,${sort},TRUE)
      ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, parent_id=EXCLUDED.parent_id, sort_order=EXCLUDED.sort_order, active=TRUE, updated_at=now()
      RETURNING id
    `;
    return String(rows[0].id);
  }

  let i0=0;
  for (const [l0, l1s] of Object.entries(tree)) {
    const l0id = await upsert(`l0_${slug(l0)}`, l0, 0, null, i0++);
    let i1=0;
    for (const [l1, l2s] of Object.entries(l1s as Record<string,string[]>)) {
      const l1id = await upsert(`l1_${slug(l0)}__${slug(l1)}`, l1, 1, l0id, i1++);
      let i2=0;
      for (const l2 of l2s) {
        await upsert(`l2_${slug(l0)}__${slug(l1)}__${slug(l2)}`, l2, 2, l1id, i2++);
      }
    }
  }
}
