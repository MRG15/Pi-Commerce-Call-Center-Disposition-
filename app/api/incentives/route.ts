import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canSeeIncentives } from '@/lib/workspace-access';
import { buildIncentiveReport } from '@/lib/incentive-report';

const isDate=(v:string|null)=>Boolean(v&&/^\d{4}-\d{2}-\d{2}$/.test(v));

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canSeeIncentives(user)) return NextResponse.json({error:'Incentives access required'},{status:403});
  const u=new URL(req.url); const from=u.searchParams.get('from'); const to=u.searchParams.get('to');
  if(!isDate(from)||!isDate(to)||from!>to!) return NextResponse.json({error:'from and to are required (YYYY-MM-DD, from ≤ to)'},{status:400});
  const sql=db();
  return NextResponse.json(await buildIncentiveReport(sql,from!,to!));
}
