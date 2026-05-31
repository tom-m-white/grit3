import { RUBRIC_KEYS } from "./types";
import type {
  QuestionProfile,
  Rating,
  RubricRatings,
  SuggestedWeight,
  Weight
} from "./types";

export function computeAverage(ratings: RubricRatings): number {
  const total = RUBRIC_KEYS.reduce((sum, key) => sum + ratings[key], 0);
  return roundToTwo(total / RUBRIC_KEYS.length);
}

export function suggestedWeightBucket(computedAverage: number): SuggestedWeight {
  if (computedAverage <= 2) {
    return 1;
  }
  if (computedAverage <= 3) {
    return 2;
  }
  if (computedAverage <= 4) {
    return 3;
  }
  return 4;
}

export function finalWeight(suggested: SuggestedWeight, manualOverride: Weight | null): Weight {
  return manualOverride ?? suggested;
}

export function recalculateProfileEntry(entry: QuestionProfile): QuestionProfile {
  const computed_average = computeAverage(entry.ratings);
  const suggested_weight_bucket = suggestedWeightBucket(computed_average);
  return {
    ...entry,
    computed_average,
    suggested_weight_bucket,
    final_weight: finalWeight(suggested_weight_bucket, entry.manual_weight_override)
  };
}

export function isRating(value: unknown): value is Rating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function isWeight(value: unknown): value is Weight {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
