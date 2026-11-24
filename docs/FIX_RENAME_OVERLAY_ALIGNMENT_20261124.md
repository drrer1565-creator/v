# Template rename, overlay editing, and tab-safe alignment

Base: `release/v4.6.10` (`9338a34c60b0bfd6eb45de29b568b4ee4bccb493`).

## Changes

- Template/project/folder rename uses the existing Electron-safe input dialog rather than a contenteditable title inside a draggable card. Cancel, save failure, and library refresh cannot strand the inline-edit lock.
- Media availability compares against the last recorded status even after its 15-second TTL expires. A healthy file remaining healthy no longer emits a false change notification. Real deletion/recovery still refreshes the preview, retaining the selected overlay by ID.
- Alignment captures tasks, owning tabs, relative-media directories, all text candidates, text column, language, model, and alignment options before the first asynchronous request. Serial and parallel workers share that run; workers never apply whichever tab DOM is currently visible.
- Results resolve the original tab and task ID, preserve unrelated style/volume edits, and reject application after source text/media changes or task deletion. Completed tasks mark the original tab dirty so cached workspace saves include their results.
- Duplicate audio/text followers use the same guarded commit path and can still reuse parsed subtitle segments. Parallel workers no longer masquerade as explicit single-row forced realignment.
- Failed realignment does not clear the live task's previous SRT link or explicitly delete its old SRT before a successful result is available.

## Verification

`tests/reels-edit-align-isolation.test.js` executes production functions with mocked API responses. It covers populated and blank destination tabs, switching while configuration is pending, serial fallback, stable matching candidates, parsed-SRT duplicate reuse, reordered/deleted tasks, changes during requests, preserved unrelated edits, failed realignment, media TTL expiry and genuine transitions, overlay selection restoration, and repeat rename/cancel/failure recovery.

A separate DOM smoke check with the actual input dialog verified focus, saving during card replacement, cancelling, and renaming again within the same session. `npm run build` validates the production web bundle.

The API tests use simulated transcription responses and local SRT content. They do not call paid transcription providers. A native Windows/Electron UI acceptance run remains necessary before publishing a Windows release: right-click rename/type/delete/cancel/retry; leave scrolling properties open beyond 30 seconds; align 16 rows with two workers while switching between populated tabs and then a blank tab; reopen the original tab and verify SRT links.

## Results

- New regression suite: 14/14 passed.
- Full `npm test`: 164 passed, 1 failed. The same CLI `A2 & A8` assertion also fails on the unmodified `9338a34` baseline: the existing attribution cue ends at `3.03s`, while the test expects `3.00s`. The CLI test and render path are unchanged by this patch.
- `npm run build`, JavaScript syntax checks, and `git diff --check` passed.
- DOM rename smoke check passed (focus, background card replacement, cancellation and repeated rename).
