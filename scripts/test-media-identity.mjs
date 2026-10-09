#!/usr/bin/env node
/* ============================================================================
   MEDIA IDENTITY REGRESSION TESTS

   These tests load the actual buildless media workers in isolated vm contexts.
   Every provider is a local fake which records invocations; no network, paid
   provider, Supabase project, or browser workflow is used.
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = file => readFileSync(file, "utf8");

function makeStorage() {
  const data = new Map();
  return {
    getItem: key => data.has(String(key)) ? data.get(String(key)) : null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: key => data.delete(String(key)),
    clear: () => data.clear(),
  };
}

function makeSandbox() {
  const localStorage = makeStorage();
  const events = [];
  const box = {
    console,
    localStorage,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask,
    Date,
    Promise,
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob,
    document: {
      createElement: tag => tag === "canvas"
        ? { width: 1600, height: 900, getContext: () => ({ drawImage: () => {} }),
            toDataURL: () => "data:image/png;base64,FAKE" }
        : { style: {} },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: event => { events.push(event); return true; },
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    React: {
      createElement: () => null,
      useState: initial => [initial, () => {}],
      useEffect: () => {},
      useRef: value => ({ current: value }),
      useMemo: fn => fn(),
      useCallback: fn => fn,
      Fragment: "fragment",
    },
    Image: class {
      constructor() {
        this.naturalWidth = 1600;
        this.naturalHeight = 900;
        this.width = 1600;
        this.height = 900;
      }
      set src(value) {
        this._src = value;
        queueMicrotask(() => { if (this.onload) this.onload(); });
      }
      get src() { return this._src; }
    },
  };
  box.window = box;
  box.globalThis = box;
  vm.createContext(box);
  return box;
}

function load(box, file) {
  vm.runInContext(source(file), box, { filename: file });
}

const scene = { id: "s1", no: 1 };
const conflictingDrafts = {
  s1: { blocks: [{ type: "action", text: "ODETTE BRUMFIELD — a man who handles relics; he opens the door." }] },
};
const conflict = {
  id: "odette", name: "ODETTE BRUMFIELD", pronouns: "she/her",
  pronounProvenance: "user", identityRevision: "2",
};
const blank = { id: "texture", name: "UNSET TEXTURE" };
const clean = {
  id: "clean", name: "CLEAN", pronouns: "she/her",
  pronounProvenance: "user", identityRevision: "2",
};
const conflictContext = {
  characterIds: ["odette"], cast: [conflict],
  scenes: [scene], drafts: conflictingDrafts,
};

let passes = 0;
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    passes++;
  } catch (error) {
    failures++;
    console.log("FAIL " + name + " — " + (error && error.stack || error));
  }
}

function imageBox() {
  const box = makeSandbox();
  box.TURN_SUPABASE = { imageProxy: true, imageProxyFn: "fake-image-proxy" };
  box._imageCalls = 0;
  box._imageBodies = [];
  box.sbClient = () => ({
    functions: {
      invoke: async (_fn, request) => {
        box._imageCalls++;
        box._imageBodies.push(request.body);
        return { data: { url: "https://fake.invalid/image-" + box._imageCalls + ".png" }, error: null };
      },
    },
  });
  load(box, "app/character-identity.js");
  load(box, "app/imagegen.jsx");
  return box;
}

function imageOpts(box, character = clean, extra = {}) {
  const context = { characterIds: [character.id], cast: [character], scenes: [], drafts: {} };
  box.turnIdentityContext = context;
  return {
    identityLive: true,
    identityEpoch: box.nbEpoch(),
    identityCharacter: character,
    identityCharacterIds: [character.id],
    identityCast: [character],
    identityContext: context,
    aspectRatio: "16:9",
    ...extra,
  };
}

async function imageTests() {
  await check("image conflict blocks before one normal provider call", async () => {
    const box = imageBox();
    box.turnIdentityContext = conflictContext;
    await assert.rejects(
      box.nbGenerate("A canonical frame", imageOpts(box, conflict, {
        identityContext: conflictContext, identityCast: [conflict],
      })),
      /identity|conflict|review/i,
    );
    assert.equal(box._imageCalls, 0);
  });

  await check("preceding unset cast member cannot swallow a selected conflict", async () => {
    const box = imageBox();
    box.turnIdentityContext = { cast: [blank, conflict], scenes: [scene], drafts: conflictingDrafts };
    assert.throws(() => box.nbAssertMediaIdentity({
      identityCharacterIds: ["odette"],
      identityCast: [blank, conflict],
      identityContext: { characterIds: ["odette"], cast: [blank, conflict], scenes: [scene], drafts: conflictingDrafts },
    }), /identity|conflict|review/i);
    assert.equal(box._imageCalls, 0);
  });

  await check("explicitly scoped unset human is blocked, while incidental project unset is skipped", async () => {
    const box = imageBox();
    assert.throws(() => box.nbAssertMediaIdentity({
      identityCharacter: blank, identityCharacterIds: [blank.id],
      identityCast: [blank], identityContext: { characterIds: [blank.id], cast: [blank] },
    }), /unresolved|identity/i);
    assert.doesNotThrow(() => box.nbAssertMediaIdentity({
      identityCast: [blank, clean], identityContext: { cast: [blank, clean] },
    }));
  });

  await check("normal, edited, and image-batch calls submit through the fake provider", async () => {
    const box = imageBox();
    const normal = imageOpts(box, clean);
    await box.nbGenerate("Normal frame", normal);
    await box.nbGenerate("Edited frame", imageOpts(box, clean, {
      referenceImage: "data:image/png;base64,FAKE",
      extraImages: ["data:image/png;base64,FAKE"],
    }));
    await Promise.all([
      box.nbGenerate("Batch frame one", imageOpts(box, clean)),
      box.nbGenerate("Batch frame two", imageOpts(box, clean)),
    ]);
    assert.equal(box._imageCalls, 4);
    assert.equal(box._imageBodies.length, 4);
    assert.ok(box._imageBodies.every(b => /CANONICAL CHARACTER IDENTITY/i.test(b.prompt)));
    assert.ok(box._imageBodies.every(b => /clean.*canonical pronouns: she\/her/i.test(b.prompt)));
  });

  await check("legacy image metadata is advisory and explicit regeneration remains possible", async () => {
    const box = imageBox();
    const opts = imageOpts(box, clean);
    assert.doesNotThrow(() => box.nbAssertIdentityAssetFresh("legacy-sheet", clean, opts.identityContext));
    const metaKey = "turn-charimg-meta-" + clean.id;
    box.localStorage.setItem(metaKey, JSON.stringify({
      identitySnapshot: { characterId: clean.id, pronouns: "he/him", identityRevision: "1" },
      canonicalPronouns: "he/him", identityVerified: true,
    }));
    assert.throws(() => box.nbAssertIdentityAssetFresh(clean.id, clean, opts.identityContext), /stale|canon/i);
    /* The stale previous sheet does not deadlock the deliberate replacement. */
    await box.nbGenerate("Regenerate the current canonical sheet", opts);
    assert.equal(box._imageCalls, 1);
  });

  await check("old canonical image generation context is rejected after live canon changes", async () => {
    const box = imageBox();
    const old = { ...clean, pronouns: "he/him", identityRevision: "1" };
    const opts = imageOpts(box, old);
    box.turnIdentityContext = { cast: [clean], scenes: [], drafts: {} };
    await assert.rejects(box.nbGenerate("Old frame", {
      ...opts,
      identityContext: { characterIds: [old.id], cast: [old], scenes: [], drafts: {} },
      identityCast: [old],
    }), /changed|identity|canon/i);
    assert.equal(box._imageCalls, 0);
  });

  await check("published repaired visual identity wins before media submission", async () => {
    const box = imageBox();
    const oldCharacter = {
      id: "odette", name: "ODETTE BRUMFIELD", pronouns: "he/him",
      identityRevision: "7", coreBody: "ODETTE BRUMFIELD is a woman with long hair",
    };
    const repairedCharacter = {
      ...oldCharacter, coreBody: "ODETTE BRUMFIELD is a man with broad shoulders",
    };
    const oldContext = {
      characterIds: [oldCharacter.id], cast: [oldCharacter], scenes: [], drafts: {},
    };
    const repairedContext = {
      characterIds: [repairedCharacter.id], cast: [repairedCharacter],
      characters: [repairedCharacter], scenes: [], drafts: {},
    };
    /* This is the coordinator ordering regression: the request still carries
       the pre-React old cast, but the synchronous live publication already
       contains the repaired visual specification. */
    box.turnCast = [repairedCharacter];
    box.turnIdentityContext = repairedContext;
    await box.nbGenerate("Current canonical character sheet", {
      identityLive: true, identityEpoch: box.nbEpoch(),
      identityCharacter: repairedCharacter,
      identityCharacterIds: [repairedCharacter.id],
      identityCast: [oldCharacter],
      identityContext: oldContext,
      aspectRatio: "16:9",
    });
    assert.equal(box._imageCalls, 1);
  });

  await check("current scene conflict is rechecked after an await boundary", async () => {
    const box = imageBox();
    const opts = imageOpts(box, conflict, {
      identityContext: { characterIds: [conflict.id], cast: [conflict], scenes: [], drafts: {} },
      identityCast: [conflict],
    });
    box.nbAssertMediaIdentity(opts, "before-await");
    box.turnIdentityContext = { cast: [conflict], scenes: [scene], drafts: conflictingDrafts };
    assert.throws(() => box.nbAssertMediaIdentity(opts, "after-await"), /identity|conflict|review/i);
  });

  await check("saved-film identityLive false never consults the active film globals", async () => {
    const box = imageBox();
    box.turnIdentityContext = conflictContext;
    assert.doesNotThrow(() => box.nbAssertMediaIdentity({
      identityLive: false, identityCharacter: clean, identityCharacterIds: [clean.id],
      identityCast: [clean],
      identityContext: { characterIds: [clean.id], cast: [clean], scenes: [], drafts: {} },
    }));
  });

  await check("canonical wording is present in direct image prompts", async () => {
    const box = imageBox();
    const text = box.nbCanonicalMediaPrompt("Manual edit instruction", imageOpts(box, clean));
    assert.match(text, /CANONICAL CHARACTER IDENTITY/i);
    assert.match(text, /canonical pronouns: she\/her/i);
    assert.match(box.buildSimpleCharPrompt(clean), /CANONICAL CHARACTER IDENTITY/i);
    assert.equal(box.nbIdentitySnapshot(clean).identityRevision, "2");
  });
}

