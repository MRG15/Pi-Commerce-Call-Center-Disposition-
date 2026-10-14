import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';

// Lead Gen Ads pane. Sellers see the leads assigned to them; Seller Admins see everyone's.
// A lead counts as called once a Seller disposition exists for it (its phone-only record, or its
// Cust ID) on or after the day it came in.
export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
  const sql=db();
  const ok=await sql`SELECT to_regclass('public.leadgen_leads') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return NextResponse.json({visible:false,leads:[]});
  const admin=isWorkspaceAdmin(user,'seller');
  const inRoster=Boolean((await sql`SELECT 1 FROM leadgen_roster WHERE agent_id=${user.id}::uuid`)[0]);
  const leads=await sql`
    SELECT l.id,l.phone,l.name,l.submitted_at,l.last_submitted_at,l.submissions,l.campaign_name,l.adset_name,l.ad_name,l.form_name,l.platform,
      l.customer_id,l.assigned_to,l.assigned_at,l.is_repeat,l.already_called,a.name AS assigned_name,m.merchant_name,
      lc.calls,lc.last_l0,lc.last_l1,lc.last_at,lc.last_by,lc.next_callback
    FROM leadgen_leads l
    LEFT JOIN agents a ON a.id=l.assigned_to
    LEFT JOIN merchant_information m ON m.customer_id=l.customer_id AND m.active=TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS calls,
        (array_agg(c.l0_label_snapshot ORDER BY c.event_time DESC NULLS LAST))[1] AS last_l0,
        (array_agg(c.l1_label_snapshot ORDER BY c.event_time DESC NULLS LAST))[1] AS last_l1,
        max(c.event_time) AS last_at,
        (array_agg(COALESCE(ag.name,c.agent_name_raw) ORDER BY c.event_time DESC NULLS LAST))[1] AS last_by,
        (array_agg(c.callback_at ORDER BY c.event_time DESC NULLS LAST))[1] AS next_callback
      FROM calls c LEFT JOIN agents ag ON ag.id=c.agent_id
      WHERE c.source_type='new_call'
        AND (c.lead_id=l.id OR (l.customer_id IS NOT NULL AND c.customer_id=l.customer_id) OR c.customer_id=l.phone)
        AND c.call_date>=(l.submitted_at AT TIME ZONE 'Asia/Kolkata')::date
    ) lc ON TRUE
    WHERE (${admin} OR l.assigned_to=${user.id}::uuid)
    ORDER BY l.submitted_at DESC
    LIMIT 2000
  `;
  const visible=admin||inRoster||leads.length>0;
  return NextResponse.json({visible,admin,inRoster,leads});
}
