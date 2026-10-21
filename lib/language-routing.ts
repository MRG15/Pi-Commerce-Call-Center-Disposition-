// Language barrier routing to the onboarders ticked "Language" in Teams (onboarding_lb_roster).
//   Southern cases – Sub Raw's communication address is in Karnataka, Kerala, Tamil Nadu, Andhra
//                    Pradesh, Telangana, Puducherry or Lakshadweep (state, else PIN zone 5/6; so
//                    never Maharashtra). Cases created from LB_ROUTING_FROM are moved to the language
//                    team once, at the Sub Raw sync; later moves are manual.
//   Language cases – southern cases plus any case ever tagged Language Barrier. They stay out of the
//                    regular backlog rebalance; the 8:30 AM rebalance moves the ones held by anyone
//                    else to the language team and evens out the language team's no-talk ones.
import { todayIst } from './plans';

export const LB_ROUTING_FROM='2026-10-22T00:00:00+05:30';

const SOUTH=['karnataka','kerala','tamil nadu','tamilnadu','andhra pradesh','telangana','puducherry','pondicherry','lakshadweep'];
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z]+/g,' ').trim();

// State and south flag from a communication address (JSON like {"state":..,"zipcode":..} or text).
export function regionOf(raw:unknown):{state:string|null;south:boolean|null}{
  const text=String(raw??'').trim();
  if(!text) return {state:null,south:null};
  let state:string|null=null,pin:string|null=null;
  try{
    const j=JSON.parse(text);
    if(j&&typeof j==='object'){
      state=String(j.state??'').trim()||null;
      pin=String(j.zipcode??j.pincode??j.pin??'').replace(/\D/g,'')||null;
    }
  }catch{
    const pins=text.match(/\b[1-9]\d{5}\b/g);
    pin=pins?pins[pins.length-1]:null;
    if(!pin){ const n=norm(text); const hit=SOUTH.find(s=>n.includes(s)); if(hit) state=hit.replace(/\b\w/g,c=>c.toUpperCase()); }
  }
  if(state) return {state,south:SOUTH.includes(norm(state))};
  if(pin&&pin.length===6) return {state:`PIN ${pin}`,south:pin[0]==='5'||pin[0]==='6'};
  return {state:null,south:null};
}

// SQL condition for a language case (c = onboarding_cases).
export function languageCaseSql(sql:any){
  return sql`(c.language_barrier_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM onboarding_events lb WHERE lb.onboarding_case_id=c.id AND (lb.l1_code='OB_LANGUAGE_BARRIER' OR lb.l2_code='OB_LANGUAGE_BARRIER'))
    OR (c.sub_south IS TRUE AND c.created_at>=${LB_ROUTING_FROM}::timestamptz))`;
}

// Ticked onboarders who are on the Onboarding team today, with their open-case counts.
export async function loadLanguageTeam(sql:any):Promise<{id:string;name:string;open:number}[]>{
  const today=todayIst();
  const rows=await sql`
    WITH m AS (
      SELECT DISTINCT ON (t.agent_id) t.agent_id,t.member FROM team_changes t
      WHERE t.team='onboarding' AND t.effective_from<=${today}::date ORDER BY t.agent_id,t.effective_from DESC,t.id DESC
    )
    SELECT a.id,a.name,(SELECT count(*)::int FROM onboarding_cases c WHERE c.assigned_to=a.id AND c.current_status='open') AS open
    FROM onboarding_lb_roster r JOIN agents a ON a.id=r.agent_id
    JOIN m ON m.agent_id=a.id AND m.member
    JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding'
    WHERE a.active=TRUE
  `;
  return rows.map((r:any)=>({id:String(r.id),name:r.name,open:Number(r.open)}));
}

async function moveCase(sql:any,c:any,to:{id:string;name:string},remark:string,markRouted=false){
  return sql.begin(async(tx:any)=>{
    const upd=await tx`UPDATE onboarding_cases SET assigned_to=${to.id}::uuid,assigned_at=now(),updated_at=now(),
        lb_routed_at=CASE WHEN ${markRouted} THEN now() ELSE lb_routed_at END
      WHERE id=${c.id} AND current_status='open' AND assigned_to IS NOT DISTINCT FROM ${c.assigned_to} RETURNING id`;
    if(!upd[0]) return false;
    const n=(await tx`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${c.id}`)[0].n;
    await tx`INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
      VALUES(${c.id},${c.customer_id},${n},'Language routing','assignment','SYSTEM_REASSIGNED','Reassigned',${remark})`;
    return true;
  });
}

