## What this does

<!-- One paragraph. What changed, and why it was worth changing. -->

## Claims

<!-- Numbered, falsifiable, each with HOW it was verified. "56 checks,
13/13 mutations, suite green" is a claim a reviewer can re-run; "works
correctly" is not. Mark anything you could not verify as UNVERIFIED —
an honest gap survives review; a discovered one costs the next PR its
benefit of the doubt. -->

1.
2.

## Verification

- [ ] `npm test` green (state the check count)
- [ ] `npm run mutate` run for every audit whose target files this PR touches (state N/N caught, or "no calibrated audit touched")
- [ ] Verified in the built app where Node cannot see it — or state plainly why not

## Debts and flags

<!-- What this PR knowingly leaves open: unexercised live paths, workarounds
relied on, files deliberately left out of the commit. Nothing here blocks
merge by itself — hiding one does. -->

-
