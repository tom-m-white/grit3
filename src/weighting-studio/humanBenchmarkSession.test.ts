import { describe, expect, it } from "vitest";
import {
  createInitialQuestionProgress,
  findOpenQuestion,
  selectNextHumanQuestionId,
  serializeHumanBenchmarkCsv,
  serializeHumanBenchmarkJson,
  summarizeHumanSession
} from "./humanBenchmarkSession";
import type { QuestionId } from "./types";

const q3 = "q3" as QuestionId;
const q4 = "q4" as QuestionId;
const q5 = "q5" as QuestionId;
const startedAt = "2026-05-30T12:00:00.000Z";

function fixtureRecords() {
  return createInitialQuestionProgress([q3, q4, q5], { q3: 1, q4: 3, q5: 5 } as Record<QuestionId, number>);
}

describe("human benchmark session", () => {
  it("initializes every bundled question as not started for random one-at-a-time selection", () => {
    const records = fixtureRecords();

    expect(records.map((record) => record.question_id)).toEqual([q3, q4, q5]);
    expect(records.every((record) => record.status === "not_started")).toBe(true);
    expect(records[1].weight).toBe(3);
  });

  it("selects a deterministic random unseen question when there is no open question", () => {
    const records = fixtureRecords();

    expect(selectNextHumanQuestionId(records, () => 0)).toBe(q3);
    expect(selectNextHumanQuestionId(records, () => 0.5)).toBe(q4);
    expect(selectNextHumanQuestionId(records, () => 0.999)).toBe(q5);
  });

  it("resumes an open question before picking a new random question", () => {
    const records = fixtureRecords().map((record) =>
      record.question_id === q4
        ? {
            ...record,
            status: "wrong" as const,
            started_at: "2026-05-30T12:02:00.000Z",
            submission_count: 1
          }
        : record
    );

    expect(findOpenQuestion(records)?.question_id).toBe(q4);
    expect(selectNextHumanQuestionId(records, () => 0)).toBe(q4);
  });

  it("excludes completed questions from the random pool", () => {
    const records = fixtureRecords().map((record) =>
      record.question_id === q3 || record.question_id === q4
        ? {
            ...record,
            status: "correct" as const,
            final_correct: true,
            first_submission_correct: true,
            submission_count: 1,
            started_at: startedAt,
            completed_at: "2026-05-30T12:03:00.000Z",
            elapsed_ms: 180000
          }
        : record
    );

    expect(selectNextHumanQuestionId(records, () => 0)).toBe(q5);
  });

  it("summarizes completed-only progress and weighted score", () => {
    const records = fixtureRecords().map((record) => {
      if (record.question_id === q3) {
        return {
          ...record,
          status: "correct" as const,
          final_correct: true,
          first_submission_correct: false,
          submission_count: 2,
          started_at: startedAt,
          completed_at: "2026-05-30T12:03:00.000Z",
          elapsed_ms: 180000
        };
      }
      if (record.question_id === q4) {
        return {
          ...record,
          status: "wrong" as const,
          final_correct: false,
          first_submission_correct: false,
          submission_count: 1,
          started_at: startedAt,
          completed_at: "2026-05-30T12:05:00.000Z",
          elapsed_ms: 300000
        };
      }
      return record;
    });

    const summary = summarizeHumanSession(records, startedAt, null, Date.parse("2026-05-30T12:07:00.000Z"));

    expect(summary.completedQuestions).toBe(2);
    expect(summary.correctQuestions).toBe(1);
    expect(summary.wrongQuestions).toBe(1);
    expect(summary.correctWeight).toBe(1);
    expect(summary.completedWeight).toBe(4);
    expect(summary.totalWeight).toBe(9);
    expect(summary.totalSubmissions).toBe(3);
    expect(summary.totalElapsedMs).toBe(420000);
  });

  it("serializes backend-ready JSON and attempt-level CSV rows", () => {
    const records = fixtureRecords().map((record) =>
      record.question_id === q3
        ? {
            ...record,
            status: "correct" as const,
            final_correct: true,
            first_submission_correct: true,
            submission_count: 1,
            started_at: startedAt,
            completed_at: "2026-05-30T12:01:00.000Z",
            elapsed_ms: 60000
          }
        : record
    );

    const run = {
      id: "run-a",
      user_id: "user-a",
      started_at: startedAt,
      completed_at: null,
      status: "paused" as const
    };
    const submissions = [
      {
        question_id: q3,
        submission_index: 1,
        submitted_at: "2026-05-30T12:01:00.000Z",
        question_elapsed_ms: 60000,
        time_since_previous_submission_ms: 60000,
        outputs: [[[1]]],
        correct: true
      }
    ];

    const parsed = JSON.parse(serializeHumanBenchmarkJson({ run, records, submissions }));
    const csv = serializeHumanBenchmarkCsv({ run, records, submissions });

    expect(parsed.run.id).toBe("run-a");
    expect(csv).toContain("run_id,user_id");
    expect(csv).toContain("run-a,user-a");
    expect(csv).toContain("true,[[[1]]]");
  });
});
