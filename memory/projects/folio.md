# Folio: reading and interface planning

Recorded 2026-09-06; updated 2026-09-07. User approved the first Folio Test trial, tried it successfully, and explicitly requested continuing only in the copy with the Apple-inspired UI. Original Claude source and installation must remain available. Remaining navigation/library features stay in discussion. This document preserves the user's ideas, not a finalized implementation specification.

## Implemented in the copy: Folio Test 0.2.0

Follow-up: User likes this visual direction. Requested a short work plan (now `ARBEITSPLAN.md`) and brighter white glow for both scrollbar sizes (0.2.1).

Phase 1 (0.3.0): Page chip reappears and persists on hover. Shared inversion filter reduces saturation to 0.65 to soften tint, preserving neutral grayscale. User explicitly accepted double-click on blank page to toggle page-width/previous zoom while keeping text double-click for word selection. Implemented and browser-tested, including resize and drawing-mode exclusions. Remaining navigation and library phases are still pending.

- Worktree `D:\Dev\folio-test`, branch `codex/apple-ui`; first trial checkpoint `2838df9`. No remote push or merge to main.
- Lens now 160px inside / 194px outside, unchanged 2.5x magnification.
- Glass rebuilt with bounded refraction, antialiased edges, neutral sheen, no dark tint or RGB splitting; crisp SVG icons adapt to light/dark backdrop.
- Neutral #202020 reading background, quieter library, blue UI accent, distinct broad highlighter and general toolbox opener. See `DESIGN.md`.
- Installed 0.2.0 update and desktop shortcut verified; original executable, shortcut, and PDF association unchanged. Existing test-library entries visible after update.
- Production browser UI checks passed at 100/125/200% scaling. Native start/library checked; further native input stopped when user activity was detected.
- Destination-page labels, scroll-speed changes, chapter access and library/file deletion are still pending. Inversion is now softened in 0.3.0; user-document colour feedback may require further tuning.

## User requests

1. Make the magnifying glass bigger. Exact size undecided; greater magnification was not requested.
2. Resolve pixelated borders on the liquid glass.
3. Consider replacing the liquid glass effect as a whole, possibly followed by broader UI changes. Aim for an Apple-like feel; research existing implementations that can be reused or adapted.
4. On the expanded automatic scrollbar, show only the destination page number beside the cursor (no thumbnail preview), mapped to the hovered position. User clarification: hover near an approximate location and see, for example, page 13, to find that page quickly. Top positions correspond to early pages. The precise jump gesture and coexistence with hover auto-scroll still need definition; do not infer cancellation of the original auto-scroll request.
5. Change the background to a more pleasing dark reading color and research reading comfort. The dictated word "troylet" is unclear; interpreting this provisionally as the area behind/around the PDF, with scope to confirm.
6. Give the highlighter a symbol that is easier to distinguish from the pencil.
7. Give the annotation-system opening button a general annotation/tools symbol instead of a second pencil.
8. Increase the automatic scrollbar's five phases to make navigation smoother and more intuitive.
9. Double-click the open PDF to enlarge it within the existing window. Fit-width versus whole-page fit remains to be decided; this is not a request for OS fullscreen.
10. Remove the glass darkening so the glass is clear again.
11. Add quick access to chapters when the PDF provides that information, especially books with contents.
12. Reveal the bottom-left page number on hover and keep it visible while hovered.
13. Support both removing an entry from the library and deleting its underlying PDF file from the computer. User explicitly answered "Both". These are planned capabilities; no existing files are to be deleted during planning.
14. Reduce the purple cast in whites when colors are inverted.

## Original implementation evidence (before the test changes)

