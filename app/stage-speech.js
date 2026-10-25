/* HEARING WHERE THE SPEECH LANDED (owner 2026-10-25, option C). A clip's plan says when each line should be
   spoken (stage-plan.jsx beatTimeline); the model paces the take its own way. Once a take exists, its soundtrack
   is read here, in the browser — no upload, no model, no credits: the speech band (300–3400 Hz) is compared with
   the whole sound, frame by frame, and the stretches loud and voice-like enough are "speech". The clip's lines
   are then matched to them in order (each to the nearest stretch not used yet), so the Mix and the export lay a
   voiced line where the picture speaks it, and the Takes tab says where the speech was heard. It's a listening
   aid, not transcription: a clang or a shout can read as speech, so the planned time is always shown beside it. */
(function(root){
  "use strict";
  const FRAME_SEC=0.02, RATE=16000;
  const r1=v=>Math.round((Number(v)||0)*10)/10;

  /* frames of speech-band and whole-band energy (mean square) → speech stretches [[start,end],…] in seconds */
  function speechRegions(band,full,frameSec,opts){
    opts=opts||{};
    const step=Number(frameSec)||FRAME_SEC;
    const n=Math.min((band||[]).length,(full||[]).length);
    if(!n) return [];
    const db=v=>10*Math.log10(Math.max(Number(v)||0,1e-12));
    const bandDb=new Array(n);
    for(let i=0;i<n;i++) bandDb[i]=db(band[i]);
    const sorted=bandDb.slice().sort((a,b)=>a-b);
    const floor=sorted[Math.floor((n-1)*0.2)];    // the quietest fifth: the room
    const peak=sorted[Math.floor((n-1)*0.98)];
    const thr=Math.max(floor+(opts.aboveFloorDb||10),peak-(opts.belowPeakDb||30),opts.minDb!=null?opts.minDb:-60);
    const ratio=opts.ratio!=null?opts.ratio:0.35;   // most of the sound sits in the voice band
    const on=new Array(n);
    for(let i=0;i<n;i++) on[i]=bandDb[i]>=thr && Number(band[i])>=ratio*Number(full[i]);
    const minRun=Math.max(1,Math.round((opts.minSec||0.25)/step)), bridge=Math.round((opts.bridgeSec||0.25)/step);
    const out=[];let s=-1,lastOn=-1;
    for(let i=0;i<=n;i++){
      if(i<n&&on[i]){ if(s<0)s=i; lastOn=i; continue; }
      if(s>=0&&(i===n||i-lastOn>bridge)){
        if(lastOn-s+1>=minRun) out.push([r1(s*step),r1((lastOn+1)*step)]);
        s=-1;
      }
    }
    return out;
  }

  /* lines in their order (each {at}) → the heard onset for each, or null: each line takes the nearest
     stretch after the one the line before it took */
  function matchHeard(lines,regions){
    const onsets=(regions||[]).map(r=>Number(r&&r[0])).filter(v=>Number.isFinite(v));
    let from=0;
    return (lines||[]).map(pl=>{
      let best=-1,bd=Infinity;
      for(let i=from;i<onsets.length;i++){ const d=Math.abs(onsets[i]-(Number(pl&&pl.at)||0)); if(d<bd){bd=d;best=i;} }
      if(best<0) return null;
      from=best+1;
      return onsets[best];
    });
  }

  const pending=new Map(), done=new Map();
  async function frameEnergy(samples,step){
    const frames=Math.floor(samples.length/step), out=new Float64Array(frames);
    for(let f=0;f<frames;f++){ let sum=0; const o=f*step; for(let i=0;i<step;i++){ const v=samples[o+i]; sum+=v*v; } out[f]=sum/step; }
    return out;
  }
  /* a take's video url → { v, regions, durationSec, noAudio, at } (null when it can't be read) */
  function hearSpeech(url){
    const key=String(url||"");
    if(!key) return Promise.resolve(null);
    if(done.has(key)) return Promise.resolve(done.get(key));
    if(pending.has(key)) return pending.get(key);
    const job=(async()=>{
      const AC=root.OfflineAudioContext||root.webkitOfflineAudioContext;
      if(!AC||typeof root.fetch!=="function") return null;
      const res=await root.fetch(key); if(!res.ok) return null;
      const buf=await res.arrayBuffer();
      let decoded;
      try{ decoded=await new AC(1,RATE,RATE).decodeAudioData(buf); }
      catch(e){ return { v:1, regions:[], durationSec:0, noAudio:true, at:new Date().toISOString() }; }
      const len=Math.max(1,Math.ceil(decoded.duration*RATE));
      const render=async(filters)=>{
        const ctx=new AC(1,len,RATE), src=ctx.createBufferSource(); src.buffer=decoded;
        let node=src;
        filters.forEach(([type,hz])=>{ const b=ctx.createBiquadFilter(); b.type=type; b.frequency.value=hz; node.connect(b); node=b; });
        node.connect(ctx.destination); src.start();
        return (await ctx.startRendering()).getChannelData(0);
      };
      const step=Math.round(RATE*FRAME_SEC);
      const full=await frameEnergy(await render([]),step);
      const band=await frameEnergy(await render([["highpass",300],["highpass",300],["lowpass",3400],["lowpass",3400]]),step);
      return { v:1, regions:speechRegions(band,full,FRAME_SEC), durationSec:r1(decoded.duration), noAudio:false, at:new Date().toISOString() };
    })().catch(()=>null);
    pending.set(key,job);
    job.then(r=>{ pending.delete(key); if(r){ done.set(key,r); try{ root.dispatchEvent(new CustomEvent("stage-speech-heard",{ detail:{ url:key } })); }catch(e){} } });
    return job;
  }
  /* what was heard for a take already read in this visit (sync), else null */
  function heardFor(url){ return done.get(String(url||""))||null; }

  root.stageSpeechRegions=speechRegions;
  root.stageMatchHeard=matchHeard;
  root.stageHearSpeech=hearSpeech;
  root.stageHeardFor=heardFor;
})(typeof window!=="undefined"?window:globalThis);
