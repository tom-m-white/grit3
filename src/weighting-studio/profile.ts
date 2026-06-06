import { DEFAULT_RATINGS, QUESTION_IDS } from "./rubric";
import { isRating, isWeight, recalculateProfileEntry } from "./scoring";
import { RUBRIC_KEYS } from "./types";
import type {
  QuestionId,
  QuestionProfile,
  RubricRatings,
  Weight,
  WeightingProfile
} from "./types";

export const STORAGE_KEY = "grit3.weightingStudio.profile.v1";

type UnknownRecord = Record<string, unknown>;

export function createEmptyQuestionProfile(questionId: QuestionId): QuestionProfile {
  return recalculateProfileEntry({
    question_id: questionId,
    ratings: { ...DEFAULT_RATINGS },
    computed_average: 1,
    suggested_weight_bucket: 1,
    manual_weight_override: null,
    final_weight: 1,
    tags: [],
    notes: "",
    difficulty_rationale: "",
    updated_at: ""
  });
}

export function createDefaultProfile(questionIds: readonly QuestionId[] = QUESTION_IDS): WeightingProfile {
  const questions = Object.fromEntries(
    questionIds.map((questionId) => [questionId, createEmptyQuestionProfile(questionId)])
  ) as Record<QuestionId, QuestionProfile>;

  return {
    benchmark: "grit3",
    profile_name: "default",
    version: 1,
    questions
  };
}

export function withUpdatedEntry(
  profile: WeightingProfile,
  questionId: QuestionId,
  changes: Partial<Omit<QuestionProfile, "question_id">>,
  timestamp = new Date().toISOString()
): WeightingProfile {
  const current = profile.questions[questionId] ?? createEmptyQuestionProfile(questionId);
  const next = recalculateProfileEntry({
    ...current,
    ...changes,
    question_id: questionId,
    updated_at: timestamp
  });

  return {
    ...profile,
    questions: {
      ...profile.questions,
      [questionId]: next
    }
  };
}

export function normalizeProfile(profile: WeightingProfile): WeightingProfile {
  return {
    ...profile,
    questions: Object.fromEntries(
      QUESTION_IDS.map((questionId) => {
        const entry = profile.questions[questionId] ?? createEmptyQuestionProfile(questionId);
        return [questionId, recalculateProfileEntry(entry)];
      })
    ) as Record<QuestionId, QuestionProfile>
  };
}

export function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function isComplete(entry: QuestionProfile): boolean {
  return entry.updated_at.trim().length > 0;
}

export function validateImportedProfile(input: unknown): WeightingProfile {
  const root = requireRecord(input, "Profile");
  if (root.benchmark !== "grit3") {
    throw new Error('Imported profile must have benchmark "grit3".');
  }
  if (root.version !== 1) {
    throw new Error("Imported profile must have version 1.");
  }
  if (typeof root.profile_name !== "string" || !root.profile_name.trim()) {
    throw new Error("Imported profile must include a non-empty profile_name.");
  }

  const rawQuestions = requireRecord(root.questions, "questions");
  const expectedIds = new Set(QUESTION_IDS);
  const importedIds = Object.keys(rawQuestions);
  const unexpected = importedIds.filter((id) => !expectedIds.has(id as QuestionId));
  const missing = QUESTION_IDS.filter((id) => !Object.prototype.hasOwnProperty.call(rawQuestions, id));

  if (unexpected.length > 0) {
    throw new Error(`Imported profile contains unknown question id(s): ${unexpected.join(", ")}.`);
  }
  if (missing.length > 0) {
    throw new Error(`Imported profile is missing question id(s): ${missing.join(", ")}.`);
  }

  const questions = Object.fromEntries(
    QUESTION_IDS.map((questionId) => [questionId, validateQuestionProfile(rawQuestions[questionId], questionId)])
  ) as Record<QuestionId, QuestionProfile>;

  return normalizeProfile({
    benchmark: "grit3",
    profile_name: root.profile_name.trim(),
    version: 1,
    questions
  });
}

