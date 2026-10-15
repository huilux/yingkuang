import React from "react";
import ReactDOM from "react-dom/client";
import { applyTheme, readThemePreference } from "./theme";

// Resolve the stored preference before loading and painting the application.
applyTheme(readThemePreference());

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

void import("./App").then(({ default: App }) => {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}).catch((cause: unknown) => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const catalogError = detail.includes("内置模板") || detail.includes("builtin-templates");
  root.render(<main role="alert" style={{ minHeight: "100vh", display: "grid", placeContent: "center", gap: 16, padding: 32, background: "#171918", color: "#f4f4f1", fontFamily: "sans-serif" }}>
    <h1 style={{ margin: 0, fontSize: 24 }}>{catalogError ? "内置模板文件无法加载" : "应用启动失败"}</h1>
    <p style={{ maxWidth: 680, margin: 0, lineHeight: 1.7 }}>{detail}</p>
    <p style={{ maxWidth: 680, margin: 0, color: "#afb9b1", lineHeight: 1.7 }}>请检查项目文件 src/data/builtin-templates.json，修正后重新构建应用。</p>
  </main>);
});
