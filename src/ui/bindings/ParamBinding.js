/**
 * ParamBinding — subscription lifetime manager for param-driven UI.
 *
 * Wraps a Parameter's onChange subscriptions so a UI element (e.g. a param
 * row) can register any number of refresh callbacks and release them all in
 * one dispose() call on teardown. Writes stay as ps.set(...) — the binding
 * only manages subscription lifetime.
 */

export function createBinding(param) {
  const unsubs = [];
  return {
    param,
    /** Subscribe fn to param changes; unsub is tracked for dispose().
     *  fn is invoked once immediately (matches the register-then-refresh
     *  pattern used throughout buildParamRow). */
    sync(fn) {
      unsubs.push(param.onChange(fn));
      fn(param.value, param);
      return fn;
    },
    /** Release every tracked subscription. Idempotent. */
    dispose() {
      unsubs.forEach(u => u());
      unsubs.length = 0;
    },
  };
}