function voiceBox() {
  const box = makeSandbox();
  box.TURN_SUPABASE = { imageProxy: true, imageProxyFn: "fake-voice-proxy" };
  box._voiceCalls = 0;
  box._voiceBodies = [];
  box.sbClient = () => ({
    functions: {
      invoke: async (_fn, request) => {
        box._voiceCalls++;
        const body = request.body || {};
        box._voiceBodies.push(body);
        if (body.op === "tts") return { data: { audioB64: "AA==", mime: "audio/mpeg", durationMs: 200, via: "fal" }, error: null };
        if (body.op === "design") return { data: { previews: [{ generatedVoiceId: "generated-1", audioB64: "AA==" }] }, error: null };
        if (body.op === "saveVoice") return { data: { voiceId: "saved-1", name: "Saved" }, error: null };
        if (body.op === "listVoices") return { data: { voices: [{ voiceId: "library-1", name: "Library" }] }, error: null };
        if (body.op === "clone") return { data: { voiceId: "clone-1", name: "Clone" }, error: null };
        return { data: {}, error: null };
      },
    },
  });
  load(box, "app/character-identity.js");
  load(box, "app/voicegen.jsx");
  return box;
}

function voiceConflictOpts(box) {
  box.turnIdentityContext = conflictContext;
  return {
    voiceId: "voice-1", identityLive: true, identityEpoch: 0,
    identityCharacter: conflict, identityCharacterIds: [conflict.id],
    identityCast: [conflict], identityContext: conflictContext,
  };
}

