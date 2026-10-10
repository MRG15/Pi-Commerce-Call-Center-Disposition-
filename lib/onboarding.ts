import { db } from './db';

export async function pickOnboarder(preferredId?:string|null){
  const sql=db();
  // Manual assignment may target any active user with onboarding access.
  if(preferredId){
    const rows=await sql`
      SELECT a.id,a.name
      FROM agents a
      JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding'
      WHERE a.id=${preferredId}::uuid AND a.active=TRUE
      LIMIT 1
    `;
    if(rows[0]) return rows[0];
  }
  const roster=await loadOnboardingRoster(sql);
  if(roster.length) return takeNextOnboarder(roster);
  // No roster set up: fall back to the Onboarding Agent with the fewest open cases.
  const rows=await sql`
    SELECT a.id,a.name,
      COUNT(c.id) FILTER (WHERE c.current_status='open')::int AS open_count,
      MAX(c.assigned_at) AS last_assigned_at
    FROM agents a
    JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding' AND w.access_level='agent'
    LEFT JOIN onboarding_cases c ON c.assigned_to=a.id
    WHERE a.active=TRUE
    GROUP BY a.id,a.name
    ORDER BY open_count ASC, last_assigned_at ASC NULLS FIRST, a.name ASC
    LIMIT 1
  `;
  return rows[0]||null;
}

// New cases are shared equally among the onboarding roster: each goes to whoever the rotation has
// picked the fewest times since the roster started (ties: longest since their last pick). Counted
// on rotation_agent_id, so cases an admin later moves still count for the person first picked.
// Existing cases are never moved.
export async function loadOnboardingRoster(sql:any):Promise<{id:string;name:string;count:number;last:number}[]>{
  const ok=await sql`SELECT to_regclass('public.onboarding_roster') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return [];
  const rows=await sql`
    WITH r AS (
      -- Counted since the rotation last gained someone, so a newcomer starts level, not behind.
      SELECT a.id,a.name,(SELECT max(added_at) FROM onboarding_roster) AS since
      FROM onboarding_roster o JOIN agents a ON a.id=o.agent_id
      JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding'
      WHERE a.active=TRUE
    )
    SELECT r.id,r.name,
      (SELECT count(*)::int FROM onboarding_cases c WHERE c.rotation_agent_id=r.id AND c.created_at>=r.since) AS count,
      (SELECT max(c.created_at) FROM onboarding_cases c WHERE c.rotation_agent_id=r.id) AS last
    FROM r ORDER BY r.name
  `;
  return rows.map((x:any)=>({id:String(x.id),name:x.name,count:Number(x.count),last:x.last?new Date(x.last).getTime():0}));
}

export function takeNextOnboarder(roster:{id:string;name:string;count:number;last:number}[]){
  const next=[...roster].sort((a,b)=>(a.count-b.count)||(a.last-b.last)||a.name.localeCompare(b.name))[0];
  next.count++; next.last=Date.now();
  return {id:next.id,name:next.name};
}

export function toIstCallback(date?:string|null,time?:string|null){
  if(!date||!time) return null;
  const d=new Date(`${date}T${time}:00+05:30`);
  if(Number.isNaN(d.getTime())) return null;
  return d;
}

export async function nextOnboardingAttempt(caseId:string){
  const sql=db();
  const rows=await sql`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${caseId}::uuid`;
  return Number(rows[0]?.n||1);
}
