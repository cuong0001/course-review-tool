# DSA assignment verification — 2026-11-12

## Dataset and allocation

Read the canonical CSC10004 DSA dataset without modifying it: 576 questions, with 229 approved, 346 pending, and 1 needing revision; 21 reading guides needing real human review. Only the 347 eligible questions and 21 guides are included in the read-only browser snapshot.

The six members are Cường, Hiếu, An, Hải, Huy, and Khánh. Question counts are 58/58/58/58/58/57 and reading-guide counts are 4/4/4/3/3/3. Every eligible record has exactly one owner. The canonical dataset, apply script, validator, workbooks, and manifest remain in the course project and were unchanged.

## Commands and results

- `npm.cmd test`: 8 tests, 8 passed, 0 failed. Checks include exact dataset counts, approved exclusions, unique complete ownership, balanced batches, Vietnamese names and legacy aliases, stable assignment refresh, approval gating, stale-decision invalidation, and package validation.
- `npm.cmd run test:browser`: both suites passed in installed headless Chrome through `file://`. The existing suite covers import/export, notes, flags, reload, conflicts, source changes, keyboard access, optional types, and storage failure using synthetic fixtures. The new suite checks all six names, automatically loaded real DSA assignments without file selection, exact counts, member-only queues, isolated notes, reload recovery, owner overview, and 375 px layout. No network requests occurred.
- `git diff --check`: passed.

Screenshots were saved to system temporary folders; the member view was visually inspected. The snapshot generator is idempotent for unchanged inputs and retains owners on refresh. All tests of content changes use temporary files or browser profiles; no real-data decisions were applied.

## Known limits

This is a read-only snapshot, not a live connection to the course repository. Run the documented snapshot refresh command after canonical data changes and redistribute the tool. Existing saved notes remain available in owner overview if their items were allocated to another member; authorship is not silently rewritten. Unsupported math remains source notation. Source accuracy and code correctness still require real human review. No physical mobile test or Edge/Firefox/Safari run was performed.

The assignment feature does not change the version-1 review-package or finalized-decision contracts. Python application/rollback tests remain in the course repository; they are unaffected by this UI-only addition.
