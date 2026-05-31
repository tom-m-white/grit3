import { describe, expect, it } from "vitest";
import { createDefaultProfile, serializeCsv, validateImportedProfile, withUpdatedEntry } from "./profile";
import type { QuestionId } from "./types";

const q3 = "q3" as QuestionId;

describe("profile utilities", () => {
  it("initializes all q3-q27 entries with default rubric data", () => {
    const profile = createDefaultProfile();

    expect(Object.keys(profile.questions)).toHaveLength(25);
    expect(profile.questions[q3].question_id).toBe("q3");
    expect(profile.questions[q3].computed_average).toBe(1);
    expect(profile.questions[q3].final_weight).toBe(1);
    expect(profile.questions[q3].updated_at).toBe("");
  });

  it("validates an exported profile and recalculates derived fields", () => {
    const profile = withUpdatedEntry(
      createDefaultProfile(),
      q3,
      {
        ratings: {
          number_of_concepts: 5,
          object_abstraction: 5,
          transformation_depth: 5,
          distractors: 5,
          output_precision: 5,
          rule_ambiguity: 5,
          compositionality: 5
        },
        manual_weight_override: 5
      },
      "2026-05-21T12:00:00.000Z"
    );

    const imported = validateImportedProfile(JSON.parse(JSON.stringify(profile)));

    expect(imported.questions[q3].computed_average).toBe(5);
    expect(imported.questions[q3].suggested_weight_bucket).toBe(4);
    expect(imported.questions[q3].final_weight).toBe(5);
  });

  it("rejects invalid rating and question ids on import", () => {
    const invalidRating = JSON.parse(JSON.stringify(createDefaultProfile()));
    invalidRating.questions.q3.ratings.distractors = 6;
    expect(() => validateImportedProfile(invalidRating)).toThrow(/distractors/);

    const unknownQuestion = JSON.parse(JSON.stringify(createDefaultProfile()));
    unknownQuestion.questions.q28 = unknownQuestion.questions.q27;
    expect(() => validateImportedProfile(unknownQuestion)).toThrow(/unknown question id/);
  });

  it("exports CSV with escaped text fields", () => {
    const profile = withUpdatedEntry(
      createDefaultProfile(),
      q3,
      {
        tags: ["symmetry", "counting"],
        notes: 'note with comma, quote "x"',
        difficulty_rationale: "line one\nline two"
      },
      "2026-05-21T12:00:00.000Z"
    );

    const csv = serializeCsv(profile);

    expect(csv).toContain("symmetry; counting");
    expect(csv).toContain('"note with comma, quote ""x"""');
    expect(csv).toContain('"line one\nline two"');
  });
});
