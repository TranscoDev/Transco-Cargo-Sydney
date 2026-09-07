const STORAGE_KEY = "transco-theme";

export type Theme = "light" | "dark";

/** Inline script string, injected into <head> so the stored theme applies
 * before first paint — avoids a flash of the wrong theme on load. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private browsing, etc.) — theme just won't persist.
  }
}
