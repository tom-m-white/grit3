import { appPath } from "./routes";
import { requireSupabase } from "./supabaseClient";
import type { ProfileRole } from "./account";

export interface PublicProfileSummary {
  username: string;
  role: ProfileRole;
  completed_run_count: number;
  best_correct_weight: number;
  best_total_weight: number;
  latest_correct_weight: number;
  latest_total_weight: number;
  created_draft_count: number;
  created_submitted_count: number;
  created_needs_changes_count: number;
  created_verified_count: number;
  created_rejected_count: number;
}

type PublicProfileRow = Partial<Record<keyof PublicProfileSummary, unknown>>;

export function normalizeProfileSearchQuery(query: string): string {
  return query.trim().replace(/^@+/, "");
}

export function canSearchProfiles(query: string): boolean {
  return normalizeProfileSearchQuery(query).length >= 2;
}

export function publicProfilePath(username: string): string {
  return `${appPath("/profile.html")}?u=${encodeURIComponent(username)}`;
}

export function profileStoreErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export async function searchPublicProfiles(query: string): Promise<PublicProfileSummary[]> {
  const normalized = normalizeProfileSearchQuery(query);
  if (normalized.length < 2) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc("search_public_profiles", { query_text: normalized });
  if (error) {
    throw error;
  }
  return mapPublicProfileRows(data);
}

export async function getPublicProfile(username: string): Promise<PublicProfileSummary | null> {
  const normalized = normalizeProfileSearchQuery(username);
  if (!normalized) {
    return null;
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc("get_public_profile", { username_text: normalized });
  if (error) {
    throw error;
  }
  return mapPublicProfileRows(data)[0] ?? null;
}

export function mapPublicProfileRows(input: unknown): PublicProfileSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((row) => mapPublicProfileRow(row as PublicProfileRow)).filter((row) => row.username.length > 0);
}

export function mapPublicProfileRow(row: PublicProfileRow): PublicProfileSummary {
  return {
    username: readString(row.username),
    role: row.role === "admin" ? "admin" : "user",
    completed_run_count: readNumber(row.completed_run_count),
    best_correct_weight: readNumber(row.best_correct_weight),
    best_total_weight: readNumber(row.best_total_weight),
    latest_correct_weight: readNumber(row.latest_correct_weight),
    latest_total_weight: readNumber(row.latest_total_weight),
    created_draft_count: readNumber(row.created_draft_count),
    created_submitted_count: readNumber(row.created_submitted_count),
    created_needs_changes_count: readNumber(row.created_needs_changes_count),
    created_verified_count: readNumber(row.created_verified_count),
    created_rejected_count: readNumber(row.created_rejected_count)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
