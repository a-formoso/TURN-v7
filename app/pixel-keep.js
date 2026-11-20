/* pixel-keep.js — KEEP THE ORIGINAL, ADD ONLY THE ITEM (owner 2026-11-19).

   An image engine redraws the whole picture even when it is asked for one small change: on the owner's own sheets a
   "change nothing else" edit still changed 99.7% and 99.9% of the pixels (the face, the coat's shading, the cuffs).
   The owner's rule: "everything that was in the first image [must] be brought back out … only with a slight addition
   of the … worn props being added". So the engine's picture is never the result. The result is the ORIGINAL, pixel
   for pixel, with only the places where the new items were drawn taken from the engine's picture.

   The split of work:
     - a vision model LOOKS at the engine's picture and says roughly where each item is (a box);
     - this file does everything else in plain code, and never guesses a pixel:
         pkAlign    lines the engine's picture up with the original around that box (it shifts and resizes things);
         pkCompose  finds, inside the lined-up box, the pixels that really changed, and copies only those across;
         pkCount    counts, pixel by pixel, how many differ from the original (what the app then tells the person).

   Pictures are plain {width, height, data} with RGBA bytes (a canvas ImageData fits), both the same size. No DOM, so
   scripts/test-pixel-keep.mjs runs it under node. */
(function(root){
  "use strict";
  function lumOf(img){
    const n = img.width*img.height, d = img.data, L = new Uint8Array(n);
    for(let i=0,j=0;i<n;i++,j+=4) L[i] = (d[j]*30 + d[j+1]*59 + d[j+2]*11) / 100;
    return L;
  }
  const clamp = (v,a,b)=> v<a ? a : (v>b ? b : v);
  /* a box as [x0,y0,x1,y1] in pixels, made whole and kept inside the picture */
  function pkBox(b, w, h){
    const x0 = clamp(Math.floor(Math.min(b[0],b[2])),0,w-1), y0 = clamp(Math.floor(Math.min(b[1],b[3])),0,h-1);
    const x1 = clamp(Math.ceil(Math.max(b[0],b[2])),x0+1,w), y1 = clamp(Math.ceil(Math.max(b[1],b[3])),y0+1,h);
    return [x0,y0,x1,y1];
  }

  /* LINE THE TWO PICTURES UP AROUND A BOX. `box` is where the item is in the EDIT. The surroundings of the box (never
     its inside, which is what changed) are compared with the original at many small shifts and sizes; the best one
     says where that neighbourhood sits in the original. Returns {s, tx, ty, score, flat}: a point of the original
     maps into the edit as  xe = cx + (xo - cx - tx) * s  (and the same for y), with cx,cy the box's centre.
     score = the average brightness difference of the surroundings once lined up (0 = identical). */
  function pkAlign(orig, edit, box, opts){
    const o = opts||{}, w = orig.width, h = orig.height;
    const LO = o.lumOrig || lumOf(orig), LE = o.lumEdit || lumOf(edit);
    const b = pkBox(box, w, h), bw = b[2]-b[0], bh = b[3]-b[1], cx = (b[0]+b[2])/2, cy = (b[1]+b[3])/2;
    const m = Math.round(clamp(Math.max(bw,bh)*1.1, 36, 150));          // how far around the box to look
    const R = Math.round(clamp(o.maxShift || Math.max(bw,bh)*0.8, 16, 36));   // the largest shift tried
    const wx0 = clamp(b[0]-m,0,w-1), wy0 = clamp(b[1]-m,0,h-1), wx1 = clamp(b[2]+m,1,w), wy1 = clamp(b[3]+m,1,h);
    const step = Math.max(1, Math.round(Math.sqrt(((wx1-wx0)*(wy1-wy0)) / 2600)));
    const px = [], py = [], pv = [];
    for(let y=wy0;y<wy1;y+=step) for(let x=wx0;x<wx1;x+=step){
      if(x>=b[0]-3 && x<b[2]+3 && y>=b[1]-3 && y<b[3]+3) continue;       // the item itself is not evidence
      px.push(x); py.push(y); pv.push(LE[y*w+x]);
    }
    const n = px.length;
    if(n < 24) return { s:1, tx:0, ty:0, score:0, flat:true, n };
    // how much there is to hold on to: a flat grey ground lines up with anything
    let mean = 0; for(let i=0;i<n;i++) mean += pv[i]; mean /= n;
    let dev = 0; for(let i=0;i<n;i++) dev += Math.abs(pv[i]-mean); dev /= n;
    const cost = (s, tx, ty, bilinear)=>{
      let e = 0;
      for(let i=0;i<n;i++){
        const xo = cx + tx + (px[i]-cx)/s, yo = cy + ty + (py[i]-cy)/s;
        if(xo<0 || yo<0 || xo>w-1.001 || yo>h-1.001){ e += 40; continue; }
        let v;
        if(bilinear){ const x0 = xo|0, y0 = yo|0, fx = xo-x0, fy = yo-y0, k = y0*w+x0;
          v = LO[k]*(1-fx)*(1-fy) + LO[k+1]*fx*(1-fy) + LO[k+w]*(1-fx)*fy + LO[k+w+1]*fx*fy; }
        else v = LO[((yo+0.5)|0)*w + ((xo+0.5)|0)];
        const d = Math.abs(pv[i]-v); e += d>64 ? 64 : d;
      }
      // a small pull towards "nothing moved": it decides only between equally good answers
      return e/n + 0.012*(Math.abs(tx)+Math.abs(ty)) + 6*Math.abs(s-1);
    };
    let best = { c:cost(1,0,0,false), s:1, tx:0, ty:0 };
    const coarse = 3;
    for(let s=0.90; s<=1.1001; s+=0.02) for(let ty=-R; ty<=R; ty+=coarse) for(let tx=-R; tx<=R; tx+=coarse){
      const c = cost(s,tx,ty,false); if(c < best.c) best = { c, s, tx, ty };
    }
    for(const ds of [-0.01,0,0.01]) for(let dy=-coarse; dy<=coarse; dy++) for(let dx=-coarse; dx<=coarse; dx++){
      const s = best.s+ds, tx = best.tx+dx, ty = best.ty+dy, c = cost(s,tx,ty,true);
      if(c < best.cf || best.cf===undefined) { best.cf = c; best.fs = s; best.ftx = tx; best.fty = ty; }
    }
    const s = best.fs, tx = best.ftx, ty = best.fty;
    const score = best.cf - 0.012*(Math.abs(tx)+Math.abs(ty)) - 6*Math.abs(s-1);
    return { s, tx, ty, score, flat: dev < 3, n };
  }

  /* THE RESULT: the original, with only the items' changed pixels taken from the edit.
     placements = [{ item, box:[x0,y0,x1,y1] in the edit's pixels }]. Returns
       { out (same shape as orig), placed:[{item, box (in the original), pixels, score}], skipped:[{item, why}], changed }.
     Nothing outside the placed boxes is touched: `out` starts as a copy of the original. */
  function pkCompose(orig, edit, placements, opts){
    const o = opts||{}, w = orig.width, h = orig.height, O = orig.data, E = edit.data;
    const out = { width:w, height:h, data:new Uint8ClampedArray(O) };
    const LO = lumOf(orig), LE = lumOf(edit);
    /* TWO BARS A PLACEMENT MUST CLEAR, or the item is left out rather than put in the wrong place (measured on the
       owner's own sheets, 2026-11-19): an engine that kept the layout lines up at a score of about 5 with the
       surroundings differing by under 26; one that moved the coat and the card apart scored 12 with the surroundings
       differing by 76, and pasting there put the card over the old one. */
    const maxScore = o.maxScore==null ? 10 : o.maxScore, maxDrift = o.maxDrift==null ? 44 : o.maxDrift;
    const placed = [], skipped = [];
    for(const p of (placements||[])){
      if(!p || !p.box) continue;
      const b = pkBox(p.box, w, h), bw = b[2]-b[0], bh = b[3]-b[1], cx = (b[0]+b[2])/2, cy = (b[1]+b[3])/2;
      if(bw*bh > w*h*0.2){ skipped.push({ item:p.item, why:"too large" }); continue; }   // a new garment is a redraw, not a patch
      const A = pkAlign(orig, edit, b, { lumOrig:LO, lumEdit:LE });
      if(A.score > maxScore){ skipped.push({ item:p.item, why:"could not be lined up", score:A.score }); continue; }
      const toEdit = (xo,yo)=> [cx + (xo-cx-A.tx)*A.s, cy + (yo-cy-A.ty)*A.s];
      // where the box lands in the original, and a window around it to look for what changed
      const dx0 = cx + A.tx + (b[0]-cx)/A.s, dy0 = cy + A.ty + (b[1]-cy)/A.s, dx1 = cx + A.tx + (b[2]-cx)/A.s, dy1 = cy + A.ty + (b[3]-cy)/A.s;
      const core = pkBox([dx0,dy0,dx1,dy1], w, h);
      const pad = Math.round(clamp(Math.max(core[2]-core[0], core[3]-core[1])*0.45, 10, 60));
      const W = pkBox([core[0]-pad, core[1]-pad, core[2]+pad, core[3]+pad], w, h);
      const ww = W[2]-W[0], wh = W[3]-W[1], N = ww*wh;
      const samp = new Float32Array(N*3), diff = new Float32Array(N);
      for(let y=0;y<wh;y++) for(let x=0;x<ww;x++){
        const e = toEdit(W[0]+x+0, W[1]+y+0), xe = clamp(e[0],0,w-1.001), ye = clamp(e[1],0,h-1.001);
        const x0 = xe|0, y0 = ye|0, fx = xe-x0, fy = ye-y0, k = (y0*w+x0)*4, i = y*ww+x, q = ((W[1]+y)*w + W[0]+x)*4;
        let dm = 0;
        for(let c=0;c<3;c++){
          const v = E[k+c]*(1-fx)*(1-fy) + E[k+4+c]*fx*(1-fy) + E[k+w*4+c]*(1-fx)*fy + E[k+w*4+4+c]*fx*fy;
          samp[i*3+c] = v; const d = Math.abs(v-O[q+c]); if(d>dm) dm = d;
        }
        diff[i] = dm;
      }
      // how much the surroundings drifted on their own: the bar a "real change" has to clear
      const ring = [];
      for(let y=0;y<wh;y+=2) for(let x=0;x<ww;x+=2){
        const X = W[0]+x, Y = W[1]+y;
        if(X>=core[0]-2 && X<core[2]+2 && Y>=core[1]-2 && Y<core[3]+2) continue;
        ring.push(diff[y*ww+x]);
      }
      ring.sort((a,b2)=>a-b2);
      const med = ring.length ? ring[ring.length>>1] : 0, p90 = ring.length ? ring[Math.floor(ring.length*0.9)] : 0;
      // (clearly above what the engine's own drift does around the box: a low bar copied thousands of drifted pixels
      // of a cap nobody had asked to change)
      const T = clamp(Math.max(med*3+14, p90*1.6+8), 34, 110);
      if(p90 > maxDrift){ skipped.push({ item:p.item, why:"the picture around it changed too much", score:A.score, drift:Math.round(p90) }); continue; }
      // changed pixels, kept only where they belong to the item: groups that touch the box
      const mask = new Uint8Array(N), lab = new Int32Array(N), stack = [];
      for(let i=0;i<N;i++) if(diff[i] > T) mask[i] = 1;
      let keep = new Uint8Array(N), nLab = 0;
      for(let i=0;i<N;i++){
        if(!mask[i] || lab[i]) continue;
        nLab++; let touches = false; const members = []; stack.push(i); lab[i] = nLab;
        while(stack.length){
          const j = stack.pop(); members.push(j);
          const x = j % ww, y = (j / ww) | 0, X = W[0]+x, Y = W[1]+y;
          if(X>=core[0] && X<core[2] && Y>=core[1] && Y<core[3]) touches = true;
          if(x>0 && mask[j-1] && !lab[j-1]){ lab[j-1] = nLab; stack.push(j-1); }
          if(x<ww-1 && mask[j+1] && !lab[j+1]){ lab[j+1] = nLab; stack.push(j+1); }
          if(y>0 && mask[j-ww] && !lab[j-ww]){ lab[j-ww] = nLab; stack.push(j-ww); }
          if(y<wh-1 && mask[j+ww] && !lab[j+ww]){ lab[j+ww] = nLab; stack.push(j+ww); }
        }
        if(touches && members.length >= 4) for(const j of members) keep[j] = 1;
      }
      /* WHAT IS COPIED: the whole rectangle those changed pixels span, with a 2-pixel soft edge. Copying only the
         changed pixels left holes: on a badge, the white between the new lines of print stayed the OLD white, a
         patch at a slightly different place. A rectangle around the change is one clean piece of the engine's item. */
      let rx0 = ww, ry0 = wh, rx1 = -1, ry1 = -1;
      for(let y=0;y<wh;y++) for(let x=0;x<ww;x++) if(keep[y*ww+x]){ if(x<rx0) rx0 = x; if(x>rx1) rx1 = x; if(y<ry0) ry0 = y; if(y>ry1) ry1 = y; }
      let count = 0;
      /* A PATCH, NOT A REDRAW: more than about a hundredth of the sheet (a hat over the head, a scarf, a coat) cannot be
         added by copying a rectangle without mixing the engine's picture into the original, which is exactly what
         the owner turned down. Such an item is left out and the app says so. */
      if(rx1 >= 0 && (rx1-rx0+5)*(ry1-ry0+5) > w*h*(o.maxPatch==null ? 0.012 : o.maxPatch)){
        skipped.push({ item:p.item, why:"too large to add without redrawing", score:A.score }); continue; }
      if(rx1 >= 0){
        rx0 = Math.max(0, rx0-2); ry0 = Math.max(0, ry0-2); rx1 = Math.min(ww-1, rx1+2); ry1 = Math.min(wh-1, ry1+2);
        // the edge is soft over 2 pixels on a small patch and up to 10 on a large one (a wider ramp hides a slight
        // difference of tone between the two pictures, which a large patch would show as a faint rectangle)
        const soft = clamp(Math.round(Math.min(rx1-rx0, ry1-ry0)*0.06), 2, 10);
        for(let y=ry0;y<=ry1;y++) for(let x=rx0;x<=rx1;x++){
          const edge = Math.min(x-rx0+0.5, rx1-x+0.5, y-ry0+0.5, ry1-y+0.5), a = Math.min(1, edge/soft);
          const i = y*ww+x, q = ((W[1]+y)*w + W[0]+x)*4;
          for(let c=0;c<3;c++) out.data[q+c] = Math.round(a*samp[i*3+c] + (1-a)*O[q+c]);
          count++;
        }
      }
      if(!count){ skipped.push({ item:p.item, why:"nothing changed there", score:A.score }); continue; }
      placed.push({ item:p.item, box:[W[0]+rx0, W[1]+ry0, W[0]+rx1+1, W[1]+ry1+1], pixels:count, score:Math.round(A.score*10)/10, shift:[A.tx,A.ty], size:Math.round(A.s*1000)/1000, bar:Math.round(T) });
    }
    return { out, placed, skipped, changed: pkCount(out, orig) };
  }

  /* how many pixels of `a` differ from `b` in any colour (pixel by pixel; both the same size) */
  function pkCount(a, b){
    const A = a.data, B = b.data; let n = 0;
    for(let i=0;i<A.length;i+=4) if(A[i]!==B[i] || A[i+1]!==B[i+1] || A[i+2]!==B[i+2]) n++;
    return n;
  }
  /* every changed pixel lies inside one of the boxes (the promise the app makes) */
  function pkOnlyInside(a, b, boxes, pad){
    const w = a.width, A = a.data, B = b.data, m = pad||0;
    for(let i=0,p=0;i<A.length;i+=4,p++){
      if(A[i]===B[i] && A[i+1]===B[i+1] && A[i+2]===B[i+2]) continue;
      const x = p % w, y = (p / w) | 0;
      if(!boxes.some(bx=> x>=bx[0]-m && x<bx[2]+m && y>=bx[1]-m && y<bx[3]+m)) return false;
    }
    return true;
  }
  /* what a vision model answers ("boxes in thousandths of the picture") made into pixel placements; anything that is
     not a proper box is dropped, never guessed */
  function pkPlacements(found, w, h){
    const out = [];
    for(const f of (Array.isArray(found) ? found : [])){
      const item = String((f && (f.item||f.name)) || "").trim(); if(!item) continue;
      const boxes = Array.isArray(f.boxes) ? f.boxes : (Array.isArray(f.box) ? [f.box] : []);
      for(const b of boxes){
        if(!Array.isArray(b) || b.length!==4 || !b.every(v=> typeof v==="number" && isFinite(v))) continue;
        const x0 = Math.min(b[0],b[2])/1000*w, x1 = Math.max(b[0],b[2])/1000*w, y0 = Math.min(b[1],b[3])/1000*h, y1 = Math.max(b[1],b[3])/1000*h;
        if(x1-x0 < 2 || y1-y0 < 2 || x0 > w || y0 > h) continue;
        out.push({ item, box:[x0,y0,x1,y1] });
      }
    }
    return out;
  }

  /* ───────────────────────── THE HEAD, BACK ON THE HEADLESS VIEW (owner 2026-11-20) ─────────────────────────
     Every character sheet draws its front full-body view without a head (one face on the sheet, the close-up's, so a
     video engine never picks a second, smaller one). The owner: "we can take that close up and … [bring] that head back
     into place if a user wishes to". Nothing is drawn here either: a reader says roughly where the close-up's head, its
     chin and the body's empty neck opening are; the code cuts the head from its plain background, makes it as wide as
     the head of the view that has one, and sets it on the opening, the close-up's own neck filling it. The face in the
     full-body view is then the close-up's face, pixel for pixel made smaller: the two cannot drift apart. */
  function pkMed(a){ a = a.slice().sort((x,y)=>x-y); return a.length ? a[a.length>>1] : 0; }
  function pkSample(img, x0, y0, x1, y1){
    const R=[],G=[],B=[]; const w=img.width, d=img.data;
    for(let y=Math.max(0,y0|0); y<Math.min(img.height,y1|0); y++) for(let x=Math.max(0,x0|0); x<Math.min(w,x1|0); x++){ const i=(y*w+x)*4; R.push(d[i]); G.push(d[i+1]); B.push(d[i+2]); }
    if(!R.length) return null;
    const c=[pkMed(R),pkMed(G),pkMed(B)]; let dev=0; for(let k=0;k<R.length;k++) dev+=Math.abs(R[k]-c[0])+Math.abs(G[k]-c[1])+Math.abs(B[k]-c[2]);
    return { c, dev:dev/R.length/3 };
  }
  const pkDist=(d,i,c)=> Math.sqrt((d[i]-c[0])**2+(d[i+1]-c[1])**2+(d[i+2]-c[2])**2);
  function pkSkinLike(r,g,b,s){ const t=r+g+b||1, ts=s[0]+s[1]+s[2]||1; const dr=r/t-s[0]/ts, dg=g/t-s[1]/ts; const k=t/ts;
    return Math.sqrt(dr*dr+dg*dg) < 0.04 && k>0.3 && k<1.6; }
  const HB_T0=20, HB_T1=46;

  /* THE EMPTY NECK OPENING of a headless view, grown from the middle of the box it was pointed at: neighbours that go on
     smoothly belong to it, an edge (the front of the collar, the neckline) ends it. Never more than 3 px outside the box. */
  function pkNeckOpening(img, box){
    const w=img.width, h=img.height, d=img.data, hb=box.map(Math.round), pad=Math.max(3, Math.round(Math.max(hb[2]-hb[0], hb[3]-hb[1])*0.08));
    const bx=[Math.max(0,hb[0]-pad), Math.max(0,hb[1]-pad), Math.min(w-1,hb[2]+pad), Math.min(h-1,hb[3]+pad)];
    const mw=bx[2]-bx[0]+1, mh=bx[3]-bx[1]+1, mask=new Uint8Array(mw*mh);
    const col = pkSample(img, hb[0]+(hb[2]-hb[0])*0.35, hb[1]+(hb[3]-hb[1])*0.3, hb[0]+(hb[2]-hb[0])*0.65, hb[1]+(hb[3]-hb[1])*0.7);
    if(!col) return null;
    // an opening can have more than one tone (the inside of a coat's collar above a jumper's back neck): it is grown
    // from several places down its middle line, each with the colour found there
    const cx0=Math.round((hb[0]+hb[2])/2);
    for(const f of [0.3, 0.5, 0.7, 0.85]){
      const cy0=Math.round(hb[1]+(hb[3]-hb[1])*f), sc=pkSample(img, cx0-3, cy0-2, cx0+4, cy0+3);
      if(!sc || sc.dev>14) continue;
      const q=[];
      for(let dy=-2; dy<=2; dy++) for(let dx=-3; dx<=3; dx++){ const X=cx0+dx, Y=cy0+dy; if(X<bx[0]||X>bx[2]||Y<bx[1]||Y>bx[3]) continue;
        if(pkDist(d,(Y*w+X)*4,sc.c)<40){ mask[(Y-bx[1])*mw+(X-bx[0])]=1; q.push(X,Y); } }
      while(q.length){ const Y=q.pop(), X=q.pop(), i=(Y*w+X)*4;
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=X+dx, ny=Y+dy;
          if(nx<bx[0]||nx>bx[2]||ny<bx[1]||ny>bx[3]) continue;
          const m=(ny-bx[1])*mw+(nx-bx[0]); if(mask[m]) continue;
          const j=(ny*w+nx)*4, step=Math.abs(d[j]-d[i])+Math.abs(d[j+1]-d[i+1])+Math.abs(d[j+2]-d[i+2]);
          if(step<22 && pkDist(d,j,sc.c)<75){ mask[m]=1; q.push(nx,ny); } } }
    }
    let n=0, bottom=hb[1], top=hb[3];
    for(let Y=bx[1]; Y<=bx[3]; Y++) for(let X=bx[0]; X<=bx[2]; X++) if(mask[(Y-bx[1])*mw+(X-bx[0])]){ n++; if(Y>bottom) bottom=Y; if(Y<top) top=Y; }
    if(n < (hb[2]-hb[0])*(hb[3]-hb[1])*0.15) return { box:bx, mw, mask:null, bottom:hb[3], top:hb[1], color:col.c };   // nothing clear to grow
    return { box:bx, mw, mask, bottom, top, color:col.c };
  }

  /* ROOM FOR THE HEAD: the whole figure of the headless view moved down by n pixels, between the nearest two columns
     that hold nothing but background. The top rows repeat the first row; the rows pushed off the bottom must be
     background too. Every pixel of the figure is kept, n rows lower. null when it cannot be done cleanly. */
  function pkMoveDown(img, cx, n, bg, least){
    const w=img.width, h=img.height, d=img.data;
    // a column of nothing but background (a frame line at the top or bottom edge aside), and two more like it beyond:
    // clear of the figure's soft edge
    // (first looked for strictly, so that the two columns stand clear of the faint outer part of a shadow on the floor:
    // a column through it would show as a step after the move; then as before)
    const cleanAt = (x, tol)=>{ if(x<0 || x>=w) return false; let bad=0; for(let y=0;y<h;y+=2){ if(pkDist(d,(y*w+x)*4,bg)>tol && ++bad>h*0.004) return false; } return true; };
    let xl=-1, xr=-1;
    for(const tol of [14, 28]){
      const clean = (x)=> cleanAt(x, tol);
      if(xl<0) for(let x=Math.round(cx); x>=2; x--) if(clean(x) && clean(x-1) && clean(x-2)){ xl=x-2; break; }
      if(xr<0) for(let x=Math.round(cx); x<w-2; x++) if(clean(x) && clean(x+1) && clean(x+2)){ xr=x+2; break; }
    }
    if(xl<0 || xr<0 || xr-xl<20) return null;
    // a frame line along the top or bottom edge stays where it is: the move happens between the first and the last
    // background row of the two columns
    let r0=0, r1=h-1;
    const plainRow = (y)=>{ let bad=0, n=0; for(let x=xl; x<=xr; x+=2){ n++; if(pkDist(d,(y*w+x)*4,bg)>28) bad++; } return bad <= n*0.02; };
    while(r0<12 && !plainRow(r0)) r0++;
    while(r1>h-13 && !plainRow(r1)) r1--;
    if(r0>=12 || r1<=h-13) return null;
    // how much clean floor there is under the figure: nothing of it may fall off the bottom
    let room = 0;
    for(let y=r1; y>r0; y--){ let bad=0; for(let x=xl; x<=xr; x+=2) if(pkDist(d,(y*w+x)*4,bg)>HB_T1 && ++bad>2) break; if(bad>2) break; room++; }
    room = Math.max(0, room-3);
    if(room < (least==null ? n : least)) return null;
    n = Math.min(n, room);
    if(n<1) return null;
    // the background must go on evenly across the two edges after the move; a move that would show is tried shorter
    const evenAt = (m)=>{ let uneven=0, seen=0;
      for(const x of [xl,xr]) for(let y=r0+m; y<=r1; y+=3){ const a=(y*w+x)*4, b=((y-m)*w+x)*4; seen++; if(Math.abs(d[a]-d[b])+Math.abs(d[a+1]-d[b+1])+Math.abs(d[a+2]-d[b+2])>30) uneven++; }
      return uneven <= seen*0.02; };
    const floorN = Math.max(1, least==null ? n : least);
    while(n>floorN && !evenAt(n)) n = Math.max(floorN, Math.floor(n*0.8));
    if(!evenAt(n)) return null;
    /* the rows the figure leaves at the top become background: the picture's own, taken from the clean rows it has
       above the figure (a view that has its head starts only a few rows down, and those rows are all there is) */
    let m = 0; while(m<64 && r0+1+m<r1 && plainRow(r0+1+m)) m++;
    if(m<3) return null;
    const out=new Uint8ClampedArray(d);
    for(let y=r1; y>=r0+n; y--){ const sy=y-n; for(let x=xl+1; x<xr; x++){ const o=(y*w+x)*4, s=(sy*w+x)*4; out[o]=d[s]; out[o+1]=d[s+1]; out[o+2]=d[s+2]; } }
    for(let y=r0+1; y<r0+n; y++){ const sy=r0+1+((y-r0-1)%m); for(let x=xl+1; x<xr; x++){ const o=(y*w+x)*4, s=(sy*w+x)*4; out[o]=d[s]; out[o+1]=d[s+1]; out[o+2]=d[s+2]; } }
    return { img:{ width:w, height:h, data:out }, x0:xl+1, x1:xr-1, by:n, top:r0 };
  }

  /* THE HEAD BACK ON A HEADLESS VIEW, from the sheet's own close-up (owner 2026-11-20). Nothing is drawn: the close-up's
     head is cut from its plain background, made as small as the head of the view that has one, and set on the neck
     opening; the close-up's neck fills the opening. p, in pixels:
       head [x0,y0,x1,y1]  the close-up's head, hat and hair included, down to the chin      chinY, faceX
       target { cx, width }  the body's centre line and the head's width there (the other view's head)
       hole [x0,y0,x1,y1]  the empty neck opening of the headless view */
  function pkHeadBack(img, p){
    const w=img.width, h=img.height, d=img.data;
    // the box is only roughly right: it is taken a little wider, and the code finds the head's own edge inside it
    const bw0 = Math.abs(p.head[2]-p.head[0]), top0 = Math.min(p.head[1],p.head[3]);
    const hx0 = Math.max(0, Math.round(Math.min(p.head[0],p.head[2]) - bw0*0.06)), hx1 = Math.min(w-1, Math.round(Math.max(p.head[0],p.head[2]) + bw0*0.06));
    const chinY = Math.min(h-2, Math.round(p.chinY)), hy0raw = Math.max(0, Math.round(top0 - (chinY-top0)*0.04));
    if(chinY-hy0raw<40 || hx1-hx0<40) return { failed:"the close-up is too small" };
    // the close-up's background: the box's two top corners (a head is round, its corners are empty)
    const cs = Math.max(6, Math.round((hx1-hx0)*0.07));
    const bgs = [pkSample(img, hx0, hy0raw+2, hx0+cs, hy0raw+2+cs), pkSample(img, hx1-cs, hy0raw+2, hx1, hy0raw+2+cs)].filter(b=> b && b.dev<10);
    if(!bgs.length) return { failed:"the close-up has no plain background to cut the head from" };
    const bg = bgs.sort((a,b)=>a.dev-b.dev)[0].c;
    const aBg = (x,y)=>{ const v=pkDist(d,(y*w+x)*4,bg); return v<=HB_T0?0:v>=HB_T1?1:(v-HB_T0)/(HB_T1-HB_T0); };
    // the head's own top, and its centre line (the middle of its widest part)
    const rowSpan = (y)=>{ let l=-1, r=-1, run=0;
      for(let x=hx0; x<=hx1; x++){ if(aBg(x,y)>=0.5){ if(++run>=3){ l=x-2; break; } } else run=0; }
      run=0; for(let x=hx1; x>=hx0; x--){ if(aBg(x,y)>=0.5){ if(++run>=3){ r=x+2; break; } } else run=0; }
      return (l>=0 && r>l && !(l<=hx0+1 && r>=hx1-1)) ? [l,r] : null; };   // (a line right across the box is a frame, not a head)
    let hy0 = hy0raw; while(hy0<chinY-40 && !rowSpan(hy0)) hy0++;
    const HH = chinY-hy0;
    const mids = []; let wl=hx1, wr=hx0;
    for(let y=hy0+Math.round(HH*0.25); y<=hy0+Math.round(HH*0.65); y+=2){ const sp=rowSpan(y); if(sp){ mids.push((sp[0]+sp[1])/2); if(sp[0]<wl) wl=sp[0]; if(sp[1]>wr) wr=sp[1]; } }
    if(!mids.length || wr-wl<30) return { failed:"the head could not be cut from the close-up" };
    const faceX = Math.round(pkMed(mids)), HW = wr-wl;
    const sk = pkSample(img, faceX-HW*0.22, hy0+HH*0.60, faceX-HW*0.14, hy0+HH*0.68), sk2 = pkSample(img, faceX+HW*0.14, hy0+HH*0.60, faceX+HW*0.22, hy0+HH*0.68);
    const skin = (sk && sk2) ? [(sk.c[0]+sk2.c[0])/2,(sk.c[1]+sk2.c[1])/2,(sk.c[2]+sk2.c[2])/2] : (sk||sk2||{c:[200,150,120]}).c;
    const y1 = Math.min(h-1, chinY+Math.round(HH*0.4));
    const cw = hx1-hx0+1, ch = y1-hy0+1;
    const alpha = new Float32Array(cw*ch);
    const jawFrom = hy0+Math.round(HH*0.70);
    const jawGap = Math.max(6, Math.round((hx1-hx0)*0.035));
    let prevL=hx0, prevR=hx1, L=hx0, R=hx1;
    for(let y=hy0; y<=chinY; y++){
      let l, r;
      if(y<=jawFrom){
        // hat, hair, ears: from outside in, to the first three head pixels in a row; what lies between is the head
        l=hx1; r=hx0; let run=0;
        for(let x=hx0; x<=hx1; x++){ if(aBg(x,y)>=0.5){ if(++run>=3){ l=x-2; break; } } else run=0; }
        run=0; for(let x=hx1; x>=hx0; x--){ if(aBg(x,y)>=0.5){ if(++run>=3){ r=x+2; break; } } else run=0; }
        if(l>r) continue;
        for(let x=l; x<=r; x++) alpha[(y-hy0)*cw+(x-hx0)] = (x-l<3 || r-x<3) ? Math.max(aBg(x,y), 0.5) : 1;
      } else {
        // the jaw: outwards from the face's centre line until background, and only ever narrower (the shoulders stay out)
        // (found by the first real run, 2026-11-20: a grey beard on a grey ground has patches as pale as the background;
        // four such pixels in a row ended the jaw early and left half the neck out. Real background beside a jaw is wide.)
        l=faceX; r=faceX; let gap=0;
        for(let x=faceX; x>=hx0; x--){ if(aBg(x,y)<0.5){ if(++gap>=jawGap) break; } else { gap=0; l=x; } }
        gap=0; for(let x=faceX; x<=hx1; x++){ if(aBg(x,y)<0.5){ if(++gap>=jawGap) break; } else { gap=0; r=x; } }
        l=Math.max(l,prevL); r=Math.min(r,prevR);
        for(let x=l; x<=r; x++) alpha[(y-hy0)*cw+(x-hx0)] = aBg(x,y)>=0.5 ? 1 : aBg(x,y);
      }
      prevL=l; prevR=r; L=l; R=r;
    }
    /* THE NECK IN THE CLOSE-UP: under the chin, row by row, from its leftmost to its rightmost skin, as far down as skin
       shows (the clothes end it). Everything between those two sides is the neck, shadows and lines included: taking
       only the pixels that look like skin left holes that had to be filled with a flat colour. */
    const nExt = [];   // per neck row k (1 = the row under the chin): [left, right] in cut-out columns, or null
    let neckBottom = chinY;
    for(let y=chinY+1; y<=y1; y++){
      let l=-1, r=-1, any=0;
      for(let x=L; x<=R; x++){ const i=(y*w+x)*4; if(aBg(x,y)>0.5 && pkSkinLike(d[i],d[i+1],d[i+2],skin)){ if(l<0) l=x; r=x; any++; } }
      const ok = any>=3 && any >= (r-l+1)*0.45;      // a row of skin, not a few stray pixels on the clothes
      nExt.push(ok ? [l-hx0, r-hx0] : null);
      if(ok){ neckBottom=y; for(let x=l; x<=r; x++) alpha[(y-hy0)*cw+(x-hx0)] = (x===l || x===r) ? 0.5 : 1; }
      else if(y-neckBottom>6) break;
    }
    const neckLen = neckBottom-chinY;
    nExt.length = Math.max(0, neckLen);
    // how wide the neck is under the chin, before the clothes narrow it
    let nl = cw, nr = -1;
    for(let k=1; k<=Math.max(2, Math.round(neckLen*0.3)) && k<=neckLen; k++){ const e=nExt[k-1]; if(e){ if(e[0]<nl) nl=e[0]; if(e[1]>nr) nr=e[1]; } }
    const s0 = p.headWidth / HW;
    if(!(s0>0.05 && s0<1.2)) return { failed:"the head's size could not be worked out" };
    if(!p.opening) return { failed:"the place for the head was not found" };
    let base = img, moved = null, holeBox = p.opening.slice();
    // where the growing stopped well short of the box's bottom (a ribbed or patterned inside), or found nothing clear,
    // the box says where the opening ends: a flat edge at its bottom
    const settle = (o, hb)=>{ if(o && (!o.mask || hb[3]-o.bottom > Math.max(3, (hb[3]-hb[1])*0.2))){ o.flat = Math.min(h-1, Math.round(hb[3])); o.bottom = o.flat; } return o; };
    let open = settle(pkNeckOpening(base, holeBox), holeBox);
    if(!open) return { failed:"the place for the head was not found" };
    const centreOf = (o)=>{ if(!o.mask || o.flat!=null) return (holeBox[0]+holeBox[2])/2; let sx=0,n=0; for(let Y=o.box[1]; Y<=o.box[3]; Y++) for(let X=o.box[0]; X<=o.box[2]; X++) if(o.mask[(Y-o.box[1])*o.mw+(X-o.box[0])]){ sx+=X; n++; } return n ? sx/n : (holeBox[0]+holeBox[2])/2; };
    const cx = centreOf(open);
    /* LINE THE CLOSE-UP UP WITH THE BODY BY THEIR CLOTHES (owner 2026-11-20: "the close-up picture and the mid section
       … [need] to be aligned as far as the wardrobe and the character's look"). The collar, the lapels and whatever
       hangs at the neck are in both pictures. The close-up's clothes around the neck are laid over the body's at many
       sizes and places; where they agree best is the size and the place of the head. The skin is left out of the
       comparison (the body has none there yet). Without a clear best place the size comes from the other view's head
       and the place from the opening, as before. Anchor: the lowest point of the close-up's neck. */
    let vxc = faceX-hx0;
    for(let k=neckLen; k>=1; k--){ const e=nExt[k-1]; if(e){ vxc = (e[0]+e[1])/2; break; } }
    const lumAt = (D,x,y)=>{ const i=(y*w+x)*4; return (D[i]*30+D[i+1]*59+D[i+2]*11)/100; };
    let al = null;
    if(neckLen>4){
      const g = Math.max(2, Math.round(0.6/s0)), rb = Math.max(1, Math.round(0.4/s0));
      const ya = chinY - Math.round(HH*0.10), yb = Math.min(h-1-rb, neckBottom + Math.round(neckLen*1.1));
      const xa = Math.max(rb, hx0 - Math.round(HW*0.12)), xb = Math.min(w-1-rb, hx1 + Math.round(HW*0.12));
      const pts = [];   // [dx from the anchor, dy from the anchor, luminance (a small average)] of the close-up's clothes
      for(let y=Math.max(rb,ya); y<=yb; y+=g) for(let x=xa; x<=xb; x+=g){
        const i=(y*w+x)*4;
        if(aBg(x,y)<0.9 || pkSkinLike(d[i],d[i+1],d[i+2],skin)) continue;
        if(y<=chinY && alpha[(y-hy0)*cw+(x-hx0)]>0) continue;                      // the head itself
        let L0=0, n=0; for(let yy=y-rb; yy<=y+rb; yy+=rb) for(let xx=x-rb; xx<=x+rb; xx+=rb){ L0+=lumAt(d,xx,yy); n++; }
        pts.push(x-(hx0+vxc), y-neckBottom, L0/n);
      }
      const N = pts.length/3;
      if(N>=60){
        const score = (sc, ax, ay, step)=>{ let sum=0, n=0;
          for(let q=0; q<pts.length; q+=3*step){ const X=Math.round(ax+pts[q]*sc), Y=Math.round(ay+pts[q+1]*sc);
            if(X<0||Y<0||X>=w||Y>=h){ sum+=60; n++; continue; }
            sum += Math.min(90, Math.abs(lumAt(d,X,Y)-pts[q+2])); n++; }
          return n ? sum/n : 999; };
        const ax0 = cx, ay0 = open.bottom, R = Math.max(8, Math.round(HW*s0*0.12));
        let best = { v:999 }, all = [];
        for(let k=0.80; k<=1.25; k+=0.045) for(let oy=-R; oy<=R; oy+=2) for(let ox=-R; ox<=R; ox+=2){
          const v = score(s0*k, ax0+ox, ay0+oy, 3); all.push(v); if(v<best.v) best = { v, k, ox, oy }; }
        for(let k=best.k-0.04; k<=best.k+0.041; k+=0.01) for(let oy=best.oy-2; oy<=best.oy+2; oy++) for(let ox=best.ox-2; ox<=best.ox+2; ox++){
          const v = score(s0*k, ax0+ox, ay0+oy, 1); if(v<best.v) best = { v, k, ox, oy }; }
        all.sort((a,b)=>a-b);
        const typical = all[Math.floor(all.length/2)];
        // a clear best place: the clothes agree there, and far better than at a typical place
        if(best.v < 30 && best.v < typical*0.72) al = { s:s0*best.k, ax:ax0+best.ox, ay:ay0+best.oy, score:best.v, typical, k:best.k };
      }
    }
    /* SIZE AND PLACE. The chin sits a neck above the bottom of the opening, as in the close-up. A body drawn too high
       for that is moved down as it is; where that cannot be done cleanly the head is made a little smaller (never
       under 85%) and its neck shorter; with less room than that, nothing is done. */
    /* …and A GAP ABOVE THE HEAD (owner 2026-11-20: "he appears to almost be touching the top of the image frame, which we
       don't want … just create a little gap"): as much as the head of the other view has, at least 1.2% and at most 4%
       of the picture's height. The body is moved down by what that takes, or by as much clean floor as there is under
       it; the head is never made smaller for the gap, only when it would not fit at all. */
    const MARGIN=4;
    let s = al ? al.s : s0, anchorY = al ? al.ay : open.bottom, chinT = anchorY - neckLen*s;
    let frame=0; while(frame<10 && pkDist(d,(frame*w+Math.round(cx))*4,bg)>HB_T1+20) frame++;
    const gap = Math.max(h*0.012, Math.min(h*0.04, (p.topGap>0 ? p.topGap : h*0.02)));
    const need = Math.ceil(gap + frame - (chinT - HH*s));
    if(need>0){
      const dbg0 = pkSample(img, cx-HW*s0*0.5-14, 2, cx-HW*s0*0.5-2, Math.max(8, open.top-6)) || { c:bg };
      /* THE FIGURES STAY LEVEL (owner 2026-11-20: "even when the [character] turns around, everything is still aligned the
         same way"). The front and the back view stand on one line, shoulder to shoulder. So the view that has its head
         goes down with the headless one, by the same number of rows: as far as BOTH have clean floor. Only when the
         other view cannot move at all does the front go down alone, and then no further than the head needs to fit. */
      const want = Math.min(need, Math.round(h*0.09)), least = Math.ceil(MARGIN + frame - (chinT - HH*s));
      let mv = pkMoveDown(img, cx, want, dbg0.c, 1), level = false;
      if(mv && mv.x0 > hx1 && p.otherCx>0){
        const mo = pkMoveDown(img, p.otherCx, mv.by, dbg0.c, 1);
        const by = mo ? Math.min(mv.by, mo.by) : 0;
        if(by>=1 && (mo.x0>mv.x1 || mo.x1<mv.x0)){
          const a = (by===mv.by) ? mv : pkMoveDown(img, cx, by, dbg0.c, by);
          const b = a ? pkMoveDown(a.img, p.otherCx, by, dbg0.c, by) : null;
          if(a && b){ mv = { img:b.img, x0:a.x0, x1:a.x1, by, other:[b.x0,b.x1] }; level = true; }
        }
        if(!level) mv = least>0 ? pkMoveDown(img, cx, least, dbg0.c, least) : null;
      }
      moved = mv; if(moved) moved.level = level;
      if(moved && moved.x0 > hx1){ base = moved.img; holeBox = [holeBox[0], holeBox[1]+moved.by, holeBox[2], holeBox[3]+moved.by]; open = settle(pkNeckOpening(base, holeBox), holeBox); anchorY = al ? al.ay + moved.by : open.bottom; chinT = anchorY - neckLen*s; }
      else moved = null;
      // still not even the least room: the neck gets shorter, then the head a little smaller; under 85% nothing is done
      if(chinT - HH*s < MARGIN + frame){
        s = (open.bottom-MARGIN-frame)/(HH+0.35*neckLen);
        if(s < s0*0.85) return { failed:"there is no room for the head above the body" };
        s = Math.min(s, al ? al.s : s0); chinT = MARGIN + frame + HH*s; if(al && s < al.s*0.995) al = null; }
    }
    const bd = base.data;
    const topT = Math.round(chinT - HH*s), headRows = Math.round(HH*s), chinRow = topT+headRows;
    const tw = Math.max(1,Math.round(cw*s)), tx0 = al ? Math.round(al.ax - vxc*s) : Math.round(cx - (faceX-hx0)*s);
    if(tx0<0 || tx0+tw>w || topT<0) return { failed:"there is no room for the head above the body" };
    const out = new Uint8ClampedArray(bd);
    const dbg = pkSample(base, tx0-14, topT+2, tx0-2, topT+headRows*0.4) || { c:bg };
    const inOpen = (X,Y)=> !!(open.mask && X>=open.box[0] && X<=open.box[2] && Y>=open.box[1] && Y<=open.box[3] && open.mask[(Y-open.box[1])*open.mw+(X-open.box[0])]);
    let changed=0;
    const put = (X,Y,r,g,b,a)=>{ const o=(Y*w+X)*4;
      const nr=Math.round(r*a+out[o]*(1-a)), ng=Math.round(g*a+out[o+1]*(1-a)), nb=Math.round(b*a+out[o+2]*(1-a));
      out[o]=nr; out[o+1]=ng; out[o+2]=nb; };
    const avg = (sx0,sx1,sy0,sy1)=>{ let ar=0,ag=0,ab=0,aa=0,n=0;
      for(let sy=Math.max(0,Math.floor(sy0)); sy<Math.min(ch,Math.ceil(sy1)); sy++) for(let sx=Math.max(0,Math.floor(sx0)); sx<Math.min(cw,Math.ceil(sx1)); sx++){
        const a=alpha[sy*cw+sx], i=((sy+hy0)*w+(sx+hx0))*4; n++; if(a>0){ ar+=d[i]*a; ag+=d[i+1]*a; ab+=d[i+2]*a; aa+=a; } }
      return (n && aa>0) ? [ar/aa, ag/aa, ab/aa, aa/n] : null; };
    /* THE OPENING, COLUMN BY COLUMN: its lower edge is the front of the clothes (they stay in front of the neck); what
       is above that edge (the inside of the collar, its back rim, the background) is behind the neck and the head. */
    const ow = open.box[2]-open.box[0]+1, colBottom = new Int32Array(ow).fill(-1);
    if(open.flat!=null){ for(let X=0; X<ow; X++){ const gx=open.box[0]+X; if(gx>=Math.round(holeBox[0]) && gx<=Math.round(holeBox[2])) colBottom[X]=open.flat; } }
    else for(let X=0; X<ow; X++) for(let Y=open.box[3]; Y>=open.box[1]; Y--) if(open.mask[(Y-open.box[1])*open.mw+X]){ colBottom[X]=Y; break; }
    // a column the growing missed takes its neighbours' edge
    for(let X=1; X<ow; X++) if(colBottom[X]<0 && colBottom[X-1]>=0){ let k=X; while(k<ow && colBottom[k]<0) k++; if(k<ow) for(let j=X;j<k;j++) colBottom[j]=Math.round(colBottom[X-1]+(colBottom[k]-colBottom[X-1])*(j-X+1)/(k-X+1)); }
    /* THE CORNERS OF THE OPENING. The growing can stop a few pixels short where the collar's inside is darkest, at its
       two corners, and the neck then leaves slivers of it showing. From the deepest column outwards the edge may rise
       by two pixels a column at most; inside that limit each column goes on down while the picture is still as dark as
       the opening, and stops at the first lighter pixel (the front of the collar). */
    if(open.mask && open.flat==null){
      const lums = [];
      for(let Y=open.box[1]; Y<=open.box[3]; Y++) for(let X=0; X<ow; X++) if(open.mask[(Y-open.box[1])*open.mw+X]){ const i=(Y*w+open.box[0]+X)*4; lums.push((bd[i]*30+bd[i+1]*59+bd[i+2]*11)/100); }
      lums.sort((a,b)=>a-b);
      const lumMax = lums.length ? lums[Math.floor(lums.length*0.9)] + 14 : 0;
      let deep = -1; for(let X=0; X<ow; X++) if(colBottom[X]>=0 && (deep<0 || colBottom[X]>colBottom[deep])) deep = X;
      const reach = (X, limit)=>{ if(colBottom[X]<0) return; let y=colBottom[X]; const gx=open.box[0]+X;
        while(y<limit && y+1<h){ const i=((y+1)*w+gx)*4; if((bd[i]*30+bd[i+1]*59+bd[i+2]*11)/100 > lumMax) break; y++; }
        colBottom[X]=y; };
      if(deep>=0){
        let lim = colBottom[deep]; for(let X=deep-1; X>=0; X--){ lim -= 2; if(colBottom[X]<0) break; if(colBottom[X]<lim) reach(X, Math.floor(lim)); lim = Math.max(lim, colBottom[X]); }
        lim = colBottom[deep]; for(let X=deep+1; X<ow; X++){ lim -= 2; if(colBottom[X]<0) break; if(colBottom[X]<lim) reach(X, Math.floor(lim)); lim = Math.max(lim, colBottom[X]); }
      }
    }
    const edgeAt = (X)=> (X>=open.box[0] && X<=open.box[2] && ow) ? colBottom[X-open.box[0]] : -1;
    const behind = chinRow - Math.round(headRows*0.10);
    /* THE NECK ON THE BODY (owner 2026-11-20: "the neck was not rendered properly"). It is drawn at the head's own
       scale, as wide as it is under the chin, straight down to the clothes: inside the opening to the opening's lower
       edge, beside it to the first thing that is not background. Each place takes the close-up's own neck pixel; where
       the close-up's collar had already covered the neck's side, the side is carried on down from the last row that
       shows it. Nothing is filled with a flat colour. */
    /* LINED UP, THE NECK IS THE CLOSE-UP'S, EXACTLY (owner 2026-11-20: "especially the neck part … to look exactly the
       same as it looks on the close-up picture"): every neck pixel of the close-up at its own place, nothing widened,
       nothing carried on; and around it a narrow band of the close-up's own collar, fading out, so that the neck meets
       its clothes as it does in the close-up. The band is laid only on the body's clothes, never on the background. */
    if(al && neckLen>0){
      const x0n = Math.max(0, tx0), x1n = Math.min(w-1, tx0+tw), y0n = Math.max(0, behind), y1n = Math.min(h-1, chinRow+Math.round(neckLen*s)+1);
      const mw2 = x1n-x0n+1, mh2 = y1n-y0n+1, D = Math.max(3, Math.round(HH*s*0.04));
      const dm = new Int16Array(mw2*mh2).fill(-1);   // 0 = the neck, 1..D = how far from it
      for(let Y=Math.max(y0n,chinRow-1); Y<=y1n; Y++) for(let X=x0n; X<=x1n; X++){   // (from a row under the head's last one: no seam at the chin)
        const k = Math.max(1, Math.round((Y-chinRow)/s)), ex = (k<=neckLen) ? nExt[k-1] : null, sxc=(X-tx0)/s;
        if(ex && sxc>=ex[0] && sxc<=ex[1]+1) dm[(Y-y0n)*mw2+(X-x0n)] = 0; }
      for(let t=1; t<=D; t++){ const add=[];
        for(let yy=0; yy<mh2; yy++) for(let xx=0; xx<mw2; xx++){ if(dm[yy*mw2+xx]>=0) continue;
          if((xx>0 && dm[yy*mw2+xx-1]===t-1) || (xx<mw2-1 && dm[yy*mw2+xx+1]===t-1) || (yy>0 && dm[(yy-1)*mw2+xx]===t-1) || (yy<mh2-1 && dm[(yy+1)*mw2+xx]===t-1)) add.push(yy*mw2+xx); }
        for(const q of add) dm[q]=t; }
      /* …and what is left of the empty opening shows what the close-up shows at that place (the side of the collar,
         or nothing): the inside of an empty collar has no place beside a neck. */
      for(let yy=0; yy<mh2; yy++) for(let xx=0; xx<mw2; xx++){ const t=dm[yy*mw2+xx];
        const X=x0n+xx, Y=y0n+yy, sxc=(X-tx0)/s, syc=(Y-chinRow)/s + HH;
        const gx = Math.min(w-1, Math.max(0, Math.round(hx0+sxc))), gy = Math.min(h-1, Math.max(0, Math.round(hy0+syc)));
        const inside = t<0;   // a place of the empty opening that neither the neck nor its band reaches
        if(inside){ const e=edgeAt(X); if(!(inOpen(X,Y) || (e>=0 && Y<=e && Y>=open.top-2)) || syc<1 || syc>=ch-1) continue; }   // (its corners too)
        else if(t>0){ if(Y<=chinRow || aBg(gx,gy)<0.5 || pkDist(bd,(Y*w+X)*4,dbg.c)<HB_T1) continue; }   // the band: clothes on clothes only
        // the close-up's own pixels here, made smaller (every pixel of the place counts: this is the picture itself)
        let r0=0,g0=0,b0=0,n=0; const sxa=hx0+sxc, sya=hy0+syc;
        for(let sy=Math.floor(sya); sy<Math.min(h,Math.ceil(sya+1/s)); sy++) for(let sx=Math.floor(sxa); sx<Math.min(w,Math.ceil(sxa+1/s)); sx++){ const i=(sy*w+sx)*4; r0+=d[i]; g0+=d[i+1]; b0+=d[i+2]; n++; }
        if(n) put(X, Y, r0/n, g0/n, b0/n, (t<=0) ? 1 : 1-(t-0.5)/D);
      }
    }
    else if(neckLen>0 && nr>nl){
      let nx0 = Math.round(tx0+nl*s), nx1 = Math.round(tx0+(nr+1)*s)-1;
      /* A COLLAR THAT HOLDS THE NECK: where the opening is only a little wider than the neck (under a third), the neck
         fills it from side to side, as it does in the close-up; slivers of the collar's inside beside it read as
         faults. A much wider opening (a coat's collar) keeps its own inside beside the neck. */
      const natural0 = nx0, natural1 = nx1;
      let ox0 = -1, ox1 = -1; for(let X=open.box[0]; X<=open.box[2]; X++) if(edgeAt(X)>=0){ if(ox0<0) ox0=X; ox1=X; }
      if(ox0>=0 && (ox0<nx0 || ox1>nx1) && (Math.max(0,nx0-ox0)+Math.max(0,ox1-nx1)) <= (nx1-nx0+1)*0.33){ nx0 = Math.min(nx0, ox0); nx1 = Math.max(nx1, ox1); }
      const widen = (nx1-nx0)/Math.max(1, natural1-natural0);   // 1 = the neck's own width
      const kLast = (()=>{ for(let k=neckLen; k>=1; k--){ const e=nExt[k-1]; if(e && e[1]-e[0] >= (nr-nl)*0.3) return k; } return 1; })();
      for(let X=Math.max(0,nx0); X<=Math.min(w-1,nx1); X++){
        let e = edgeAt(X);
        if(e<0){ e = behind-1; for(let Y=behind; Y<Math.min(h, open.bottom+1); Y++){ if(pkDist(bd,(Y*w+X)*4,dbg.c)>=HB_T1) break; e = Y; } }   // beside the opening: down to the clothes
        const sxc = nl + (X-nx0)/s/widen, side = (X===nx0 || X===nx1) ? 0.5 : 1;
        for(let Y=behind; Y<=e; Y++){
          let k = Math.max(1, Math.min(kLast, Math.round((Y-chinRow)/s)+1));
          // the last row at or above this one whose neck reaches this column
          while(k>1){ const ex=nExt[k-1]; if(ex && sxc>=ex[0] && sxc<=ex[1]) break; k--; }
          const ex = nExt[k-1]; if(!ex) continue;
          const sx = Math.max(ex[0], Math.min(ex[1]-1/s, sxc));
          const v = avg(sx, sx+1/s, HH+k, HH+k+1/s); if(!v) continue;
          put(X, Y, v[0], v[1], v[2], (Y===e ? 0.75 : 1)*side);
        } }
    }
    /* then the head. Under the jaw it is behind the clothes: its last rows stop at the opening's lower edge, and beside
       the opening they go only onto the background. */
    for(let ty=0; ty<headRows; ty++) for(let tx=0; tx<tw; tx++){
      const v = avg(tx/s, (tx+1)/s, ty/s, Math.min((ty+1)/s, HH+1)); if(!v || v[3]<0.06) continue;
      const X=tx0+tx, Y=topT+ty;
      if(Y>=behind){ const e=edgeAt(X); if(!((e>=0 && Y<=e) || pkDist(bd,(Y*w+X)*4,dbg.c)<HB_T1)) continue; }
      put(X, Y, v[0], v[1], v[2], Math.min(1,v[3]));
    }
    for(let i=0;i<out.length;i+=4) if(Math.abs(out[i]-d[i])+Math.abs(out[i+1]-d[i+1])+Math.abs(out[i+2]-d[i+2])>6) changed++;
    return { out:{ width:w, height:h, data:out }, changed, box:[tx0,topT,tx0+tw,Math.max(chinRow,open.bottom)], scale:s, fit:s/s0, neckLen,
      moved: moved ? { by:moved.by, x0:moved.x0, x1:moved.x1, level:!!moved.level, other:moved.other||null } : null,
      aligned: al ? { score:Math.round(al.score*10)/10, typical:Math.round(al.typical*10)/10, size:Math.round(al.k*100)/100 } : null };
  }

  /* HOW WIDE A HEAD IS in a view that has one (the back view, a side view): inside the box it was pointed at, the widest
     run of rows that are not background, above the shoulders. The box only needs to hold the head. 0 = not measurable. */
  function pkHeadMeasure(img, box){
    const w=img.width, h=img.height, d=img.data, b=pkBox(box, w, h), bw=b[2]-b[0], bh=b[3]-b[1];
    if(bw<12 || bh<12) return { width:0, top:0 };
    const x0=Math.max(0, Math.round(b[0]-bw*0.12)), x1=Math.min(w-1, Math.round(b[2]+bw*0.12));
    const cs=Math.max(4, Math.round(bw*0.1));
    const bgs=[pkSample(img, x0, b[1], x0+cs, b[1]+cs), pkSample(img, x1-cs, b[1], x1, b[1]+cs)].filter(s=> s && s.dev<10);
    if(!bgs.length) return { width:0, top:0 };
    const bg=bgs.sort((p,q)=>p.dev-q.dev)[0].c;
    let best=0, top=-1, mid=0;
    for(let y=Math.max(0, Math.round(b[1]-bh*0.15)); y<b[1]+bh*0.62; y++){
      let l=-1, r=-1, run=0;
      for(let x=x0; x<=x1; x++){ if(pkDist(d,(y*w+x)*4,bg)>=33){ if(++run>=3){ l=x-2; break; } } else run=0; }
      run=0; for(let x=x1; x>=x0; x--){ if(pkDist(d,(y*w+x)*4,bg)>=33){ if(++run>=3){ r=x+2; break; } } else run=0; }
      if(l>=0 && r>l && l>x0+1 && r<x1-1){ if(top<0) top=y; if(r-l>best){ best=r-l; mid=(l+r)/2; } }   // a run that touches the box's side is the shoulders or a neighbour
    }
    return { width:best, top:best ? top : 0, cx:best ? mid : 0 };   // top: the row its head starts on (the gap this sheet leaves above a head)
  }
  function pkHeadWidth(img, box){ return pkHeadMeasure(img, box).width; }
  /* WHAT THE READER ANSWERED (boxes in thousandths of the picture) made into the pixels pkHeadBack takes; null when a
     needed part is missing. The head's size comes from a view that has a head; without one, from the shoulders. */
  function pkHeadPlan(found, img){
    const f = found || {}, w = img.width, h = img.height;
    const okBox = (b)=> Array.isArray(b) && b.length===4 && b.every(v=> typeof v==="number" && isFinite(v) && v>=-5 && v<=1005);
    if(!okBox(f.head) || !okBox(f.opening) || !(typeof f.chin==="number" && isFinite(f.chin))) return null;
    const px = (b)=> [Math.min(b[0],b[2])/1000*w, Math.min(b[1],b[3])/1000*h, Math.max(b[0],b[2])/1000*w, Math.max(b[1],b[3])/1000*h];
    const head = px(f.head), opening = px(f.opening), chinY = f.chin/1000*h;
    if(head[2]-head[0]<40 || chinY-head[1]<40 || opening[2]-opening[0]<6 || opening[3]-opening[1]<4) return null;
    const other = okBox(f.otherHead) ? pkHeadMeasure(img, px(f.otherHead)) : null;
    let headWidth = other ? other.width : 0, from = headWidth ? "view" : "";
    if(!headWidth && Array.isArray(f.shoulders) && f.shoulders.length===2 && f.shoulders.every(v=> typeof v==="number" && isFinite(v))){
      headWidth = Math.abs(f.shoulders[1]-f.shoulders[0])/1000*w/2.8; from = "shoulders"; }
    if(!(headWidth>8)) return null;
    return { head, chinY, opening, headWidth, sizedFrom:from, topGap:(other && other.width && other.top>0) ? other.top : 0, otherCx:(other && other.width) ? other.cx : 0 };
  }
  /* A PICTURE MADE LARGER keeps its edges: after it is resampled, each pixel is pushed a little away from the average of
     its four neighbours (amount 0 = nothing, 0.35 = the default). Flat areas do not change. Returns the same picture. */
  function pkSharpen(img, amount){
    const w=img.width, h=img.height, d=img.data, k=(amount==null ? 0.35 : amount);
    if(!(k>0) || w<3 || h<3) return img;
    const src=new Uint8ClampedArray(d);
    for(let y=1; y<h-1; y++) for(let x=1; x<w-1; x++){ const i=(y*w+x)*4;
      for(let c=0; c<3; c++){ const v=src[i+c], avg=(src[i+c-4]+src[i+c+4]+src[i+c-w*4]+src[i+c+w*4])/4; d[i+c] = v + (v-avg)*k; } }
    return img;
  }
  root.PixelKeep = { pkSharpen, pkAlign, pkCompose, pkCount, pkOnlyInside, pkPlacements, pkBox, pkHeadBack, pkHeadPlan, pkHeadWidth, pkHeadMeasure, pkNeckOpening, pkMoveDown };
})(typeof window!=="undefined" ? window : globalThis);
