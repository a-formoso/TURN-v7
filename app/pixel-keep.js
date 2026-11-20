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
  root.PixelKeep = { pkAlign, pkCompose, pkCount, pkOnlyInside, pkPlacements, pkBox };
})(typeof window!=="undefined" ? window : globalThis);
