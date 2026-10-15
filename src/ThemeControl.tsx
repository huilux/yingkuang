import { useEffect, useState } from "react";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { SelectControl } from "./SelectControl";
import { applyTheme, parseThemePreference, readThemePreference, saveThemePreference, themePreferenceKey } from "./theme";

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
  return <span className="theme-control" title="界面主题">
    <Icon aria-hidden="true" />
    <SelectControl aria-label="界面主题" value={preference} onChange={event => {
      const next = parseThemePreference(event.currentTarget.value);
      saveThemePreference(next);
      setPreference(next);
    }}>
      <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
    </SelectControl>
  </span>;
}
