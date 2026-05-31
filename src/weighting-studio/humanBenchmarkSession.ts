import { gradeOutputs } from "./resultsValidationCore.js";
import type { ArcGrid, QuestionId } from "./types";

export const HUMAN_BENCHMARK_STORAGE_KEY = "grit3.humanBenchmark.session.v1";

export type HumanQuestionStatus = "not_started" | "in_progress" | "correct" | "wrong";

export interface HumanSubmission {
  submission_index: number;
  submitted_at: string;
  question_elapsed_ms: number;
  time_since_previous_submission_ms: number;
  outputs: ArcGrid[];
  correct: boolean;
}

export interface HumanQuestionRecord {
  question_id: QuestionId;
  weight: number;
  status: HumanQuestionStatus;
  final_correct: boolean | null;
  first_submission_correct: boolean | null;
  submission_count: number;
  started_at: string | null;
  completed_at: string | null;
  elapsed_ms: number | null;
  submissions: HumanSubmission[];
}

export interface HumanBenchmarkSession {
  benchmark: "grit3-human";
  version: 1;
  session_id: string;
  participant_label: string | null;
  started_at: string;
  completed_at: string | null;
  total_elapsed_ms: number | null;
  total_submission_count: number;
  question_order: QuestionId[];
  current_question_index: number;
  questions: Record<QuestionId, HumanQuestionRecord>;
}

export interface CreateHumanBenchmarkSessionOptions {
  questionOrder: readonly QuestionId[];
  weightsByQuestion: Record<QuestionId, number>;
  participantLabel?: string;
  now?: number;
  sessionId?: string;
}

export interface RecordHumanSubmissionOptions {
  session: HumanBenchmarkSession;
  expectedOutputs: ArcGrid[];
  submittedOutputs: ArcGrid[];
  now?: number;
}

