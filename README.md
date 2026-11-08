# MelodyCompare

MelodyCompare is an A2 browser prototype for **Melody Similarity Feedback and Creative Control in Artificial Intelligence-Assisted Music Creation**. It extends the original HTML/CSS/JavaScript and Web Audio project.

## Run

Keep `index.html`, `style.css`, `audio-engine.js`, and `app.js` in the same folder. Open `index.html` in a current Windows Chrome or Edge browser. No packages, server, paid service, or API key are required. If your browser restricts local decoding, serve the folder with a local development server such as VS Code Live Server.

## Implemented

- Entire interface, messages, feedback and documentation in English.
- The existing white layout, with Note/Audio Slice Editing and Suggestion in separate cards.
- Local audio file selection and drag-and-drop, up to 50 MB and 5 minutes, using browser decoding.
- Scene-based random monophonic melody generation using local rules.
- A shared piano-roll interaction for both sources: select, drag pitch/transposition and start time, change length, duplicate, delete and add.
- Imported blocks play the recording's real samples. They are equal-time **audio slices**, not automatically transcribed musical notes.
- Original/edited playback, native pause/seek controls, processed 16-bit PCM WAV export.
- Imported audio uses a single editable-slice view that stays within the available page width. Left/right buttons and a draggable View slider below the track navigate the timeline without resizing the canvas or changing audio/edit history. Shift + drag selects a time range for Keep/Remove; volume, speed and fades are retained.
- Rule-based suggestions: Smoother, Simpler, More varied and Higher. Smoother/Simpler act on the editable pitch or relative-transposition sequence; when no change is needed, the interface says so.
- Undo, redo, reset, accept and reject. Accept stores the current revision; reject returns to the last accepted version (or the original if no revision was accepted). Reset restores the initial source. The untouched original remains the playback and comparison reference.
- Dynamic global/local feedback and an append-only chronological edit history. Multi-item edits such as suggestions record each changed block separately. Undo, redo, resets, decisions and audio effects are also recorded.
- Grey unchanged blocks and the grey Same legend use `#b7c3ca`; changed/added blocks use orange `#f0bc82`. Selection adds an outline without changing an unchanged block's grey fill.
- Feedback explanation updates with the current source, unchanged/changed/added/deleted counts, effects and latest action.

## Imported audio editing

Imported recordings use finer, equal-time slices targeting a maximum of 0.5 seconds each. Short recordings use at least 16 slices when possible; very short recordings use fewer to keep slices at least about 25 ms long. A 3:04 recording is split into 368 slices instead of the previous 16. Each initial slice is labelled **0 st**, meaning no relative pitch shift, not a detected note.

- Move a block vertically to transpose its actual audio by up to ±12 semitones.
- Move horizontally to change its start time.
- Change length to time-stretch the slice.
- Duplicate reuses that slice's recorded samples; Add reuses the last slice, or a short sample from the source when the arrangement is empty.
- Delete removes the selected slice from playback, leaving a gap if other slices retain their positions.
- Use the left/right arrows or drag the View slider below the track to reach later slices. Only the visible time window is drawn, keeping the page and the right feedback column contained. Pitch labels remain visible. Manual navigation holds its position; resuming playback or seeking resumes playhead following.
- Hold Shift and drag directly on the slice track to select a time range for Keep/Remove. Dragging empty track space also selects a range. The Waveform / select range button has been removed.

Pitch and independent duration changes use a basic overlapping-grain sampler. It can introduce clicks, modulation, transient smearing or other artifacts, especially with complex music or large changes. Unmodified slices copy the original decoded samples. This is an editable sampling prototype, not a professional pitch correction system.

## Feedback calculation

Generated melodies use a simplified symbolic note comparison. Imported recordings use an explicitly labelled **Audio slice edit match** score. Imported audio is not assigned an invented melodic or perceptual similarity percentage.

Corresponding items keep stable identifiers. An item counts as unchanged when:

1. Its pitch/relative transposition matches.
2. Its start time and duration match, including speed effects.
3. For imported audio, its source-sample boundaries also match.

Score = unchanged original items / (original items + added items), rounded to a percentage. Deletions remain in the denominator. This makes delete-and-add replacements visible instead of hiding them behind an unchanged item count. Timing has a 2 ms numerical tolerance. Volume, fades, timbre and perceptual similarity are not measured by this score.

