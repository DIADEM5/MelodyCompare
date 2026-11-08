"use strict";

const $ = id => document.getElementById(id);
const Engine = window.MelodyAudio;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const DEFAULT_SETTINGS = { tempo: 96, speed: 1, volume: 100, fadeIn: false, fadeOut: false };
let audioContext = null, sourceMode = "upload", sessionName = "", sampleSource = null;
let originalBuffer = null, editedBuffer = null, originalUrl = null, editedUrl = null;
let originalNotes = [], editedNotes = [], originalSettings = { ...DEFAULT_SETTINGS }, settings = { ...DEFAULT_SETTINGS };
let acceptedRevision = null, initialRevision = null, selectedNoteId = null, activeSelection = null;
let undoStack = [], redoStack = [], nextNoteId = 1, dragState = null, trackOffsetBeats = 0, autoFollowTrack = true;
let renderVersion = 0, loadingVersion = 0, rendering = false, playbackProgress = 0, playbackVersion = "edited";
let latestAction = "No edits yet.", statusTimer = null;
const changeLog = [];

function context() {
  if (!AudioContextClass) throw new Error("Web Audio is unavailable. Please use a current version of Chrome or Edge.");
  if (!audioContext) audioContext = new AudioContextClass();
  return audioContext;
}
const clamp = Engine.clamp;
const copyNotes = notes => notes.map(note => ({ ...note }));
const copyRevision = revision => revision ? { notes: copyNotes(revision.notes), settings: { ...revision.settings } } : null;
const currentRevision = () => ({ notes: copyNotes(editedNotes), settings: { ...settings } });
const snapshot = () => ({ ...currentRevision(), accepted: copyRevision(acceptedRevision) });
const hasSession = () => initialRevision !== null;
const itemName = () => sourceMode === "upload" ? "Slice" : "Note";
function timeLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
const preciseTime = value => Number(value).toFixed(2) + "s";
function pitchLabel(pitch) {
  if (sourceMode === "upload") return (pitch - 60 > 0 ? "+" : "") + (pitch - 60) + " st";
  return NOTE_NAMES[((pitch % 12) + 12) % 12] + (Math.floor(pitch / 12) - 1);
}
function tell(message) {
  $("status").textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $("status").textContent = hasSession() ? "Your original is preserved. Edit, compare, and export when ready." : "Import local audio or create a scene melody to begin."; }, 6500);
}
function stateEqual(a, b) {
  if (!a || !b || a.notes.length !== b.notes.length || JSON.stringify(a.settings) !== JSON.stringify(b.settings)) return false;
  const map = new Map(b.notes.map(note => [note.id, note]));
  return a.notes.every(note => JSON.stringify(note) === JSON.stringify(map.get(note.id)));
}
function bufferFromRendered(rendered) {
  const buffer = context().createBuffer(rendered.channels.length, rendered.channels[0].length, rendered.sampleRate);
  rendered.channels.forEach((data, channel) => buffer.copyToChannel(data, channel));
  return buffer;
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
function replaceEditedBuffer(buffer) {
  editedBuffer = buffer;
  if (editedUrl) URL.revokeObjectURL(editedUrl);
  editedUrl = URL.createObjectURL(encodeWav(buffer));
  $("audioPlayer").src = editedUrl; $("audioPlayer").load();
  playbackProgress = 0; playbackVersion = "edited";
  $("seekControl").value = 0; $("trackStart").textContent = "00:00";
  $("trackEnd").textContent = timeLabel(buffer.duration);
}
function selectSourceTab(mode) {
  const generating = mode === "generate";
  $("uploadTab").classList.toggle("active", !generating); $("generateTab").classList.toggle("active", generating);
  $("uploadTab").setAttribute("aria-selected", String(!generating)); $("generateTab").setAttribute("aria-selected", String(generating));
  $("uploadSource").classList.toggle("hidden", generating); $("generateSource").classList.toggle("hidden", !generating);
}
$("uploadTab").addEventListener("click", () => selectSourceTab("upload"));
$("generateTab").addEventListener("click", () => selectSourceTab("generate"));

function appendLog(action, detail) {
  const entry = { number: changeLog.length + 1, action, detail, source: sessionName || "Workspace",
    time: new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour12: false }) };
  changeLog.push(entry);
  const li = document.createElement("li"), title = document.createElement("strong"), meta = document.createElement("small"), body = document.createElement("p");
  title.textContent = entry.action; meta.textContent = "#" + entry.number + " · " + entry.time + " · " + entry.source; body.textContent = entry.detail;
  li.append(title, meta, body); $("changeHistory").append(li);
  $("historyEmpty").classList.add("hidden"); $("changeCount").textContent = changeLog.length + " records";
  latestAction = action + ": " + detail;
}
function recordDifferences(action, before, after) {
  const beforeMap = new Map(before.notes.map(note => [note.id, note])), afterMap = new Map(after.notes.map(note => [note.id, note]));
  let count = 0;
  for (const [id, note] of beforeMap) {
    const next = afterMap.get(id);
    if (!next) { appendLog(action + " · " + itemName() + " " + id, "Deleted " + pitchLabel(note.pitch) + " at " + preciseTime(Engine.startSeconds(note, before.settings)) + "."); count++; continue; }
    const differences = [];
    if (note.pitch !== next.pitch) differences.push("pitch " + pitchLabel(note.pitch) + " → " + pitchLabel(next.pitch));
    const oldStart = Engine.startSeconds(note, before.settings), newStart = Engine.startSeconds(next, after.settings);
    const oldLength = Engine.lengthSeconds(note, before.settings), newLength = Engine.lengthSeconds(next, after.settings);
    if (Math.abs(oldStart - newStart) > 0.002) differences.push("start " + preciseTime(oldStart) + " → " + preciseTime(newStart));
    if (Math.abs(oldLength - newLength) > 0.002) differences.push("length " + preciseTime(oldLength) + " → " + preciseTime(newLength));
    if (note.sampleStart !== next.sampleStart || note.sampleEnd !== next.sampleEnd) differences.push("sample boundaries trimmed");
    if (differences.length) { appendLog(action + " · " + itemName() + " " + id, differences.join("; ") + "."); count++; }
  }
  for (const [id, note] of afterMap) if (!beforeMap.has(id)) {
    appendLog(action + " · " + itemName() + " " + id, "Added " + pitchLabel(note.pitch) + " at " + preciseTime(Engine.startSeconds(note, after.settings)) + ", length " + preciseTime(Engine.lengthSeconds(note, after.settings)) + "."); count++;
  }
  for (const key of ["volume", "speed", "fadeIn", "fadeOut", "tempo"]) if (before.settings[key] !== after.settings[key]) {
    const labels = { volume: "Volume (%)", speed: "Speed", fadeIn: "Fade in", fadeOut: "Fade out", tempo: "Tempo (BPM)" };
    appendLog(action, labels[key] + ": " + before.settings[key] + " → " + after.settings[key] + "."); count++;
  }
  if (!count) appendLog(action, "Revision decision recorded; no note or slice values changed.");
}
function pushUndo(before) {
  undoStack.push(before); if (undoStack.length > 40) undoStack.shift(); redoStack = [];
}
async function commitEdit(before, action) {
  if (stateEqual(before, currentRevision())) { updateUI(); return; }
  pushUndo(before); recordDifferences(action, before, currentRevision());
  activeSelection = null; updateUI();
  await renderCurrent();
}
async function renderCurrent() {
  if (!hasSession()) return false;
  const version = ++renderVersion, notes = copyNotes(editedNotes), controls = { ...settings };
  rendering = true; $("sourceStatus").textContent = "Rendering edited audio…"; updateUI();
  try {
    const rendered = await Engine.render(notes, sampleSource, controls, { cancelled: () => version !== renderVersion });
    if (version !== renderVersion) return false;
    replaceEditedBuffer(bufferFromRendered(rendered));
    rendering = false; updateUI(); return true;
  } catch (error) {
    if (version !== renderVersion || error.name === "AbortError") return false;
    rendering = false; editedBuffer = null;
    appendLog("Rendering failed", error.message); tell(error.message + " Use Undo or shorten the arrangement."); updateUI(); return false;
  }
}
async function restoreState(saved, action) {
  const before = snapshot();
  editedNotes = copyNotes(saved.notes); settings = { ...saved.settings }; acceptedRevision = copyRevision(saved.accepted);
  selectedNoteId = null; activeSelection = null;
  recordDifferences(action, before, currentRevision()); updateUI(); await renderCurrent();
}
$("undoBtn").addEventListener("click", async () => {
  if (!undoStack.length) return;
  redoStack.push(snapshot()); await restoreState(undoStack.pop(), "Undo"); tell("The last change was undone. Its history remains recorded.");
});
$("redoBtn").addEventListener("click", async () => {
  if (!redoStack.length) return;
  undoStack.push(snapshot()); await restoreState(redoStack.pop(), "Redo"); tell("The change was restored.");
});
$("resetBtn").addEventListener("click", async () => {
  if (!hasSession()) return;
  const before = snapshot(); editedNotes = copyNotes(initialRevision.notes); settings = { ...initialRevision.settings }; selectedNoteId = null;
  await commitEdit(before, "Reset to original"); tell("The edited version now matches the untouched original.");
});

