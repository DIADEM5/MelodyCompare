"use strict";
const $ = id => document.getElementById(id);
const Engine = window.MelodyAudio, Versions = window.MelodyVersions;
const clamp = Engine.clamp;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null, history = null, source = null, originalBuffer = null, workingBuffer = null;
let sessionName = "", sessionEpoch = 0, loadingToken = 0, renderToken = 0, rendering = false, workingRender = null, renderedSignature = "", savingVersion = false;
let selectedVersionId = "original", selectedPointId = null;
let activeSelection = null, viewOffset = 0, autoFollow = true, dragState = null, draftPreview = null;
let playbackToken = 0, playbackOffset = 0, playbackProgress = 0, playingId = null, preparedId = null, activeAudioUrl = null, originalFileUrl = null;
let sequencePlan = null, sequencePreparing = false;
const audioCache = new Map(), pendingRenders = new Map(), scoreCache = new Map(), wavBlobCache = new Map();
let currentComparison = null, draftScoreState = null, draftScoreResult = null, draftEntityCache = null;
let partialScoreKey = "", partialScoreResults = new Map();
function context() {
  if (!AudioContextClass) throw new Error("Web Audio is unavailable. Use a current Chrome or Edge browser.");
  if (!audioContext) audioContext = new AudioContextClass(); return audioContext;
}
function tell(message) { $("status").textContent = message; }
function timeLabel(seconds) { const t = Math.max(0, seconds || 0); return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(Math.floor(t % 60)).padStart(2, "0"); }
const precise = value => Number(value).toFixed(2) + "s";
const pitchText = value => (value > 0 ? "+" : "") + Number(value.toFixed(2)) + (Math.abs(value) === 1 ? " semitone" : " semitones");
const workingState = () => draftPreview || history?.working;
const signature = state => JSON.stringify(state);
function entity(id) {
  if (!history) return null;
  if (id !== "draft") {
    const saved = history.get(id);
    return saved && draftPreview && dragState?.selected === id ? { ...saved, state: draftPreview } : saved;
  }
  const state = workingState();
  if (draftEntityCache?.history === history && draftEntityCache.state === state && draftEntityCache.parentId === history.baseId && draftEntityCache.number === history.nextVersion) return draftEntityCache.item;
  const item = { id: "draft", name: "Version " + history.nextVersion + " (unsaved)", color: Versions.color(history.nextVersion), state,
    reason: "Unsaved edits based on " + history.get(history.baseId).name, parentId: history.baseId,
    changes: Versions.changes(history.get(history.baseId).state, state), createdAt: null };
  draftEntityCache = { history, state, parentId: history.baseId, number: history.nextVersion, item };
  return item;
}
function showDraft() { return Boolean(history && (selectedVersionId === "draft" || history.dirty())); }
function entities() { return history ? showDraft() ? [...history.versions, entity("draft")] : history.versions : []; }
function curveEntities() { if (!history) return []; const saved = history.versions.map(item => entity(item.id));
  return showDraft() ? [...saved, { id: "draft", color: Versions.color(history.nextVersion), state: workingState() }] : saved; }
