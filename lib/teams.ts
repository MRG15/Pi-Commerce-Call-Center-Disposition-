// Team membership by date (Sales / Onboarding / CSM) from the team_changes table. Each row is a
// change from effective_from; the row in force on a date is the latest one on or before it.
// Incentives use it to decide who earns a team's incentive on each day, and workspace access
// follows a change once its date arrives.
import { todayIst } from './plans';

export type Team = 'sales'|'onboarding'|'csm';
export const TEAMS:Team[] = ['sales','onboarding','csm'];
export const TEAM_WORKSPACE:Record<Team,'seller'|'onboarding'|'csm'> = { sales:'seller', onboarding:'onboarding', csm:'csm' };
export type TeamChange = { person:string; agentId:string; team:Team; effectiveFrom:string; member:boolean; incentive:boolean };

export async function loadTeamChanges(sql:any):Promise<TeamChange[]>{
  const ok=await sql`SELECT to_regclass('public.team_changes') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return [];
  const rows=await sql`
    SELECT a.name AS person,t.agent_id,t.team,t.effective_from::text AS effective_from,t.member,t.incentive
    FROM team_changes t JOIN agents a ON a.id=t.agent_id ORDER BY t.effective_from,t.id
  `;
  return rows.map((r:any)=>({person:r.person,agentId:String(r.agent_id),team:r.team,effectiveFrom:r.effective_from,member:r.member,incentive:r.incentive}));
}

// The change in force for one person and team on a date (null = never on that team by then).
export function teamStateOn(changes:TeamChange[],person:string,team:Team,date:string):TeamChange|null{
  let hit:TeamChange|null=null;
  for(const c of changes) if(c.person===person&&c.team===team&&c.effectiveFrom<=date&&(!hit||c.effectiveFrom>=hit.effectiveFrom)) hit=c;
  return hit;
}

// Earns `teams`' incentive on `date`: on one of those teams that day with incentive switched on.
export function earnsOn(changes:TeamChange[],teams:Team[],person:string,date:string){
  return teams.some(t=>{const s=teamStateOn(changes,person,t,date);return Boolean(s?.member&&s.incentive);});
}

// Applies workspace access for team changes whose date has arrived: joining a team opens its
// workspace (an existing higher level is kept), leaving closes it (admin access is never
// removed here). Also keeps the onboarding rotation and CSM allocation in step with leaving.
// Throttled per server instance; cheap when nothing is due.
let lastRun=0;
export async function applyDueTeamChanges(sql:any,force=false){
  if(!force&&Date.now()-lastRun<60000) return;
  lastRun=Date.now();
  const ok=await sql`SELECT to_regclass('public.team_changes') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return;
  const due=await sql`
    SELECT id,agent_id,team,member FROM team_changes
    WHERE applied_at IS NULL AND effective_from<=${todayIst()}::date
    ORDER BY effective_from,id
  `;
  for(const c of due){
    const ws=TEAM_WORKSPACE[c.team as Team];
    await sql.begin(async(tx:any)=>{
      if(c.member){
        await tx`INSERT INTO workspace_access(agent_id,workspace,access_level) VALUES(${c.agent_id}::uuid,${ws},'agent') ON CONFLICT (agent_id,workspace) DO NOTHING`;
        if(c.team==='csm') await tx`INSERT INTO csm_weights(agent_id,weight) VALUES(${c.agent_id}::uuid,0) ON CONFLICT (agent_id) DO NOTHING`;
      }else{
        await tx`DELETE FROM workspace_access WHERE agent_id=${c.agent_id}::uuid AND workspace=${ws} AND access_level<>'admin'`;
        if(c.team==='onboarding') await tx`DELETE FROM onboarding_roster WHERE agent_id=${c.agent_id}::uuid`;
        if(c.team==='csm') await tx`UPDATE csm_weights SET weight=0,updated_at=now() WHERE agent_id=${c.agent_id}::uuid`;
      }
      await tx`UPDATE team_changes SET applied_at=now() WHERE id=${c.id}`;
    });
  }
}
