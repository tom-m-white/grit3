import { useEffect, useRef, useState } from "react";
import {
  canSearchProfiles,
  publicProfilePath,
  searchPublicProfiles,
  type PublicProfileSummary
} from "./publicProfileStore";

export function ProfileSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfileSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Search profiles");
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!canSearchProfiles(query)) {
      setResults([]);
      setLoading(false);
      setMessage("Search profiles");
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
          setMessage(error instanceof Error ? error.message : "Profile search failed.");
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        });
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [query]);

  return (
    <div className="profile-search">
      <label className="sr-only" htmlFor="global-profile-search">
        Search profiles
      </label>
      <input
        id="global-profile-search"
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
        placeholder="Search profiles"
        autoComplete="off"
      />
      {open && canSearchProfiles(query) ? (
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