function comparison() { return Engine.compare(originalNotes, editedNotes, originalSettings, settings); }
function renderFeedback() {
  if (!hasSession()) return;
  const result = comparison(), imported = sourceMode === "upload";
  $("similarityTitle").textContent = imported ? "Audio slice edit match" : "Overall melody similarity";
  $("similarityScore").textContent = result.score + "%";
  $("similarityCount").textContent = result.matches + " / " + result.total + " items unchanged";
  $("scoreBar").style.width = result.score + "%";
  $("similarityMethod").textContent = imported
    ? "Relative transposition, timing, length and sample boundaries are compared. This is an edit correspondence score, not detected melodic or perceptual similarity."
    : "Matching pitch, start time and length count as unchanged. The score is a simplified symbolic comparison, not a listening-test result.";
  const effects = [];
  if (settings.volume !== 100) effects.push("volume " + settings.volume + "%");
  if (settings.fadeIn) effects.push("2s fade in");
  if (settings.fadeOut) effects.push("2s fade out");
  if (settings.speed !== 1) effects.push("speed " + settings.speed.toFixed(2) + "×");
  $("feedbackExplanation").textContent = (imported
    ? "Imported audio uses real sample slices. All initial pitch labels are 0 st (no transposition); no absolute melody pitches have been detected. "
    : "Generated notes are compared with the original generated melody. ") +
    result.matches + " unchanged, " + result.changed + " changed, " + result.added + " added, " + result.removed + " deleted. " +
    "Score = unchanged items ÷ (original items + added items), rounded to a percentage. " +
    "Grey means unchanged; orange means changed or added." +
    (effects.length ? " Active audio effects: " + effects.join(", ") + ". Loudness and fades are not part of this score." : "");
  $("feedbackLatest").textContent = "Latest action — " + latestAction;
  const note = editedNotes.find(item => item.id === selectedNoteId), baseline = originalNotes.find(item => item.id === selectedNoteId);
  if (!note) {
    $("localFeedback").replaceChildren();
    const p = document.createElement("p"); p.textContent = result.changed + result.added + result.removed
      ? "Select a block for its current differences. The chronological history below preserves every committed edit."
      : "All current items match the original. Select a block for details.";
    $("localFeedback").append(p); return;
  }
  const same = Engine.sameItem(baseline, note, originalSettings, settings);
  const p = document.createElement("p");
  p.textContent = itemName() + " " + note.id + ": " + pitchLabel(note.pitch) + ", start " + preciseTime(Engine.startSeconds(note, settings)) + ", length " + preciseTime(Engine.lengthSeconds(note, settings)) + ". " +
    (!baseline ? "Added item; it has no original counterpart." : same ? "Same as original." :
      "Original: " + pitchLabel(baseline.pitch) + ", start " + preciseTime(Engine.startSeconds(baseline, originalSettings)) + ", length " + preciseTime(Engine.lengthSeconds(baseline, originalSettings)) + ".");
  $("localFeedback").replaceChildren(p);
}
function configurePitchControl() {
  $("notePitch").replaceChildren();
  const low = sourceMode === "upload" ? 48 : 55, high = sourceMode === "upload" ? 72 : 79;
  for (let pitch = high; pitch >= low; pitch--) {
    const option = document.createElement("option"); option.value = pitch; option.textContent = pitchLabel(pitch); $("notePitch").append(option);
  }
}
function updateUI() {
  const loaded = hasSession(), imported = sourceMode === "upload", selected = editedNotes.find(note => note.id === selectedNoteId);
  document.querySelectorAll(".note-legend").forEach(node => node.classList.toggle("hidden", !loaded));
  $("emptyState").classList.toggle("hidden", loaded);
  $("noteControls").classList.toggle("hidden", !loaded);
  $("uploadTools").classList.toggle("hidden", !loaded || !imported);
  $("viewOptions").classList.toggle("hidden", !loaded || !imported);
  if (loaded && imported) $("sliceInfo").textContent = editedNotes.length + " slices · original slices " + (originalBuffer.duration / originalNotes.length).toFixed(2) + "s each · use the view slider below";
  $("selectedNoteLabel").textContent = selected ? itemName() + " " + selected.id + " · " + pitchLabel(selected.pitch) : "No " + (imported ? "slice" : "note") + " selected";
  $("editTitle").textContent = imported && loaded ? "Audio slice editing" : "Note editing";
  $("pitchControlLabel").textContent = imported ? "Transpose" : "Pitch";
  $("notePitch").disabled = !selected; $("noteLength").disabled = !selected;
  $("duplicateNoteBtn").disabled = !selected; $("deleteNoteBtn").disabled = !selected; $("addNoteBtn").disabled = !loaded;
  $("suggestBtn").disabled = !loaded || !editedNotes.length;
  $("acceptBtn").disabled = !loaded || stateEqual(currentRevision(), acceptedRevision);
  $("rejectBtn").disabled = !loaded || stateEqual(currentRevision(), acceptedRevision);
  $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length;
  $("resetBtn").disabled = !loaded || stateEqual(currentRevision(), initialRevision);
  $("playOriginalBtn").disabled = !originalUrl; $("playEditedBtn").disabled = rendering || !editedBuffer;
  $("downloadBtn").disabled = rendering || !editedBuffer; $("seekControl").disabled = !originalUrl;
  $("volumeControl").value = settings.volume; $("volumeValue").textContent = settings.volume + "%";
  $("speedControl").value = settings.speed; $("speedValue").textContent = settings.speed.toFixed(2) + "×";
  $("fadeInBtn").setAttribute("aria-pressed", String(settings.fadeIn)); $("fadeOutBtn").setAttribute("aria-pressed", String(settings.fadeOut));
  const validRange = activeSelection && activeSelection.end - activeSelection.start > 0.02;
  $("keepSelectionBtn").disabled = !validRange; $("deleteSelectionBtn").disabled = !validRange;
  $("selectionLabel").textContent = validRange ? preciseTime(activeSelection.start) + " – " + preciseTime(activeSelection.end) : "Shift + drag on the track to select a time range";
  if (selected) {
    $("notePitch").value = selected.pitch;
    $("noteLength").querySelectorAll("[data-current]").forEach(node => node.remove());
    if (![...$("noteLength").options].some(option => Number(option.value) === selected.length)) {
      const option = document.createElement("option"); option.value = selected.length; option.textContent = selected.length.toFixed(2) + " beats (current)"; option.dataset.current = "true"; $("noteLength").append(option);
    }
    $("noteLength").value = selected.length;
  }
  if (loaded && !rendering) $("sourceStatus").textContent = imported ? "Imported audio · editable slices" : "Generated melody · editable notes";
  resizeTrackCanvas(); renderFeedback(); drawTrack();
}

