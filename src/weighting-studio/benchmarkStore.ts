import { gradeOutputs } from "./resultsValidationCore.js";
import {
  createInitialQuestionProgress,
  selectNextHumanQuestionId,
  type BenchmarkRunStatus,
  type HumanQuestionProgress,
  type HumanQuestionStatus,
  type HumanSubmission
} from "./humanBenchmarkSession";
import { QUESTION_IDS } from "./rubric";
import { requireSupabase } from "./supabaseClient";
import type { ArcGrid, QuestionId } from "./types";

export interface BenchmarkRunRow {
  id: string;
  user_id: string;
  status: BenchmarkRunStatus;
  started_at: string;
  completed_at: string | null;
  total_elapsed_ms: number | null;
  current_question_id: QuestionId | null;
  created_at: string;
  updated_at: string;
}

export interface BenchmarkQuestionRecordRow extends HumanQuestionProgress {
  id: string;
  run_id: string;
  user_id: string;
  draft_outputs: ArcGrid[] | null;
  created_at: string;
  updated_at: string;
}

export interface HumanSubmissionRow extends HumanSubmission {
  id: string;
  record_id: string;
  run_id: string;
  user_id: string;
  question_id: QuestionId;
}

export interface BenchmarkRunBundle {
  run: BenchmarkRunRow;
  records: BenchmarkQuestionRecordRow[];
}

export async function loadLatestOpenRun(userId: string): Promise<BenchmarkRunBundle | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("benchmark_runs")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return loadRunBundle((data as BenchmarkRunRow).id);
}

export async function loadRunBundle(runId: string): Promise<BenchmarkRunBundle> {
  const client = requireSupabase();
  const [runResult, recordsResult] = await Promise.all([
    client.from("benchmark_runs").select("*").eq("id", runId).single(),
    client.from("benchmark_question_records").select("*").eq("run_id", runId).order("question_id", { ascending: true })
  ]);

  if (runResult.error) {
    throw runResult.error;
  }
  if (recordsResult.error) {
    throw recordsResult.error;
  }

  return {
    run: runResult.data as BenchmarkRunRow,
    records: sortQuestionRecords(recordsResult.data as BenchmarkQuestionRecordRow[])
  };
}

export async function listUserRuns(userId: string): Promise<BenchmarkRunBundle[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("benchmark_runs")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false });

  if (error) {
    throw error;
  }

  const runs = (data ?? []) as BenchmarkRunRow[];
  return Promise.all(runs.map((run) => loadRunBundle(run.id)));
}

export async function createBenchmarkRun(userId: string, weightsByQuestion: Record<QuestionId, number>): Promise<BenchmarkRunBundle> {
  const client = requireSupabase();
  const now = new Date().toISOString();
  const { data: run, error: runError } = await client
    .from("benchmark_runs")
    .insert({
      user_id: userId,
      status: "active",
      started_at: now,
      current_question_id: null
    })
    .select("*")
    .single();

  if (runError) {
    throw runError;
  }

  const progress = createInitialQuestionProgress(QUESTION_IDS, weightsByQuestion);
  const records = progress.map((record) => ({
    run_id: (run as BenchmarkRunRow).id,
    user_id: userId,
    question_id: record.question_id,
    weight: record.weight,
    status: record.status,
    final_correct: record.final_correct,
    first_submission_correct: record.first_submission_correct,
    submission_count: record.submission_count,
    started_at: record.started_at,
    completed_at: record.completed_at,
    elapsed_ms: record.elapsed_ms,
    draft_outputs: null
  }));

  const { error: recordsError } = await client.from("benchmark_question_records").insert(records);
  if (recordsError) {
    throw recordsError;
  }

  return loadRunBundle((run as BenchmarkRunRow).id);
}

export async function startOrResumeBenchmarkQuestion(bundle: BenchmarkRunBundle): Promise<BenchmarkRunBundle> {
  const existingQuestionId = selectNextHumanQuestionId(bundle.records);
  if (!existingQuestionId) {
    return completeRun(bundle);
  }

  const record = bundle.records.find((item) => item.question_id === existingQuestionId);
  if (!record) {
    return bundle;
  }

  const client = requireSupabase();
  const now = new Date().toISOString();
  const updates: Partial<BenchmarkQuestionRecordRow> = {
    status: record.status === "not_started" ? "in_progress" : record.status,
    started_at: record.started_at ?? now
  };

  const [recordResult, runResult] = await Promise.all([
    client.from("benchmark_question_records").update(updates).eq("id", record.id).select("*").single(),
    client
      .from("benchmark_runs")
      .update({ status: "active", current_question_id: existingQuestionId, updated_at: now })
      .eq("id", bundle.run.id)
      .select("*")
      .single()
  ]);

  if (recordResult.error) {
    throw recordResult.error;
  }
  if (runResult.error) {
    throw runResult.error;
  }

  return {
    run: runResult.data as BenchmarkRunRow,
    records: sortQuestionRecords(
      bundle.records.map((item) => (item.id === record.id ? (recordResult.data as BenchmarkQuestionRecordRow) : item))
    )
  };
}

export async function saveBenchmarkDraft(recordId: string, draftOutputs: ArcGrid[]): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from("benchmark_question_records")
    .update({ draft_outputs: cloneOutputs(draftOutputs), updated_at: new Date().toISOString() })
    .eq("id", recordId);
  if (error) {
    throw error;
  }
}

