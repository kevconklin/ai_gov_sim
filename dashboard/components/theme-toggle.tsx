"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "gsim-theme";

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    let saved: Mode = "system";
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === "light" || raw === "dark" || raw === "system") saved = raw;
    } catch {
      // storage unavailable; keep system
    }
    setMode(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let current: string | null = null;
      try {
        current = localStorage.getItem(KEY);
      } catch {
        current = null;
      }
      if (!current || current === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignore
    }
    apply(next);
  };

  return (
    <div className="flex gap-1" role="group" aria-label="Color theme">
      {(["system", "light", "dark"] as const).map((m) => (
        <button key={m} type="button" className="btn" style={mode === m ? { borderColor: "var(--accent)" } : undefined} onClick={() => choose(m)} aria-pressed={mode === m}>
          {m[0]!.toUpperCase() + m.slice(1)}
        </button>
      ))}
    </div>
  );
}
