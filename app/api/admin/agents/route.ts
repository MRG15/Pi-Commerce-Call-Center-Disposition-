import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';

export async function GET(){
  const agent=await currentAgent();
  if(!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(agent.role!=='admin') return NextResponse.json({error:'Admin access required'},{status:403});
  const sql=db();
  const agents=await sql`SELECT id,name,username,role,active,created_at FROM agents ORDER BY active DESC,name ASC`;
  return NextResponse.json({agents});
}

export async function POST(req:Request){
  const agent=await currentAgent();
  if(!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(agent.role!=='admin') return NextResponse.json({error:'Admin access required'},{status:403});
  const body=await req.json();
  const username=String(body.username||'').trim().toLowerCase();
  const name=String(body.name||'').trim();
  const password=String(body.password||'');
  const role=body.role==='admin'?'admin':'agent';
  if(!username||!name||password.length<8) return NextResponse.json({error:'Name, username and password of at least 8 characters are required.'},{status:400});
  const {salt,hash}=hashPassword(password);
  const sql=db();
  try{
    const rows=await sql`INSERT INTO agents(name,username,password_hash,password_salt,role,active) VALUES(${name},${username},${hash},${salt},${role},TRUE) RETURNING id,name,username,role,active,created_at`;
    return NextResponse.json({agent:rows[0]},{status:201});
  }catch(e:any){
    if(String(e?.message||'').includes('agents_username_key')) return NextResponse.json({error:'Username already exists.'},{status:409});
    return NextResponse.json({error:'Could not create agent.'},{status:500});
  }
}

export async function PATCH(req:Request){
  const agent=await currentAgent();
  if(!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(agent.role!=='admin') return NextResponse.json({error:'Admin access required'},{status:403});
  const body=await req.json();
  const id=String(body.id||'');
  if(!id) return NextResponse.json({error:'Agent id required'},{status:400});
  const sql=db();
  if(typeof body.active==='boolean') await sql`UPDATE agents SET active=${body.active} WHERE id=${id}::uuid`;
  if(body.password){
    const password=String(body.password);
    if(password.length<8) return NextResponse.json({error:'Password must be at least 8 characters.'},{status:400});
    const {salt,hash}=hashPassword(password);
    await sql`UPDATE agents SET password_hash=${hash},password_salt=${salt} WHERE id=${id}::uuid`;
    await sql`DELETE FROM sessions WHERE agent_id=${id}::uuid`;
  }
  return NextResponse.json({ok:true});
}
