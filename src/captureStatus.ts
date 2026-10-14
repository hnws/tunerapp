// Microphone status pill, shared by the Tuner panel and the Practice tab.
import type { CSSProperties } from "react";
import type { LiveCaptureState } from "../audio/captureModule";

export function statusLabel(status: LiveCaptureState["status"]): string {
  switch (status) {
    case "requesting":
      return "Requesting microphone";
    case "calibrating":
      return "Calibrating";
    case "listening":
      return "Listening";
    case "suspended":
      return "Paused";
    case "error":
      return "Error";
    case "idle":
    default:
      return "Idle";
  }
}

export const statusPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "999px",
  padding: "6px 10px",
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid rgba(255, 255, 255, 0.12)"
};

export const statusStyles: Record<LiveCaptureState["status"], CSSProperties> = {
  idle: {
    background: "rgba(255, 255, 255, 0.04)",
    color: "rgba(245, 247, 251, 0.8)"
  },
  requesting: {
    background: "rgba(111, 191, 255, 0.14)",
    color: "#bfe7ff"
  },
  calibrating: {
    background: "rgba(255, 193, 109, 0.16)",
    color: "#ffe0aa"
  },
  listening: {
    background: "rgba(107, 232, 180, 0.16)",
    color: "#bff4df"
  },
  suspended: {
    background: "rgba(255, 208, 109, 0.16)",
    color: "#ffe3a2"
  },
  error: {
    background: "rgba(255, 84, 84, 0.16)",
    color: "#ffb3b3"
  }
};
