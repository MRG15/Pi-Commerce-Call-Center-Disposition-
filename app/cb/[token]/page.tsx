import { db } from '@/lib/db';

// "Request a callback" link from the WhatsApp templates (/cb/<callback_token>). Public: the
// merchant opens it from WhatsApp. Records the request for the workspace's Req Call Back pane;
// clicking again later (after the team has followed up) raises a new request.
export const dynamic='force-dynamic';

export default async function CallbackRequestPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  let ok=false;
  if(/^[A-Za-z0-9_-]{8,64}$/.test(token)){
    try{
      const rows=await db()`
        UPDATE wa_messages
        SET clicked_at=CASE WHEN clicked_at IS NULL OR resolved_at IS NOT NULL THEN now() ELSE clicked_at END,
            resolved_at=NULL,click_count=click_count+1
        WHERE token=${token} RETURNING id
      `;
      ok=rows.length>0;
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