The local panel shows the selected item's current/reference values and every committed edit in chronological order, with source and time. The full log stays in memory until the page is refreshed; Undo/Redo never deletes earlier entries. It is separate from the 40-step undo buffer.

## Simulated and planned

**Simulated / simplified**

- The scene generator and suggestions use rules and randomness. No generative AI model is connected.
- Scene audio is synthesized from monophonic notes.
- Imported relative-transposition blocks are sample-edit controls, not detected melody pitches.
- Global feedback measures editable-item correspondence, not human listening judgments.

**Not implemented**

- Reliable automatic monophonic/polyphonic transcription or perceptual melody comparison.
- Professional-quality artifact-free time stretching/pitch correction.
- External audio search, persistent project saving, or history restoration after a page refresh.
- Participant studies or formal usability evaluation.

## Files

- `index.html`: English interface and separate editing/suggestion cards.
- `style.css`: existing responsive white design, consistent feedback colors and history layout.
- `audio-engine.js`: dependency-free sample renderer, generated sound, comparison and range transformations.
- `app.js`: source workflows, interactions, playback, WAV encoding, feedback and history.
- `tests/audio-engine.test.cjs`: numerical audio and comparison checks.
- `tests/editor-state.test.cjs`: application-state checks with simulated DOM/audio browser APIs.

## Verification performed — 8 November 2026

24 automated cases passed using the bundled Node runtime. The saved test bodies were executed through a VM test registration harness because the normal terminal launcher was unavailable in this environment.

Checks cover:

- Exact sample preservation for unchanged mono/stereo imported audio, including the finer default subdivision.
- Adaptive counts (2s → 16 slices, 3:04 → 368 slices, 5:00 → 600 slices), a fixed-size viewport, bounded left/right buttons, draggable view navigation, selection of later slices, and Shift-drag range editing.
- Approximate octave transposition of real sine-wave samples while preserving target duration.
- Time/length edits, gaps after deletion, keep/remove ranges, speed, fades and reversible volume.
- Similarity for changes, additions and deletions.
- Generated/imported editing controls, dynamic feedback and retained per-item history.
- Undo/redo, accept/reject/reset and preserving the original.
- WAV header and processed-sample output.
- English interface content, separate cards and the grey Same rule.

The editor-state tests use browser API stubs. These checks do **not** establish real browser layout, file-dialog behavior, codec compatibility, sound quality, listening results or successful pointer interaction on the user's computer. The browser automation policy prevented inspection of the local `file://` page. No participant test is claimed.

To reproduce the automated checks on a computer with Node.js 18 or newer:

```powershell
node --test tests/audio-engine.test.cjs tests/editor-state.test.cjs
```

Node.js is optional for tests; the application itself does not require it.

## Manual browser checks

1. Open the page and check that all visible copy is English and the two editing/suggestion cards are separate.
2. Generate a scene melody. Change one of eight pitches: the score should become 88%, the changed item should become orange, and the local history should record old/new pitch.
3. Select an unchanged block. It and the Same legend should remain grey.
4. Drag pitch/time, edit length, duplicate, delete and add. Listen to the edited version after rendering finishes.
5. Generate a Higher suggestion. Check that every changed item gets its own history entry and that the explanation's counts/latest action update.
6. Undo, redo, accept, reject and reset. Check that earlier records remain and Original still plays the untouched source.
7. Import a short WAV or MP3. Confirm Editable slices is available with the same controls. Move a slice upward and listen for its relative pitch change.
8. Import a longer recording and check that there are many finer slices. Use the view arrows or drag the View slider to edit a later slice. Confirm the editor does not overflow or cover the feedback column. Hold Shift and drag on the track to select a range, then try Keep/Remove. Check the edited duration and the unchanged Original version.
9. Adjust volume, speed and fades; export WAV and play the downloaded result.
10. Check readable errors for corrupt/unsupported, oversized and overlong files.

Record the browser version, source audio, actual outcomes and screenshots before including manual test results in the report.

## GitHub Desktop

Open the existing local MelodyCompare repository, review all changed/new files and commit them. Confirm the destination is `DIADEM5/MelodyCompare` before choosing Push origin. This work does not automatically commit or push.

Suggested commit: `fix: contain melody editor and add timeline navigation`

## Academic evidence

Preserve commit history, actual test outputs, screenshots and known limitations. Disclose AI assistance according to university guidance. Implementing these interactions does not itself establish a finding about user creativity or perceived similarity.
