# 0.5.6 导出设置与预检来源

日期：2026-10-06。分支 `codex/iteration-16-export-settings`，基于 `v0.5.5`。提交 `fix(export): identify preflight sources and improve settings readability`。版本与标签 `0.5.6` / `v0.5.6`。

两个不同目录的损坏 `same-photo.png` 原来得到完全相同的错误，用户无法定位原图。`preflight_identifies_each_same_name_original` 用真实文件走预检，修复前在“无法识别同名来源”的断言失败。现在批次存在同名文件时显示完整原图路径；名称唯一时保持简洁文件名，最大成品名称与统计语义不变。

导出设置原来大量说明、字段及错误文字为 9–10px。本轮主控件、示例和错误为 12px，辅助说明为 11px，质量滑块区域为 28px。长路径继续换行。输出目录可悬停查看全文，并关联可访问描述。错误记录使用各自的渲染标识。

20 条长路径错误会产生很长的滚动内容，因此固定底部增加“返回修改设置”。点击后回到设置顶部，焦点移到输出目录，可以继续用 Tab 操作格式等控件。

验收结果：

- Rust 39 项、Clippy `-D warnings` 通过；6 项性能/专项测试默认忽略。
- 前端 31 项、生产构建与入口体积检查通过。
- Chromium 与 WebKit：20 条长路径错误完整、来源可分辨、最后一条可达，底部操作保持可见；返回设置恢复滚动和焦点；修正后重新预检并导出。
- WebKit 另行复核导出表单校验与焦点、滑块撤销及弹窗保护、结果布局与失败项重试，均通过。本轮运行相关 4 项流程，前一版完整 28 项通过。
- 1100×720 浅色/暗色目视检查通过，包括长错误、隐私设置及返回按钮。axe 零违规，但标题对比度有 1 项因重叠判定而待定；核实标题唯一、实际前景/背景和画面，暗色对比度约 13.51，没有把待定项记为自动通过。
- 最终 0.5.6 AppImage 构建、升级恢复通过。真实十张同名批次在已有一份输出时显示 `source-8`、`source-9` 两个完整路径；末项错误可滚动到达，返回顶部后 Tab 到格式控件，证明焦点从输出目录继续。
- 最终原生预检后仍只有原来一份成品；十份原图 SHA-256 与导出前一致。

证据位于忽略目录：`test-output/audit/preflight-source-{red,green}.log`、`rust-0.5.6.log`、`clippy-0.5.6.log`、`export-settings-0.5.6-chromium.log`、`webkit-0.5.6.jsonl`、`export-settings-*-a11y-0.5.6.json`、`screenshots/export-settings-*-min-0.5.6.png`。原生证据为 `test-output/appimage-0.5.6.log` 与 `test-output/native-smoke/preflight-*-0.5.6.png`。

20 条界面错误使用 IPC 模拟；原生测试使用两个损坏小图和十张同名小图，不能替代大量相机原片的兼容性测试。
