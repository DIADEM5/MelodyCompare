"use strict";

/* Dependency-free sample and melody renderer. Imported items are audio slices:
   pitch=60 means an unchanged sample, not a detected C4. */
(function (root) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const beatSeconds = settings => 60 / settings.tempo / settings.speed;
  const startSeconds = (note, settings) => note.start * beatSeconds(settings);
  const lengthSeconds = (note, settings) => note.length * beatSeconds(settings);
  const close = (a, b) => Math.abs(a - b) <= 0.002;
  const sameItem = (a, b, aSettings, bSettings) => Boolean(a && b &&
    a.pitch === b.pitch && close(startSeconds(a, aSettings), startSeconds(b, bSettings)) &&
    close(lengthSeconds(a, aSettings), lengthSeconds(b, bSettings)) &&
    (a.sampleStart === undefined || (close(a.sampleStart, b.sampleStart) && close(a.sampleEnd, b.sampleEnd))));

  function compare(reference, revision, referenceSettings, revisionSettings) {
    const ref = new Map(reference.map(n => [n.id, n]));
    const edit = new Map(revision.map(n => [n.id, n]));
    const ids = new Set([...ref.keys(), ...edit.keys()]);
    let matches = 0;
    for (const id of ids) if (sameItem(ref.get(id), edit.get(id), referenceSettings, revisionSettings)) matches++;
    return { matches, total: ids.size, score: ids.size ? Math.round(matches / ids.size * 100) : 100,
      added: revision.filter(n => !ref.has(n.id)).length,
      removed: reference.filter(n => !edit.has(n.id)).length,
      changed: reference.filter(n => edit.has(n.id) && !sameItem(n, edit.get(n.id), referenceSettings, revisionSettings)).length };
  }

  function sliceCount(duration) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Audio duration must be positive.");
    // Target half-second slices, with finer division for short recordings.
    const target = Math.max(16, Math.ceil(duration / 0.5));
    const shortClipLimit = Math.max(1, Math.floor(duration / 0.025));
    return Math.min(target, shortClipLimit);
  }

  function splitSource(duration, tempo, nextId, count = sliceCount(duration)) {
    const beat = 60 / tempo;
    return Array.from({ length: count }, (_, index) => {
      const from = duration * index / count, to = duration * (index + 1) / count;
      return { id: nextId(), pitch: 60, start: from / beat, length: (to - from) / beat,
        sampleStart: from, sampleEnd: to };
    });
  }

  function cropPart(note, from, to, settings) {
    const sourceStart = startSeconds(note, settings), sourceLength = lengthSeconds(note, settings);
    const result = { ...note, start: from / beatSeconds(settings), length: (to - from) / beatSeconds(settings) };
    if (note.sampleStart !== undefined) {
      const span = note.sampleEnd - note.sampleStart;
      result.sampleStart = note.sampleStart + (from - sourceStart) / sourceLength * span;
      result.sampleEnd = note.sampleStart + (to - sourceStart) / sourceLength * span;
    }
    return result;
  }
  function editRange(notes, range, keep, settings, nextId) {
    const result = [], removedTime = range.end - range.start, beat = beatSeconds(settings);
    for (const note of notes) {
      const from = startSeconds(note, settings), to = from + lengthSeconds(note, settings);
      if (keep) {
        const lo = Math.max(from, range.start), hi = Math.min(to, range.end);
        if (hi > lo + 0.0001) { const part = cropPart(note, lo, hi, settings); part.start -= range.start / beat; result.push(part); }
      } else if (to <= range.start) result.push({ ...note });
      else if (from >= range.end) result.push({ ...note, start: note.start - removedTime / beat });
      else {
        let left = false;
        if (from < range.start) { result.push(cropPart(note, from, range.start, settings)); left = true; }
        if (to > range.end) {
          const part = cropPart(note, range.end, to, settings);
          part.start -= removedTime / beat;
          if (left) part.id = nextId();
          result.push(part);
        }
      }
    }
    return result;
  }

  const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
  function abortIfNeeded(options) {
    if (options.cancelled?.()) { const error = new Error("Rendering superseded"); error.name = "AbortError"; throw error; }
  }
  function sampleAt(data, position, from, to) {
    if (position < from || position >= to) return 0;
    const index = Math.floor(position), fraction = position - index;
    return data[index] * (1 - fraction) + data[Math.min(to - 1, index + 1)] * fraction;
  }

  async function render(notes, source, settings, options = {}) {
    const sampleRate = source?.sampleRate || 44100;
    const channelCount = source?.channels.length || 2;
    const beat = beatSeconds(settings);
    const duration = Math.max(0.1, ...notes.map(n => (n.start + n.length) * beat));
    if (duration > 600) throw new Error("The edited version is longer than 10 minutes. Shorten it before rendering.");
    const frames = Math.max(1, Math.round(duration * sampleRate));
    const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      abortIfNeeded(options);
      const note = notes[noteIndex], start = Math.round(note.start * beat * sampleRate);
      const length = Math.min(Math.round((note.start + note.length) * beat * sampleRate) - start, frames - start);
      if (length <= 0) continue;
      if (!source) {
        const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
        for (let i = 0; i < length; i++) {
          const t = i / sampleRate, phase = t * frequency;
          const triangle = 2 / Math.PI * Math.asin(Math.sin(2 * Math.PI * phase));
          const attack = Math.min(1, t / 0.012), release = Math.min(1, (length - i) / (sampleRate * 0.055));
          const envelope = attack * release * (0.45 + 0.55 * Math.exp(-t * 6));
          const value = 0.2 * envelope * (triangle + 0.16 * Math.sin(4 * Math.PI * phase));
          for (const output of channels) output[start + i] += value;
        }
      } else {
        const from = clamp(Math.round(note.sampleStart * sampleRate), 0, source.channels[0].length - 1);
        const to = clamp(Math.round(note.sampleEnd * sampleRate), from + 1, source.channels[0].length);
        const sourceLength = to - from, ratio = 2 ** ((note.pitch - 60) / 12) * settings.speed;
        const naturalRatio = sourceLength / length;
        if (Math.abs(ratio - naturalRatio) < 0.001) {
          // Unchanged slices copy their real samples; speed-only edits resample them.
          for (let c = 0; c < channelCount; c++) {
            const input = source.channels[c], output = channels[c];
            for (let i = 0; i < length; i++) output[start + i] += sampleAt(input, from + i * naturalRatio, from, to);
          }
        } else {
          // Overlapping Hann-window grains allow relative pitch and target length
          // to be edited independently. This basic sampler can produce artifacts.
          const grain = Math.min(2048, Math.max(64, 2 ** Math.floor(Math.log2(Math.max(64, sourceLength)))));
          const half = grain / 2, hop = grain / 4;
          const window = Float32Array.from({ length: grain }, (_, k) => 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (grain - 1)));
          const weights = new Float32Array(length);
          const slices = Array.from({ length: channelCount }, () => new Float32Array(length));
          for (let center = 0; center < length + half; center += hop) {
            const sourceCenter = from + center / length * sourceLength;
            for (let k = 0; k < grain; k++) {
              const position = center + k - half;
              if (position < 0 || position >= length) continue;
              const at = sourceCenter + (k - half) * ratio;
              if (at < from || at >= to) continue;
              const weight = window[k];
              weights[position] += weight;
              for (let c = 0; c < channelCount; c++) slices[c][position] += sampleAt(source.channels[c], at, from, to) * weight;
            }
            if (center % (hop * 64) === 0) { await yieldTask(); abortIfNeeded(options); }
          }
          for (let c = 0; c < channelCount; c++) for (let i = 0; i < length; i++) {
            const edge = Math.min(1, i / (sampleRate * 0.005), (length - i) / (sampleRate * 0.005));
            channels[c][start + i] += (weights[i] > 0.00001 ? slices[c][i] / weights[i] : 0) * edge;
          }
        }
      }
      options.progress?.((noteIndex + 1) / notes.length);
      if (noteIndex % 16 === 15 || noteIndex === notes.length - 1) await yieldTask();
    }
    abortIfNeeded(options);
    const volume = settings.volume / 100;
    for (const data of channels) for (let i = 0; i < data.length; i++) {
      let envelope = 1;
      if (settings.fadeIn) envelope *= Math.min(1, i / Math.min(data.length, 2 * sampleRate));
      if (settings.fadeOut) envelope *= Math.min(1, (data.length - 1 - i) / Math.min(data.length, 2 * sampleRate));
      data[i] = clamp(data[i] * volume * envelope, -1, 1);
    }
    return { sampleRate, channels, duration: frames / sampleRate };
  }
  root.MelodyAudio = { clamp, beatSeconds, startSeconds, lengthSeconds, sameItem, compare, sliceCount, splitSource, editRange, render };
})(globalThis);
