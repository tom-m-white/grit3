import { validateArcTask } from "./creatorGrid";
import { appPath } from "./routes";
import type { ArcGrid, ArcTask } from "./types";

export type DuelAttemptMode = "one" | "unlimited";
export type DuelChallengeStatus = "pending" | "accepted" | "active" | "completed" | "declined" | "cancelled";
export type DuelPlayerStatus = "waiting" | "solving" | "won" | "lost";
export type DuelParticipantRole = "challenger" | "challenged";
export type DuelWinReason = "correct" | "opponent_wrong" | "forfeit" | "cancelled" | null;

export interface ParsedDuelTask {
  task: ArcTask | null;
  error: string | null;
}

export interface DuelSubmissionOutcome {
  complete: boolean;
  loserId: string | null;
  winnerId: string | null;
  winReason: Exclude<DuelWinReason, null> | null;
}

export function duelChallengePath(challengeId: string): string {
  return `${appPath("/challenge.html")}?id=${encodeURIComponent(challengeId)}`;
}

export function parseDuelTaskJson(raw: string): ParsedDuelTask {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { task: null, error: "Paste task JSON or choose a JSON file." };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const task = readArcTask(parsed);
    if (!task) {
      return { task: null, error: "JSON must contain train and test arrays." };
    }

    const errors = validateArcTask(task);
    if (errors.length > 0) {
      return { task: null, error: errors.slice(0, 3).join(" ") };
    }

    return { task, error: null };
  } catch (error) {
    return { task: null, error: error instanceof Error ? error.message : "Could not parse task JSON." };
  }
}

export function expectedOutputsForDuelTask(task: ArcTask): ArcGrid[] {
  return task.test.map((pair) => pair.output).filter((grid): grid is ArcGrid => Boolean(grid));
}

export function createDuelSubmissionOutcome({
  attemptMode,
  correct,
  opponentUserId,
  viewerUserId
}: {
  attemptMode: DuelAttemptMode;
  correct: boolean;
  opponentUserId: string;
  viewerUserId: string;
}): DuelSubmissionOutcome {
  if (correct) {
    return {
      complete: true,
      loserId: opponentUserId,
      winnerId: viewerUserId,
      winReason: "correct"
    };
  }

  if (attemptMode === "one") {
    return {
      complete: true,
      loserId: viewerUserId,
      winnerId: opponentUserId,
      winReason: "opponent_wrong"
    };
  }

  return {
    complete: false,
    loserId: null,
    winnerId: null,
    winReason: null
  };
}

export function canEditAttemptMode({
  role,
  status
}: {
  role: DuelParticipantRole;
  status: DuelChallengeStatus;
}): boolean {
  return role === "challenger" && (status === "pending" || status === "accepted");
}

export function isOpenDuelStatus(status: DuelChallengeStatus): boolean {
  return status === "pending" || status === "accepted" || status === "active";
}

function readArcTask(input: unknown): ArcTask | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const candidate = input as Partial<ArcTask>;
  if (!Array.isArray(candidate.train) || !Array.isArray(candidate.test)) {
    return null;
  }
  return {
    train: candidate.train.map((pair) => ({
      input: cloneGrid((pair as { input?: ArcGrid }).input),
      output: cloneGrid((pair as { output?: ArcGrid }).output)
    })),
    test: candidate.test.map((pair) => ({
      input: cloneGrid((pair as { input?: ArcGrid }).input),
      output: cloneGrid((pair as { output?: ArcGrid }).output)
    }))
  };
}

function cloneGrid(input: ArcGrid | undefined): ArcGrid {
  return Array.isArray(input) ? input.map((row) => (Array.isArray(row) ? [...row] : [])) : [];
}
