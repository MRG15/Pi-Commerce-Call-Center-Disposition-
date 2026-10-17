// Onboarding backlog rebalance, once a day at 8:30 AM IST.
//   Live team    = Onboarding team members with "New cases" on (onboarding_roster): they get new
//                  cases in real time.
//   Backlog team = everyone else on the Onboarding team (as in Teams; any onboarding access, active).
//   "No talk yet" = an open case from before today that was never called, or whose latest call is
//                  Not Connected, with no callback booked for later and never tagged Language Barrier.
// The live team's no-talk cases move to the backlog team, and the backlog team's no-talk cases are
// evened out so each person holds the same number, up to BACKLOG_CAP each. People keep their own
// cases first; only the excess moves, oldest-touched first going to whoever has the fewest. If the
// backlog team is full, the rest stay where they are. Each move is logged on the case.
import { todayIst } from './plans';

export const BACKLOG_CAP=10;

export async function rebalanceOnboardingBacklog(sql:any){
  const today=todayIst();
  const team=await sql`
    WITH m AS (
      SELECT DISTINCT ON (t.agent_id) t.agent_id,t.member FROM team_changes t
      WHERE t.team='onboarding' AND t.effective_from<=${today}::date ORDER BY t.agent_id,t.effective_from DESC,t.id DESC
    )
    SELECT a.id,a.name,EXISTS(SELECT 1 FROM onboarding_roster r WHERE r.agent_id=a.id) AS live
    FROM m JOIN agents a ON a.id=m.agent_id
    JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding'
    WHERE m.member AND a.active=TRUE
  `;
  const backlog=team.filter((p:any)=>!p.live).map((p:any)=>({id:String(p.id),name:p.name,cases:[] as any[]}));
  if(!backlog.length) return {moved:0,note:'No backlog team'};
  const liveIds=new Set(team.filter((p:any)=>p.live).map((p:any)=>String(p.id)));
  const cases=await sql`
    SELECT c.id,c.customer_id,c.assigned_to,COALESCE(c.last_activity_at,c.created_at) AS touched
    FROM onboarding_cases c
    LEFT JOIN LATERAL (
      SELECT e.l0_code FROM onboarding_events e
      WHERE e.onboarding_case_id=c.id AND e.source_type IN ('new_event','historical_import')
      ORDER BY e.event_time DESC,e.attempt_number DESC LIMIT 1
    ) last ON TRUE
    WHERE c.current_status='open' AND c.assigned_to IS NOT NULL
      AND (c.created_at AT TIME ZONE 'Asia/Kolkata')::date<${today}::date
      AND (last.l0_code IS NULL OR last.l0_code='OB_NOT_CONNECTED')
      AND (c.next_callback_at IS NULL OR c.next_callback_at<=now())
      -- Ever tagged Language Barrier: stays with its owner (who may speak the merchant's language).
      AND c.language_barrier_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM onboarding_events lb WHERE lb.onboarding_case_id=c.id AND (lb.l1_code='OB_LANGUAGE_BARRIER' OR lb.l2_code='OB_LANGUAGE_BARRIER'))
    ORDER BY touched ASC
  `;
  const byId=new Map<string,any>(backlog.map((p:any)=>[p.id,p]));
  const pool:any[]=[];
  for(const c of cases){
    const owner=String(c.assigned_to);
    if(byId.has(owner)) byId.get(owner)!.cases.push(c);
    else if(liveIds.has(owner)) pool.push(c);
  }
  const total=pool.length+backlog.reduce((n:number,p:any)=>n+p.cases.length,0);
  const target=Math.min(BACKLOG_CAP,Math.ceil(total/backlog.length));
  // Excess over the target leaves its owner (most recently touched stays; oldest-touched moves).
  for(const p of backlog) while(p.cases.length>target) pool.push(p.cases.shift());
  pool.sort((a,b)=>new Date(a.touched).getTime()-new Date(b.touched).getTime());
  const moves:{c:any;to:any}[]=[];
  for(const c of pool){
    const to=[...backlog].sort((a,b)=>a.cases.length-b.cases.length||a.name.localeCompare(b.name))[0];
    if(to.cases.length>=target) break;
    to.cases.push(c);
    if(String(c.assigned_to)!==to.id) moves.push({c,to});
  }
  for(const {c,to} of moves){
    await sql.begin(async(tx:any)=>{
      const upd=await tx`UPDATE onboarding_cases SET assigned_to=${to.id}::uuid,assigned_at=now(),updated_at=now()
        WHERE id=${c.id} AND current_status='open' AND assigned_to=${c.assigned_to} RETURNING id`;
      if(!upd[0]) return;
      const n=(await tx`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${c.id}`)[0].n;
      await tx`INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
        VALUES(${c.id},${c.customer_id},${n},'Backlog rebalance','assignment','SYSTEM_REASSIGNED','Reassigned',${`Reassigned to ${to.name} by the 8:30 AM backlog rebalance`})`;
    });
  }
  return {moved:moves.length,target,noTalkCases:total,backlogPeople:backlog.length,
    after:Object.fromEntries(backlog.map((p:any)=>[p.name,p.cases.length]))};
}

// Runs the day's once-a-day jobs that are due (called every 5 minutes by the lead sync trigger).
export async function runDailyJobs(sql:any){
  const ist=new Date(Date.now()+330*60000);
  const mins=ist.getUTCHours()*60+ist.getUTCMinutes();
  if(mins<8*60+30) return;
  const claim=await sql`INSERT INTO daily_jobs(job,run_date) VALUES('onboarding_backlog_rebalance',${todayIst()}::date) ON CONFLICT DO NOTHING RETURNING job`;
  if(!claim[0]) return;
  let result:any;
  try{ result=await rebalanceOnboardingBacklog(sql); }catch(e:any){ result={error:String(e?.message||e)}; console.error('backlog rebalance failed',e); }
  await sql`UPDATE daily_jobs SET result=${sql.json(result)} WHERE job='onboarding_backlog_rebalance' AND run_date=${todayIst()}::date`;
}
