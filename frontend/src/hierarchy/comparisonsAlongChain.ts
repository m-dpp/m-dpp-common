/**
 * Comparisons for a whole product chain, with declarations inherited down it.
 *
 * The companion to {@link effectiveClaims}: that decides *which* claim applies
 * where, this performs the calls. Both are shared because getting either wrong
 * produces the same visible fault — every tested fibre reported as `undeclared`
 * while a claim sits one level up, which makes "declare at model, test at batch"
 * unverifiable.
 *
 * **Two passes, and the second is not optional.** Which ancestor is effective is
 * only knowable once the first pass has said who declares, so a caller cannot
 * name the sources up front. Omitting the second pass is the failure mode this
 * function exists to prevent, and it is silent: every call succeeds, every
 * verdict is simply wrong in the same direction.
 *
 * The second pass re-asks **only** the levels that have evidence but no claim of
 * their own — usually one, often none.
 *
 * **It is handed a chain and never goes looking for one.** Deriving ancestry
 * belongs to whoever owns the tree; a GS1 path cannot supply it, because a batch
 * (`01/{gtin}/10/{lot}`) and its model (`8013/{gmn}`) share no prefix.
 *
 * A host that needs different fetching — batching across several passports,
 * its own cache — should use `effectiveClaims` directly rather than bending
 * this. The rule is the part that must not differ; the round trips are not.
 */

import type { ComparisonResponse } from "../mdpp/types";
import { effectiveClaims } from "./effectiveClaims";

/** The slice of the mdpp client this needs. Structural, so a host may pass its
 *  own implementation — a cache, a test double — without holding the whole client. */
export interface ComparisonSource {
  comparisons(
    gs1Paths: string[],
    opts?: { declarationPaths?: Record<string, string> },
  ): Promise<Record<string, ComparisonResponse | null>>;
}

export interface ChainComparisons {
  /** Comparison per level, with inherited claims already applied. */
  byPath: Record<string, ComparisonResponse | null>;
  /** Level → the ancestor whose claim was used there. A viewer passes each to
   *  the component that renders that level's tests, so an expanded row cannot
   *  contradict the effective declaration shown above it. */
  declarationPaths: Record<string, string>;
}

/** `paths` is ordered **nearest first**: `[thisProduct, parent, …, root]`. */
export async function comparisonsAlongChain(
  source: ComparisonSource,
  paths: string[],
): Promise<ChainComparisons> {
  if (!paths.length) return { byPath: {}, declarationPaths: {} };

  const first = await source.comparisons(paths);

  const declarationPaths = effectiveClaims(
    paths.map((path) => ({
      path,
      declares: Boolean(first[path]?.declaration),
      hasEvidence: (first[path]?.verified_test_count ?? 0) > 0,
    })),
  );

  const needsInheriting = Object.keys(declarationPaths);
  if (!needsInheriting.length) return { byPath: first, declarationPaths };

  return {
    byPath: { ...first, ...(await source.comparisons(needsInheriting, { declarationPaths })) },
    declarationPaths,
  };
}
