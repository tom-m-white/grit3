import { requireSupabase } from "./supabaseClient";
import type { ArcTask } from "./types";

export type CreatedQuestionStatus = "draft" | "submitted" | "needs_changes" | "verified" | "rejected";

export interface CreatedQuestionRow {
  id: string;
  owner_id: string;
  title: string;
  task: ArcTask;
  review_status: CreatedQuestionStatus;
  reviewer_notes: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveCreatedQuestionOptions {
  id?: string | null;
  ownerId: string;
  title: string;
  task: ArcTask;
  reviewStatus: Extract<CreatedQuestionStatus, "draft" | "submitted">;
}

export async function saveCreatedQuestion({
  id,
  ownerId,
  title,
  task,
  reviewStatus
}: SaveCreatedQuestionOptions): Promise<CreatedQuestionRow> {
  const client = requireSupabase();
  const now = new Date().toISOString();
  const payload = {
    owner_id: ownerId,
    title: normalizeTitle(title),
    task,
    review_status: reviewStatus,
    submitted_at: reviewStatus === "submitted" ? now : null,
    updated_at: now
  };

  const query = id
    ? client.from("created_questions").update(payload).eq("id", id).select("*").single()
    : client.from("created_questions").insert(payload).select("*").single();

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data as CreatedQuestionRow;
}

export async function listUserCreatedQuestions(ownerId: string): Promise<CreatedQuestionRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("created_questions")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as CreatedQuestionRow[];
}

export async function deleteCreatedQuestion({
  ownerId,
  questionId
}: {
  ownerId: string;
  questionId: string;
}): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("created_questions")
    .delete()
    .eq("id", questionId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Question was not removed. It may already be gone or you may not have permission.");
  }
}

export async function listReviewQueue(): Promise<CreatedQuestionRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("created_questions")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    throw error;
  }
  return (data ?? []) as CreatedQuestionRow[];
}

export async function updateCreatedQuestionReview({
  questionId,
  reviewerId,
  status,
  notes
}: {
  questionId: string;
  reviewerId: string;
  status: CreatedQuestionStatus;
  notes: string;
}): Promise<CreatedQuestionRow> {
  const client = requireSupabase();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("created_questions")
    .update({
      review_status: status,
      reviewer_notes: notes,
      reviewer_id: reviewerId,
      reviewed_at: now,
      updated_at: now
    })
    .eq("id", questionId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }
  return data as CreatedQuestionRow;
}

export function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error("Question title is required.");
  }
  if (normalized.length > 120) {
    throw new Error("Question title must be 120 characters or fewer.");
  }
  return normalized;
}
