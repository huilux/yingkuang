export type ThemePreference = "system" | "light" | "dark";
export const themePreferenceKey = "yingkuang-theme-v1";

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readThemePreference(): ThemePreference {
  try { return parseThemePreference(localStorage.getItem(themePreferenceKey)); }
  catch { return "system"; }
}

export function applyTheme(preference: ThemePreference, systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches) {
  const theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#171918" : "#e7e9e6");
}

export function saveThemePreference(preference: ThemePreference) {
  try { localStorage.setItem(themePreferenceKey, preference); }
  catch { /* Apply for this session even when preference storage is unavailable. */ }
  applyTheme(preference);
}
