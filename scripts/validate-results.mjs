#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { QUESTION_IDS, loadBenchmarkQuestions } from "./run-openai-benchmark.mjs";
import { parseModelOutput, validateQuestionResult } from "../src/weighting-studio/resultsValidationCore.js";

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
];

export function parseArgs(argv) {
  const options = {
    dataDir: "data",
    maxIssues: 100,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }
    index += 1;

    if (arg === "--data-dir") {
      options.dataDir = next;
    } else if (arg === "--max-issues") {
      options.maxIssues = parsePositiveInteger(next, "--max-issues");
    } else {
      throw new Error(`Unknown option ${arg}.`);
    }
  }

  return options;
}

export async function validateResults(rootDir = process.cwd(), options = {}) {
  const dataDir = path.resolve(rootDir, options.dataDir ?? "data");
  const questions = await loadBenchmarkQuestions(rootDir);
  const expectedOutputs = Object.fromEntries(
    questions.map((question) => [question.questionId, question.task.test.map((pair) => pair.output)])
  );
  const files = (await fs.readdir(dataDir)).filter((file) => file.toLowerCase().endsWith(".csv")).sort();
  const fileReports = [];
  let checkedRows = 0;

  for (const fileName of files) {
    const csv = await fs.readFile(path.join(dataDir, fileName), "utf8");
    const report = validateCsvText(fileName, csv, expectedOutputs);
    checkedRows += report.checkedRows;
    fileReports.push(report);
  }

  const issues = fileReports.flatMap((report) => report.issues);
  return {
    dataDir,
    fileCount: files.length,
    checkedRows,
    issueCount: issues.length,
    issues,
    files: fileReports
  };
}

export function validateCsvText(fileName, csv, expectedOutputs) {
  const rows = parseCsv(csv)
    .slice(1)
    .map((columns) => toCsvRow(columns));
  const metadata = extractMetadata(rows, fileName);
  const issues = [];
  let checkedRows = 0;

  for (const questionId of QUESTION_IDS) {
    const questionNumber = Number(questionId.slice(1));
    const row = rows.find((candidate) => parseQuestionNumber(candidate.question) === questionNumber);
    if (!row) {
      continue;
    }

    if (!row.cell_accuracy && !row.output) {
      continue;
    }

    checkedRows += 1;
    const output = parseModelOutput(row.output);
    const validation = validateQuestionResult(
      {
        questionId,
        cellAccuracyRaw: row.cell_accuracy,
        rawCorrectFlag: row.correct_flag,
        outputRaw: row.output,
        outputParseError: output.error,
        parsedOutputs: output.outputs
      },
      expectedOutputs[questionId]
    );

    issues.push(
      ...validation.issues.map((issue) => ({
        ...issue,
        fileName,
        modelName: metadata.modelName,
        questionNumber
      }))
    );
  }

  return {
    fileName,
    modelName: metadata.modelName,
    checkedRows,
    issueCount: issues.length,
    issues
  };
}

export function formatReport(report, maxIssues = 100) {
  const lines = [];
  lines.push(`Validated ${report.checkedRows} row(s) across ${report.fileCount} CSV file(s).`);

  if (report.issueCount === 0) {
    lines.push("All reported Cell Accuracy values match the recorded outputs.");
    return lines.join("\n");
  }

  lines.push(`Found ${report.issueCount} validation issue(s).`);
  for (const fileReport of report.files.filter((candidate) => candidate.issueCount > 0)) {
    lines.push(``);
    lines.push(`${fileReport.modelName} (${fileReport.fileName}) - ${fileReport.issueCount} issue(s)`);
    for (const issue of fileReport.issues.slice(0, maxIssues)) {
      lines.push(`  ${formatIssue(issue)}`);
    }
    if (fileReport.issues.length > maxIssues) {
      lines.push(`  ... ${fileReport.issues.length - maxIssues} more issue(s) hidden by --max-issues.`);
    }
  }

  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), rootDir = process.cwd()) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const report = await validateResults(rootDir, options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report, options.maxIssues));
  }
  return report.issueCount === 0 ? 0 : 1;
}

function formatIssue(issue) {
  const cells =
    issue.mismatches === null || issue.totalCells === null ? "" : ` (${issue.mismatches}/${issue.totalCells} mismatched cells)`;
  return `${issue.questionId} ${issue.kind}: ${issue.message}${cells}`;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
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

function toCsvRow(columns) {
  return Object.fromEntries(CSV_COLUMNS.map((column, index) => [column, (columns[index] ?? "").trim()]));
}

function extractMetadata(rows, fileName) {
  const labelValues = new Map();
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
    modelName: labelValues.get("model") ?? modelNameFromFile(fileName)
  };
}

function parseQuestionNumber(value) {
  const match = value.match(/^Question\s+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function modelNameFromFile(fileName) {
  return fileName
    .replace(/^Artifical Intelligence Google Sheet - grit3_/i, "")
    .replace(/\.csv$/i, "")
    .replace(/_/g, " ");
}

function parsePositiveInteger(value, label) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function usage() {
  return [
    "Usage:",
    "  npm run validate:results",
    "  node scripts/validate-results.mjs [options]",
    "",
    "Options:",
    "  --data-dir <path>       Directory containing result CSV files, default data",
    "  --max-issues <n>        Maximum issues printed per file, default 100",
    "  --json                  Print machine-readable JSON",
    "  --help                  Show this help"
  ].join("\n");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
