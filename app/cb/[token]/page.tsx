import { db } from '@/lib/db';
import { reopenForCallback,whatsappCallback } from '@/lib/paytm-callbacks';

// "Request a callback" link from the WhatsApp templates (/cb/<callback_token>). Public: the
// merchant opens it from WhatsApp. Records the request for the workspace's Req Call Back pane;
// clicking again later (after the team has followed up) raises a new request.
export const dynamic='force-dynamic';

export default async function CallbackRequestPage({params,searchParams}:{params:Promise<{token:string}>;searchParams:Promise<{c?:string}>}){
  const {token}=await params;
  let ok=false;
  // A WhatsApp campaign sent outside the CRM puts the merchant's Cust ID (digits) or MID (letters + digits)
  // here instead of a message token: /cb/123456 or /cb/<MID>, optionally ?c=campaign (WhatsApp may encode the
  // "?" into the value). Tokens are matched first. Public, so anyone with an ID can raise a request (merged 24h).
  let key=token,campaign:string|undefined;
  try{const [k,q]=decodeURIComponent(token).split('?');key=k;campaign=(await searchParams).c||new URLSearchParams(q||'').get('c')||undefined;}catch{}
  if(/^[A-Za-z0-9_-]{3,64}$/.test(key)){
    try{
      const rows=await db()`
        UPDATE wa_messages
        SET clicked_at=CASE WHEN clicked_at IS NULL OR resolved_at IS NOT NULL THEN now() ELSE clicked_at END,
            resolved_at=NULL,click_count=click_count+1
        WHERE token=${key} RETURNING id,template,customer_id
      `;
      ok=rows.length>0;
      if(!ok&&/^[A-Za-z0-9]+$/.test(key)) ok=(await whatsappCallback(db(),/^\d+$/.test(key)?{customer_id:key,campaign}:{mid:key,campaign})).ok;
      // Get ad setup on the refund message: the merchant wants to continue, so their lost case reopens.
      if(rows[0]?.template==='REFUND_NOTICE'&&rows[0].customer_id)
        await reopenForCallback(db(),String(rows[0].customer_id),'refund_callback','Refund WhatsApp',
          'Merchant tapped Get ad setup on the refund WhatsApp. Lost case reopened for the owner.');
    }catch{ok=false;}
  }
  return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f5f7fb',padding:20,fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'}}>
    <div style={{background:'#fff',borderRadius:14,padding:'32px 28px',maxWidth:380,width:'100%',textAlign:'center',boxShadow:'0 8px 30px rgba(0,41,112,.08)'}}>
      <div style={{fontSize:40,lineHeight:1}}>{ok?'✅':'⚠️'}</div>
      <h1 style={{fontSize:20,color:'#002970',margin:'14px 0 8px'}}>{ok?'Callback requested':'Link not recognised'}</h1>
      <p style={{color:'#4b5563',margin:0,lineHeight:1.5}}>{ok?'Thank you! Our Pi Commerce team will call you back shortly.':'This link is not valid. Please reply on WhatsApp and our team will reach out.'}</p>
    </div>
  </div>;
}
