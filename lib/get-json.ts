// Client-side GET for the main "open" actions (fetch a customer, open a case / lead / merchant).
// Never hangs and never throws: gives up after 20 seconds, retries once on a timeout or network
// error, and reports a failure as {ok:false,error} so the button can reset with a message.
export async function getJson(url:string):Promise<{ok:boolean;status:number;j:any}>{
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});
      const j=await r.json().catch(()=>({error:`Server error (${r.status}). Please try again.`}));
      return {ok:r.ok,status:r.status,j};
    }catch{/* timeout or network error: retry once */}
  }
  return {ok:false,status:0,j:{error:'Taking too long to load. Please try again.'}};
}
