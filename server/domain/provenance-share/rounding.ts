import { SHARE_CATEGORIES } from "./constants.ts";

/**
 * Percents of the share by the largest remainder method (§1.4), in whole
 * numbers only. Every quotient goes through `quotient`, on `bigint`: there is
 * no floating point anywhere in this file, so no value can round differently
 * on another engine.
 */

function quotient(dividend: bigint, divisor: bigint): bigint {
  return dividend / divisor;
}

/**
 * `codePoints` holds one count per category, in the order of
 * `SHARE_CATEGORIES`. With a total `T > 0` the percents are whole numbers
 * from 0 to 100 that add up to exactly 100; with `T = 0` every percent is 0.
 * The `R` points left after the floors go to the categories with the largest
 * remainder; on an equal remainder the category with fewer code points comes
 * first, then the fixed order. A category with no code points never gets a
 * point. Throws on a count that is not a non-negative safe integer or a list
 * of another length: that is a programming error, not user input.
 */
export function sharePercents(codePoints: readonly number[]): number[] {
  if (codePoints.length !== SHARE_CATEGORIES.length) {
    throw new Error("sharePercents: one count per category is required");
  }
  for (const count of codePoints) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("sharePercents: counts are non-negative safe integers");
    }
  }
  const counts = codePoints.map((count) => BigInt(count));
  const total = counts.reduce((sum, count) => sum + count, 0n);
  if (total === 0n) {
    return counts.map(() => 0);
  }
  const floors = counts.map((count) => quotient(100n * count, total));
  const remainders = counts.map((count, i) => 100n * count - floors[i]! * total);
  const left = 100n - floors.reduce((sum, floor) => sum + floor, 0n);
  const order = counts
    .map((_, i) => i)
    .sort((a, b) => {
      if (remainders[a] !== remainders[b]) return remainders[a]! > remainders[b]! ? -1 : 1;
      if (counts[a] !== counts[b]) return counts[a]! < counts[b]! ? -1 : 1;
      return a - b;
    });
  const points = floors.slice();
  for (let k = 0n; k < left; k += 1n) {
    const index = order[Number(k)]!;
    points[index] = points[index]! + 1n;
  }
  return points.map((point) => Number(point));
}