- `src/main.ts`: lens has a 96px inner diameter and 2.5x magnification; CSS sets the outer lens to 130px.
- Scrollbar expands after one second and uses speeds [-1600, -150, 0, 150, 1600] px/s. Hover controls speed, while dragging maps to document position.
- Page chip fades after 1.6 seconds; no hover persistence currently implemented.
- Initial page scale is 30% of page-width. Double-click fit is not implemented.
- Recent documents and control positions are in localStorage.
- Inversion appears in three places: page CSS, the glass backdrop painter, and the lens. Keep these consistent. Current transform is contrast(0.8) invert(1) hue-rotate(180deg). A neutral grayscale should remain neutral under this filter; the purple cause needs visual diagnosis rather than assuming hue rotation alone is responsible.
- `src/glass.ts`: explicit dark tint, background-dependent tint amount, color separation at edges, and 4x linear-resolution supersampling. Pixelation has not been visually diagnosed. Increasing the resolution again is not yet justified.
- Installed PDF.js types expose getOutline() and getPageLabels(). Structured bookmarks are separate from a merely printed/scanned contents page.
- Previously observed reliability issue: askSave resolves true after save() even when save catches an error. Keep this separate from the user's design list; recommend addressing before implementation trials involving edited documents.

## Initial research

Sources consulted 2026-09-06; libraries have not been installed, rendered or benchmarked.

- Apple materials guidance: https://developer.apple.com/design/human-interface-guidelines/materials
  - Glass is intended for controls/navigation above content, used sparingly. Regular adapts luminosity for readability; clear is highly translucent and intended for visually rich backgrounds. For Folio, clearer glass needs readable icons against both white paper and dark content.
- Apple presentation: https://developer.apple.com/videos/play/wwdc2025/219/
- CSS/SVG reference: https://github.com/dpawlikowski/liquid-glass
  - Declares MIT; supports vanilla JS. Refraction relies on a duplicated scene/background. Integration with changing PDF canvases needs evaluation.
- WebGL reference: https://github.com/ybouane/liquidglass
  - Describes direct canvas capture plus refraction and adjustable edge effects. Declares MIT in README; inspect full licensing/dependencies before actual reuse. Possible source of techniques or replacement candidate, not an adopted dependency.
- Reading study: https://pubmed.ncbi.nlm.nih.gov/25135324/
  - Reports better proofreading performance with dark text on light backgrounds in its tested conditions.
- Reading study: https://pubmed.ncbi.nlm.nih.gov/36533999/
  - Effects depend on age and lighting; preference and measured performance are not equivalent. These studies do not establish an ideal dark hex color for Folio.

## Assistant proposals, not accepted decisions

- First compare a refined version of Folio glass with an external approach on the same PDF. Assess moving edges, clarity over white/black pages, Windows display scaling and rendering cost before choosing.
- Try neutral charcoal (#202020) and slightly warm charcoal (#242320) as background candidates. These are design samples, not scientifically optimal colors.
- Enlarge the lens viewing area while initially retaining 2.5x magnification.
- Use a broad chisel-tip highlighter and a general markup/toolbox icon for the annotation opener.
- Compare more speed bands with continuous acceleration around a central stop zone. Preserve the user's wish for hover auto-scroll unless they choose another interaction.
- Distinguish destination-page preview from the currently visible page. Hover speed and absolute destination compete for the same axis; decide how clicking/dragging/modifiers separate them.
- For destination access, propose hover to read the page number and click to jump; clicking has not yet been explicitly selected by the user.
- Offer distinct library actions, "Remove from library" and "Delete file". Prefer moving deleted files to the Windows Recycle Bin; this recovery behavior is an assistant proposal, not yet selected.
- Double-click could toggle fit-width and prior zoom. Account for the existing double-click text-selection gesture before choosing the active area.
- Use structured PDF outline/bookmarks for chapter navigation first; printed contents without metadata is a different, larger task. Respect printed page labels such as Roman numerals where available.
- Proposed sequence: choose visual direction and navigation behavior; implement reading/control refinements; implement page/chapter navigation and library removal; then apply broader UI work if desired.

## Questions pending

- Destination-page label is confirmed. How users activate a jump and combine it with automatic scrolling remains open.
- Background interpretation, lens size, fit-width versus fit-page, and exact double-click gesture can be refined during discussion.
