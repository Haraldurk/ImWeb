/**
 * Shared touch-gesture constants — single source of truth.
 *
 * LONG_PRESS_MS: every long-press affordance in the app (controller badge
 * popover, param row context menu, state tile action menu) uses this one
 * value so the performer builds a single motor habit. Previously fractured
 * across 220 / 500 / 600ms.
 */
export const LONG_PRESS_MS = 400;