export async function recordBenchmarkSubmission({
  record,
  expectedOutputs,
  submittedOutputs
}: {
  record: BenchmarkQuestionRecordRow;
  expectedOutputs: ArcGrid[];
  submittedOutputs: ArcGrid[];
}): Promise<BenchmarkQuestionRecordRow> {
  const client = requireSupabase();
  const now = Date.now();
  const submittedAt = new Date(now).toISOString();
  const startedAtMs = record.started_at ? Date.parse(record.started_at) : now;
  const previousSubmission = await loadLatestSubmission(record.id);
  const previousAtMs = previousSubmission ? Date.parse(previousSubmission.submitted_at) : startedAtMs;
  const correct = gradeOutputs(expectedOutputs, submittedOutputs).exact;
  const nextSubmissionCount = record.submission_count + 1;

  const submission: Omit<HumanSubmissionRow, "id"> = {
    record_id: record.id,
    run_id: record.run_id,
    user_id: record.user_id,
    question_id: record.question_id,
    submission_index: nextSubmissionCount,
    submitted_at: submittedAt,
    question_elapsed_ms: Math.max(0, now - startedAtMs),
    time_since_previous_submission_ms: Math.max(0, now - previousAtMs),
    outputs: cloneOutputs(submittedOutputs),
    correct
  };

  const { error: submissionError } = await client.from("human_submissions").insert(submission);
  if (submissionError) {
    throw submissionError;
  }

  const updates = {
    status: (correct ? "correct" : "wrong") satisfies HumanQuestionStatus,
    final_correct: correct ? true : record.final_correct,
    first_submission_correct: record.submission_count === 0 ? correct : record.first_submission_correct,
    submission_count: nextSubmissionCount,
    started_at: record.started_at ?? submittedAt,
    draft_outputs: cloneOutputs(submittedOutputs),
    updated_at: submittedAt
  };

  const { data, error } = await client
    .from("benchmark_question_records")
    .update(updates)
    .eq("id", record.id)
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as BenchmarkQuestionRecordRow;
}

export async function finishBenchmarkQuestion({
  bundle,
  record,
  continueRun
}: {
  bundle: BenchmarkRunBundle;
  record: BenchmarkQuestionRecordRow;
  continueRun: boolean;
}): Promise<BenchmarkRunBundle> {
  if (record.submission_count === 0 || (record.status !== "correct" && record.status !== "wrong")) {
    return bundle;
  }

  const client = requireSupabase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const startedAtMs = record.started_at ? Date.parse(record.started_at) : nowMs;

  const { data: completedRecord, error } = await client
    .from("benchmark_question_records")
    .update({
      completed_at: now,
      elapsed_ms: Math.max(0, nowMs - startedAtMs),
      final_correct: record.status === "correct",
      updated_at: now
    })
    .eq("id", record.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const records = sortQuestionRecords(
    bundle.records.map((item) => (item.id === record.id ? (completedRecord as BenchmarkQuestionRecordRow) : item))
  );

  const nextBundle = {
    run: bundle.run,
    records
  };

  const nextQuestionId = selectNextHumanQuestionId(records);
  if (!nextQuestionId) {
    return completeRun(nextBundle);
  }

  if (!continueRun) {
    const { data: pausedRun, error: pauseError } = await client
      .from("benchmark_runs")
      .update({ status: "paused", current_question_id: null, updated_at: now })
      .eq("id", bundle.run.id)
      .select("*")
      .single();
    if (pauseError) {
      throw pauseError;
    }
    return {
      run: pausedRun as BenchmarkRunRow,
      records
    };
  }

  return startOrResumeBenchmarkQuestion(nextBundle);
}

export async function loadRunSubmissions(runId: string): Promise<HumanSubmissionRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("human_submissions")
    .select("*")
    .eq("run_id", runId)
    .order("submitted_at", { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []) as HumanSubmissionRow[];
}

async function completeRun(bundle: BenchmarkRunBundle): Promise<BenchmarkRunBundle> {
  const client = requireSupabase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const totalElapsedMs = Math.max(0, nowMs - Date.parse(bundle.run.started_at));
  const { data, error } = await client
    .from("benchmark_runs")
    .update({
      status: "completed",
      completed_at: now,
      total_elapsed_ms: totalElapsedMs,
      current_question_id: null,
      updated_at: now
    })
    .eq("id", bundle.run.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return {
    run: data as BenchmarkRunRow,
    records: bundle.records
  };
}

async function loadLatestSubmission(recordId: string): Promise<HumanSubmissionRow | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("human_submissions")
    .select("*")
    .eq("record_id", recordId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as HumanSubmissionRow | null;
}

function sortQuestionRecords(records: BenchmarkQuestionRecordRow[]): BenchmarkQuestionRecordRow[] {
  const order = new Map(QUESTION_IDS.map((questionId, index) => [questionId, index]));
  return [...records].sort((a, b) => (order.get(a.question_id) ?? 999) - (order.get(b.question_id) ?? 999));
}

function cloneOutputs(outputs: ArcGrid[]): ArcGrid[] {
  return outputs.map((grid) => grid.map((row) => [...row]));
}
