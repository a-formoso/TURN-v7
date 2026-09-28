/* Shared Studio setup UI. Pairing credentials stay in this mounted panel only. */
const _bsSetupEl=React.createElement;

async function bsCopySetupText(text){
  if(!text)return false;
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);return true;
    }
  }catch(_){}
  // Embedded previews may deny the Clipboard API but allow a user-initiated
  // legacy copy. Never claim success when both browser mechanisms fail.
  const previous=document.activeElement,field=document.createElement("textarea");
  field.value=text;field.readOnly=true;field.style.cssText="position:fixed;left:-9999px;top:0";
  document.body.appendChild(field);
  try{field.select();return !!document.execCommand("copy");}
  catch(_){return false;}
  finally{field.remove();try{if(previous)previous.focus({preventScroll:true});}catch(_){}}
}

function BlenderStudioSetup({client,readOnly=false,locationId,onConnectionChange}){
  const E=_bsSetupEl;
  const [connection,setConnection]=React.useState(null),[checking,setChecking]=React.useState(true);
  const [pair,setPair]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
  const [installOpen,setInstallOpen]=React.useState(true),[connectOpen,setConnectOpen]=React.useState(true);
  const [copied,setCopied]=React.useState({}),[copyMessage,setCopyMessage]=React.useState(""),[manual,setManual]=React.useState("");
  const [now,setNow]=React.useState(Date.now());
  const alive=React.useRef(true),epoch=React.useRef(0),scopeRef=React.useRef(null),operation=React.useRef(0);
  const readOnlyRef=React.useRef(readOnly),changeRef=React.useRef(onConnectionChange),refreshRef=React.useRef(null);
  readOnlyRef.current=readOnly;changeRef.current=onConnectionChange;
  const current=token=>{
    try{return alive.current&&epoch.current===token&&scopeRef.current&&client&&client.isCurrent(scopeRef.current);}
    catch(_){return false;}
  };
  const resetCopy=()=>{setCopied({});setCopyMessage("");setManual("");};
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;operation.current++;};},[]);
  React.useEffect(()=>{
    const token=++epoch.current;let active=true,timer=null,inFlight=false,wasConnected=false;
    operation.current++;scopeRef.current=null;
    setPair(null);setConnection(null);setBusy(false);setError("");resetCopy();
    if(changeRef.current)changeRef.current(null);
    const bridge=window.BlenderPreview;
    const clearStale=()=>{
      if(active&&alive.current&&epoch.current===token){
        setPair(null);setConnection(null);setChecking(false);resetCopy();
        if(changeRef.current)changeRef.current(null);
        setError("The film or account changed. Close and reopen Studio to connect this workspace.");
      }
    };
    if(readOnly||!client||!bridge){
      setChecking(false);
      if(!readOnly)setError("Blender connection tools are unavailable in this build.");
      return()=>{active=false;};
    }
    try{scopeRef.current=client.scope();}
    catch(e){setChecking(false);setError(String(e.message||"Open Studio from a saved cloud film."));return()=>{active=false;};}
    const refresh=async()=>{
      if(!active||inFlight)return;
      clearTimeout(timer);
      if(!current(token)){clearStale();return;}
      const op=operation.current;
      inFlight=true;setChecking(true);
      try{
        const result=await bridge.request("connection.get",{projectId:scopeRef.current.projectId},scopeRef.current,
          ()=>active&&current(token)&&operation.current===op&&!readOnlyRef.current);
        if(operation.current!==op)return;
        if(!active||!current(token)||readOnlyRef.current){clearStale();return;}
        const next=result&&(result.connection||result);
        if(!next||typeof next.connected!=="boolean")throw new Error("Blender connection could not be confirmed.");
        setConnection(next);setError("");
        if(changeRef.current)changeRef.current(next);
        if(next.connected){
          setPair(null);resetCopy();
          if(!wasConnected){setInstallOpen(false);setConnectOpen(false);}
        }else if(wasConnected)setConnectOpen(true);
        wasConnected=next.connected;
      }catch(e){
        if(operation.current!==op)return;
        if(active&&current(token)&&!readOnlyRef.current)setError(String(e.message||"Could not check Blender. Try checking the connection again."));
        else clearStale();
      }finally{
        inFlight=false;
        if(active&&current(token)&&!readOnlyRef.current){
          setChecking(false);timer=setTimeout(refresh,4000);
        }
      }
    };
    refreshRef.current=refresh;refresh();
    return()=>{active=false;clearTimeout(timer);refreshRef.current=null;};
  },[client,locationId,readOnly]);
  React.useEffect(()=>{
    if(!pair)return;
    setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[pair]);
  const pairCode=pair&&(pair.pairCode||pair.code)||"";
  const expires=pair&&pair.expiresAt?Date.parse(pair.expiresAt):NaN;
  const expired=Number.isFinite(expires)&&expires<=now;
  const connected=!!(connection&&connection.connected);
  let endpoint="";
  try{endpoint=window.BlenderPreview&&typeof window.BlenderPreview.endpoint==="function"?window.BlenderPreview.endpoint():"";}catch(_){}
  const pairDesktop=async()=>{
    if(readOnlyRef.current||busy||!current(epoch.current)||!window.BlenderPreview)return;
    const token=epoch.current,op=++operation.current,scope=scopeRef.current;
    setBusy(true);setError("");setPair(null);resetCopy();
    try{
      const result=await window.BlenderPreview.request("pair.create",{projectId:scope.projectId},scope,
        ()=>current(token)&&operation.current===op&&!readOnlyRef.current);
      if(!current(token)||operation.current!==op||readOnlyRef.current)return;
      if(!result||typeof(result.pairCode||result.code)!=="string"||!(result.pairCode||result.code))
        throw new Error("No pairing code was returned. Try creating a new code.");
      setPair(result);setNow(Date.now());setInstallOpen(false);setConnectOpen(true);
    }catch(e){if(current(token)&&operation.current===op&&!readOnlyRef.current)setError(String(e.message||"Could not create a pairing code."));}
    finally{if(current(token)&&operation.current===op)setBusy(false);}
  };
  const disconnect=async()=>{
    if(readOnlyRef.current||busy||!current(epoch.current)||!window.BlenderPreview)return;
    const token=epoch.current,op=++operation.current,scope=scopeRef.current;
    setBusy(true);setError("");
    try{
      await window.BlenderPreview.request("connection.disconnect",{projectId:scope.projectId},scope,
        ()=>current(token)&&operation.current===op&&!readOnlyRef.current);
      if(!current(token)||operation.current!==op||readOnlyRef.current)return;
      setConnection({connected:false});setPair(null);resetCopy();setConnectOpen(true);
      if(changeRef.current)changeRef.current({connected:false});
      if(refreshRef.current)refreshRef.current();
    }catch(e){if(current(token)&&operation.current===op&&!readOnlyRef.current)setError(String(e.message||"Could not disconnect Blender."));}
    finally{if(current(token)&&operation.current===op)setBusy(false);}
  };
  const copy=async(which,value)=>{
    const token=epoch.current,op=operation.current;
    if(readOnlyRef.current||!current(token)||!value||(which==="code"&&Number.isFinite(expires)&&expires<=Date.now()))return;
    const ok=await bsCopySetupText(value);
    if(!current(token)||operation.current!==op||readOnlyRef.current)return;
    setCopied(v=>({...v,[which]:ok}));setManual(ok?"":which);
    setCopyMessage(ok?(which==="code"?"Pairing code copied.":"Function URL copied."):
      "Your browser blocked copying. Select the text below and copy it manually.");
  };
  const copyField=(label,value,which)=>E("div",{className:"bs-copy-field"},
    E("span",{className:"bs-copy-label"},label),
    E("code",{"data-testid":which==="code"?"blender-studio-code-value":"blender-studio-url-value"},value||"Unavailable"),
    E("button",{type:"button",className:"bs-copy-button",disabled:readOnly||!value||(which==="code"&&expired),
      "aria-label":which==="code"?"Copy pairing code":"Copy Function URL",
      "data-testid":which==="code"?"blender-studio-copy-code":"blender-studio-copy-url",onClick:()=>copy(which,value)},
       copied[which]?"Copied":"Copy"));
  const heading=(number,title,subtitle)=>E(React.Fragment,null,
    E("span",{className:"bs-step-number"},number),
    E("span",{className:"bs-step-label"},E("strong",null,title),E("small",null,subtitle)),
    E("span",{className:"bs-step-chevron","aria-hidden":"true"},"⌄"));
  return E(React.Fragment,null,
    E("li",{className:"bs-step","data-testid":"blender-studio-step-install"},
      E("details",{className:"bs-setup",open:installOpen,onToggle:e=>setInstallOpen(e.currentTarget.open)},
        E("summary",{className:"bs-step-heading"},heading("1","Install the Blender add-on","One-time setup · skip if already installed")),
        E("div",{className:"bs-step-body"},
          window.BlenderAddonDownload?E(window.BlenderAddonDownload):E("p",{className:"bs-help"},"The add-on download is unavailable in this build."),
          E("ol",{className:"bs-instructions"},
            E("li",null,"In Blender, open Preferences → Add-ons → the top-right menu → Install from Disk."),
            E("li",null,"Choose kinolot-blender.zip without unzipping it, then enable Kinolot Bridge.")),
          E("p",{className:"bs-help"},"Already installed? If Blender’s side panel shows a Kinolot tab, continue to step 2. No Kinolot tab means an older add-on: install this one to update it, then restart Blender.")))),
    E("li",{className:"bs-step","data-testid":"blender-studio-step-connect"},
      E("details",{className:"bs-setup",open:connectOpen,onToggle:e=>setConnectOpen(e.currentTarget.open)},
         E("summary",{className:"bs-step-heading"},heading("2","Connect Blender",connected?"Paired · confirm status in Blender":"Create a code here, then paste it in Blender")),
        E("div",{className:"bs-step-body"},
          E("p",{className:"bs-connection-status"+(connected?" bs-connected":""),role:"status","data-testid":"blender-studio-connection-status"},
             connected?"Paired with "+(connection.deviceName||"Blender desktop"):
              readOnly?"An editor manages the Blender connection.":connection?"Not connected":checking?"Checking connection…":"Connection not confirmed"),
           E("p",{className:"bs-help"},connected?"The website confirms pairing, not Blender’s live status. Check for “Status: Connected” in Blender before using desktop tools. You can prepare the set in step 3 meanwhile.":
            "Keep Blender open. Connecting is free and does not start a generation."),
          E("div",{className:"bs-actions"},
            connected?E("button",{type:"button",className:"bs-button",disabled:readOnly||busy,onClick:disconnect},"Disconnect desktop"):
              E("button",{type:"button",className:"bs-button bs-primary",disabled:readOnly||busy||!scopeRef.current,
                "data-testid":"blender-studio-pair",onClick:pairDesktop},busy?"Creating code…":pair?"Create a new code":"Create pairing code"),
            E("button",{type:"button",className:"bs-button",disabled:readOnly||checking||busy||!scopeRef.current,
              "data-testid":"blender-studio-check-connection",onClick:()=>refreshRef.current&&refreshRef.current()},checking?"Checking…":"Check connection")),
          pair&&!connected&&E("div",{className:"bs-pair"},
             E("p",{className:"bs-help"},"Use the Copy buttons below. In Blender's 3D view, press N and open the Kinolot tab. No Kinolot tab? Your add-on is older: install it again from step 1."),
             E("div",{className:"bs-pair-code"},
             copyField("Function URL",endpoint,"url"),copyField("Pair code",pairCode,"code"),
             E("small",{className:"bs-code-expiry"+(expired?" bs-error":""),"data-testid":"blender-studio-code-expiry"},
              expired?"This code has expired. Create a new code above.":Number.isFinite(expires)?
                "One-time code · expires in "+Math.max(1,Math.ceil((expires-now)/60000))+" min ("+new Date(expires).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})+")":
                 "One-time code · use it promptly and do not share it.")),
            copyMessage&&E("p",{className:"bs-copy-feedback",role:manual?"alert":"status","aria-live":"polite"},copyMessage),
            manual&&E("textarea",{className:"bs-manual-copy",readOnly:true,rows:3,value:manual==="code"?pairCode:endpoint,
              "aria-label":manual==="code"?"Pairing code for manual copying":"Function URL for manual copying",onFocus:e=>e.target.select()}),
            E("ol",{className:"bs-instructions"},
              E("li",null,"Paste the Function URL and Pair code into their matching fields."),
              E("li",null,"Tick “I approve this project”, then click Connect in Blender.")),
             E("p",{className:"bs-help"},"This panel confirms pairing automatically. Then check for “Status: Connected” in Blender.")),
          error&&E("p",{className:"bs-error",role:"alert"},error)))));
}
window.BlenderStudioSetup=BlenderStudioSetup;