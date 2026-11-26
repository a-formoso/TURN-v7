/* blockout-film.js — A FILM MADE IN THE BROWSER (stage 4 of a beat broken down in code, owner 2026-11-26: "decide
   whether or not we should have the previs/blockout video sent to the stage for precise control in video generation";
   decided yes, in clay, for shots where something travels).
   The pictures of a shot's blockout become ONE video file a video engine can be given. The server measures a
   reference video to charge its true length, and it can only measure a plain MP4 (not one cut into fragments: that
   one is charged at the longest length allowed, image-proxy/media-length.mjs). A browser's own recorder makes
   fragmented files, so the file is written here:
     mp4({width, height, fps, avcC, samples:[{data, key}]})   → the bytes of a plain MP4 (ftyp, moov, mdat): one
        H.264 video track, each sample one picture in order, every picture the same length
     encode(pictures, {width, height, fps})   → those bytes, from pictures (canvases or bitmaps, in film order; the
        same one may come many times). Uses the browser's own H.264 encoder; throws a plain sentence when it has none.
     dataUrl(bytes)   → "data:video/mp4;base64,…"
   scripts/test-blockout-film.mjs writes a file and reads its length back with the server's own reader. */
(function(root){
  "use strict";
  const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255], u16=n=>[(n>>>8)&255,n&255], str=t=>Array.from(String(t)).map(c=>c.charCodeAt(0)&255);
  const zeros=n=>new Array(n).fill(0);
  const cat=parts=>{ let len=0; parts.forEach(p=>{ len+=p.length; }); const out=new Uint8Array(len); let at=0; parts.forEach(p=>{ out.set(p,at); at+=p.length; }); return out; };
  const box=(type,...parts)=>{ const body=cat(parts.map(p=>p instanceof Uint8Array?p:Uint8Array.from(p))); return cat([Uint8Array.from(u32(body.length+8).concat(str(type))),body]); };
  const MATRIX=[].concat(u32(0x00010000),u32(0),u32(0),u32(0),u32(0x00010000),u32(0),u32(0),u32(0),u32(0x40000000));
  function mp4(o){
    const w=Math.round(Number(o&&o.width)||0), h=Math.round(Number(o&&o.height)||0), fps=Math.round(Number(o&&o.fps)||0);
    const samples=((o&&o.samples)||[]).filter(s=>s&&s.data&&s.data.length), avcC=o&&o.avcC?(o.avcC instanceof Uint8Array?o.avcC:new Uint8Array(o.avcC)):null;
    if(!(w>0&&h>0&&fps>0)||!samples.length||!avcC||!avcC.length) throw new Error("The film has no pictures to write.");
    const n=samples.length, delta=1000, scale=fps*delta, duration=n*delta;
    const ftyp=box("ftyp",str("isom"),u32(0x200),str("isomiso2avc1mp41"));
    const keys=samples.map((s,i)=>s.key?i+1:0).filter(Boolean);
    const stbl=offset=>box("stbl",
      box("stsd",u32(0),u32(1),box("avc1",zeros(6),u16(1),zeros(16),u16(w),u16(h),u32(0x00480000),u32(0x00480000),u32(0),u16(1),zeros(32),u16(0x0018),u16(0xffff),box("avcC",avcC))),
      box("stts",u32(0),u32(1),u32(n),u32(delta)),
      box("stss",u32(0),u32(keys.length||1),...(keys.length?keys:[1]).map(k=>u32(k))),
      box("stsc",u32(0),u32(1),u32(1),u32(n),u32(1)),
      box("stsz",u32(0),u32(0),u32(n),...samples.map(s=>u32(s.data.length))),
      box("stco",u32(0),u32(1),u32(offset)));
    const moov=offset=>box("moov",
      box("mvhd",u32(0),u32(0),u32(0),u32(scale),u32(duration),u32(0x00010000),u16(0x0100),zeros(10),MATRIX,zeros(24),u32(2)),
      box("trak",
        box("tkhd",u32(3),u32(0),u32(0),u32(1),u32(0),u32(duration),zeros(8),u16(0),u16(0),u16(0),u16(0),MATRIX,u32(w<<16),u32(h<<16)),
        box("mdia",
          box("mdhd",u32(0),u32(0),u32(0),u32(scale),u32(duration),u16(0x55c4),u16(0)),
          box("hdlr",u32(0),u32(0),str("vide"),zeros(12),str("VideoHandler"),[0]),
          box("minf",box("vmhd",u32(1),zeros(8)),box("dinf",box("dref",u32(0),u32(1),box("url ",u32(1)))),stbl(offset)))));
    // (the samples start after ftyp, moov and mdat's own eight bytes: moov is the same size whatever the number says)
    const first=ftyp.length+moov(0).length+8;
    return cat([ftyp,moov(first),box("mdat",...samples.map(s=>s.data))]);
  }
  async function encode(pictures,o){
    const w=Math.round(Number(o&&o.width)||0), h=Math.round(Number(o&&o.height)||0), fps=Math.round(Number(o&&o.fps)||12), list=pictures||[];
    if(typeof root.VideoEncoder!=="function"||typeof root.VideoFrame!=="function") throw new Error("This browser cannot make the film. Use a current Chrome, Edge or Safari.");
    if(!list.length||w%2||h%2) throw new Error("The film has no pictures to write.");
    const config={codec:"avc1.42E01F",width:w,height:h,bitrate:1500000,framerate:fps,avc:{format:"avc"}};
    let ok=null; try{ ok=await root.VideoEncoder.isConfigSupported(config); }catch(_){ ok=null; }
    if(!ok||!ok.supported) throw new Error("This browser cannot make the film. Use a current Chrome, Edge or Safari.");
    const samples=[]; let avcC=null, fail=null;
    const enc=new root.VideoEncoder({error:e=>{ fail=e; },output:(chunk,meta)=>{ const data=new Uint8Array(chunk.byteLength); chunk.copyTo(data); samples.push({data,key:chunk.type==="key"});
      const d=meta&&meta.decoderConfig&&meta.decoderConfig.description; if(d&&!avcC) avcC=d instanceof Uint8Array?d.slice():new Uint8Array(d.buffer?d.buffer.slice(d.byteOffset||0,(d.byteOffset||0)+d.byteLength):d); }});
    enc.configure(config);
    for(let i=0;i<list.length;i++){ if(fail) break;
      const frame=new root.VideoFrame(list[i],{timestamp:Math.round(i*1e6/fps),duration:Math.round(1e6/fps)});
      try{ enc.encode(frame,{keyFrame:i%fps===0}); }finally{ frame.close(); }
      if(enc.encodeQueueSize>8) await new Promise(r=>root.setTimeout(r,0)); }
    await enc.flush(); try{ enc.close(); }catch(_){}
    if(fail) throw new Error("The film could not be made: "+String((fail&&fail.message)||fail));
    if(!avcC||samples.length!==list.length) throw new Error("The film could not be made: the encoder gave no pictures back.");
    return mp4({width:w,height:h,fps,avcC,samples});
  }
  function dataUrl(bytes){
    let bin=""; const step=0x8000; for(let i=0;i<bytes.length;i+=step) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+step));
    return "data:video/mp4;base64,"+root.btoa(bin);
  }
  root.KinolotBlockoutFilm={mp4,encode,dataUrl};
})(typeof window!=="undefined"?window:globalThis);
