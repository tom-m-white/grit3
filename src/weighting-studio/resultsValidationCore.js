export function parseModelOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { outputs: [], error: null };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const candidate =
      isPlainObject(parsed) && "output" in parsed
        ? parsed.output
        : isPlainObject(parsed) && "outputs" in parsed
          ? parsed.outputs
          : parsed;

    if (isArcGrid(candidate)) {
      return { outputs: [candidate], error: null };
    }
    if (Array.isArray(candidate) && candidate.every(isArcGrid)) {
      return { outputs: candidate, error: null };
    }

    return { outputs: [], error: "Output JSON did not contain a grid or list of grids." };
  } catch (error) {
    return { outputs: [], error: error instanceof Error ? error.message : "Could not parse output JSON." };
  }
}

export function compareGrid(expected, predicted) {
  const width = Math.max(expected[0]?.length ?? 0, predicted[0]?.length ?? 0);
  const height = Math.max(expected.length, predicted.length);
  const totalCells = width * height;
  let mismatches = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const expectedCell = expected[y]?.[x] ?? null;
      const predictedCell = predicted[y]?.[x] ?? null;
      if (expectedCell !== predictedCell) {
        mismatches += 1;
      }
    }
  }

  const dimensionsMatch = expected.length === predicted.length && (expected[0]?.length ?? 0) === (predicted[0]?.length ?? 0);
  return {
    exact: dimensionsMatch && mismatches === 0,
    dimensionsMatch,
    mismatches,
    totalCells,
    accuracy: totalCells === 0 ? 0 : (totalCells - mismatches) / totalCells
  };
}

export function gradeOutputs(expectedOutputs, predictedOutputs) {
  if (expectedOutputs.length !== predictedOutputs.length) {
    throw new Error(`Expected ${expectedOutputs.length} output grid(s), got ${predictedOutputs.length}.`);
  }

  const comparisons = expectedOutputs.map((expected, index) => compareGrid(expected, predictedOutputs[index]));
  const totalCells = comparisons.reduce((sum, comparison) => sum + comparison.totalCells, 0);
  const mismatches = comparisons.reduce((sum, comparison) => sum + comparison.mismatches, 0);
  const accuracy = totalCells === 0 ? 0 : (totalCells - mismatches) / totalCells;
  const exact = comparisons.every((comparison) => comparison.exact);

  return {
    exact,
    correctFlag: exact ? "1" : "0",
    mismatches,
    totalCells,
    accuracy,
    cellAccuracy: formatPercent(accuracy),
    cellAccuracyValue: roundToDecimals(accuracy * 100, 2),
    comparisons
  };
}