function editable() { return Boolean(history && selectedVersionId === "draft"); }
function colorButton(button, color) { button.style.backgroundColor = color; button.style.borderColor = color; button.style.color = "#fff"; }
function bufferFromRendered(rendered) {
  const buffer = context().createBuffer(rendered.channels.length, rendered.channels[0].length, rendered.sampleRate);
  rendered.channels.forEach((data, c) => buffer.copyToChannel(data, c)); return buffer;
}
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels, block = channels * 2, bytes = buffer.length * block;
  const output = new ArrayBuffer(44 + bytes), view = new DataView(output);
  function text(at, value) { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); }
  text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * block, true);
  view.setUint16(32, block, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) {
    const sample = clamp(data[c][i], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Blob([output], { type: "audio/wav" });
}

function cacheAudio(id, buffer) {
  if (id === "original" || id === "draft") return;
  audioCache.delete(id); audioCache.set(id, buffer);
  while (audioCache.size > 3) audioCache.delete(audioCache.keys().next().value);
}
function stopPlayback() {
  ++playbackToken; sequencePlan = null; sequencePreparing = false; $("audioPlayer").pause();
  $("audioPlayer").removeAttribute("src"); $("audioPlayer").load();
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = null; playingId = null; preparedId = null;
  $("playbackLabel").textContent = "Playback stopped"; return playbackToken;
}
function wavBlob(id, buffer) {
  if (id !== "draft" && wavBlobCache.has(id)) {
    const cached = wavBlobCache.get(id); wavBlobCache.delete(id); wavBlobCache.set(id,cached); return cached;
  }
  const blob = encodeWav(buffer);
  if (id !== "draft" && blob.size <= 24 * 1024 * 1024) {
    wavBlobCache.set(id,blob);
    while (wavBlobCache.size > 2) wavBlobCache.delete(wavBlobCache.keys().next().value);
  }
  return blob;
}
function prepareBuffer(buffer, id, range = null) {
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  const originalState = history?.get("original")?.state;
  const rawOriginal = !range && originalFileUrl && originalState && Versions.equal(entity(id)?.state,originalState);
  activeAudioUrl = rawOriginal ? null : URL.createObjectURL(range ? encodeWav(bufferFromRendered(Versions.segment(buffer,range))) : wavBlob(id,buffer));
  preparedId = id; playbackOffset = range?.start || 0; playbackProgress = playbackOffset;
  $("audioPlayer").src = rawOriginal ? originalFileUrl : activeAudioUrl; $("audioPlayer").load();
  $("trackStart").textContent = timeLabel(playbackOffset); $("trackEnd").textContent = timeLabel(range?.end || buffer.duration);
}
async function renderWorking(invalidatePlayback = true) {
  if (!history) return false;
  const token = ++renderToken, epoch = sessionEpoch, state = Versions.clone(history.working), activeSource = source;
  if (invalidatePlayback) stopPlayback();
  workingBuffer = null; renderedSignature = ""; rendering = true; $("sourceStatus").textContent = "Rendering edited audio…"; renderUI();
  const promise = (async () => {
    try {
      const result = await Engine.renderCurve(activeSource, state, { cancelled: () => token !== renderToken || epoch !== sessionEpoch,
        progress: value => { if (token === renderToken) $("sourceStatus").textContent = "Rendering edited audio · " + Math.round(value * 100) + "%"; } });
      if (token !== renderToken || epoch !== sessionEpoch) return false;
      workingBuffer = bufferFromRendered(result); renderedSignature = signature(state); rendering = false;
      renderUI(); return true;
    } catch (error) {
      if (token !== renderToken || epoch !== sessionEpoch || error.name === "AbortError") return false;
      rendering = false; workingBuffer = null; tell("Audio rendering failed: " + error.message + " Use Undo or try Play again."); renderUI(); return false;
    }
  })();
  workingRender = promise; return promise;
}
async function getBuffer(id) {
  if (!history) throw new Error("Import audio first.");
  if (id === "original") return originalBuffer;
  if (id === "draft") {
    if (rendering && workingRender) await workingRender;
    if (!workingBuffer || renderedSignature !== signature(history.working)) await renderWorking(false);
    if (!workingBuffer) throw new Error("Edited audio is not available."); return workingBuffer;
  }
  if (audioCache.has(id)) { const audio = audioCache.get(id); cacheAudio(id, audio); return audio; }
  if (pendingRenders.has(id)) return pendingRenders.get(id);
  const version = history.get(id); if (!version) throw new Error("Saved version not found.");
  const epoch = sessionEpoch, activeSource = source;
  const state = version.state;
  const promise = Engine.renderCurve(activeSource, state, { cancelled: () => epoch !== sessionEpoch || history?.get(id)?.state !== state }).then(result => {
    if (epoch !== sessionEpoch) throw new Error("The audio source changed.");
    if (history?.get(id)?.state !== state) throw new Error("The version changed during audio rendering. Try playback again.");
    const buffer = bufferFromRendered(result); cacheAudio(id, buffer); return buffer;
  });
  pendingRenders.set(id, promise);
  try { return await promise; } finally { if (pendingRenders.get(id) === promise) pendingRenders.delete(id); }
}
async function loadFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return tell("This file exceeds 50 MB. Choose a smaller recording.");
  const token = ++loadingToken; tell("Reading " + file.name + " locally…");
  try {
    const ctx = context(); await ctx.resume();
    const decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
    if (token !== loadingToken) return false;
    if (!decoded.length || decoded.duration <= 0) throw new Error("No audio samples were found.");
    if (decoded.duration > 300) return tell("This recording is longer than 5 minutes. Choose a shorter file.");
    let nextFileUrl = null;
    if (typeof Blob !== "undefined" && file instanceof Blob) { try { nextFileUrl = URL.createObjectURL(file); } catch { /* Decoded PCM playback remains available. */ } }
    stopPlayback(); if (originalFileUrl) URL.revokeObjectURL(originalFileUrl);
    originalFileUrl = nextFileUrl; ++sessionEpoch; ++renderToken;
    sessionName = file.name; originalBuffer = decoded;
    source = { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)) };
    history = new Versions.VersionHistory(decoded.duration, sessionEpoch + ":" + file.name);
    selectedVersionId = "original"; selectedPointId = null;
    activeSelection = null; draftPreview = null; dragState = null; viewOffset = 0; autoFollow = true; rendering = false;
    audioCache.clear(); pendingRenders.clear(); scoreCache.clear(); wavBlobCache.clear(); draftScoreState = null; draftScoreResult = null; draftEntityCache = null;
    workingBuffer = decoded; renderedSignature = signature(history.working); currentComparison = null;
    $("dropZone").classList.add("hidden"); $("loadedFile").classList.remove("hidden"); $("replaceFileBtn").classList.remove("hidden");
    $("fileName").textContent = file.name; $("fileInfo").textContent = precise(decoded.duration) + " · " + decoded.numberOfChannels + " channels · " + (decoded.sampleRate / 1000).toFixed(1) + " kHz";
    if (originalFileUrl) prepareBuffer(decoded, "original"); else { $("trackStart").textContent = "00:00"; $("trackEnd").textContent = timeLabel(decoded.duration); } renderUI(); tell("Audio imported. Add a version to edit it directly. Original stays unchanged."); return true;
  } catch (error) { if (token === loadingToken) tell("Could not read this audio. Try a valid WAV or MP3. " + error.message); return false; }
}
$("audioFile").addEventListener("change", event => { loadFile(event.target.files?.[0]); event.target.value = ""; });
$("chooseFileBtn").addEventListener("click", () => $("audioFile").click());
$("replaceFileBtn").addEventListener("click", () => $("audioFile").click());
$("dropZone").addEventListener("click", event => { if (event.target.id !== "chooseFileBtn") $("audioFile").click(); });
$("dropZone").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("audioFile").click(); } });
$("dropZone").addEventListener("dragover", event => { event.preventDefault(); $("dropZone").classList.add("dragging"); });
$("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("dragging"));
$("dropZone").addEventListener("drop", event => { event.preventDefault(); $("dropZone").classList.remove("dragging"); loadFile(event.dataTransfer.files?.[0]); });
function selectVersion(id) {
  if (!entity(id)) return;
  if (selectedVersionId !== id && (preparedId || sequencePreparing)) stopPlayback();
  selectedVersionId = id; selectedPointId = null; renderUI();
}
function versionVisible(item) { return Boolean(item); }
function option(select, value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; select.append(node); }
function makeButton(text, action, className = "button") { const node = document.createElement("button"); node.type = "button"; node.className = className; node.textContent = text; node.addEventListener("click", action); return node; }
function renderVersionPicker() {
  const picker = $("versionPicker"); picker.replaceChildren();
  if (!history) { picker.disabled = true; return; }
  entities().forEach(item => option(picker, item.id, item.name)); picker.value = selectedVersionId; picker.disabled = false;
  picker.style.borderLeft = "4px solid " + entity(selectedVersionId).color;
  colorButton($("playSelectedBtn"), entity(selectedVersionId).color);
}
function renderVersionChanges() {
  const item = entity(selectedVersionId), list = $("versionChanges"); list.replaceChildren();
  $("versionChangesTitle").textContent = item?.id === "draft" ? "Version " + history.nextVersion + " unsaved changes" : item ? item.name + " changes" : "Changes";
  const changes = !item ? ["Import audio to begin."] : item.changes.length ? item.changes : [item.id === "original" ? "Original imported audio; unchanged." : "No changes from the selected base."];
  for (const text of changes) { const li = document.createElement("li"); li.textContent = text; list.append(li); }
}
function renderDownloads() {
  $("downloadList").replaceChildren(); if (!history) return;
  for (const item of entities()) {
    const row = document.createElement("div"); row.className = "download-row"; row.style.setProperty("--version-color",item.color);
    const name = document.createElement("span"); name.textContent = item.name;
    const button = makeButton("↓ Download WAV", () => downloadVersion(item.id), "button download-version");
    button.dataset.versionId = item.id; button.disabled = rendering || item.id === "draft" && !workingBuffer; colorButton(button,item.color);
    row.append(name,button); $("downloadList").append(row);
  }
}
function renderScores() {
  $("similarityList").replaceChildren(); if (!history) { currentComparison = null; return; }
  const original = history.get("original").state;
  for (const item of entities()) {
    let comparison = item.id === "original" ? {score:100,regions:[]} : item.id === "draft" ? (draftScoreState === item.state ? draftScoreResult : null) : scoreCache.get(item.id);
    if (!comparison) { comparison = Versions.compare(original,item.state); if (item.id === "draft") { draftScoreState = item.state; draftScoreResult = comparison; } else scoreCache.set(item.id,comparison); }
    if (item.id === selectedVersionId) currentComparison = comparison;
    const row = document.createElement("div"); row.className = "similarity-row" + (item.id === selectedVersionId ? " selected" : ""); row.style.setProperty("--version-color",item.color);
    const name = document.createElement("span"); name.textContent = item.name;
    const score = document.createElement("strong"); score.textContent = comparison.score.toFixed(1) + "%";
    row.append(name,score); $("similarityList").append(row);
  }
}
function renderPartialScores() {
  const list = $("partialSimilarityList"); list.replaceChildren();
  const range = segmentRange();
  $("partialRange").textContent = range ? "Selected: " + precise(range.start) + "–" + precise(range.end) + " · edit-parameter agreement" : "To see a segment score, drag across an empty area of the curve, or hold Shift and drag across a control point.";
  if (!history || !range) return;
  const key = range.start.toFixed(4) + ":" + range.end.toFixed(4);
  if (key !== partialScoreKey) { partialScoreKey = key; partialScoreResults.clear(); }
  const original = history.get("original").state;
  for (const item of entities()) {
    const cached = partialScoreResults.get(item.id);
    const result = cached?.state === item.state ? cached.result : Versions.compare(original, item.state, 0.02, range);
    if (!cached || cached.state !== item.state) partialScoreResults.set(item.id, { state: item.state, result });
    const row = document.createElement("div"); row.className = "similarity-row" + (item.id === selectedVersionId ? " selected" : ""); row.style.setProperty("--version-color", item.color);
    const name = document.createElement("span"); name.textContent = item.name;
    const score = document.createElement("strong"); score.textContent = result.score === null ? "—" : result.score.toFixed(1) + "%";
    row.append(name, score); list.append(row);
  }
}
function segmentRange() {
  if (activeSelection && activeSelection.end - activeSelection.start >= 0.025) return {start:activeSelection.start,end:activeSelection.end};
  return null;
}
function renderSegmentButtons() {
  $("segmentPlayList").replaceChildren();
  const range = segmentRange(); $("playAllSegmentsBtn").disabled = !history || !range || rendering || sequencePreparing;
  if (!history || !range) return;
  for (const item of entities()) {
    const button = makeButton("▶ " + item.name, () => playVersion(item.id,range), "button version-play");
    button.dataset.versionId = item.id; colorButton(button,item.color); button.disabled = rendering;
    $("segmentPlayList").append(button);
  }
}
function renderUI() {
  const loaded = Boolean(history), canEdit = loaded && selectedVersionId !== "original" && !rendering && !draftPreview;
  $("emptyState").classList.toggle("hidden", loaded);
  if (!rendering) $("sourceStatus").textContent = loaded ? (history.versions.length - 1) + " saved versions · " + history.working.points.length + " control points" : "Waiting for audio";
  $("playSelectedBtn").disabled = !loaded || rendering;
  $("pausePlaybackBtn").disabled = !loaded || $("audioPlayer").paused;
  $("saveVersionBtn").disabled = !loaded || savingVersion || Boolean(dragState) || Boolean(draftPreview);
  $("saveVersionBtn").textContent = savingVersion ? "Saving…" : "＋ Add version";
  $("deleteVersionBtn").disabled = !loaded || rendering || selectedVersionId === "original" || selectedVersionId === "draft";
  $("undoBtn").disabled = !loaded || !history.undoStack.length; $("redoBtn").disabled = !loaded || !history.redoStack.length;
  $("seekControl").disabled = !loaded; $("zoomControl").disabled = !loaded;
  const range = Boolean(segmentRange());
  $("selectionLabel").textContent = range ? "Selected: " + precise(activeSelection.start) + "–" + precise(activeSelection.end) : "Drag an empty area or hold Shift while dragging to select a segment";
  $("clearSelectionBtn").disabled = !activeSelection;
  const point = loaded && entity(selectedVersionId).state.points.find(p => p.id === selectedPointId);
  $("pitchControl").disabled = !point || !canEdit; $("resetPointBtn").disabled = !point || !canEdit;
  $("pitchControl").value = point?.value || 0; $("pitchValue").textContent = pitchText(point?.value || 0);
  $("selectedPointLabel").textContent = point ? precise(point.time / entity(selectedVersionId).state.settings.speed) + " · " + pitchText(point.value) : loaded ? "Click or drag a curve point" : "No point selected";
  for (const id of ["volumeControl","speedControl"]) $(id).disabled = !loaded || rendering;
  if (loaded) {
    const state = entity(selectedVersionId).state;
    $("volumeControl").value = state.settings.volume; $("volumeValue").textContent = state.settings.volume + "%";
    $("speedControl").value = state.settings.speed; $("speedValue").textContent = state.settings.speed.toFixed(2) + "×";
  }
  renderVersionPicker(); renderVersionChanges(); renderDownloads(); renderScores(); renderPartialScores(); renderSegmentButtons(); drawTrack();
}

function geometry() {
  const rect = $("trackCanvas").getBoundingClientRect(), left = 48, top = 18, bottom = 25;
  const end = history ? Math.max(...curveEntities().map(item => Versions.duration(item.state))) : 1;
  const requested = Number($("zoomControl").value), span = requested > 0 ? Math.min(end, requested) : end;
  const maxOffset = Math.max(0, end - span); viewOffset = Engine.clamp(viewOffset, 0, maxOffset);
  const width = Math.max(1, rect.width - left - 12), height = Math.max(1, rect.height - top - bottom);
  return { rect, left, top, bottom, width, height, end, span, maxOffset, offset: viewOffset, px: width / Math.max(0.001, span), y: value => top + (12 - value) / 24 * height };
}
function firstPointAt(points, time) {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (points[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo;
}
function visiblePoints(state, g) {
  const points = state.points, speed = state.settings.speed;
  const spacing = points.length > 1 ? (points[1].time - points[0].time) / speed * g.px : 10;
  const stride = Math.max(1, Math.ceil(9 / Math.max(0.001, spacing)));
  const result = [], start = firstPointAt(points, (g.offset - 0.01) * speed), end = (g.offset + g.span + 0.01) * speed;
  for (let i = start; i < points.length && points[i].time <= end; i++) if (i % stride === 0 || points[i].id === selectedPointId || i === points.length - 1) result.push(points[i]);
  return result;
}
function drawTrack() {
  const canvas = $("trackCanvas"), rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  canvas.style.width = "100%";
  const dpr = Math.min(window.devicePixelRatio || 1, 2), width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d"); if (resized) ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
  const g = geometry();
  $("trackPan").disabled = !history || g.maxOffset < 0.000001; $("trackPan").value = g.maxOffset ? Math.round(g.offset / g.maxOffset * 1000) : 0;
  $("panLeftBtn").disabled = !history || g.offset < 0.000001; $("panRightBtn").disabled = !history || g.offset >= g.maxOffset - 0.000001;
  $("viewRange").textContent = precise(g.offset) + " – " + precise(g.offset + g.span);
  if (!history) return;
  ctx.fillStyle = "#fbfcfd"; ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.width, g.height); ctx.clip();
  for (const region of currentComparison?.regions || []) {
    const x = g.left + (region.start - g.offset) * g.px, end = g.left + (region.end - g.offset) * g.px;
    if (end < g.left || x > g.left + g.width) continue;
    ctx.fillStyle = region.status === "modified" ? "#f0bc822b" : "#b7c3ca15"; ctx.fillRect(x, g.top, end - x, g.height);
    if (region.status === "modified") { ctx.fillStyle = "#d5904d"; ctx.fillRect(x, g.top, end - x, 4); }
  }
  if (activeSelection) {
    const x = g.left + (activeSelection.start - g.offset) * g.px, end = g.left + (activeSelection.end - g.offset) * g.px;
    ctx.fillStyle = "#53b78c23"; ctx.fillRect(x, g.top, end - x, g.height);
    ctx.strokeStyle = "#337f64"; ctx.lineWidth = 1;
    for (const at of [x, end]) { ctx.beginPath(); ctx.moveTo(at, g.top); ctx.lineTo(at, g.top + g.height); ctx.stroke(); }
  }
  for (let value = -12; value <= 12; value += 2) { ctx.strokeStyle = value === 0 ? "#d1d9df" : "#edf0f3"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.left, g.y(value)); ctx.lineTo(g.left + g.width, g.y(value)); ctx.stroke(); }
  const tick = Math.max(0.1, 10 ** Math.floor(Math.log10(Math.max(0.1, g.span / 7)))) * (g.span / 7 >= 2 ? 2 : 1);
  for (let t = Math.ceil(g.offset / tick) * tick; t <= g.offset + g.span; t += tick) { const x = g.left + (t - g.offset) * g.px; ctx.strokeStyle = "#e8edf0"; ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.top + g.height); ctx.stroke(); }
  const lines = curveEntities().filter(versionVisible).sort((a, b) => Number(a.id === selectedVersionId) - Number(b.id === selectedVersionId));
  // Original is a thick grey underlay, visible even when another curve is identical.
  lines.sort((a, b) => a.id === "original" ? -1 : b.id === "original" ? 1 : 0);
  for (const item of lines) {
    const state = item.state, speed = state.settings.speed, points = state.points;
    ctx.globalAlpha = item.id === "original" || item.id === selectedVersionId || item.id === playingId ? 1 : 0.28;
    ctx.strokeStyle = item.color; ctx.lineWidth = item.id === "original" ? 6 : item.id === playingId ? 4 : item.id === selectedVersionId ? 3 : 1.8;
    ctx.beginPath(); let started = false;
    for (let i = Math.max(1, firstPointAt(points, g.offset * speed)); i < points.length; i++) {
      const a = points[i - 1], b = points[i], ta = a.time / speed, tb = b.time / speed;
      if (ta > g.offset + g.span) break;
      if (tb < g.offset) continue;
      const x1 = g.left + (ta - g.offset) * g.px, x2 = g.left + (tb - g.offset) * g.px;
      if (!started) { ctx.moveTo(x1, g.y(a.value)); started = true; }
      ctx.bezierCurveTo(x1 + (x2 - x1) / 3, g.y(a.value), x2 - (x2 - x1) / 3, g.y(b.value), x2, g.y(b.value));
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (history) {
    const state = selectedVersionId === "draft" ? workingState() : entity(selectedVersionId).state, color = entity(selectedVersionId).color;
    for (const point of visiblePoints(state, g)) {
      const x = g.left + (point.time / state.settings.speed - g.offset) * g.px, y = g.y(point.value);
      ctx.beginPath(); ctx.arc(x, y, point.id === selectedPointId ? 5 : 3, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
      if (point.id === selectedPointId) {
        const text = pitchText(point.value), tx = Engine.clamp(x - 30, g.left + 2, g.left + g.width - 135), ty = Engine.clamp(y - 17, g.top + 15, g.top + g.height - 5);
        ctx.fillStyle = "#fff"; ctx.fillRect(tx - 3, ty - 12, 138, 17); ctx.fillStyle = color; ctx.font = "11px Segoe UI,sans-serif"; ctx.fillText(text, tx, ty);
      }
    }
  }
  if (preparedId && playbackProgress >= g.offset && playbackProgress <= g.offset + g.span) { const x = g.left + (playbackProgress - g.offset) * g.px; ctx.strokeStyle = "#d56058"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.top + g.height); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = "#6d7e89"; ctx.font = "10px Segoe UI,sans-serif";
  for (const value of [-12, -6, 0, 6, 12]) ctx.fillText((value > 0 ? "+" : "") + value + " st", 3, g.y(value) + 3);
  ctx.font = "9px monospace";
  for (let t = Math.ceil(g.offset / tick) * tick; t <= g.offset + g.span; t += tick) { const x = g.left + (t - g.offset) * g.px; ctx.fillText(t.toFixed(g.span < 5 ? 1 : 0) + "s", Math.min(g.left + g.width - 28, x + 2), rect.height - 7); }
}
function pointerTime(event, g = geometry()) { return Engine.clamp(g.offset + (event.clientX - g.rect.left - g.left) / g.px, 0, g.end); }
$("trackCanvas").addEventListener("pointerdown", event => {
  if (!history || rendering) return;
  stopPlayback(); const g = geometry(), x = event.clientX - g.rect.left, y = event.clientY - g.rect.top;
  $("trackCanvas").setPointerCapture(event.pointerId);
  if (!event.shiftKey) {
    const selectedState = entity(selectedVersionId).state, time = pointerTime(event, g);
    const at = firstPointAt(selectedState.points, time * selectedState.settings.speed);
    const point = [selectedState.points[Math.max(0, at - 1)], selectedState.points[Math.min(selectedState.points.length - 1, at)]]
      .filter(Boolean).sort((a, b) => Math.abs(a.time / selectedState.settings.speed - time) - Math.abs(b.time / selectedState.settings.speed - time))[0];
    const onSelectedCurve = x >= g.left && x <= g.left + g.width && time <= Versions.duration(selectedState) && point && Math.abs(g.y(Engine.curveValue(selectedState.points, time * selectedState.settings.speed)) - y) <= 11;
    if (onSelectedCurve) {
      if (!editable() && history.dirty()) { tell("Save the unsaved version before starting another edit."); return; }
      const editState = selectedVersionId === "draft" ? history.working : selectedState;
      const editTime = point.time / selectedState.settings.speed * editState.settings.speed;
      const closest = editState.points.reduce((nearest, item) => Math.abs(item.time - editTime) < Math.abs(nearest.time - editTime) ? item : nearest);
      selectedPointId = point.id;
      const index = editState.points.findIndex(p => p.id === closest.id), points = editState.points;
      activeSelection = { start: points[Math.max(0, index - 1)].time / editState.settings.speed, end: points[Math.min(points.length - 1, index + 1)].time / editState.settings.speed };
      dragState = { type: "point", g, y, index, before: Versions.clone(editState), value: point.value, selected: selectedVersionId };
      renderUI(); return;
    }
  }
  if (!event.shiftKey) {
    const time = pointerTime(event, g);
    const nearest = curveEntities().filter(item => versionVisible(item) && time <= Versions.duration(item.state)).map(item => ({ item, distance: Math.abs(g.y(Engine.curveValue(item.state.points, time * item.state.settings.speed)) - y) })).sort((a, b) => a.distance - b.distance || Number(b.item.id === selectedVersionId) - Number(a.item.id === selectedVersionId))[0];
    if (nearest && nearest.distance <= 9) { selectVersion(nearest.item.id); return; }
  }
  dragState = { type: "range", start: pointerTime(event, g), previous: activeSelection }; activeSelection = null; selectedPointId = null; drawTrack();
});
$("trackCanvas").addEventListener("pointermove", event => {
  if (!dragState) return;
  if (dragState.type === "range") { const end = pointerTime(event); activeSelection = { start: Math.min(end, dragState.start), end: Math.max(end, dragState.start) }; $("selectionLabel").textContent = "Selected: " + precise(activeSelection.start) + "–" + precise(activeSelection.end); drawTrack(); return; }
  const value = Engine.clamp(Math.round((dragState.value - (event.clientY - dragState.g.rect.top - dragState.y) * 24 / dragState.g.height) * 4) / 4, -12, 12);
  if (value === dragState.value && !draftPreview) return;
  if (!draftPreview) draftPreview = Versions.clone(dragState.before); draftPreview.points[dragState.index].value = value;
    selectedVersionId = dragState.selected === "original" ? "draft" : dragState.selected;
  $("pitchValue").textContent = pitchText(value); $("pitchControl").value = value; $("selectedPointLabel").textContent = "Preview · " + pitchText(value);
  $("saveVersionBtn").disabled = true; drawTrack();
});
$("trackCanvas").addEventListener("pointerup", async () => {
  const drag = dragState; dragState = null;
  if (drag?.type === "point") {
    const next = draftPreview; draftPreview = null;
    if (next && drag.selected === "original" && !Versions.equal(next, history.get("original").state)) {
      history.checkout("original"); selectedVersionId = "draft"; selectedPointId = history.working.points[drag.index].id;
      workingBuffer = originalBuffer; renderedSignature = signature(history.working);
    }
    if (next && drag.selected !== "draft" && drag.selected !== "original") {
      try { if (!await applySaved(drag.selected, next, "Drag pitch control point")) renderUI(); }
      catch (error) { tell(error.message); renderUI(); }
    } else if (next && selectedVersionId === "draft" && history.apply(next, "Drag pitch control point")) { renderUI(); if (await renderWorking()) tell("Pitch adjustment applied. Add version to save it."); }
    else renderUI();
  } else if (drag?.type === "range") { if (!activeSelection || activeSelection.end - activeSelection.start < 0.025) activeSelection = null; renderUI(); }
});
$("trackCanvas").addEventListener("pointercancel", () => {
  if (dragState?.type === "point") selectedVersionId = dragState.selected;
  else if (dragState?.type === "range") activeSelection = dragState.previous;
  dragState = null; draftPreview = null; renderUI();
});
async function applyWorking(next, action) {
  if (!history || !history.apply(next, action)) return false;
  selectedVersionId = "draft";
  renderUI(); return renderWorking();
}
async function applySaved(id, next, action) {
  if (!history || !history.amend(id, next, action)) return false;
  selectedVersionId = id; draftPreview = null;
  audioCache.delete(id); pendingRenders.delete(id); scoreCache.delete(id); wavBlobCache.delete(id); partialScoreResults.delete(id);
  renderUI();
  const done = await renderWorking();
  if (done && history?.get(id)?.state && renderedSignature === signature(history.get(id).state)) {
    cacheAudio(id, workingBuffer); tell(history.get(id).name + " updated and saved automatically.");
  }
  return done;
}
$("pitchControl").addEventListener("input", event => { $("pitchValue").textContent = pitchText(Number(event.target.value)); });
$("pitchControl").addEventListener("change", async event => {
  if (!history || selectedPointId === null) return;
  if (Number(event.target.value) === entity(selectedVersionId).state.points.find(point => point.id === selectedPointId)?.value) return;
  const id = selectedVersionId, next = Versions.clone(entity(id).state);
  next.points.find(p => p.id === selectedPointId).value = Number(event.target.value);
  try { if (!await (id === "draft" ? applyWorking(next, "Set point pitch adjustment") : applySaved(id, next, "Set point pitch adjustment"))) renderUI(); }
  catch (error) { tell(error.message); renderUI(); }
});
$("resetPointBtn").addEventListener("click", async () => {
  if (!history || selectedPointId === null) return;
  const id = selectedVersionId, next = Versions.clone(entity(id).state);
  next.points.find(p => p.id === selectedPointId).value = 0;
  try { if (!await (id === "draft" ? applyWorking(next, "Reset point") : applySaved(id, next, "Reset point"))) renderUI(); }
  catch (error) { tell(error.message); renderUI(); }
});
$("clearSelectionBtn").addEventListener("click", () => { activeSelection = null; renderUI(); });
async function setting(key, value) {
  if (!history || entity(selectedVersionId).state.settings[key] === value) return;
  if (selectedVersionId !== "draft" && selectedVersionId !== "original") {
    const id = selectedVersionId, state = Versions.clone(entity(id).state); state.settings[key] = value;
    try { if (!await applySaved(id, state, "Change " + key)) renderUI(); }
    catch (error) { renderUI(); tell(error.message); }
    return;
  }
  if (selectedVersionId !== "draft") {
    if (history.dirty()) { renderUI(); tell("Save the unsaved version before starting another edit."); return; }
    stopPlayback(); history.checkout("original"); selectedVersionId = "draft"; selectedPointId = null;
    workingBuffer = originalBuffer; renderedSignature = signature(history.working);
  }
  const state = Versions.clone(history.working); state.settings[key] = value;
  try { if (!await applyWorking(state, "Change " + key)) renderUI(); } catch (error) { tell(error.message); }
}
$("volumeControl").addEventListener("input", event => { $("volumeValue").textContent = event.target.value + "%"; });
$("volumeControl").addEventListener("change", event => setting("volume", Number(event.target.value)));
$("speedControl").addEventListener("input", event => { $("speedValue").textContent = Number(event.target.value).toFixed(2) + "×"; });
$("speedControl").addEventListener("change", event => setting("speed", Number(event.target.value)));
async function saveVersion() {
  if (!history || savingVersion || dragState || draftPreview) return null;
  const activeHistory = history, epoch = sessionEpoch;
  savingVersion = true; renderUI();
  try {
    if (rendering && workingRender && !await workingRender) { tell("Audio rendering did not finish. The version was not saved; try Add version again."); return null; }
    if (history !== activeHistory || epoch !== sessionEpoch) return null;
    if (selectedVersionId === "draft" || history.dirty()) {
      if (!workingBuffer || renderedSignature !== signature(history.working)) {
        if (!await renderWorking()) { tell("Audio rendering failed. The version was not saved."); return null; }
      }
    } else {
      stopPlayback(); history.checkout("original");
      workingBuffer = originalBuffer; renderedSignature = signature(history.working);
    }
    if (history !== activeHistory || epoch !== sessionEpoch) return null;
    const saved = history.save("Added version", null, history.baseId, true);
    if (workingBuffer) cacheAudio(saved.id, workingBuffer);
    stopPlayback(); selectedVersionId = saved.id; selectedPointId = null;
    renderUI(); tell(saved.name + " saved. Future new versions start from Original."); return saved;
  } finally { savingVersion = false; renderUI(); }
}
$("saveVersionBtn").addEventListener("click", saveVersion);
function deleteSelectedVersion() {
  if (!history || rendering || selectedVersionId === "original" || selectedVersionId === "draft") return false;
  const id = selectedVersionId, wasBase = history.baseId === id, wasDirty = history.dirty();
  stopPlayback(); const removed = history.remove(id);
  audioCache.delete(id); pendingRenders.delete(id); scoreCache.delete(id); wavBlobCache.delete(id); partialScoreResults.delete(id);
  if (wasBase && !wasDirty) { workingBuffer = originalBuffer; renderedSignature = signature(history.working); }
  selectedVersionId = history.dirty() ? "draft" : "original"; selectedPointId = null;
  renderUI(); tell(removed.name + " deleted. Original and other saved versions remain available."); return true;
}
$("deleteVersionBtn").addEventListener("click", deleteSelectedVersion);
async function navigateHistory(direction) {
  if (!history?.[direction]()) return;
  stopPlayback(); audioCache.clear(); pendingRenders.clear(); scoreCache.clear(); wavBlobCache.clear(); partialScoreResults.clear();
  selectedVersionId = history.dirty() ? "draft" : history.baseId; selectedPointId = null;
  renderUI(); await renderWorking();
  if (selectedVersionId !== "draft" && selectedVersionId !== "original" && workingBuffer) cacheAudio(selectedVersionId, workingBuffer);
}
$("undoBtn").addEventListener("click", () => navigateHistory("undo"));
$("redoBtn").addEventListener("click", () => navigateHistory("redo"));
$("versionPicker").addEventListener("change", event => selectVersion(event.target.value));
$("zoomControl").addEventListener("change", () => { autoFollow = false; drawTrack(); });
$("trackPan").addEventListener("input", event => { autoFollow = false; const g = geometry(); viewOffset = g.maxOffset * Engine.clamp(Number(event.target.value) / 1000, 0, 1); drawTrack(); });
for (const [id, direction] of [["panLeftBtn", -1], ["panRightBtn", 1]]) $(id).addEventListener("click", () => { const g = geometry(); autoFollow = false; viewOffset = Engine.clamp(g.offset + g.span * 0.8 * direction, 0, g.maxOffset); drawTrack(); });
async function playVersion(id, range = null) {
  if (!entity(id)) return;
  const token = stopPlayback(), epoch = sessionEpoch;
  $("playbackLabel").textContent = "Preparing " + entity(id).name + "…";
  try {
    const buffer = await getBuffer(id); if (token !== playbackToken || epoch !== sessionEpoch) return;
    prepareBuffer(buffer, id, range); selectedVersionId = id; playingId = id; autoFollow = true;
    $("playbackLabel").textContent = "Playing " + entity(id).name + (range ? " · " + precise(range.start) + "–" + precise(range.end) : " · full version");
    renderUI(); await $("audioPlayer").play();
  } catch (error) { if (token === playbackToken) tell("Playback failed: " + error.message + ". Try the native Play control or another file."); }
}
$("playSelectedBtn").addEventListener("click", () => playVersion(selectedVersionId));
$("pausePlaybackBtn").addEventListener("click", () => { $("audioPlayer").pause(); $("playbackLabel").textContent = preparedId ? "Paused " + entity(preparedId).name : "Playback stopped"; renderUI(); });
async function playSequence(range) {
  if (!history || !range || sequencePreparing) return;
  const items = entities().map(item => ({ id: item.id, name: item.name }));
  const token = stopPlayback(), epoch = sessionEpoch;
  sequencePreparing = true; $("playbackLabel").textContent = "Preparing all selected segments…"; renderUI();
  try {
    const slices = [];
    for (const item of items) {
      const buffer = await getBuffer(item.id);
      if (token !== playbackToken || epoch !== sessionEpoch) return;
      slices.push(Versions.segment(buffer, range));
    }
    const sampleRate = slices[0].sampleRate, channels = Math.max(...slices.map(slice => slice.channels.length));
    if (slices.some(slice => slice.sampleRate !== sampleRate)) throw new Error("Versions have different sample rates.");
    const frames = slices.reduce((sum, slice) => sum + slice.channels[0].length, 0);
    if (frames * channels * 4 > 96 * 1024 * 1024) throw new Error("Select a shorter segment for smooth sequential listening.");
    const combined = context().createBuffer(channels, frames, sampleRate), plan = [];
    let offset = 0;
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i], start = offset;
      const edge = Math.min(Math.floor(sampleRate * 0.005), Math.floor(slice.channels[0].length / 4));
      for (let channel = 0; channel < channels; channel++) {
        const output = combined.getChannelData(channel), input = slice.channels[Math.min(channel, slice.channels.length - 1)];
        output.set(input, offset);
        for (let frame = 0; frame < edge; frame++) {
          if (i > 0) output[offset + frame] *= frame / edge;
          if (i < slices.length - 1) output[offset + input.length - 1 - frame] *= frame / edge;
        }
      }
      offset += slice.channels[0].length;
      plan.push({ id: items[i].id, name: items[i].name, start: start / sampleRate, end: offset / sampleRate });
    }
    if (token !== playbackToken || epoch !== sessionEpoch) return;
    activeAudioUrl = URL.createObjectURL(encodeWav(combined));
    sequencePlan = { items: plan, range };
    sequencePreparing = false; preparedId = plan[0].id; playingId = preparedId; selectedVersionId = preparedId;
    playbackOffset = range.start; playbackProgress = range.start; autoFollow = true;
    $("audioPlayer").src = activeAudioUrl; $("audioPlayer").load();
    $("trackStart").textContent = timeLabel(range.start); $("trackEnd").textContent = timeLabel(range.end);
    $("playbackLabel").textContent = "Playing " + plan[0].name + " · " + precise(range.start) + "–" + precise(range.end);
    renderUI(); await $("audioPlayer").play();
  } catch (error) { if (token === playbackToken) tell("Sequential playback failed: " + error.message); }
  finally { if (token === playbackToken && sequencePreparing) { sequencePreparing = false; renderUI(); } }
}
$("playAllSegmentsBtn").addEventListener("click", () => playSequence(segmentRange()));
function updateSequencePosition() {
  if (!sequencePlan) return;
  const time = $("audioPlayer").currentTime;
  const item = sequencePlan.items.find(entry => time < entry.end - 0.000001) || sequencePlan.items.at(-1);
  playbackOffset = sequencePlan.range.start;
  playbackProgress = sequencePlan.range.start + Math.max(0, Math.min(time - item.start, item.end - item.start));
  if (preparedId !== item.id) {
    preparedId = item.id; playingId = item.id; selectedVersionId = item.id;
    $("playbackLabel").textContent = "Playing " + item.name + " · " + precise(sequencePlan.range.start) + "–" + precise(sequencePlan.range.end);
    renderUI();
  }
}
$("audioPlayer").addEventListener("play", () => { if (preparedId) { updateSequencePosition(); selectedVersionId = preparedId; playingId = preparedId; autoFollow = true; renderUI(); } });
$("audioPlayer").addEventListener("pause", () => { if ($("audioPlayer").paused && !$("audioPlayer").ended && preparedId) $("playbackLabel").textContent = "Paused " + entity(preparedId).name; });
$("audioPlayer").addEventListener("ended", () => { $("playbackLabel").textContent = "Playback finished"; renderUI(); });
$("audioPlayer").addEventListener("timeupdate", () => {
  if (sequencePlan) updateSequencePosition(); else playbackProgress = playbackOffset + $("audioPlayer").currentTime;
  const duration = $("audioPlayer").duration || 0; $("seekControl").value = duration ? Math.round($("audioPlayer").currentTime / duration * 1000) : 0;
  $("trackStart").textContent = timeLabel(playbackProgress); $("trackEnd").textContent = timeLabel(sequencePlan ? sequencePlan.range.end : playbackOffset + duration);
  const g = geometry(); if (autoFollow && (playbackProgress < g.offset || playbackProgress > g.offset + g.span * 0.93)) viewOffset = Engine.clamp(playbackProgress - g.span * 0.2, 0, g.maxOffset); drawTrack();
});
$("audioPlayer").addEventListener("error", () => { if ($("audioPlayer").getAttribute("src")) tell("Audio playback failed. Try a version Play button or another file."); });
$("seekControl").addEventListener("input", event => { autoFollow = true; if (Number.isFinite($("audioPlayer").duration)) $("audioPlayer").currentTime = $("audioPlayer").duration * Number(event.target.value) / 1000; });
async function downloadVersion(id) {
  if (!history || !entity(id)) return;
  const epoch = sessionEpoch, name = entity(id).name;
  try {
    const buffer = await getBuffer(id); if (epoch !== sessionEpoch || id !== "draft" && !history?.get(id)) return;
    const url = URL.createObjectURL(wavBlob(id,buffer)), link = document.createElement("a"); link.href = url;
    link.download = sessionName.replace(/\.[^.]+$/, "") + "-" + name.toLowerCase().replace(/\s+/g, "-") + ".wav";
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1500);
    tell("Downloaded " + name + " as processed 16-bit PCM WAV audio.");
  } catch (error) { tell("Download failed: " + error.message); }
}
renderUI(); window.addEventListener("resize", drawTrack);
