import { describe, expect, it } from "vitest";
import { gradeOutputs, parseModelOutput, validateQuestionResult } from "./resultsValidationCore.js";
import type { ArcGrid, QuestionId } from "./types";

const q3 = "q3" as QuestionId;

function validate({
  expected,
  outputRaw,
  cellAccuracyRaw,
  rawCorrectFlag = "0"
}: {
  expected: ArcGrid[];
  outputRaw: string;
  cellAccuracyRaw: string;
  rawCorrectFlag?: string;
}) {
  const output = parseModelOutput(outputRaw);
  return validateQuestionResult(
    {
      questionId: q3,
      cellAccuracyRaw,
      rawCorrectFlag,
      outputRaw,
      outputParseError: output.error,
      parsedOutputs: output.outputs
    },
    expected
  );
}

describe("results validation core", () => {
  it("validates exact matches", () => {
    const result = validate({
      expected: [[[1, 2]]],
      outputRaw: '{"output": [[1, 2]]}',
      cellAccuracyRaw: "100%",
      rawCorrectFlag: "1"
    });

    expect(result.issues).toEqual([]);
    expect(result.computed).toMatchObject({
      exact: true,
      correctFlag: "1",
      cellAccuracyRaw: "100.00%"
    });
  });

  it("validates partial matches and dimension mismatches with benchmark grading semantics", () => {
    expect(gradeOutputs([[[1, 2]]], [[[1, 0]]])).toMatchObject({
      correctFlag: "0",
      cellAccuracy: "50.00%"
    });

    expect(gradeOutputs([[[1]]], [[[1, 1]]])).toMatchObject({
      correctFlag: "0",
      cellAccuracy: "50.00%"
    });
  });

  it("validates multi-test outputs in order", () => {
    const result = validate({
      expected: [
        [[1]],
        [[2, 2]]
      ],
      outputRaw: '{"outputs": [[[1]], [[2, 0]]]}',
      cellAccuracyRaw: "66.67%",
      rawCorrectFlag: "0"
    });

    expect(result.issues).toEqual([]);
    expect(result.computed?.mismatches).toBe(1);
    expect(result.computed?.totalCells).toBe(3);
  });

  it("flags malformed JSON and output count mismatches", () => {
    const parseError = validate({
      expected: [[[1]]],
      outputRaw: "No response.",
      cellAccuracyRaw: "0.00%",
      rawCorrectFlag: "0"
    });
    expect(parseError.issues.map((issue) => issue.kind)).toEqual(["parse_error"]);

    const countMismatch = validate({
      expected: [
        [[1]],
        [[2]]
      ],
      outputRaw: '{"outputs": [[[1]]]}',
      cellAccuracyRaw: "50.00%",
      rawCorrectFlag: "0"
    });
    expect(countMismatch.issues.map((issue) => issue.kind)).toEqual(["output_count_mismatch"]);
  });

  it("treats blank accuracy plus blank output as not evaluated", () => {
    const result = validate({
      expected: [[[1]]],
      outputRaw: "",
      cellAccuracyRaw: "",
      rawCorrectFlag: "0"
    });

    expect(result).toEqual({ computed: null, issues: [] });
  });

  it("uses displayed precision tolerance but treats 100% strictly", () => {
    const expected = [
      [
        [1, 1, 1, 1],
        [1, 1, 1, 1]
      ]
    ];
    const outputRaw = '{"output": [[1, 1, 1, 1], [1, 1, 1, 0]]}';

    expect(validate({ expected, outputRaw, cellAccuracyRaw: "88%", rawCorrectFlag: "0" }).issues).toEqual([]);
    expect(validate({ expected, outputRaw, cellAccuracyRaw: "87%", rawCorrectFlag: "0" }).issues).toHaveLength(1);
    expect(validate({ expected, outputRaw, cellAccuracyRaw: "87.5%", rawCorrectFlag: "0" }).issues).toEqual([]);
    expect(validate({ expected, outputRaw, cellAccuracyRaw: "87.6%", rawCorrectFlag: "0" }).issues).toHaveLength(1);

    expect(validate({ expected, outputRaw, cellAccuracyRaw: "100%", rawCorrectFlag: "1" }).issues.map((issue) => issue.kind)).toEqual([
      "percent_mismatch",
      "correct_flag_mismatch"
    ]);
  });

  it("flags missing scored outputs and correct flag mismatches", () => {
    expect(
      validate({
        expected: [[[1]]],
        outputRaw: "",
        cellAccuracyRaw: "50%",
        rawCorrectFlag: "0"
      }).issues.map((issue) => issue.kind)
    ).toEqual(["missing_output"]);

    expect(
      validate({
        expected: [[[1]]],
        outputRaw: '{"output": [[1]]}',
        cellAccuracyRaw: "100%",
        rawCorrectFlag: "0"
      }).issues.map((issue) => issue.kind)
    ).toEqual(["correct_flag_mismatch"]);
  });
});
