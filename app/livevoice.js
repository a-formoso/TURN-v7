/* livevoice.js — GPT-Live voice transport for the New Story conversation with Frances (the
   help assistant; codename MUSE in code). Every message here is user-facing: it names Kinolot
   or Frances, never the internal codename (TURN) or the deployment. The browser owns only WebRTC
   media + session events. A signed-in call to the app's server proxy exchanges the SDP offer for an answer, so the service key never
   enters the page. The story UI consumes this small transport through
   turnStartLiveVoice(); it decides how transcripts become loglines. */
(function(){
  "use strict";

  function liveVoiceSupport(){
    if(typeof window === "undefined" || typeof navigator === "undefined")
      return { ok:false, reason:"Live voice isn’t available in this environment." };
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(String(location.hostname||""));
    if(location.protocol !== "https:" && !local)
      return { ok:false, reason:"Live voice needs a secure page. Open Kinolot over HTTPS (or http://localhost:5000) instead of the local file." };
    if(typeof window.RTCPeerConnection !== "function" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return { ok:false, reason:"This browser doesn’t support live voice. Try Chrome or Edge, or use the typed interview." };
    if(!(window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxy))
      return { ok:false, reason:"Live voice isn’t switched on here yet. You can use the typed interview instead." };
    if(typeof window.sbClient !== "function" || !window.sbClient())
      return { ok:false, reason:"Sign in to start live voice." };
    return { ok:true, reason:"" };
  }

  function safeMessage(value){
    const raw = String(value||"").trim();
    return (window.turnSafeError || (s=>s))(raw) || "Couldn’t start live voice.";
  }

  function liveProxyMessage(value){
    const message=safeMessage(value);
    // A proxy deployed before task:"live" existed falls through to the image route and
    // answers with this otherwise-confusing validation error. Only an admin can redeploy,
    // so only an admin is told how.
    if(/no prompt supplied/i.test(message))
      return window.turnIsAdmin
        ? "The live-voice backend is out of date. Deploy the updated image-proxy function, then choose Try live again."
        : "The live-voice backend is out of date, so live voice can’t start right now. You can use the typed interview in the meantime.";
    return message;
  }

  /* FRANCES'S DAILY LIMIT COVERS VOICE (owner decision 2026-09-29): each voice session uses one of
     the same free daily questions as the chat. Past them the server answers 429
     { error:"frances_daily_limit", limit, resets_at }, and during a burst of parallel starts 429
     { error:"frances_busy" }; either way it opens no session. Both become calm lines (Error.code
     says which), asked once and never retried; the typed interview is unaffected. The countdown
     is the chat's own (francesBackIn, app/ai.jsx); the fallback 50 is FRANCES_DAILY_LIMIT there. */
  const LIVE_BUSY_LINE = "One conversation at a time, please — try again in a moment.";
  function liveLimitLine(info){
    const i = info || {};
    const n = Math.floor(Number(i.limit));
    const limit = n > 0 ? n : 50;
    let when = "";
    try{ when = typeof window.francesBackIn === "function" ? String(window.francesBackIn(i.resets_at || i.resetsAt) || "") : ""; }catch(_e){}
    return "That’s today’s "+limit+" free "+(limit===1 ? "question" : "questions")+" with Frances — voice included. She’ll be back after midnight UTC"+when+". You can use the typed interview in the meantime.";
  }
  function liveLimitError(body){
    if(!body || typeof body !== "object") return null;
    if(body.error === "frances_daily_limit"){
      const e = new Error(liveLimitLine(body));
      e.code = "frances_daily_limit";
      e.francesLimit = { limit:Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : 50, resetsAt:body.resets_at || body.resetsAt || null };
      return e;
    }
    if(body.error === "frances_busy"){ const e = new Error(LIVE_BUSY_LINE); e.code = "frances_busy"; return e; }
    return null;
  }
  async function liveLimitFromError(error){
    const status = Number((error && error.context && error.context.status) || (error && error.status) || 0);
    const response = error && error.context;
    if(status !== 429 || !response || typeof response.clone !== "function") return null;
    try{ return liveLimitError(await response.clone().json()); }catch(_e){ return null; }
  }

  async function proxyErrorMessage(error){
    const status = Number((error && error.context && error.context.status) || (error && error.status) || 0);
    if(status === 401) return "Sign in to talk with Frances.";
    if(status === 404) return window.turnIsAdmin
      ? "The media proxy isn’t deployed yet. Deploy its live-voice route, then try again."
      : "Live voice isn’t available right now. You can use the typed interview in the meantime.";
    const response = error && error.context;
    if(response && typeof response.clone === "function"){
      try{
        const body = await response.clone().json();
        if(body && (body.error || body.message)) return liveProxyMessage(body.error || body.message);
      }catch(_e){}
    }
    return safeMessage("Couldn’t reach Frances: "+((error && error.message) || "unknown connection error")+".");
  }

  function waitForIce(peer){
    if(peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const timer = window.setTimeout(()=>{
        peer.removeEventListener("icegatheringstatechange", onState);
        reject(new Error("Live voice timed out while opening the audio connection."));
      },10000);
      function onState(){
        if(peer.iceGatheringState !== "complete") return;
        window.clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", onState);
        resolve();
      }
      peer.addEventListener("icegatheringstatechange",onState);
      onState();
    });
  }

  async function createProxySession(sdp, mode, context){
    const sb = window.sbClient();
    const fnName = (window.TURN_SUPABASE && window.TURN_SUPABASE.imageProxyFn) || "image-proxy";
    let data, error;
    try{
      ({data,error} = await sb.functions.invoke(fnName,{body:{
        task:"live",
        mode:mode || "new-story",
        sdp,
        context:context || {},
        userApiKeys:window.turnApiKeysForProxy ? window.turnApiKeysForProxy(["openai"]) : undefined,
      }}));
    }catch(e){ error=e; }
    if(error) throw (await liveLimitFromError(error)) || new Error(await proxyErrorMessage(error));
    if(data && data.error) throw liveLimitError(data) || new Error(liveProxyMessage(data.error));
    if(!(data && data.transport && data.transport.sdp))
      throw new Error(window.turnIsAdmin
        ? "Frances opened no usable audio connection. Redeploy the live-voice proxy and try again."
        : "Frances couldn’t open an audio connection. Try live voice again, or use the typed interview.");
    return data;
  }

  /* Start one live conversation with Frances. Callbacks:
       onTranscript({role,delta,startMs,endMs,event})
       onStatus("connecting"|"listening"|"speaking"|"muted"|"closing"|"closed")
       onError(message), onPlaybackBlocked()
     Resolves only after session.started, and returns {close,mute,play,sessionId}. */
  async function turnStartLiveVoice(options){
    options = options || {};
    const support = liveVoiceSupport();
    if(!support.ok) throw new Error(support.reason);

    const onStatus = typeof options.onStatus === "function" ? options.onStatus : function(){};
    const onTranscript = typeof options.onTranscript === "function" ? options.onTranscript : function(){};
    const onError = typeof options.onError === "function" ? options.onError : function(){};
    const onPlaybackBlocked = typeof options.onPlaybackBlocked === "function" ? options.onPlaybackBlocked : function(){};
    let peer=null, events=null, microphone=null, speakingTimer=0, startupTimer=0;
    let started=false, finalized=false, cleaned=false, muted=false, sessionId="", closeTask=null;
    let resolveStarted, rejectStarted, resolveClosed;
    const startedPromise = new Promise((resolve,reject)=>{ resolveStarted=resolve; rejectStarted=reject; });
    const closedPromise = new Promise(resolve=>{ resolveClosed=resolve; });
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;

    function cleanup(){
      if(cleaned) return;
      cleaned=true;
      window.clearTimeout(speakingTimer);
      window.clearTimeout(startupTimer);
      try{ microphone && microphone.getTracks().forEach(track=>track.stop()); }catch(_e){}
      try{ events && events.close(); }catch(_e){}
      try{ peer && peer.close(); }catch(_e){}
      try{ audio.pause(); audio.srcObject=null; }catch(_e){}
    }
    function send(payload){
      if(!events || events.readyState !== "open") return false;
      try{ events.send(JSON.stringify(payload)); return true; }catch(_e){ return false; }
    }
    function noteSpeaking(){
      if(muted) return;
      onStatus("speaking");
      window.clearTimeout(speakingTimer);
      speakingTimer = window.setTimeout(()=>{ if(!finalized && !muted) onStatus("listening"); },1200);
    }
    function handleEvent(event){
      if(!event || !event.type) return;
      if(event.type === "session.started"){
        started=true;
        sessionId=String((event.session && event.session.id)||sessionId||"");
        onStatus("listening");
        resolveStarted(event);
        // The HTTP request starts the session; never send session.start here.
        send({
          type:"session.commentary.append",
          event_id:"turn_muse_begin_"+Date.now(),
          delegation_id:null,
          content:"Begin the New Story conversation now, following your startup instructions. Greet the writer warmly, ask one short opening question, then pause and listen.",
        });
        return;
      }
      if(event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta"){
        const delta=String(event.delta||"");
        if(delta) onTranscript({
          role:event.type.indexOf("input_")>=0 ? "user" : "assistant",
          delta,
          startMs:Number(event.start_ms)||0,
          endMs:Number(event.end_ms)||0,
          event,
        });
        if(event.type === "session.output_transcript.delta") noteSpeaking();
        else if(!muted) onStatus("listening");
        return;
      }
      if(event.type === "session.usage.updated"){
        if(typeof options.onUsage === "function") options.onUsage(event.usage||{});
        return;
      }
      if(event.type === "session.closed"){
        finalized=true;
        onStatus("closed");
        resolveClosed(event);
        cleanup();
        return;
      }
      if(event.type === "error"){
        const msg=safeMessage((event.error && event.error.message)||"The live conversation hit an audio error.");
        onError(msg,event);
      }
    }

    onStatus("connecting");
    try{
      peer = new RTCPeerConnection();
      peer.addEventListener("track",event=>{
        const track=event.track;
        audio.srcObject=new MediaStream([track]);
        audio.play().catch(()=>onPlaybackBlocked());
      });
      peer.addEventListener("connectionstatechange",()=>{
        if(cleaned || finalized) return;
        if(peer.connectionState === "failed") onError("The live audio connection to Frances failed. Try live voice again or continue by typing.");
      });
      microphone = await navigator.mediaDevices.getUserMedia({audio:true});
      microphone.getAudioTracks().forEach(track=>peer.addTrack(track,microphone));

      // GPT-Live requires the channel and listeners before the SDP offer exists.
      events = peer.createDataChannel("oai-events");
      events.addEventListener("message",({data})=>{
        try{ handleEvent(JSON.parse(data)); }catch(_e){}
      });
      events.addEventListener("close",()=>{
        if(cleaned || finalized) return;
        const msg=started
          ? "Frances disconnected before the conversation finished. Your transcript is still here."
          : "The live connection to Frances closed before it was ready.";
        rejectStarted(new Error(msg));
        onError(msg);
        cleanup();
      });

      const offer=await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      const sdp=peer.localDescription && peer.localDescription.sdp;
      if(!sdp) throw new Error("The browser didn’t create a live audio offer.");
      const result=await createProxySession(sdp,options.mode,options.context);
      sessionId=String((result.session && result.session.id)||"");
      await peer.setRemoteDescription({type:"answer",sdp:result.transport.sdp});
      startupTimer=window.setTimeout(()=>rejectStarted(new Error("The live session with Frances didn’t become ready in time.")),15000);
      await startedPromise;
      window.clearTimeout(startupTimer);
    }catch(error){
      cleanup();
      throw error;
    }

    async function close(closeOptions){
      if(closeTask) return closeTask;
      const timeoutMs=Math.max(500,Number(closeOptions && closeOptions.timeoutMs)||3500);
      closeTask=(async()=>{
        if(finalized){ cleanup(); return; }
        onStatus("closing");
        if(started && send({type:"session.close",event_id:"turn_muse_close_"+Date.now()})){
          await Promise.race([closedPromise,new Promise(resolve=>window.setTimeout(resolve,timeoutMs))]);
        }
        cleanup();
      })();
      return closeTask;
    }
    function mute(next){
      muted=typeof next === "boolean" ? next : !muted;
      try{ microphone && microphone.getAudioTracks().forEach(track=>{ track.enabled=!muted; }); }catch(_e){}
      onStatus(muted?"muted":"listening");
      return muted;
    }
    async function play(){
      await audio.play();
      return true;
    }
    return {close,mute,play,get muted(){return muted;},get sessionId(){return sessionId;}};
  }

  window.turnLiveVoiceSupport=liveVoiceSupport;
  window.turnStartLiveVoice=turnStartLiveVoice;
})();
