/* supabase-config.js — TURN's connection to Supabase.
   The anon key is meant to live in client code; Row Level Security is what
   protects the data. NEVER put the service_role key here. */
window.TURN_SUPABASE = {
  url: "https://vubenblfdzginlqiglzw.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1YmVuYmxmZHpnaW5scWlnbHp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTgwOTgsImV4cCI6MjA5NjMzNDA5OH0.Mq_SsKNEV2S25E8p_QvRHjix1MsvOEa8yhr6_XQJapE",
  /* tables live in `public` with a turn_ prefix; bucket holds generated images */
  bucket: "turn-assets",
  /* local-first: the app works signed-out on local storage; cloud when signed in */
  localFirst: true,
  /* Server-side proxy. When TRUE, generation is routed through the `image-proxy`
     Supabase Edge Function. The function normally uses platform keys stored as
     server secrets; the admin-only API Keys modal can override them for testing.
     Image generation is fal.ai-first (Nano Banana 2.1, GPT Image 2.5 and Seedream 5 Pro),
     writing/text stays with the selected text provider, Stage video stays on
     fal.ai, ElevenLabs voice-library operations stay on ElevenLabs, and MUSE's
     live New Story conversation opens a secure WebRTC session through this
     proxy. Keep FALSE only for local smoke tests that do not need media or live
     voice. */
  imageProxy: true,
  imageProxyFn: "image-proxy",
  /* Readable Storage folders (2026-09-27): new image keys start with
     "{name}--{account id}/{name}--{project id}/…" once the server answers
     turn_storage_folders (supabase/storage-readable-folders.sql); until then, and
     whenever it refuses, they stay "{account id}/{project id}/…". Set FALSE to make
     this client write only the old form (the client kill switch; the server one is
     in the SQL file's header). Files already stored keep working either way. */
  readableStorageKeys: true,
  /* Build the set (2026-11-05, owner — paying plans): TRUE showed a location card's "Build the set" / "Style it" steps.
     Those two steps left the card on 2026-11-15 (owner: one road, Previs makes the image; "remove Blender"), so
     nothing in the app queues a cloud build now. The flag still turns on the location's 3D camera tools
     (KinolotCloudRender.enabled), so it stays TRUE. The server side (blender-render, its holds) is untouched. */
  setBuild: true,
  /* Enable only after the queued MCP worker, scene-storage migration and server
     BLENDER_RENDER_MCP / BLENDER_RENDER_SCENE_STORAGE switches are verified. */
  setBuildMcp: true,
};
