# Standalone extraction verification — 2026-11-12

The interface was extracted from the course project's `review-tool` branch, commit `4d6bb02`. Its five runtime files are unchanged. The apply script, validator, data files, and Python tests remain in the course project. The interface tests now use deliberately synthetic fixtures committed here; they do not read a course checkout.

## Results

- `npm.cmd ci --ignore-scripts --offline --no-audit --no-fund`: installed 3 development packages from the local npm cache.
- `npm.cmd test`: 5 tests, 5 passed, 0 failed.
- `npm.cmd run test:browser`: PASS for offline import, lesson notes, reload recovery, question decisions and navigation, flags, export/import, reviewer separation, conflicts, source changes, 375 px layout, keyboard focus, and storage failure; no network requests. Optional resource/activity views and missing-video-license warnings were also checked.
- `git diff --check`: passed before publication.

The browser suite runs against local `file://` in installed headless Chrome, using this repository's own development dependencies. It saves screenshots and temporary sample edits under the system temporary directory. It requires no course-project checkout or dataset. The normal reviewer workflow requires no npm installation.

The course project's existing full Python application suite passed all 12 tests before extraction, including rollback and full validator execution on temporary data. Those Python tests are maintained there, not duplicated here.

## Limits

The browser save location changes when moving the HTML. Export from the old location and import the review package at the new location to preserve progress. Existing export contracts are unchanged.

No human walkthrough in a visible window, physical mobile test, or Edge/Firefox/Safari check was performed for this extraction. Test fixtures are not validated educational material. Unsupported math remains source notation; no external renderer is loaded. Source accuracy must be checked by a human. Do not edit the same reviewer workspace in multiple tabs simultaneously.
