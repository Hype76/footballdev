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

---

# Mobile icon and density design QA

## Scope

- Coach mobile compact icon system, Home, More, Quick Add, Players, Settings, Match Day, Game Mode, and Formation Board.
- Parent mobile compact Home, active child context, summary actions, fixture and calendar cards, and bottom navigation.
- Club accent is the normal action and navigation colour. Success, warning, unavailable, and destructive states retain semantic colours and text labels.

## Visual sources

- Coach Home: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-b56bff26-d7a8-4e48-a8d5-1e2cebe09a54.png`
- Coach operational Home: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-244cb8df-9da3-46db-b7ee-f5124d266f60.png`
- Coach Match Day: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-9db93996-26c8-428d-a9cb-b34416dd455e.png`
- Coach More: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-8fcdaefa-4895-44d7-b55a-c129f0d586a1.png`
- Coach Settings: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-4c1b6566-3a49-4b22-89dd-77bbfe0b9f9b.png`
- Coach Formation Board: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-3956060f-453e-4789-acf9-f7bd070095af.png`
- Coach Game Mode: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-205a260d-e382-4cd4-aa00-50e07f168441.png`
- Parent Home: `C:/Users/pulse/AppData/Local/Temp/codex-clipboard-18e7e3e5-d794-474d-b4d4-16f9be802c70.png`

## Local render evidence

- Coach production web export: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/apps/coach-mobile/dist-web-check`
- Parent production web export: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/apps/parent-mobile/dist-web-check`
- Comparison viewport: 375 by 812 pixels.
- Combined reference and implementation comparison: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/comparison-final.png`
- Coach Home: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/coach-home-final.png`
- Coach More: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/coach-more.png`
- Coach Quick Add: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/coach-quick-add.png`
- Coach Players: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/coach-players.png`
- Coach Formation Board: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/coach-formation.png`
- Coach Game Mode: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/coach-matchday-live-final.png`
- Parent Home: `E:/Project Manager/FP-MOBILE-ICON-DENSITY-REFRESH/output/playwright/parent-home.png`

## Comparison history

1. The supplied before and after screenshots were inspected at original resolution before implementation.
2. Both real Expo apps were exported successfully with the installed Material Icons font bundled.
3. A local-only populated visual state was exported for comparison, with no live account or service access.
4. The Codex in-app browser runtime could not open the local preview, so capture paused until the user explicitly authorised local Playwright.
5. Playwright captured Coach Home, More, Quick Add, Players, Formation Board, Game Mode, and Parent Home at 375 by 812.
6. The first Game Mode comparison showed the live controls below redundant fixture navigation, a duplicated action, and the Quick Add button over the control grid.
7. Game Mode was changed to open directly on the live controller, the duplicate action was removed, and the default Quick Add position moved to the upper right.
8. The final side-by-side comparison confirms the compact hierarchy, consistent icon family, club-aware normal actions, semantic Yellow, Red, and Full Time treatments, and unobstructed Match Day controls.
9. Browser console review found only the expected Expo notifications web warning and a missing local favicon. No application render error was present.

## Result

`final result: passed`

The final local candidate matches the supplied compact icon direction at the tested mobile viewport. No push, OTA publication, native build, store submission, production authentication, or live data mutation was performed.
