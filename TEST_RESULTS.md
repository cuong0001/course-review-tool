# Review workspace verification — 2026-11-13

- **`npm test`:** 12 unit tests passed, 0 failed. The 4 new tests cover:
  - field-level diffs, with review metadata ignored;
  - readable labels;
  - word-level diffs;
  - `build-dsa-snapshot.cjs --compare-with` recording changes while leaving records byte-identical.
- **All four browser suites passed in Chrome through `file://`.**
  - In the existing suites, `review-diff.js` was added to the copied file list, and the assignment test now reads its expected counts from the bundled data.
  - The new `review-flow.cjs` covers:
    - the what-changed panel (before/after rendered, exact word diff);
    - the LaTeX source tooltip and toggle, persisted;
    - Alt+arrows, J/K, U, N, F, T, / and ? shortcuts, with letters typed into notes staying in notes;
    - search over IDs, text and notes, with Enter and Esc;
    - the empty-state "Clear search and filters";
    - after a decision, moving to the following item rather than the top;
    - Undo, and Undo being withdrawn after a later edit;
    - the disabled-button explanation;
    - the shortcut dialog;
    - focus mode and text size, persisted;
    - dark theme and 375 px with no horizontal scroll;
    - no page errors and no network requests.
- **Screenshots inspected:** the desktop changes panel, the LaTeX source toggle, and the dark-theme layout at 375 px.
- **Not done:** no Edge/Firefox/Safari run, no physical phone, and no screen-reader session.
- **Snapshot rebuilt** from candidate run `20261113T051109Z`, using `--compare-with` against `data/curated`.
  - Contents: 90 approved questions excluded, 486 pending questions, 21 guides, 401 changed items (157 previously approved).
  - Owners were kept; the 139 newly pending questions were spread 23–24 per member, giving 81 questions each.
  - The pinned values in `assignments.test.cjs` were updated to match.
  - **Bug found and fixed:** on this real data, `math-readability.cjs` found 30 complexity-table cells that fell back to raw text. Cells containing `$` were being passed whole to KaTeX. `$`-delimited cells now render inline.
  - After the fix, all 2,668 real formulas render with no fallback.
- **Also inspected:** a screenshot of a real changed question (Q_T01_1_01, "was approved by An").

# Offline math and reading UI verification — 2026-11-12

## Results

- `npm.cmd test`: 8 unit tests passed, 0 failed. Assignment coverage, approved exclusions, stable owners, Unicode names, saved-state contracts, approval gating, and stale decisions remain covered.
- `npm.cmd run test:browser`: all three Chrome suites passed through `file://`. Existing review/import/export and six-member assignment suites remain intact.
- The new math/readability suite rendered **253 formulas from the real bundled DSA snapshot**, with **zero fallback errors**. It additionally verified all four math delimiters; rendering in question stems, options, explanations, and complexity tables; accessible MathML; literal inline/fenced code; malformed-math fallback; and non-execution of imported HTML or untrusted math links.
- The local KaTeX font loaded successfully. No HTTP(S) requests, failed asset requests, or page JavaScript errors occurred.
- Light/dark theme persistence, 375 px layout, and 200% text enlargement passed. Desktop question, desktop lesson, dark lesson, and phone lesson screenshots were saved to temporary folders and visually inspected.
- `git diff --check`: passed.

## Implementation boundaries

The five runtime views use a shared safe DOM formatter plus local KaTeX 0.19.1 from the course project's pinned assets. WOFF2 fonts are embedded in CSS to avoid local-file font restrictions. Its MIT license is preserved in `vendor/katex/LICENSE.txt`.

The page layout and typography follow the course project's light/dark blue palettes: queue and filters in a sidebar, content in a reading panel, notes and verification beside it on wide screens. Narrow layouts stack the panels; code, tables, and large formulas scroll locally. Enlarged source identifiers wrap.

The DSA snapshot, six-member allocation, canonical course dataset, existing review decisions, and export contracts were not changed by this work. Browser test edits occur only in temporary contexts and are never applied to canonical data.

## Known limits

KaTeX supports mathematical LaTeX, not arbitrary TeX documents or packages. Invalid/unsupported expressions remain visible as source with a warning style for review. Code examples deliberately preserve math-like text literally. No physical mobile device or Edge/Firefox/Safari run was performed. Source accuracy and code correctness still need human review. Refresh the read-only snapshot when canonical data changes, as documented in README.md.
