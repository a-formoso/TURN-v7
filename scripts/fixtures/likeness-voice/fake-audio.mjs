/* fake-audio.mjs — a stand-in for the browser's HTMLAudioElement, for the Likeness window's spoken guidance tests
   (2026-10-10, owner — Likeness voice guidance). No sound, no network: the page's ONE audio element plays a clip
   when its file is among the recorded ones, for a fixed time on the test's own clock.

     const env = makeAudioEnv({ files, autoplay, playMs, setTimeout, now });
       files      Set of clip ids that exist (null = every clip exists)
       autoplay   "ok" | "blocked" (play() rejects with NotAllowedError until env.unblock())
       playMs     how long a clip plays (default 600)
       setTimeout / now  the test's clock
     env.Audio            the constructor to hand to the page (new Audio())
     env.exists(url)      whether a clip file is there (for the test's fetch)
     env.created          every element made; env.plays: [{ id, at, volume, muted, from, rate }] every clip that
                          started (from = the second it was started at; rate = its playback speed)
     An element knows how far it is (currentTime moves with the test's clock) and how long its clip is (duration).
     env.unblock(); env.failAt(id) (the clip errors when it is played); env.playing() → the ids playing now */
export function makeAudioEnv(opts = {}){
  const files = opts.files === undefined ? null : opts.files;
  const playMs = opts.playMs || 600;
  const setT = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const now = opts.now || (() => 0);
  const env = { created: [], plays: [], blocked: opts.autoplay === "blocked", failing: new Set() };
  const idOf = (src) => String(src || "").replace(/^.*\//, "").replace(/\.mp3$/, "");
  env.exists = (src) => files == null || files.has(idOf(src));
  class FakeAudio {
    constructor(src){
      this.src = src || ""; this.listeners = {}; this.paused = true; this._ct = 0; this._startAt = null; this.duration = NaN;
      this.volume = 1; this.muted = false; this.playbackRate = 1;
      this.preload = ""; this.released = false; this.playN = 0;
      env.created.push(this);
    }
    get currentTime(){ return this._startAt == null ? this._ct : this._ct + (now() - this._startAt) / 1000; }
    set currentTime(v){ this._ct = Number(v) || 0; if (this._startAt != null) this._startAt = now(); }
    get id(){ return idOf(this.src); }
    addEventListener(t, fn){ (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn){ this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
    emit(t){ for (const fn of (this.listeners[t] || []).slice()) fn({ type: t, target: this }); }
    play(){
      if (env.blocked) return Promise.reject(Object.assign(new Error("play() needs a user gesture"), { name: "NotAllowedError" }));
      const n = ++this.playN;
      if (!this.src || !env.exists(this.src) || env.failing.has(this.id)){
        Promise.resolve().then(() => { if (this.playN === n) this.emit("error"); });
        return Promise.reject(Object.assign(new Error("no supported source"), { name: "NotSupportedError" }));
      }
      this.paused = false; this.released = false;
      this._startAt = now(); this.duration = this._ct + playMs / 1000;
      env.plays.push({ id: this.id, at: now(), volume: this.volume, muted: !!this.muted, from: this._ct, rate: this.playbackRate });
      setT(() => { if (!this.paused && this.playN === n){ this._ct = this.currentTime; this._startAt = null; this.paused = true; this.emit("ended"); } }, playMs);
      return Promise.resolve();
    }
    pause(){ this._ct = this.currentTime; this._startAt = null; this.paused = true; this.playN++; }
    load(){}
    removeAttribute(name){ if (name === "src"){ this.src = ""; this.released = true; } }
  }
  env.Audio = FakeAudio;
  env.unblock = () => { env.blocked = false; };
  env.failAt = (id) => env.failing.add(id);
  env.playing = () => env.created.filter((a) => !a.paused).map((a) => a.id);
  env.audible = () => env.plays.filter((p) => !p.muted).map((p) => p.id);
  return env;
}
