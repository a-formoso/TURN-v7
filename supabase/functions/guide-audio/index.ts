// guide-audio — records the Likeness capture window's spoken instructions ONCE, in Frances's voice
// (OpenAI "marin", the default voice of the New Story live conversation), so the app ships them as
// small mp3 files (app/vendor/voice/frances-guide/v2/<id>.mp3) and plays them with no per-use cost.
// (2026-10-10, owner — Likeness voice guidance: "use that agent's voice to read out the instructions".)
//
// NOT part of the app at runtime. Operator only: the caller must send GUIDE_AUDIO_TOKEN, a one-time function secret set just for the
// recording (an operator on the Mac, via scripts/render-guide-audio.mjs) and deleted afterwards. Deploy only to re-record, then delete it:
//   npx -y supabase@2.117.0 functions deploy guide-audio --project-ref <ref> --use-api --no-verify-jwt
//   …run the script…
//   npx -y supabase@2.117.0 functions delete guide-audio --project-ref <ref>
// Text in, audio out — nothing about anyone's face or account is involved.

const VOICE = "marin";
const MODEL = "gpt-4o-mini-tts";
// (2026-11-17, owner — "more seamless and not sound robotic") the second script: one relaxed sitting, never an announcement.
const STYLE = "You are a warm, easy-going portrait photographer talking a friend through three quick photos, in the same relaxed sitting from the first line to the last. "
  + "Speak the way people really talk: unhurried, smiling, natural, never like an announcement or a list of commands. "
  + "Keep the same pace, energy and volume on every line. Short lines stay light and quick, with no drawn-out ending. No pause before the first word.";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  // a one-time operator token set as a function secret just for the recording (GUIDE_AUDIO_TOKEN, 32+ chars),
  // removed afterwards; without it nothing is accepted
  const token = Deno.env.get("GUIDE_AUDIO_TOKEN") || "";
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.length < 32 || auth !== token) return new Response("forbidden", { status: 403 });
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return new Response("no key", { status: 500 });
  let body: any = null;
  try { body = await req.json(); } catch (_e) { return new Response("bad json", { status: 400 }); }
  const lines = Array.isArray(body && body.lines) ? body.lines : [];
  if (!lines.length || lines.length > 120) return new Response("1-120 lines", { status: 400 });
  const out: any[] = [];
  for (const l of lines) {
    const id = String((l && l.id) || ""), text = String((l && l.text) || "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id) || !text || text.length > 300) { out.push({ id, error: "bad line" }); continue; }
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions: STYLE, response_format: "mp3" }),
    });
    if (!r.ok) { out.push({ id, error: "tts " + r.status + " " + (await r.text()).slice(0, 200) }); continue; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    out.push({ id, mp3: btoa(bin), bytes: bytes.length });
  }
  return new Response(JSON.stringify({ voice: VOICE, model: MODEL, clips: out }), { headers: { "Content-Type": "application/json" } });
});
