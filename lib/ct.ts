// CleverTap payments that arrived with only a MID (the merchant's CT profile had no Cust ID yet).
// Once the MID → Cust ID is known (Sub Raw's MID column in the daily onboarding sync, or AdsRun
// Raw), the event is linked to the Cust ID and, for a subscription, its employee code is put on
// that merchant's onboarding case if the case has none.
export async function linkCtPayments(sql:any,known:{mid:string;customer_id:string}[]){
  const ok=await sql`SELECT to_regclass('public.ct_payment_events') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return {linked:0,codes:0};
  const rows=await sql`
    WITH m AS (
      SELECT DISTINCT ON (mid) mid,customer_id FROM (
        SELECT x.mid,x.customer_id,1 AS pri FROM jsonb_to_recordset(${sql.json(known)}::jsonb) AS x(mid text,customer_id text)
        UNION ALL
        SELECT a.mid,a.customer_id,2 FROM merchant_ads a
        WHERE a.mid IS NOT NULL AND a.mid<>'' AND a.customer_id IS NOT NULL
          AND a.mid IN (SELECT mid FROM ct_payment_events WHERE customer_id IS NULL AND mid IS NOT NULL)
      ) s ORDER BY mid,pri
    ),
    l AS (
      UPDATE ct_payment_events e SET customer_id=m.customer_id,case_action='linked'
      FROM m WHERE e.customer_id IS NULL AND e.mid=m.mid
      RETURNING e.customer_id,e.employee_code,e.flow,e.category,e.action,e.received_at
    ),
    c AS (
      UPDATE onboarding_cases oc SET sold_by_employee_code=x.employee_code,updated_at=now()
      FROM (
        SELECT DISTINCT ON (customer_id) customer_id,employee_code FROM l
        WHERE employee_code IS NOT NULL AND flow='subscribe'
          AND (category IS NULL OR category='pic_subscription') AND (action IS NULL OR action='payment_success')
        ORDER BY customer_id,received_at
      ) x
      WHERE oc.customer_id=x.customer_id AND oc.sold_by_employee_code IS NULL
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM l) AS linked,(SELECT count(*)::int FROM c) AS codes
  `;
  return {linked:Number(rows[0]?.linked||0),codes:Number(rows[0]?.codes||0)};
}