async function startSession(mode, name, notes, buffer, source, controls) {
  ++renderVersion;
  $("audioPlayer").pause();
  sourceMode = mode; sessionName = name; sampleSource = source;
  settings = { ...controls }; originalSettings = { ...controls };
  originalNotes = copyNotes(notes); editedNotes = copyNotes(notes);
  initialRevision = currentRevision(); acceptedRevision = copyRevision(initialRevision);
  originalBuffer = buffer; selectedNoteId = null; activeSelection = null; undoStack = []; redoStack = []; trackOffsetBeats = 0; autoFollowTrack = true;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(encodeWav(originalBuffer)); replaceEditedBuffer(originalBuffer);
  rendering = false; configurePitchControl();
  $("trackTitle").textContent = mode === "upload" ? "Editable audio slices" : "Editable melody line";
  $("lineHelp").textContent = mode === "upload" ? "Drag slices to change pitch/time. Shift + drag selects a time range. Use the view slider below for later slices." : "Move blocks vertically for pitch and horizontally for time. Select one for length, duplicate or delete.";
  $("sourceCaveat").textContent = mode === "upload"
    ? "Each block is a real audio slice. Vertical position is relative transposition (0 st = unchanged), not a detected melody pitch. Pitch and length edits use a basic granular sampler and may introduce audible artifacts. Shift + drag on the slice track retains range editing."
    : "These blocks drive the same rule-generated melody you hear. Every committed change rebuilds the edited audio. No generative AI model is connected.";
  appendLog("Source loaded", mode === "upload" ? "Imported " + notes.length + " equal-time audio slices. All begin at 0 st; no pitch transcription is claimed." : "Generated " + notes.length + " notes. The original audio is preserved for comparison.");
  updateUI();
}
async function loadFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return tell("This file exceeds 50 MB. Choose a smaller audio file.");
  const token = ++loadingVersion; $("generateBtn").disabled = true;
  tell("Reading " + file.name + " locally…");
  try {
    const ctx = context(); await ctx.resume();
    const decoded = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
    if (token !== loadingVersion) return;
    if (decoded.duration > 300) return tell("This recording is longer than 5 minutes. Please choose a shorter file.");
    if (!decoded.length) throw new Error("No audio samples were found.");
    const controls = { ...DEFAULT_SETTINGS };
    const notes = Engine.splitSource(decoded.duration, controls.tempo, () => nextNoteId++);
    const source = { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c)) };
    await startSession("upload", file.name, notes, decoded, source, controls);
    $("loadedFile").classList.remove("hidden"); $("dropZone").classList.add("hidden");
    $("fileName").textContent = file.name; $("fileInfo").textContent = timeLabel(decoded.duration) + " · " + decoded.numberOfChannels + " channels · " + (decoded.sampleRate / 1000).toFixed(1) + " kHz";
    selectSourceTab("upload"); tell("Audio imported. You can now transpose, move, resize, copy, delete and suggest edits to its real audio slices.");
  } catch (error) { tell("Could not read this file. Try a valid WAV or MP3. " + error.message); }
  finally { if (token === loadingVersion) $("generateBtn").disabled = false; }
}
$("audioFile").addEventListener("change", event => { loadFile(event.target.files?.[0]); event.target.value = ""; });
$("chooseFileBtn").addEventListener("click", () => $("audioFile").click());
$("replaceFileBtn").addEventListener("click", () => $("audioFile").click());
$("dropZone").addEventListener("click", event => { if (event.target.id !== "chooseFileBtn") $("audioFile").click(); });
$("dropZone").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("audioFile").click(); } });
$("dropZone").addEventListener("dragover", event => { event.preventDefault(); $("dropZone").classList.add("dragging"); });
$("dropZone").addEventListener("dragleave", () => $("dropZone").classList.remove("dragging"));
$("dropZone").addEventListener("drop", event => { event.preventDefault(); $("dropZone").classList.remove("dragging"); loadFile(event.dataTransfer.files?.[0]); });

