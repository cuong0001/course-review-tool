# Course review tool

A standalone offline review workspace for the Intelligent Study Companion team. Each person works independently and sends an exported file to the owner. The tool never edits the course dataset.

## Download and open

Download this private repository using **Code > Download ZIP**, extract the ZIP, then double-click `review.html`. Keep the extracted files together. Reviewing requires no installation, server, or internet connection. The owner must give teammates access to this private repository before they can download it.

If you used the old tool inside the course project, export a review package there before switching folders. Browser saves are tied to the old HTML location. Import that package here to resume. The package and finalized-decision formats are unchanged.

## Review in five steps

1. Keep this folder together: `review.html`, `review.css`, `review-core.js`, `review-renderers.js`, `review-assignments.js`, `review.js`, and the `data/` and `vendor/` folders. Double-click **review.html** to open it in a current Chrome or Edge browser.
2. Choose **Cường**, **Hiếu**, **An**, **Hải**, **Huy**, or **Khánh**. Your assigned DSA content appears automatically.
3. Choose **Reading guides** or **Questions**. By default, only your assignment is shown. No file picker is needed. The optional **Load newer / additional dataset files** control can replace snapshot records with newer course files; source links open only when clicked.
4. Choose a review type and topic. Read the item and open its sources. Write overall notes or notes beside a reading-guide section. Flag problems. Your notes save as you type. Use **Next** to continue without making a final decision. When finished, choose **Verified**, **Needs fixes**, or **Reject**. Verification requires every check and no unresolved flag; the other decisions require notes. Editing a finalized review returns it to in-progress.
5. Click **Export review package** before closing and send the downloaded JSON file to the owner. Keep a backup yourself. The package includes unfinished notes, flags, section notes, checks, and final decisions.

**Saved locally** means saved in this browser profile for this HTML location. Reopening the page restores your selected member, current item, and notes. Assigned DSA content loads automatically. Moving the folder, changing browsers, private browsing, or clearing browser storage can remove access to the save. Export regularly. If you see **Not saved—export a backup**, keep the window open and export immediately.

Use **Import review package** to resume on another device. It restores the reviewer name too. Reviews for different people stay separate. A conflicting import is refused without overwriting local work: export the local workspace first and inspect the other package in a different browser profile. There is no automatic multi-person merge.

Reading guides are highest priority even though the old data claims they were approved. Questions include pending items first, grouped by topic, then items needing revision. Existing approved questions are excluded. Resources and activities appear only after checking **Include resources and activities**. Videos are the final review type. Missing sources and licenses are displayed as warnings; never tick a verification check you have not actually performed.

Lesson text, code, tables, and all trace steps are visible. Full block data remains available in expandable sections. Basic Markdown and inline code are formatted. LaTeX renders through the bundled KaTeX renderer and embedded local fonts: `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` are supported. Code samples remain literal. Invalid formulas show their original source with a warning style, so they can still be flagged. No CDN or network request is needed. The tool does not compile code or verify source claims automatically. Avoid editing the same reviewer workspace in multiple tabs at once.

## Reading and reviewing

The layout follows the course project's reading styles: assignment filters and the queue on the left, readable lesson/question content in the center, and notes plus verification controls beside it on wide screens. On smaller screens these sections stack. Previous/Next controls sit above the content. Code samples, wide tables, and large equations have their own scroll areas and can be reached by keyboard.

Use **Dark mode** / **Light mode** to choose the project-style palette; that choice is remembered locally. Review notes, checklist ticks, decisions, and item position keep the same automatic-save behavior as before. Export a review package before finishing.

KaTeX 0.19.1 is copied from the course project's pinned distribution. Its fonts are embedded in the local stylesheet for reliable `file://` use. The MIT license and source information are under `vendor/katex/`.

## DSA allocation

The bundled read-only snapshot has **229 approved questions excluded**, **346 pending questions**, **1 question needing revision**, and **21 reading guides** requiring real review despite their old demo approval labels. The snapshot is a review copy; the canonical dataset stays in the course project.

| Member | Questions | Reading guides |
|---|---:|---:|
| Cường | 58 | 4 |
| Hiếu | 58 | 4 |
| An | 58 | 4 |
| Hải | 58 | 3 |
| Huy | 58 | 3 |
| Khánh | 57 | 3 |

Questions are sorted by topic and split into contiguous, balanced batches; the revision question is included after pending work. Reading guides are split by topic. See [DSA_ASSIGNMENTS.md](DSA_ASSIGNMENTS.md) for every assigned ID. Assignments do not modify course approval status.

**All assignments (owner overview)** shows the team's full workload. Switching names returns to that member's assignment. Previous saved notes outside the new allocation are preserved and can be inspected in the owner overview. Existing unaccented saved/imported names such as `Hieu` remain accessible and match the corresponding member's allocation without rewriting authorship.

When course data changes, refresh the bundled snapshot from this repository:

```bash
node scripts/build-dsa-snapshot.cjs "PATH_TO_COURSE_PROJECT/data/curated"
```

This reads the canonical files without changing them, updates source hashes and the assignment report, preserves existing owners, excludes newly approved questions, and assigns new pending IDs to the least-loaded member. Changed content requires renewed verification while retaining notes. Commit and distribute the refreshed tool; offline copies cannot detect later course changes automatically.

## Owner handoff

The dataset, apply script, validator, Excel workbooks, and manifest stay in [Intelligent-Study-Companion](https://github.com/cuong0001/Intelligent-Study-Companion). See its [review workflow](https://github.com/cuong0001/Intelligent-Study-Companion/blob/review-tool/docs/REVIEW_WORKFLOW.md) for the owner-controlled apply steps. Run those commands from the course project, not this repository. This repository never writes the dataset.

## Export contracts

Review packages use `format: "course-review-package"`, `version: 1`, `reviewer`, UTC `exported_at`, resume `position`, and `items`. Each item contains `item_type`, `id`, and `state`: `notes`, `sections` keyed by block ID, `flag`, `checks`, nullable `decision`/`decided_at`, `updated_at`, and a SHA-256 `fingerprint` of the imported record. JSON object key ordering changes can conservatively trigger renewed review. Imported content is never executed.

Finalized exports retain the requested version-1 contract:

```json
{"version":1,"reviewer":"An","exported_at":"2026-11-12T02:00:00Z","decisions":[{"item_type":"question","id":"Q_T00_1_01","decision":"approve","comment":"","checks":{"source_supports":true,"correct_answer":true,"distractors_explained":true,"facts_code_accurate":true},"decided_at":"2026-11-12T01:00:00Z"}]}
```

The apply script accepts only this decision export, not the richer review package. It changes only review status, reviewer, timestamp, and comment. Lesson fields live under `provenance`; videos use the authorized `review_status` field plus review metadata. No content or version fields are changed.

## Development and tests

Reviewers do not need Node or npm. Developers can run the dependency-free state tests with `npm test` (or `node --test tests/unit/*.test.cjs`).

For browser tests only, install Node 20+, run `npm ci`, install Chrome, and run `npm run test:browser`. On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is disabled; no policy change is needed. Import/export tests use synthetic fixtures under `tests/fixtures/`; assignment tests inspect the bundled read-only DSA snapshot. No course checkout is needed. They open `review.html` through `file://` and write samples and screenshots to the system temporary directory.

Do not commit real review exports or personal notes. `review-*.json` and `decisions*.json` are ignored. See `TEST_RESULTS.md` for verification and known limits.
