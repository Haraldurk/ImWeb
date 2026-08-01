---
name: new-audit
description: Turn a just-fixed bug into a permanent invariant audit in tests/, in the established shape. Use after fixing any bug whose failure mode was silent, or when a rule currently lives only in prose.
---

# Adding an invariant audit

ImWeb has no CI. The four scripts behind `npm test` **are** the test system, and
each one exists because a specific bug got through. This skill adds the next one.

## When an audit is warranted

Write one when the bug you just fixed has any of these properties:

- **The failure mode was silent** — a plausible picture, a believable number, a
  dropdown that resolves to the wrong-but-valid thing.
- **The rule can't be enforced at runtime** — a per-frame hot path can't throw,
  so the invariant has to be checked statically instead.
- **The invariant spans files** — a list in one file and its consumers in five
  others, where nothing forces them to agree.

Do *not* write one for a bug that already fails loudly, or that a hook catches.

## The shape

Every audit in `tests/` opens with a header explaining itself. Match it — the
header is the most valuable part, because it tells the next reader why they may
not weaken the test.

```js
/**
 * <Name> audit.
 *
 * Why this exists. <The invariant, stated positively.>
 *
 * <What actually went wrong, concretely — the real numbers, the real wrong
 * picture. "It handled 16 of 29 for a long time and nothing complained,
 * because the failure mode is a plausible-looking picture.">
 *
 * <Why it can't be a runtime check, if that's the reason it lives here.>
 *
 * Run:  node tests/audit-<name>.mjs
 */
```

Then the checks. Two established styles — pick by what you need:

**Registry style** (`audit-capture-base.mjs`) — instantiate the real
`ParameterSystem`, call `registerCoreParameters`, assert against live objects.
Use when the invariant is about registered params.

```js
import { ParameterSystem, registerCoreParameters } from '../src/controls/ParameterSystem.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ... checks ...

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll <name> checks passed.\n');
process.exit(failures ? 1 : 0);
```

**Static style** (`audit-source-resolution.mjs`) — `readFileSync` the source and
parse it. Use when the thing you're checking can't be imported: a function body,
a render-loop expression, a serializer that needs a WebGL context to construct.

## Rules the existing audits follow

- **A failing audit must name the fix.** `audit-source-resolution.mjs` prints
  which sources fall through *and* what to do about it. Print the remedy, not
  just the discrepancy.
- **Check every path, not the one you're thinking of.** That audit reported a
  clean 30/30 while checking only one of two resolvers. If there are two write
  paths and four load paths, assert all six.
- **Write it before the change when you can.** `audit-capture-base.mjs` was
  committed while the migration was still an identity transform, so it would
  fail the day an append made it real. An audit written in advance is the only
  kind that catches the thing prospectively.
- **Assert a relationship with a direction, and check the margin isn't
  marginal.** A threshold a dead knob would nearly pass is not a test.

## Wire it up

Append to the `test` script in `package.json`:

```json
"test": "node tests/audit-source-resolution.mjs && node tests/audit-capture-base.mjs && node tests/audit-panel-coverage.mjs && node tests/audit-sdf-migration.mjs && node tests/audit-<name>.mjs"
```

The `audit-after-edit` hook runs `npm test` automatically after edits to
`ParameterSystem.js`, `main.js`, `Pipeline.js`, `src/inputs/*`, `src/shaders/*` —
so a new audit starts guarding those paths the moment it's in the script.

## Verify it actually fails

Run it against the broken state — revert the fix, or hand-edit a fixture — and
confirm it reports the failure. An audit never seen to fail is not evidence.

```bash
npm test
```
