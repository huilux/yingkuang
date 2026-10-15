import { useEffect, useState } from "react";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { applyTheme, parseThemePreference, readThemePreference, saveThemePreference, themePreferenceKey } from "./theme";

const themes = { system: { label: "跟随系统", next: "light" }, light: { label: "浅色", next: "dark" }, dark: { label: "深色", next: "system" } } as const;

export function ThemeControl() {
  const [preference, setPreference] = useState(readThemePreference);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(preference, media.matches);
    const sync = (event: StorageEvent) => {
      if (event.key === themePreferenceKey || event.key === null) setPreference(parseThemePreference(event.newValue));
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener("storage", sync);
    return () => { media.removeEventListener("change", update); window.removeEventListener("storage", sync); };
  }, [preference]);
  const Icon = preference === "system" ? Desktop : preference === "light" ? Sun : Moon;
  const next = themes[preference].next;
  const label = `界面主题：${themes[preference].label}；点击切换为${themes[next].label}`;
  return <button className="icon-button theme-control" type="button" aria-label={label} title={label} onClick={() => {
    saveThemePreference(next);
    setPreference(next);
  }}>
    <Icon aria-hidden="true" />
  </button>;
}
