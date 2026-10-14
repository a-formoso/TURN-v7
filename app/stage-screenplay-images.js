/* Canonical Stage screenplay page images.
 *
 * This renderer is intentionally local and synchronous.  It turns the
 * immutable stageScreenplayReference text into ordinary PNG canvas pages; it
 * never asks an image provider for an interpretation of the screenplay.
 */
(function(root){
  "use strict";

  const hasText = value => typeof value === "string" && value.length > 0;
  const messageOf = error => String(error && error.message || error || "unknown error").trim();

  const WIDTH = 1000;
  const MARGIN_X = 78;
  const HEADER_Y = 42;
  const FIRST_ROW_Y = 92;          // the first text row's baseline
  const BOTTOM_PAD = 65;           // a row's baseline stays at least this far above the page's foot
  const BODY_WIDTH = WIDTH - (MARGIN_X * 2);
  const LABEL_FONT = "11px Courier New, monospace";
  const LABEL_RIGHT = MARGIN_X - 18;   // a beat's label sits in the left margin, right-aligned here
  const HEADER_FONT = "700 15px Courier New, monospace";
  const FOOTER_FONT = "12px Courier New, monospace";
  /*
   * ONE PAGE PER SCENE WHEN IT FITS (2026-10-14, owner — "go ahead with all of it"): the same layouts as the
   * Locations / shot pages (locations.jsx LOC_SCREENPLAY_LAYOUTS), tried in order — the first that fits the whole
   * scene on one page wins; a scene none fits takes the fewest pages any layout allows, on the most legible layout
   * that allows them, split EVENLY between blocks.  Each block's beat label sits in the left margin beside its first
   * line instead of on a row of its own.
   */
  const LAYOUTS = [
    {id:"15px-tight",font:15,lineH:18,spacing:0.5,height:1294},
    {id:"15px-tall",font:15,lineH:18,spacing:0.5,height:1500},
    {id:"14px",font:14,lineH:17,spacing:0.5,height:1500},
    {id:"13px-floor",font:13,lineH:16,spacing:0.4,height:1500}
  ];
  const bodyFont = layout => layout.font+"px Courier New, monospace";
  const boldFont = layout => "700 "+layout.font+"px Courier New, monospace";

  function uniqueErrors(values){
    const out = [];
    (Array.isArray(values) ? values : [values]).forEach(value=>{
      const text = String(value == null ? "" : value).trim();
      if(text && out.indexOf(text)<0) out.push(text);
    });
    return out;
  }

  function failed(reference, errors){
    return {
      signature: reference && typeof reference === "object" ? reference.signature : "",
      images:[],
      errors:uniqueErrors(errors)
    };
  }

  function validate(reference){
    if(!reference || typeof reference !== "object" || Array.isArray(reference))
      return ["Cannot render screenplay pages: the screenplay reference is missing or invalid."];
    const errors = uniqueErrors(reference.errors);
    if(typeof reference.signature !== "string" || !reference.signature)
      errors.push("Cannot render screenplay pages: the screenplay reference has no signature.");
    if(reference.hasSource !== true)
      errors.push("Cannot render screenplay pages: the canonical screenplay source is unavailable.");
    if(!hasText(reference.fullText))
      errors.push("Cannot render screenplay pages: the canonical full-scene screenplay is empty.");
    if(!Array.isArray(reference.targetBeats))
      errors.push("Cannot render screenplay pages: targetBeats must be an array.");
    else if(reference.targetBeats.some(beat=>{
      const n=Number(beat);
      return typeof beat!=="number" || !Number.isFinite(n) || n<=0;
    }))
      errors.push("Cannot render screenplay pages: targetBeats must contain positive numbers.");
    if(!Array.isArray(reference.errors))
      errors.push("Cannot render screenplay pages: reference errors must be an array.");
    return uniqueErrors(errors);
  }

  function numberOf(value){
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function lineInfo(raw, targetSet, inherited){
    const value = String(raw == null ? "" : raw);
    if(!value) return inherited
      ? {blank:true,continuation:true,beat:inherited.beat,target:inherited.target,type:inherited.type}
      : {blank:true};

    /*
     * stageScreenplayReference uses [BEAT n · TYPE] labels around each
     * authored block.  Keep the label as a visible, quiet metadata line while
     * laying out the authored text using the corresponding screenplay column.
     */
    const tagged = value.match(/^\[BEAT\s+([0-9]+(?:\.[0-9]+)?)\s*(?:[·•-]\s*([^\]]+))?\]\s?(.*)$/i);
    if(tagged){
      const beat = numberOf(tagged[1]);
      const type = String(tagged[2] || "ACTION").trim().toLowerCase();
      return {
        label:value.slice(0,value.indexOf("]")+1),
        text:tagged[3],
        type,
        beat,
        target:beat != null && targetSet.has(beat),
        continuation:false
      };
    }
    const plain = value.match(/^\[([A-Z][A-Z _-]*)\]\s?(.*)$/);
    if(plain){
      return {
        label:"["+plain[1]+"]",
        text:plain[2],
        type:String(plain[1]).trim().toLowerCase(),
        beat:null,
        target:false,
        continuation:false
      };
    }
    if(inherited) return {
      label:"",
      text:value,
      type:inherited.type,
      beat:inherited.beat,
      target:inherited.target,
      continuation:true
    };
    return {label:"",text:value,type:"action",beat:null,target:false};
  }

  function styleFor(type){
    switch(String(type || "action").toLowerCase()){
      case "scene":
      case "slug":
      case "slugline":
        return {x:MARGIN_X,width:BODY_WIDTH,bold:true,upper:true,before:8,after:8};
      case "char":
      case "character":
        return {x:382,width:238,bold:true,upper:false,before:10,after:1};
      case "paren":
      case "parenthetical":
        return {x:304,width:316,bold:false,upper:false,before:0,after:1,paren:true};
      case "dia":
      case "dialogue":
        return {x:252,width:404,bold:false,upper:false,before:0,after:9};
      case "trans":
      case "transition":
        return {x:641,width:281,bold:true,upper:true,before:10,after:10};
      default:
        return {x:MARGIN_X,width:BODY_WIDTH,bold:false,upper:false,before:7,after:8};
    }
  }

  function measure(ctx, text, font){
    const source = String(text == null ? "" : text);
    if(!ctx || typeof ctx.measureText!=="function")
      throw new Error("canvas text measurement is unavailable");
    ctx.font = font;
    const result = ctx.measureText(source);
    const width = Number(result && result.width);
    if(!Number.isFinite(width) || width < 0)
      throw new Error("canvas text measurement returned an invalid width");
    return width;
  }

  function longestFittingPrefix(ctx, source, width, font){
    if(!source) return 0;
    if(measure(ctx,source,font) <= width) return source.length;
    let low = 1, high = source.length, best = 0;
    while(low <= high){
      const middle = Math.floor((low + high) / 2);
      if(measure(ctx,source.slice(0,middle),font) <= width){
        best = middle;
        low = middle + 1;
      }else high = middle - 1;
    }
    return best || 1;
  }

  /*
   * Wrap by words first, then by characters when one token is wider than the
   * screenplay column.  No ellipsis or character cap is used: every source
   * character is placed on some page.
   */
  function wrapText(ctx, text, width, font){
    const source = String(text == null ? "" : text);
    if(!source) return [""];
    const out = [];
    let remaining = source;
    while(remaining.length){
      const fit = longestFittingPrefix(ctx,remaining,width,font);
      if(fit >= remaining.length){
        out.push(remaining);
        break;
      }
      let cut = remaining.slice(0,fit).lastIndexOf(" ");
      if(cut <= 0) cut = fit;
      if(cut <= 0) cut = 1;
      const part = remaining.slice(0,cut);
      out.push(part || remaining.slice(0,1));
      /*
       * Spaces used as a wrapping boundary are layout whitespace, not
       * authored words.  Retain all non-space source characters, including
       * every character in an unbroken token.
       */
      remaining = remaining.slice(cut).replace(/^ +/,"");
    }
    return out.length ? out : [""];
  }

  function blocksFromReference(reference){
    const targetSet = new Set((reference.targetBeats||[]).map(numberOf).filter(n=>n != null));
    const lines = String(reference.fullText).replace(/\r\n?/g,"\n").split("\n");
    let inherited = null;
    const blocks = lines.map(line=>{
      const block = lineInfo(line,targetSet,inherited);
      if(!block.blank && !block.continuation)
        inherited = {type:block.type,beat:block.beat,target:block.target};
      return block;
    });
    /*
     * A newline inside an authored block is not a new screenplay block.  Do
     * not add block spacing before/after those continuation rows; the next
     * labelled line remains the boundary between authored blocks.
     */
    blocks.forEach((block,index)=>{
      block.continuesNext = !!(blocks[index+1] && blocks[index+1].continuation);
    });
    return blocks;
  }

  /*
   * The scene laid out for ONE layout: items [{rows, before, after, beat, label, target}] grouped so that a block's
   * continuation lines, and a character cue / parenthetical with the lines after it, never part across a page.
   * A blank source line becomes spacing before the next block (never a row of its own).
   */
  function buildGroups(ctx, reference, layout){
    const items = [];
    let pendingBlank = 0;
    blocksFromReference(reference).forEach(block=>{
      if(block.blank){
        if(items.length) pendingBlank += Math.round(layout.lineH/2);
        return;
      }
      const style = styleFor(block.type);
      let text = String(block.text||"");
      if(style.paren && !block.continuation){
        const core = text.replace(/^\s*\(+\s*/,"").replace(/\s*\)+\s*$/,"");
        text = core.trim() ? "("+core+(block.continuesNext ? "" : ")") : text;
      }else if(style.paren && !block.continuesNext && !/\)\s*$/.test(text) && text.trim()) text = text+")";
      const content = style.upper ? text.toUpperCase() : text;
      const font = style.bold ? boldFont(layout) : bodyFont(layout);
      const rows = wrapText(ctx,content,style.width,font).map(row=>({text:row,x:style.x,font,bold:style.bold}));
      items.push({
        rows,
        before:(block.continuation ? 0 : Math.round(style.before*layout.spacing))+pendingBlank,
        after:block.continuesNext ? 0 : Math.round(style.after*layout.spacing),
        beat:block.beat,
        label:block.beat != null ? "BEAT "+block.beat : "",
        target:!!block.target,
        type:String(block.type||"action").toLowerCase(),
        continuation:!!block.continuation
      });
      pendingBlank = 0;
    });
    const groups = [];
    items.forEach((item,index)=>{
      const prev = items[index-1];
      const glue = prev && groups.length && (item.continuation
        || (/^(char|character|paren|parenthetical)$/.test(prev.type) && /^(paren|parenthetical|dia|dialogue)$/.test(item.type)));
      if(glue) groups[groups.length-1].push(item);
      else groups.push([item]);
    });
    return groups;
  }

  /* page packing — the same as locations.jsx locationScreenplayPack / locationScreenplayBalance */
  function pack(entries, cap){
    const pages = [];
    let current = null;
    for(let index=0; index<entries.length; index++){
      const entry = entries[index];
      if(entry.h - entry.before - entry.after > cap) return null;
      if(current && current.sum + entry.h - current.before - entry.after <= cap){
        current.items.push(index);
        current.sum += entry.h;
      }else{
        current = {items:[index],sum:entry.h,before:entry.before};
        pages.push(current);
      }
    }
    return pages.map(page=>page.items);
  }

  function balance(entries, usable){
    const first = pack(entries,usable);
    if(!first || first.length<=1) return first;
    let low = 0, high = usable;
    while(high - low > 1){
      const middle = Math.floor((low + high) / 2);
      const pages = pack(entries,middle);
      if(pages && pages.length<=first.length) high = middle;
      else low = middle;
    }
    return pack(entries,high);
  }

  /* → {layout, pages:[[item…]]} (each page's first item has no spacing before it) */
  function layoutPages(ctx, reference){
    let best = null;
    for(const layout of LAYOUTS){
      const usable = layout.height - BOTTOM_PAD - FIRST_ROW_Y;
      const heightOf = group => group.reduce((sum,item)=>sum+item.before+item.rows.length*layout.lineH+item.after,0);
      const groups = [];
      buildGroups(ctx,reference,layout).forEach(group=>{
        if(heightOf(group) - group[0].before - group[group.length-1].after <= usable){
          groups.push(group);
          return;
        }
        /* longer than a page (an unbroken token, a very long paragraph): split between its rows */
        group.forEach(item=>item.rows.forEach((row,index)=>groups.push([{
          ...item,
          rows:[row],
          before:index ? 0 : item.before,
          after:index===item.rows.length-1 ? item.after : 0,
          label:index ? "" : item.label
        }])));
      });
      const pages = balance(groups.map(group=>({
        h:heightOf(group),before:group[0].before,after:group[group.length-1].after
      })),usable);
      if(!pages) continue;
      if(!best || pages.length < best.pages.length) best = {layout,groups,pages};
      if(pages.length===1) break;
    }
    if(!best) throw new Error("the scene cannot be laid out on a page");
    return {layout:best.layout,pages:best.pages.map(indexes=>{
      const items = [];
      indexes.forEach(index=>best.groups[index].forEach(item=>items.push(items.length ? item : {...item,before:0})));
      return items;
    })};
  }

  function sceneTitle(reference){
    const no = reference.sceneNo == null || String(reference.sceneNo)==="" ? "" : String(reference.sceneNo)+" — ";
    return ("SCENE "+no+(reference.sceneTitle || reference.sceneId || "SCREENPLAY")).toUpperCase();
  }

  function drawPage(canvas, pageItems, pageNumber, totalPages, reference, layout){
    const ctx = canvas.getContext("2d");
    if(!ctx) throw new Error("screenplay page canvas has no 2D context");
    const height = layout.height;
    canvas.width = WIDTH;
    canvas.height = height;
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(0,0,WIDTH,height);
    ctx.fillStyle = "#151515";
    ctx.font = HEADER_FONT;
    ctx.fillText(sceneTitle(reference),MARGIN_X,HEADER_Y);
    ctx.textAlign = "right";
    ctx.fillText("PAGE "+pageNumber+" OF "+totalPages,WIDTH-MARGIN_X,HEADER_Y);
    ctx.textAlign = "left";
    ctx.fillStyle = "#76621f";
    ctx.font = LABEL_FONT;
    const beats = (reference.targetBeats||[]).join(", ");
    ctx.fillText(beats ? "TARGET BEAT"+(beats.indexOf(",")>=0 ? "S" : "")
      +" "+beats+" HIGHLIGHTED" : "FULL SCENE SCREENPLAY",MARGIN_X,HEADER_Y+18);

    let y = FIRST_ROW_Y;
    let labelled = null;
    pageItems.forEach(item=>{
      y += item.before;
      /* the beat's label in the margin beside its first line — again only when the beat changes */
      if(item.label && item.beat !== labelled){
        ctx.fillStyle = item.target ? "#76621f" : "#8a8177";
        ctx.font = LABEL_FONT;
        ctx.textAlign = "right";
        ctx.fillText(item.label,LABEL_RIGHT,y,LABEL_RIGHT-8);   // a long beat number is narrowed, never off the page
        ctx.textAlign = "left";
        labelled = item.beat;
      }
      item.rows.forEach(row=>{
        if(item.target){
          ctx.fillStyle = "#ead58b";
          ctx.fillRect(MARGIN_X-16,y-layout.lineH+3,BODY_WIDTH+16,layout.lineH+4);
        }
        ctx.fillStyle = item.target ? "#15120d" : "#151515";
        ctx.font = row.font || bodyFont(layout);
        ctx.textAlign = "left";
        ctx.fillText(String(row.text == null ? "" : row.text),Number(row.x)||MARGIN_X,y);
        y += layout.lineH;
      });
      y += item.after;
    });
    ctx.fillStyle = "#8a8177";
    ctx.font = FOOTER_FONT;
    ctx.textAlign = "left";
    ctx.fillText("FULL SCENE SCREENPLAY — CANONICAL STAGE REFERENCE",MARGIN_X,height-34);
    ctx.textAlign = "right";
    ctx.fillText("SOURCE "+String(reference.signature),WIDTH-MARGIN_X,height-34);
    ctx.textAlign = "left";
    let url;
    try{ url = canvas.toDataURL("image/png"); }
    catch(error){ throw new Error("screenplay page canvas could not produce a PNG: "+messageOf(error)); }
    if(typeof url !== "string" || url.indexOf("data:image/png")!==0)
      throw new Error("screenplay page canvas returned an invalid PNG data URL.");
    return url;
  }

  function stageScreenplayImages(reference){
    const errors = validate(reference);
    if(errors.length) return failed(reference,errors);
    const signature = reference.signature;
    const documentRef = root && root.document;
    if(!documentRef || typeof documentRef.createElement!=="function")
      return failed(reference,["Cannot render screenplay pages: browser canvas is unavailable."]);

    let measureCanvas;
    let measureContext;
    try{
      measureCanvas = documentRef.createElement("canvas");
      measureContext = measureCanvas && measureCanvas.getContext("2d");
    }catch(error){
      return failed(reference,["Cannot render screenplay pages: canvas creation failed: "+messageOf(error)+"."]);
    }
    if(!measureContext)
      return failed(reference,["Cannot render screenplay pages: canvas 2D context is unavailable."]);

    let pages, layout;
    try{
      const laid = layoutPages(measureContext,reference);
      pages = laid.pages;
      layout = laid.layout;
    }catch(error){
      return failed(reference,["Cannot render screenplay pages: source layout failed: "+messageOf(error)+"."]);
    }
    const images = [];
    try{
      pages.forEach((pageRows,index)=>{
        const canvas = documentRef.createElement("canvas");
        if(!canvas || typeof canvas.getContext!=="function")
          throw new Error("canvas element could not be created");
        const url = drawPage(canvas,pageRows,index+1,pages.length,reference,layout);
        images.push({
          id:"stage-screenplay:"+signature+":page-"+(index+1),
          url,
          label:sceneTitle(reference)+" — SCREENPLAY PAGE "+(index+1)+" OF "+pages.length,
          page:index+1,
          totalPages:pages.length,
          sourceSignature:signature,
          targetBeats:(reference.targetBeats||[]).slice(),
          layout:layout.id,
          width:WIDTH,
          height:layout.height
        });
      });
    }catch(error){
      return failed(reference,["Cannot render screenplay pages: "+messageOf(error)+"."]);
    }
    return {signature,images,errors:[]};
  }

  root.stageScreenplayImages = stageScreenplayImages;
})(typeof window!=="undefined" ? window : globalThis);