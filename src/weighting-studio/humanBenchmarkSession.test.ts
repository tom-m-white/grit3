import { describe, expect, it } from "vitest";
import {
  advanceHumanBenchmark,
  createHumanBenchmarkSession,
  recordHumanSubmission,
  serializeHumanBenchmarkCsv,
  serializeHumanBenchmarkJson,
  summarizeHumanSession
} from "./humanBenchmarkSession";
import type { QuestionId } from "./types";

const q3 = "q3" as QuestionId;
const q4 = "q4" as QuestionId;
const q5 = "q5" as QuestionId;
const startedAt = Date.UTC(2026, 4, 30, 12, 0, 0);

function createFixtureSession(now = startedAt) {
  return createHumanBenchmarkSession({
    questionOrder: [q3, q4, q5],
    weightsByQuestion: { q3: 1, q4: 3, q5: 5 } as Record<QuestionId, number>,
    participantLabel: "tester",
    sessionId: "session-a",
    now
  });
}

describe("human benchmark session", () => {
  it("initializes a fixed locked q3-q27-style order and starts only the first question", () => {
    const session = createFixtureSession();

    expect(session.session_id).toBe("session-a");
    expect(session.participant_label).toBe("tester");
    expect(session.question_order).toEqual([q3, q4, q5]);
    expect(session.current_question_index).toBe(0);
    expect(session.questions.q3.status).toBe("in_progress");
    expect(session.questions.q4.status).toBe("not_started");
    expect(session.questions.q3.weight).toBe(1);
  });

  it("records wrong submissions and advances without allowing unanswered questions through", () => {
    let session = createFixtureSession();
    const blocked = advanceHumanBenchmark({ session, now: startedAt + 500 });
    expect(blocked.current_question_index).toBe(0);

    const recorded = recordHumanSubmission({
      session,
      expectedOutputs: [[[1]]],
      submittedOutputs: [[[0]]],
      now: startedAt + 1000
    });
    session = advanceHumanBenchmark({ session: recorded.session, now: startedAt + 2000 });

    expect(recorded.correct).toBe(false);
    expect(session.questions.q3.final_correct).toBe(false);
    expect(session.questions.q3.first_submission_correct).toBe(false);
    expect(session.questions.q3.submission_count).toBe(1);
    expect(session.questions.q3.elapsed_ms).toBe(2000);
    expect(session.current_question_index).toBe(1);
    expect(session.questions.q4.status).toBe("in_progress");
  });

  it("distinguishes correct-after-wrong from first-attempt correctness", () => {
    let session = createFixtureSession();
    session = recordHumanSubmission({
      session,
      expectedOutputs: [[[1]]],
      submittedOutputs: [[[0]]],
      now: startedAt + 1000
    }).session;
    session = recordHumanSubmission({
      session,
      expectedOutputs: [[[1]]],
      submittedOutputs: [[[1]]],
      now: startedAt + 3000
    }).session;
    session = advanceHumanBenchmark({ session, now: startedAt + 4000 });

    expect(session.questions.q3.final_correct).toBe(true);
    expect(session.questions.q3.first_submission_correct).toBe(false);
    expect(session.questions.q3.status).toBe("correct");
    expect(session.questions.q3.submission_count).toBe(2);
    expect(session.total_submission_count).toBe(2);
  });

  it("captures question-relative and per-submission timing with an injected clock", () => {
    let session = createFixtureSession(startedAt + 1000);
    session = recordHumanSubmission({
      session,
      expectedOutputs: [[[9]]],
      submittedOutputs: [[[1]]],
      now: startedAt + 2500
    }).session;
    session = recordHumanSubmission({
      session,
      expectedOutputs: [[[9]]],
      submittedOutputs: [[[2]]],
      now: startedAt + 4500
    }).session;
    session = advanceHumanBenchmark({ session, now: startedAt + 6000 });

    expect(session.questions.q3.submissions[0].question_elapsed_ms).toBe(1500);
    expect(session.questions.q3.submissions[0].time_since_previous_submission_ms).toBe(1500);
    expect(session.questions.q3.submissions[1].question_elapsed_ms).toBe(3500);
    expect(session.questions.q3.submissions[1].time_since_previous_submission_ms).toBe(2000);
    expect(session.questions.q3.elapsed_ms).toBe(5000);
  });

  it("grades multi-output submissions exactly", () => {
    const recorded = recordHumanSubmission({
      session: createFixtureSession(),
      expectedOutputs: [[[1]], [[2, 2]]],
      submittedOutputs: [[[1]], [[2, 2]]],
      now: startedAt + 1000
    });

    expect(recorded.correct).toBe(true);
    expect(recorded.session.questions.q3.final_correct).toBe(true);
  });

  it("serializes backend-ready JSON and attempt-level CSV rows", () => {
    let session = createFixtureSession();
    session = recordHumanSubmission({
      session,
      expectedOutputs: [[[1]]],
      submittedOutputs: [[[1]]],
      now: startedAt + 1000
    }).session;
    session = advanceHumanBenchmark({ session, now: startedAt + 2000 });

    const parsed = JSON.parse(serializeHumanBenchmarkJson(session));
    const csv = serializeHumanBenchmarkCsv(session);
    const summary = summarizeHumanSession(session, startedAt + 2000);

    expect(parsed.questions.q3.submissions[0].outputs).toEqual([[[1]]]);
    expect(csv).toContain("session_id,participant_label");
    expect(csv).toContain("session-a,tester");
    expect(csv).toContain("true,[[[1]]]");
    expect(summary.correctQuestions).toBe(1);
    expect(summary.correctWeight).toBe(1);
    expect(summary.totalSubmissions).toBe(1);
  });
});
