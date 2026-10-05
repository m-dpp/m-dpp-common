import { describe, expect, it } from "vitest";
import {
  addChild,
  changeType,
  coerceValue,
  duplicateKeys,
  fromJson,
  inferType,
  isQuantity,
  mergeImported,
  newComplex,
  parseImportedJson,
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

  it("recognises image links by extension or data URI, never by scheme alone", () => {
    expect(inferType("https://cdn.example/p/jacket.jpg")).toBe("image");
    expect(inferType("https://cdn.example/p/jacket.PNG?w=400#x")).toBe("image");
    expect(inferType("http://cdn.example/a.webp")).toBe("image");
    expect(inferType("data:image/png;base64,iVBORw0KGgo=")).toBe("image");
    // image CDNs name the format in the query instead of the path
    expect(inferType("https://images.unsplash.com/photo-1579206464424-7e43a81cadc1?w=640&fm=jpg&crop=entropy")).toBe("image");
    expect(inferType("https://cdn.example/img/abc?format=WEBP")).toBe("image");
    expect(inferType("https://cdn.example/img/abc?fm=pdf")).toBe("link"); // a URL, just not an image
    expect(inferType("https://example.com/product/123")).toBe("link");
    expect(inferType("https://example.com/report.pdf")).toBe("link");
    expect(inferType("javascript:alert(1).png")).toBe("text");
    expect(inferType("photo.jpg")).toBe("text");
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
    expect(coerceValue("https://x/y.jpg", "image")).toBe("https://x/y.jpg");
    expect(coerceValue("not a url", "image")).toBe("not a url"); // kept — the user is editing it
    expect(coerceValue(42, "image")).toBe("");
  });

  it("round-trips an image link as a plain string", () => {
    const v = { photo: "https://cdn.example/p/jacket.jpg" };
    const [n] = fromJson(v);
    expect(n.type).toBe("image");
    expect(toJson([n])).toEqual(v);
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

describe("link", () => {
  it("is any http(s) URL that is not an image — never another scheme", () => {
    expect(inferType("https://example.com/care-instructions")).toBe("link");
    expect(inferType("http://example.com")).toBe("link");
    expect(inferType("https://example.com/report.pdf")).toBe("link");
    expect(inferType("https://cdn.example/p/jacket.jpg")).toBe("image");
    expect(inferType("ftp://example.com/x")).toBe("text");
    expect(inferType("javascript:alert(1)")).toBe("text");
    expect(inferType("example.com/no-scheme")).toBe("text");
    expect(inferType("https://not a url")).toBe("text");
  });

  it("round-trips as a plain string", () => {
    const v = { care: "https://example.com/care" };
    const [n] = fromJson(v);
    expect(n.type).toBe("link");
    expect(toJson([n])).toEqual(v);
  });
});

describe("quantity", () => {
  it("is exactly {value, unit} with a numeric (or null) value", () => {
    expect(isQuantity({ value: 12, unit: "cm" })).toBe(true);
    expect(isQuantity({ value: null, unit: "cm" })).toBe(true);
    expect(isQuantity({ value: 12, unit: "cm", extra: 1 })).toBe(false);
    expect(isQuantity({ value: "12", unit: "cm" })).toBe(false);
    expect(isQuantity({ value: 12 })).toBe(false);
    expect(isQuantity([12, "cm"])).toBe(false);
    expect(inferType({ value: 12, unit: "cm" })).toBe("quantity");
    expect(inferType({ value: 12, unit: "cm", note: "x" })).toBe("object");
  });

  it("round-trips, and collapses to a bare number when the unit is cleared", () => {
    const v = { width: { value: 30, unit: "cm" } };
    const [n] = fromJson(v);
    expect(n.type).toBe("quantity");
    expect(n.value).toBe(30);
    expect(n.unit).toBe("cm");
    expect(toJson([n])).toEqual(v);
    expect(toJson([{ ...n, unit: "  " }])).toEqual({ width: 30 });
    expect(toJson([{ ...n, value: null }])).toEqual({ width: { value: null, unit: "cm" } });
  });

  it("number ⇄ quantity keeps the number; leaving quantity drops the unit", () => {
    const q = changeType(newLeaf("number", "w", 320), "quantity");
    expect(q.type).toBe("quantity");
    expect(q.value).toBe(320);
    expect(q.unit).toBe("");
    const back = changeType({ ...q, unit: "gsm" }, "number");
    expect(back.value).toBe(320);
    expect(back.unit).toBeUndefined();
    expect(toJson([back])).toEqual({ w: 320 });
    expect(coerceValue("12.5", "quantity")).toBe(12.5);
    expect(coerceValue("abc", "quantity")).toBeNull();
  });
});

describe("import", () => {
  it("merge replaces an existing key in place and appends new ones", () => {
    const nodes = fromJson({ a: 1, b: "two", c: true });
    const merged = mergeImported(nodes, { b: "TWO", d: "https://example.com/d" });
    expect(merged.map((n) => n.key)).toEqual(["a", "b", "c", "d"]);
    expect(toJson(merged)).toEqual({ a: 1, b: "TWO", c: true, d: "https://example.com/d" });
    expect(merged[3].type).toBe("link");
    // the original is untouched
    expect(toJson(nodes)).toEqual({ a: 1, b: "two", c: true });
  });

  it("replace discards the current tree", () => {
    const nodes = fromJson({ a: 1 });
    expect(toJson(mergeImported(nodes, { z: { value: 1, unit: "kg" } }, "replace"))).toEqual({ z: { value: 1, unit: "kg" } });
  });

  it("parses only a JSON object, with a readable error otherwise", () => {
    expect(parseImportedJson('{"a": 1}')).toEqual({ a: 1 });
    expect(() => parseImportedJson("[1, 2]")).toThrow(/must be an object/);
    expect(() => parseImportedJson('"x"')).toThrow(/must be an object/);
    expect(() => parseImportedJson("{a: 1}")).toThrow(/Not valid JSON/);
  });
});
