/**
 * Service worker cache-bump audit.
 *
 * Why this exists. `public/sw.js` decides whether a deploy reaches anybody. Its
 * fetch handler is cache-first for everything except `/docs/`, so a returning
 * visitor is served the cached `index.html` WITHOUT a network round trip — and
 * `vite build` emits a new content hash for the bundle every time. A stale
 * cached index.html therefore points at an asset that no longer exists.
 *
 * The invariant: if the app version changed, `CACHE` changed too.
 *
 * What went wrong. Four consecutive PRs (#16, #18, #19, #20) landed with no
 * bump. `CACHE` sat at `imweb-v0.14` — set back when the app was 0.18.0 — while
 * a dozen commits' worth of fixes accumulated on main. Anyone deploying that
 * would have shipped to two silent outcomes: returning visitors keep running the
 * old app with none of the fixes, or, if the deploy removed the old asset, they
 * get a BLANK APP. Neither reports an error. The v0.19.0 release had to bump it
 * before any of that work could reach a single returning user.
 *
 * It cannot be a runtime check twice over: the failure happens in a browser that
 * never contacted the server, and sw.js is served from `public/` verbatim, so it
 * never passes through Vite's `define` and cannot read `__APP_VERSION__` (that
 * is asserted below — it is the fix everyone reaches for first, and it produces
 * a ReferenceError that kills the install handler silently).
 *
 * Two modes, and the strict one turns itself on:
 *
 *   - LEGACY (today) — `CACHE` carries its own counter, unrelated to the app
 *     version. Nothing in the file says whether it is current, so the check is
 *     against the last release tag: version moved since the tag => CACHE must
 *     have moved too.
 *   - STRICT — once the cache name tracks the app version (issue #22,
 *     `imweb-v0.20.0`, `-2` for mid-cycle bumps), staleness is visible in the
 *     literal itself and is asserted exactly. This needs no edit to switch on:
 *     name the cache after the version and this audit starts enforcing it.
 *
 * Run:  node tests/audit-sw-cache-bump.mjs
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};
const note = (msg) => console.log(`  --   ${msg}`);

const CACHE_RE = /^\s*const\s+CACHE\s*=\s*['"]([^'"]+)['"]/m;
const readCache = (text) => (CACHE_RE.exec(text) ?? [])[1];

const swText = readFileSync(resolve(root, 'public/sw.js'), 'utf8');
const pkgVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

// ── 1. The constant is findable and singular ─────────────────────────────────
console.log('\nthe CACHE constant');
const defs = [...swText.matchAll(/const\s+CACHE\s*=/g)].length;
check('is declared exactly once', defs === 1,
  `found ${defs} — a second declaration means one of them is dead and nobody knows which`);

const cache = readCache(swText);
check('parses to a non-empty string', !!cache,
  'the audit could not read it; if the declaration was reformatted, fix CACHE_RE here');
if (!cache) { finish(); }

note(`app version ${pkgVersion}, cache "${cache}"`);

// ── 2. sw.js cannot read build-time constants ────────────────────────────────
// The tempting fix — `const CACHE = 'imweb-v' + __APP_VERSION__` — throws a
// ReferenceError inside the worker. install() never completes, nothing is ever
// cached, and the app merely stops working offline with no error anyone sees.
console.log('\nsw.js stays free of build-time constants');
// Ask what the rule is ABOUT — "no value only a bundler could supply" — rather
// than naming one spelling of it. The first version of this check looked for
// the literal `__APP_VERSION__`, and `import.meta.env.VITE_APP_VERSION` walks
// straight past it while failing in exactly the same way (LEARNED 2026-08-15).
// `npm run mutate` reports both as caught; the registry carries them.
const BUILD_CONSTANTS = [
  ['__APP_VERSION__', 'a Vite define'],
  ['import.meta.env', 'a Vite env import'],
  ['process.env', 'a bundler-injected env'],
];
for (const [token, what] of BUILD_CONSTANTS) {
  check(`does not reference ${token}`, !swText.includes(token),
    `${what}: public/ is copied verbatim and never passes through Vite, so this ` +
    'is undefined in the worker. It throws, install() never completes, and the ' +
    'app silently stops working offline. Hand-edit the literal.');
}
// Static AND dynamic. `^\s*import\s` saw only the first, and a service worker
// is no more part of the bundle graph when the import is awaited mid-line.
check('does not import app modules',
  !/^\s*import\s/m.test(swText) && !/\bimport\s*\(/.test(swText),
  'a service worker is not part of the bundle graph; an import here — static or ' +
  'dynamic — fails at registration');

// ── 3. STRICT mode — self-enabling once the name tracks the version ──────────
// Matches imweb-v1.2.3 and imweb-v1.2.3-4 (the mid-cycle suffix), and nothing
// else, so the legacy `imweb-v0.15` counter does not accidentally trip it.
const strict = new RegExp(`^imweb-v(\\d+\\.\\d+\\.\\d+)(?:-(\\d+))?$`).exec(cache);
if (strict) {
  console.log('\nSTRICT mode — the cache name tracks the app version');
  check(`cache names the current app version (${pkgVersion})`, strict[1] === pkgVersion,
    `cache says ${strict[1]}, package.json says ${pkgVersion}. Bump CACHE to ` +
    `"imweb-v${pkgVersion}" — a returning visitor is served the cached ` +
    'index.html until this literal changes.');
  finish();
}

// ── 4. LEGACY mode — compare against the last release tag ────────────────────
// Nothing inside the file can say whether a free-running counter is current, so
// the previous release is the reference. Bounded to one `git show` per file, and
// SKIPPED rather than failed when there are no tags: a shallow or tag-less clone
// must not turn this red (see LEARNED.md 2026-08-05).
console.log('\nLEGACY mode — CACHE moved if the version moved');
note('the cache name does not track the app version; see issue #22');

const git = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let tag = '';
try { tag = git("git tag --list 'v*' --sort=-v:refname").split('\n')[0] ?? ''; } catch { /* no git */ }

