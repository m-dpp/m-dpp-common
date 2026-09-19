import { stableStringify } from "./AttrsEditor/model";

/**
 * The PATCH body for `attrs` that turns `original` into `next` under the shared
 * merge semantics (a key set to `null` is removed, unnamed keys are untouched).
 * Returns an empty object when nothing changed.
 */
export function attrsPatch(original: Record<string, unknown> | null | undefined, next: Record<string, unknown>): Record<string, unknown> {
  const orig = original ?? {};
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (!(k in orig) || stableStringify(orig[k]) !== stableStringify(v)) patch[k] = v;
  }
  for (const k of Object.keys(orig)) {
    if (!(k in next)) patch[k] = null;
  }
  return patch;
}
