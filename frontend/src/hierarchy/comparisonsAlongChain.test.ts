import { describe, expect, it } from "vitest";
import { ComparisonSource, comparisonsAlongChain } from "./comparisonsAlongChain";
import type { ComparisonResponse } from "../mdpp/types";

const ITEM = "01/00000012345679/21/SN-001";
const VARIANT = "01/00000012345679";
const MODEL = "8013/GMN-XABOO-LOVE";

/** Only the fields the orchestration reads. */
const res = (declares: boolean, verified: number) =>
  ({
    declaration: declares ? ({ version: 1 } as never) : null,
    verified_test_count: verified,
    comparisons: [],
  }) as unknown as ComparisonResponse;

function source(pass1: Record<string, ComparisonResponse | null>): ComparisonSource & {
  calls: { paths: string[]; declarationPaths?: Record<string, string> }[];
} {
  const calls: { paths: string[]; declarationPaths?: Record<string, string> }[] = [];
  return {
    calls,
    async comparisons(paths, opts) {
      calls.push({ paths, declarationPaths: opts?.declarationPaths });
      // the second pass returns whatever it was asked about, marked as resolved
      return Object.fromEntries(
        paths.map((p) => [p, opts?.declarationPaths ? res(true, 1) : (pass1[p] ?? null)]),
      );
    },
  };
}

describe("comparisonsAlongChain", () => {
  it("re-asks a level that has evidence but no claim of its own", () => {
    // the whole point: without the second pass this level reports every tested
    // fibre as `undeclared` while a claim sits above it
    const s = source({ [ITEM]: res(false, 1), [VARIANT]: res(false, 0), [MODEL]: res(true, 0) });
    return comparisonsAlongChain(s, [ITEM, VARIANT, MODEL]).then((out) => {
      expect(s.calls).toHaveLength(2);
      expect(s.calls[1].paths).toEqual([ITEM]);
      expect(s.calls[1].declarationPaths).toEqual({ [ITEM]: MODEL });
      expect(out.declarationPaths).toEqual({ [ITEM]: MODEL });
      expect(out.byPath[ITEM]?.declaration).not.toBeNull();
    });
  });

  it("makes ONE call when nothing needs inheriting", async () => {
    // every level declares for itself — a second pass would be pure waste
    const s = source({ [ITEM]: res(true, 1), [MODEL]: res(true, 0) });
    const out = await comparisonsAlongChain(s, [ITEM, MODEL]);
    expect(s.calls).toHaveLength(1);
    expect(out.declarationPaths).toEqual({});
  });

  it("does not re-ask a level with no evidence", async () => {
    const s = source({ [ITEM]: res(false, 0), [MODEL]: res(true, 0) });
    const out = await comparisonsAlongChain(s, [ITEM, MODEL]);
    expect(s.calls).toHaveLength(1);
    expect(out.declarationPaths).toEqual({});
  });

  it("leaves untouched levels exactly as the first pass returned them", async () => {
    const s = source({ [ITEM]: res(false, 1), [MODEL]: res(true, 2) });
    const out = await comparisonsAlongChain(s, [ITEM, MODEL]);
    // the model was not re-asked, so its own result survives the merge
    expect(out.byPath[MODEL]?.verified_test_count).toBe(2);
  });

  it("makes no call at all for an empty chain", async () => {
    const s = source({});
    const out = await comparisonsAlongChain(s, []);
    expect(s.calls).toHaveLength(0);
    expect(out).toEqual({ byPath: {}, declarationPaths: {} });
  });
});
