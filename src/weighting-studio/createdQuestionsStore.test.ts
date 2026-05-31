import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./createdQuestionsStore";

describe("created question store helpers", () => {
  it("normalizes valid titles", () => {
    expect(normalizeTitle("  Symmetry check  ")).toBe("Symmetry check");
  });

  it("rejects missing or very long titles", () => {
    expect(() => normalizeTitle(" ")).toThrow(/title is required/i);
    expect(() => normalizeTitle("x".repeat(121))).toThrow(/120 characters/i);
  });
});