export interface AdvanceHumanBenchmarkOptions {
  session: HumanBenchmarkSession;
  now?: number;
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

export function createHumanBenchmarkSession({
  questionOrder,
  weightsByQuestion,
  participantLabel = "",
  now = Date.now(),
  sessionId = createSessionId(now)
}: CreateHumanBenchmarkSessionOptions): HumanBenchmarkSession {
  const startedAt = toIso(now);
  const questions = Object.fromEntries(
    questionOrder.map((questionId, index) => [
      questionId,
      {
        question_id: questionId,
        weight: weightsByQuestion[questionId] ?? 1,
        status: index === 0 ? "in_progress" : "not_started",
        final_correct: null,
        first_submission_correct: null,
        submission_count: 0,
        started_at: index === 0 ? startedAt : null,
        completed_at: null,
        elapsed_ms: null,
        submissions: []
      }
    ])
  ) as Record<QuestionId, HumanQuestionRecord>;

  return {
    benchmark: "grit3-human",
    version: 1,
    session_id: sessionId,
    participant_label: normalizeParticipantLabel(participantLabel),
    started_at: startedAt,
    completed_at: null,
    total_elapsed_ms: null,
    total_submission_count: 0,
    question_order: [...questionOrder],
    current_question_index: 0,
    questions
  };
}

export function currentHumanQuestionId(session: HumanBenchmarkSession): QuestionId | null {
  return session.question_order[session.current_question_index] ?? null;
}

export function recordHumanSubmission({
  session,
  expectedOutputs,
  submittedOutputs,
  now = Date.now()
}: RecordHumanSubmissionOptions): { session: HumanBenchmarkSession; correct: boolean } {
  const questionId = currentHumanQuestionId(session);
  if (!questionId || session.completed_at) {
    return { session, correct: false };
  }

  const current = session.questions[questionId];
  if (!current || current.status === "correct") {
    return { session, correct: current?.final_correct ?? false };
  }

  const correct = gradeOutputs(expectedOutputs, submittedOutputs).exact;
  const startedAtMs = current.started_at ? Date.parse(current.started_at) : now;
  const previousSubmission = current.submissions[current.submissions.length - 1];
  const previousAtMs = previousSubmission ? Date.parse(previousSubmission.submitted_at) : startedAtMs;
  const questionElapsedMs = Math.max(0, now - startedAtMs);
  const submission: HumanSubmission = {
    submission_index: current.submissions.length + 1,
    submitted_at: toIso(now),
    question_elapsed_ms: questionElapsedMs,
    time_since_previous_submission_ms: Math.max(0, now - previousAtMs),
    outputs: cloneOutputs(submittedOutputs),
    correct
  };

  const submissions = [...current.submissions, submission];
  const nextRecord: HumanQuestionRecord = {
    ...current,
    status: correct ? "correct" : "wrong",
    final_correct: correct ? true : current.final_correct,
    first_submission_correct: current.submission_count === 0 ? correct : current.first_submission_correct,
    submission_count: submissions.length,
    started_at: current.started_at ?? toIso(now),
    submissions
  };

  return {
    correct,
    session: {
      ...session,
      total_submission_count: session.total_submission_count + 1,
      questions: {
        ...session.questions,
        [questionId]: nextRecord
      }
    }
  };
}

export function advanceHumanBenchmark({
  session,
  now = Date.now()
}: AdvanceHumanBenchmarkOptions): HumanBenchmarkSession {
  const questionId = currentHumanQuestionId(session);
  if (!questionId || session.completed_at) {
    return session;
  }

  const current = session.questions[questionId];
  if (!current || current.submission_count === 0 || (current.status !== "correct" && current.status !== "wrong")) {
    return session;
  }

  const completedAt = toIso(now);
  const startedAtMs = current.started_at ? Date.parse(current.started_at) : now;
  const completedRecord: HumanQuestionRecord = {
    ...current,
    final_correct: current.status === "correct",
    completed_at: completedAt,
    elapsed_ms: Math.max(0, now - startedAtMs)
  };

  const nextIndex = session.current_question_index + 1;
  const nextQuestionId = session.question_order[nextIndex];
  const completed = nextQuestionId === undefined;
  const startedSessionAtMs = Date.parse(session.started_at);
  const nextQuestions: Record<QuestionId, HumanQuestionRecord> = {
    ...session.questions,
    [questionId]: completedRecord
  };

  if (nextQuestionId && nextQuestions[nextQuestionId].status === "not_started") {
    nextQuestions[nextQuestionId] = {
      ...nextQuestions[nextQuestionId],
      status: "in_progress",
      started_at: completedAt
    };
  }

  return {
    ...session,
    completed_at: completed ? completedAt : null,
    total_elapsed_ms: completed ? Math.max(0, now - startedSessionAtMs) : null,
    current_question_index: Math.min(nextIndex, session.question_order.length),
    questions: nextQuestions
  };
}

export function summarizeHumanSession(session: HumanBenchmarkSession, now = Date.now()): HumanSessionSummary {
  const records = session.question_order.map((questionId) => session.questions[questionId]);
  const completedRecords = records.filter((record) => record.completed_at !== null);
  const correctRecords = completedRecords.filter((record) => record.final_correct === true);
  const wrongRecords = completedRecords.filter((record) => record.final_correct === false);
  const totalWeight = records.reduce((sum, record) => sum + record.weight, 0);
  const completedWeight = completedRecords.reduce((sum, record) => sum + record.weight, 0);
  const correctWeight = correctRecords.reduce((sum, record) => sum + record.weight, 0);
  const totalElapsedMs = session.total_elapsed_ms ?? Math.max(0, now - Date.parse(session.started_at));

  return {
    totalQuestions: records.length,
    completedQuestions: completedRecords.length,
    correctQuestions: correctRecords.length,
    wrongQuestions: wrongRecords.length,
    correctWeight,
    completedWeight,
    totalWeight,
    totalSubmissions: session.total_submission_count,
    totalElapsedMs
  };
}

export function serializeHumanBenchmarkJson(session: HumanBenchmarkSession): string {
  return JSON.stringify(session, null, 2);
}

export function serializeHumanBenchmarkCsv(session: HumanBenchmarkSession): string {
  const columns = [
    "session_id",
    "participant_label",
    "session_started_at",
    "session_completed_at",
    "question_index",
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

  const rows = session.question_order.flatMap((questionId, questionIndex) => {
    const record = session.questions[questionId];
    if (record.submissions.length === 0) {
      return [
        [
          session.session_id,
          session.participant_label ?? "",
          session.started_at,
          session.completed_at ?? "",
          questionIndex + 1,
          questionId,
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

    return record.submissions.map((submission) => [
      session.session_id,
      session.participant_label ?? "",
      session.started_at,
      session.completed_at ?? "",
      questionIndex + 1,
      questionId,
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

function createSessionId(now: number): string {
  const timestamp = toIso(now).replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 10);
  return `human-${timestamp}-${random}`;
}

function normalizeParticipantLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed ? trimmed : null;
}

function cloneOutputs(outputs: ArcGrid[]): ArcGrid[] {
  return outputs.map((grid) => grid.map((row) => [...row]));
}

function toIso(timeMs: number): string {
  return new Date(timeMs).toISOString();
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
