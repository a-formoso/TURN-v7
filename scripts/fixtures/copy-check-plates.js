/* Procedural location plates for THE COPY CHECK (app/locations.jsx, 2026-10-14) — used by
   scripts/test-location-copy-check.mjs (node) and scripts/test-screenplay-pages-browser.mjs (a real canvas).
   A "world" is a quay of buildings (windows, doors), lamps, sky and water; a camera looks at it from a pan (the world x
   at the frame's left edge), a zoom and a horizon height. The parent's 2x2 plate is four cameras of one world.
   - COPIES: a parent panel's camera moved by at most 5% pan, 6% zoom or 3% tilt, re-rendered with another brightness,
     contrast, tint, noise, a blur and a window gone — what an image model does when it copies a reference panel;
   - DIFFERENT VIEWS: other cameras on the same world (pan, 1.6–3× zoom, another horizon) — the same place, another view;
   - NEIGHBOURS: cameras next to a parent's (15–26% pan, 1.3× zoom) — the hardest honest negatives;
   - OTHER WORLDS: another place entirely.
   Deterministic (seeded); RGBA pixel arrays only, no canvas. */
(function(root){
  "use strict";
  function rng(seed){
    const imul = Math.imul;
    let s = (imul(seed, 2654435761) >>> 0) || 1;
    return ()=>{ s = (imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function world(seed){
    const r = rng(seed), objs = [];
    const pal = [[150,80,60],[170,150,120],[120,110,100],[190,170,140],[90,70,60],[140,60,50]];
    let x = -1.2;
    while(x < 2.4){
      const w = 0.12 + 0.25*r(), h = 0.15 + 0.45*r(), c = pal[Math.floor(r()*pal.length)];
      objs.push({x, w, h, c, win:r() < 0.8, wr:2 + Math.floor(r()*4), wc:2 + Math.floor(r()*4), door:r() < 0.5});
      x += w + 0.02*r();
    }
    const lamps = []; for(let i=0;i<10;i++) lamps.push(-1.2 + 3.6*r());
    return {objs, lamps, sky:[[90+40*r(),130+40*r(),190+40*r()],[200+30*r(),190+30*r(),170+40*r()]], water:[40+20*r(),70+20*r(),80+30*r()]};
  }
  /* one camera's frame: W×H RGBA. pert: bright, contrast, tint [r,g,b], noise (±), noiseSeed, blur (3×3), dropWin */
  function render(W, H, wd, cam, pert){
    pert = pert || {};
    const px = new Uint8ClampedArray(W*H*4);
    const zoom = cam.zoom || 1, pan = cam.pan || 0, hor = cam.horizon == null ? 0.55 : cam.horizon;
    const nr = rng(pert.noiseSeed || 7);
    const bright = pert.bright || 0, contrast = pert.contrast || 1, tint = pert.tint || [0,0,0], noise = pert.noise || 0;
    const horY = H*hor, s0 = wd.sky[0], s1 = wd.sky[1], wa = wd.water;
    // what each column sees (the buildings never overlap): its world x, its building, a lamp
    const colX = new Float64Array(W), colObj = new Array(W), colLamp = new Uint8Array(W);
    for(let x=0;x<W;x++){
      const X = pan + (x/W)/zoom;
      colX[x] = X;
      colObj[x] = wd.objs.find(o=>X >= o.x && X < o.x+o.w) || null;
      colLamp[x] = wd.lamps.some(L=>Math.abs(X-L) < 0.004) ? 1 : 0;
    }
    const lampTop = horY-0.3*H*zoom, c = [0,0,0], sin = Math.sin, floor = Math.floor;   // no global look-ups per pixel
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const i = (y*W+x)*4;
      if(y < horY){ const t = y/horY; for(let k=0;k<3;k++) c[k] = s0[k]*(1-t)+s1[k]*t; }
      else { const t = (y-horY)/(H-horY), w = 10*Math.sin((y-horY)*0.9*zoom+x*0.02); for(let k=0;k<3;k++) c[k] = wa[k]*(1-0.3*t)+w; }
      const o = colObj[x];
      if(o){
        const top = horY - o.h*H*zoom;
        if(y >= top && y < horY){
          c[0] = o.c[0]; c[1] = o.c[1]; c[2] = o.c[2];
          const X = colX[x];
          if(o.win){
            const u = (X-o.x)/o.w, v = (y-top)/(horY-top), cu = u*o.wc, cv = v*o.wr;
            if(cu%1 > 0.3 && cu%1 < 0.7 && cv%1 > 0.3 && cv%1 < 0.75 && !(pert.dropWin && floor(cu)===1 && floor(cv)===0)){ c[0] = 40; c[1] = 40; c[2] = 50; }
          }
          if(o.door){ const u = (X-o.x)/o.w; if(u > 0.4 && u < 0.6 && y > horY-0.25*(horY-top)){ c[0] = 60; c[1] = 40; c[2] = 30; } }
        }
      }
      if(colLamp[x] && y > lampTop && y < horY){ c[0] = 30; c[1] = 30; c[2] = 30; }
      for(let k=0;k<3;k++){
        const v = (c[k]-128)*contrast + 128 + bright + tint[k] + (noise ? (nr()-0.5)*2*noise : 0);
        px[i+k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      px[i+3] = 255;
    }
    if(pert.blur){
      const out = new Uint8ClampedArray(px);
      for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++) for(let k=0;k<3;k++){
        let t = 0; for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) t += px[((y+dy)*W+x+dx)*4+k];
        out[(y*W+x)*4+k] = t/9;
      }
      return out;
    }
    return px;
  }
  /* a 2x2 plate (white grid lines between the panels) from four {px,w,h} panels, as {px,w,h} */
  function sheet(W, H, panels){
    const px = new Uint8ClampedArray(W*H*4).fill(255), pw = Math.floor(W/2), ph = Math.floor(H/2);
    panels.forEach((p,n)=>{
      const ox = (n%2)*pw, oy = Math.floor(n/2)*ph;
      for(let y=2;y<ph-2;y++) for(let x=2;x<pw-2;x++){
        const sx = Math.floor(x*p.w/pw), sy = Math.floor(y*p.h/ph), si = (sy*p.w+sx)*4, di = ((oy+y)*W+ox+x)*4;
        for(let k=0;k<4;k++) px[di+k] = p.px[si+k];
      }
    });
    return {px, w:W, h:H};
  }
  const KEYS = ["TL","TR","BL","BR"];
  const CAMS = [{pan:0,zoom:1,horizon:0.55},{pan:0.9,zoom:1,horizon:0.6},{pan:0.3,zoom:2.2,horizon:0.8},{pan:-0.6,zoom:0.7,horizon:0.35}];
  const copyPerts = (c, seed, ci)=>[
    {cam:{...c,pan:c.pan+0.03/c.zoom}, p:{bright:18,contrast:0.85,noise:10,noiseSeed:seed*11+ci,tint:[12,0,-8]}},
    {cam:{...c,zoom:c.zoom*1.06,horizon:c.horizon+0.02}, p:{bright:-15,contrast:1.15,noise:14,blur:1,dropWin:1}},
    {cam:{...c,pan:c.pan-0.05/c.zoom,horizon:c.horizon-0.03}, p:{bright:5,contrast:0.9,noise:20,tint:[-10,5,15]}}
  ];
  const DIFF_CAMS = [{pan:0.45,zoom:1,horizon:0.55},{pan:0,zoom:1.6,horizon:0.55},{pan:1.4,zoom:1.3,horizon:0.45},
    {pan:0.6,zoom:3,horizon:0.9},{pan:-0.3,zoom:1,horizon:0.4},{pan:0.2,zoom:0.8,horizon:0.7}];
  const NEIGHBOUR_CAMS = [{pan:0.15,zoom:1,horizon:0.55},{pan:0,zoom:1.3,horizon:0.6},{pan:1.1,zoom:1,horizon:0.6},{pan:0.42,zoom:2.2,horizon:0.8}];
  /* one world's fixtures. PW×PH: a parent panel; a single-frame child is rendered at 2PW×2PH (a full plate's size) */
  function cases(seed, PW, PH){
    PW = PW || 192; PH = PH || 108;
    const wd = world(seed), FW = PW*2, FH = PH*2;
    const parent = sheet(PW*2+4, PH*2+4, CAMS.map(c=>({px:render(PW,PH,wd,c), w:PW, h:PH})));
    const frame = (cam, p)=>({px:render(FW,FH,wd,cam,p), w:FW, h:FH});
    const copies = [], different = [], neighbours = [];
    CAMS.forEach((c,ci)=>copyPerts(c,seed,ci).forEach((q,qi)=>copies.push({label:"copy s"+seed+" "+KEYS[ci]+" v"+qi, of:KEYS[ci], img:frame(q.cam,q.p)})));
    DIFF_CAMS.forEach((c,i)=>different.push({label:"different s"+seed+" d"+i, img:frame(c,{noise:8,noiseSeed:99+i})}));
    NEIGHBOUR_CAMS.forEach((c,i)=>neighbours.push({label:"neighbour s"+seed+" n"+i, img:frame(c,{noise:8,noiseSeed:199+i})}));
    const other = {label:"other world s"+seed, img:{px:render(FW,FH,world(seed+100),{pan:0,zoom:1,horizon:0.55}), w:FW, h:FH}};
    // the same cameras at night (dark sky and water) — the documented limit: usually NOT caught
    const nightWorld = {...wd, sky:[[10,15,40],[30,30,60]], water:[10,15,25]};
    const night = CAMS.map((c,ci)=>({label:"night copy s"+seed+" "+KEYS[ci], of:KEYS[ci],
      img:{px:render(FW,FH,nightWorld,c,{bright:-30,noise:8}), w:FW, h:FH}}));
    return {seed, parent, copies, different, neighbours, other, night, world:wd};
  }
  root.copyCheckFixtures = {rng, world, render, sheet, cases, KEYS, CAMS, DIFF_CAMS, NEIGHBOUR_CAMS};
})(typeof window!=="undefined" ? window : globalThis);
