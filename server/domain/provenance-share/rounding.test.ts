// docs/contracts/provenance-share-v1.md §1.4 and vector §9.2.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sharePercents } from "./rounding.ts";

describe("sharePercents (§1.4)", () => {
  it.each([
    // [codePoints, percent], in the order written, ai_transferred, pasted, imported, unattributed
    [
      [195, 64, 63, 34, 9],
      [53, 18, 17, 9, 3],
    ], // §9.1
    [
      [1, 1, 1, 0, 0],
      [34, 33, 33, 0, 0],
    ], // equal remainder and count: fixed order
    [
      [199, 1, 0, 0, 0],
      [99, 1, 0, 0, 0],
    ], // equal remainder: the smaller category first
    [
      [598, 1, 1, 0, 0],
      [100, 0, 0, 0, 0],
    ], // c_i > 0 with percent 0
    [
      [1, 2, 0, 0, 0],
      [33, 67, 0, 0, 0],
    ], // largest remainder
    [
      [1, 1, 1, 1, 1],
      [20, 20, 20, 20, 20],
    ], // no remainder
    [
      [0, 0, 7, 0, 0],
      [0, 0, 100, 0, 0],
    ], // one category
    [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ], // T = 0: empty, no sum of 100
  ])("%j gives %j", (codePoints, percent) => {
    expect(sharePercents(codePoints)).toEqual(percent);
  });

  it("stays exact past the range of a double's integer quotient", () => {
    const big = Number.MAX_SAFE_INTEGER;
    const result = sharePercents([big, 1, 0, 0, 0]);
    expect(result).toEqual([100, 0, 0, 0, 0]);
  });

  it("refuses a list of another length or a count that is not a whole number", () => {
    expect(() => sharePercents([1, 2, 3])).toThrow();
    expect(() => sharePercents([1.5, 0, 0, 0, 0])).toThrow();
    expect(() => sharePercents([-1, 0, 0, 0, 0])).toThrow();
    expect(() => sharePercents([Number.NaN, 0, 0, 0, 0])).toThrow();
  });

  it("computes in whole numbers only: no Math and no division outside the bigint quotient", () => {
    const code = readFileSync(new URL("./rounding.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/^import .*$/gm, "");
    expect(code).not.toMatch(/\bMath\./);
    expect(code).not.toMatch(/parseFloat|toFixed|\d\.\d/);
    const divisions = code.match(/[^/*]\/[^/*]/g) ?? [];
    expect(divisions).toEqual([" / "]);
    expect(code).toContain("return dividend / divisor;");
    expect(code).toContain("function quotient(dividend: bigint, divisor: bigint): bigint");
  });
});
