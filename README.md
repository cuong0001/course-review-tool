# Course review tool

A standalone offline review workspace for the Intelligent Study Companion team. Each person works independently and sends an exported file to the owner.

## Download and open

Download this private repository using **Code > Download ZIP**, extract the ZIP, open the `review-pages` folder, and double-click the page for your course:

| Course | Page |
|---|---|
| Data Structures and Algorithms | `review-pages/dsa.html` |
| Object-Oriented Programming (CSC10003) | `review-pages/oop.html` |
| Computer Networks (CSC10008) | `review-pages/cn.html` |

Keep the extracted files together: the pages load their styles, scripts and data from the folder above them.

## Review in five steps

1. Keep the extracted folder whole: the `review-pages/`, `data/` and `vendor/` folders and the `.css` and `.js` files next to them. Double-click a page in **review-pages** (for DSA, `dsa.html`) to open it in a current Chrome or Edge browser.
2. Choose your name at the top: **Cường**, **Hiếu**, **Hải**, **An** or **Khánh**. Your assigned items load automatically.
3. Read the item. The question (or reading guide) fills most of the screen. The correct answer is marked **✓**, and the reason each wrong answer is wrong is shown under it.
4. Decide, in the panel on the right:
   - **Approve** if it is correct. Approving confirms the checklist shown when you hover the button: the source supports it, the answer is correct, each wrong answer is wrong for a stated reason, and the facts and code are accurate.
   - Otherwise write what should change in **Notes**, then choose **Needs changes**, or **Reject** if the item should be removed.
   - For a reading guide, hover a section and click **+ Note** to leave a note on that section.
   - **Flag an issue** marks an item to come back to. A flagged item cannot be approved until the flag is cleared.
5. Click **Export** before closing and send the downloaded JSON file to the owner. Keep a copy yourself. The file holds your notes, flags and decisions, including unfinished ones.

**Saved** (top right) means saved in this browser profile for this HTML location. Reopening the page restores your name, your position and your notes. Moving the folder, changing browsers, private browsing or clearing browser storage can lose the save, so export regularly. If you see **Not saved—export a backup**, keep the window open and export immediately.

The **⋯** menu holds everything else: dark mode, text size, showing LaTeX source, hiding the queue, keyboard shortcuts, **Export finalized decisions**, **Import review package** (to resume on another device; a conflicting import is refused without overwriting local work), **Load newer dataset files**, and the team allocation.

Reading guides come first. Questions are grouped by topic; approved questions are excluded. Resources and activities appear only after ticking **Include resources and activities** in the queue. Missing sources and licences show as warnings. Never approve something you have not actually checked.

LaTeX renders through the bundled KaTeX and its local fonts: `$...$`, `$$...$$`, `\(...\)` and `\[...\]` are supported, and inline formulas sit on the text line. Code samples stay literal. A formula that cannot render shows its source in a warning style, so it can still be noted. No network request is needed. The tool does not compile code or check sources by itself. Avoid editing the same reviewer workspace in several tabs at once.

## Working faster

- **Queue.** Hover the thin rail on the left (or press `/`) to open the queue, its filters and search. Each entry shows its status: Not started, In progress, Flagged, Approved, Needs changes or Rejected. **Show → Changed since last version** lists only items that changed.
- **Search** (`/` or Ctrl+K) matches IDs, item text and your own notes. Enter opens the first match; Esc clears the search.
- **Only the current version is shown.** Review the item as it is now; there is no before/after comparison.
- **LaTeX source.** Hover a formula to see its source, or turn on **⋯ → Show LaTeX source** (`T`) to print it under every formula.
- **Navigation.** **‹ ›** and **Next unfinished** sit at the top of the item. Finishing an item that leaves the current view moves you to the item after it, not back to the top.
- **Undo** appears after a decision and restores the item exactly as it was. Any later edit to that item withdraws it, so newer notes are never overwritten.
- **Hide the queue** (in the ⋯ menu) gives the item the full width. View preferences are remembered in this browser and never contain course content.

