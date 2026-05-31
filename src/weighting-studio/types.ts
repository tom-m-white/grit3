export type ArcCell = number;
export type ArcGrid = ArcCell[][];

export interface ArcPair {
  input: ArcGrid;
  output?: ArcGrid;
}

export interface ArcTask {
  train: ArcPair[];
  test: ArcPair[];
}

export type QuestionId = `q${number}`;

export interface LoadedQuestion {
  question_id: QuestionId;
  task: ArcTask | null;
  load_error: string | null;
}

export const RUBRIC_KEYS = [
  "number_of_concepts",
  "object_abstraction",
  "transformation_depth",
  "distractors",
  "output_precision",
  "rule_ambiguity",
  "compositionality"
] as const;

export type RubricKey = (typeof RUBRIC_KEYS)[number];
export type Rating = 1 | 2 | 3 | 4 | 5;
export type Weight = 1 | 2 | 3 | 4 | 5;
export type SuggestedWeight = 1 | 2 | 3 | 4;

export type RubricRatings = Record<RubricKey, Rating>;

export interface QuestionProfile {
  question_id: QuestionId;
  ratings: RubricRatings;
  computed_average: number;
  suggested_weight_bucket: SuggestedWeight;
  manual_weight_override: Weight | null;
  final_weight: Weight;
  tags: string[];
  notes: string;
  difficulty_rationale: string;
  updated_at: string;
}

export interface WeightingProfile {
  benchmark: "grit3";
  profile_name: string;
  version: 1;
  questions: Record<QuestionId, QuestionProfile>;
}
