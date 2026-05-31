import type { ArcGrid, QuestionId } from "./types";

export type ValidationIssueKind =
  | "missing_expected"
  | "missing_cell_accuracy"
  | "missing_output"
  | "parse_error"
  | "output_count_mismatch"
  | "percent_mismatch"
  | "correct_flag_mismatch";

export interface GridComparison {
  exact: boolean;
  dimensionsMatch: boolean;
  mismatches: number;
  totalCells: number;
  accuracy: number;
}

export interface OutputGrade {
  exact: boolean;
  correctFlag: "0" | "1";
  mismatches: number;
  totalCells: number;
  accuracy: number;
  cellAccuracy: string;
  cellAccuracyValue: number;
  comparisons: GridComparison[];
}

export interface ParsedModelOutput {
  outputs: ArcGrid[];
  error: string | null;
}

export interface ValidationInput {
  questionId: QuestionId;
  cellAccuracyRaw: string;
  rawCorrectFlag: string;
  outputRaw: string;
  outputParseError: string | null;
  parsedOutputs: ArcGrid[];
}

export interface ComputedValidationResult {
  exact: boolean;
  correctFlag: "0" | "1";
  cellAccuracyRaw: string;
  cellAccuracy: number;
  mismatches: number;
  totalCells: number;
}

export interface ResultValidationIssue {
  kind: ValidationIssueKind;
  questionId: QuestionId;
  message: string;
  sheetPercent: string | null;
  computedPercent: string | null;
  sheetFlag: string | null;
  computedFlag: "0" | "1" | null;
  mismatches: number | null;
  totalCells: number | null;
}

export function parseModelOutput(raw: string): ParsedModelOutput;
export function compareGrid(expected: ArcGrid, predicted: ArcGrid): GridComparison;
export function gradeOutputs(expectedOutputs: ArcGrid[], predictedOutputs: ArcGrid[]): OutputGrade;
export function validateQuestionResult(
  result: ValidationInput,
  expectedOutputs: ArcGrid[] | undefined
): { computed: ComputedValidationResult | null; issues: ResultValidationIssue[] };
export function parsePercent(value: string): number | null;
export function displayedPercentDecimals(value: string): number | null;
export function percentMatchesDisplayedPrecision(rawSheetPercent: string, sheetPercent: number, grade: OutputGrade): boolean;
export function formatPercent(value: number): string;
