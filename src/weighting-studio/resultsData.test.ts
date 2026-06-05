import { describe, expect, it } from "vitest";
import { createDefaultProfile, withUpdatedEntry } from "./profile";
import { parseModelCsv, parseModelOutput, parseResultStatus, summarizeQuestionWinRates } from "./resultsData";
import type { QuestionId } from "./types";

const q3 = "q3" as QuestionId;
const q4 = "q4" as QuestionId;

function testProfile() {
  let profile = createDefaultProfile();
  profile = withUpdatedEntry(profile, q3, { manual_weight_override: 2 }, "2026-05-21T00:00:00.000Z");
  profile = withUpdatedEntry(profile, q4, { manual_weight_override: 4 }, "2026-05-21T00:00:00.000Z");
  return profile;
}

function singleResultCsv({
  modelName,
  seconds = "10",
  dollars = "",
  tokens = "",
  cellAccuracy = "100%"
}: {
  modelName: string;
  seconds?: string;
  dollars?: string;
  tokens?: string;
  cellAccuracy?: string;
}) {
  return [
    ",,Correct?,,Seconds,,Dollars,,Tokens,,Cell Accuracy,,",
    "Model:,Question 1,,,,,,,,,,,",
    `${modelName},Question 2,,,,,,,,,,,`,
    `,Question 3,1,Question Time 3,${seconds},Question Cost 3,${dollars},Question Tokens 3,${tokens},Cell Accuracy 3,${cellAccuracy},Output 3,`
  ].join("\n");
}

