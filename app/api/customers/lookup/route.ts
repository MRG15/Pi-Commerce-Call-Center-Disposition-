import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
import { phoneKey } from '@/lib/plans';

// Finds customers by Cust ID or phone number. Both can be 10-digit numbers, so both are
// checked and every distinct customer found is returned for the agent to pick from.
export async function GET(req:Request){
  if(!await currentAgent()) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const q=String(new URL(req.url).searchParams.get('q')||'').trim();
  if(!q) return NextResponse.json({error:'Enter a customer ID or phone number'},{status:400});
  const sql=db();
  const phone=phoneKey(q);
  const byId=/^\d+$/.test(q)?await sql`
    SELECT x.customer_id,m.merchant_name,COALESCE(m.phone_number,x.phone) AS phone
    FROM (
      SELECT customer_id,phone FROM customers WHERE customer_id=${q}
      UNION SELECT customer_id,NULL FROM merchant_information WHERE customer_id=${q} AND active=TRUE
    ) x
    LEFT JOIN merchant_information m ON m.customer_id=x.customer_id AND m.active=TRUE
    LIMIT 1
  `:[];
  const byPhone=phone?await sql`
    SELECT DISTINCT ON (x.customer_id) x.customer_id,m.merchant_name,COALESCE(m.phone_number,x.phone) AS phone
    FROM (
      SELECT customer_id,phone_number AS phone FROM merchant_information
      WHERE active=TRUE AND right(regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g'),10)=${phone}
      UNION SELECT customer_id,phone FROM customers
      WHERE right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10)=${phone}
    ) x
    LEFT JOIN merchant_information m ON m.customer_id=x.customer_id AND m.active=TRUE
    ORDER BY x.customer_id
    LIMIT 10
  `:[];
  const matches=new Map<string,any>();
  for(const r of byId) matches.set(String(r.customer_id),{customerId:String(r.customer_id),merchantName:r.merchant_name||null,phone:r.phone||null,matchedBy:'customer ID'});
  for(const r of byPhone){
    const id=String(r.customer_id);
    if(matches.has(id)) continue;
    matches.set(id,{customerId:id,merchantName:r.merchant_name||null,phone:r.phone||null,matchedBy:'phone number'});
  }
  return NextResponse.json({query:q,matches:[...matches.values()]});
}
