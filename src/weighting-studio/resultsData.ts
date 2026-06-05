import bundledProfile from "../../grit3-weighting-profile.json";
import { validateImportedProfile } from "./profile";
import { QUESTION_IDS } from "./rubric";
import {
  parseModelOutput,
  parsePercent,
  validateQuestionResult,
  type ComputedValidationResult,
  type ResultValidationIssue
} from "./resultsValidationCore.js";
import type { ArcGrid, ArcTask, LoadedQuestion, QuestionId, WeightingProfile } from "./types";

export { parseModelOutput } from "./resultsValidationCore.js";

const resultCsvModules = import.meta.glob<string>("../../data/*.csv", {
  eager: true,
  import: "default",
  query: "?raw"
});

const CSV_COLUMNS = [
  "notes",
  "question",
  "correct_flag",
  "time_label",
  "seconds",
  "cost_label",
  "dollars",
  "tokens_label",
  "tokens",
  "cell_accuracy_label",
  "cell_accuracy",
  "output_label",
  "output"
] as const;

export type ResultStatus = "correct" | "wrong" | "not_evaluated";
export type MetricSource = "recorded" | "estimated" | "blank";

interface ModelEstimateConfig {
  aliases: string[];
  inputTokenMultiplier?: number;
  outputTokensPerSecond: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

interface ModelReleaseDateConfig {
  aliases: string[];
  releaseDate: string;
}

const SYSTEM_PROMPT =
  "You solve ARC-style grid puzzles. Return only the requested JSON output. Do not include explanation.";

const MODEL_ESTIMATE_CONFIGS: ModelEstimateConfig[] = [
  {
    aliases: ["chatgpt 5 4 extended thinking", "chatgpt 5 4 et", "gpt 5 4 extended thinking", "gpt 5 4 et"],
    inputTokenMultiplier: 5.89,
    outputTokensPerSecond: 176.62,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 15
  },
  {
    aliases: ["chatgpt 5 5", "gpt 5 5"],
    inputTokenMultiplier: 5.89,
    outputTokensPerSecond: 176.62,
    inputPricePerMillion: 5,
    outputPricePerMillion: 30
  },
  {
    aliases: ["grok 4 3 beta"],
    outputTokensPerSecond: 162.6,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 2.5
  }
];

const MODEL_RELEASE_DATE_CONFIGS: ModelReleaseDateConfig[] = [
  {
    aliases: ["claude opus 4 8"],
    releaseDate: "2026-05-28"
  },
  {
    aliases: ["gemini 3 5 flash"],
    releaseDate: "2026-05-19"
  },
  {
    aliases: ["gemini 3 1 pro preview"],
    releaseDate: "2026-02-19"
  },
  {
    aliases: ["chatgpt 5 5 extended thinking", "chatgpt 5 5 et", "gpt 5 5 extended thinking", "gpt 5 5 et"],
    releaseDate: "2026-04-23"
  },
  {
    aliases: ["deepseek v4 pro", "deepseek v4 pro max"],
    releaseDate: "2026-04-24"
  },
  {
    aliases: ["grok 4 3 beta"],
    releaseDate: "2026-04-17"
  },
  {
    aliases: ["chatgpt 5 4 extended thinking", "chatgpt 5 4 et", "gpt 5 4 extended thinking", "gpt 5 4 et"],
    releaseDate: "2026-03-17"
  },
  {
    aliases: ["gpt 5 4 mini high flex"],
    releaseDate: "2026-03-17"
  }
];

export interface ModelMetadata {
  modelName: string;
  date?: string;
  releaseDate?: string;
  thinkingLevel?: string;
}

export interface QuestionResult {
  question_id: QuestionId;
  questionNumber: number;
  status: ResultStatus;
  cellAccuracyRaw: string;
  cellAccuracy: number | null;
  rawCorrectFlag: string;
  seconds: number | null;
  dollars: number | null;
  tokens: number | null;
  effectiveDollars: number | null;
  dollarsSource: MetricSource;
  effectiveTokens: number | null;
  tokensSource: MetricSource;
  outputRaw: string;
  outputParseError: string | null;
  parsedOutputs: ArcGrid[];
  computedValidation: ComputedValidationResult | null;
  validationIssues: ResultValidationIssue[];
}

export interface ModelResult {
  id: string;
  fileName: string;
  metadata: ModelMetadata;
  results: Record<QuestionId, QuestionResult>;
  summary: ModelSummary;
}

export interface ModelSummary {
  evaluatedCount: number;
  correctCount: number;
  wrongCount: number;
  notEvaluatedCount: number;
  correctWeight: number;
  evaluatedWeight: number;
  totalWeight: number;
  evaluatedWeightedPercent: number | null;
  fullProgressPercent: number;
  coveragePercent: number;
  totalSeconds: number;
  totalDollars: number | null;
  totalDollarsSource: MetricSource;
  totalTokens: number | null;
  totalTokensSource: MetricSource;
  validationIssueCount: number;
  validationQuestionCount: number;
}

export interface QuestionWinRate {
  questionId: QuestionId;
  correctCount: number;
  wrongCount: number;
  evaluatedCount: number;
  notEvaluatedCount: number;
  totalModelCount: number;
  winPercent: number | null;
}

type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

export function loadBundledProfile(): WeightingProfile {
  return validateImportedProfile(bundledProfile);
}

export function loadBundledResults(profile: WeightingProfile, questions: LoadedQuestion[] = []): ModelResult[] {
  const expectedOutputs = expectedOutputsByQuestion(questions);
  const promptCharacterCounts = promptCharacterCountsByQuestion(questions);
  return Object.entries(resultCsvModules)
    .map(([path, csv]) => parseModelCsv(pathToFileName(path), csv, profile, expectedOutputs, promptCharacterCounts))
    .sort(compareModelSummaries);
}

export function parseModelCsv(
  fileName: string,
  csv: string,
  profile: WeightingProfile,
  expectedOutputs: Partial<Record<QuestionId, ArcGrid[]>> = {},
  promptCharacterCounts: Partial<Record<QuestionId, number>> = {}
): ModelResult {
  const rows = parseCsv(csv)
    .slice(1)
    .map((columns) => toCsvRow(columns));
  const extractedMetadata = extractMetadata(rows, fileName);
  const metadata = {
    ...extractedMetadata,
    releaseDate: findReleaseDate(extractedMetadata.modelName)
  };
  const estimateConfig = findEstimateConfig(metadata.modelName);
  const totalWeight = QUESTION_IDS.reduce((sum, questionId) => sum + profile.questions[questionId].final_weight, 0);

  const results = Object.fromEntries(
    QUESTION_IDS.map((questionId) => {
      const questionNumber = Number(questionId.slice(1));
      const row = rows.find((candidate) => parseQuestionNumber(candidate.question) === questionNumber);
      return [
        questionId,
        rowToQuestionResult(
          questionId,
          questionNumber,
          row,
          expectedOutputs[questionId],
          estimateConfig,
          promptCharacterCounts[questionId]
        )
      ];
    })
  ) as Record<QuestionId, QuestionResult>;

  const summary = summarizeModelResults(results, profile, totalWeight);

  return {
    id: slugify(metadata.modelName || fileName),
    fileName,
    metadata,
    results,
    summary
  };
}

export function summarizeModelResults(
  results: Record<QuestionId, QuestionResult>,
  profile: WeightingProfile,
  totalWeight = QUESTION_IDS.reduce((sum, questionId) => sum + profile.questions[questionId].final_weight, 0)
): ModelSummary {
  let evaluatedCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let notEvaluatedCount = 0;
  let correctWeight = 0;
  let evaluatedWeight = 0;
  let totalSeconds = 0;
  let totalDollars = 0;
  let totalTokens = 0;
  let totalDollarsSource: MetricSource = "blank";
  let totalTokensSource: MetricSource = "blank";
  let validationIssueCount = 0;
  let validationQuestionCount = 0;

  for (const questionId of QUESTION_IDS) {
    const result = results[questionId];
    const weight = profile.questions[questionId].final_weight;

    validationIssueCount += result.validationIssues.length;
    if (result.validationIssues.length > 0) {
      validationQuestionCount += 1;
    }

    if (result.status === "not_evaluated") {
      notEvaluatedCount += 1;
      continue;
    }

    evaluatedCount += 1;
    evaluatedWeight += weight;
    totalSeconds += result.seconds ?? 0;
    totalDollars += result.effectiveDollars ?? 0;
    totalTokens += result.effectiveTokens ?? 0;
    totalDollarsSource = mergeMetricSource(totalDollarsSource, result.dollarsSource);
    totalTokensSource = mergeMetricSource(totalTokensSource, result.tokensSource);

    if (result.status === "correct") {
      correctCount += 1;
      correctWeight += weight;
    } else {
      wrongCount += 1;
    }
  }

  return {
    evaluatedCount,
    correctCount,
    wrongCount,
    notEvaluatedCount,
    correctWeight,
    evaluatedWeight,
    totalWeight,
    evaluatedWeightedPercent: evaluatedWeight === 0 ? null : roundPercent(correctWeight / evaluatedWeight),
    fullProgressPercent: totalWeight === 0 ? 0 : roundPercent(correctWeight / totalWeight),
    coveragePercent: totalWeight === 0 ? 0 : roundPercent(evaluatedWeight / totalWeight),
    totalSeconds: roundToTwo(totalSeconds),
    totalDollars: totalDollarsSource === "blank" ? null : roundToFour(totalDollars),
    totalDollarsSource,
    totalTokens: totalTokensSource === "blank" ? null : totalTokens,
    totalTokensSource,
    validationIssueCount,
    validationQuestionCount
  };
}

export function summarizeQuestionWinRates(models: ModelResult[]): Record<QuestionId, QuestionWinRate> {
  return Object.fromEntries(
    QUESTION_IDS.map((questionId) => {
      let correctCount = 0;
      let wrongCount = 0;
      let notEvaluatedCount = 0;

      for (const model of models) {
        const status = model.results[questionId]?.status ?? "not_evaluated";
        if (status === "correct") {
          correctCount += 1;
        } else if (status === "wrong") {
          wrongCount += 1;
        } else {
          notEvaluatedCount += 1;
        }
      }

      const evaluatedCount = correctCount + wrongCount;

      return [
        questionId,
        {
          questionId,
          correctCount,
          wrongCount,
          evaluatedCount,
          notEvaluatedCount,
          totalModelCount: models.length,
          winPercent: evaluatedCount === 0 ? null : roundPercent(correctCount / evaluatedCount)
        }
      ];
    })
  ) as Record<QuestionId, QuestionWinRate>;
}

export function parseResultStatus(cellAccuracy: string): { status: ResultStatus; cellAccuracy: number | null } {
  const percent = parsePercent(cellAccuracy);
  if (percent === null) {
    return { status: "not_evaluated", cellAccuracy: null };
  }
  return {
    status: percent === 100 ? "correct" : "wrong",
    cellAccuracy: percent
  };
}

export function compareModelSummaries(a: ModelResult, b: ModelResult): number {
  return (
    (b.summary.evaluatedWeightedPercent ?? -1) - (a.summary.evaluatedWeightedPercent ?? -1) ||
    b.summary.coveragePercent - a.summary.coveragePercent ||
    b.summary.fullProgressPercent - a.summary.fullProgressPercent ||
    a.metadata.modelName.localeCompare(b.metadata.modelName)
  );
}

export function getExpectedOutputs(question: LoadedQuestion | undefined): ArcGrid[] {
  return question?.task?.test.map((pair) => pair.output).filter((grid): grid is ArcGrid => Boolean(grid)) ?? [];
}

export function buildBenchmarkPromptText(questionId: QuestionId, task: ArcTask): string {
  return [SYSTEM_PROMPT, buildQuestionPrompt(questionId, task)].join("\n");
}

function rowToQuestionResult(
  questionId: QuestionId,
  questionNumber: number,
  row: CsvRow | undefined,
  expectedOutputs: ArcGrid[] | undefined,
  estimateConfig: ModelEstimateConfig | null,
  promptCharacterCount: number | undefined
): QuestionResult {
  const cellAccuracyRaw = row?.cell_accuracy ?? "";
  const status = parseResultStatus(cellAccuracyRaw);
  const seconds = parseNumber(row?.seconds ?? "");
  const dollars = parseMoney(row?.dollars ?? "");
  const tokens = parseInteger(row?.tokens ?? "");
  const estimate = estimateQuestionMetrics(status.status, seconds, estimateConfig, promptCharacterCount);
  const outputRaw = row?.output ?? "";
  const output = parseModelOutput(outputRaw);
  const validation =
    expectedOutputs === undefined
      ? { computed: null, issues: [] }
      : validateQuestionResult(
          {
            questionId,
            cellAccuracyRaw,
            rawCorrectFlag: row?.correct_flag ?? "",
            outputRaw,
            outputParseError: output.error,
            parsedOutputs: output.outputs
          },
          expectedOutputs
        );

  return {
    question_id: questionId,
    questionNumber,
    status: status.status,
    cellAccuracyRaw,
    cellAccuracy: status.cellAccuracy,
    rawCorrectFlag: row?.correct_flag ?? "",
    seconds,
    dollars,
    tokens,
    effectiveDollars: dollars ?? estimate.dollars,
    dollarsSource: metricSource(dollars, estimate.dollars),
    effectiveTokens: tokens ?? estimate.tokens,
    tokensSource: metricSource(tokens, estimate.tokens),
    outputRaw,
    outputParseError: output.error,
    parsedOutputs: output.outputs,
    computedValidation: validation.computed,
    validationIssues: validation.issues
  };
}

function estimateQuestionMetrics(
  status: ResultStatus,
  seconds: number | null,
  estimateConfig: ModelEstimateConfig | null,
  promptCharacterCount: number | undefined
): { dollars: number | null; tokens: number | null } {
  if (status === "not_evaluated" || seconds === null || !estimateConfig || promptCharacterCount === undefined) {
    return { dollars: null, tokens: null };
  }

  const inputTokens = Math.ceil((promptCharacterCount / 4) * (estimateConfig.inputTokenMultiplier ?? 1));
  const outputTokens = Math.round(seconds * estimateConfig.outputTokensPerSecond);
  const dollars =
    (inputTokens / 1_000_000) * estimateConfig.inputPricePerMillion +
    (outputTokens / 1_000_000) * estimateConfig.outputPricePerMillion;

  return {
    dollars: roundToSix(dollars),
    tokens: inputTokens + outputTokens
  };
}

function metricSource(recorded: number | null, estimated: number | null): MetricSource {
  if (recorded !== null) {
    return "recorded";
  }
  return estimated === null ? "blank" : "estimated";
}

function mergeMetricSource(current: MetricSource, next: MetricSource): MetricSource {
  if (current === "estimated" || next === "estimated") {
    return "estimated";
  }
  if (current === "recorded" || next === "recorded") {
    return "recorded";
  }
  return "blank";
}

function extractMetadata(rows: CsvRow[], fileName: string): ModelMetadata {
  const labelValues = new Map<string, string>();
  for (let index = 0; index < rows.length; index += 1) {
    const label = rows[index].notes.trim().replace(/:$/, "").toLowerCase();
    if (!label) {
      continue;
    }
    const nextValue = rows[index + 1]?.notes?.trim();
    if (nextValue) {
      labelValues.set(label, nextValue);
    }
  }

  return {
    modelName: labelValues.get("model") ?? modelNameFromFile(fileName),
    date: labelValues.get("date"),
    thinkingLevel: labelValues.get("thinking level") ?? labelValues.get("thinking")
  };
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function toCsvRow(columns: string[]): CsvRow {
  return Object.fromEntries(CSV_COLUMNS.map((column, index) => [column, columns[index]?.trim() ?? ""])) as CsvRow;
}

function parseQuestionNumber(value: string): number | null {
  const match = value.match(/^Question\s+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function parseNumber(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

function parseMoney(value: string): number | null {
  return parseNumber(value.replace(/\$/g, ""));
}

function parseInteger(value: string): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function pathToFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function expectedOutputsByQuestion(questions: LoadedQuestion[]): Partial<Record<QuestionId, ArcGrid[]>> {
  return Object.fromEntries(questions.map((question) => [question.question_id, getExpectedOutputs(question)])) as Partial<
    Record<QuestionId, ArcGrid[]>
  >;
}

function promptCharacterCountsByQuestion(questions: LoadedQuestion[]): Partial<Record<QuestionId, number>> {
  return Object.fromEntries(
    questions
      .filter((question): question is LoadedQuestion & { task: ArcTask } => question.task !== null)
      .map((question) => [question.question_id, buildBenchmarkPromptText(question.question_id, question.task).length])
  ) as Partial<Record<QuestionId, number>>;
}

function buildQuestionPrompt(questionId: QuestionId, task: ArcTask): string {
  const promptTask = {
    train: task.train.map((pair) => ({
      input: pair.input,
      output: pair.output
    })),
    test: task.test.map((pair) => ({
      input: pair.input
    }))
  };

  return [
    "Solve this ARC-style grid transformation task.",
    "Cells are integers 0 through 9. Infer the rule from train examples, then produce one output grid for each test input.",
    'Return only JSON matching {"outputs":[grid,...]} with outputs in the same order as the test inputs.',
    "",
    `Question: ${questionId}`,
    JSON.stringify(promptTask)
  ].join("\n");
}

function findEstimateConfig(modelName: string): ModelEstimateConfig | null {
  const normalized = normalizeModelName(modelName);
  return MODEL_ESTIMATE_CONFIGS.find((config) => config.aliases.some((alias) => normalized.includes(alias))) ?? null;
}

function findReleaseDate(modelName: string): string | undefined {
  const normalized = normalizeModelName(modelName);
  return MODEL_RELEASE_DATE_CONFIGS.find((config) => config.aliases.some((alias) => normalized.includes(alias)))?.releaseDate;
}

function normalizeModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function modelNameFromFile(fileName: string): string {
  return fileName
    .replace(/^Artifical Intelligence Google Sheet - grit3_/i, "")
    .replace(/\.csv$/i, "")
    .replace(/_/g, " ");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function roundPercent(value: number): number {
  return Math.round(value * 10000) / 100;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundToSix(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
