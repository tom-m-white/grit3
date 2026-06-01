import { requireSupabase } from "./supabaseClient";
import type {
  DuelAttemptMode,
  DuelChallengeStatus,
  DuelParticipantRole,
  DuelPlayerStatus,
  DuelWinReason
} from "./duelSession";
import type { ArcGrid, ArcTask } from "./types";

export interface DuelChallengeSummary {
  id: string;
  status: DuelChallengeStatus;
  attempt_mode: DuelAttemptMode;
  challenger_id: string;
  challenger_username: string;
  challenged_id: string;
  challenged_username: string;
  opponent_id: string;
  opponent_username: string;
  role: DuelParticipantRole;
  viewer_task_uploaded: boolean;
  opponent_task_uploaded: boolean;
  viewer_state_status: DuelPlayerStatus | null;
  opponent_state_status: DuelPlayerStatus | null;
  viewer_submission_count: number;
  opponent_submission_count: number;
  started_at: string | null;
  completed_at: string | null;
  winner_id: string | null;
  winner_username: string | null;
  win_reason: DuelWinReason;
  created_at: string;
  updated_at: string;
}

export interface DuelChallengeDetail extends DuelChallengeSummary {
  opponent_task: ArcTask | null;
  viewer_draft_outputs: ArcGrid[] | null;
  viewer_started_at: string | null;
  viewer_completed_at: string | null;
  viewer_elapsed_ms: number | null;
}

type DuelChallengeRow = Record<string, unknown>;

export async function createDuelChallenge(challengedUsername: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_duel_challenge", {
    challenged_username: challengedUsername
  });
  if (error) {
    throw error;
  }
  if (typeof data !== "string" || !data) {
    throw new Error("Challenge could not be created.");
  }
  return data;
}

export async function listUserDuelChallenges(): Promise<DuelChallengeSummary[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("list_duel_challenges");
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data.map((row) => mapDuelChallengeSummary(row as DuelChallengeRow)) : [];
}

export async function getDuelChallenge(challengeId: string): Promise<DuelChallengeDetail | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_duel_challenge", {
    challenge_uuid: challengeId
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapDuelChallengeDetail(row as DuelChallengeRow) : null;
}

export async function respondDuelChallenge(challengeId: string, accepted: boolean): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("respond_duel_challenge", {
    accepted,
    challenge_uuid: challengeId
  });
  if (error) {
    throw error;
  }
}

export async function setDuelAttemptMode(challengeId: string, attemptMode: DuelAttemptMode): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("set_duel_attempt_mode", {
    challenge_uuid: challengeId,
    next_attempt_mode: attemptMode
  });
  if (error) {
    throw error;
  }
}

export async function uploadDuelTask(challengeId: string, task: ArcTask): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("upload_duel_task", {
    challenge_uuid: challengeId,
    task_payload: task
  });
  if (error) {
    throw error;
  }
}

export async function saveDuelDraft(challengeId: string, draftOutputs: ArcGrid[]): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("save_duel_draft", {
    challenge_uuid: challengeId,
    draft_outputs: cloneOutputs(draftOutputs)
  });
  if (error) {
    throw error;
  }
}

export async function recordDuelSubmission({
  challengeId,
  correct,
  submittedOutputs
}: {
  challengeId: string;
  correct: boolean;
  submittedOutputs: ArcGrid[];
}): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc("record_duel_submission", {
    challenge_uuid: challengeId,
    correct,
    submitted_outputs: cloneOutputs(submittedOutputs)
  });
  if (error) {
    throw error;
  }
}

export function mapDuelChallengeSummary(row: DuelChallengeRow): DuelChallengeSummary {
  return {
    id: readString(row.id),
    status: readDuelStatus(row.status),
    attempt_mode: readAttemptMode(row.attempt_mode),
    challenger_id: readString(row.challenger_id),
    challenger_username: readString(row.challenger_username),
    challenged_id: readString(row.challenged_id),
    challenged_username: readString(row.challenged_username),
    opponent_id: readString(row.opponent_id),
    opponent_username: readString(row.opponent_username),
    role: row.role === "challenged" ? "challenged" : "challenger",
    viewer_task_uploaded: readBoolean(row.viewer_task_uploaded),
    opponent_task_uploaded: readBoolean(row.opponent_task_uploaded),
    viewer_state_status: readPlayerStatus(row.viewer_state_status),
    opponent_state_status: readPlayerStatus(row.opponent_state_status),
    viewer_submission_count: readNumber(row.viewer_submission_count),
    opponent_submission_count: readNumber(row.opponent_submission_count),
    started_at: readNullableString(row.started_at),
    completed_at: readNullableString(row.completed_at),
    winner_id: readNullableString(row.winner_id),
    winner_username: readNullableString(row.winner_username),
    win_reason: readWinReason(row.win_reason),
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at)
  };
}

export function mapDuelChallengeDetail(row: DuelChallengeRow): DuelChallengeDetail {
  return {
    ...mapDuelChallengeSummary(row),
    opponent_task: readArcTask(row.opponent_task),
    viewer_draft_outputs: readOutputs(row.viewer_draft_outputs),
    viewer_started_at: readNullableString(row.viewer_started_at),
    viewer_completed_at: readNullableString(row.viewer_completed_at),
    viewer_elapsed_ms: readNullableNumber(row.viewer_elapsed_ms)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
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

function readNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : readNumber(value);
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function readAttemptMode(value: unknown): DuelAttemptMode {
  return value === "unlimited" ? "unlimited" : "one";
}

function readDuelStatus(value: unknown): DuelChallengeStatus {
  if (value === "accepted" || value === "active" || value === "completed" || value === "declined" || value === "cancelled") {
    return value;
  }
  return "pending";
}

function readPlayerStatus(value: unknown): DuelPlayerStatus | null {
  if (value === "waiting" || value === "solving" || value === "won" || value === "lost") {
    return value;
  }
  return null;
}

function readWinReason(value: unknown): DuelWinReason {
  if (value === "correct" || value === "opponent_wrong" || value === "forfeit" || value === "cancelled") {
    return value;
  }
  return null;
}

function readArcTask(value: unknown): ArcTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ArcTask>;
  if (!Array.isArray(candidate.train) || !Array.isArray(candidate.test)) {
    return null;
  }
  return candidate as ArcTask;
}

function readOutputs(value: unknown): ArcGrid[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value as ArcGrid[];
}

function cloneOutputs(outputs: ArcGrid[]): ArcGrid[] {
  return outputs.map((grid) => grid.map((row) => [...row]));
}