async function voiceTests() {
  await check("all direct voice routes block a conflict with zero provider calls", async () => {
    const box = voiceBox();
    const o = voiceConflictOpts(box);
    const calls = [
      () => box.elGenerate("line", "Hello", { ...o, force: true }),
      () => box.elSpeak("Hello", o),
      () => box.elDesignVoice("A grounded voice", o),
      () => box.elSaveVoice("generated-1", { ...o, name: "Odette", description: "Voice" }),
      () => box.elListVoices(o),
      () => box.elCloneVoice(["data:audio/wav;base64,AA=="], { ...o, name: "Odette", description: "Voice" }),
    ];
    for (const call of calls) await assert.rejects(call, /identity|conflict|review/i);
    assert.equal(box._voiceCalls, 0);
  });

  await check("voice lock from a prior canon revision requires an explicit relock", async () => {
    const box = voiceBox();
    box.turnIdentityContext = { cast: [clean], scenes: [], drafts: {} };
    await assert.rejects(box.elGenerate("line", "Hello", {
      ...voiceConflictOpts(box),
      identityCharacter: clean,
      identityCharacterIds: [clean.id],
      identityCast: [clean],
      identityContext: { characterIds: [clean.id], cast: [clean], scenes: [], drafts: {} },
      voiceLock: { voiceId: "old-voice", identityRevision: "1", identityPronouns: "he/him" },
    }), /predates|relock|identity/i);
    assert.equal(box._voiceCalls, 0);
  });

  await check("voice design/save/list/clone/test can call only the fake provider after approval", async () => {
    const box = voiceBox();
    const o = {
      voiceId: "voice-1", force: true, identityLive: true, identityEpoch: 0,
      identityCharacter: clean, identityCharacterIds: [clean.id], identityCast: [clean],
      identityContext: { characterIds: [clean.id], cast: [clean], scenes: [], drafts: {} },
    };
    box.turnIdentityContext = o.identityContext;
    await box.elDesignVoice("A clear, grounded voice", o);
    await box.elSaveVoice("generated-1", { ...o, name: "Clean", description: "Voice" });
    await box.elListVoices(o);
    await box.elCloneVoice(["data:audio/wav;base64,AA=="], { ...o, name: "Clean", description: "Voice" });
    await box.elGenerate("line", "Hello", o);
    assert.equal(box._voiceCalls, 5);
  });

  await check("Voice Design locks a permanent ElevenLabs voice before rendering the named canonical master", async () => {
    const box = voiceBox();
    const character = { ...clean, name: "MARCUS TILLMON" };
    const context = { characterIds: [character.id], cast: [character], scenes: [], drafts: {} };
    const identity = { identityLive: true, identityEpoch: 0, identityCharacter: character,
      identityCharacterIds: [character.id], identityCast: [character], identityContext: context };
    box.turnIdentityContext = context;
    const phrase = "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos";
    assert.equal(box.VG_VOICE_MASTER_TEXT, phrase);
    assert.equal(box.vgVoiceMasterFileName(character.name), "MARCUS_TILLMON_voice.mp3");
    assert.equal(box.vgVoiceMasterFileName("  Marcus / O'Neil  "), "Marcus_ONeil_voice.mp3");

    const previews = await box.elDesignVoice("A warm, expressive original voice", { ...identity, text: phrase, seed: 42 });
    const saved = await box.elSaveVoice(previews[0].generatedVoiceId, { ...identity, name: character.name, description: "Original voice" });
    const lock = { voiceId: saved.voiceId, voiceName: saved.name, source: "designed",
      modelId: "eleven_v3", modelChosen: true, revision: "master-v1",
      defaults: { stability: 0.7, similarity: 0.75, style: 0.1, speed: 1, speakerBoost: true },
      identityRevision: character.identityRevision, identityPronouns: character.pronouns };
    const rendered = await box.elGenerateVoiceMaster(character, lock, { ...identity, projectId: "film-a" });
    assert.deepEqual(box._voiceBodies.map(x => x.op), ["design", "saveVoice", "tts"]);
    assert.equal(box._voiceBodies[0].text, phrase);
    assert.equal(box._voiceBodies[1].generatedVoiceId, "generated-1");
    assert.equal(box._voiceBodies[2].voiceId, "saved-1");
    assert.equal(box._voiceBodies[2].text, phrase);
    assert.equal(rendered.assetId, "voice-master-clean");
    assert.equal(rendered.fileName, "MARCUS_TILLMON_voice.mp3");
    assert.equal(rendered.assetRole, "character_voice_master");
    assert.equal(rendered.characterId, character.id);
    assert.equal(rendered.projectId, "film-a");
    assert.equal(box.vgVoiceMasterStatus(lock, rendered.audioUrl, rendered, "film-a").ready, true);
    assert.equal(box.vgGetAudio(rendered.assetId, "film-b"), "");

    const calls = box._voiceCalls;
    const cached = await box.elGenerateVoiceMaster(character, lock, { ...identity, projectId: "film-a" });
    assert.equal(cached.cached, true);
    assert.equal(box._voiceCalls, calls);
    const relocked = { ...lock, voiceId: "saved-2", revision: "master-v2" };
    await box.elGenerateVoiceMaster(character, relocked, { ...identity, projectId: "film-a" });
    assert.equal(box._voiceCalls, calls + 1);
    assert.equal(box._voiceBodies.at(-1).voiceId, "saved-2");
  });

  await check("canonical voice masters pin model/settings and line readiness requires matching bytes + lineage", async () => {
    const box = voiceBox();
    const lock = {
      voiceId: "voice-1", modelId: "eleven_multilingual_v2", modelChosen: false,
      revision: "voice-v2", defaults: { stability: 0.6, similarity: 0.8, style: 0.05, speed: 1, speakerBoost: true },
      identityRevision: clean.identityRevision, identityPronouns: clean.pronouns,
    };
    assert.equal(box.vgDeliveryModelOf(lock), "eleven_multilingual_v2");
    const context = { characterIds: [clean.id], cast: [clean], scenes: [], drafts: {} };
    box.turnIdentityContext = context;
    const rendered = await box.elGenerate("line-provenance", "Hello", {
      voiceId: lock.voiceId, settings: lock.defaults, modelId: box.vgDeliveryModelOf(lock),
      voiceLock: lock, force: true, projectId: "film-a",
      identityLive: true, identityEpoch: 0, identityCharacter: clean,
      identityCharacterIds: [clean.id], identityCast: [clean], identityContext: context,
    });
    const expectedHash = box.vgHash("Hello", lock.voiceId, {
      ...box.vgResolvedSettings(lock), modelId: "eleven_multilingual_v2",
    });
    assert.equal(rendered.hash, expectedHash);
    assert.equal(rendered.voiceSignature, box.vgVoiceLockSignature(lock));
    assert.equal(rendered.provider, "fal");
    assert.equal(rendered.projectId, "film-a");
    const lineAudio = {
      durationMs: rendered.durationMs, text: "Hello", voiceId: lock.voiceId,
      voiceRevision: lock.revision, voiceSignature: rendered.voiceSignature,
      modelId: rendered.modelId, settings: rendered.settings, hash: rendered.hash, projectId: "film-a",
    };
    assert.equal(box.vgLineAudioStatus(lineAudio, lock, "Hello", rendered.audioUrl, "film-a", rendered).ready, true);
    assert.equal(box.vgLineAudioStatus(lineAudio, lock, "Hello", "", "film-a", rendered).state, "missing-bytes");
    assert.equal(box.vgLineAudioStatus(lineAudio, {...lock, voiceId:"voice-2"}, "Hello", rendered.audioUrl, "film-a", rendered).state, "stale-voice");
    assert.equal(box.vgLineAudioStatus(lineAudio, lock, "Hello", rendered.audioUrl, "film-b", rendered).state, "wrong-project");
    assert.equal(box.vgLineAudioStatus(lineAudio, lock, "Hello", rendered.audioUrl, "film-a", {...rendered,hash:"other"}).state, "stale-bytes");
  });
}