if (!tag) {
  note('no release tag reachable — skipping the comparison (shallow or tag-less clone)');
  finish();
}

let prevVersion = '', prevCache = '';
try {
  prevVersion = JSON.parse(git(`git show ${tag}:package.json`)).version;
  prevCache = readCache(git(`git show ${tag}:public/sw.js`)) ?? '';
} catch {
  note(`could not read ${tag} — skipping the comparison`);
  finish();
}

note(`comparing against ${tag}: version ${prevVersion}, cache "${prevCache}"`);

if (prevVersion === pkgVersion) {
  check(`version is unchanged since ${tag}, so no bump is owed`, true);
} else {
  check(`CACHE moved along with the version (${prevVersion} -> ${pkgVersion})`,
    prevCache !== cache,
    `CACHE is still "${cache}" from ${tag}. Bump it in public/sw.js. Cache ` +
    'identity is a string comparison, so ANY new value works — but a returning ' +
    'visitor keeps the old index.html, and its bundle hash is gone from the ' +
    'new deploy, which fails as a blank app rather than as a missing fix.');
}

finish();

function finish() {
  if (failures) {
    console.error(
      '\npublic/sw.js is cache-first for the app shell. If CACHE does not change,\n' +
      'a returning visitor never asks the server for index.html, so a rebuilt\n' +
      'bundle cannot reach them. Bump it as part of the release, alongside\n' +
      'package.json. See docs/LEARNED.md 2026-07-31 and issue #22.',
    );
  }
  // ── 4. The other place the version must propagate ──────────────────────────
  //
  // Same class of fault as the cache name, same silence, different file. The
  // release skill has always said package.json and package-lock.json "must move
  // together", because `npm version` updates both — but a release that hand-edits
  // the version instead updates only one, and nothing notices. That is exactly
  // what happened: the lockfile sat at 0.19.0 through the 0.20.0 AND 0.21.0
  // releases, and was found only because an unrelated uncommitted change to it
  // was being cleaned up.
  //
  // It breaks nothing at install time — `npm ci` reads the dependency tree, not
  // this field — which is precisely why it drifts unnoticed. What it costs is
  // the ability to trust the lockfile as a record of what a given release
  // shipped with, and `npm version` refuses to run against a mismatched pair.
  //
  // Prose did not hold this for two releases. This is the same rule, enforced.
  console.log('\nversion propagation — package-lock.json');
  const lockPath = resolve(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  check('package-lock.json version matches package.json',
    lock.version === pkgVersion,
    `lockfile says ${lock.version}, package.json says ${pkgVersion} — ` +
    'run `npm install --package-lock-only`, or use `npm version` for the bump ' +
    'so both move together');
  // The nested self-reference: npm writes the project's own version twice, and
  // a hand-edit typically catches one of them.
  const selfEntry = lock.packages?.['']?.version;
  check('the lockfile\'s nested self-entry matches too',
    selfEntry === undefined || selfEntry === pkgVersion,
    `packages[""].version is ${selfEntry}, expected ${pkgVersion}`);

  console.log(failures
    ? `\n${failures} FAILURE(S)\n`
    : '\nAll service worker cache-bump checks passed.\n');
  process.exit(failures ? 1 : 0);
}