export function validateQuestionResult(result, expectedOutputs) {
  const issues = [];
  const outputRaw = result.outputRaw.trim();
  const cellAccuracyRaw = result.cellAccuracyRaw.trim();
  const sheetPercent = parsePercent(cellAccuracyRaw);
  const sheetFlag = result.rawCorrectFlag.trim();
  const normalizedSheetFlag = normalizeCorrectFlag(sheetFlag);
  const hasOutput = outputRaw.length > 0;
  const shouldBeEvaluated = sheetPercent !== null || hasOutput;

  if (!shouldBeEvaluated) {
    return { computed: null, issues };
  }

  if (!expectedOutputs || expectedOutputs.length === 0) {
    issues.push({
      kind: "missing_expected",
      questionId: result.questionId,
      message: "Expected output data is unavailable for this question.",
      sheetPercent: cellAccuracyRaw || null,
      computedPercent: null,
      sheetFlag: sheetFlag || null,
      computedFlag: null,
      mismatches: null,
      totalCells: null
    });
    return { computed: null, issues };
  }

  if (sheetPercent === null) {
    issues.push({
      kind: "missing_cell_accuracy",
      questionId: result.questionId,
      message: "Output is present but Cell Accuracy is blank or invalid.",
      sheetPercent: cellAccuracyRaw || null,
      computedPercent: null,
      sheetFlag: sheetFlag || null,
      computedFlag: null,
      mismatches: null,
      totalCells: null
    });
  }

  if (!hasOutput) {
    issues.push({
      kind: "missing_output",
      questionId: result.questionId,
      message: "Cell Accuracy is present but no output JSON was recorded.",
      sheetPercent: cellAccuracyRaw || null,
      computedPercent: null,
      sheetFlag: sheetFlag || null,
      computedFlag: null,
      mismatches: null,
      totalCells: null
    });
    return { computed: null, issues };
  }

  if (result.outputParseError) {
    issues.push({
      kind: "parse_error",
      questionId: result.questionId,
      message: `Output JSON could not be parsed: ${result.outputParseError}`,
      sheetPercent: cellAccuracyRaw || null,
      computedPercent: null,
      sheetFlag: sheetFlag || null,
      computedFlag: null,
      mismatches: null,
      totalCells: null
    });
    return { computed: null, issues };
  }

  if (result.parsedOutputs.length !== expectedOutputs.length) {
    issues.push({
      kind: "output_count_mismatch",
      questionId: result.questionId,
      message: `Expected ${expectedOutputs.length} output grid(s), got ${result.parsedOutputs.length}.`,
      sheetPercent: cellAccuracyRaw || null,
      computedPercent: null,
      sheetFlag: sheetFlag || null,
      computedFlag: null,
      mismatches: null,
      totalCells: null
    });
    return { computed: null, issues };
  }

  const grade = gradeOutputs(expectedOutputs, result.parsedOutputs);
  const computed = {
    exact: grade.exact,
    correctFlag: grade.correctFlag,
    cellAccuracyRaw: grade.cellAccuracy,
    cellAccuracy: grade.cellAccuracyValue,
    mismatches: grade.mismatches,
    totalCells: grade.totalCells
  };

  if (sheetPercent !== null && !percentMatchesDisplayedPrecision(cellAccuracyRaw, sheetPercent, grade)) {
    issues.push({
      kind: "percent_mismatch",
      questionId: result.questionId,
      message: `Sheet Cell Accuracy ${cellAccuracyRaw} recomputes to ${grade.cellAccuracy}.`,
      sheetPercent: cellAccuracyRaw,
      computedPercent: grade.cellAccuracy,
      sheetFlag: sheetFlag || null,
      computedFlag: grade.correctFlag,
      mismatches: grade.mismatches,
      totalCells: grade.totalCells
    });
  }

  if (normalizedSheetFlag !== grade.correctFlag) {
    issues.push({
      kind: "correct_flag_mismatch",
      questionId: result.questionId,
      message: `Sheet Correct? flag ${sheetFlag || "blank"} should be ${grade.correctFlag}.`,
      sheetPercent: cellAccuracyRaw || null,
      computedPercent: grade.cellAccuracy,
      sheetFlag: sheetFlag || null,
      computedFlag: grade.correctFlag,
      mismatches: grade.mismatches,
      totalCells: grade.totalCells
    });
  }

  return { computed, issues };
}

export function parsePercent(value) {
  const cleaned = value.replace("%", "").trim();
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

export function displayedPercentDecimals(value) {
  const cleaned = value.replace("%", "").trim();
  const match = cleaned.match(/^\d+(?:\.(\d+))?$/);
  if (!match) {
    return null;
  }
  return match[1]?.length ?? 0;
}

export function percentMatchesDisplayedPrecision(rawSheetPercent, sheetPercent, grade) {
  if (sheetPercent === 100) {
    return grade.exact;
  }

  const decimals = displayedPercentDecimals(rawSheetPercent) ?? 2;
  return nearlyEqual(roundToDecimals(grade.accuracy * 100, decimals), sheetPercent);
}

export function formatPercent(value) {
  return `${roundToDecimals(value * 100, 2).toFixed(2)}%`;
}

function normalizeCorrectFlag(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return "1";
  }
  if (normalized === "0" || normalized === "false") {
    return "0";
  }
  return "";
}

function isArcGrid(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (row) => Array.isArray(row) && row.length > 0 && row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 9)
    ) &&
    value.every((row) => Array.isArray(row) && row.length === value[0].length)
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function roundToDecimals(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function nearlyEqual(a, b) {
  return Math.abs(a - b) < 1e-9;
}