function hash(input) { let state = 2166136261; for (let i = 0; i < input.length; i++) state = Math.imul(state ^ input.charCodeAt(i), 16777619); return state >>> 0; }
function randomGenerator(seed) { let state = seed || 1; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function inferMood(prompt) {
  if ($("moodSelect").value !== "follow") return $("moodSelect").value;
  if (/sad|rain|lonely|雨|忧伤|悲伤/i.test(prompt)) return "sad";
  if (/night|dream|space|sea|夜|梦|海|星/i.test(prompt)) return "dreamy";
  if (/run|chase|energetic|运动|活力|追|紧张/i.test(prompt)) return "energetic";
  if (/sun|happy|morning|bright|阳光|快乐|早晨|明亮/i.test(prompt)) return "bright";
  return "calm";
}
function generateNotes(prompt, mood) {
  const random = randomGenerator(hash(prompt + mood + Date.now() + Math.random()));
  const scale = mood === "sad" ? [0, 2, 3, 5, 7, 8, 10] : mood === "dreamy" ? [0, 2, 5, 7, 9] : [0, 2, 4, 5, 7, 9, 11];
  const tonic = mood === "sad" ? 57 : 60; let previous = tonic + scale[2];
  return Array.from({ length: 8 }, (_, index) => {
    const choices = scale.map(step => tonic + step).filter(pitch => !["calm", "dreamy"].includes(mood) || Math.abs(pitch - previous) <= 5);
    let pitch = choices[Math.floor(random() * choices.length)] || previous;
    if (["bright", "energetic"].includes(mood) && random() > 0.63) pitch += 12;
    previous = pitch;
    return { id: nextNoteId++, pitch: clamp(pitch, 55, 79), start: index, length: 1 };
  });
}
async function generateFromPrompt() {
  const prompt = $("scenePrompt").value.trim();
  if (!prompt) { $("scenePrompt").focus(); return tell("Describe a scene first, for example a gentle melody on a rainy evening."); }
  const token = ++loadingVersion; $("generateBtn").disabled = true;
  try {
    context(); const mood = inferMood(prompt), notes = generateNotes(prompt, mood), controls = { ...DEFAULT_SETTINGS, tempo: Number($("tempoControl").value) };
    const result = await Engine.render(notes, null, controls, { cancelled: () => token !== loadingVersion });
    if (token !== loadingVersion) return;
    await startSession("generate", prompt, notes, bufferFromRendered(result), null, controls);
    $("loadedFile").classList.add("hidden"); $("dropZone").classList.remove("hidden");
    selectSourceTab("generate"); tell("Generated a " + mood + " melody. Drag its notes to change the audio.");
  } catch (error) { if (error.name !== "AbortError") tell("Generation failed: " + error.message); }
  finally { if (token === loadingVersion) $("generateBtn").disabled = false; }
}
$("generateBtn").addEventListener("click", generateFromPrompt);
$("scenePrompt").addEventListener("keydown", event => { if (event.key === "Enter" && !$("generateBtn").disabled) generateFromPrompt(); });
$("tempoControl").addEventListener("input", event => { $("tempoValue").textContent = event.target.value + " BPM"; });

function trackBeats() {
  return Math.max(sourceMode === "upload" ? 0.1 : 8, ...editedNotes.map(note => note.start + note.length));
}
function resizeTrackCanvas() {
  // The bitmap is always viewport-sized. Moving the view changes time offsets,
  // never the element width or the surrounding page layout.
  $("trackCanvas").style.width = "100%";
}
function geometry() {
  const rect = $("trackCanvas").getBoundingClientRect(), left = 45, top = 12, bottom = 22;
  const low = sourceMode === "upload" ? 48 : 55, high = sourceMode === "upload" ? 72 : 79;
  const beats = trackBeats(), plotW = Math.max(1, rect.width - left - 12), plotH = Math.max(1, rect.height - top - bottom);
  const minimumScale = sourceMode === "upload" && originalNotes.length ? 24 / originalNotes[0].length : plotW / 8;
  const beatW = Math.max(plotW / beats, minimumScale);
  const visibleBeats = Math.min(beats, plotW / beatW), maxOffset = Math.max(0, beats - visibleBeats);
  trackOffsetBeats = clamp(trackOffsetBeats, 0, maxOffset);
  return { rect, left, top, low, high, beats, plotW, plotH, bottom, beatW, visibleBeats, maxOffset,
    offset: trackOffsetBeats, rowH: plotH / (high - low + 1) };
}
function syncTrackNavigation(g = geometry()) {
  const loaded = hasSession();
  $("trackNavigation").classList.toggle("hidden", !loaded);
  $("trackPan").disabled = !loaded || g.maxOffset < 0.000001;
  $("trackPan").value = g.maxOffset ? Math.round(g.offset / g.maxOffset * 1000) : 0;
  $("panLeftBtn").disabled = !loaded || g.offset <= 0.000001;
  $("panRightBtn").disabled = !loaded || g.offset >= g.maxOffset - 0.000001;
  const beatSeconds = Engine.beatSeconds(settings);
  const range = timeLabel(g.offset * beatSeconds) + " – " + timeLabel((g.offset + g.visibleBeats) * beatSeconds);
  $("viewRange").textContent = range;
  $("trackPan").setAttribute("aria-valuetext", range);
}
function panTrack(direction) {
  if (!hasSession() || dragState) return;
  const g = geometry();
  autoFollowTrack = false;
  trackOffsetBeats = clamp(g.offset + direction * g.visibleBeats * 0.8, 0, g.maxOffset);
  drawTrack();
}
function followPlayhead() {
  if (!hasSession() || dragState || !autoFollowTrack) return;
  const g = geometry(), beat = playbackProgress / Engine.beatSeconds(settings);
  if (beat < g.offset || beat > g.offset + g.visibleBeats - g.visibleBeats * 0.08) {
    trackOffsetBeats = clamp(beat - g.visibleBeats * 0.25, 0, g.maxOffset);
  }
}
$("panLeftBtn").addEventListener("click", () => panTrack(-1));
$("panRightBtn").addEventListener("click", () => panTrack(1));
$("trackPan").addEventListener("input", event => {
  if (!hasSession() || dragState) return;
  const g = geometry();
  autoFollowTrack = false;
  trackOffsetBeats = g.maxOffset * clamp(Number(event.target.value) / 1000, 0, 1);
  drawTrack();
});
function drawTrack() {
  const canvas = $("trackCanvas"), rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
  const resized = canvas.width !== pixelWidth || canvas.height !== pixelHeight;
  if (resized) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const ctx = canvas.getContext("2d"); if (resized) ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
  syncTrackNavigation();
  if (!hasSession()) return;
  drawNotes(ctx);
}
function drawNotes(ctx) {
  const g = geometry(), height = g.rect.height, width = g.rect.width, right = g.left + g.plotW;
  ctx.fillStyle = "#f9fbfc"; ctx.fillRect(0, 0, width, height);
  for (let pitch = g.low; pitch <= g.high; pitch++) {
    const y = g.top + (g.high - pitch) * g.rowH;
    ctx.fillStyle = pitch % 12 === 0 ? "#f0f4f5" : "#fff"; ctx.fillRect(g.left, y, g.plotW, g.rowH);
    ctx.strokeStyle = "#e7ecee"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(right, y); ctx.stroke();
    if (sourceMode === "upload" ? (pitch - 60) % 6 === 0 : pitch % 12 === 0) {
      ctx.fillStyle = "#74828b"; ctx.font = "9px Segoe UI,sans-serif"; ctx.fillText(pitchLabel(pitch), 3, y + g.rowH * 0.75);
    }
  }
  const tick = Math.max(1, Math.ceil(70 / g.beatW));
  for (let beat = Math.ceil(g.offset / tick) * tick; beat <= g.offset + g.visibleBeats; beat += tick) {
    const x = g.left + (beat - g.offset) * g.beatW;
    ctx.strokeStyle = beat % 4 === 0 ? "#cbd5d9" : "#e5eaec"; ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, height - g.bottom); ctx.stroke();
    ctx.fillStyle = "#71808a"; ctx.font = "9px monospace";
    ctx.fillText(timeLabel(beat * Engine.beatSeconds(settings)), Math.min(right - 30, x + 3), height - 6);
  }
  if (activeSelection) {
    const x1 = clamp(g.left + (activeSelection.start / Engine.beatSeconds(settings) - g.offset) * g.beatW, g.left, right);
    const x2 = clamp(g.left + (activeSelection.end / Engine.beatSeconds(settings) - g.offset) * g.beatW, g.left, right);
    if (x2 > x1) {
      ctx.fillStyle = "#66be9c2a"; ctx.fillRect(x1, g.top, x2 - x1, g.plotH);
      ctx.strokeStyle = "#28966e"; ctx.lineWidth = 1;
      for (const x of [x1, x2]) { ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, height - g.bottom); ctx.stroke(); }
    }
  }
  const reference = new Map(originalNotes.map(note => [note.id, note]));
  for (const note of editedNotes) {
    const rawX = g.left + (note.start - g.offset) * g.beatW + 2;
    const rawEnd = rawX + Math.max(5, note.length * g.beatW - 4);
    if (rawEnd <= g.left || rawX >= right) continue;
    const x = Math.max(g.left, rawX), end = Math.min(right, rawEnd);
    const y = g.top + (g.high - note.pitch) * g.rowH + 1, w = end - x, h = Math.max(5, g.rowH - 2);
    const same = Engine.sameItem(reference.get(note.id), note, originalSettings, settings);
    ctx.fillStyle = same ? "#b7c3ca" : "#f0bc82"; ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(4, h / 2, w / 2)); ctx.fill();
    if (note.id === selectedNoteId) { ctx.strokeStyle = "#357694"; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  const x = g.left + (playbackProgress / Engine.beatSeconds(settings) - g.offset) * g.beatW;
  if (playbackProgress > 0 && x >= g.left && x <= right) {
    ctx.strokeStyle = "#df695e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, height - g.bottom); ctx.stroke();
    ctx.beginPath(); ctx.fillStyle = "#fff"; ctx.arc(x, g.top + g.rowH * 2, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}
function pointerTime(event) {
  const g = geometry();
  const beat = g.offset + clamp(event.clientX - g.rect.left - g.left, 0, g.plotW) / g.beatW;
  return clamp(beat * Engine.beatSeconds(settings), 0, editedBuffer?.duration || 0);
}
$("trackCanvas").addEventListener("pointerdown", event => {
  if (!hasSession()) return;
  $("trackCanvas").setPointerCapture(event.pointerId);
  if (event.shiftKey && sourceMode === "upload") {
    if (rendering) return;
    dragState = { type: "range", start: pointerTime(event) }; activeSelection = null;
  } else {
    const g = geometry(), x = event.clientX - g.rect.left, y = event.clientY - g.rect.top;
    const note = [...editedNotes].reverse().find(item => {
      const nx = g.left + (item.start - g.offset) * g.beatW, ny = g.top + (g.high - item.pitch) * g.rowH;
      return x >= g.left && x <= g.left + g.plotW && x >= nx && x <= nx + Math.max(8, item.length * g.beatW) && y >= ny && y <= ny + g.rowH;
    });
    selectedNoteId = note?.id ?? null;
    if (note) {
      activeSelection = null;
      dragState = { type: "note", before: snapshot(), id: note.id, x, y, start: note.start, pitch: note.pitch, g };
    } else if (sourceMode === "upload" && !rendering) {
      dragState = { type: "range", start: pointerTime(event) }; activeSelection = null;
    }
    updateUI();
  }
});
$("trackCanvas").addEventListener("pointermove", event => {
  if (!dragState) return;
  if (dragState.type === "range") {
    const end = pointerTime(event); activeSelection = { start: Math.min(end, dragState.start), end: Math.max(end, dragState.start) }; updateUI(); return;
  }
  const g = dragState.g, x = event.clientX - g.rect.left, y = event.clientY - g.rect.top;
  const note = editedNotes.find(item => item.id === dragState.id); if (!note) return;
  const dx = x - dragState.x, dy = y - dragState.y;
  if (Math.abs(dx) + Math.abs(dy) < 3) return;
  const snap = sourceMode === "upload" ? Math.max(0.05 / Engine.beatSeconds(settings), 0.01) : 0.25;
  note.start = Math.max(0, Math.round((dragState.start + dx / g.beatW) / snap) * snap);
  note.pitch = clamp(dragState.pitch - Math.round(dy / g.rowH), g.low, g.high); updateUI();
});
$("trackCanvas").addEventListener("pointerup", async () => {
  const drag = dragState; dragState = null;
  if (drag?.type === "note" && !stateEqual(drag.before, currentRevision())) {
    await commitEdit(drag.before, "Drag " + itemName().toLowerCase()); tell("The block's pitch and timing changes have been applied to the edited audio.");
  }
});
$("trackCanvas").addEventListener("pointercancel", () => {
  if (dragState?.type === "note") { editedNotes = copyNotes(dragState.before.notes); updateUI(); }
  dragState = null;
});

$("notePitch").addEventListener("change", async event => {
  const note = editedNotes.find(item => item.id === selectedNoteId); if (!note) return;
  const before = snapshot(); note.pitch = Number(event.target.value); await commitEdit(before, "Change pitch");
});
$("noteLength").addEventListener("change", async event => {
  const note = editedNotes.find(item => item.id === selectedNoteId); if (!note) return;
  const before = snapshot(); note.length = Number(event.target.value); await commitEdit(before, "Change length");
});
$("duplicateNoteBtn").addEventListener("click", async () => {
  const note = editedNotes.find(item => item.id === selectedNoteId); if (!note) return;
  const before = snapshot(), duplicate = { ...note, id: nextNoteId++, start: note.start + note.length };
  editedNotes.push(duplicate); selectedNoteId = duplicate.id; await commitEdit(before, "Duplicate");
});
$("deleteNoteBtn").addEventListener("click", async () => {
  if (selectedNoteId === null) return;
  const before = snapshot(); editedNotes = editedNotes.filter(note => note.id !== selectedNoteId); selectedNoteId = null; await commitEdit(before, "Delete");
});
$("addNoteBtn").addEventListener("click", async () => {
  if (!hasSession()) return;
  const before = snapshot(), last = [...editedNotes].sort((a, b) => a.start - b.start).at(-1);
  const note = { id: nextNoteId++, pitch: last?.pitch || (sourceMode === "upload" ? 60 : 67), start: last ? last.start + last.length : 0, length: 1 };
  if (sourceMode === "upload") {
    note.sampleStart = last?.sampleStart ?? 0; note.sampleEnd = last?.sampleEnd ?? Math.min(0.5, originalBuffer.duration);
  }
  editedNotes.push(note); selectedNoteId = note.id; await commitEdit(before, "Add");
});
$("suggestBtn").addEventListener("click", async () => {
  if (!editedNotes.length) return;
  const before = snapshot(), direction = $("suggestionDirection").value, sorted = [...editedNotes].sort((a, b) => a.start - b.start);
  const low = sourceMode === "upload" ? 48 : 55, high = sourceMode === "upload" ? 72 : 79;
  sorted.forEach((note, index) => {
    const previous = sorted[index - 1];
    if (direction === "higher") note.pitch = clamp(note.pitch + 2, low, high);
    if (direction === "varied" && index % 3 === 1) note.pitch = clamp(note.pitch + (index % 2 ? 4 : -4), low, high);
    if (previous && direction === "simpler" && Math.abs(note.pitch - previous.pitch) > 4) note.pitch = Math.round((note.pitch + previous.pitch) / 2);
    if (previous && direction === "smoother" && Math.abs(note.pitch - previous.pitch) > 3) note.pitch = previous.pitch + Math.sign(note.pitch - previous.pitch) * 2;
  });
  if (stateEqual(before, currentRevision())) {
    appendLog("Suggestion · " + direction, "This rule made no further changes. Try Higher or More varied for a different revision."); updateUI(); tell("No further changes were needed for this rule."); return;
  }
  $("suggestionInfo").textContent = sourceMode === "upload" ? "A rule-based relative-transposition suggestion is ready. The recording's actual melody was not transcribed." : "A rule-based melody revision is ready. Listen, edit, accept or reject.";
  await commitEdit(before, "Suggestion · " + direction);
});
$("acceptBtn").addEventListener("click", () => {
  const before = snapshot(); pushUndo(before); acceptedRevision = currentRevision();
  appendLog("Accept revision", "Saved the current revision as the accepted version. The untouched original and its comparison reference are preserved."); updateUI(); tell("Revision accepted. The original remains available for comparison.");
});
$("rejectBtn").addEventListener("click", async () => {
  if (!acceptedRevision) return;
  const before = snapshot(); editedNotes = copyNotes(acceptedRevision.notes); settings = { ...acceptedRevision.settings }; selectedNoteId = null;
  await commitEdit(before, "Reject revision"); tell("Restored the last accepted version, or the original if nothing has been accepted.");
});

async function changeSetting(key, value, action) {
  if (!hasSession()) return;
  const before = snapshot(); settings[key] = value; await commitEdit(before, action);
}
$("volumeControl").addEventListener("input", event => { $("volumeValue").textContent = event.target.value + "%"; });
$("volumeControl").addEventListener("change", event => changeSetting("volume", Number(event.target.value), "Adjust volume"));
$("speedControl").addEventListener("input", event => { $("speedValue").textContent = Number(event.target.value).toFixed(2) + "×"; });
$("speedControl").addEventListener("change", event => changeSetting("speed", Number(event.target.value), "Adjust speed"));
$("fadeInBtn").addEventListener("click", () => changeSetting("fadeIn", !settings.fadeIn, "Toggle fade in"));
$("fadeOutBtn").addEventListener("click", () => changeSetting("fadeOut", !settings.fadeOut, "Toggle fade out"));
async function modifyRange(keep) {
  if (!activeSelection || activeSelection.end - activeSelection.start <= 0.02) return;
  const next = Engine.editRange(editedNotes, activeSelection, keep, settings, () => nextNoteId++);
  if (!next.length) return tell("This edit would remove all audio. Choose a different range.");
  const before = snapshot(); editedNotes = next; selectedNoteId = null;
  await commitEdit(before, keep ? "Keep selected range" : "Remove selected range");
}
$("keepSelectionBtn").addEventListener("click", () => modifyRange(true));
$("deleteSelectionBtn").addEventListener("click", () => modifyRange(false));

function playVersion(version) {
  const url = version === "original" ? originalUrl : editedUrl;
  if (!url || (version === "edited" && (rendering || !editedBuffer))) return;
  autoFollowTrack = true; playbackVersion = version; $("audioPlayer").src = url; $("audioPlayer").load();
  $("audioPlayer").play().catch(() => tell("Press Play in the audio controls to start playback."));
  tell("Playing the " + version + " version.");
}
$("playOriginalBtn").addEventListener("click", () => playVersion("original"));
$("playEditedBtn").addEventListener("click", () => playVersion("edited"));
$("audioPlayer").addEventListener("play", () => { autoFollowTrack = true; });
$("audioPlayer").addEventListener("timeupdate", () => {
  playbackProgress = $("audioPlayer").currentTime;
  const duration = $("audioPlayer").duration || editedBuffer?.duration || 0;
  $("seekControl").value = duration ? Math.round(playbackProgress / duration * 1000) : 0;
  $("trackStart").textContent = timeLabel(playbackProgress); $("trackEnd").textContent = timeLabel(duration); followPlayhead(); drawTrack();
});
$("audioPlayer").addEventListener("error", () => { if ($("audioPlayer").getAttribute("src")) tell("Audio playback failed. Try rendering again with Undo / Redo or choose another file."); });
$("seekControl").addEventListener("input", event => {
  autoFollowTrack = true;
  if (Number.isFinite($("audioPlayer").duration)) $("audioPlayer").currentTime = $("audioPlayer").duration * Number(event.target.value) / 1000;
});
$("downloadBtn").addEventListener("click", () => {
  if (rendering || !editedBuffer || !editedUrl) return;
  const link = document.createElement("a"); link.href = editedUrl;
  link.download = (sourceMode === "upload" ? sessionName.replace(/\.[^.]+$/, "") : "melodycompare-generated") + "-edited.wav";
  document.body.append(link); link.click(); link.remove(); tell("Exported the actual edited audio as 16-bit PCM WAV.");
});
configurePitchControl(); updateUI();
window.addEventListener("resize", () => { resizeTrackCanvas(); drawTrack(); });
