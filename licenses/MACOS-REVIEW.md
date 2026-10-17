# macOS 分发材料核对

核对日期：2026-10-17。适用的准确依赖版本及许可正文摘要见 [macos-review.json](macos-review.json)。依赖升级、正文变化或新增审查事项都必须重新核对，不能沿用本记录。

objc2、block2、objc2-encode 等依赖按各自锁定版本的上游许可声明分发。保留原始 `LICENSE.md`、补充 MIT 正文、Cargo 中的作者信息，以及校验过的原始 crate 源码；不把补充正文的占位符当作上游版权声明，也不编造署名。生成的框架绑定有些未声明 Cargo authors，本记录准确保留空列表，并随材料提供其未经修改的源码和原始声明；不推定其他包的作者就是它的作者。原始说明中关于 Apple SDK 衍生声明的备注和未完成的重新许可讨论一并保留，本记录不替上游裁定版权归属。

[Xcode and Apple SDKs Agreement](https://www.apple.com/legal/sla/docs/xcode.pdf) 第 2.2 节区分 macOS SDK 与其他 Apple SDK，第 2.4 节允许在遵守协议的前提下分发 macOS 应用及库。本项目在 GitHub 托管的 Apple 硬件上构建 macOS 应用，使用系统框架；安装包不分发 Xcode、SDK、Apple 系统框架或 `.tbd` 文件。打包检查通过 `otool` 核对动态库只来自 `/System/Library/` 或 `/usr/lib/`。

这是针对当前产物的技术与材料核对，不是对上游备注的法律结论。上游声明见各准确版本保存的原文和 [objc2 许可讨论](https://github.com/madsmtm/objc2/issues/23)。自动化流程只接受本记录明确列出的依赖及正文摘要，任何新增、未知或正文不符的事项仍阻止分发。

当前 macOS 测试包使用 ad-hoc 签名，未经 Apple 公证。架构、签名、挂载、许可文件、系统动态库及原生窗口启动由 CI 验证；Gatekeeper、首次安装、照片编辑与导出仍需实机验收。这些限制不得标为已经通过。
