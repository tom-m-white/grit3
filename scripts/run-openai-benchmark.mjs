#!/usr/bin/env node
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compareGrid, gradeOutputs } from "../src/weighting-studio/resultsValidationCore.js";

export { compareGrid, gradeOutputs };

export const QUESTION_IDS = Array.from({ length: 25 }, (_, index) => `q${index + 3}`);

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const VALID_REASONING = new Set(["none", "low", "medium", "high", "xhigh"]);
const MAX_ATTEMPTS = 1;
const CSV_HEADER = [
  "",
  "",
  "Correct?",
  "",
  "Seconds",
  "",
  "Dollars",
  "",
  "Tokens",
  "",
  "Cell Accuracy",
  "",
  ""
];

export function parseArgs(argv) {
  const options = {
    model: "",
    name: "",
    reasoning: "",
    serviceTier: "",
    concurrency: 1,
    output: "",
    dryRun: false,
    inputPricePer1m: null,
    outputPricePer1m: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--flex") {
      options.serviceTier = "flex";
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }
    index += 1;

    if (arg === "--model") {
      options.model = next;
    } else if (arg === "--name") {
      options.name = next;
    } else if (arg === "--reasoning") {
      if (!VALID_REASONING.has(next)) {
        throw new Error("--reasoning must be one of none, low, medium, high, or xhigh.");
      }
      options.reasoning = next;
    } else if (arg === "--concurrency") {
      options.concurrency = parsePositiveInteger(next, "--concurrency");
    } else if (arg === "--output") {
      options.output = next;
    } else if (arg === "--input-price-per-1m") {
      options.inputPricePer1m = parseNonNegativeNumber(next, "--input-price-per-1m");
    } else if (arg === "--output-price-per-1m") {
      options.outputPricePer1m = parseNonNegativeNumber(next, "--output-price-per-1m");
    } else {
      throw new Error(`Unknown option ${arg}.`);
    }
  }

  if (options.concurrency > QUESTION_IDS.length) {
    options.concurrency = QUESTION_IDS.length;
  }

  return options;
}

export function validateOptions(options, env = process.env) {
  if (options.help) {
    return;
  }
  if (!options.model) {
    throw new Error("--model is required.");
  }
  if (!options.dryRun && !env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required unless --dry-run is set.");
  }
  if ((options.inputPricePer1m === null) !== (options.outputPricePer1m === null)) {
    throw new Error("Provide both --input-price-per-1m and --output-price-per-1m, or neither.");
  }
}

export async function loadBenchmarkQuestions(rootDir = process.cwd()) {
  const questionsDir = path.join(rootDir, "questions");
  const questions = [];

  for (const questionId of QUESTION_IDS) {
    const filePath = path.join(questionsDir, `${questionId}.json`);
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    const task = validateTask(raw, questionId);
    questions.push({
      questionId,
      questionNumber: Number(questionId.slice(1)),
      task
    });
  }

  return questions;
}

export function validateTask(input, label = "task") {
  if (!isPlainObject(input)) {
    throw new Error(`${label} must be an object.`);
  }
  if (!Array.isArray(input.train) || !Array.isArray(input.test)) {
    throw new Error(`${label} must include train and test arrays.`);
  }

  return {
    train: input.train.map((pair, index) => validatePair(pair, `${label}.train[${index}]`, true)),
    test: input.test.map((pair, index) => validatePair(pair, `${label}.test[${index}]`, true))
  };
}

export function preparePromptTask(task) {
  return {
    train: task.train.map((pair) => ({
      input: pair.input,
      output: pair.output
    })),
    test: task.test.map((pair) => ({
      input: pair.input
    }))
  };
}

export function buildQuestionPrompt(questionId, task) {
  const promptTask = preparePromptTask(task);
  return [
    "Solve this ARC-style grid transformation task.",
    "Cells are integers 0 through 9. Infer the rule from train examples, then produce one output grid for each test input.",
    'Return only JSON matching {"outputs":[grid,...]} with outputs in the same order as the test inputs.',
    "",
    `Question: ${questionId}`,
    JSON.stringify(promptTask)
  ].join("\n");
}

export function buildOpenAIRequestBody({ model, reasoning, serviceTier, question }) {
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You solve ARC-style grid puzzles. Return only the requested JSON output. Do not include explanation."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildQuestionPrompt(question.questionId, question.task)
          }
        ]
      }
    ],
    text: {
      format: buildResponseFormat(question.task.test.length)
    }
  };

  if (reasoning) {
    body.reasoning = { effort: reasoning };
  }
  if (serviceTier) {
    body.service_tier = serviceTier;
  }

  return body;
}

export function buildResponseFormat(testCount) {
  return {
    type: "json_schema",
    name: "arc_outputs",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["outputs"],
      properties: {
        outputs: {
          type: "array",
          minItems: testCount,
          maxItems: testCount,
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "array",
              minItems: 1,
              items: {
                type: "integer",
                minimum: 0,
                maximum: 9
              }
            }
          }
        }
      }
    }
  };
}

