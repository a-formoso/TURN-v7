/* face-pose.js — the Likeness capture's head-pose check, run ON THE DEVICE (2026-10-10, owner:
   "it captures the front view as the left view … it can't tell left from right … only capture when
   the user is fully turned and holding the position, like official ID-capture software").

   What it is:
     • the pose maths (pure, node-testable): yaw / pitch / roll from the face model's transformation
       matrix, cross-checked by a landmark yaw (the landmarks are the fallback), the face's size and
       place in the centre square the photo is cropped to, smoothing, and the pose classes;
     • evaluateFrame(): one frame against the requested angle, with the reason it doesn't fit;
     • createHoldMachine(): the hold-to-capture rule — a held pose takes the photo (3 s for Front,
       5 s for each side), a break of 400 ms resets, the shutter fires only on a frame that fits,
       and after a capture nothing counts until the person has LEFT the captured pose (so one still
       person can never fill two slots);
     • the copy (CUES, cueFor, confirmFor, describeClass) — one person's left everywhere: "left" is
       the person's OWN left, which is the left edge of the mirrored preview;
     • load(): the face landmark model, self-hosted under app/vendor/face/v1.1.0/ (no third party
       sees that someone opened a face capture), loaded only once the camera runs (or a photo is
       uploaded, to check it). Its two big files are read with progress and time out only when the
       download stalls, never on a slow connection. Nothing about the face leaves the device: the
       library's usage-metrics request is answered locally (the fetch guard below), and no pose
       number, landmark or frame is stored or sent.

   Sign convention (measured on real photos and their mirror images): on the RAW (unmirrored)
   camera frame, yaw > 0 means the person turned to their OWN LEFT (the nose moves toward the image's
   right, which is the LEFT of the mirrored preview); yaw < 0 = their own right.

   A classic script: one global, window.turnFacePose. No DOM access at load time. */
