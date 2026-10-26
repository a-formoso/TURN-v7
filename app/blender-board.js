/* BLENDER BOARDS (owner 2026-10-26: "go ahead with Blender board stills feeding the Stage").
   In Blender, "Publish board" renders 1-4 stills of a Studio shot through its camera, from its first frame to
   its last, and the relay stores them as previews whose ids say which board and frame they are:
   preview-board_<requestId>_<n>of<N>_f<frame>. The Stage finds a shot's latest complete board, lays its
   frames out as one lettered page (A, B, C…, a caption under each, a key naming each coloured stand-in)
   and saves the page as the film image "blender-board-<shotId>". The page rides into the clip's render as a
   reference: the camera and the blocking come from it, every look from the other references. */
(function(root){
  "use strict";
  var BOARD_ID = /^preview-board_([A-Za-z0-9][A-Za-z0-9_-]{0,63})_([1-4])of([1-4])_f(\d{1,7})$/;
  function slotId(shotId){
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(String(shotId))) throw new Error("Invalid shot identity.");
    return "blender-board-"+shotId;
  }
  function parsePreviewId(id){
    var m = BOARD_ID.exec(String(id||""));
    if(!m || Number(m[2])>Number(m[3])) return null;
    return { boardId:m[1], index:Number(m[2]), count:Number(m[3]), frame:Number(m[4]) };
  }
  // the shot's newest board whose frames are all there (previews are kept in publish order)
  function latestBoard(previews, shotId){
    var byBoard = {}, order = [];
    (previews||[]).forEach(function(p){
      if(!p || p.shotId!==shotId) return;
      var b = parsePreviewId(p.id); if(!b) return;
      if(!byBoard[b.boardId]){ byBoard[b.boardId] = []; order.push(b.boardId); }
      byBoard[b.boardId].push({ previewId:p.id, index:b.index, count:b.count, frame:b.frame, actualCamera:p.actualCamera||null });
    });
    for(var i=order.length-1;i>=0;i--){
      var frames = byBoard[order[i]].slice().sort(function(a,b){ return a.index-b.index; });
      var count = frames[0].count;
      if(frames.length===count && frames.every(function(f,j){ return f.index===j+1 && f.count===count; }))
        return { boardId:order[i], frames:frames };
    }
    return null;
  }
  function letter(i){ return String.fromCharCode(65+i); }
  // a Blender material colour (scene-linear 0-1) as the sRGB the render shows
  function toSrgb(c){
    c = Math.max(0, Math.min(1, Number(c)||0));
    return c<=0.0031308 ? c*12.92 : 1.055*Math.pow(c,1/2.4)-0.055;
  }
  function cssColour(rgb){
    var v = (rgb||[]).slice(0,3).map(function(c){ return Math.round(toSrgb(c)*255); });
    return v.length===3 ? "rgb("+v.join(",")+")" : "rgb(128,128,128)";
  }
  // a plain colour word for the prompt ("the blue stand-in is Mara")
  function colourName(rgb){
    var v = (rgb||[]).slice(0,3).map(toSrgb); if(v.length<3) return "grey";
    var r=v[0], g=v[1], b=v[2], max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    if(max<0.18) return "black";
    if(d<0.12) return max>0.85 ? "white" : "grey";
    var h = max===r ? ((g-b)/d)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4; h=(h*60+360)%360;
    if(h<15||h>=340) return (max-min>0.25&&r>0.6&&g<0.45&&b>0.45) ? "pink" : "red";
    if(h<40) return (max<0.55) ? "brown" : "orange";
    if(h<70) return "yellow";
    if(h<160) return "green";
    if(h<200) return "cyan";
    if(h<255) return "blue";
    if(h<290) return "purple";
    return "pink";
  }
  // who each coloured stand-in in a Studio shot is: [{ name, colour, css }]
  function standInKey(shot, characters){
    var byId = {}; (characters||[]).forEach(function(c){ if(c&&c.id) byId[c.id]=c; });
    var seen = {}, out = [];
    ((shot&&shot.objects)||[]).forEach(function(o){
      if(!o || o.kind!=="actor" || !o.characterId || seen[o.characterId]) return;
      var c = byId[o.characterId]; if(!c || !c.name) return;
      seen[o.characterId] = 1;
      out.push({ name:String(c.name), colour:colourName(o.color), css:cssColour(o.color) });
    });
    return out;
  }
  function keyText(key){
    return (key||[]).map(function(k){ return "the "+k.colour+" stand-in is "+k.name; }).join("; ");
  }
  function captions(frames){
    return frames.map(function(f,i){
      var where = frames.length===1 ? "" : i===0 ? "start, " : i===frames.length-1 ? "end, " : "";
      return letter(i)+" · "+where+"frame "+f.frame;
    });
  }
  function loadImage(src){
    return new Promise(function(resolve, reject){
      var img = new Image(); img.onload = function(){ resolve(img); };
      img.onerror = function(){ reject(new Error("A board frame could not be read.")); }; img.src = src;
    });
  }
  /* One page: a title line, the frames left to right (two rows for four), each lettered with its caption
     under it, and a key of the stand-ins. Returns a JPEG data URL. Browser only. */
  async function compose(opts){
    var frames = (opts&&opts.frames)||[]; if(!frames.length) throw new Error("This board has no frames.");
    var images = await Promise.all(frames.map(function(f){ return loadImage(f.dataUrl); }));
    var cols = frames.length===4 ? 2 : frames.length, rows = frames.length===4 ? 2 : 1;
    var cellW = frames.length===1 ? 1280 : 820, aspect = images[0].naturalHeight/Math.max(1,images[0].naturalWidth);
    var cellH = Math.round(cellW*aspect), pad = 24, head = 64, cap = 40, foot = 52;
    var W = pad+cols*(cellW+pad), H = head+rows*(cellH+cap+pad)+foot;
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0,0,W,H);
    g.fillStyle = "#1d1b18"; g.font = "600 26px Helvetica, Arial, sans-serif"; g.textBaseline = "middle";
    g.fillText(String((opts&&opts.title)||"Blocking board"), pad, head/2);
    var caps = captions(frames);
    images.forEach(function(img,i){
      var c = i%cols, r = Math.floor(i/cols), x = pad+c*(cellW+pad), y = head+r*(cellH+cap+pad);
      g.drawImage(img, x, y, cellW, cellH);
      g.strokeStyle = "#1d1b18"; g.lineWidth = 2; g.strokeRect(x+1, y+1, cellW-2, cellH-2);
      g.fillStyle = "#1d1b18"; g.fillRect(x, y, 46, 40);
      g.fillStyle = "#ffffff"; g.font = "700 24px Helvetica, Arial, sans-serif"; g.textAlign = "center";
      g.fillText(letter(i), x+23, y+21); g.textAlign = "left";
      g.fillStyle = "#4a463f"; g.font = "500 20px Helvetica, Arial, sans-serif";
      g.fillText(caps[i], x, y+cellH+cap/2+2);
    });
    var key = (opts&&opts.key)||[], kx = pad, ky = H-foot/2;
    g.font = "500 19px Helvetica, Arial, sans-serif";
    key.forEach(function(k){
      g.fillStyle = k.css; g.fillRect(kx, ky-10, 20, 20);
      g.strokeStyle = "#1d1b18"; g.lineWidth = 1; g.strokeRect(kx+0.5, ky-9.5, 19, 19);
      g.fillStyle = "#1d1b18"; g.fillText(k.name, kx+28, ky+1);
      kx += 28+Math.ceil(g.measureText(k.name).width)+28;
    });
    g.fillStyle = "#77716a";
    g.fillText("Grey shapes and coloured stand-ins mark position only.", Math.max(kx, pad), ky+1);
    return cv.toDataURL("image/jpeg", 0.9);
  }
  root.BlenderBoards = { slotId:slotId, parsePreviewId:parsePreviewId, latestBoard:latestBoard,
    colourName:colourName, standInKey:standInKey, keyText:keyText, captions:captions, compose:compose };
})(typeof window!=="undefined"?window:globalThis);
