import { describe, expect, it } from "vitest";
import { computeAverage, finalWeight, suggestedWeightBucket } from "./scoring";
import type { RubricRatings } from "./types";

function ratings(value: 1 | 2 | 3 | 4 | 5): RubricRatings {
  return {
    number_of_concepts: value,
    object_abstraction: value,
    transformation_depth: value,
    distractors: value,
    output_precision: value,
    rule_ambiguity: value,
    compositionality: value
  };
}

describe("scoring", () => {
  it("computes a rounded average over the seven rubric fields", () => {
    expect(computeAverage(ratings(1))).toBe(1);
    expect(
      computeAverage({
        ...ratings(1),
        compositionality: 5
      })
    ).toBe(1.57);
  });

  it("maps average boundaries to suggested buckets", () => {
    expect(suggestedWeightBucket(1)).toBe(1);
    expect(suggestedWeightBucket(2)).toBe(1);
    expect(suggestedWeightBucket(2.01)).toBe(2);
    expect(suggestedWeightBucket(3)).toBe(2);
    expect(suggestedWeightBucket(3.01)).toBe(3);
    expect(suggestedWeightBucket(4)).toBe(3);
    expect(suggestedWeightBucket(4.01)).toBe(4);
    expect(suggestedWeightBucket(5)).toBe(4);
  });

  it("uses a manual override as final weight when present", () => {
    expect(finalWeight(3, null)).toBe(3);
    expect(finalWeight(3, 5)).toBe(5);
  });
});
