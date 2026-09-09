import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { hashPassword } from '@/lib/password';

async function managerState(user:any){
  const sql=db();
  const rows=await sql`SELECT COUNT(*)::int AS n FROM agents WHERE is_super_admin=TRUE`;
  const bootstrap=Number(rows[0]?.n||0)===0 && user.role==='admin';
  return {bootstrap,global:Boolean(user.isSuperAdmin||bootstrap),seller:Boolean(user.isSuperAdmin||bootstrap||isWorkspaceAdmin(user,'seller')),onboarding:Boolean(user.isSuperAdmin||bootstrap||isWorkspaceAdmin(user,'onboarding'))};
}

export async function GET(){
  const user:any=await currentUserAccess(); if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const manage=await managerState(user); if(!manage.seller&&!manage.onboarding) return NextResponse.json({error:'Admin access required'},{status:403});
  const sql=db();
  const agents=await sql`
    SELECT a.id,a.name,a.username,a.active,a.created_at,a.is_super_admin,
      MAX(CASE WHEN w.workspace='seller' THEN w.access_level END) AS seller_access,
      MAX(CASE WHEN w.workspace='onboarding' THEN w.access_level END) AS onboarding_access
    FROM agents a LEFT JOIN workspace_access w ON w.agent_id=a.id
    GROUP BY a.id ORDER BY a.active DESC,a.name ASC
  `;
  return NextResponse.json({agents,manage});
}

export async function POST(req:Request){
  const user:any=await currentUserAccess(); if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const manage=await managerState(user); if(!manage.seller&&!manage.onboarding) return NextResponse.json({error:'Admin access required'},{status:403});
  const body=await req.json(); const name=String(body.name||'').trim(); const username=String(body.username||'').trim().toLowerCase(); const password=String(body.password||'');
  if(!name||!username||password.length<8) return NextResponse.json({error:'Name, username and password of at least 8 characters are required.'},{status:400});
  const seller=body.sellerAccess||null,onboarding=body.onboardingAccess||null,isSuper=Boolean(body.isSuperAdmin);
  if(isSuper&&!manage.global) return NextResponse.json({error:'Only a Super Admin can create another Super Admin.'},{status:403});
  if(seller&&!manage.seller) return NextResponse.json({error:'You cannot grant Seller access.'},{status:403});
  if(onboarding&&!manage.onboarding) return NextResponse.json({error:'You cannot grant Onboarding access.'},{status:403});
  const {salt,hash}=hashPassword(password); const sql=db();
  try{
    const rows=await sql`INSERT INTO agents(name,username,password_hash,password_salt,role,active,is_super_admin) VALUES(${name},${username},${hash},${salt},'agent',TRUE,${isSuper}) RETURNING id`;
    const id=rows[0].id;
    if(seller) await sql`INSERT INTO workspace_access(agent_id,workspace,access_level) VALUES(${id}::uuid,'seller',${seller}) ON CONFLICT(agent_id,workspace) DO UPDATE SET access_level=EXCLUDED.access_level,updated_at=now()`;
    if(onboarding) await sql`INSERT INTO workspace_access(agent_id,workspace,access_level) VALUES(${id}::uuid,'onboarding',${onboarding}) ON CONFLICT(agent_id,workspace) DO UPDATE SET access_level=EXCLUDED.access_level,updated_at=now()`;
    return NextResponse.json({ok:true,id},{status:201});
  }catch(e:any){
    if(String(e?.message||'').includes('agents_username_key')) return NextResponse.json({error:'Username already exists.'},{status:409});
    return NextResponse.json({error:'Could not create user.'},{status:500});
  }
}

export async function PATCH(req:Request){
  const user:any=await currentUserAccess(); if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const manage=await managerState(user); const body=await req.json(); const id=String(body.id||''); if(!id) return NextResponse.json({error:'User id required'},{status:400});
  const sql=db();
  const beforeRows=await sql`
    SELECT a.active,a.is_super_admin,
      MAX(CASE WHEN w.workspace='seller' THEN w.access_level END) AS seller_access,
      MAX(CASE WHEN w.workspace='onboarding' THEN w.access_level END) AS onboarding_access
    FROM agents a LEFT JOIN workspace_access w ON w.agent_id=a.id WHERE a.id=${id}::uuid GROUP BY a.id
  `;
  if(!beforeRows[0]) return NextResponse.json({error:'User not found'},{status:404});
  if(body.isSuperAdmin!==undefined){if(!manage.global)return NextResponse.json({error:'Only a Super Admin can change Super Admin access.'},{status:403});await sql`UPDATE agents SET is_super_admin=${Boolean(body.isSuperAdmin)} WHERE id=${id}::uuid`;}
  if(body.sellerAccess!==undefined){if(!manage.seller)return NextResponse.json({error:'Seller Admin access required.'},{status:403});if(body.sellerAccess===null)await sql`DELETE FROM workspace_access WHERE agent_id=${id}::uuid AND workspace='seller'`;else await sql`INSERT INTO workspace_access(agent_id,workspace,access_level) VALUES(${id}::uuid,'seller',${String(body.sellerAccess)}) ON CONFLICT(agent_id,workspace) DO UPDATE SET access_level=EXCLUDED.access_level,updated_at=now()`;}
  if(body.onboardingAccess!==undefined){if(!manage.onboarding)return NextResponse.json({error:'Onboarding Admin access required.'},{status:403});if(body.onboardingAccess===null)await sql`DELETE FROM workspace_access WHERE agent_id=${id}::uuid AND workspace='onboarding'`;else await sql`INSERT INTO workspace_access(agent_id,workspace,access_level) VALUES(${id}::uuid,'onboarding',${String(body.onboardingAccess)}) ON CONFLICT(agent_id,workspace) DO UPDATE SET access_level=EXCLUDED.access_level,updated_at=now()`;}
  if(typeof body.active==='boolean'){if(!manage.global&&!manage.seller&&!manage.onboarding)return NextResponse.json({error:'Admin access required.'},{status:403});await sql`UPDATE agents SET active=${body.active} WHERE id=${id}::uuid`;if(!body.active)await sql`DELETE FROM sessions WHERE agent_id=${id}::uuid`;}
  const afterRows=await sql`
    SELECT a.active,a.is_super_admin,
      MAX(CASE WHEN w.workspace='seller' THEN w.access_level END) AS seller_access,
      MAX(CASE WHEN w.workspace='onboarding' THEN w.access_level END) AS onboarding_access
    FROM agents a LEFT JOIN workspace_access w ON w.agent_id=a.id WHERE a.id=${id}::uuid GROUP BY a.id
  `;
  await sql`INSERT INTO access_audit_log(target_agent_id,changed_by,previous_access,new_access) VALUES(${id}::uuid,${user.id}::uuid,${JSON.stringify(beforeRows[0])}::jsonb,${JSON.stringify(afterRows[0])}::jsonb)`;
  return NextResponse.json({ok:true});
}
