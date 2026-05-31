import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../src/weighting-studio/profile";
import { parseModelCsv } from "../src/weighting-studio/resultsData";
import {
  generateResultsCsv,
  gradeOutputs,
  loadBenchmarkQuestions,
  parseModelOutputText,
  preparePromptTask
} from "./run-openai-benchmark.mjs";

describe("OpenAI benchmark runner", () => {
  it("loads q3-q27 and strips hidden test outputs from prompt tasks", async () => {
    const questions = await loadBenchmarkQuestions(process.cwd());

    expect(questions).toHaveLength(25);
    expect(questions[0].questionId).toBe("q3");
    expect(questions.at(-1).questionId).toBe("q27");

    const promptTask = preparePromptTask(questions[0].task);
    expect(promptTask.train[0]).toHaveProperty("output");
    expect(promptTask.test[0]).toHaveProperty("input");
    expect(promptTask.test[0]).not.toHaveProperty("output");
  });

  it("validates model output shape and ARC grids", () => {
    expect(parseModelOutputText('{"outputs":[[[1,2],[3,4]]]}', 1)).toEqual([
      [
        [1, 2],
        [3, 4]
      ]
    ]);

    expect(() => parseModelOutputText('{"output":[[1]]}', 1)).toThrow(/outputs/);
    expect(() => parseModelOutputText('{"outputs":[[[1]],[[2]]]}', 1)).toThrow(/2 grid/);
    expect(() => parseModelOutputText('{"outputs":[[[1,10]]]}', 1)).toThrow(/integer from 0 to 9/);
    expect(() => parseModelOutputText('{"outputs":[[[1],[2,3]]]}', 1)).toThrow(/match grid width/);
  });

  it("grades exact, wrong, dimension-mismatched, and multi-test outputs", () => {
    expect(gradeOutputs([[[1, 2]]], [[[1, 2]]])).toMatchObject({
      exact: true,
      correctFlag: "1",
      cellAccuracy: "100.00%"
    });

    expect(gradeOutputs([[[1, 2]]], [[[1, 0]]])).toMatchObject({
      exact: false,
      correctFlag: "0",
      cellAccuracy: "50.00%"
    });

    expect(gradeOutputs([[[1]]], [[[1, 1]]])).toMatchObject({
      exact: false,
      correctFlag: "0",
      cellAccuracy: "50.00%"
    });

    expect(
      gradeOutputs(
        [
          [[1]],
          [[2, 2]]
        ],
        [
          [[1]],
          [[2, 0]]
        ]
      )
    ).toMatchObject({
      exact: false,
      correctFlag: "0",
      cellAccuracy: "66.67%"
    });
  });

  it("generates CSV rows that the results viewer can parse", () => {
    const csv = generateResultsCsv({
      modelName: "test model",
      date: "2026-05-29",
      reasoning: "high",
      results: [
        {
          questionNumber: 3,
          correctFlag: "1",
          seconds: 1.25,
          dollars: null,
          tokens: 100,
          cellAccuracy: "100.00%",
          output: '{"output":[[1]]}'
        },
        {
          questionNumber: 4,
          correctFlag: "0",
          seconds: 2.5,
          dollars: 0.001,
          tokens: 200,
          cellAccuracy: "50.00%",
          output: '{"output":[[0]]}'
        }
      ]
    });

    const model = parseModelCsv("generated.csv", csv, createDefaultProfile());

    expect(model.metadata).toEqual({
      modelName: "test model",
      date: "2026-05-29",
      thinkingLevel: "high"
    });
    expect(model.results.q3.status).toBe("correct");
    expect(model.results.q4.status).toBe("wrong");
    expect(model.results.q5.status).toBe("not_evaluated");
    expect(model.summary.evaluatedCount).toBe(2);
    expect(model.summary.totalSeconds).toBe(3.75);
    expect(model.summary.totalTokens).toBe(300);
  });
});