function videoBox() {
  const box = makeSandbox();
  box.TURN_SUPABASE = { imageProxy: true, imageProxyFn: "fake-video-proxy" };
  box._videoCalls = 0;
  box.nbCloudScope = () => null;
  box.sbClient = () => ({
    functions: {
      invoke: async () => {
        box._videoCalls++;
        return { data: { requestId: "request", statusUrl: "status", responseUrl: "response" }, error: null };
      },
    },
  });
  load(box, "app/character-identity.js");
  load(box, "app/videogen.jsx");
  return box;
}

function videoConflictOpts() {
  return {
    frameUrl: "https://fake.invalid/frame.png", prompt: "A moving frame",
    durationMs: 4000, identityCharacterIds: [conflict.id],
    identityCast: [conflict], identityContext: conflictContext,
  };
}

async function videoTests() {
  await check("video normal and batch guards block before provider submission", async () => {
    const box = videoBox();
    box.turnIdentityContext = { cast: [conflict], scenes: [scene], drafts: conflictingDrafts };
    await assert.rejects(box.seedanceGenerate("clip", videoConflictOpts()), /identity|conflict|review/i);
    await Promise.all([
      assert.rejects(box.seedanceGenerate("batch-1", videoConflictOpts()), /identity|conflict|review/i),
      assert.rejects(box.seedanceGenerate("batch-2", videoConflictOpts()), /identity|conflict|review/i),
    ]);
    assert.equal(box._videoCalls, 0);
  });

  /* (2026-10-09, owner — Stage review) a job whose identity became contradictory is no longer skipped on
     every load while the server charges it: it is polled; still running → kept; finished → saved as a
     take flagged identityChanged (never replacing the current one) and taken off the list */
  await check("video recovery polls a contradictory pending job: kept while running, saved flagged when finished", async () => {
    const box = videoBox();
    box.turnIdentityContext = { cast: [conflict], scenes: [scene], drafts: conflictingDrafts };
    const job = {
      requestId: "recover-1", id: "clip", projectId: null, model: "fake",
      statusUrl: "status", responseUrl: "response", at: Date.now(),
      identityCharacterIds: [conflict.id], identityCast: [conflict],
      identityContext: conflictContext,
    };
    box.localStorage.setItem("turn_vid_pending", JSON.stringify([job]));
    await box.vidRecoverPending({ quiet: true });
    assert.equal(box._videoCalls, 1);
    assert.equal(box.vidPendingList().length, 1);
    box.sbClient = () => ({ functions: { invoke: async () => { box._videoCalls++;
      return { data: { status: "COMPLETED", videoUrl: "https://fake.invalid/done.mp4" }, error: null }; } } });
    await box.vidRecoverPending({ quiet: true });
    assert.equal(box.vidPendingList().length, 0);
    assert.equal(box.vidGetVideo("clip"), "https://fake.invalid/done.mp4");
    assert.equal(box.vidGetMeta("clip").identityChanged, true);
  });

  await check("explicitly scoped unset video identity blocks before provider", async () => {
    const box = videoBox();
    await assert.rejects(box.seedanceGenerate("unset", {
      frameUrl: "https://fake.invalid/frame.png", prompt: "Frame", durationMs: 4000,
      identityCharacter: blank, identityCharacterIds: [blank.id],
      identityCast: [blank], identityContext: { characterIds: [blank.id], cast: [blank] },
    }), /unresolved|identity/i);
    assert.equal(box._videoCalls, 0);
  });
}

