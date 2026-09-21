import { describe, expect, it } from "vitest";
import { ChainLevel, effectiveClaimFor, effectiveClaims } from "./effectiveClaims";

/** A realistic chain, nearest first: item → batch → variant → model. The paths
 *  matter: the model's GMN shares no prefix with the GTIN paths below it, which
 *  is why this rule cannot be derived from the identifiers. */
const ITEM = "01/00000012345679/21/SN-001";
const BATCH = "01/00000012345679/10/LOT-001";
const VARIANT = "01/00000012345679";
const MODEL = "8013/GMN-XABOO-LOVE";

const level = (path: string, declares = false, hasEvidence = false): ChainLevel => ({
  path,
  declares,
  hasEvidence,
});

describe("effectiveClaims", () => {
  it("gives a level with evidence but no claim its nearest declaring ancestor", () => {
    // the case the whole rule exists for: declared on the model, tested on the item
    const chain = [level(ITEM, false, true), level(BATCH), level(VARIANT), level(MODEL, true)];
    expect(effectiveClaims(chain)).toEqual({ [ITEM]: MODEL });
  });

  it("skips levels that declare — an own claim always wins", () => {
    const chain = [level(ITEM, true, true), level(BATCH), level(VARIANT), level(MODEL, true)];
    expect(effectiveClaims(chain)).toEqual({});
  });

  it("skips levels with no evidence — there is nothing to judge", () => {
    const chain = [level(ITEM), level(BATCH), level(VARIANT), level(MODEL, true)];
    expect(effectiveClaims(chain)).toEqual({});
  });

  it("takes the NEAREST declaring ancestor, not the furthest", () => {
    // nothing is merged across levels: the nearest claim wins outright
    const chain = [level(ITEM, false, true), level(BATCH), level(VARIANT, true), level(MODEL, true)];
    expect(effectiveClaims(chain)).toEqual({ [ITEM]: VARIANT });
  });

  it("never lets a level inherit from itself", () => {
    const chain = [level(ITEM, true, true)];
    expect(effectiveClaims(chain)).toEqual({});
  });

  it("leaves a level with no declaring ancestor out entirely", () => {
    // honest: there is genuinely no claim to compare this evidence against
    const chain = [level(ITEM, false, true), level(BATCH), level(VARIANT), level(MODEL)];
    expect(effectiveClaims(chain)).toEqual({});
  });

  it("resolves several levels independently", () => {
    const chain = [
      level(ITEM, false, true), // → variant
      level(BATCH, false, true), // → variant
      level(VARIANT, true, true), // declares: omitted
      level(MODEL, true),
    ];
    expect(effectiveClaims(chain)).toEqual({ [ITEM]: VARIANT, [BATCH]: VARIANT });
  });

  it("inherits UPWARD only — a claim below never reaches a level above", () => {
    // an ancestor's test was performed on different material; the reverse
    // direction is not a comparison anyone made
    const chain = [level(MODEL, false, true), level(BATCH, true)]; // (deliberately odd order)
    expect(effectiveClaims(chain)).toEqual({ [MODEL]: BATCH });
    // …and with the realistic order, the model gets nothing from its descendants
    const realistic = [level(MODEL, false, true)];
    expect(effectiveClaims(realistic)).toEqual({});
  });

  it("handles an empty chain", () => {
    expect(effectiveClaims([])).toEqual({});
  });
});

describe("effectiveClaimFor", () => {
  it("includes the level itself — the question is what is claimed HERE", () => {
    const chain = [level(ITEM, true), level(MODEL, true)];
    expect(effectiveClaimFor(chain)).toBe(ITEM);
  });

  it("walks up when this level declares nothing", () => {
    const chain = [level(ITEM), level(BATCH), level(VARIANT), level(MODEL, true)];
    expect(effectiveClaimFor(chain)).toBe(MODEL);
  });

  it("is null when nothing in the chain declares", () => {
    expect(effectiveClaimFor([level(ITEM), level(MODEL)])).toBeNull();
    expect(effectiveClaimFor([])).toBeNull();
  });
});
