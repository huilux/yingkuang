# 映框

本地摄影水印与相框编辑器，使用 React、TypeScript 和 Tauri/Rust 构建。支持 JPEG/PNG、EXIF 拍摄参数水印、模板管理和批量导出。照片在本机处理，原图保持不变。

## 下载与安装

在 [GitHub Releases](https://github.com/huilux/yingkuang/releases) 下载对应系统的安装包：

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | `*_windows-x64.exe` |
| Debian/Ubuntu x64 | `*_linux-x64.deb` |
| Linux x64 | `*_linux-x64.AppImage` |
| macOS Apple 芯片（实验性） | `*_macos-arm64.dmg` |
| macOS Intel（实验性） | `*_macos-x64.dmg` |

普通用户只需安装包。`SHA256SUMS.txt` 用于校验下载，`*_release-materials.zip` 保存许可、检查记录和依赖源码；GitHub 附加的 `Source code` 是项目源码。

Windows 测试包未做可信代码签名，缺少 WebView2 时需联网安装运行时。macOS 测试包仅有 ad-hoc 签名，未经 Apple 公证，首次打开可能被系统拦截。安装方法、Linux 运行库要求和测试范围见 [使用指南](docs/user-guide.md#安装)。

## 功能

- 照片或文件夹导入、拖放，以及文件名和画幅筛选。
- 纯色或模糊相框、四边参数区、圆角和阴影。
- EXIF 与自定义文字水印、多选行列对齐、等间距和分布范围调整。
- 裁切、旋转、水平校正、撤销重做和会话恢复。
- 独立成品预览，F11 进入纯图片全屏预览。
- 六款离线字体、本地 TTF/OTF 导入和界面主题切换。
- 官方模板在线更新、离线导入和个人模板备份，保留用户自己的修改。
- JPEG/PNG 批量导出，支持尺寸、质量、重名处理和 EXIF/GPS 控制。

操作说明见 [使用指南](docs/user-guide.md)，版本变化见 [变更记录](CHANGELOG.md)。官方模板可在应用内检查更新，也可从 [模板站点](https://huilux.github.io/yingkuang/) 下载离线包；启动、编辑和导出无需联网。

## 开发与贡献

先按 [贡献指南](CONTRIBUTING.md) 安装 Node.js、Rust 和系统依赖，然后运行：

```sh
npm ci
npm run tauri dev
```

`npm run dev` 仅启动浏览器界面；原生文件处理和正式导出需要 Tauri。

- [贡献指南](CONTRIBUTING.md)：环境、检查命令、提交范围和问题反馈。
- [架构说明](docs/architecture.md)：模块职责、状态与渲染约定。
- [构建与发布](docs/release.md)：安装包构建、官方模板发布和分发材料。
- [安全反馈](SECURITY.md)：私密报告安全问题。

## 许可证与素材

原创代码和文档采用 [MIT](LICENSE)，Copyright (c) 2026 Ming。演示照片和项目图标的来源、字体及依赖的独立许可证见 [素材与第三方许可](THIRD_PARTY_NOTICES.md)。
