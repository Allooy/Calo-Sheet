import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "cx-theme";

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolve(t: Theme): "light" | "dark" {
  return t === "system" ? (systemDark() ? "dark" : "light") : t;
}

/** Toggling a class on <html> is what the `dark:` variant keys off. */
export function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle("dark", resolve(t) === "dark");
  el.style.colorScheme = resolve(t); // native form controls & scrollbars follow
}

export function readTheme(): Theme {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  // Follow the OS while the user is on "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return { theme, setTheme: setThemeState, resolved: resolve(theme) };
}
