import { describe, expect, it } from "vitest";
import { validateCsvText } from "./validate-results.mjs";

describe("results validator CLI helpers", () => {
  it("validates a CSV fixture and reports row-level issues", () => {
    const csv = [
      ",,Correct?,,Seconds,,Dollars,,Tokens,,Cell Accuracy,,",
      "Model:,Question 1,,,,,,,,,,,",
      "fixture model,Question 2,,,,,,,,,,,",
      ",Question 3,1,Question Time 3,1,Question Cost 3,,Question Tokens 3,,Cell Accuracy 3,100%,Output 3,\"{\"\"output\"\": [[1]]}\"",
      ",Question 4,1,Question Time 4,1,Question Cost 4,,Question Tokens 4,,Cell Accuracy 4,100%,Output 4,\"{\"\"output\"\": [[0]]}\"",
      ",Question 5,,Question Time 5,,Question Cost 5,,Question Tokens 5,,Cell Accuracy 5,,Output 5,"
    ].join("\n");

    const report = validateCsvText("fixture.csv", csv, {
      q3: [[[1]]],
      q4: [[[1]]],
      q5: [[[1]]]
    });

    expect(report.modelName).toBe("fixture model");
    expect(report.checkedRows).toBe(2);
    expect(report.issues.map((issue) => `${issue.questionId}:${issue.kind}`)).toEqual([
      "q4:percent_mismatch",
      "q4:correct_flag_mismatch"
    ]);
    expect(report.issues[0]).toMatchObject({
      fileName: "fixture.csv",
      modelName: "fixture model",
      questionNumber: 4,
      sheetPercent: "100%",
      computedPercent: "0.00%"
    });
  });
});
