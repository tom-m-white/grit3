import { useEffect, useId, useRef, useState } from "react";
import {
  canSearchProfiles,
  profileStoreErrorMessage,
  publicProfilePath,
  searchPublicProfiles,
  type PublicProfileSummary
} from "./publicProfileStore";
import { isSupabaseConfigured } from "./supabaseClient";

interface ProfileSearchProps {
  className?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  variant?: "compact" | "hero";
}

export function ProfileSearch({
  className = "",
  id,
  label = "Search profiles",
  placeholder = "Search profiles",
  variant = "compact"
}: ProfileSearchProps) {
  const generatedId = useId();
  const inputId = id ?? `profile-search-${generatedId}`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfileSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(label);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!isSupabaseConfigured) {
      setResults([]);
      setLoading(false);
      setMessage("Profile search is unavailable.");
      return;
    }

    if (!canSearchProfiles(query)) {
      setResults([]);
      setLoading(false);
      setMessage(label);
      return;
    }

    setLoading(true);
    const timeout = window.setTimeout(() => {
      void searchPublicProfiles(query)
        .then((nextResults) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setResults(nextResults);
          setOpen(true);
          setMessage(nextResults.length === 0 ? "No profiles found" : `${nextResults.length} profile result(s)`);
        })
        .catch((error) => {
          if (requestIdRef.current !== requestId) {
            return;
          }
          setResults([]);
          setOpen(true);
          setMessage(profileStoreErrorMessage(error, "Profile search failed."));
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        });
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [label, query]);

  return (
    <div className={["profile-search", variant === "hero" ? "profile-search-hero" : "", className].filter(Boolean).join(" ")}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={isSupabaseConfigured ? placeholder : "Profile search unavailable"}
        autoComplete="off"
        disabled={!isSupabaseConfigured}
      />
      {open && isSupabaseConfigured && canSearchProfiles(query) ? (
        <div className="profile-search-menu" role="listbox" aria-label="Profile search results">
          {loading ? <div className="profile-search-empty">Searching...</div> : null}
          {!loading && results.length === 0 ? <div className="profile-search-empty">{message}</div> : null}
          {!loading
            ? results.map((profile) => (
                <a
                  className="profile-search-result"
                  href={publicProfilePath(profile.username)}
                  key={profile.username}
                  role="option"
                >
                  <span>
                    <strong>{profile.username}</strong>
                    {profile.role === "admin" ? <em>ADMIN</em> : null}
                  </span>
                  <small>
                    {profile.completed_run_count} run{profile.completed_run_count === 1 ? "" : "s"} -{" "}
                    {profile.created_verified_count} verified
                  </small>
                </a>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
