/**
 * ParamBinding — subscription lifetime manager for param-driven UI.
 *
 * Wraps a Parameter's onChange subscriptions so a UI element (e.g. a param
 * row) can register any number of refresh callbacks and release them all in
 * one dispose() call on teardown. Writes stay as ps.set(...) — the binding
 * only manages subscription lifetime.
 *
 * DOM writes are rAF-batched: onChange no longer runs the UI callback
 * synchronously (LFO/Random/Sound controllers write params every frame —
 * synchronous fan-out meant 4+ DOM writes per modulated param per tick on
 * the same thread that feeds the renderer). Instead the callback is marked
 * dirty and all dirty callbacks run once in a single rAF pass, coalescing
 * any number of param changes per frame into one DOM update each.
 * Direct calls (e.g. ParamRow's pointermove → updateDisplay()) stay
 * synchronous — interactive drag feedback is never deferred.
 */

// Shared frame batch: dirty callback → its Parameter. One rAF services
// every binding in the app; cleared before running so callbacks that
// trigger further param writes re-schedule into the NEXT frame.
const _pending = new Map();
let _rafId = 0;

function _flush() {
  _rafId = 0;
  const batch = [..._pending];
  _pending.clear();
  for (const [fn, param] of batch) fn(param.value, param);
}

function _schedule(fn, param) {
  _pending.set(fn, param);
  if (!_rafId) _rafId = requestAnimationFrame(_flush);
}

export function createBinding(param) {
  const unsubs = [];
  const fns = [];
  return {
    param,
    /** Subscribe fn to param changes; unsub is tracked for dispose().
     *  fn is invoked once immediately (matches the register-then-refresh
     *  pattern used throughout buildParamRow); onChange marks it dirty
     *  and the shared rAF pass runs it at most once per frame. */
    sync(fn) {
      fns.push(fn);
      unsubs.push(param.onChange(() => _schedule(fn, param)));
      fn(param.value, param);
      return fn;
    },
    /** Release every tracked subscription. Idempotent. Also drops any
     *  still-pending frame work so a disposed row (param search rebuilds
     *  rows constantly) can never receive a post-dispose flush. */
    dispose() {
      unsubs.forEach(u => u());
      unsubs.length = 0;
      fns.forEach(fn => _pending.delete(fn));
      fns.length = 0;
    },
  };
}
