# 构建与发布

## 当前状态

2026-10-15，已发布 [0.5.8-beta.3 Pre-release](https://github.com/huilux/yingkuang/releases/tag/v0.5.8-beta.3)，固定源码提交 `9cbc595`，提供 Windows x64 EXE 和 Linux x64 deb。[受控测试包流程](https://github.com/huilux/yingkuang/actions/runs/38685099011)两个作业全部通过，含标题栏鼠标事件、主题/空画布和裁切延迟加载 WebKit 回归、包内许可及原生窗口检查。Windows 另通过静默安装、真实 WebView2 中的鼠标/键盘主题循环、实际颜色、重新加载后设置保留、系统主题变化与卸载检查。12 个附件和 9 项 SHA-256 校验引用已核对，两平台均验证 16 份包内许可文件。beta.1 已收到 Windows 11 用户未发现功能问题的反馈；beta.3 完整照片编辑、导出、升级及 Linux 系统安装、卸载仍待实机验收。macOS 双架构已构建成功，但分发依赖许可核对和 Mac 安装验收尚未完成，暂不提供 dmg；AppImage 也不在本版下载范围。

项目目标为 Linux、Windows、macOS。2026-10-14，运行代码提交 `6f767c4` 已通过[四平台 CI 的测试、Clippy 与安装包构建](https://github.com/huilux/yingkuang/actions/runs/38541170291)。Linux CI 同时通过生产 CSP 的 WebKit 检查。许可证随包构建提交 `ac08fd8` 也已通过[四平台 CI](https://github.com/huilux/yingkuang/actions/runs/38561583230)，其本地 deb 已解包逐字节核对 npm/Rust 清单与正文、项目 MIT、第三方声明及 12 份字体许可。已有 Arch Linux 历史桌面验收；新生成安装包的干净环境安装和完整实机验收仍待完成，不能把构建成功当作已全面支持该系统。

| 平台 | CI 环境 | 产物 |
| --- | --- | --- |
| Linux x64 | Ubuntu 22.04 | deb、AppImage |
| Windows x64 | Windows Server 2022 | NSIS exe |
| macOS Apple Silicon | macOS 15 ARM | dmg |
| macOS Intel | macOS 15 Intel | dmg |

最低用户系统版本须在测试后公布；CI 操作系统版本不等于最低运行版本。Linux ARM、Windows ARM 暂未纳入矩阵。

## 构建

先按 [贡献指南](../CONTRIBUTING.md) 安装开发依赖，在对应系统运行：

```sh
# Linux
npm run tauri build -- --bundles deb
npm run build:appimage

# Windows
npm run tauri build -- --bundles nsis

# macOS（在对应架构的 Mac 上）
npm run tauri build -- --bundles dmg
```

产物位于 `src-tauri/target/release/bundle/`。AppImage 脚本固定打包插件版本和校验值，首次构建需要联网。Linux 应使用计划支持的最旧基础系统构建，避免 Arch 的新 glibc 提高分发要求。参见 [Tauri AppImage 文档](https://tauri.app/distribute/appimage/)。

`.github/workflows/desktop.yml` 对 PR、main/master 推送、v 标签和手动运行执行测试和安装包构建；源码公开阶段已暂停上传安装包到 Actions artifacts，仅保留许可审查材料附件，不创建 Release。macOS CI 使用 ad-hoc 签名，仅供验收，未经过 Developer ID 签名和公证。Windows CI 包未进行代码签名。

## 发布前验收

- 在没有 Node、Rust、fontconfig、vips 的干净用户环境安装、启动、卸载；验证升级后会话恢复。
- JPEG/PNG 导入、文件夹拖放、中文及空格路径、UNC（Windows）、长路径、只读目录和重名文件。
- 内置及导入字体、旧模板 monospace 映射、中文回退、裁切、旋转、阴影和带 ICC 图片。
- 原尺寸及批量导出、取消重试、保留/移除 EXIF 与 GPS、文件占用、磁盘写入失败。
- macOS Command 快捷键与窗口行为；Windows 高 DPI；Linux Wayland/X11。
- 每个平台记录系统版本、架构、安装包哈希、通过项及失败项。

## 源码公开与安装包发布

源码仓库公开与安装包发布分别验收。源码公开前检查提交历史、隐私、素材授权和仓库文档；不要求购买签名证书，也不要求先发布安装包。安装包仍须完成依赖许可核对和相应平台的实际使用验证。

测试版可以暂不做 Windows 可信签名或 macOS Developer ID 签名与公证，但必须明确标注状态及系统可能提示或拦截的限制，不建议用户关闭系统安全防护。面向普通用户长期分发时，再评估签名成本与配置。

## 安装包分发前检查

- 当前演示照片已由维护者确认原创并按 MIT 提供，图标已替换为项目新生成素材。检查新增图片的来源、元数据和待公开内容，历史提交中的旧图标也已替换，并保留原提交树结构。不得打包本机备份、私人原片、签名证书或密钥。
- 生成 npm/Rust/原生库完整的第三方许可证清单并随包提供。
- 生产 CSP 已启用并通过 Linux WebKit 资源与拦截检查；继续核对各平台原生 IPC 与权限边界，尚未完成全面安全审计。
- macOS 使用 Command 或 Ctrl 的编辑快捷键，界面提示已覆盖；原生窗口风格仍待实机评估。
- 在 GitHub 启用私密漏洞报告、分支保护；确认仓库地址与下载入口后更新 README。
- 明确各安装包的签名与公证状态；如配置 Windows 代码签名或 macOS Developer ID 签名及公证，私钥仅通过受控的签名服务或 CI Secrets 使用，不提交到仓库。
- 三平台验收完成后，再创建正式 Release 并附校验和、变更说明及已知问题。

### 依赖许可材料

安装依赖后运行 `npm run licenses:collect`，按本机 Rust 目标生成 `test-output/licenses/<目标>/inventory.json` 和 `LICENSE-TEXTS.txt`。交叉构建时使用 `npm run licenses:collect -- <Rust 目标三元组>`。CI 在各平台执行并上传独立的许可材料 artifact。使用 `npm run tauri build`、`npm run tauri bundle` 或 `npm run build:appimage` 时，包装脚本会重新收集对应 Rust 目标的材料，并通过临时配置将正文及清单放入资源目录的 `licenses/dependencies/<目标>/`。项目 MIT、第三方声明和字体 OFL 仍随包保留。macOS universal 构建会同时收集两种架构。开发运行和 Cargo 测试无需预先生成这些文件。不要绕过项目脚本直接调用 Tauri CLI 制作分发包。

脚本从 npm 锁文件及安装目录、Cargo 锁定解析结果提取许可声明与许可证正文，包含构建和开发依赖。补充正文从 `licenses/upstream/sources.json` 按名称、版本和 SHA-256 校验后纳入；`missingTexts` 列出仍没有许可证正文的包，`absentOptional` 列出未安装的 npm 可选依赖，`reviewRequired` 列出上游署名或 SDK 条款等仍需人工核对的事项。安装版本不匹配或必要依赖缺失会使脚本失败。打包入口还会拒绝 `missingTexts` 非空的材料；`reviewRequired` 会输出提醒并保存在随包清单中，仍需在正式发布前处理。

发布者仍需逐项处理缺失正文，并核对原生静态库、系统动态库及 AppImage 等打包工具带入的库。此报告不是最终安装包的精确依赖清单，也不代表许可审计通过；npm/Rust 正文与声明已接入打包流程，系统库与打包工具载荷仍需单独补齐并验收。生成材料不提交到源码仓库。

Linux CI 在 AppImage 构建完成后，会从实际产物提取文件，并在同一构建机上生成 `yingkuang-appimage-system-review` artifact：记录产物 SHA-256、文件摘要、匹配的 Debian/Ubuntu 二进制包及源码包版本、版权文件和公共许可证正文。来源匹配区分字节完全一致与 ELF build ID 一致；后者用于辅助核对经过 patchelf 修改的库，不能视为字节一致。仅文件名相同不会判定为已确认来源。

报告中的 `unresolvedFiles`、`missingCopyright` 和 `remainingReview` 必须在分发前核对。AppImage 外层运行时、生成脚本以及适用许可证要求的对应源码仍需另行处理。该 artifact 是审查材料，目前未自动嵌入 AppImage，也不代表分发许可检查已通过。只在同一 Debian/Ubuntu 构建机上运行 `python3 scripts/audit-appimage.py <已提取的 AppDir> <新的输出目录>`；不要用本地 Arch 包数据库替代 Ubuntu CI 的来源证据。

2026-10-15 已核对[运行 38662434121 的 Linux 审查附件](https://github.com/huilux/yingkuang/actions/runs/38662434121)：326 个文件条目关联到 153 个系统包，版权文件缺失为 0，153 份版权文件的 SHA-256 均与清单一致。仍有 6 个不能直接匹配 Debian 系统包的文件：`AppRun`、`AppRun.wrapped`、`apprun-hooks/linuxdeploy-plugin-gtk.sh`，以及 `loaders.cache`、`immodules.cache`、`gschemas.compiled`。固定版本 GTK 打包脚本包含生成钩子与缓存的步骤，但这些文件仍须保留在审查清单中，不能仅凭用途推断就标为许可审查完成。后续[来源核对记录](../licenses/packaging/sources.json)已确认启动包装脚本模板和 `AppRun.wrapped` 的镜像摘要，并补存两份打包组件许可；这不等于全部许可事项结项。外层 AppImage 运行时与对应源码交付也尚未结项。

参考：[Tauri GitHub 流水线](https://v2.tauri.app/distribute/pipelines/github/)、[macOS 签名](https://v2.tauri.app/distribute/sign/macos/)、[Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)。


## 发布内置模板

内置模板发布源为 [`src/data/builtin-templates.json`](../src/data/builtin-templates.json)，包含模板 ID、名称、横竖图布局和默认模板 ID。安装包构建时将其打包。

可以直接修改该 JSON，也可以在应用中调整模板、点击「更新原模板」，再在模板库中「导出内置文件」，用所得文件替换发布源。导出时默认模板必须是内置模板；导出文件采用项目示例封面，不包含本机照片缩略图。

不要用「导出完整备份」替换发布源：它还包含自定义模板和本机照片封面，格式与用途不同。应用内修改只保存在本机，不会自动改写源码。升级时，未修改的内置模板采用新版，本机修改过的版本继续保留，用户可以选择重置。

修改发布模板后执行 `npm run test:templates` 和 `npm run build`，检查默认模板、横竖布局和旧用户模板兼容性。

## 版本与交付

使用 `npm run version:set -- <版本>` 同步版本，然后完成开发检查和各平台安装包验收。维护 [CHANGELOG](../CHANGELOG.md)，明确新增、修复和已知限制，不把 CI 构建成功写作实机验收通过。

通过验收后再创建正式 Release，提供对应架构的安装包、校验和、许可文件和变更说明。只推送计划公开的分支与版本标签，不上传完整本地工作目录或使用镜像推送。

2026-10-15，提交 `d2d56b4` 的[四平台 CI](https://github.com/huilux/yingkuang/actions/runs/38662434121) 已全部通过，包括 Linux 实际 AppImage 审查及附件上传。实机验收范围不因此扩大。

## 预发布草稿流程

首批测试包范围为 Windows x64 NSIS 和 Linux x64 deb，当前版本 `0.5.8-beta.3`；AppImage 与 macOS 暂不进入此流程。日常桌面 CI 继续关闭安装包附件上传。手动工作流 `.github/workflows/beta-draft.yml` 只接受与源码版本一致、指向本次完整提交 SHA 的已有预发布草稿；上传前再次核对草稿状态，禁止向已发布版本上传。

先完成版本同步、提交和推送，确认 `v<版本>` 标签指向该完整提交；新标签可用 `git tag v<版本> <完整提交SHA>` 和 `git push origin v<版本>` 创建。使用 `gh release create v<版本> --draft --prerelease --target <完整提交SHA> --title <标题> --notes-file <说明文件>` 创建草稿，再执行 `gh workflow run beta-draft.yml --ref main -f release_tag=v<版本>`。若默认分支在其间变化，应重新核对草稿的目标提交，不能混用不同提交的安装包。已发布版本的标签和附件保持不变，后续修复使用新版本。

工作流运行测试、构建和包内许可核对；Linux 在 Xvfb 中观察原生窗口，Windows 检查真实 NSIS 静默安装、原生窗口、WebView2 主题交互与实际颜色、设置保留、系统响应和卸载。通过后向草稿上传各平台安装包、许可正文、依赖清单、检查结果及 SHA-256 校验文件。不会自动发布草稿，也不会恢复公开 Actions 安装包附件。草稿仅对有权限的维护者可见，发布后才适合向测试用户分发。

自动窗口检查不覆盖照片导入、编辑、导出、升级和所有干净用户环境；测试版说明须列出这些未验收范围以及未签名状态。发布前下载草稿附件、核对校验和与检查结果，补充实际交互验收，再将草稿发布为 Pre-release。
