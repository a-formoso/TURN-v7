const MB = 1024 * 1024;

export function seedanceCapabilities(modelOrEndpoint) {
  const model = String(modelOrEndpoint || "bytedance/seedance-2.0/reference-to-video");
  const version = /seedance-2\.5/.test(model) ? "2.5" : "2.0";
  const fast = version === "2.0" && /\/fast\//.test(model);
  return {
    version,
    fast,
    duration: { min: 4, max: version === "2.5" ? 30 : 15, auto: true },
    resolutions: fast ? ["480p", "720p"] : (version === "2.5"
      ? ["480p", "720p", "1080p"]
      : ["480p", "720p", "1080p", "4K"]),
    aspectRatios: ["auto", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    bitrateModes: ["standard", "high"],
    references: version === "2.5" ? {
      images: { maxFiles: 30, maxBytesEach: 30 * MB },
      videos: { maxFiles: 10, maxBytesEach: 200 * MB, minSecondsEach: 1.8, maxSecondsEach: 30.2, maxSecondsCombined: 30.2 },
      audios: { maxFiles: 10, maxBytesEach: 15 * MB, minSecondsEach: 1.8, maxSecondsEach: 30.2, maxSecondsCombined: 30.2 },
      maxFilesTotal: 50,
    } : {
      images: { maxFiles: 9 },
      videos: { maxFiles: 3, maxBytesCombined: 50 * MB, minSecondsCombined: 2, maxSecondsCombined: 15 },
      audios: { maxFiles: 3, maxBytesCombined: 15 * MB, maxSecondsCombined: 15 },
      maxFilesTotal: 12,
    },
  };
}

const dataInfo = (value) => {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(value || ""));
  if (!match) return null;
  const encoded = match[2].replace(/\s/g, "");
  const padding = (encoded.match(/=*$/) || [""])[0].length;
  return { mime: match[1].toLowerCase(), sizeBytes: Math.max(0, Math.floor(encoded.length * 3 / 4) - padding) };
};

export function validateSeedanceRequest({ model, duration, resolution, aspectRatio, bitrateMode, prompt, images = [], videos = [], audios = [], metadata = {} }) {
  const cap = seedanceCapabilities(model);
  const errors = [];
  const endpoint = String(model || "");
  const isReference = /reference-to-video$/.test(endpoint);
  const lists = { images, videos, audios };

  if (!(duration === "auto" || duration == null)) {
    const n = Number(duration);
    if (!Number.isFinite(n) || n < cap.duration.min || n > cap.duration.max)
      errors.push(`duration must be "auto" or ${cap.duration.min}–${cap.duration.max} seconds for Seedance ${cap.version}`);
  }
  const wantedResolution = String(resolution || "720p");
  if (!cap.resolutions.includes(wantedResolution))
    errors.push(`resolution must be ${cap.resolutions.join(", ")} for this Seedance endpoint`);
  const wantedAspect = String(aspectRatio || "auto");
  if (!cap.aspectRatios.includes(wantedAspect))
    errors.push(`aspect ratio "${wantedAspect}" is not supported`);
  if (bitrateMode != null && !cap.bitrateModes.includes(String(bitrateMode)))
    errors.push('bitrate_mode must be "standard" or "high"');

  if (isReference) {
    if (!images.length && !videos.length)
      errors.push("reference-to-video requires at least one image or video reference");
    for (const kind of ["images", "videos", "audios"]) {
      const count = Array.isArray(lists[kind]) ? lists[kind].length : 0;
      if (count > cap.references[kind].maxFiles)
        errors.push(`${kind} accepts at most ${cap.references[kind].maxFiles} files (received ${count})`);
    }
    const total = images.length + videos.length + audios.length;
    if (total > cap.references.maxFilesTotal)
      errors.push(`reference package accepts at most ${cap.references.maxFilesTotal} total files (received ${total})`);
  } else if (/image-to-video$/.test(endpoint)) {
    if (!images.length || images.length > 2) errors.push("image-to-video requires a start image and accepts at most one optional end image");
    if (videos.length || audios.length) errors.push("image-to-video does not accept video or audio reference lists");
  } else if (/text-to-video$/.test(endpoint) && (images.length || videos.length || audios.length)) {
    errors.push("text-to-video does not accept media references");
  }

  for (const [kind, singular, mimePrefix] of [["images", "image", "image/"], ["videos", "video", "video/"], ["audios", "audio", "audio/"]]) {
    const rules = cap.references[kind];
    const values = lists[kind] || [];
    const facts = Array.isArray(metadata[kind]) ? metadata[kind] : [];
    let combinedSeconds = 0;
    let combinedBytes = 0;
    values.forEach((value, i) => {
      const embedded = dataInfo(value);
      const fact = facts[i] && typeof facts[i] === "object" ? facts[i] : {};
      if (/^data:/i.test(String(value || "")) && !embedded)
        errors.push(`${singular} ${i + 1} has a malformed data URL; base64 media with an explicit MIME type is required`);
      const mime = embedded?.mime || String(fact.mime || "").toLowerCase();
      const size = embedded?.sizeBytes ?? Number(fact.sizeBytes);
      if (embedded && !mime.startsWith(mimePrefix)) errors.push(`${singular} ${i + 1} data URL has MIME "${mime}", expected ${mimePrefix}…`);
      if (Number.isFinite(size) && size >= 0) {
        combinedBytes += size;
        if (rules.maxBytesEach && size > rules.maxBytesEach)
          errors.push(`${singular} ${i + 1} exceeds ${Math.round(rules.maxBytesEach / MB)}MB`);
      } else if (embedded || fact.sizeBytes != null) errors.push(`${singular} ${i + 1} has an invalid size`);
      if (kind !== "images") {
        const seconds = Number(fact.durationSeconds);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          errors.push(`${singular} ${i + 1} duration is unresolved; load/probe its metadata in the client before submitting`);
        } else {
          combinedSeconds += seconds;
          if (rules.minSecondsEach && seconds < rules.minSecondsEach) errors.push(`${singular} ${i + 1} must be at least ${rules.minSecondsEach}s`);
          if (rules.maxSecondsEach && seconds > rules.maxSecondsEach) errors.push(`${singular} ${i + 1} must be at most ${rules.maxSecondsEach}s`);
        }
      }
    });
    if (rules.maxBytesCombined && combinedBytes > rules.maxBytesCombined)
      errors.push(`${kind} exceed the ${Math.round(rules.maxBytesCombined / MB)}MB combined limit`);
    if (values.length && rules.minSecondsCombined && combinedSeconds < rules.minSecondsCombined)
      errors.push(`${kind} must total at least ${rules.minSecondsCombined}s`);
    if (rules.maxSecondsCombined && combinedSeconds > rules.maxSecondsCombined)
      errors.push(`${kind} exceed the ${rules.maxSecondsCombined}s combined duration limit`);
  }

  const counts = { image: images.length, video: videos.length, audio: audios.length };
  const tokenRe = /@(Image|Video|Audio)(\d+)\b/gi;
  let token;
  while ((token = tokenRe.exec(String(prompt || "")))) {
    const kind = token[1].toLowerCase();
    const index = Number(token[2]);
    if (index < 1 || index > counts[kind])
      errors.push(`${token[0]} has no matching ${kind} reference (only ${counts[kind]} supplied)`);
  }
  return { ok: errors.length === 0, errors, capabilities: cap };
}