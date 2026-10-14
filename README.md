# 映框

本地摄影水印与相框编辑器，使用 React、Tauri 和 Rust 构建。支持 JPEG/PNG、EXIF 拍摄参数水印、可编辑相框、模板管理与批量导出。原图保持不变。

## 功能

- 导入照片或文件夹，支持拖放、文件名和画幅筛选。
- 纯色与模糊相框、四边参数区、圆角和照片阴影。
- 独立文字水印、拍摄参数覆盖、多选对齐和撤销重做。
- 裁切、90° 旋转与 ±45° 水平校正，每张照片独立保存。
- 12 款离线字体，支持导入 TTF/OTF。
- 模板更新、另存、JSON 备份，以及缺失原图重新定位。
- JPEG/PNG 批量导出、尺寸与质量、重名处理、取消重试、EXIF/GPS 控制和 sRGB 色彩转换。

完整操作见 [使用指南](docs/user-guide.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。

## 平台与安装

目标平台为 Linux、Windows 和 macOS。目前有 Arch Linux 的桌面使用验证；Windows/macOS 已配置构建任务，但远端 CI 和实机验收仍待完成，尚不宣称三平台稳定支持。

| 平台 | 计划提供的安装包 |
| --- | --- |
| Linux x64 | AppImage、deb |
| Windows x64 | exe（NSIS） |
| macOS Apple Silicon / Intel | dmg |

当前请使用源码构建；最低系统版本和正式下载入口将在安装包验收后公布。[构建与发布说明](docs/release.md)包含各平台命令与验证范围。

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
