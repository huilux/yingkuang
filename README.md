# 映框

本地摄影水印与相框编辑器，使用 React、Tauri 和 Rust 构建。支持 JPEG/PNG、EXIF 拍摄参数水印、可编辑相框、模板管理与批量导出。原图保持不变。

## 功能

- 导入照片或文件夹，支持拖放、文件名和画幅筛选。
- 纯色与模糊相框、四边参数区、圆角和照片阴影。
- 独立文字水印、拍摄参数覆盖、多选对齐和撤销重做。
- 裁切、90° 旋转与 ±45° 水平校正，每张照片独立保存。
- 12 款离线字体，支持导入 TTF/OTF。
- 图标按钮循环切换跟随系统、浅色和深色主题，记住上次选择。
- 模板更新、另存、JSON 备份，以及缺失原图重新定位。
- JPEG/PNG 批量导出、尺寸与质量、重名处理、取消重试、EXIF/GPS 控制和 sRGB 色彩转换。

完整操作见 [使用指南](docs/user-guide.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。

## 平台与安装

已发布 [0.5.8-beta.5 预发布测试版](https://github.com/huilux/yingkuang/releases/tag/v0.5.8-beta.5)，修复旧 DEB 包名不合法、无法安装的问题，并包含维护者更新后的三个默认模板。两平台通过[本版测试、构建、真实安装与卸载检查](https://github.com/huilux/yingkuang/actions/runs/38727645154)，Windows 还核对实际主题切换、颜色、设置保留及系统主题响应。本轮优先 Linux 与 Windows，macOS 暂缓公开交付。

| 平台 | 本版测试包 | CI 构建范围 |
| --- | --- | --- |
| Linux x64（Debian/Ubuntu） | [下载 DEB](https://github.com/huilux/yingkuang/releases/download/v0.5.8-beta.5/yingkuang_0.5.8-beta.5_linux-x64.deb) | deb、AppImage |
| Windows x64 | [下载 EXE（NSIS）](https://github.com/huilux/yingkuang/releases/download/v0.5.8-beta.5/yingkuang_0.5.8-beta.5_windows-x64.exe) | EXE（NSIS） |
| macOS Apple Silicon / Intel | 暂未提供 | dmg |

在 [Release 页面](https://github.com/huilux/yingkuang/releases/tag/v0.5.8-beta.5) 下载对应安装包，按需使用统一的 `SHA256SUMS.txt` 校验。公开附件共四份：两个安装包、校验文件和 `release-materials.zip`；技术材料 ZIP 保留许可证、依赖清单、检查记录与 MPL 依赖源码。Windows 测试包未做可信代码签名；缺少 WebView2 的电脑首次安装需要联网获取运行时。AppImage 尚未公开提供。

普通用户只需下载 Windows 的 `.exe` 或 Debian/Ubuntu 的 `.deb`，安装包内已包含许可证。技术材料 ZIP 无需解压；GitHub 另外自动提供的两份 `Source code` 是项目源码，也不是安装包。

已有 Arch Linux 桌面使用验证及 beta.1 的 Windows 11 用户测试反馈；beta.5 的完整照片编辑与导出复测、干净用户环境及升级验收仍待完成，最低系统版本尚未确认。Linux 安装验证使用 Ubuntu 22.04 CI，构建依赖仍在机上。日常 CI 保持安装包附件上传关闭，测试包通过受控流程进入 Release。[构建与发布说明](docs/release.md)包含命令与验证范围。

## 开发启动

安装 `.node-version` 指定的 Node.js、`rust-toolchain.toml` 指定的 Rust，以及对应平台的 [系统开发依赖](CONTRIBUTING.md)。在项目根目录运行：

```sh
npm ci
npm run tauri dev
```

`npm run dev` 仅启动浏览器开发界面；原生文件处理和正式导出需要 Tauri。

## 文档与贡献

- [使用指南](docs/user-guide.md)：导入、编辑、字体、模板、导出与恢复。
- [架构](docs/architecture.md)：模块边界、渲染和状态约定。
- [开发验证](docs/development.md)：单元测试、界面回归、渲染对比与性能测量。
- [贡献指南](CONTRIBUTING.md)：环境、提交规范和文件范围。
- [安全反馈](SECURITY.md)：报告安全问题。

## 许可证

原创代码与文档采用 [MIT](LICENSE)，Copyright (c) 2026 Ming。内置字体等第三方资源保留各自许可证，见 [第三方许可说明](THIRD_PARTY_NOTICES.md)和 [字体来源](public/fonts/README.md)。照片与其他素材的授权范围以其单独声明为准。