export function parseModelOutputText(text, testCount) {
  const parsed = JSON.parse(text.trim());
  if (!isPlainObject(parsed) || !Array.isArray(parsed.outputs)) {
    throw new Error('Model output must be an object with an "outputs" array.');
  }
  if (parsed.outputs.length !== testCount) {
    throw new Error(`Model output contains ${parsed.outputs.length} grid(s), but task has ${testCount} test case(s).`);
  }
  return parsed.outputs.map((grid, index) => validateGrid(grid, `outputs[${index}]`));
}

export function generateResultsCsv({ modelName, date, reasoning, results }) {
  const resultByQuestion = new Map(results.map((result) => [result.questionNumber, result]));
  const rows = [CSV_HEADER];

  for (let questionNumber = 1; questionNumber <= 27; questionNumber += 1) {
    rows.push(buildCsvRow(questionNumber, metadataNote(questionNumber, modelName, date, reasoning), resultByQuestion.get(questionNumber)));
  }

  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

export async function runAllQuestions(questions, options) {
  const results = new Array(questions.length);
  let nextIndex = 0;
  const workerCount = Math.min(options.concurrency, questions.length);

  async function runWorker() {
    while (nextIndex < questions.length) {
      const index = nextIndex;
      nextIndex += 1;
      const question = questions[index];
      options.log?.(`[${index + 1}/${questions.length}] Running ${question.questionId}`);
      results[index] = await runQuestionWithRetries(question, options);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export async function runQuestionWithRetries(question, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runQuestion(question, options);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        options.log?.(`${question.questionId} attempt ${attempt} failed: ${errorMessage(error)}. Retrying...`);
        await sleep(500 * attempt);
      }
    }
  }

  options.log?.(`${question.questionId} failed after ${MAX_ATTEMPTS} attempt: ${errorMessage(lastError)}`);
  return notEvaluatedResult(question, errorMessage(lastError));
}

export async function runQuestion(question, options) {
  const started = Date.now();
  const response = await callOpenAI(question, options);
  const seconds = roundToTwo((Date.now() - started) / 1000);
  const outputText = extractResponseText(response);
  const predictedOutputs = parseModelOutputText(outputText, question.task.test.length);
  const expectedOutputs = question.task.test.map((pair) => pair.output);
  const grade = gradeOutputs(expectedOutputs, predictedOutputs);
  const usage = extractTokenUsage(response);
  const dollars = calculateCost(usage, options.inputPricePer1m, options.outputPricePer1m);

  return {
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    correctFlag: grade.correctFlag,
    seconds,
    dollars,
    tokens: usage.totalTokens,
    cellAccuracy: grade.cellAccuracy,
    output: JSON.stringify({ outputs: predictedOutputs }),
    error: ""
  };
}

export async function callOpenAI(question, options) {
  const body = buildOpenAIRequestBody({
    model: options.model,
    reasoning: options.reasoning,
    serviceTier: options.serviceTier,
    question
  });
  const response = await options.fetchFn(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed with ${response.status}: ${truncate(errorText, 500)}`);
  }

  return response.json();
}

export function fetchOpenAI(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method,
        headers: options.headers
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("error", reject);
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = chunks.join("");
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode ?? 0,
            text: async () => text,
            json: async () => JSON.parse(text)
          });
        });
      }
    );

    request.setTimeout(OPENAI_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`OpenAI request timed out after ${OPENAI_REQUEST_TIMEOUT_MS / 60_000} minutes.`));
    });
    request.on("error", reject);
    request.end(options.body);
  });
}

export function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const texts = [];
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.refusal === "string" && content.refusal.trim()) {
        throw new Error(`Model refused the request: ${content.refusal}`);
      }
      if (typeof content?.text === "string") {
        texts.push(content.text);
      }
    }
  }

  const text = texts.join("\n").trim();
  if (!text) {
    throw new Error("OpenAI response did not contain output text.");
  }
  return text;
}

export function extractTokenUsage(response) {
  const usage = response?.usage ?? {};
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  const totalTokens = numberOrNull(usage.total_tokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || null);

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

export function defaultOutputPath(rootDir, modelName, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "_");
  return path.join(rootDir, "data", `Artifical Intelligence Google Sheet - grit3_${slugify(modelName)}_${stamp}.csv`);
}

export async function main(argv = process.argv.slice(2), env = process.env, rootDir = process.cwd()) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  validateOptions(options, env);
  const modelName = options.name || options.model;
  const questions = await loadBenchmarkQuestions(rootDir);
  const outputPath = path.resolve(rootDir, options.output || defaultOutputPath(rootDir, modelName));

  if (options.dryRun) {
    for (const question of questions) {
      assertPromptDoesNotLeakTestOutputs(question);
      buildOpenAIRequestBody({
        model: options.model,
        reasoning: options.reasoning,
        serviceTier: options.serviceTier,
        question
      });
    }
    console.log(`Dry run OK: loaded ${questions.length} questions (${QUESTION_IDS[0]}-${QUESTION_IDS.at(-1)}).`);
    console.log(`Model: ${options.model}`);
    console.log(`Output path: ${outputPath}`);
    console.log("No API requests made.");
    return 0;
  }

  const results = await runAllQuestions(questions, {
    apiKey: env.OPENAI_API_KEY,
    model: options.model,
    reasoning: options.reasoning,
    serviceTier: options.serviceTier,
    concurrency: options.concurrency,
    inputPricePer1m: options.inputPricePer1m,
    outputPricePer1m: options.outputPricePer1m,
    fetchFn: fetchOpenAI,
    log: (message) => console.log(message)
  });
  const csv = generateResultsCsv({
    modelName,
    date: new Date().toISOString().slice(0, 10),
    reasoning: options.reasoning,
    results
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, "utf8");

  const evaluated = results.filter((result) => result.cellAccuracy).length;
  const correct = results.filter((result) => result.correctFlag === "1").length;
  console.log(`Wrote ${outputPath}`);
  console.log(`Evaluated ${evaluated}/${results.length}; exact correct ${correct}/${evaluated}.`);
  return 0;
}

function validatePair(input, label, requireOutput) {
  if (!isPlainObject(input)) {
    throw new Error(`${label} must be an object.`);
  }
  const pair = {
    input: validateGrid(input.input, `${label}.input`)
  };
  if (input.output !== undefined) {
    pair.output = validateGrid(input.output, `${label}.output`);
  } else if (requireOutput) {
    throw new Error(`${label}.output is required.`);
  }
  return pair;
}

export function validateGrid(input, label = "grid") {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`${label} must be a non-empty grid.`);
  }
  const width = Array.isArray(input[0]) ? input[0].length : 0;
  if (width === 0) {
    throw new Error(`${label} must have at least one column.`);
  }

  return input.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error(`${label} row ${rowIndex + 1} must match grid width ${width}.`);
    }
    return row.map((cell, columnIndex) => {
      if (!Number.isInteger(cell) || cell < 0 || cell > 9) {
        throw new Error(`${label} cell ${rowIndex + 1},${columnIndex + 1} must be an integer from 0 to 9.`);
      }
      return cell;
    });
  });
}

function notEvaluatedResult(question, error) {
  return {
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    correctFlag: "",
    seconds: null,
    dollars: null,
    tokens: null,
    cellAccuracy: "",
    output: "",
    error
  };
}

function buildCsvRow(questionNumber, notes, result) {
  return [
    notes,
    `Question ${questionNumber}`,
    result?.correctFlag ?? "",
    `Question Time ${questionNumber}`,
    formatNumberCell(result?.seconds),
    `Question Cost ${questionNumber}`,
    formatMoneyCell(result?.dollars),
    `Question Tokens ${questionNumber}`,
    formatNumberCell(result?.tokens),
    `Cell Accuracy ${questionNumber}`,
    result?.cellAccuracy ?? "",
    `Output ${questionNumber}`,
    result?.output ?? ""
  ];
}

function metadataNote(questionNumber, modelName, date, reasoning) {
  if (questionNumber === 1) {
    return "Model:";
  }
  if (questionNumber === 2) {
    return modelName;
  }
  if (questionNumber === 3) {
    return "Date:";
  }
  if (questionNumber === 4) {
    return date;
  }
  if (questionNumber === 5) {
    return "Thinking level:";
  }
  if (questionNumber === 6) {
    return reasoning || "";
  }
  return "";
}

function assertPromptDoesNotLeakTestOutputs(question) {
  const promptTask = preparePromptTask(question.task);
  for (const testCase of promptTask.test) {
    if (Object.prototype.hasOwnProperty.call(testCase, "output")) {
      throw new Error(`${question.questionId} prompt includes a hidden test output.`);
    }
  }
}

function calculateCost(usage, inputPricePer1m, outputPricePer1m) {
  if (inputPricePer1m === null || outputPricePer1m === null || usage.inputTokens === null || usage.outputTokens === null) {
    return null;
  }
  return roundToSix((usage.inputTokens / 1_000_000) * inputPricePer1m + (usage.outputTokens / 1_000_000) * outputPricePer1m);
}

function parsePositiveInteger(value, label) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function parseNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return number;
}

function formatPercent(value) {
  return `${(Math.round(value * 10000) / 100).toFixed(2)}%`;
}

function formatNumberCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function formatMoneyCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function csvEscape(value) {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "openai";
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function roundToSix(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function errorMessage(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause;
  if (!cause) {
    return error.message;
  }

  const causeMessage = errorMessage(cause);
  const causeCode = typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  return `${error.message}: ${causeCode ? `${causeCode} ` : ""}${causeMessage}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-openai-benchmark.mjs --model <model-id> [options]",
    "",
    "Options:",
    "  --name <display-name>              Model name written to the CSV metadata",
    "  --reasoning <level>                none, low, medium, high, or xhigh",
    "  --flex                             Use Flex processing at Batch API token rates",
    "  --concurrency <n>                  Number of questions to run at once, default 1",
    "  --output <path>                    CSV output path, default data/...",
    "  --input-price-per-1m <n>           Input token price for cost calculation",
    "  --output-price-per-1m <n>          Output token price for cost calculation",
    "  --dry-run                          Validate local files and request bodies without API calls"
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    }
  );
}
