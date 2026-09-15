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
  const HEIGHT = 1294;
  const MARGIN_X = 78;
  const HEADER_Y = 42;
  const FIRST_ROW_Y = 92;
  const FOOTER_Y = HEIGHT - 34;
  const ROW_HEIGHT = 21;
  const BOTTOM_ROW_Y = HEIGHT - 65;
  const BODY_WIDTH = WIDTH - (MARGIN_X * 2);
  const BODY_FONT = "15px Courier New, monospace";
  const BOLD_FONT = "700 15px Courier New, monospace";
  const LABEL_FONT = "11px Courier New, monospace";
  const HEADER_FONT = "700 15px Courier New, monospace";
  const FOOTER_FONT = "12px Courier New, monospace";

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
        return {x:304,width:316,bold:false,upper:false,before:0,after:1};
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

  function buildRows(ctx, reference){
    const rows = [];
    blocksFromReference(reference).forEach(block=>{
      if(block.blank){
        rows.push({blank:true,height:Math.round(ROW_HEIGHT/2),target:false});
        return;
      }
      const style = styleFor(block.type);
      const content = style.upper ? String(block.text||"").toUpperCase() : String(block.text||"");
      const textRows = wrapText(ctx,content,style.width,style.bold ? BOLD_FONT : BODY_FONT);
      const label = String(block.label||"");
      const labelTarget = !!block.target;
      const before = block.continuation ? 0 : style.before;
      const after = block.continuesNext ? 0 : style.after;
      if(label){
        rows.push({
          text:label,x:MARGIN_X,width:BODY_WIDTH,font:LABEL_FONT,bold:false,
          target:labelTarget,height:ROW_HEIGHT,before
        });
      }else if(before){
        rows.push({blank:true,height:before,target:false});
      }
      textRows.forEach(text=>{
        rows.push({
          text,x:style.x,width:style.width,font:style.bold ? BOLD_FONT : BODY_FONT,
          bold:style.bold,target:labelTarget,height:ROW_HEIGHT,before:0
        });
      });
      if(after) rows.push({blank:true,height:after,target:false});
    });
    return rows;
  }

  function paginate(rows){
    const pages = [];
    let page = [];
    let y = FIRST_ROW_Y;
    rows.forEach(row=>{
      const height = Math.max(1,Number(row.height)||ROW_HEIGHT);
      const before = Math.max(0,Number(row.before)||0);
      if(page.length && y + before + height > BOTTOM_ROW_Y){
        pages.push(page);
        page = [];
        y = FIRST_ROW_Y;
      }
      if(before){
        page.push({blank:true,height:before,target:false});
        y += before;
      }
      page.push(row);
      y += height;
    });
    if(page.length) pages.push(page);
    return pages.length ? pages : [[]];
  }

  function sceneTitle(reference){
    const no = reference.sceneNo == null || String(reference.sceneNo)==="" ? "" : String(reference.sceneNo)+" — ";
    return ("SCENE "+no+(reference.sceneTitle || reference.sceneId || "SCREENPLAY")).toUpperCase();
  }

  function drawPage(canvas, pageRows, pageNumber, totalPages, reference){
    const ctx = canvas.getContext("2d");
    if(!ctx) throw new Error("screenplay page canvas has no 2D context");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(0,0,WIDTH,HEIGHT);
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
    pageRows.forEach(row=>{
      const height = Math.max(1,Number(row.height)||ROW_HEIGHT);
      if(row.blank){
        y += height;
        return;
      }
      if(row.target){
        ctx.fillStyle = "#ead58b";
        ctx.fillRect(MARGIN_X-16,y-ROW_HEIGHT+3,BODY_WIDTH+16,ROW_HEIGHT+4);
      }
      ctx.fillStyle = row.target ? "#15120d" : "#151515";
      ctx.font = row.font || BODY_FONT;
      ctx.textAlign = "left";
      ctx.fillText(String(row.text == null ? "" : row.text),Number(row.x)||MARGIN_X,y);
      y += height;
    });
    ctx.fillStyle = "#8a8177";
    ctx.font = FOOTER_FONT;
    ctx.textAlign = "left";
    ctx.fillText("FULL SCENE SCREENPLAY — CANONICAL STAGE REFERENCE",MARGIN_X,FOOTER_Y);
    ctx.textAlign = "right";
    ctx.fillText("SOURCE "+String(reference.signature),WIDTH-MARGIN_X,FOOTER_Y);
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

    let pages;
    try{
      pages = paginate(buildRows(measureContext,reference));
    }catch(error){
      return failed(reference,["Cannot render screenplay pages: source layout failed: "+messageOf(error)+"."]);
    }
    const images = [];
    try{
      pages.forEach((pageRows,index)=>{
        const canvas = documentRef.createElement("canvas");
        if(!canvas || typeof canvas.getContext!=="function")
          throw new Error("canvas element could not be created");
        const url = drawPage(canvas,pageRows,index+1,pages.length,reference);
        images.push({
          id:"stage-screenplay:"+signature+":page-"+(index+1),
          url,
          label:sceneTitle(reference)+" — SCREENPLAY PAGE "+(index+1)+" OF "+pages.length,
          page:index+1,
          totalPages:pages.length,
          sourceSignature:signature,
          targetBeats:(reference.targetBeats||[]).slice()
        });
      });
    }catch(error){
      return failed(reference,["Cannot render screenplay pages: "+messageOf(error)+"."]);
    }
    return {signature,images,errors:[]};
  }

  root.stageScreenplayImages = stageScreenplayImages;
})(typeof window!=="undefined" ? window : globalThis);