async function sourceCoverageTests() {
  await check("storyboard panel edits carry identity guards and canonical prompts", async () => {
    const text = source("app/storyboard.jsx");
    assert.match(text, /storyboard-panel-edit-start/);
    assert.match(text, /storyboard-panel-edit-before-submit/);
    assert.match(text, /storyboard-panel-edit-before-commit/);
    assert.match(text, /CANONICAL CHARACTER IDENTITY/);
    assert.match(text, /identitySnapshots/);
  });
  await check("voice locks persist identity revision and all direct media paths are guarded", async () => {
    const voiceUi = source("app/voices-ui.jsx");
    const voice = source("app/voicegen.jsx");
    assert.match(voiceUi, /identityRevision/);
    assert.match(voiceUi, /elGenerateVoiceMaster\(c,voiceLock/);
    for (const marker of ["voice-design-start", "voice-save-start", "voice-list-start", "voice-clone-start", "voice-before-submit"])
      assert.match(voice, new RegExp(marker));
  });
  await check("production voice flow uses exact speaker evidence, repeatable auditions and Seedance vocal identity roles", async () => {
    const app = source("app/app.jsx");
    const voiceUi = source("app/voices-ui.jsx");
    const stage = source("app/stage.jsx");
    const brief = source("app/stage-director-brief.js");
    assert.match(app, /voiceLock:spk\.voiceLock/);
    assert.match(app, /visual cast is never used to guess a voice/i);
    assert.doesNotMatch(app.slice(app.indexOf("const resolveLineSpeaker"), app.indexOf("const voiceOneLine")), /inFrameCast/);
    assert.match(voiceUi, /VC_AUDITION_TEXT/);
    assert.match(voiceUi, /text:VC_AUDITION_TEXT,seed:vcStableSeed/);
    assert.match(voiceUi, /Generate voice file/);
    assert.match(voiceUi, /Download/);
    assert.match(voiceUi, /sample phrase is never substituted for a line/i);
    assert.match(voiceUi, /specSnapshot/);
    assert.match(app, /assetRole:"dialogue_line"/);
    assert.match(app, /voiceMasterAssetId,voiceMasterFileName/);
    assert.match(stage, /authoritative voice-performance reference for this exact line only/);
    assert.match(stage, /timbre, vocal age and register, tone, accent or dialect, cadence, pacing, emphasis, breath and delivery/);
    assert.match(brief, /authoritative exact-line voice performance/);
  });
  await check("multiple Voice cards stay independently open inside their character cards", async () => {
    const art = source("app/artroom.jsx");
    const voiceUi = source("app/voices-ui.jsx");
    const styles = source("app/styles.css");
    const styleBibleUi = source("app/stylebible-ui.jsx");
    const modal = voiceUi.slice(voiceUi.indexOf("function VoiceModal"));
    assert.match(art, /openVoiceIds/);
    assert.match(art, /voiceOpen && window\.VoiceModal/);
    assert.match(art, /onCloseVoice:closeVoice/);
    assert.match(art, /"aria-controls":"voice-popup-"/);
    assert.doesNotMatch(art, /voice-workspace|openVoiceCharacters\.map|Compare another voice/);
    assert.match(voiceUi, /aria-modal":"false"/);
    assert.match(voiceUi, /data-testid":"voice-popup"/);
    assert.match(voiceUi, /data-testid":"voice-card-overlay"/);
    assert.match(voiceUi, /siblings\.forEach\(el=>\{ el\.setAttribute\("inert",""\)/);
    assert.match(voiceUi, /panelRef\.current\.focus/);
    assert.doesNotMatch(modal, /lb-overlay|dt-overlay|voice-workspace/);
    assert.match(voiceUi, /const \[playingUrl, setPlayingUrl\] = React\.useState\(""\)/);
    assert.match(voiceUi, /current\.audio\.pause\(\)/);
    assert.match(voiceUi, /current && current\.url===url/);
    assert.match(voiceUi, /masterStatus\.ready\?\(isPlaying\(masterAudio\.audioUrl\)\?"Pause":"Play"\)/);
    assert.match(voiceUi, /"aria-pressed":isPlaying\(p\.audioUrl\)\?"true":"false"/);
    assert.match(voiceUi, /className:"vc-btn audio-toggle"\+\(masterStatus\.ready\?" playback":""\)/);
    assert.match(voiceUi, /window\.InfoTip && _vcEl\(window\.InfoTip/);
    assert.match(voiceUi, /label:"How the voice master is used"/);
    assert.doesNotMatch(voiceUi, /className:"vc-master-foot"/);
    assert.doesNotMatch(voiceUi, /_vcAudioByOwner|vcStopOwner/);
    assert.doesNotMatch(voiceUi, /A\/B auditions|comparison window|voice-workspace/);
    assert.match(styles, /\.sheet-card\.voice-open\{position:relative;isolation:isolate;content-visibility:visible\}/);
    assert.match(styles, /\.voice-card-overlay\{position:absolute;inset:0[\s\S]*?align-items:center;justify-content:center;padding:20px/);
    assert.match(styles, /@media \(max-width:760px\)[\s\S]*?\.voice-card-overlay\{padding:10px\}/);
    assert.match(styles, /\.vc-btn\.audio-toggle\.playback\{width:82px;flex:0 0 82px/);
    assert.match(styles, /\.vc-master-tools \.infotip-pop\{left:auto;right:0;width:min\(280px,calc\(100vw - 56px\)\)/);
    assert.match(styleBibleUi, /const \[focused, setFocused\] = React\.useState\(false\)/);
    assert.match(styleBibleUi, /"aria-describedby":show\?tipId:undefined/);
    assert.match(styleBibleUi, /onKeyDown:\(e\)=>\{ if\(e\.key==="Escape"\)/);
    assert.doesNotMatch(styles, /\.voice-workspace/);
  });
  await check("video payload and recovery preserve identity context", async () => {
    const video = source("app/videogen.jsx");
    assert.match(video, /identityCharacterIds/);
    assert.match(video, /identityContext/);
    assert.match(video, /video-recovery-before-commit/);
    assert.match(video, /video-after-poll/);
  });
  await check("coordinator publishes repaired character before React persistence", async () => {
    const app = source("app/app.jsx");
    const publish = app.indexOf("window.turnIdentityContext={...live,cast:next,characters:next}");
    const persist = app.indexOf("setCharacters(cs=>cs.map(merge))");
    assert.ok(publish >= 0 && persist >= 0 && publish < persist);
    assert.match(app.slice(publish, persist), /window\.turnCast=next/);
  });
}

await imageTests();
await voiceTests();
await videoTests();
await sourceCoverageTests();
console.log("RESULT: " + (failures ? "FAIL — " : "OK — ") + passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
