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
