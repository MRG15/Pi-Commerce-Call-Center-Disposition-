import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
export async function GET() { const agent=await currentAgent(); return agent ? NextResponse.json({agent}) : NextResponse.json({error:'Unauthenticated'},{status:401}); }
