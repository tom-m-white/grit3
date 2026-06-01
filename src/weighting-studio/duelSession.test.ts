import { describe, expect, it } from "vitest";
import {
  canEditAttemptMode,
  createDuelSubmissionOutcome,
  duelChallengePath,
  expectedOutputsForDuelTask,
  isOpenDuelStatus,
  parseDuelTaskJson
} from "./duelSession";
import type { ArcTask } from "./types";

const validTask: ArcTask = {
  train: [
    {
      input: [[1, 0]],
      output: [[0, 1]]
    }
  ],
  test: [
    {
      input: [[2, 0]],
      output: [[0, 2]]
    }
  ]
};

describe("duel session helpers", () => {
  it("parses valid ARC task JSON and extracts expected test outputs", () => {
    const parsed = parseDuelTaskJson(JSON.stringify(validTask));

    expect(parsed.error).toBeNull();
    expect(parsed.task?.train).toHaveLength(1);
    expect(expectedOutputsForDuelTask(parsed.task as ArcTask)).toEqual([[[0, 2]]]);
  });

  it("rejects missing test outputs so challenge tasks can be graded", () => {
    const parsed = parseDuelTaskJson(
      JSON.stringify({
        train: validTask.train,
        test: [{ input: [[1]] }]
      })
    );

    expect(parsed.task).toBeNull();
    expect(parsed.error).toMatch(/test\[0\]\.output/i);
  });

  it("computes one-attempt and unlimited duel outcomes", () => {
    expect(
      createDuelSubmissionOutcome({
        attemptMode: "one",
        correct: false,
        opponentUserId: "opponent",
        viewerUserId: "viewer"
      })
    ).toEqual({
      complete: true,
      loserId: "viewer",
      winnerId: "opponent",
      winReason: "opponent_wrong"
    });

    expect(
      createDuelSubmissionOutcome({
        attemptMode: "unlimited",
        correct: false,
        opponentUserId: "opponent",
        viewerUserId: "viewer"
      })
    ).toEqual({
      complete: false,
      loserId: null,
      winnerId: null,
      winReason: null
    });
  });

  it("locks host-only attempt editing before a round starts", () => {
    expect(canEditAttemptMode({ role: "challenger", status: "accepted" })).toBe(true);
    expect(canEditAttemptMode({ role: "challenger", status: "active" })).toBe(false);
    expect(canEditAttemptMode({ role: "challenged", status: "accepted" })).toBe(false);
  });

  it("identifies open challenge statuses and builds challenge URLs", () => {
    expect(isOpenDuelStatus("pending")).toBe(true);
    expect(isOpenDuelStatus("completed")).toBe(false);
    expect(duelChallengePath("abc 123")).toContain("/challenge.html?id=abc%20123");
  });
});
