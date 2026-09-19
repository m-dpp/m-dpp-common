import { describe, expect, it } from "vitest";
import {
  addChild,
  changeType,
  coerceValue,
  duplicateKeys,
  fromJson,
  inferType,
  newComplex,
  newLeaf,
  removeNode,
  toJson,
  updateNode,
} from "./model";

const SAMPLE = {
  product_name: "Merino Knit Jacket",
  weight_gsm: 320,
  recyclable: true,
  production_date: "2026-03-15",
  note: null,
  care: { wash: { temp_c: 30, cycle: "wool" }, dry: "flat" },
  certifications: ["RWS", { scheme: "GRS", id: 42 }],
};

describe("inferType", () => {
  it("maps JSON values to node types", () => {
    expect(inferType("x")).toBe("text");
    expect(inferType(3)).toBe("number");
    expect(inferType(false)).toBe("boolean");
    expect(inferType("2026-03-15")).toBe("date");
    expect(inferType("2026-03-15T10:00:00Z")).toBe("text");
    expect(inferType(null)).toBe("text");
    expect(inferType([])).toBe("list");
    expect(inferType({})).toBe("object");
  });
});

describe("fromJson / toJson", () => {
  it("round-trips nested objects and lists", () => {
    expect(toJson(fromJson(SAMPLE))).toEqual(SAMPLE);
  });

  it("indexes list children and keeps order", () => {
    const [list] = fromJson({ l: [1, 2, 3] });
    expect(list.children.map((c) => c.key)).toEqual(["0", "1", "2"]);
    expect(toJson([list])).toEqual({ l: [1, 2, 3] });
  });

  it("skips empty keys and lets the last duplicate win", () => {
    const nodes = [newLeaf("text", "", "ignored"), newLeaf("text", "a", "1"), newLeaf("text", "a", "2")];
    expect(toJson(nodes)).toEqual({ a: "2" });
    expect([...duplicateKeys(nodes)]).toEqual(["a"]);
  });

  it("emits null for an empty number", () => {
    expect(toJson([newLeaf("number", "n")])).toEqual({ n: null });
  });
});

describe("coercion", () => {
  it("coerces sensibly", () => {
    expect(coerceValue("12.5", "number")).toBe(12.5);
    expect(coerceValue("abc", "number")).toBeNull();
    expect(coerceValue(true, "number")).toBe(1);
    expect(coerceValue("yes", "boolean")).toBe(true);
    expect(coerceValue(0, "boolean")).toBe(false);
    expect(coerceValue("2026-01-02", "date")).toBe("2026-01-02");
    expect(coerceValue("nope", "date")).toBe("");
    expect(coerceValue(7, "text")).toBe("7");
    expect(coerceValue(null, "text")).toBe("");
  });

  it("changeType complex → leaf drops the subtree, leaf → complex starts empty", () => {
    const obj = addChild([newComplex("object", "o")], null, newLeaf("text", "x"));
    const o = obj[0];
    const withChild = addChild(obj, o.id, newLeaf("text", "k", "v"))[0];
    expect(withChild.children).toHaveLength(1);
    const asText = changeType(withChild, "text");
    expect(asText.type).toBe("text");
    expect(asText.children).toEqual([]);
    const asList = changeType(newLeaf("number", "n", 3), "list");
    expect(asList.type).toBe("list");
    expect(asList.children).toEqual([]);
  });

  it("object ⇄ list keeps children", () => {
    const [o] = fromJson({ o: { a: 1, b: 2 } });
    const l = changeType(o, "list");
    expect(toJson([l])).toEqual({ o: [1, 2] });
    expect(toJson([changeType(l, "object")])).toEqual({ o: { a: 1, b: 2 } });
  });
});

describe("tree ops", () => {
  it("update / remove are immutable and reach any depth", () => {
    const nodes = fromJson(SAMPLE);
    const care = nodes.find((n) => n.key === "care")!;
    const wash = care.children.find((n) => n.key === "wash")!;
    const temp = wash.children.find((n) => n.key === "temp_c")!;

    const updated = updateNode(nodes, temp.id, (n) => ({ ...n, value: 40 }));
    expect(updated).not.toBe(nodes);
    expect((toJson(updated).care as any).wash.temp_c).toBe(40);
    expect((toJson(nodes).care as any).wash.temp_c).toBe(30);

    const removed = removeNode(nodes, wash.id);
    expect((toJson(removed).care as any)).toEqual({ dry: "flat" });
    expect(removeNode(nodes, "missing")).toBe(nodes);
  });
});
