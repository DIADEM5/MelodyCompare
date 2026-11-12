# MelodyCompare

**Melody Comparison and Version-Based Audio Editing** is a browser prototype for comparing edits to one imported recording. Users adjust a relative pitch curve, save numbered versions, listen to the same time range in each version, and download the resulting audio. The Original stays unchanged.

The page uses HTML, CSS, JavaScript and Web Audio API. No server, database, external library, API key or AI model is required.

## Run and use

Open [index.html](index.html) in a current Windows Chrome or Edge browser. If your browser restricts local decoding, open the same project with VS Code Live Server. Import a browser-decodable WAV or MP3 of up to **50 MB / five minutes**. Processing stays in the browser tab; refreshing or replacing the source starts a new session.

1. Choose **Original** or a saved **Version 1**, **Version 2**, etc. The selected curve and Play button share a color. Play and Pause control the actual audio. The native audio bar can resume a paused version.
2. The version change list, pitch-point controls and segment tools stay visible together. Drag a point to adjust pitch. Editing any saved curve starts an unsaved numbered edit **from Original**, while the saved version remains unchanged.
3. Click **Add version** to save the current unsaved edit, then start the next numbered version with Original’s flat adjustment curve and original audio settings. If a saved version is selected and there are no pending edits, Add version opens a fresh Original-based unsaved version; it does not duplicate the selected version. Pending unsaved edits are saved first. Each new version is independent.
4. Drag an empty area of the curve, or hold **Shift** while dragging across a control point, to select a time span. The segment buttons play that same output-time span in each available version; **Listen in order** plays them sequentially. A shorter version is silent past its end. The selected-range comparison box always stays visible and explains how to select a range until one is chosen. Volume and Speed remain in the segment tools.
5. Each saved version has a separate **Download WAV** button. A temporary unsaved edit can also be downloaded. These files contain the actual processed 16-bit PCM audio, not a renamed original.
6. **Undo** and **Redo** recover editable states without deleting saved versions.

Use **Time window** and **View** to inspect longer recordings. Only a selected curve point displays its signed semitone adjustment. The segment selection is for listening; the former **More edit tools** panel, including region pitch, trim, fade, reset and discard buttons, has been removed.

## What the curve and score mean

The Original grey curve is **zero relative pitch adjustment**. Colored curves represent adjustments applied by the user. They are **not** detected notes or a pitch contour extracted from MP3. This prototype does not transcribe polyphonic music.

The whole-audio score list compares **each version separately with Original**. A second, always-visible box compares only the selected interval using the same rule. Before a valid range is selected, it displays selection instructions instead of a percentage. It measures edit-parameter agreement, not musical or perceptual similarity. The longer output timeline is split into **20 ms bins**. A bin agrees when both versions contain audio, effective pitch adjustment differs by at most **0.25 semitones** (including the pitch effect of speed), retained-source positions differ by at most **2 ms**, and gain differs by at most **0.01**. Score = agreeing duration ÷ compared duration × 100, rounded to one decimal. A volume change can lower this score even when the notes stay the same. The interface intentionally displays only the per-version data, without a detailed region list.

## Version and audio implementation

A saved snapshot contains an ID, numbered display name, color, parent ID, creation time, immutable editing state and change summary. The editing state stores relative pitch points, retained source ranges and audio settings. Saved snapshots are never overwritten. New unsaved edits start from Original; Add version deep-copies and freezes the edited state, then resets the next unsaved version to Original. The history model retains a restore operation, but this simplified interface does not show a Restore button. The Original decoded samples stay separate. Up to three rendered saved audios are cached; evicted ones can be rebuilt from their snapshot and the Original.

