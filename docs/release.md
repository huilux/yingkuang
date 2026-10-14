# 构建与发布

## 当前状态

项目目标为 Linux、Windows、macOS。已有 Arch Linux 历史验收；CI 已开始远端验证，结果以对应提交的 Actions 记录为准，Windows/macOS 安装包尚未完成实机验收。不能把构建成功当作已全面支持该系统。

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

`.github/workflows/desktop.yml` 对 PR、main/master 推送、v 标签和手动运行执行测试并上传安装包到 Actions artifacts；不创建 Release、不公开发布产物。macOS CI 使用 ad-hoc 签名，仅供验收，未经过 Developer ID 签名和公证。Windows CI 包未进行代码签名。

## 发布前验收

- 在没有 Node、Rust、fontconfig、vips 的干净用户环境安装、启动、卸载；验证升级后会话恢复。
- JPEG/PNG 导入、文件夹拖放、中文及空格路径、UNC（Windows）、长路径、只读目录和重名文件。
- 内置及导入字体、旧模板 monospace 映射、中文回退、裁切、旋转、阴影和带 ICC 图片。
- 原尺寸及批量导出、取消重试、保留/移除 EXIF 与 GPS、文件占用、磁盘写入失败。
- macOS Command 快捷键与窗口行为；Windows 高 DPI；Linux Wayland/X11。
- 每个平台记录系统版本、架构、安装包哈希、通过项及失败项。

## 正式分发前检查

- 当前演示照片已由维护者确认原创并按 MIT 提供，图标已替换为项目新生成素材。检查新增图片的来源、元数据和待公开内容，历史提交中的旧图标也已替换，并保留原提交树结构。不得打包本机备份、私人原片、签名证书或密钥。
- 生成 npm/Rust/原生库完整的第三方许可证清单并随包提供。
- 生产 CSP 已启用并通过 Linux WebKit 资源与拦截检查；继续核对各平台原生 IPC 与权限边界，尚未完成全面安全审计。
- macOS 窗口风格与平台快捷键提示仍待适配。
- 在 GitHub 启用私密漏洞报告、分支保护；确认仓库地址与下载入口后更新 README。
- 普通用户正式分发前配置 Windows 代码签名、macOS Developer ID 签名及公证，私钥仅存 CI Secrets。
- 三平台验收完成后，再创建正式 Release 并附校验和、变更说明及已知问题。

### 依赖许可材料

安装依赖后运行 `npm run licenses:collect`，按本机 Rust 目标生成 `test-output/licenses/<目标>/inventory.json` 和 `LICENSE-TEXTS.txt`。交叉构建时使用 `npm run licenses:collect -- <Rust 目标三元组>`。CI 在各平台执行并上传独立的许可材料 artifact。

脚本从 npm 锁文件及安装目录、Cargo 锁定解析结果提取许可声明与许可证正文，包含构建和开发依赖。补充正文从 `licenses/upstream/sources.json` 按名称、版本和 SHA-256 校验后纳入；`missingTexts` 列出仍没有许可证正文的包，`absentOptional` 列出未安装的 npm 可选依赖。安装版本不匹配或必要依赖缺失会使脚本失败。

发布者仍需逐项处理缺失正文，并核对原生静态库、系统动态库及 AppImage 等打包工具带入的库。此报告不是最终安装包的精确依赖清单，也不代表许可审计通过；确认后将所需正文与声明随正式安装包提供。生成材料不提交到源码仓库。

参考：[Tauri GitHub 流水线](https://v2.tauri.app/distribute/pipelines/github/)、[macOS 签名](https://v2.tauri.app/distribute/sign/macos/)、[Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)。


## 发布内置模板

内置模板发布源为 [`src/data/builtin-templates.json`](../src/data/builtin-templates.json)，包含模板 ID、名称、横竖图布局和默认模板 ID。安装包构建时将其打包。

可以直接修改该 JSON，也可以在应用中调整模板、点击「更新原模板」，再在模板库中「导出内置文件」，用所得文件替换发布源。导出时默认模板必须是内置模板；导出文件采用项目示例封面，不包含本机照片缩略图。

不要用「导出完整备份」替换发布源：它还包含自定义模板和本机照片封面，格式与用途不同。应用内修改只保存在本机，不会自动改写源码。升级时，未修改的内置模板采用新版，本机修改过的版本继续保留，用户可以选择重置。

修改发布模板后执行 `npm run test:templates` 和 `npm run build`，检查默认模板、横竖布局和旧用户模板兼容性。

## 版本与交付

使用 `npm run version:set -- <版本>` 同步版本，然后完成开发检查和各平台安装包验收。维护 [CHANGELOG](../CHANGELOG.md)，明确新增、修复和已知限制，不把 CI 构建成功写作实机验收通过。

通过验收后再创建正式 Release，提供对应架构的安装包、校验和、许可文件和变更说明。只推送计划公开的分支与版本标签，不上传完整本地工作目录或使用镜像推送。
