import { type ReactNode, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { appPath } from "./routes";
import { isSupabaseConfigured, requireSupabase, SUPABASE_ENV_KEYS } from "./supabaseClient";

export type ProfileRole = "user" | "admin";

export interface UserProfile {
  id: string;
  username: string;
  role: ProfileRole;
  created_at: string;
  updated_at: string;
}

export interface AppAccount {
  user: User;
  profile: UserProfile;
}

type AccountStatus = "unconfigured" | "loading" | "unauthenticated" | "needs_profile" | "ready" | "error";

interface AccountState {
  status: AccountStatus;
  user: User | null;
  profile: UserProfile | null;
  message: string | null;
}

export function useAccount() {
  const [state, setState] = useState<AccountState>(() => ({
    status: isSupabaseConfigured ? "loading" : "unconfigured",
    user: null,
    profile: null,
    message: null
  }));

  async function refresh() {
    if (!isSupabaseConfigured) {
      setState({ status: "unconfigured", user: null, profile: null, message: null });
      return;
    }

    try {
      const client = requireSupabase();
      const { data, error } = await client.auth.getSession();
      if (error) {
        throw error;
      }
      await syncUser(data.session?.user ?? null);
    } catch (error) {
      setState({
        status: "error",
        user: null,
        profile: null,
        message: error instanceof Error ? error.message : "Could not load account."
      });
    }
  }

  async function syncUser(user: User | null) {
    if (!user) {
      setState({ status: "unauthenticated", user: null, profile: null, message: null });
      return;
    }

    const profile = await fetchUserProfile(user.id);
    if (!profile) {
      setState({ status: "needs_profile", user, profile: null, message: null });
      return;
    }

    setState({ status: "ready", user, profile, message: null });
  }

  async function signOut() {
    const client = requireSupabase();
    await client.auth.signOut();
    setState({ status: "unauthenticated", user: null, profile: null, message: null });
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    void refresh();
    const client = requireSupabase();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void syncUser(session?.user ?? null);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  return { ...state, refresh, signOut };
}

export function AuthGate({
  children,
  title = "Sign in to GRIT3"
}: {
  children: (account: AppAccount, controls: { refresh: () => Promise<void>; signOut: () => Promise<void> }) => ReactNode;
  title?: string;
}) {
  const account = useAccount();

  if (account.status === "unconfigured") {
    return <SupabaseSetupPanel />;
  }

  if (account.status === "loading") {
    return <AuthShell title={title} body={<div className="empty-state">Loading account...</div>} />;
  }

  if (account.status === "error") {
    return (
      <AuthShell
        title={title}
        body={
          <div className="empty-state">
            {account.message ?? "Account could not be loaded."}
            <div className="auth-actions">
              <button className="button secondary" type="button" onClick={() => void account.refresh()}>
                Try Again
              </button>
            </div>
          </div>
        }
      />
    );
  }

  if (account.status === "unauthenticated") {
    return <AuthShell title={title} body={<AuthPanel onAccountChanged={account.refresh} />} />;
  }

  if (account.status === "needs_profile" && account.user) {
    return (
      <AuthShell
        title="Choose a username"
        body={<ProfileSetupPanel user={account.user} onProfileCreated={account.refresh} onSignOut={account.signOut} />}
      />
    );
  }

  if (account.status === "ready" && account.user && account.profile) {
    return <>{children({ user: account.user, profile: account.profile }, { refresh: account.refresh, signOut: account.signOut })}</>;
  }

  return <AuthShell title={title} body={<div className="empty-state">Account state could not be resolved.</div>} />;
}

export function AccountControls({ account, onSignOut }: { account: AppAccount; onSignOut: () => Promise<void> }) {
  return (
    <>
      <a className="button secondary" href={appPath("/profile.html")}>
        Profile
      </a>
      {account.profile.role === "admin" ? (
        <a className="button secondary" href={appPath("/admin.html")}>
          Admin
        </a>
      ) : null}
      <span className="account-pill">{account.profile.username}</span>
      <button className="button secondary" type="button" onClick={() => void onSignOut()}>
        Sign Out
      </button>
    </>
  );
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const client = requireSupabase();
  const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    throw error;
  }
  return data as UserProfile | null;
}

export async function createUserProfile(userId: string, username: string): Promise<UserProfile> {
  const normalized = normalizeUsername(username);
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .insert({
      id: userId,
      username: normalized,
      role: "user",
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }
  return data as UserProfile;
}

export function normalizeUsername(username: string): string {
  const normalized = username.trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(normalized)) {
    throw new Error("Username must be 3-32 characters and use only letters, numbers, or underscores.");
  }
  return normalized;
}

function SupabaseSetupPanel() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Account setup</p>
          <h1>Supabase is required</h1>
        </div>
        <div className="topbar-actions">
          <a className="button secondary" href={appPath("/")}>
            Home
          </a>
        </div>
      </header>
      <section className="auth-page">
        <div className="panel auth-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Configuration</p>
              <h2>Set Supabase environment variables</h2>
            </div>
          </div>
          <div className="auth-copy">
            This feature needs a Supabase project. Add {SUPABASE_ENV_KEYS[0]} and {SUPABASE_ENV_KEYS[1]} to the Vite
            environment, then run the schema in <code>supabase/schema.sql</code>.
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthShell({ title, body }: { title: string; body: ReactNode }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Account</p>
          <h1>{title}</h1>
        </div>
        <div className="topbar-actions">
          <a className="button secondary" href={appPath("/")}>
            Home
          </a>
          <a className="button secondary" href={appPath("/creator.html")}>
            Creator
          </a>
          <a className="button secondary" href={appPath("/human.html")}>
            Human Benchmark
          </a>
        </div>
      </header>
      <section className="auth-page">{body}</section>
    </main>
  );
}