Pitch points use smoothstep interpolation. For changed intervals, the audio engine applies a whole-arrangement overlap-add renderer with overlapping Hann grains and bounded waveform alignment. Unchanged intervals now copy the source directly instead of running the granular processor over the entire recording. This makes a local pitch edit faster while keeping unchanged samples and preserving the existing transition behavior. Processed playback and downloads use rendered samples. Large or rapid pitch shifts and complex/polyphonic audio can still sound grainy or smeared; this is not professional pitch shifting.

To reduce interface pauses, the controller no longer rebuilds a dropdown containing thousands of control points, caches per-version comparison results until state changes, uses the imported File's native playback URL for the full Original when available, and reuses small encoded WAV blobs for repeated saved-version playback. The WAV blob cache holds at most two files and only files up to 24 MB. The first playback/export of a large edited version can still take time because the browser must render or encode it.

A representative **Node VM benchmark** on this machine used an eight-second, 44.1 kHz mono tone with one local +2-semitone control point: rendering took approximately **2.5 seconds before** the interval optimization and **about 0.5 seconds after**. This is a narrow synthetic measurement, not a browser-wide guarantee. Whole-recording pitch shifts, long stereo recordings, decoding and first-time WAV export may still be slow. Long sample loops yield to the browser every 32,768 frames so controls can respond during processing; this can slightly increase total render time.

## Files and tests

| File | Purpose |
| --- | --- |
| [index.html](index.html) | Import, numbered version chooser, curve, segment tools, comparison lists and downloads |
| [style.css](style.css) | Compact responsive layout and version colors |
| [app.js](app.js) | Import, editing controls, playback, score caching, version selection and WAV encoding |
| [audio-engine.js](audio-engine.js) | Curve-based real audio processing and local-interval optimization |
| [version-model.js](version-model.js) | Snapshot history, whole/selected-range comparison and Undo/Redo |
| [tests/](tests/) | Numerical engine/model tests and simulated browser-controller tests |

On **12 November 2026**, **56 of 56 saved automated tests passed**: 12 retained engine tests, 17 model/audio tests and 27 controller tests. Their node:test bodies ran through a Node VM registration harness because the normal terminal launcher fails on this Windows installation with a CET error. The usual CLI process was not successfully launched. Results and limits are saved in [tests/verification-2026-11-12.json](tests/verification-2026-11-12.json).

On a machine with working Node.js 18+, run:

~~~powershell
node --test tests/audio-engine.test.cjs tests/version-model.test.cjs tests/editor-state.test.cjs
~~~

The controller harness simulates DOM, file decoding and media playback. It checks the File/Blob playback route and version-specific WAV bytes, but it does **not** prove actual Chrome/Edge MP3 decoding, native timing, visual layout, browser console cleanliness or perceived audio quality. No current browser screenshot or participant test is claimed. Follow [tests/fixtures/README.md](tests/fixtures/README.md) to perform and record manual checks with the synthetic WAV fixtures and a real MP3. Existing images are legacy evidence; see [screenshots/README.md](screenshots/README.md).

## Project scope

**Implemented:** local audio import, relative editable pitch curves, real processed playback and WAV export, immutable numbered versions that start from Original, whole-audio and selected-range Original-relative edit-parameter scores, always-visible segment listening and comparison, sequential playback, per-version downloads, change summaries and Undo/Redo.

**Not implemented:** automatic pitch/note extraction, validated perceptual melody similarity, comparison of two independently imported songs, professional artifact-free pitch shifting, persistent project/database storage, AI music generation or a user study.

A concise A2 report description: “MelodyCompare lets non-musicians compare recoverable edits of one imported recording. It visualizes relative pitch adjustments across numbered versions, reports edit-parameter agreement with the Original, and supports corresponding segment listening, independent downloads and Undo/Redo. The score reflects known edits rather than detected musical similarity.”

This folder has no .git metadata. To publish through GitHub Desktop, clone [DIADEM5/MelodyCompare](https://github.com/DIADEM5/MelodyCompare), copy the updated files into that checkout, review the diff, then commit and push. No commit, push or deployment was performed in this task.
