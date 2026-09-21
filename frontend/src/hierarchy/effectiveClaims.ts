/**
 * Which declaration is effective at each level of a product chain.
 *
 * **This module is handed a chain; it never goes looking for one.** Deriving the
 * ancestry belongs to whoever owns the tree — dpp-app's `parent_id` today, a
 * partner DPP's own model tomorrow, passport-app's merge logic eventually. A
 * GS1 path cannot be used for it: a batch (`01/{gtin}/10/{lot}`) and its model
 * (`8013/{gmn}`) share no prefix, and a GMN is not derivable from a GTIN, so the
 * link exists only in the DPP that stores it.
 *
 * It is deliberately NOT part of `src/mdpp/`, whose charter is that the client
 * for a flat service knows nothing about hierarchy. That still holds. What lives
 * here is the consumer-side rule every hierarchy-aware viewer needs to agree on,
 * because disagreeing means two front-ends render different verdicts from the
 * same evidence — the thing the shared `Comparison` component exists to prevent.
 *
 * The rule itself is dpp-app's attribute override rule applied to composition:
 * **the nearest claim at or above a level is the effective one, and nothing is
 * merged.** An own claim always wins.
 */

/** What this rule needs to know about one level. Structural, so a caller can
 *  feed it a comparison response, a counts row, or anything else it already
 *  holds — it is not tied to one endpoint's shape. */
export interface ChainLevel {
  /** The identifier at this level. */
  path: string;
  /** Does this level carry a declaration of its own? */
  declares: boolean;
  /** Does it carry evidence that would need a claim to be judged against? */
  hasEvidence: boolean;
}

/**
 * Level → the ancestor whose claim is effective there.
 *
 * `chain` is ordered **nearest first**: `[thisProduct, parent, …, root]`.
 *
 * Only levels that have evidence *and* no claim of their own get an entry —
 * those are exactly the ones that would otherwise report every tested fibre as
 * undeclared. A level that declares is omitted because its own claim wins, and
 * a level with no evidence is omitted because there is nothing to judge.
 *
 * The result is a map a caller passes straight to mdpp as `declarationPath`,
 * per level. A level with no declaring ancestor simply has no entry: there is
 * genuinely nothing to compare against, which is an honest answer.
 */
export function effectiveClaims(chain: ChainLevel[]): Record<string, string> {
  const out: Record<string, string> = {};
  chain.forEach((level, i) => {
    if (level.declares || !level.hasEvidence) return;
    // STRICTLY above: a level never inherits from itself, and the nearest
    // declaring ancestor wins outright — nothing is merged across levels.
    const ancestor = chain.slice(i + 1).find((a) => a.declares);
    if (ancestor) out[level.path] = ancestor.path;
  });
  return out;
}

/**
 * The nearest level at or above `chain[0]` that declares — what a viewer shows
 * as *the* effective declaration for the product in hand.
 *
 * Unlike {@link effectiveClaims} this includes the level itself, because the
 * question is different: "what is claimed about this product?" rather than
 * "whose claim should this level's evidence be judged against?". Returns null
 * when nothing in the chain declares anything.
 */
export function effectiveClaimFor(chain: ChainLevel[]): string | null {
  return chain.find((level) => level.declares)?.path ?? null;
}
