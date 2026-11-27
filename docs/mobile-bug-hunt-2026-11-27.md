# NEON Podcasts app — mobile bug hunt (Fri 2026-11-27, 11:01–11:17 ET)

Walk by Rockefeller (browser task, cloud browser). Jimmy's order: point man for the app, mobile-first. Matt DeReuter tests on his phone and hit two generation errors (screenshots pending).

## Limitation — read first
No true 390 px viewport. The browser presented a 1919 px-wide viewport and DevTools would not open, so device emulation could not be switched on. Nothing below was verified at exactly 390 px. Findings marked "measured" use fixed widths measured on screen against a 390 px viewport (about 358 px content width after padding). Findings marked "observed" were seen directly. A proper 390 px pass is still needed to confirm the overflow items and to hunt the reported generation modal.

Sign-in was already active on arrival (a "Sign out" button was shown; no sign-in prompt, no code). The wizard was completed through its review screen for a draft "Mobile Test Show"; NO show was created (did not click "Create show").

## Accidental generation — disclosed
"Generate now" on the 5:01 Diamond Hands show page has NO confirmation step. One tap starts a run immediately. A run started 11:12:22 AM, still "running" at 11:17 AM, no cancel control, no episode created. It will likely fail the same way the 10:25 AM run did (function timeout, see item 13). Do not start another run on this show until the 11:12 AM run resolves. Check Run history for its outcome.

## Findings

### Wizard — https://neon-podcasts.vercel.app/shows/new (31 steps + review)
1. Step-counter mismatch (observed, all steps): the number at top right disagrees with the number under the progress bar — e.g. step 1 shows "1/27" under the bar but "Step 1 of 29"; step 27 shows "27/29" vs "27/31"; step 4 showed "4/28" vs "4/30". The total changes as you answer. Confusing on any screen; on a phone the two numbers sit close together. Not blocking.
2. 1–5 scales overflow a phone (measured, steps 12 "How serious?" and 24 "How much humor?"): five ~83 px buttons plus gaps in one row, about 445 px wide — wider than a 390 px screen's ~358 px content width. They would overflow horizontally or squeeze below tappable size. Repro: go to step 12 or 24 on a 390 px screen. Likely blocking for accurate tapping.
3. 1–10 number row overflows a phone (measured, step 20 "How many stories?"): ten ~36 px buttons in one row, about 445 px wide — same overflow; on a phone each target would shrink to ~30 px or run off-screen. Likely blocking.
4. Review truncates multi-sentence answers (observed, BLOCKING for trust): entered "Never take a political side. Never share listener names." as hard-line rules (step 27). The review screen shows only "Never take a political side." Went Back to step 27 and confirmed the full two-sentence answer is still saved, so this is a review-display bug that drops everything after the first period — the user cannot trust the review. Repro: enter a two-sentence answer on step 27, go to Review, read "Any hard-line rules?".
5. Cancel does nothing on the review screen (observed, BLOCKING for exit): tapping "Cancel" at the top of the review left the page on the review with no visible change, no dialog, no navigation. On wizard steps Cancel is the only exit. Repro: finish the wizard, tap Cancel on the review screen. User must use the browser back button or the site title.
6. "Make the first full episode now?" Yes/No on the review has no default selected, and it is unclear what "Create show" does if neither is chosen. Minor.
7. Footer buttons (observed): Back / Skip for now / Next — "Skip for now" already wraps to two lines at desktop width; at 390 px each button is roughly 110 px wide, tight but tappable. Long single-line placeholders (steps 5–6) are cut off mid-text in the narrow field. Not blocking.
8. Step 30 host pick: the 9 host cards push Back/Skip/Next far below the fold, so a phone user scrolls a long way to continue. Minor.

### Home page — https://neon-podcasts.vercel.app/ (observed)
9. Header nav overflow (measured): Live, Browse, Following, Settings, Sign out plus the theme toggle span about 460 px or more — wider than 390 px, so on a phone the header must wrap or scroll. Needs a 390 px check.
10. Show-card tap feels dead (observed): tapping the "5:01 Diamond Hands" card in "Your shows" produced no visible response at first; the navigation to the show landed a beat later. On a phone this reads as a broken tap and invites double-tapping.

### Episode generation — https://neon-podcasts.vercel.app/shows/ce1a81ff-e44f-4c74-a092-c00926d3ead5 ("5:01 Diamond Hands")
11. "Generate now" submits with no confirmation, no cost, no summary, no cancel (observed, BLOCKING): one tap starts the run. The button then reads "Making it… (this can take a minute)" and is disabled, but there is no progress indicator and no way to stop it.
12. Progress state is lost on reload/navigation (observed, BLOCKING): after reloading, "Generate now" is enabled again while the run is still listed as "running" in Run history, so a phone user who reloads (or whose browser reloads) can tap again and start a duplicate run. Navigating away mid-generation shows no warning, no modal, and the home page shows no sign a generation is running.
13. "This can take a minute" is wrong (observed): the run was still "running" after 5 minutes. The same show's 10:25 AM run failed with "function timeout: generation exceeded serverless limit (~20min target too long to synth in one request)".
14. Matt's two generation errors are visible in Run history (observed, today before my run): 11/27 9:16 AM and 9:29 AM both failed with "reaped: hung before model call (research step, no timeout); manual cleanup 2026-11-27", plus the 10:25 AM function timeout. Two earlier runs succeeded (9:11 AM, 14:52, $0.05; 9:13 AM, 17:23, $0.06). A research-step hang is consistent with a source fetch stalling, but the history does not name the source, and no YouTube link was added (that would have modified the show's sources). The YouTube link angle is UNCONFIRMED.
15. THE MODAL WAS NOT REPRODUCED: no modal appeared at any point during generation in about 5 minutes of watching, on reload, or on navigating away, at the viewport used. It may appear only at phone width, or when a run fails/completes, but it could not be confirmed and cannot be said where it would break the flow. This needs a true 390 px re-test, ideally to a run failure.

### Edit page — https://neon-podcasts.vercel.app/shows/ce1a81ff-e44f-4c74-a092-c00926d3ead5/edit#schedule (via "Edit schedule")
16. The Schedule row puts "How often?", "At what time?" and "How long?" side by side in an ~800 px form; on a 390 px phone the time input and its picker/spinner would be cramped (measured, needs a 390 px check).
17. The "← Back to 5:01 Diamond Hands" link on the edit page did nothing when tapped — the page stayed on /edit#schedule and I had to navigate by URL (observed, BLOCKING for exit).
18. Minor: "Mark as NEON-official" appears three times on the show page (top, and under each episode).

## What was NOT done
No code was entered (none was asked for); no show was created (stopped at the review screen); no YouTube link was added; no second generation was submitted. The one generation run started at 11:12:22 AM (disclosed above) was still "running" at 11:17 AM with no episode created yet; it cannot be cancelled from the app.

## Recommended next steps
- Re-run this walk at a real 390 px viewport to confirm items 2, 3, 9 and 16 and to hunt the reported generation modal.
- Check the outcome of the 11:12 AM run in Run history.
- Add a generation confirmation/cancel plus persistent progress state before re-testing on a phone.
- Matt's screenshots, when they land, go with this list (per Jimmy's order).
