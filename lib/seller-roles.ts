// Seller team structure (BDE / SBDE / TL) from the seller_roles table. Each row is a change
// that applies from effective_from; the row in force on a date is the latest one on or before it.

export type SellerRole = 'BDE'|'SBDE'|'TL'|'NONE';
export type SellerRoleRow = { person:string; role:SellerRole; teamLead:string|null; effectiveFrom:string };

export function roleOn(rows:SellerRoleRow[],person:string,date:string):SellerRoleRow|null{
  let hit:SellerRoleRow|null=null;
  for(const r of rows) if(r.person===person && r.effectiveFrom<=date && (!hit||r.effectiveFrom>hit.effectiveFrom)) hit=r;
  return hit&&hit.role!=='NONE'?hit:null;
}

export async function loadSellerRoles(sql:any):Promise<SellerRoleRow[]>{
  const exists=await sql`SELECT to_regclass('public.seller_roles') IS NOT NULL AS ok`;
  if(!exists[0]?.ok) return [];
  const rows=await sql`
    SELECT a.name AS person,r.role,l.name AS team_lead,r.effective_from::text AS effective_from
    FROM seller_roles r JOIN agents a ON a.id=r.agent_id LEFT JOIN agents l ON l.id=r.team_lead_id
    ORDER BY r.effective_from
  `;
  return rows.map((r:any)=>({person:r.person,role:r.role,teamLead:r.team_lead||null,effectiveFrom:r.effective_from}));
}
