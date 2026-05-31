import type { Rating, RubricKey, RubricRatings } from "./types";

export interface RubricFactor {
  key: RubricKey;
  label: string;
  lowAnchor: string;
  highAnchor: string;
}

export const QUESTION_IDS = Array.from({ length: 25 }, (_, index) => `q${index + 3}` as const);

export const RUBRIC_FACTORS: RubricFactor[] = [
  {
    key: "number_of_concepts",
    label: "Number of concepts",
    lowAnchor: "1 = one simple rule",
    highAnchor: "5 = multiple composed rules"
  },
  {
    key: "object_abstraction",
    label: "Object abstraction",
    lowAnchor: "1 = simple colors/shapes",
    highAnchor: "5 = hidden identity, grouping, hierarchy, or roles"
  },
  {
    key: "transformation_depth",
    label: "Transformation depth",
    lowAnchor: "1 = direct mapping",
    highAnchor: "5 = multi-step latent transformation"
  },
  {
    key: "distractors",
    label: "Distractors",
    lowAnchor: "1 = no meaningful distractors",
    highAnchor: "5 = misleading examples, irrelevant features, or traps"
  },
  {
    key: "output_precision",
    label: "Output precision",
    lowAnchor: "1 = small edit or simple output",
    highAnchor: "5 = full-grid construction or high precision required"
  },
  {
    key: "rule_ambiguity",
    label: "Rule ambiguity",
    lowAnchor: "1 = obvious intended rule",
    highAnchor: "5 = multiple plausible rules needing disambiguation"
  },
  {
    key: "compositionality",
    label: "Compositionality",
    lowAnchor: "1 = one operation",
    highAnchor: "5 = several operations combined"
  }
];

export const DEFAULT_RATINGS: RubricRatings = {
  number_of_concepts: 1,
  object_abstraction: 1,
  transformation_depth: 1,
  distractors: 1,
  output_precision: 1,
  rule_ambiguity: 1,
  compositionality: 1
};

export const RATING_OPTIONS: Rating[] = [1, 2, 3, 4, 5];
