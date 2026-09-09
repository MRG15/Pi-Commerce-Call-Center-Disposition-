import { currentAgent } from './auth';
import { db } from './db';

export type Workspace = 'seller'|'onboarding';
export type WorkspaceRole = 'agent'|'admin'|null;

export async function currentUserAccess(){
  const agent:any=await currentAgent();
  if(!agent) return null;
  const sql=db();
  const schema=await sql`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name='is_super_admin') AS has_super,
      to_regclass('public.workspace_access') IS NOT NULL AS has_workspace_access
  `;
  const hasSuper=Boolean(schema[0]?.has_super);
  const hasAccess=Boolean(schema[0]?.has_workspace_access);
  let isSuperAdmin=false;
  let seller:WorkspaceRole=agent.role==='admin'?'admin':'agent';
  let onboarding:WorkspaceRole=null;
  if(hasSuper){
    const rows=await sql`SELECT is_super_admin FROM agents WHERE id=${agent.id}::uuid LIMIT 1`;
    isSuperAdmin=Boolean(rows[0]?.is_super_admin);
  }
  if(hasAccess){
    const rows=await sql`SELECT workspace,access_level FROM workspace_access WHERE agent_id=${agent.id}::uuid`;
    const map:any={}; for(const r of rows) map[r.workspace]=r.access_level;
    seller=(map.seller||null) as WorkspaceRole;
    onboarding=(map.onboarding||null) as WorkspaceRole;
  }
  return {...agent,isSuperAdmin,access:{seller,onboarding}};
}

export function canAccess(user:any,workspace:Workspace){
  return Boolean(user?.isSuperAdmin || user?.access?.[workspace]);
}

export function isWorkspaceAdmin(user:any,workspace:Workspace){
  return Boolean(user?.isSuperAdmin || user?.access?.[workspace]==='admin');
}
