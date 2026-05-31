import type { ArcGrid, QuestionId } from "./types";

export type HumanQuestionStatus = "not_started" | "in_progress" | "correct" | "wrong";
export type BenchmarkRunStatus = "active" | "paused" | "completed";

export interface HumanQuestionProgress {
  question_id: QuestionId;
  weight: number;
  status: HumanQuestionStatus;
  final_correct: boolean | null;
  first_submission_correct: boolean | null;
  submission_count: number;
  started_at: string | null;
  completed_at: string | null;
  elapsed_ms: number | null;
}

export interface HumanSubmission {
  submission_index: number;
  submitted_at: string;
  question_elapsed_ms: number;
  time_since_previous_submission_ms: number;
  outputs: ArcGrid[];
  correct: boolean;
}

export interface HumanSessionSummary {
  totalQuestions: number;
  completedQuestions: number;
  correctQuestions: number;
  wrongQuestions: number;
  correctWeight: number;
  completedWeight: number;
  totalWeight: number;
  totalSubmissions: number;
  totalElapsedMs: number;
}

export function createInitialQuestionProgress(
  questionOrder: readonly QuestionId[],
  weightsByQuestion: Record<QuestionId, number>
): HumanQuestionProgress[] {
  return questionOrder.map((questionId) => ({
    question_id: questionId,
    weight: weightsByQuestion[questionId] ?? 1,
    status: "not_started",
    final_correct: null,
    first_submission_correct: null,
    submission_count: 0,
    started_at: null,
    completed_at: null,
    elapsed_ms: null
  }));
}

export function findOpenQuestion(records: readonly HumanQuestionProgress[]): HumanQuestionProgress | null {
  return (
    records.find((record) => record.started_at !== null && record.completed_at === null && record.status !== "not_started") ?? null
  );
}

export function selectNextHumanQuestionId(
  records: readonly HumanQuestionProgress[],
  random: () => number = Math.random
): QuestionId | null {
  const open = findOpenQuestion(records);
  if (open) {
    return open.question_id;
  }

  const candidates = records.filter((record) => record.completed_at === null && record.status === "not_started");
  if (candidates.length === 0) {
    return null;
  }

  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index].question_id;
}

export function summarizeHumanSession(
  records: readonly HumanQuestionProgress[],
  startedAt: string,
  completedAt: string | null = null,
  now = Date.now()
): HumanSessionSummary {
  const completedRecords = records.filter((record) => record.completed_at !== null);
  const correctRecords = completedRecords.filter((record) => record.final_correct === true);
  const wrongRecords = completedRecords.filter((record) => record.final_correct === false);
  const totalWeight = records.reduce((sum, record) => sum + record.weight, 0);
  const completedWeight = completedRecords.reduce((sum, record) => sum + record.weight, 0);
  const correctWeight = correctRecords.reduce((sum, record) => sum + record.weight, 0);
  const totalElapsedMs = Math.max(0, Date.parse(completedAt ?? new Date(now).toISOString()) - Date.parse(startedAt));

  return {
    totalQuestions: records.length,
    completedQuestions: completedRecords.length,
    correctQuestions: correctRecords.length,
    wrongQuestions: wrongRecords.length,
    correctWeight,
    completedWeight,
    totalWeight,
    totalSubmissions: records.reduce((sum, record) => sum + record.submission_count, 0),
    totalElapsedMs
  };
}

export function serializeHumanBenchmarkJson(input: unknown): string {
  return JSON.stringify(input, null, 2);
}

export function serializeHumanBenchmarkCsv({
  run,
  records,
  submissions = []
}: {
  run: { id: string; user_id: string; started_at: string; completed_at: string | null; status: BenchmarkRunStatus };
  records: readonly HumanQuestionProgress[];
  submissions?: readonly (HumanSubmission & { question_id: QuestionId })[];
}): string {
  const columns = [
    "run_id",
    "user_id",
    "run_started_at",
    "run_completed_at",
    "run_status",
    "question_id",
    "weight",
    "question_status",
    "final_correct",
    "first_submission_correct",
    "submission_count",
    "question_started_at",
    "question_completed_at",
    "question_elapsed_ms",
    "submission_index",
    "submitted_at",
    "submission_question_elapsed_ms",
    "time_since_previous_submission_ms",
    "submission_correct",
    "outputs_json"
  ];

  const rows = records.flatMap((record) => {
    const recordSubmissions = submissions.filter((submission) => submission.question_id === record.question_id);
    if (recordSubmissions.length === 0) {
      return [
        [
          run.id,
          run.user_id,
          run.started_at,
          run.completed_at ?? "",
          run.status,
          record.question_id,
          record.weight,
          record.status,
          nullableBoolean(record.final_correct),
          nullableBoolean(record.first_submission_correct),
          record.submission_count,
          record.started_at ?? "",
          record.completed_at ?? "",
          record.elapsed_ms ?? "",
          "",
          "",
          "",
          "",
          "",
          ""
        ]
      ];
    }

    return recordSubmissions.map((submission) => [
      run.id,
      run.user_id,
      run.started_at,
      run.completed_at ?? "",
      run.status,
      record.question_id,
      record.weight,
      record.status,
      nullableBoolean(record.final_correct),
      nullableBoolean(record.first_submission_correct),
      record.submission_count,
      record.started_at ?? "",
      record.completed_at ?? "",
      record.elapsed_ms ?? "",
      submission.submission_index,
      submission.submitted_at,
      submission.question_elapsed_ms,
      submission.time_since_previous_submission_ms,
      String(submission.correct),
      JSON.stringify(submission.outputs)
    ]);
  });

  return [columns.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function nullableBoolean(value: boolean | null): string {
  return value === null ? "" : String(value);
}

function csvEscape(value: unknown): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
