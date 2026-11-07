# MelodyCompare

An interactive web prototype exploring how melody similarity feedback can help non-musicians revise musical ideas while maintaining creative control.

## 1. Project Status

**Implemented:**
- Original and revised eight-note melodies.
- Global similarity scores based on pitch matching.
- Local similarity feedback using colour highlighting.
- Manual note editing with + and − buttons.
- Real-time similarity updates after editing.
- Melody playback using browser audio.
- Accept and reject revision controls.

**Simulated:**
- AI melody suggestions use predefined pitch-change patterns rather than a generative AI model.

**Not yet implemented:**
- Real generative AI integration.
- Rhythm-based similarity analysis.
- Persistent melody storage.
- Formal user evaluation.

## 2. Technology Stack

- **HTML:** Structures the interface.
- **CSS:** Provides layout, colours and visual feedback.
- **JavaScript:** Manages melody data, similarity calculations and interactions.
- **Web Audio API:** Plays melodies in the browser.

These technologies were chosen to support a lightweight, accessible prototype without external dependencies.

## 3. How to Run

1. Download this repository as a ZIP file.
2. Extract the files.
3. Keep `index.html`, `style.css` and `app.js` in the same folder.
4. Open `index.html` using Google Chrome or Microsoft Edge.

No additional installation, server or API key is required.

## 4. How to Interact

1. Play the original and revised melodies.
2. Select Global Similarity Score to view overall similarity.
3. Select Local Fragment Feedback to see matching and different notes.
4. Use + or − to modify individual pitches.
5. Observe how the feedback changes.
6. Generate a simulated AI suggestion.
7. Accept or reject the revision.

Accepting makes the revised melody the new original. Rejecting restores the current original melody.

## 5. Design Rationale

This prototype builds on the A1 research concerning melody similarity feedback and creative agency in AI-assisted music creation.

Global feedback provides an overview of similarity, while local feedback identifies individual differences. Manual editing and explicit accept/reject decisions are intended to support users' creative control.

Similarity is calculated as the percentage of matching pitches at corresponding note positions. This is a simplified measure and does not represent perceptual melodic similarity.

## 6. Development Record

**7 November 2026 — Initial prototype**

- Created a browser-based interface.
- Implemented global and local feedback modes.
- Developed pitch editing and similarity recalculation.
- Added melody playback.
- Implemented simulated suggestions and accept/reject controls.
- Tested the system manually in Microsoft Edge.
- Verified that correcting one mismatched note changed similarity from 75% to 88%.
- Recorded screenshots of the developed interface.

The initial code was developed locally before the first GitHub commit. Subsequent changes are documented in GitHub.

## 7. AI Assistance

ChatGPT was used for project planning, initial code generation, implementation guidance, testing instructions and README drafting.

The generated code was placed into VS Code, and the prototype was run and manually tested in a browser. Similarity calculations and interface responses were checked using example melodies.

The project uses predefined, simulated suggestions rather than a connected generative AI model. This distinction is stated in the interface and documentation.

## 8. Project Files

- `index.html` — Web interface
- `style.css` — Visual styling
- `app.js` — Application logic
- `screenshots/` — Interface and interaction evidence

## 9. Limitations and Future Work

The prototype currently compares fixed-length melodies using pitch equality at corresponding note positions.

Future developments could include rhythm analysis, richer visualisations, integration with a generative AI model, and user studies investigating revision performance and perceived creative agency.

The current project demonstrates interaction functionality rather than experimentally validated research outcomes.
