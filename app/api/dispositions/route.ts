import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
export async function GET() {
  if (!await currentAgent()) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const sql=db();
  const rows=await sql`SELECT id,code,label,level,parent_id,sort_order FROM disposition_nodes WHERE active=TRUE ORDER BY level,parent_id NULLS FIRST,sort_order,label`;
  return NextResponse.json({nodes:rows});
}