| Keys | Action |
|---|---|
| Alt+→ / Alt+←, or J / K | Next / previous item |
| U | Next unfinished item |
| / or Ctrl+K | Search |
| N | Notes |
| F | Flag or unflag |
| T | Show or hide LaTeX source |
| ? | All shortcuts |

Single-key shortcuts are ignored while you type in a box. No shortcut makes a decision.

## Reading and reviewing

The layout is deliberately minimal: one slim header row, the item across most of the width, and a small notes-and-decision panel on the right. The queue and the tools stay hidden until you hover or open them. On narrow screens the queue, the item and the panel stack. Code samples, wide tables and large equations scroll inside their own areas and can be reached by keyboard.

Dark mode is remembered locally. Notes, flags, decisions and position save automatically. Export before finishing.

KaTeX 0.19.1 is copied from the course project's pinned distribution. Its fonts are embedded in the local stylesheet for reliable `file://` use. The MIT license and source information are under `vendor/katex/`.

## DSA allocation

The bundled read-only snapshot is built from the candidate dataset of run `20261113T071319Z` (repairs for the Codex and Gemini pre-human audits and their re-audits, on top of the notation pass). It is compared with the current course data (`data/curated`). Its contents:

- **90 approved questions**, excluded from review;
- **486 pending questions**;
- **21 reading guides**, which need real review despite their old demo approval labels;
- **400 items marked *changed***, 156 of which were approved in the course data.

Choose **Show → Changed since last version** to see only the changed items. The snapshot is a review copy; the canonical dataset stays in the course project, which this tool does not change.

| Member | Questions | Reading guides |
|---|---:|---:|
| Cường | 98 | 5 |
| Hiếu | 97 | 4 |
| Hải | 97 | 4 |
| An | 97 | 4 |
| Khánh | 97 | 4 |

Questions were first split by topic into contiguous, balanced batches. When the snapshot was refreshed, existing owners were kept. The 139 newly pending questions went to the least-loaded members, 23–24 each. Reading guides are split by topic. When An left the team (2026-11-18), An's 81 questions and 4 reading guides went to the least-loaded remaining members, and everyone else kept their items. On 2026-11-23 An returned and took over all of Huy's items, unchanged, in every course; Huy is no longer on the team. See [DSA_ASSIGNMENTS.md](DSA_ASSIGNMENTS.md) for every assigned ID. Assignments do not modify course approval status.

**All assignments (owner overview)** shows the team's full workload. Switching names returns to that member's assignment. Previous saved notes outside the new allocation are preserved and can be inspected in the owner overview. Existing unaccented saved/imported names such as `Hieu` remain accessible and match the corresponding member's allocation without rewriting authorship.

When course data changes, refresh the bundled snapshot from this repository:

```bash
node scripts/build-dsa-snapshot.cjs "PATH_TO_COURSE_PROJECT/data/curated"
```

To let reviewers see what changed (for example a notation-only run), also pass the older dataset:

```bash
node scripts/build-dsa-snapshot.cjs "PATH_TO_NEW/data/curated" --compare-with "PATH_TO_OLD/data/curated" --label "run 20261113T071319Z"
```

Each changed question or guide then carries a field-level change list (`DSAReviewData.changes`). The records themselves stay byte-for-byte the course data, so their fingerprints are unaffected. Loading newer JSONL files in the tool gives the same panel, compared with the bundled version.

This reads the canonical files without changing them, updates source hashes and the assignment report, preserves existing owners, excludes newly approved questions, and assigns new pending IDs to the least-loaded member. Changed content requires renewed verification while retaining notes. Commit and distribute the refreshed tool; offline copies cannot detect later course changes automatically.

## OOP and Computer Networks preview

