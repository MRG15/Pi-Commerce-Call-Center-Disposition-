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
  // Automatic routing is deliberately restricted to Onboarding Agents.
  // Admins/Super Admins manage the queue but are not auto-assigned operational work.
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