describe("results data", () => {
  it("uses blank cell accuracy as not evaluated", () => {
    expect(parseResultStatus("")).toEqual({ status: "not_evaluated", cellAccuracy: null });
  });

  it("uses 100% and 100.00% as correct", () => {
    expect(parseResultStatus("100%").status).toBe("correct");
    expect(parseResultStatus("100.00%").status).toBe("correct");
  });

  it("uses below 100% as wrong", () => {
    expect(parseResultStatus("99.40%")).toEqual({ status: "wrong", cellAccuracy: 99.4 });
  });

  it("skips the first row, excludes q1 and q2, and uses evaluated weight denominator", () => {
    const csv = [
      ",,Correct?,,Seconds,,Dollars,,Tokens,,Cell Accuracy,,",
      "Score:,Question 1,1,Question Time 1,10,Question Cost 1,$1,Question Tokens 1,100,Cell Accuracy 1,100%,Output 1,",
      "50%,Question 2,1,Question Time 2,10,Question Cost 2,$1,Question Tokens 2,100,Cell Accuracy 2,100%,Output 2,",
      "Total Time (seconds):,Question 3,0,Question Time 3,10,Question Cost 3,$1.50,Question Tokens 3,\"1,000\",Cell Accuracy 3,100%,Output 3,\"{\"\"output\"\": [[1]]}\"",
      "20,Question 4,0,Question Time 4,20,Question Cost 4,$2.50,Question Tokens 4,2000,Cell Accuracy 4,50%,Output 4,",
      "Model:,Question 5,0,Question Time 5,30,Question Cost 5,$3,Question Tokens 5,3000,Cell Accuracy 5,,Output 5,",
      "test model,Question 6,0,Question Time 6,40,Question Cost 6,$4,Question Tokens 6,4000,Cell Accuracy 6,,Output 6,"
    ].join("\n");

    const model = parseModelCsv("test.csv", csv, testProfile());

    expect(model.metadata.modelName).toBe("test model");
    expect(model.results.q3.status).toBe("correct");
    expect(model.results.q4.status).toBe("wrong");
    expect(model.results.q5.status).toBe("not_evaluated");
    expect(model.summary.correctCount).toBe(1);
    expect(model.summary.wrongCount).toBe(1);
    expect(model.summary.correctWeight).toBe(2);
    expect(model.summary.evaluatedWeight).toBe(6);
    expect(model.summary.evaluatedWeightedPercent).toBe(33.33);
    expect(model.summary.totalSeconds).toBe(30);
    expect(model.summary.totalDollars).toBe(4);
    expect(model.summary.totalTokens).toBe(3000);
  });

  it("summarizes per-question model win rates with evaluated-only denominator", () => {
    const profile = testProfile();
    const models = [
      parseModelCsv("correct.csv", singleResultCsv({ modelName: "correct model", cellAccuracy: "100%" }), profile),
      parseModelCsv("wrong.csv", singleResultCsv({ modelName: "wrong model", cellAccuracy: "25%" }), profile),
      parseModelCsv("blank.csv", singleResultCsv({ modelName: "blank model", cellAccuracy: "" }), profile)
    ];

    const winRates = summarizeQuestionWinRates(models);

    expect(winRates[q3]).toMatchObject({
      questionId: q3,
      correctCount: 1,
      wrongCount: 1,
      evaluatedCount: 2,
      notEvaluatedCount: 1,
      totalModelCount: 3,
      winPercent: 50
    });
    expect(winRates[q4]).toMatchObject({
      questionId: q4,
      correctCount: 0,
      wrongCount: 0,
      evaluatedCount: 0,
      notEvaluatedCount: 3,
      totalModelCount: 3,
      winPercent: null
    });
  });

  it("uses recorded cost and tokens before model estimates", () => {
    const model = parseModelCsv(
      "chatgpt.csv",
      singleResultCsv({ modelName: "chatgpt 5.5 ET", dollars: "$1.25", tokens: "123" }),
      testProfile(),
      {},
      { q3: 400 }
    );

    expect(model.results.q3.dollars).toBe(1.25);
    expect(model.results.q3.effectiveDollars).toBe(1.25);
    expect(model.results.q3.dollarsSource).toBe("recorded");
    expect(model.results.q3.tokens).toBe(123);
    expect(model.results.q3.effectiveTokens).toBe(123);
    expect(model.results.q3.tokensSource).toBe("recorded");
    expect(model.summary.totalDollars).toBe(1.25);
    expect(model.summary.totalDollarsSource).toBe("recorded");
    expect(model.summary.totalTokens).toBe(123);
    expect(model.summary.totalTokensSource).toBe("recorded");
  });

  it("estimates missing ChatGPT 5.5 cost and total tokens from prompt and runtime", () => {
    const model = parseModelCsv(
      "chatgpt.csv",
      singleResultCsv({ modelName: "chatgpt 5.5 ET" }),
      testProfile(),
      {},
      { q3: 400 }
    );

    expect(model.results.q3.effectiveTokens).toBe(2355);
    expect(model.results.q3.tokensSource).toBe("estimated");
    expect(model.results.q3.effectiveDollars).toBeCloseTo(0.055925, 6);
    expect(model.results.q3.dollarsSource).toBe("estimated");
    expect(model.summary.totalTokens).toBe(2355);
    expect(model.summary.totalTokensSource).toBe("estimated");
    expect(model.summary.totalDollars).toBe(0.0559);
    expect(model.summary.totalDollarsSource).toBe("estimated");
  });

  it("estimates missing ChatGPT 5.4 ET cost and total tokens from prompt and runtime", () => {
    const model = parseModelCsv(
      "chatgpt.csv",
      singleResultCsv({ modelName: "chatgpt 5.4 ET" }),
      testProfile(),
      {},
      { q3: 400 }
    );

    expect(model.results.q3.effectiveTokens).toBe(2355);
    expect(model.results.q3.tokensSource).toBe("estimated");
    expect(model.results.q3.effectiveDollars).toBeCloseTo(0.055925, 6);
    expect(model.results.q3.dollarsSource).toBe("estimated");
    expect(model.summary.totalTokens).toBe(2355);
    expect(model.summary.totalTokensSource).toBe("estimated");
    expect(model.summary.totalDollars).toBe(0.0559);
    expect(model.summary.totalDollarsSource).toBe("estimated");
  });

  it("attaches release dates from model name aliases", () => {
    const cases = [
      ["Claude Opus 4.8", "2026-05-28"],
      ["gemini 3.5 flash", "2026-05-19"],
      ["gemini 3.1 pro preview", "2026-02-19"],
      ["chatgpt 5.5 ET", "2026-04-23"],
      ["chatgpt 5.5 Extended thinking", "2026-04-23"],
      ["deepseek v4 pro", "2026-04-24"],
      ["grok_4.3_beta", "2026-04-17"],
      ["chatgpt 5.4 ET", "2026-03-17"],
      ["GPT-5.4 mini high flex", "2026-03-17"]
    ];

    for (const [modelName, releaseDate] of cases) {
      const model = parseModelCsv(`${modelName}.csv`, singleResultCsv({ modelName }), testProfile());
      expect(model.metadata.releaseDate).toBe(releaseDate);
    }
  });

  it("estimates missing Grok 4.3 beta cost and total tokens from prompt and runtime", () => {
    const model = parseModelCsv(
      "grok.csv",
      singleResultCsv({ modelName: "grok_4.3_beta" }),
      testProfile(),
      {},
      { q3: 400 }
    );

    expect(model.results.q3.effectiveTokens).toBe(1726);
    expect(model.results.q3.tokensSource).toBe("estimated");
    expect(model.results.q3.effectiveDollars).toBeCloseTo(0.00419, 6);
    expect(model.results.q3.dollarsSource).toBe("estimated");
    expect(model.summary.totalTokens).toBe(1726);
    expect(model.summary.totalDollars).toBe(0.0042);
  });

  it("leaves unknown models and rows without seconds blank", () => {
    const unknownModel = parseModelCsv(
      "unknown.csv",
      singleResultCsv({ modelName: "unknown model" }),
      testProfile(),
      {},
      { q3: 400 }
    );
    const noSeconds = parseModelCsv(
      "chatgpt.csv",
      singleResultCsv({ modelName: "chatgpt 5.5 ET", seconds: "" }),
      testProfile(),
      {},
      { q3: 400 }
    );

    expect(unknownModel.results.q3.effectiveDollars).toBeNull();
    expect(unknownModel.results.q3.dollarsSource).toBe("blank");
    expect(unknownModel.results.q3.effectiveTokens).toBeNull();
    expect(unknownModel.results.q3.tokensSource).toBe("blank");
    expect(noSeconds.results.q3.effectiveDollars).toBeNull();
    expect(noSeconds.results.q3.dollarsSource).toBe("blank");
    expect(noSeconds.results.q3.effectiveTokens).toBeNull();
    expect(noSeconds.results.q3.tokensSource).toBe("blank");
  });

  it("parses model outputs from output, outputs, raw grid, and grid arrays", () => {
    expect(parseModelOutput('{"output": [[1, 2]]}').outputs).toEqual([[[1, 2]]]);
    expect(parseModelOutput('{"outputs": [[[1]], [[2]]]}').outputs).toEqual([[[1]], [[2]]]);
    expect(parseModelOutput("[[1,2],[3,4]]").outputs).toEqual([
      [
        [1, 2],
        [3, 4]
      ]
    ]);
    expect(parseModelOutput("[[[1]], [[2]]]").outputs).toEqual([[[1]], [[2]]]);
  });

  it("attaches validation issues when expected outputs are provided", () => {
    const csv = [
      ",,Correct?,,Seconds,,Dollars,,Tokens,,Cell Accuracy,,",
      "Model:,Question 1,,,,,,,,,,,",
      "validation fixture,Question 2,,,,,,,,,,,",
      ",Question 3,1,Question Time 3,1,Question Cost 3,,Question Tokens 3,,Cell Accuracy 3,100%,Output 3,\"{\"\"output\"\": [[0]]}\""
    ].join("\n");

    const model = parseModelCsv("validation.csv", csv, testProfile(), {
      q3: [[[1]]]
    });

    expect(model.results.q3.cellAccuracyRaw).toBe("100%");
    expect(model.results.q3.computedValidation?.cellAccuracyRaw).toBe("0.00%");
    expect(model.results.q3.validationIssues.map((issue) => issue.kind)).toEqual([
      "percent_mismatch",
      "correct_flag_mismatch"
    ]);
    expect(model.summary.validationIssueCount).toBe(2);
    expect(model.summary.validationQuestionCount).toBe(1);
  });
});
