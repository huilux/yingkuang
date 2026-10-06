# 0.5.5 编辑参数的键盘与可读性

日期：2026-10-06。分支 `codex/iteration-15-inspector-controls`，基于 `v0.5.4`。提交 `fix(editor): support focused slider undo and readable controls`。版本与标签 `0.5.5` / `v0.5.5`。

## 问题与修复

真实 Chromium 按键复现：聚焦“模糊程度”，ArrowRight 把 30 改为 31，Ctrl+Z 后仍为 31；撤销按钮已经可用。原应用把所有输入控件都排除在编辑快捷键外，range 控件又没有文本输入的撤销能力，因此用户必须移开焦点才能使用快捷键。

编辑器现在允许聚焦 range 控件时使用 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 和 Ctrl+Y。执行前提交尚未结束的调整事务；方向键仍交给滑块。文本输入、数字输入、下拉框和弹窗的原有行为保留。

右侧参数面板原来大量标签和数值为 9–10px，滑块输入区域只有 18px 高。主参数标签、数值、选择与输入文字提升到 12px；图层辅助说明、坐标读数等提升到 11px；解释段落为 12px。滑块区域提高到 28px，方向分段按钮和对齐按钮分别至少 32px、34px。面板继续垂直滚动，保持最小窗口的布局与画布空间。

## 验收

- `scripts/slider-undo-regression.js` 在修复前明确失败，错误为“模糊程度: focused Ctrl+Z did not undo the complete adjustment”。修复后 Chromium 和 WebKit 通过。
- 相框模糊、图层字号、透明度：一次连续三步调整整体撤销，Ctrl/Cmd 与重做快捷键、工具栏按钮均通过。
- 数字文本输入的 Ctrl+Z 未被编辑器截获；导出弹窗中的质量滑块快捷键不会重做背景画布。
- 真实 Chromium 按键：ArrowRight 后 Ctrl+Z 恢复 30，焦点仍在“模糊程度”。
- WebKit 全部 28 项用户流程通过；前端 31 项、生产构建与入口预算通过。
- 1100×720 浅色/暗色相框和水印面板目视检查通过；坐标输入滚动后可达，水印面板 `scrollWidth` 与 `clientWidth` 同为 297px。检查的主标签为 12px，滑块区域为 28px。
- 相框、水印面板 axe 检查均零违规、零待定项。自动检查不代替真实用户阅读与操作体验。
- 0.5.5 AppImage 构建成功，隔离实例恢复上一版两张照片与编辑。1100×720 的真实窗口中，ArrowRight 将模糊从 30 调到 31，Ctrl+Z 恢复 30，焦点保留；稳定后的截图确认结果。

安装包也覆盖 0.5.4 的真实批次链路：文件夹递归导入十张不同目录的同名小图，预检拒绝编号过长批次，空目录没有产生输出；改为跳过后成功 1 张、跳过 9 张、失败 0 张。唯一 PNG 为 9×10，完整解码通过，十张原图 SHA-256 未改变。无 EXIF 的测试 PNG 产生“未能读取元数据”提示，成品成功状态与警告分开显示。

证据位于忽略目录 `test-output/audit/`：`slider-undo-{red,green}.log`、`webkit-0.5.5.jsonl`、`build-0.5.5.log`、`inspector-*-a11y-0.5.5.json`、`screenshots/inspector-*-min-0.5.5.png`。

原生证据：`test-output/appimage-0.5.5.log`，以及 `test-output/native-smoke/upgrade-0.5.5.png`、`slider-changed-0.5.5.png`、`slider-undo-settled-0.5.5.png`、`batch-preflight-blocked-0.5.5.png`、`batch-skip-result-0.5.5.png`。
