/* Optional Supabase REST adapter. Notes remain usable offline. No third-party scripts. */
(() => {
  'use strict';
  const b=window.LearningAnnotationBridge,c=window.LEARNING_ANNOTATIONS_CLOUD;
  if(!b||!c||!c.url||!c.publishableKey)return;
  const url=c.url.replace(/\/$/,''), AUTH='learning-annotations:cloud-session:v1', PENDING='learning-annotations:pending-email:v1', OWNER=b.key+':cloud-owner';
  if(!/^https:\/\/[a-z0-9.-]+$/.test(url))return;
  let session=null,busy=false,dirty=false,timer,base=Object.create(null),metaKey='',message='',emailValue='';
  const host=b.host;if(b.enableCloudHelp)b.enableCloudHelp();
  function node(tag,text){const e=document.createElement(tag);if(text)e.textContent=text;return e;}
  function button(text,fn){const e=node('button',text);e.type='button';e.onclick=fn;return e;}
  const title=node('h3','Sync across devices'),status=node('p'),controls=node('div'),privacy=node('p','Cloud notes are private to your signed-in account. Signing out leaves this device’s local copy; use a private browser on shared devices.');
  status.setAttribute('role','status');status.className='la-status';controls.className='la-row';privacy.className='la-help';host.append(title,status,controls,privacy);
  function say(text){message=text;status.textContent=text;}
  function storeSession(s){session=s;if(s)localStorage.setItem(AUTH,JSON.stringify(s));else localStorage.removeItem(AUTH);}
  try {session=JSON.parse(localStorage.getItem(AUTH)||'null');} catch(_){session=null;}
  function err(data){return data.msg||data.message||data.error_description||data.error||'Cloud request failed';}
  async function request(path,opts={},auth=true){
    if(auth){if(!session)throw Error('Sign in to sync notes.');const account=session.user.id;if((session.expires_at||0)*1000<Date.now()+60000)await refresh();if(!session||session.user.id!==account)throw Error('Account changed during sync.');}
    const response=await fetch(url+path,{...opts,headers:{apikey:c.publishableKey,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+session.access_token}:{}),...(opts.headers||{})}});
    const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null;}catch(_){throw Error('Unexpected server response.');}
    if(!response.ok){const e=Error(err(data||{}));e.status=response.status;throw e;}return data;
  }
  async function refresh(){
    const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})},false);
    data.expires_at=data.expires_at||Math.floor(Date.now()/1000)+data.expires_in;storeSession(data);
  }
  function render(){
    controls.replaceChildren();
    if(session&&session.user){
      controls.append(node('span',session.user.email||'Signed in'),button('Sync now',()=>sync()),button('Sign out',async()=>{
        clearTimeout(timer);try{await request('/auth/v1/logout',{method:'POST'});}catch(_){}storeSession(null);base=Object.create(null);metaKey='';render();say('Signed out. Local notes remain on this device.');
      }));
    }else{
      const email=node('input');email.type='email';email.placeholder='Your email address';email.autocomplete='email';email.value=emailValue;email.setAttribute('aria-label','Email for annotation sign-in');
      const code=node('input');code.type='text';code.inputMode='numeric';code.autocomplete='one-time-code';code.placeholder='Verification code (if supplied)';code.maxLength=12;code.setAttribute('aria-label','Email verification code');
      const send=button('Email me a sign-in link',async()=>{
        emailValue=email.value.trim();if(!email.checkValidity()||!emailValue){say('Enter a valid email address.');return;}send.disabled=true;
        try{
          if(window.location&&window.location.protocol==='file:')throw Error('Open the hosted guide to sign in. Export local-file notes once, then import them on the website.');
          const redirect=new URL(window.location.href);redirect.hash='';
          localStorage.setItem(PENDING,JSON.stringify({email:emailValue.toLowerCase(),created:Date.now()}));
          await request('/auth/v1/otp?redirect_to='+encodeURIComponent(redirect.href),{method:'POST',body:JSON.stringify({email:emailValue,create_user:true})},false);
          say('Check your email and open the sign-in link in this browser. If your email includes a verification code, you can enter it below instead.');
        }catch(e){say(e.message);}finally{send.disabled=false;}
      });
      const verify=button('Verify code',async()=>{
        verify.disabled=true;try{
          const data=await request('/auth/v1/verify',{method:'POST',body:JSON.stringify({email:email.value.trim(),token:code.value.trim(),type:'email'})},false);
          if(!data.user||!data.access_token)throw Error('Verification did not return a session.');data.expires_at=data.expires_at||Math.floor(Date.now()/1000)+data.expires_in;storeSession(data);render();await sync();
        }catch(e){say(e.message);}finally{verify.disabled=false;}
      });controls.append(email,send,code,verify);say('Sign in once on each device. For this trial, use the Supabase project owner’s email; the default email provider restricts other recipients.');
    }
  }
  const clone=x=>JSON.parse(JSON.stringify(x));
  const canonical=x=>x&&typeof x==='object'?(Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]))):x;
  const same=(a,d)=>JSON.stringify(canonical(a||null))===JSON.stringify(canonical(d||null));
  const content=row=>row&&!row.deleted_at?row.payload:null;
  function newId(){return 'n-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}
  function validRow(row){return row&&row.user_id===session.user.id&&row.guide===b.guide&&typeof row.id==='string'&&Number.isSafeInteger(row.revision)&&row.revision>0&&(row.deleted_at||b.valid(row.payload))&&(!row.payload||row.payload.id===row.id);}
  async function fetchRows(){
    let rows=[],offset=0;
    for(;;){const page=await request('/rest/v1/annotations?select=*&guide=eq.'+encodeURIComponent(b.guide)+'&user_id=eq.'+encodeURIComponent(session.user.id)+'&order=id.asc&offset='+offset+'&limit=500');if(!Array.isArray(page)||!page.every(validRow))throw Error('Cloud data failed validation. Local notes were preserved.');rows.push(...page);if(page.length<500)return rows;offset+=page.length;if(offset>20000)throw Error('Too many stored revisions; sync paused.');}
  }
  async function sync(){
    if(busy){dirty=true;return;}if(!session||!session.user)return;busy=true;dirty=false;
    const account=session.user.id;
    const checkAccount=()=>{if(!session||session.user.id!==account)throw Error('Account changed during sync.');};
    try{
      if(!b.ready())throw Error('Local storage is unavailable or unreadable. Cloud sync paused to protect your notes.');
      const owner=localStorage.getItem(OWNER);
      if(owner&&owner!==session.user.id)throw Error('These local notes belong to another account. Use a separate browser profile for this account; no notes were uploaded.');
      localStorage.setItem(OWNER,session.user.id);
      const nextKey=b.key+':cloud-base:'+session.user.id;
      if(metaKey!==nextKey){metaKey=nextKey;const saved=localStorage.getItem(metaKey);base=Object.assign(Object.create(null),saved?JSON.parse(saved):{});}
      if(!base||Array.isArray(base)||typeof base!=='object')throw Error('Cloud sync metadata is unreadable. Local notes were preserved.');
      say('Synchronizing…');
      const rows=await fetchRows();checkAccount();const remote=Object.assign(Object.create(null),Object.fromEntries(rows.map(r=>[r.id,r])));
      // Read AFTER the request, so edits made while fetching are included.
      const local=Object.assign(Object.create(null),Object.fromEntries(b.read().map(n=>[n.id,n]))),deletions=b.deletions?b.deletions():Object.create(null),merged=Object.create(null),tasks=[],acknowledged=[];let conflicts=0;
      for(const id of new Set([...Object.keys(base),...Object.keys(remote),...Object.keys(local),...Object.keys(deletions)])){
        const old=base[id],r=remote[id],l=local[id]||null,oldValue=content(old),remoteValue=content(r);
        const intent=deletions[id];
        if(intent&&!l){
          if(remoteValue&&!same(remoteValue,intent.previous)){
            merged[id]=clone(remoteValue);conflicts++;acknowledged.push({id,token:intent.token});
          }else if(remoteValue){tasks.push({id,note:null,revision:r.revision,deleteToken:intent.token});}
          else acknowledged.push({id,token:intent.token});
          continue;
        }
        if(intent&&l)acknowledged.push({id,token:intent.token});
        // Missing data in a stale tab is not evidence of an intentional deletion.
        const changed=!!l&&(old?!same(l,oldValue):true);
        const remoteChanged=old?(!r||r.revision!==old.revision):!!r;
        if(changed&&remoteChanged&&!same(l,remoteValue)){
          if(remoteValue)merged[id]=clone(remoteValue);
          if(l){const copy=clone(l);copy.id=newId();merged[copy.id]=copy;tasks.push({id:copy.id,note:copy,revision:0});}
          conflicts++; // An edit/delete race preserves the edit rather than discarding it.
        }else if(changed){
          if(l)merged[id]=clone(l);
          if(!same(l,remoteValue))tasks.push({id,note:l,revision:r?r.revision:0});
        }else if(remoteValue)merged[id]=clone(remoteValue);
      }
      b.replace(Object.values(merged));
      for(const item of acknowledged)b.acknowledgeDelete(item.id,item.token);
      base=remote;localStorage.setItem(metaKey,JSON.stringify(base));
      // Conditional writes: never overwrite a newer remote revision.
      let raced=false;
      for(const task of tasks){
        checkAccount();
        // Do not upload a stale in-memory version if the reader has edited again.
        const now=b.read().find(n=>n.id===task.id)||null;
        if(!same(now,task.note)){raced=true;continue;}
        const body={payload:task.note,deleted_at:task.note?null:new Date().toISOString(),revision:task.revision+1,updated_at:new Date().toISOString()};
        try{
          let result;
          if(task.revision===0){result=await request('/rest/v1/annotations',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({...body,user_id:session.user.id,guide:b.guide,id:task.id})});}
          else result=await request('/rest/v1/annotations?user_id=eq.'+encodeURIComponent(session.user.id)+'&guide=eq.'+encodeURIComponent(b.guide)+'&id=eq.'+encodeURIComponent(task.id)+'&revision=eq.'+task.revision,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
          checkAccount();if(!Array.isArray(result)||result.length!==1){raced=true;continue;}if(!validRow(result[0]))throw Error('Unexpected saved row.');base[task.id]=result[0];localStorage.setItem(metaKey,JSON.stringify(base));if(task.deleteToken)b.acknowledgeDelete(task.id,task.deleteToken);
        }catch(e){if(e.status===409){raced=true;continue;}throw e;}
      }
      if(conflicts)b.notify('Concurrent changes found. Both comment versions were preserved; an edit takes precedence over a conflicting deletion.');
      say(raced?'Another update arrived. Synchronizing again…':'Synced '+new Date().toLocaleTimeString()+'. Your notes are available on your other signed-in devices.');
      if(raced)timer=setTimeout(sync,1200);
    }catch(e){say('Sync paused: '+e.message+' Notes remain on this device.');}
    finally{busy=false;if(dirty){clearTimeout(timer);timer=setTimeout(sync,900);}}
  }
  function changed(){clearTimeout(timer);timer=setTimeout(sync,900);}
  window.LearningAnnotationCloud={changed,sync};
  window.addEventListener('focus',()=>sync());window.addEventListener('online',()=>sync());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
  window.addEventListener('storage',e=>{if(e.key===AUTH){try{session=JSON.parse(e.newValue||'null');}catch(_){session=null;}render();sync();}});
  async function consumeCallback(){
    if(!window.location||!window.location.hash)return false;
    const params=new URLSearchParams(window.location.hash.slice(1));
    if(!params.has('access_token')&&!params.has('error'))return false;
    // Remove credentials from address/history before making any network request.
    const clean=new URL(window.location.href);clean.hash='';
    window.history.replaceState(window.history.state,'',clean.href);
    if(params.has('error')){say('Sign-in link failed or expired. Request a new email link.');return true;}
    try{
      const access=params.get('access_token'),refreshToken=params.get('refresh_token');
      if(!access||!refreshToken||params.get('token_type')&&params.get('token_type')!=='bearer')throw Error('Incomplete sign-in link. Request a new one.');
      const pending=JSON.parse(localStorage.getItem(PENDING)||'null');
      if(!pending||typeof pending.email!=='string'||Date.now()-pending.created>3600000)throw Error('Request a sign-in link from this browser first, then open its email link here.');
      // Ask Auth to validate the token; never trust user identity decoded from the URL/JWT.
      const user=await request('/auth/v1/user',{headers:{Authorization:'Bearer '+access}},false);
      if(!user||typeof user.id!=='string'||typeof user.email!=='string'||user.email.toLowerCase()!==pending.email)throw Error('The email link does not match the email requested in this browser.');
      const lifetime=Number(params.get('expires_in'));
      storeSession({access_token:access,refresh_token:refreshToken,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+(Number.isFinite(lifetime)&&lifetime>0?Math.min(lifetime,86400):3600),user});
      localStorage.removeItem(PENDING);render();say('Signed in. Synchronizing your notes…');await sync();
    }catch(e){say('Sign-in was not completed: '+e.message);}
    return true;
  }
  render();consumeCallback().then(handled=>{if(!handled&&session)sync();});
})();
