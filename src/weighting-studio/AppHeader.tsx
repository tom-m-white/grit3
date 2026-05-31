import type { ReactNode } from "react";
import { ProfileSearch } from "./ProfileSearch";
import { appPath } from "./routes";

export interface HeaderAction {
  disabled?: boolean;
  href?: string;
  label: string;
  onClick?: () => void;
}

interface HeaderAccount {
  profile: {
    role: string;
    username: string;
  };
}

interface AppHeaderProps {
  account?: HeaderAccount;
  actions?: HeaderAction[];
  actionsLabel?: string;
  searchId?: string;
  title: ReactNode;
  onSignOut?: () => Promise<void>;
}

export const APP_TOOL_LINKS = [
  { label: "Evaluator", path: "/evaluator.html" },
  { label: "Creator", path: "/creator.html" },
  { label: "Weighting Studio", path: "/studio.html" },
  { label: "Results", path: "/results.html" },
  { label: "Human Benchmark", path: "/human.html" }
] as const;

export function AppHeader({ account, actions = [], actionsLabel = "Actions", searchId, title, onSignOut }: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <a className="topbar-home eyebrow" href={appPath("/")}>
          GRIT3
        </a>
        <h1>{title}</h1>
      </div>
      <div className="topbar-actions">
        <ProfileSearch id={searchId} />
        <HeaderMenu label="Tools" items={APP_TOOL_LINKS.map((item) => ({ label: item.label, href: appPath(item.path) }))} />
        {actions.length > 0 ? <HeaderMenu label={actionsLabel} items={actions} /> : null}
        {account ? <AccountMenu account={account} onSignOut={onSignOut} /> : null}
      </div>
    </header>
  );
}

function HeaderMenu({ label, items }: { label: string; items: HeaderAction[] }) {
  return (
    <details className="header-menu">
      <summary className="button secondary">{label}</summary>
      <div className="header-menu-list">
        {items.map((item) =>
          item.href ? (
            <a className="header-menu-item" href={item.href} key={item.label}>
              {item.label}
            </a>
          ) : (
            <button
              className="header-menu-item"
              disabled={item.disabled}
              key={item.label}
              type="button"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </details>
  );
}

function AccountMenu({ account, onSignOut }: { account: HeaderAccount; onSignOut?: () => Promise<void> }) {
  return (
    <details className="header-menu account-menu">
      <summary className="button secondary account-summary">{account.profile.username}</summary>
      <div className="header-menu-list">
        <a className="header-menu-item" href={appPath("/profile.html")}>
          My Profile
        </a>
        {account.profile.role === "admin" ? (
          <a className="header-menu-item" href={appPath("/admin.html")}>
            Admin
          </a>
        ) : null}
        {onSignOut ? (
          <button className="header-menu-item" type="button" onClick={() => void onSignOut()}>
            Sign Out
          </button>
        ) : null}
      </div>
    </details>
  );
}
