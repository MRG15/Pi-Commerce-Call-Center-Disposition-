import { NextResponse } from 'next/server';
import { currentUserAccess } from '@/lib/workspace-access';

export async function GET(){
  const user=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  return NextResponse.json({user});
}
