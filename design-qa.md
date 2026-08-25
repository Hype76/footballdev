# Design QA

Reference: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-bb9e128d-f222-4a40-bb02-b80bfb513db3.png`

Implementation: `E:/Project Manager/FP-MOBILE-GAMEDAY-PLAYER-PICKERS-97/design-qa-implementation-viewport.png`

Focused dropdown state: `C:/Users/pulse/AppData/Local/Temp/fp-mobile-matchday-player-dropdown-97.png`

Combined comparison: `E:/Project Manager/FP-MOBILE-GAMEDAY-PLAYER-PICKERS-97/design-qa-comparison.png`

Viewport: 390 by 844 for the implementation. The supplied reference was 394 by 643 and showed the same Coach Add goal action sheet state at nearly identical width.

State: Live Match Day, Our Team goal action, match minute 80, action time captured independently from form completion.

Interaction checks:

- Opening Goal shows the captured match time and a focused, scrollable action sheet.
- Opening the Scorer choices shows only selected Match squad players.
- Selecting Steve King fills both `Steve King` and shirt `8`.
- Typing shirt `10` fills `Alex Green` and shirt `10`.
- Both fields remain directly typeable when the recorded data is missing or needs correction.
- Switching to Opponent clears the prior side's player values, closes any open dropdown, and displays Scorer, scorer shirt, Assist, and assist shirt labels as optional.
- Yellow card, Red card, and Substitution expose the same linked player and shirt controls.
- Saving a valid Red card closes the sheet after the server-confirmed result.
- A rejected save remains open and shows the server explanation inside the sheet.

Fidelity checks:

- Structure: The focused bottom sheet, title, captured-time pill, side selector, field order, notes, and save action follow the supplied Coach reference.
- Typography: Existing Coach mobile weights, sizes, and all-caps section label are preserved.
- Colour: Existing club-aware Coach palette and cyan action colour are preserved.
- Spacing: Field rhythm, rounded inputs, action spacing, and touch targets remain consistent with the current mobile design system.
- Responsive behaviour: The sheet uses its own scroll area and keyboard avoidance, with no horizontal clipping at 390 by 844.

Console review: No browser errors or warnings were present during the tested flow.

Comparison history:

- Initial state: Plain text fields, no assist shirt field, no player choices, no linked name and shirt behaviour, save errors hidden behind the sheet, and successful closure not verified.
- Final state: Searchable and typeable linked fields, optional opponent details, selected-squad protection for own-team cards and substitutions, inline save feedback, and confirmed sheet closure.

final result: passed