export function serializeCsv(profile: WeightingProfile): string {
  const columns = [
    "question_id",
    "number_of_concepts",
    "object_abstraction",
    "transformation_depth",
    "distractors",
    "output_precision",
    "rule_ambiguity",
    "compositionality",
    "computed_average",
    "suggested_weight_bucket",
    "manual_weight_override",
    "final_weight",
    "tags",
    "notes",
    "difficulty_rationale"
  ];

  const rows = QUESTION_IDS.map((questionId) => {
    const entry = recalculateProfileEntry(profile.questions[questionId]);
    const values = [
      entry.question_id,
      entry.ratings.number_of_concepts,
      entry.ratings.object_abstraction,
      entry.ratings.transformation_depth,
      entry.ratings.distractors,
      entry.ratings.output_precision,
      entry.ratings.rule_ambiguity,
      entry.ratings.compositionality,
      entry.computed_average,
      entry.suggested_weight_bucket,
      entry.manual_weight_override ?? "",
      entry.final_weight,
      entry.tags.join("; "),
      entry.notes,
      entry.difficulty_rationale
    ];
    return values.map(csvEscape).join(",");
  });

  return [columns.join(","), ...rows].join("\n");
}

function validateQuestionProfile(input: unknown, expectedQuestionId: QuestionId): QuestionProfile {
  const entry = requireRecord(input, expectedQuestionId);
  if (entry.question_id !== expectedQuestionId) {
    throw new Error(`Question ${expectedQuestionId} must have matching question_id.`);
  }

  const ratings = validateRatings(entry.ratings, expectedQuestionId);
  const manual = validateManualOverride(entry.manual_weight_override, expectedQuestionId);
  const tags = validateTags(entry.tags, expectedQuestionId);

  if (typeof entry.notes !== "string") {
    throw new Error(`Question ${expectedQuestionId} notes must be a string.`);
  }
  if (typeof entry.difficulty_rationale !== "string") {
    throw new Error(`Question ${expectedQuestionId} difficulty_rationale must be a string.`);
  }
  if (typeof entry.updated_at !== "string") {
    throw new Error(`Question ${expectedQuestionId} updated_at must be a string.`);
  }

  return recalculateProfileEntry({
    question_id: expectedQuestionId,
    ratings,
    computed_average: 1,
    suggested_weight_bucket: 1,
    manual_weight_override: manual,
    final_weight: 1,
    tags,
    notes: entry.notes,
    difficulty_rationale: entry.difficulty_rationale,
    updated_at: entry.updated_at
  });
}

function validateRatings(input: unknown, questionId: QuestionId): RubricRatings {
  const ratings = requireRecord(input, `${questionId}.ratings`);
  const unexpected = Object.keys(ratings).filter((key) => !RUBRIC_KEYS.includes(key as never));
  if (unexpected.length > 0) {
    throw new Error(`Question ${questionId} has unknown rating field(s): ${unexpected.join(", ")}.`);
  }

  return Object.fromEntries(
    RUBRIC_KEYS.map((key) => {
      const value = ratings[key];
      if (!isRating(value)) {
        throw new Error(`Question ${questionId} rating ${key} must be an integer from 1 to 5.`);
      }
      return [key, value];
    })
  ) as RubricRatings;
}

function validateManualOverride(input: unknown, questionId: QuestionId): Weight | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  if (!isWeight(input)) {
    throw new Error(`Question ${questionId} manual_weight_override must be null or a half-step number from 0.5 to 5.5.`);
  }
  return input;
}

function validateTags(input: unknown, questionId: QuestionId): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`Question ${questionId} tags must be an array of strings.`);
  }
  input.forEach((tag, index) => {
    if (typeof tag !== "string") {
      throw new Error(`Question ${questionId} tag ${index + 1} must be a string.`);
    }
  });
  return input.map((tag) => tag.trim()).filter(Boolean);
}

function requireRecord(input: unknown, label: string): UnknownRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  return input as UnknownRecord;
}

function csvEscape(value: unknown): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