function AuthPanel({ onAccountChanged }: { onAccountChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("Use your email and password to continue.");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Working...");

    try {
      const client = requireSupabase();
      if (mode === "signup") {
        const normalizedUsername = normalizeUsername(username);
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { username: normalizedUsername }
          }
        });
        if (error) {
          throw error;
        }
        if (data.user && data.session) {
          await createUserProfile(data.user.id, normalizedUsername);
          await onAccountChanged();
          return;
        }
        setMessage("Account created. Check your email if confirmation is enabled, then sign in.");
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) {
          throw error;
        }
        await onAccountChanged();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel auth-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{mode === "login" ? "Login" : "Sign up"}</p>
          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
        </div>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            minLength={6}
            required
          />
        </label>
        {mode === "signup" ? (
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
        ) : null}
        <div className="auth-actions">
          <button className="button primary" type="submit" disabled={busy}>
            {mode === "login" ? "Sign In" : "Create Account"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage(mode === "login" ? "Choose a username for your profile." : "Use your email and password to continue.");
            }}
          >
            {mode === "login" ? "Create Account" : "I Have An Account"}
          </button>
        </div>
      </form>
      <div className="auth-status" role="status">
        {message}
      </div>
    </div>
  );
}

function ProfileSetupPanel({
  user,
  onProfileCreated,
  onSignOut
}: {
  user: User;
  onProfileCreated: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const suggestedUsername = typeof user.user_metadata?.username === "string" ? user.user_metadata.username : "";
  const [username, setUsername] = useState(suggestedUsername);
  const [message, setMessage] = useState("Your benchmark progress and created questions will use this username.");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Saving profile...");
    try {
      await createUserProfile(user.id, username);
      await onProfileCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel auth-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h2>Choose username</h2>
        </div>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <div className="auth-actions">
          <button className="button primary" type="submit" disabled={busy}>
            Save Profile
          </button>
          <button className="button secondary" type="button" onClick={() => void onSignOut()}>
            Sign Out
          </button>
        </div>
      </form>
      <div className="auth-status" role="status">
        {message}
      </div>
    </div>
  );
}