Two more courses can be reviewed the same way:
- **Object-Oriented Programming (CSC10003):** double-click `review-pages/oop.html`.
- **Computer Networks (CSC10008):** double-click `review-pages/cn.html`.

Each course page keeps its own saves and its own export file, separate from DSA. Export from each page you worked on and send every file to the owner.

These are candidate datasets from run `20261117T111338Z`. They are not yet in the course project. Every item is pending: nothing is approved yet.

**Before this review, the content was checked automatically:**
- an independent agent re-solved every question;
- all C++ was compiled with `g++ -std=c++17` and its output compared with the stated output;
- source links were reopened.

That does not replace your check. Approve only what you have verified yourself.

| Member | OOP questions | OOP reading guides | CN questions | CN reading guides |
|---|---:|---:|---:|---:|
| Cường | 46 | 6 | 59 | 8 |
| Hiếu | 46 | 6 | 59 | 8 |
| Hải | 46 | 6 | 58 | 7 |
| An | 45 | 6 | 58 | 7 |
| Khánh | 45 | 6 | 58 | 7 |

Resources and activities (OOP 167 and 12, CN 161 and 4) appear after ticking **Include resources and activities**.

**Read these items with extra care:**
- topics `OOP_T04_2`, `OOP_T04_3` and `OOP_T06_1`, and topics `CN_T04_1`, `CN_T04_2`, `CN_T05_3` and `CN_T05_4`. These were not re-reviewed by an independent agent in the last repair;
- `Q_CN_T10_1_04` and `Q_CN_T10_1_08`, whose automatic re-solve was not fully blind.

In some questions the correct option is still noticeably longer than the others. This is a known style issue, not an error. Note it if you like, but it is not a reason to reject.

## Owner handoff

The dataset, apply script, validator, Excel workbooks, and manifest stay in [Intelligent-Study-Companion](https://github.com/cuong0001/Intelligent-Study-Companion). See its [review workflow](https://github.com/cuong0001/Intelligent-Study-Companion/blob/review-tool/docs/REVIEW_WORKFLOW.md) for the owner-controlled apply steps. Run those commands from the course project, not this repository. This repository never writes the dataset.

## Export contracts

Review packages use `format: "course-review-package"`, `version: 1`, `reviewer`, UTC `exported_at`, resume `position`, and `items`. Each item contains `item_type`, `id`, and `state`: `notes`, `sections` keyed by block ID, `flag`, `checks`, nullable `decision`/`decided_at`, `updated_at`, and a SHA-256 `fingerprint` of the imported record. JSON object key ordering changes can conservatively trigger renewed review. Imported content is never executed.

Finalized exports retain the requested version-1 contract:

```json
{"version":1,"reviewer":"Hải","exported_at":"2026-11-12T02:00:00Z","decisions":[{"item_type":"question","id":"Q_T00_1_01","decision":"approve","comment":"","checks":{"source_supports":true,"correct_answer":true,"distractors_explained":true,"facts_code_accurate":true},"decided_at":"2026-11-12T01:00:00Z"}]}
```

The apply script accepts only this decision export, not the richer review package. It changes only review status, reviewer, timestamp, and comment. Lesson fields live under `provenance`; videos use the authorized `review_status` field plus review metadata. No content or version fields are changed.

## Development and tests

Reviewers do not need Node or npm. Developers can run the dependency-free state tests with `npm test` (or `node --test tests/unit/*.test.cjs`).

For browser tests only, install Node 20+, run `npm ci`, install Chrome, and run `npm run test:browser`. On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is disabled; no policy change is needed. Import/export tests use synthetic fixtures under `tests/fixtures/`; assignment tests inspect the bundled read-only DSA snapshot. No course checkout is needed. They open the pages in `review-pages/` through `file://` and write samples and screenshots to the system temporary directory.

Do not commit real review exports or personal notes. `review-*.json` and `decisions*.json` are ignored. See `TEST_RESULTS.md` for verification and known limits.
