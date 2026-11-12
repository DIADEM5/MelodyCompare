"use strict";
/* Serializable editing state and append-only version history. No audio transcription. */
(function (root) {
  const Audio = root.MelodyAudio;
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const duration = state => state.segments.reduce((sum, s) => sum + s.sourceEnd - s.sourceStart, 0) / state.settings.speed;
  function freeze(value) { Object.freeze(value); Object.values(value).forEach(v => { if (v && typeof v === "object" && !Object.isFrozen(v)) freeze(v); }); return value; }
  function color(index) {
    const palette = ["#ba5d24", "#2b71b4", "#8652b2", "#147d72", "#bc456d", "#78651f"];
    return palette[index - 1] || "hsl(" + ((index * 137.508) % 360).toFixed(3) + " 58% 30%)";
  }
  function pointsFor(length, evaluate = () => 0) {
    const intervals = Math.min(Math.max(32, Math.ceil(length / 0.125)), Math.max(1, Math.floor(length / 0.025)));
    return Array.from({ length: intervals + 1 }, (_, i) => { const time = length * i / intervals; return { id: i + 1, time, value: evaluate(time) }; });
  }
  function initialState(length) {
    if (!Number.isFinite(length) || length <= 0 || length > 300) throw new Error("Import audio between 0 and 300 seconds.");
    return { points: pointsFor(length), segments: [{ sourceStart: 0, sourceEnd: length }],
      settings: { volume: 100, speed: 1, fadeIn: false, fadeOut: false } };
  }
  function validate(state) {
    if (!state || !state.segments?.length || !state.points?.length || !state.settings) throw new Error("Incomplete editing state.");
    if (state.segments.some(s => !Number.isFinite(s.sourceStart) || !Number.isFinite(s.sourceEnd) || s.sourceStart < 0 || s.sourceEnd <= s.sourceStart)) throw new Error("Invalid source ranges.");
    const length = state.segments.reduce((sum, s) => sum + s.sourceEnd - s.sourceStart, 0);
    if (state.points.some((p, i) => !Number.isFinite(p.time) || !Number.isFinite(p.value) || p.time < 0 || p.time > length + 0.000001 || Math.abs(p.value) > 12 || i && p.time <= state.points[i - 1].time)) throw new Error("Invalid control points.");
    if (state.settings.speed < 0.5 || state.settings.speed > 1.5 || !Number.isFinite(state.settings.speed) || !Number.isFinite(state.settings.volume) || state.settings.volume < 0 || state.settings.volume > 150 || duration(state) > 600) throw new Error("Invalid audio settings.");
    return state;
  }
  function sourcePosition(state, outputTime) {
    let time = outputTime * state.settings.speed;
    if (time < 0 || outputTime >= duration(state)) return null;
    for (const segment of state.segments) {
      const span = segment.sourceEnd - segment.sourceStart;
      if (time < span) return segment.sourceStart + time;
      time -= span;
    }
    return null;
  }
  function gainAt(state, time) {
    const length = duration(state); let gain = state.settings.volume / 100;
    if (state.settings.fadeIn) gain *= Math.min(1, time / Math.min(length, 2));
    if (state.settings.fadeOut) gain *= Math.min(1, Math.max(0, length - time) / Math.min(length, 2));
    return gain;
  }
  function compare(a, b, step = 0.02, range = null) {
    if (!(step > 0)) throw new Error("Comparison step must be positive.");
    if (range && (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start)) throw new Error("Comparison range must have a valid start and end.");
    const startAt = range ? range.start : 0, end = Math.min(Math.max(duration(a), duration(b)), range ? range.end : Infinity), regions = []; let matched = 0;
    if (end <= startAt) return { score: null, matched: 0, duration: 0, regions, step };
    for (let index = 0; startAt + index * step < end - 1e-9; index++) {
      const start = startAt + index * step;
      const finish = Math.min(end, start + step), time = (start + finish) / 2;
      const atA = sourcePosition(a, time), atB = sourcePosition(b, time), reasons = [];
      let difference = 0;
      if (atA === null || atB === null) reasons.push("audio missing in one version");
      else {
        difference = Math.abs(Audio.curveValue(a.points, time * a.settings.speed) + 12 * Math.log2(a.settings.speed) - Audio.curveValue(b.points, time * b.settings.speed) - 12 * Math.log2(b.settings.speed));
        if (difference > 0.25 + 1e-9) reasons.push(a.settings.speed !== b.settings.speed ? "pitch / speed adjustment" : "pitch adjustment");
        if (Math.abs(atA - atB) > 0.002) reasons.push("source timing");
        if (Math.abs(gainAt(a, time) - gainAt(b, time)) > 0.01 + 1e-9) reasons.push("volume / fade");
      }
      const status = reasons.length ? "modified" : "similar", reason = reasons.join(", ");
      if (status === "similar") matched += finish - start;
      const previous = regions.at(-1);
      if (previous && previous.status === status && previous.reason === reason) { previous.end = finish; previous.maxDifference = Math.max(previous.maxDifference, difference); }
      else regions.push({ start, end: finish, status, reason, maxDifference: difference });
    }
    return { score: Math.round(matched / (end - startAt) * 1000) / 10, matched, duration: end - startAt, regions, step };
  }
  function editRange(state, range, keep) {
    const next = clone(state), speed = state.settings.speed, total = duration(state) * speed;
    const from = Math.max(0, Math.min(total, range.start * speed)), to = Math.max(from, Math.min(total, range.end * speed));
    if (to - from < 0.025) throw new Error("Select at least 0.025 seconds of source audio.");
    const wanted = keep ? [[from, to]] : [[0, from], [to, total]];
    next.segments = []; let offset = 0;
    for (const segment of state.segments) {
      const end = offset + segment.sourceEnd - segment.sourceStart;
      for (const [lo, hi] of wanted) {
        const a = Math.max(lo, offset), b = Math.min(hi, end);
        if (b > a + 0.000001) next.segments.push({ sourceStart: segment.sourceStart + a - offset, sourceEnd: segment.sourceStart + b - offset });
      }
      offset = end;
    }
    const length = next.segments.reduce((sum, s) => sum + s.sourceEnd - s.sourceStart, 0);
    if (length < 0.025) throw new Error("This edit would remove all audio.");
    next.points = pointsFor(length, time => Audio.curveValue(state.points, keep ? time + from : time < from ? time : time + to - from));
    return validate(next);
  }
  function changes(before, after) {
    const old = new Map(before.points.map(p => [p.id, p])), result = [];
    if (!equal(before.segments, after.segments)) result.push("Source ranges changed: " + duration(before).toFixed(2) + "s → " + duration(after).toFixed(2) + "s.");
    const rangesChanged = !equal(before.segments, after.segments);
    if (rangesChanged) result.push("Curve resampled to " + after.points.length + " control points for the retained source ranges.");
    const changed = rangesChanged ? [] : after.points.filter(p => !old.has(p.id) || Math.abs(p.value - old.get(p.id).value) > 0.000001 || Math.abs(p.time - old.get(p.id).time) > 0.000001);
    for (const point of changed) result.push("Point at " + (point.time / after.settings.speed).toFixed(2) + "s: " + (old.get(point.id)?.value ?? 0).toFixed(2) + " → " + point.value.toFixed(2) + " semitones.");
    for (const key of ["volume", "speed", "fadeIn", "fadeOut"]) if (before.settings[key] !== after.settings[key]) result.push(key + ": " + before.settings[key] + " → " + after.settings[key] + ".");
    return result;
  }
  class VersionHistory {
    constructor(length, sourceId, now = () => new Date().toISOString()) {
      this.now = now; this.sourceId = sourceId; this.working = initialState(length); this.baseId = "original";
      this.versions = [freeze({ id: "original", name: "Original", color: "#65737f", createdAt: now(), sourceId, parentId: null, restoredFrom: null, reason: "Imported original audio", changes: [], state: clone(this.working) })];
      this.undoStack = []; this.redoStack = []; this.events = []; this.nextVersion = 1;
    }
    get(id) { return this.versions.find(v => v.id === id); }
    dirty() { return !equal(this.working, this.get(this.baseId).state); }
    snapshot() { return { state: clone(this.working), baseId: this.baseId }; }
    checkpoint() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 40) this.undoStack.shift(); this.redoStack = []; }
    apply(state, action) {
      validate(state); if (equal(this.working, state)) return false;
      const detail = changes(this.working, state); this.checkpoint(); this.working = clone(state);
      this.events.push({ action, detail, time: this.now() }); return true;
    }
    save(reason = "Saved working changes", restoredFrom = null, parentId = this.baseId, force = false) {
      if (!this.dirty() && !restoredFrom && !force) return null;
      const number = this.nextVersion++, version = freeze({ id: "edit-" + number, name: "Version " + number, color: color(number),
        createdAt: this.now(), sourceId: this.sourceId, parentId, restoredFrom, reason,
        changes: changes(this.get(parentId).state, this.working), state: clone(this.working) });
      this.versions.push(version); this.baseId = version.id; this.events.push({ action: reason, versionId: version.id, detail: version.changes, time: this.now() }); return version;
    }
    checkout(id) {
      const target = this.get(id); if (!target) throw new Error("Version not found.");
      if (this.baseId === id && !this.dirty()) return target;
      this.checkpoint(); this.working = clone(target.state); this.baseId = id;
      this.events.push({ action: "Edit copy of " + target.name, detail: [], time: this.now() });
      return target;
    }
    restore(id) {
      const target = this.get(id); if (!target) throw new Error("Version not found.");
      const parentId = this.baseId; this.checkpoint(); this.working = clone(target.state);
      return this.save("Restored " + target.name, id, parentId);
    }
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.snapshot()); const saved = this.undoStack.pop(); this.working = clone(saved.state); this.baseId = saved.baseId;
      this.events.push({ action: "Undo", detail: [], time: this.now() }); return true;
    }
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.snapshot()); const saved = this.redoStack.pop(); this.working = clone(saved.state); this.baseId = saved.baseId;
      this.events.push({ action: "Redo", detail: [], time: this.now() }); return true;
    }
  }
  function segment(buffer, range) {
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start || range.end - range.start > 600) throw new Error("Select a valid playback range.");
    const frames = Math.max(1, Math.round((range.end - range.start) * buffer.sampleRate)), start = Math.round(range.start * buffer.sampleRate);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => {
      const data = new Float32Array(frames), input = buffer.getChannelData(c);
      if (start < input.length) data.set(input.subarray(start, Math.min(input.length, start + frames))); return data;
    });
    return { sampleRate: buffer.sampleRate, channels, duration: frames / buffer.sampleRate };
  }
  root.MelodyVersions = { clone, equal, duration, pointsFor, initialState, validate, sourcePosition, compare, editRange, changes, color, VersionHistory, segment };
})(globalThis);