(function(root){
  "use strict";

  const VERSION = "1.1.0";
  const VENDOR_DIR = "app/vendor/face/v1.1.0/";
  const METRICS_PREFIX = "https://odml.pa.googleapis.com/";

  const deg = (r)=> r * 180 / Math.PI;
  const clamp = (v, lo, hi)=> v < lo ? lo : v > hi ? hi : v;
  const fin = (v)=> typeof v==="number" && isFinite(v);
  const sideOf = (t)=> (t==="left" || t==="right") ? t : null;
  const otherOf = (s)=> s==="left" ? "right" : "left";

  /* ── thresholds (§3) — "enter" to start counting, "stay" (hysteresis) once in ── */
  const T = {
    // pitch allows a webcam above the screen (2026-10-10: a straight-on face read +9.5–10.8° on the real model,
    // too close to a 12° limit for people looking down at a laptop camera)
    front: { enter:{ yaw:8, pitch:15, roll:8 }, stay:{ yaw:10, pitch:18, roll:10 } },
    side:  { enter:{ min:27, max:48, pitch:18, roll:10 }, stay:{ min:22, max:52, pitch:21, roll:12 }, target:35 },
    wrongWay: 15,                 // a side target: the opposite sign and |yaw| ≥ 15
    notTurned: 15,                // a side target: |yaw| under this is "not turned"
    size:   { enter:{ min:0.30, max:0.78 }, stay:{ min:0.28, max:0.80 } },   // faceH, in crop units
    centre: { cx:0.5, cy:0.46, x:{ front:0.14, side:0.18 }, y:0.16, stay:0.02 },
    luma:   { enter:{ min:55, max:215 }, stay:{ min:50, max:220 } },
    blink:  { enter:0.5, stay:0.6 },
    still:  { enter:{ yawSpeed:20, centreSpeed:0.25 }, stay:{ yawSpeed:30, centreSpeed:0.35 } },
    secondFace: 0.5,              // another face counts when its faceH ≥ 0.5 × the primary's
    eyesOnly: { yaw:15, gaze:0.45 },
    disagree: { yaw:15, diff:25 },
  };
  const HOLD_MS = { front:3000, left:5000, right:5000 };

  /* ── pose from the transformation matrix (column-major 16) — R = Ry(yaw)·Rx(pitch)·Rz(roll) ── */
  function poseFromMatrix(d){
    if(!d || d.length < 16) return null;
    for(let i=0; i<11; i++) if(!fin(d[i])) return null;
    return {
      yaw: deg(Math.atan2(d[8], d[10])),                 // + = turned to the person's own left
      pitch: deg(Math.asin(clamp(-d[9], -1, 1))),        // + = nose / chin down
      roll: deg(Math.atan2(d[1], d[5])),                 // + = counter-clockwise in the raw frame
    };
  }
  const P = (L, i, W, H)=> ({ x:L[i].x*W, y:L[i].y*H, z:(L[i].z||0)*W });
  /* the landmark fallback (and the yaw cross-check): 234 / 33 are the person's right side (the image's
     left), 454 / 263 their left; 10 = the top of the forehead, 152 = the chin */
  function poseFromLandmarks(L, W, H){
    if(!L || L.length < 468) return null;
    const a = P(L,234,W,H), b = P(L,454,W,H), e1 = P(L,33,W,H), e2 = P(L,263,W,H), top = P(L,10,W,H), chin = P(L,152,W,H);
    return {
      yaw: deg(Math.atan2(b.z - a.z, b.x - a.x)),
      pitch: 0.57 * deg(Math.atan2(chin.z - top.z, chin.y - top.y)),
      roll: deg(Math.atan2(-(e2.y - e1.y), e2.x - e1.x)),
    };
  }
  /* where the face is, in the centre square the photo is cropped to (and object-fit:cover shows) */
  const GEO_POINTS = [1, 10, 33, 152, 234, 263, 454];
  function faceGeometry(L, W, H){
    if(!L || L.length < 468) return null;
    const side = Math.min(W, H), ox = (W - side)/2, oy = (H - side)/2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for(const i of GEO_POINTS){
      const p = L[i]; if(!p || !fin(p.x) || !fin(p.y)) return null;
      const x = p.x*W, y = p.y*H;
      if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
    }
    const top = P(L,10,W,H), chin = P(L,152,W,H);
    return {
      bboxPx: { x:x0, y:y0, w:x1 - x0, h:y1 - y0 },
      cx: ((x0 + x1)/2 - ox)/side,
      cy: ((y0 + y1)/2 - oy)/side,
      faceH: Math.hypot(chin.x - top.x, chin.y - top.y)/side,
    };
  }
  function scoresOf(bs){
    const out = {};
    const cats = bs && (bs.categories || bs);
    if(Array.isArray(cats)) for(const c of cats) if(c && c.categoryName) out[c.categoryName] = Number(c.score)||0;
    return out;
  }
  /* one detector result → { faces, primary } (unsmoothed). opts.mirroredSource: the camera already
     flips its picture, so the sides are swapped back to the person's own. */
  function observe(result, W, H, opts){
    opts = opts || {};
    const Ls = (result && result.faceLandmarks) || [];
    const Ms = (result && result.facialTransformationMatrixes) || [];
    const Bs = (result && result.faceBlendshapes) || [];
    const geo = Ls.map((L)=> faceGeometry(L, W, H));
    let pi = -1;
    geo.forEach((g, i)=>{ if(g && (pi < 0 || g.faceH > geo[pi].faceH)) pi = i; });
    if(pi < 0) return { faces:0, primary:null };
    const big = geo[pi].faceH;
    const faces = geo.filter((g)=> g && g.faceH >= T.secondFace * big).length;
    const L = Ls[pi], g = geo[pi];
    const lp = poseFromLandmarks(L, W, H);
    const mx = Ms[pi] && poseFromMatrix(Ms[pi].data || Ms[pi]);
    let pose = mx ? { yaw:mx.yaw, pitch:mx.pitch, roll:mx.roll, src:"matrix" }
      : lp ? { yaw:lp.yaw, pitch:lp.pitch, roll:lp.roll, src:"landmarks" } : null;
    if(!pose) return { faces:0, primary:null };
    let yawL = lp ? lp.yaw : null;
    const s = Bs[pi] ? scoresOf(Bs[pi]) : null;
    let blink = (s && ("eyeBlinkLeft" in s || "eyeBlinkRight" in s)) ? { left:s.eyeBlinkLeft||0, right:s.eyeBlinkRight||0 } : null;
    let gaze = (s && ("eyeLookOutLeft" in s)) ? {
      toLeft: ((s.eyeLookOutLeft||0) + (s.eyeLookInRight||0))/2,
      toRight: ((s.eyeLookOutRight||0) + (s.eyeLookInLeft||0))/2 } : null;
    if(opts.mirroredSource){
      pose = { ...pose, yaw:-pose.yaw, roll:-pose.roll };
      if(fin(yawL)) yawL = -yawL;
      if(blink) blink = { left:blink.right, right:blink.left };
      if(gaze) gaze = { toLeft:gaze.toRight, toRight:gaze.toLeft };
    }
    return { faces, primary:{ pose, yawL, cx:g.cx, cy:g.cy, faceH:g.faceH, bboxPx:g.bboxPx, blink, gaze } };
  }

  /* ── smoothing: an exponential average per channel, τ = 200 ms; resets after 500 ms with no face ── */
  const CHANNELS = ["yaw", "pitch", "roll", "cx", "cy", "faceH"];
  function createSmoother(o){
    o = Object.assign({ tauMs:200, gapMs:500 }, o || {});
    let s = null, lastAt = null;
    const api = {
      reset(){ s = null; lastAt = null; },
      push(obs, now){
        const p = obs && obs.primary;
        if(!p || !p.pose){
          if(lastAt != null && now - lastAt > o.gapMs){ s = null; lastAt = null; }
          return Object.assign({ faces:0 }, obs || {}, { primary:null, pose:null, raw:null, yawSpeed:null, centreSpeed:null });
        }
        const v = { yaw:p.pose.yaw, pitch:p.pose.pitch, roll:p.pose.roll, cx:p.cx, cy:p.cy, faceH:p.faceH };
        let yawSpeed = 0, centreSpeed = 0;
        if(!s || lastAt == null || now - lastAt > o.gapMs){ s = Object.assign({}, v); }
        else {
          const dt = Math.max(1, now - lastAt), a = 1 - Math.exp(-dt / o.tauMs);
          const b = Object.assign({}, s);
          for(const k of CHANNELS) s[k] = s[k] + a * (v[k] - s[k]);
          yawSpeed = Math.abs(s.yaw - b.yaw) / (dt/1000);
          centreSpeed = Math.hypot(s.cx - b.cx, s.cy - b.cy) / Math.max(1e-6, s.faceH) / (dt/1000);
        }
        lastAt = now;
        return Object.assign({}, obs, {
          pose:{ yaw:s.yaw, pitch:s.pitch, roll:s.roll, src:p.pose.src }, raw:p.pose, yawL:p.yawL,
          cx:s.cx, cy:s.cy, faceH:s.faceH, bboxPx:p.bboxPx, blink:p.blink, gaze:p.gaze, yawSpeed, centreSpeed });
      },
    };
    return api;
  }

  /* ── the pose class (§2.3): cls / base (the yaw class) / tilt. prevBase: the last frame's yaw class
     (the yaw hysteresis); prevTiltOk: the last frame's tilt was within its limits — only then do the
     looser "stay" tilt limits apply (a head never level enough never gets in) ── */
  function classifyPose(pose, prevBase, prevTiltOk){
    if(!pose || !fin(pose.yaw)) return { cls:"none", base:"none", tilt:null };
    const ay = Math.abs(pose.yaw), s = pose.yaw > 0 ? "left" : "right";
    let base;
    if(ay <= (prevBase==="front" ? T.front.stay.yaw : T.front.enter.yaw)) base = "front";
    else if(prevBase===s ? (ay >= T.side.stay.min && ay <= T.side.stay.max) : (ay >= T.side.enter.min && ay <= T.side.enter.max)) base = s;
    else if(ay > (prevBase===s ? T.side.stay.max : T.side.enter.max)) base = "far-" + s;
    else base = "partial-" + s;
    const fam = base==="front" ? T.front : T.side;
    const lim = (prevBase===base && prevTiltOk===true) ? fam.stay : fam.enter;
    const pitch = fin(pose.pitch) ? pose.pitch : 0, roll = fin(pose.roll) ? pose.roll : 0;
    let tilt = null;
    if(Math.abs(roll) > lim.roll) tilt = "roll";
    else if(pitch > lim.pitch) tilt = "chin-down";
    else if(pitch < -lim.pitch) tilt = "chin-up";
    return { cls: tilt ? "tilted" : base, base, tilt };
  }
  const familyOf = (b)=> /left$/.test(b) ? "left" : /right$/.test(b) ? "right" : b;
  /* the raw (unsmoothed) pose must sit inside the target's stay band too */
  function rawInBand(raw, target){
    if(!raw || !fin(raw.yaw)) return false;
    const pitch = Math.abs(fin(raw.pitch) ? raw.pitch : 0), roll = Math.abs(fin(raw.roll) ? raw.roll : 0);
    const s = sideOf(target);
    if(!s) return Math.abs(raw.yaw) <= T.front.stay.yaw && pitch <= T.front.stay.pitch && roll <= T.front.stay.roll;
    const y = s==="left" ? raw.yaw : -raw.yaw;
    return y >= T.side.stay.min && y <= T.side.stay.max && pitch <= T.side.stay.pitch && roll <= T.side.stay.roll;
  }

  /* ── one frame against the requested angle (§3.1): { ok, reason (the first failing check), fails
     (every failing check, in that order), cls, base, tilt, measured } ── */
  function evaluateFrame(sobs, target, ctx){
    ctx = ctx || {};
    const prev = (ctx.prev && typeof ctx.prev==="object") ? ctx.prev : {};
    const side = sideOf(target);
    const p = sobs && sobs.primary;
    const pose = sobs && (sobs.pose || (p && p.pose));
    if(!p || !pose || !fin(pose.yaw)){
      Object.assign(prev, { base:"none", tiltOk:false, sizeOk:false, centreOk:false, lightOk:false, eyesOk:false, stillOk:false });
      return { ok:false, reason:"no-face", fails:["no-face"], cls:"none", base:"none", tilt:null, measured:"none" };
    }
    const c = classifyPose(pose, prev.base, prev.tiltOk);
    const measured = c.tilt ? "tilted" : c.base;

    const faceH = fin(sobs.faceH) ? sobs.faceH : p.faceH;
    const cx = fin(sobs.cx) ? sobs.cx : p.cx, cy = fin(sobs.cy) ? sobs.cy : p.cy;
    const sz = prev.sizeOk ? T.size.stay : T.size.enter;
    const sizeState = !(faceH >= sz.min) ? "far" : faceH > sz.max ? "close" : null;
    const slack = prev.centreOk ? T.centre.stay : 0;
    const centreOk = Math.abs(cx - T.centre.cx) <= (side ? T.centre.x.side : T.centre.x.front) + slack
      && Math.abs(cy - T.centre.cy) <= T.centre.y + slack;
    const luma = ctx.luma, lim = prev.lightOk ? T.luma.stay : T.luma.enter;
    const lightState = !fin(luma) ? null : luma < lim.min ? "dark" : luma > lim.max ? "bright" : null;
    const blink = sobs.blink || p.blink, bl = prev.eyesOk ? T.blink.stay : T.blink.enter;
    const eyesOk = !blink ? true
      : !side ? (blink.left < bl && blink.right < bl)
      : side==="left" ? blink.right < bl : blink.left < bl;     // the near eye: an own-left turn shows the right eye
    const sl = prev.stillOk ? T.still.stay : T.still.enter;
    const stillOk = !(sobs.yawSpeed > sl.yawSpeed) && !(sobs.centreSpeed > sl.centreSpeed);
    const raw = sobs.raw || p.pose;
    const yawL = fin(sobs.yawL) ? sobs.yawL : p.yawL;
    const uncertain = raw && raw.src==="matrix" && fin(yawL) && fin(raw.yaw)
      && ((Math.abs(raw.yaw) >= T.disagree.yaw && Math.sign(yawL) !== Math.sign(raw.yaw)) || Math.abs(raw.yaw - yawL) > T.disagree.diff);
    Object.assign(prev, { base:c.base, tiltOk:!c.tilt, sizeOk:!sizeState, centreOk, eyesOk, stillOk });
    if(fin(luma)) prev.lightOk = !lightState;

    // the pose against the target
    const ay = Math.abs(pose.yaw);
    let poseReason = null;
    if(!side){
      if(c.base!=="front") poseReason = "turned";
      else if(c.tilt) poseReason = c.tilt;
    } else {
      const o = otherOf(side);
      if(familyOf(c.base)===o && ay >= T.wrongWay) poseReason = "wrong-way";
      else if(c.base==="front" || ay < T.notTurned){
        const g = sobs.gaze || p.gaze;
        poseReason = (g && ay < T.eyesOnly.yaw && (side==="left" ? g.toLeft : g.toRight) >= T.eyesOnly.gaze) ? "eyes-only" : "not-turned";
      }
      else if(c.base==="partial-" + side) poseReason = "more";
      else if(c.base==="far-" + side) poseReason = "too-far";
      else if(c.tilt) poseReason = c.tilt;
    }
    const fails = [];
    if((sobs.faces || 1) > 1) fails.push("two-faces");
    if(sizeState) fails.push(sizeState);
    if(!centreOk) fails.push("offcenter");
    if(poseReason) fails.push(poseReason);
    if(lightState) fails.push(lightState);
    if(!eyesOk) fails.push("eyes-closed");
    if(!stillOk) fails.push("moving");
    if(uncertain) fails.push("uncertain");
    if(!poseReason && !rawInBand(raw, target) && fails.indexOf("moving") < 0) fails.push("moving");
    return { ok:!fails.length, reason:fails[0] || null, fails, cls:c.cls, base:c.base, tilt:c.tilt, measured,
      ry: raw && fin(raw.yaw) ? raw.yaw : null, rp: raw && fin(raw.pitch) ? raw.pitch : null };
  }

  /* ── the hold-to-capture machine (§4) ── */
  /* Breaks: a bad frame for 400 ms (a blink or a flicker under that is tolerated, but can't fire);
     NO frame for over 400 ms (a hidden tab, an open dialog, the check restarting) — time that wasn't
     seen never counts; and at once for a second face or an uncertain direction. A second face also
     blocks the hold for 1.5 s after it was last seen (a detector that sees it only now and then). */
  function createHoldMachine(o){
    o = Object.assign({ holdMs:HOLD_MS, graceMs:400, leaveMs:300, settleMs:1200, timeoutMs:20000, twoFaceMs:1500, driftDeg:5 }, o || {});
    let holdStart = null, badSince = null, settleUntil = -Infinity, lastStepAt = null, twoFaceAt = null;
    /* HOLDING MEANS STAYING PUT (2026-10-10, owner: "holding the position for about five seconds"): a steady sway or
       a slow drift that never leaves the angle band used to count as holding. During a hold the raw (unsmoothed)
       yaw and pitch must stay within driftDeg of the hold's own running average; going past it starts the count again. */
    let anchor = null;
    const anchorMoved = (ev)=>{
      if(!ev || !fin(ev.ry)) return false;
      if(!anchor){ anchor = { n:1, yaw:ev.ry, pitch:fin(ev.rp) ? ev.rp : 0 }; return false; }
      const dp = fin(ev.rp) ? Math.abs(ev.rp - anchor.pitch) : 0;
      if(Math.abs(ev.ry - anchor.yaw) > o.driftDeg || dp > o.driftDeg) return true;
      anchor.n++; anchor.yaw += (ev.ry - anchor.yaw) / anchor.n;
      if(fin(ev.rp)) anchor.pitch += (ev.rp - anchor.pitch) / anchor.n;
      return false;
    };
    let needLeave = false, capturedBase = null, leaveSince = null;
    let activeSince = null, counts = {};
    const quiet = ()=>{ holdStart = null; badSince = null; activeSince = null; counts = {}; };
    const mk = (phase, x)=> Object.assign({ phase, progress:0, secsLeft:null, fire:false, reason:null, hint:null, started:false, reset:null }, x || {});
    const hintOf = (now)=>{
      if(activeSince == null || now - activeSince < o.timeoutMs) return null;
      let best = null, n = 0;
      for(const k in counts) if(counts[k] > n){ best = k; n = counts[k]; }
      return best;
    };
    return {
      step(ev, now, ctx){
        ctx = ctx || {};
        ev = ev || { ok:false, reason:"no-face", base:"none" };
        // no frame for longer than the grace: the hold is broken (unseen time never counts)
        if(lastStepAt != null && now - lastStepAt > o.graceMs){ holdStart = null; badSince = null; }
        lastStepAt = now;
        const holdMs = o.holdMs[ctx.target] || HOLD_MS.front;
        if(!ctx.auto){ quiet(); return mk("manual"); }
        if(ctx.filled){ quiet(); return mk("filled"); }
        if(ctx.engine!=="ready"){ quiet(); return mk("loading"); }
        const fails = Array.isArray(ev.fails) ? ev.fails : (ev.ok ? [] : [ev.reason]);
        if(fails.indexOf("two-faces") >= 0) twoFaceAt = now;
        let ok = !!ev.ok, reason = ok ? null : (ev.reason || "no-face");
        if(ok && twoFaceAt != null && now - twoFaceAt < o.twoFaceMs){ ok = false; reason = "two-faces"; }
        const hard = !ok && (reason==="two-faces" || fails.indexOf("two-faces") >= 0 || fails.indexOf("uncertain") >= 0);
        if(now < settleUntil) return mk("settle");
        if(activeSince == null) activeSince = now;
        const count = (r)=>{ if(r) counts[r] = (counts[r] || 0) + 1; };
        if(needLeave){
          const away = ev.base && ev.base!=="none" && ev.base!==capturedBase;
          if(away){ if(leaveSince == null) leaveSince = now; if(now - leaveSince >= o.leaveMs){ needLeave = false; leaveSince = null; } }
          else leaveSince = null;
          if(needLeave){
            const r = ok ? "change-pose" : reason;
            count(r);
            holdStart = null; badSince = null;
            return mk("arming", { reason:r, hint:hintOf(now) });
          }
        }
        let started = false, reset = null;
        if(ok){
          if(holdStart == null){ holdStart = now; started = true; anchor = null; anchorMoved(ev); }
          else if(anchorMoved(ev)){
            // moved within the band: the count starts again from this frame
            if(now - holdStart >= 1000) reset = "moving";
            holdStart = now; started = true; anchor = null; anchorMoved(ev);
          }
          badSince = null;
        } else {
          count(reason);
          if(holdStart != null){
            if(badSince == null) badSince = now;
            if(hard || now - badSince >= o.graceMs){
              const held = badSince - holdStart;
              holdStart = null; badSince = null;
              if(held >= 1000) reset = reason || "moving";
            }
          }
        }
        const elapsed = holdStart != null ? now - holdStart : 0;
        const progress = holdStart != null ? Math.min(1, elapsed / holdMs) : 0;
        // never "0" while no photo is taken (a dip in the grace after the hold time)
        const secsLeft = holdStart != null ? Math.max(1, Math.ceil((holdMs - elapsed) / 1000)) : null;
        const fire = holdStart != null && ok && elapsed >= holdMs;
        if(fire){ holdStart = null; badSince = null; }
        const phase = (holdStart != null || fire) ? "holding" : "wait";
        return mk(phase, { progress: fire ? 1 : progress, secsLeft: fire ? 0 : secsLeft, fire, reason: ok ? null : reason,
          hint: phase==="wait" ? hintOf(now) : null, started, reset });
      },
      markCaptured(measuredBase, now){
        needLeave = true; capturedBase = measuredBase || null; leaveSince = null;
        settleUntil = now + o.settleMs;
        holdStart = null; badSince = null; activeSince = now; counts = {};
      },
      retarget(now){ holdStart = null; badSince = null; activeSince = now; counts = {}; },
      cleared(now){ needLeave = false; capturedBase = null; leaveSince = null; holdStart = null; badSince = null; activeSince = now; counts = {}; },
      get state(){ return { holdStart, badSince, settleUntil, needLeave, capturedBase, activeSince, lastStepAt, twoFaceAt }; },
    };
  }
  /* automatic capture needs the pose check — except Front, which keeps the simple steady-and-lit
     check when the pose check can't start */
  function canAutoCapture(target, engine){
    return engine==="ready" || (target==="front" && engine==="unavailable");
  }

  /* ── copy (§5.4). {side} = the target's side, {other} = the opposite, {n} = seconds left ── */
  const SHOW = { front:"Front", left:"Your left", right:"Your right" };
  const CUES = {
    "camera":           { k:"wait", text:"Allow the camera to start — or upload a photo", say:null },
    "loading":          { k:"wait", text:"Getting the pose check ready…", say:null },
    "loading-slow":     { k:"wait", text:"Still getting ready — you can press Capture now", say:null },
    "no-face":          { k:"wait", text:"Center your face in the ring", say:"Center your face in the ring." },
    "two-faces":        { k:"wait", text:"Only one face in the frame, please", say:"Only one face in the frame, please." },
    "far":              { k:"wait", text:"Move a little closer", say:"Move a little closer." },
    "close":            { k:"wait", text:"Move back a little", say:"Move back a little." },
    "offcenter":        { k:"wait", text:"Center your face in the ring", say:"Center your face in the ring." },
    "turned":           { k:"wait", text:"Look straight at the camera", say:"Look straight at the camera." },
    "chin-up":          { k:"wait", text:"Lower your chin a little", say:"Lower your chin a little." },
    "chin-down":        { k:"wait", text:"Lift your chin a little", say:"Lift your chin a little." },
    "roll":             { k:"wait", text:"Keep your head level — don't tilt it", say:"Keep your head level." },
    "not-turned":       { k:"wait", text:"Turn your head to your {side} — toward the {side} edge of the screen",
                          say:"Turn your head slowly to your {side}, toward the {side} edge of the screen." },
    "more":             { k:"wait", text:"A little further to your {side}", say:"A little further." },
    "too-far":          { k:"wait", text:"Not so far — come back a little toward the camera", say:"Not so far. Come back a little." },
    "wrong-way":        { k:"warn", text:"That's your {other} — turn the other way, to your {side}",
                          say:"That's your {other}. Turn the other way, to your {side}." },
    "eyes-only":        { k:"wait", text:"Turn your whole head, not just your eyes", say:"Turn your whole head, not just your eyes." },
    "eyes-closed":      { k:"wait", text:"Keep your eyes open", say:null },
    "dark":             { k:"wait", text:"More light needed — face a lamp or a window", say:"More light needed." },
    "bright":           { k:"wait", text:"Too bright — try softer light", say:"Too bright. Try softer light." },
    "moving":           { k:"wait", text:"Hold still…", say:null },
    "uncertain":        { k:"wait", text:"Hold still…", say:null },
    "change-pose":      { k:"wait", text:"Change your pose a little", say:null },
    "holding":          { k:"go",   text:"Hold still — {n}", say:null },
    "settle":           { k:"done", text:"Got it!", say:"Got it. {next}" },
    "filled":           { k:"done", text:"Done — pick another photo or lock the likeness", say:null },
    "filled-mismatch":  { k:"warn", text:"This photo shows {measured} — click × on it to take it again", say:null },
    "check-marked":     { k:"warn", text:"{marked} — click × on {each} marked ! to take it again", say:null },
    "complete":         { k:"done", text:"All three done — say whose likeness it is, tick the box and lock it",
                          say:"All three done. Say whose likeness it is, tick the box, and lock it." },
    "manual":           { k:"off",  text:"Automatic capture is off — press Capture now when you're in position", say:null },
    "unavailable-front":{ k:"wait", text:"Look straight at the camera and hold still", say:null },
    "unavailable-side": { k:"off",  text:"Turn your head to your {side}, then press Capture now", say:"Turn your head to your {side}, then press Capture now." },
  };
  /* what to say at hold start / after "Got it." */
  const LINES = {
    holdStartSide: "Hold it there.",
    holdStartFront: "Hold still.",
    nextFront: "Look straight at the camera.",
    nextSide: "Now turn your head slowly to your {side}, toward the {side} edge of the screen, and hold it there for five seconds.",
    nextSideManual: "Turn your head to your {side}, then press Capture now.",
    count: { 3:"three", 2:"two", 1:"one" },
    srHold: "Hold still for {secs} seconds",
    srCaptured: "Photo taken: {what}. {next}",
    srWhat: { front:"front view", left:"turned to your left", right:"turned to your right" },
  };
  const COUNT_WORD = { 1:"One", 2:"Two", 3:"Three" };
  /* the timeout hints (§4 rule 8): the most frequent reason after 20 s → a second line */
  const HINT_GROUP = { "not-turned":"turn", "more":"turn", "eyes-only":"turn", "wrong-way":"wrong-way", "too-far":"too-far",
    "chin-up":"tilt", "chin-down":"tilt", "roll":"tilt", "far":"frame", "close":"frame", "offcenter":"frame",
    "dark":"light", "bright":"light", "moving":"moving", "uncertain":"moving", "no-face":"no-face" };
  const HINTS = {
    "turn":      "Turn your whole head until the dot reaches the green band",
    "wrong-way": "You're turning to your {other}; turn the other way",
    "too-far":   "That's too far; come back a little toward the camera",
    "tilt":      "Keep your head and chin level",
    "frame":     "Fit your face inside the ring",
    "light":     "The light makes your face hard to see; face a window or a lamp",
    "moving":    "Rest your elbows so you can hold still for {hold} seconds",
    "no-face":   "No face found; center your face in the ring, or upload a photo",
  };
  const HINT_TAIL = " — or press Capture now.";
  const fill = (s, v)=> s == null ? null : String(s).replace(/\{(\w+)\}/g, (m, k)=> v[k] != null ? String(v[k]) : "");
  /* {measured}: what a frame or a photo shows, as the object of "It shows …" / "This photo shows …".
     who: "your" (the live camera) or "the person's" (photos) */
  function describeClass(cls, who){
    const live = (who || "your")==="your";
    const head = live ? "your head" : "the head", whose = live ? "your" : "the person's";
    const c = String(cls || "none");
    if(c==="front") return "a front view";
    if(/^partial-/.test(c)) return head + " only a little turned";
    if(/^far-/.test(c)) return head + " turned almost side-on";
    if(c==="left" || c==="right") return head + " turned to " + whose + " " + c;
    if(c==="tilted") return "a tilted head";
    return "no face";
  }
  /* the line after "Got it." for the next angle (null = nothing left) */
  function nextStepLine(next, engine){
    if(!next) return fill(CUES.complete.say, {});
    const s = sideOf(next);
    if(!s) return LINES.nextFront;
    return fill(engine==="unavailable" ? LINES.nextSideManual : LINES.nextSide, { side:s });
  }
  /* what a screen reader hears after a photo: "Photo taken: turned to your left. Next, turn your head …" */
  function srCapturedLine(key, next, engine){
    const what = LINES.srWhat[key] || LINES.srWhat.front;
    let n = nextStepLine(next, engine);
    if(next) n = "Next, " + n.replace(/^Now /, "").replace(/^./, (ch)=> ch.toLowerCase());
    return fill(LINES.srCaptured, { what, next:n });
  }
  /* status (from the machine) + the frame → the cue: { key, k, text, say, hint, hintSay }.
     opts: { engine, slow, allDone, mismatch (the active slot's photo doesn't fit it), mismatchCount
     (how many photos don't fit their slots), measured, next } */
  function cueFor(status, ev, target, opts){
    opts = opts || {};
    const st = status || { phase:"loading" };
    const side = sideOf(target);
    const marked = Math.max(0, Number(opts.mismatchCount) || 0);
    let key;
    // a photo that doesn't fit its slot is said before "all three done": the set isn't complete then
    if(opts.mismatch) key = "filled-mismatch";
    else if(opts.allDone && marked > 0) key = "check-marked";
    else if(opts.allDone) key = "complete";
    else if(st.phase==="camera") key = "camera";
    else if(st.phase==="filled") key = "filled";
    else if(st.phase==="manual") key = "manual";
    else if(st.phase==="settle") key = "settle";
    else if(opts.engine==="unavailable" && side) key = "unavailable-side";
    else if(st.phase==="loading") key = opts.slow ? "loading-slow" : "loading";
    else if(st.phase==="holding") key = "holding";
    else if(opts.engine==="unavailable") key = (st.reason==="dark" || st.reason==="bright") ? st.reason : "unavailable-front";
    else key = CUES[st.reason] ? st.reason : (side ? "not-turned" : "turned");
    if(!side && (key==="not-turned" || key==="more" || key==="too-far" || key==="wrong-way" || key==="eyes-only")) key = "turned";
    const v = { side: side || "", other: side ? otherOf(side) : "", n: st.secsLeft != null ? st.secsLeft : "",
      measured: describeClass(opts.measured, "the person's"), next: nextStepLine(opts.next, opts.engine),
      marked: marked===1 ? "One photo looks like the wrong angle" : (COUNT_WORD[marked] || String(marked)) + " photos look like the wrong angle",
      each: marked===1 ? "the one" : "each one" };
    const c = CUES[key];
    const out = { key, k:c.k, text:fill(c.text, v), say:fill(c.say, v), hint:null, hintSay:null };
    const g = st.hint && HINT_GROUP[st.hint];
    if(g && HINTS[g] && key!=="settle" && key!=="filled" && key!=="complete" && key!=="manual" && key!=="check-marked" && key!=="filled-mismatch"){
      out.hint = fill(HINTS[g], Object.assign({}, v, { hold: side ? "five" : "three" })) + HINT_TAIL;
      out.hintSay = out.hint.replace(/; /g, ". ").replace(/ — or /, ". Or ");
    }
    return out;
  }
  /* which way a TRUE-orientation photo of an own-left / own-right turn faces (what to pick for an upload) */
  const NOSE_IN_PHOTO = { left:"right", right:"left" };
  /* the confirmations (§8): C1 a live frame that doesn't fit, C2 the pose couldn't be checked, C3 an
     upload that doesn't fit, C4 no face, C5 a frame whose pose fits but something else doesn't
     (opts.reason: two-faces | uncertain | eyes-closed | far | close | offcenter); "flip" the check for a
     camera that already flips its picture, "unflip" switching that back, "lock" locking with photos
     marked as the wrong angle (opts.items, opts.count). opts.photo: an upload's wording. */
  function confirmFor(kind, target, measured, opts){
    opts = opts || {};
    const side = sideOf(target), show = SHOW[target] || SHOW.front;
    const m = String(measured || "none");
    const what = opts.photo ? "photo" : "frame";
    if(kind==="C1"){
      const title = side && m==="partial-" + side ? "Not turned far enough"
        : side && m==="far-" + side ? "Turned too far"
        : side ? "This doesn't look turned to your " + side : "This doesn't look like a front view";
      return { title, body: "It shows " + describeClass(m, "your") + ". Use it for “" + show + "” anyway?",
        confirmLabel:"Use it anyway", cancelLabel:"Try again", safeDefault:true };
    }
    if(kind==="C2") return { title:"The pose couldn't be checked",
      body: side ? "Make sure your head is turned to your " + side + " — toward the " + side + " edge of the screen. Use this frame for “" + show + "”?"
        : "Make sure you're looking straight at the camera. Use this frame for “" + show + "”?",
      confirmLabel:"Use this frame" };
    if(kind==="C3"){
      const title = side && m==="partial-" + side ? "This photo isn't turned far enough"
        : side && m==="far-" + side ? "This photo is turned too far"
        : side ? "This photo doesn't look turned to the person's " + side : "This photo doesn't look like a front view";
      const pick = side ? " For “" + show + "”, pick a photo of the person turned to their own " + side
        + " — their nose points to the " + NOSE_IN_PHOTO[side] + " in the photo." : "";
      return { title, body: "It shows " + describeClass(m, "the person's") + "." + pick + " Put this one in anyway?",
        confirmLabel:"Use it anyway", cancelLabel:"Choose another", safeDefault:true };
    }
    if(kind==="C5"){
      const r = opts.reason, use = "Use this " + what + " for “" + show + "” anyway?";
      const C = {
        "two-faces": ["Someone else is in the " + (opts.photo ? "photo" : "picture"), "Only the person whose likeness this is should be in it. " + use],
        "uncertain": ["The direction couldn't be confirmed", side
          ? "Make sure your head is turned to your " + side + " — toward the " + side + " edge of the screen. " + use
          : "Make sure you're looking straight at the camera. " + use],
        "eyes-closed": ["Your eyes look closed", use],
        "far": ["Your face looks small in the picture", "Move a little closer for a clearer photo. " + use],
        "close": ["Your face is very close", "Move back a little so your whole face fits in the ring. " + use],
        "offcenter": ["Your face isn't centered", "Center your face in the ring for a clearer photo. " + use],
      }[r] || ["This " + what + " may not be clear", use];
      return { title:C[0], body:C[1], confirmLabel:"Use it anyway", cancelLabel: opts.photo ? "Choose another" : "Try again", safeDefault:true };
    }
    if(kind==="flip") return { title:"Is the preview like a mirror?",
      body:"Hold up something with writing on it — a book or a label. The preview works like a mirror, so the writing should read backwards. If it reads normally, your camera already flips its picture: switch it back so your left and right are read the right way round (the photos are flipped back too, so they keep their true orientation).",
      confirmLabel:"It reads normally — switch it back", cancelLabel:"It reads backwards — keep it", safeDefault:true };
    if(kind==="unflip") return { title:"Switch back to the usual mirror view?",
      body:"The side photos taken since the switch were read the other way round, so they'll be cleared to take again.",
      confirmLabel:"Switch back", cancelLabel:"Keep it", safeDefault:true };
    if(kind==="lock"){
      const n = Math.max(1, Number(opts.count) || 1);
      return { title: n===1 ? "One photo looks like the wrong angle" : (COUNT_WORD[n] || String(n)) + " photos look like the wrong angle",
        body:"Every photo is used as a face reference for this character's images. Lock the likeness anyway?",
        items: Array.isArray(opts.items) ? opts.items : undefined,
        confirmLabel:"Lock anyway", cancelLabel:"Retake first", safeDefault:true };
    }
    return { title:"No face found", body:"Use this " + what + " for “" + show + "” anyway?", confirmLabel:"Use it anyway",
      cancelLabel: opts.photo ? "Choose another" : "Try again", safeDefault:true };
  }

  /* the turn meter: percent from the screen's left (the person's own left is the screen's left) */
  function meterPos(yaw){ return 50 - clamp(fin(yaw) ? yaw : 0, -60, 60) / 60 * 50; }
  function bandFor(target){
    const s = sideOf(target);
    if(s==="left") return { from:meterPos(T.side.enter.max), to:meterPos(T.side.enter.min) };
    if(s==="right") return { from:meterPos(-T.side.enter.min), to:meterPos(-T.side.enter.max) };
    return { from:meterPos(T.front.enter.yaw), to:meterPos(-T.front.enter.yaw) };
  }
  /* detector timestamps must strictly increase */
  function nextTs(last, now){ return now > last ? now : last + 1; }
  /* a load failure → unsupported | offline | timeout | failed (no library text ever reaches the page).
     A rejection that isn't an Error — a script's "error" Event, which is what the library's loader
     rejects with when its file is missing or the connection dropped — is a connection problem. */
  function mapLoadError(e){
    const c = e && e.code;
    if(c==="unsupported" || c==="offline" || c==="timeout" || c==="failed") return c;
    if(e && typeof e==="object" && typeof e.message!=="string") return "offline";
    const t = String((e && (e.message || e)) || "");
    if(/fetch|network|404|Failed to load/i.test(t)) return "offline";
    return "failed";
  }
  const codedError = (code)=>{ const e = new Error(code); e.code = code; return e; };
  const later = (ms, fn)=> (typeof root.setTimeout==="function" ? root.setTimeout : setTimeout)(fn, ms);
  const clearLater = (id)=>{ try{ (typeof root.clearTimeout==="function" ? root.clearTimeout : clearTimeout)(id); }catch(e){} };
  const perfNow = ()=> (root.performance && typeof root.performance.now==="function") ? root.performance.now() : Date.now();
  /* load timing: the two big files time out only when they STALL (no bytes for stallMs) — a slow
     connection just takes longer — and the model's start-up gets createMs on its own */
  const LOAD = { bundleMs:20000, stallMs:15000, noStreamMs:120000, createMs:60000 };

  /* ── the browser half ── */
  /* the library posts usage metrics (no face data, but the visitor's address and the site) — answered
     here with an empty 204, which makes it stop; installed once, for the page's life */
  function installNetGuard(){
    if(root.__turnFaceNetGuard || typeof root.fetch!=="function") return;
    root.__turnFaceNetGuard = true;
    const f = root.fetch.bind(root);
    root.fetch = function(u, o){
      const s = String((u && u.url) || u || "");
      return s.indexOf(METRICS_PREFIX)===0 ? Promise.resolve(new Response(null, { status:204 })) : f(u, o);
    };
  }
  let lumaCanvas = null;
  /* mean brightness of the face box (a 24×24 sample of the raw frame); null if it can't be read */
  function sampleLuma(src, bbox){
    try{
      if(!src || !bbox || !(bbox.w > 2) || !(bbox.h > 2)) return null;
      const W = src.videoWidth || src.naturalWidth || src.width, H = src.videoHeight || src.naturalHeight || src.height;
      if(!(W > 0 && H > 0)) return null;
      const x = clamp(bbox.x, 0, W - 2), y = clamp(bbox.y, 0, H - 2);
      const w = Math.max(1, Math.min(bbox.w, W - x)), h = Math.max(1, Math.min(bbox.h, H - y));
      const c = lumaCanvas || (lumaCanvas = root.document.createElement("canvas"));
      c.width = 24; c.height = 24;
      const g = c.getContext("2d", { willReadFrequently:true });
      g.drawImage(src, x, y, w, h, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let s = 0;
      for(let i=0; i<d.length; i+=4) s += 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      return s / (d.length / 4);
    }catch(e){ return null; }
  }
  const baseUrl = ()=> new URL(VENDOR_DIR, root.document.baseURI).href;
  let scriptPromise = null;
  function loadBundle(base){
    if(root.Vision && root.Vision.FaceLandmarker) return Promise.resolve(root.Vision);
    if(scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject)=>{
      let settled = false, timer = null;
      const end = (ok)=>{ if(settled) return; settled = true; if(timer != null) clearLater(timer); timer = null;
        if(ok && root.Vision && root.Vision.FaceLandmarker) resolve(root.Vision); else reject(codedError("offline")); };
      const s = root.document.createElement("script");
      s.src = base + "vision_bundle.js";
      s.async = true;
      s.onload = ()=> end(true);
      s.onerror = ()=> end(false);
      timer = later(LOAD.bundleMs, ()=> end(false));
      (root.document.head || root.document.body).appendChild(s);
    });
    scriptPromise.catch(()=>{ scriptPromise = null; });   // a later open tries again
    return scriptPromise;
  }
  /* one file, read with progress: rejects "timeout" when no bytes arrive for LOAD.stallMs, "offline" on
     a network error or a bad status, "aborted" when the window closed (signal) */
  async function fetchBytes(url, signal){
    if(signal && signal.aborted) throw codedError("aborted");
    let ctrl = null;
    try{ ctrl = typeof root.AbortController==="function" ? new root.AbortController() : null; }catch(e){ ctrl = null; }
    let stalled = false, timer = null;
    const stop = ()=>{ try{ if(ctrl) ctrl.abort(); }catch(e){} };
    const onAbort = ()=> stop();
    const arm = (ms)=>{ if(timer != null) clearLater(timer); timer = later(ms, ()=>{ timer = null; stalled = true; stop(); }); };
    const why = ()=> codedError(stalled ? "timeout" : (signal && signal.aborted) ? "aborted" : "offline");
    if(signal && typeof signal.addEventListener==="function") signal.addEventListener("abort", onAbort);
    try{
      arm(LOAD.stallMs);
      let r;
      try{ r = await root.fetch(url, { credentials:"same-origin", signal: ctrl ? ctrl.signal : undefined }); }
      catch(e){ throw why(); }
      if(stalled || (signal && signal.aborted)) throw why();
      if(!r || !r.ok) throw codedError("offline");
      const body = r.body;
      if(!body || typeof body.getReader!=="function"){
        arm(LOAD.noStreamMs);
        try{ return new Uint8Array(await r.arrayBuffer()); }catch(e){ throw why(); }
      }
      const reader = body.getReader();
      const total = Number(r.headers && typeof r.headers.get==="function" ? r.headers.get("content-length") : 0) || 0;
      let out = total > 0 ? new Uint8Array(total) : null, parts = out ? null : [], n = 0;
      for(;;){
        arm(LOAD.stallMs);
        let x;
        try{ x = await reader.read(); }catch(e){ throw why(); }
        if(stalled || (signal && signal.aborted)){ try{ reader.cancel(); }catch(e){} throw why(); }
        if(!x || x.done) break;
        const chunk = x.value;
        if(!chunk || !chunk.length) continue;
        if(out && n + chunk.length <= out.length) out.set(chunk, n);
        else {
          if(out){ parts = [out.subarray(0, n)]; out = null; }
          parts.push(chunk);
        }
        n += chunk.length;
      }
      if(out) return n===out.length ? out : out.subarray(0, n);
      const all = new Uint8Array(n); let o = 0;
      for(const p of parts){ all.set(p, o); o += p.length; }
      return all;
    } finally {
      if(timer != null) clearLater(timer);
      timer = null;
      if(signal && typeof signal.removeEventListener==="function") signal.removeEventListener("abort", onAbort);
    }
  }
  /* a promise with a deadline and an abort; a result that comes after either is closed (and every timer
     is cleared the moment it settles — nothing keeps a closed model alive) */
  function settleWithin(p, ms, signal){
    return new Promise((resolve, reject)=>{
      let done = false, timer = null;
      const onAbort = ()=> finish(reject, codedError("aborted"));
      const finish = (fn, v)=>{
        if(done) return false;
        done = true;
        if(timer != null) clearLater(timer);
        timer = null;
        if(signal && typeof signal.removeEventListener==="function") signal.removeEventListener("abort", onAbort);
        fn(v);
        return true;
      };
      timer = later(ms, ()=>{ timer = null; finish(reject, codedError("timeout")); });
      if(signal){ if(signal.aborted){ onAbort(); } else if(typeof signal.addEventListener==="function") signal.addEventListener("abort", onAbort); }
      p.then((x)=>{ if(!finish(resolve, x)){ try{ if(x && typeof x.close==="function") x.close(); }catch(e){} } },
        (e)=>{ finish(reject, e); });
    });
  }
  /* one engine per capture window: load({ signal }) → { detect(video, nowMs), audit(imageOrCanvas), close() }.
     signal: an AbortSignal — the window closed, stop downloading */
  async function load(opts){
    opts = opts || {};
    const signal = opts.signal || null;
    const aborted = ()=> !!(signal && signal.aborted);
    if(typeof root.WebAssembly!=="object") throw codedError("unsupported");
    let gl = null;
    try{
      const c = root.document.createElement("canvas");
      gl = c.getContext("webgl2") || c.getContext("webgl");
      const lose = gl && gl.getExtension && gl.getExtension("WEBGL_lose_context");
      if(lose) lose.loseContext();
    }catch(e){ gl = null; }
    if(!gl) throw codedError("unsupported");
    installNetGuard();
    const base = baseUrl();
    const Vision = await loadBundle(base);
    if(aborted()) throw codedError("aborted");
    let simd = false;
    try{ simd = await Vision.FilesetResolver.isSimdSupported(); }catch(e){ simd = false; }
    if(!simd) throw codedError("unsupported");
    if(aborted()) throw codedError("aborted");
    // the 13 MB engine and the 3.7 MB model, read here (with progress) and handed over from memory
    let wasm = null, model = null;
    try{ [wasm, model] = await Promise.all([fetchBytes(base + "vision_wasm_internal.wasm", signal), fetchBytes(base + "face_landmarker.task", signal)]); }
    catch(e){ throw codedError(e && e.code ? e.code : "offline"); }
    if(aborted()) throw codedError("aborted");
    let wasmUrl = null;
    try{ wasmUrl = root.URL.createObjectURL(new root.Blob([wasm], { type:"application/wasm" })); }catch(e){ wasmUrl = null; }
    wasm = null;
    const fileset = { wasmLoaderPath: base + "vision_wasm_internal.js", wasmBinaryPath: wasmUrl || (base + "vision_wasm_internal.wasm") };
    let lm;
    try{
      let creating;
      try{
        creating = Promise.resolve(Vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate: "CPU" },
          runningMode: "VIDEO", numFaces: 2,
          minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
          outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        }));
      }catch(e){ creating = Promise.reject(e); }
      model = null;
      lm = await settleWithin(creating, LOAD.createMs, signal);
    }catch(e){
      throw codedError(e && e.code==="aborted" ? "aborted" : mapLoadError(e));
    }finally{
      if(wasmUrl){ try{ root.URL.revokeObjectURL(wasmUrl); }catch(e){} }
      // the library adds its loader <script> on every start; once it ran it isn't needed (one per window otherwise)
      try{
        const ss = root.document.getElementsByTagName ? root.document.getElementsByTagName("script") : [];
        for(const sc of Array.prototype.slice.call(ss)) if(sc && sc.src===fileset.wasmLoaderPath && sc.parentNode) sc.parentNode.removeChild(sc);
      }catch(e){}
    }
    let closed = false, lastTs = 0, lastVT = null, auditCanvas = null;
    return {
      detect(video, nowMs){
        if(closed || !lm) return null;
        if(!video || !(video.readyState >= 2)) return null;
        if(video.currentTime === lastVT) return null;
        lastVT = video.currentTime;
        lastTs = nextTs(lastTs, Math.round(nowMs));
        try{ return lm.detectForVideo(video, lastTs); }
        catch(e){ throw codedError("failed"); }
      },
      audit(src){
        if(closed || !lm || !src) return null;
        const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
        if(!(sw > 0 && sh > 0)) return null;
        const k = Math.min(1, 640 / Math.max(sw, sh)), w = Math.max(1, Math.round(sw*k)), h = Math.max(1, Math.round(sh*k));
        const c = auditCanvas || (auditCanvas = root.document.createElement("canvas"));
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(src, 0, 0, w, h);
        let res = null;
        try{
          // twice: the tracker settles on this still before the frame that's read
          for(let i=0; i<2; i++){ lastTs = nextTs(lastTs, Math.round(perfNow())); res = lm.detectForVideo(c, lastTs); }
        }catch(e){ throw codedError("failed"); }
        lastVT = null;
        return observe(res, w, h);
      },
      close(){ if(closed) return; closed = true; try{ lm.close(); }catch(e){} lm = null; },
      get closed(){ return closed; },
    };
  }

  root.turnFacePose = {
    VERSION, T, HOLD_MS, LOAD, SHOW, CUES, LINES, HINTS,
    poseFromMatrix, poseFromLandmarks, faceGeometry, observe, createSmoother,
    classifyPose, evaluateFrame, createHoldMachine, canAutoCapture, cueFor, describeClass, nextStepLine, srCapturedLine,
    confirmFor, meterPos, bandFor, nextTs, mapLoadError,
    load, sampleLuma, installNetGuard,
  };
})(typeof window!=="undefined" ? window : globalThis);