const fewest=(team:{id:string;name:string;open:number}[])=>[...team].sort((a,b)=>a.open-b.open||a.name.localeCompare(b.name))[0];

// Sub Raw sync: each new southern case goes to the language team once (whoever has the fewest open
// cases). Cases already with a language onboarder are only marked. With no one ticked, nothing is
// marked, so the cases are picked up once someone is.
export async function routeSouthernCases(sql:any){
  const team=await loadLanguageTeam(sql);
  if(!team.length) return {routed:0,note:'No language onboarders ticked'};
  const ids=new Set(team.map(t=>t.id));
  const cases=await sql`
    SELECT c.id,c.customer_id,c.assigned_to,c.sub_state FROM onboarding_cases c
    WHERE c.current_status='open' AND c.sub_south IS TRUE AND c.lb_routed_at IS NULL
      AND c.created_at>=${LB_ROUTING_FROM}::timestamptz
    ORDER BY c.created_at
  `;
  let routed=0,kept=0;
  for(const c of cases){
    if(c.assigned_to&&ids.has(String(c.assigned_to))){
      await sql`UPDATE onboarding_cases SET lb_routed_at=now() WHERE id=${c.id}`; kept++; continue;
    }
    const to=fewest(team);
    const ok=await moveCase(sql,c,to,`Reassigned to ${to.name}: southern state (${c.sub_state||'address'}), language barrier routing at the Sub Raw sync`,true);
    if(ok){ to.open++; routed++; }
  }
  return {routed,kept};
}

// 8:30 AM: language cases held by anyone outside the language team move to it; the language team's
// no-talk language cases are evened out among them. Fewest language cases first.
export async function rebalanceLanguageCases(sql:any){
  const team=await loadLanguageTeam(sql);
  if(!team.length) return {moved:0,note:'No language onboarders ticked'};
  const today=todayIst();
  const ids=new Set(team.map(t=>t.id));
  const cases=await sql`
    SELECT c.id,c.customer_id,c.assigned_to,COALESCE(c.last_activity_at,c.created_at) AS touched,
      ((c.created_at AT TIME ZONE 'Asia/Kolkata')::date<${today}::date
        AND (last.l0_code IS NULL OR last.l0_code='OB_NOT_CONNECTED')
        AND (c.next_callback_at IS NULL OR c.next_callback_at<=now())) AS no_talk
    FROM onboarding_cases c
    LEFT JOIN LATERAL (
      SELECT e.l0_code FROM onboarding_events e
      WHERE e.onboarding_case_id=c.id AND e.source_type IN ('new_event','historical_import')
      ORDER BY e.event_time DESC,e.attempt_number DESC LIMIT 1
    ) last ON TRUE
    WHERE c.current_status='open' AND c.assigned_to IS NOT NULL AND ${languageCaseSql(sql)}
    ORDER BY touched ASC
  `;
  const held=new Map<string,any[]>(team.map(t=>[t.id,[]]));
  const pool:any[]=[];
  for(const c of cases){
    const owner=String(c.assigned_to);
    if(ids.has(owner)) held.get(owner)!.push(c); else pool.push(c);
  }
  const target=Math.ceil(cases.length/team.length);
  // Above the even share: oldest-touched no-talk cases go back into the pool.
  for(const list of held.values()){
    let extra=list.length-target;
    for(let i=0;i<list.length&&extra>0;){ if(list[i].no_talk){ pool.push(list.splice(i,1)[0]); extra--; } else i++; }
  }
  pool.sort((a,b)=>new Date(a.touched).getTime()-new Date(b.touched).getTime());
  let moved=0;
  for(const c of pool){
    const to=[...team].sort((a,b)=>held.get(a.id)!.length-held.get(b.id)!.length||a.name.localeCompare(b.name))[0];
    held.get(to.id)!.push(c);
    if(String(c.assigned_to)===to.id) continue;
    if(await moveCase(sql,c,to,`Reassigned to ${to.name} by the 8:30 AM language barrier rebalance`)) moved++;
  }
  return {moved,languageCases:cases.length,after:Object.fromEntries(team.map(t=>[t.name,held.get(t.id)!.length]))};
}
