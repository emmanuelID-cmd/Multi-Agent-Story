"use client";

import React from "react";
import styles from "./model-state-indicator.module.css";

export type ModelRunningState = "idle" | "loading" | "success" | "fail" | "timeout";

export interface ModelStateIndicatorProps {
  state: ModelRunningState;
  title: string;
  message?: string;
  details?: string;
  elapsedSeconds?: number;
  maxSeconds?: number;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export default function ModelStateIndicator({
  state,
  title,
  message,
  details,
  elapsedSeconds,
  maxSeconds,
  onRetry,
  retryLabel = "Retry",
  className,
}: ModelStateIndicatorProps) {
  if (state === "idle") return null;

  const isAlert = state === "fail" || state === "timeout";
  const stateClass = styles[state] || styles.loading;

  let badgeLabel = "STILL LOADING";
  let icon: React.ReactNode = <span className={styles.spinner} aria-hidden="true" />;

  if (state === "success") {
    badgeLabel = "SUCCESS";
    icon = <span aria-hidden="true">✓</span>;
  } else if (state === "fail") {
    badgeLabel = "FAIL";
    icon = <span aria-hidden="true">✕</span>;
  } else if (state === "timeout") {
    badgeLabel = "TIME-OUT";
    icon = <span aria-hidden="true">⏱</span>;
  }

  const containerClasses = [styles.container, stateClass, className].filter(Boolean).join(" ");

  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={state === "loading" ? "polite" : undefined}
      className={containerClasses}
    >
      <div className={styles.header}>
        <span className={styles.badge}>
          {icon}
          {badgeLabel}
        </span>
        <span className={styles.title}>{title}</span>
        {typeof elapsedSeconds === "number" && (
          <span className={styles.timer}>
            {elapsedSeconds}s{typeof maxSeconds === "number" ? ` / ${maxSeconds}s` : ""}
          </span>
        )}
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {details && <div className={styles.details}>{details}</div>}

      {onRetry && (state === "fail" || state === "timeout") && (
        <div className={styles.actions}>
          <button type="button" className={styles.retryButton} onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
