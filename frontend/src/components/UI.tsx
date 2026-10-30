import type { ReactNode } from "react";

export function Card(props: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      {(props.title || props.actions) && (
        <header className="card-head">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.subtitle && <p className="muted small">{props.subtitle}</p>}
          </div>
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      <div className="card-body">{props.children}</div>
    </section>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={props.type ?? "button"}
      className={`btn ${props.variant ?? "primary"} ${props.size === "sm" ? "sm" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Stat(props: { label: string; value: ReactNode; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <span className="stat-label">{props.label}</span>
      <span className={`stat-value ${props.tone ?? ""}`}>{props.value}</span>
      {props.hint && <span className="stat-hint">{props.hint}</span>}
    </div>
  );
}

export function Notice(props: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  return <div className={`notice ${props.kind ?? "info"}`}>{props.children}</div>;
}

export function Badge(props: { children: ReactNode; tone?: "blue" | "green" | "gray" }) {
  return <span className={`badge ${props.tone ?? "blue"}`}>{props.children}</span>;
}

export function Empty(props: { children: ReactNode }) {
  return <div className="empty">{props.children}</div>;
}
