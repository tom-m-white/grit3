import { describe, expect, it } from "vitest";
import {
  canSearchProfiles,
  mapPublicProfileRows,
  normalizeProfileSearchQuery,
  profileStoreErrorMessage
} from "./publicProfileStore";

describe("profile search helpers", () => {
  it("normalizes profile search text", () => {
    expect(normalizeProfileSearchQuery("  @AdminUser  ")).toBe("AdminUser");
    expect(normalizeProfileSearchQuery("@@two")).toBe("two");
  });

  it("requires at least two username characters before searching", () => {
    expect(canSearchProfiles("a")).toBe(false);
    expect(canSearchProfiles("@a")).toBe(false);
    expect(canSearchProfiles("@al")).toBe(true);
  });

  it("reads Supabase error messages from plain response objects", () => {
    expect(profileStoreErrorMessage({ message: "permission denied for function search_public_profiles" }, "fallback")).toBe(
      "permission denied for function search_public_profiles"
    );
    expect(profileStoreErrorMessage({}, "fallback")).toBe("fallback");
  });

  it("maps public profile rows defensively", () => {
    const rows = mapPublicProfileRows([
      {
        username: "root",
        role: "admin",
        completed_run_count: "2",
        best_correct_weight: 9,
        best_total_weight: "12",
        latest_correct_weight: 6,
        latest_total_weight: 12,
        created_draft_count: null,
        created_submitted_count: 1,
        created_needs_changes_count: "3",
        created_verified_count: 4,
        created_rejected_count: "bad"
      },
      {
        username: "",
        role: "admin"
      }
    ]);

    expect(rows).toEqual([
      {
        username: "root",
        role: "admin",
        completed_run_count: 2,
        best_correct_weight: 9,
        best_total_weight: 12,
        latest_correct_weight: 6,
        latest_total_weight: 12,
        created_draft_count: 0,
        created_submitted_count: 1,
        created_needs_changes_count: 3,
        created_verified_count: 4,
        created_rejected_count: 0
      }
    ]);
  });
});
