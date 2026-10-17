# 映框

本地摄影水印与相框编辑器，使用 React、Tauri 和 Rust 构建。支持 JPEG/PNG、EXIF 拍摄参数水印、可编辑相框、模板管理与批量导出。原图保持不变。

## 功能

- 导入照片或文件夹，支持拖放、文件名和画幅筛选。
- 纯色与模糊相框、四边参数区、圆角和照片阴影。
- 独立文字水印、拍摄参数覆盖、多选行列对齐、等间距与分布范围调整、撤销重做。
- 独立结果预览，F11 直接进入只显示图片的全屏预览，Esc 返回编辑。
- 裁切、90° 旋转与 ±45° 水平校正，每张照片独立保存。
- 6 款离线字体，支持导入 TTF/OTF。
- 图标按钮循环切换跟随系统、浅色和深色主题，记住上次选择。
- 官方模板独立在线更新与离线导入，保留个人模板、修改和默认选择；支持模板另存、JSON 备份及缺失原图重新定位。
- JPEG/PNG 批量导出、尺寸与质量、重名处理、取消重试、EXIF/GPS 控制和 sRGB 色彩转换。

完整操作见 [使用指南](docs/user-guide.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。

## 平台与安装

当前测试版为 [0.5.9-beta.3](https://github.com/huilux/yingkuang/releases/tag/v0.5.9-beta.3)。普通用户只需下载对应系统的安装包。

本版新增行列对齐、分布范围调整和全屏预览，修复中英数字混排与旋转后的横竖模板切换，并更新五款内置模板。官方模板可在「模板库」中手动检查更新，也可从[模板站点](https://huilux.github.io/yingkuang/)下载离线模板包。

线上模板 `2026.10.3` 使用新的对齐与分布范围规则，需要 `0.5.9-beta.3` 或更新版本；旧版会保留原模板并提示升级。维护者发布模板的步骤见[模板发布文档](docs/release.md#发布内置模板)。

| 系统 | 下载 |
| --- | --- |
| Windows x64 | [EXE 安装包](https://github.com/huilux/yingkuang/releases/download/v0.5.9-beta.3/yingkuang_0.5.9-beta.3_windows-x64.exe) |
| Debian/Ubuntu x64 | [DEB 安装包](https://github.com/huilux/yingkuang/releases/download/v0.5.9-beta.3/yingkuang_0.5.9-beta.3_linux-x64.deb) |
| Linux x64（AppImage） | [AppImage](https://github.com/huilux/yingkuang/releases/download/v0.5.9-beta.3/yingkuang_0.5.9-beta.3_linux-x64.AppImage) |

| macOS Apple 芯片（实验性） | [ARM64 DMG](https://github.com/huilux/yingkuang/releases/download/v0.5.9-beta.3/yingkuang_0.5.9-beta.3_macos-arm64.dmg) |
| macOS Intel（实验性） | [x64 DMG](https://github.com/huilux/yingkuang/releases/download/v0.5.9-beta.3/yingkuang_0.5.9-beta.3_macos-x64.dmg) |

校验文件和技术材料在同一发布页；许可证已随安装包保留。GitHub 的 `Source code` 是项目源码，不是安装包。

Windows 测试包暂未可信签名，缺少 WebView2 时需要联网安装运行时。DEB 与 AppImage 在 Ubuntu 22.04 CI 验证，Windows 安装与主题交互在 Windows Server 2022 CI 验证。AppImage 在 Wayland 会话优先使用原生 Wayland，保留 X11 回退；已补充原生 Wayland 的 2 倍画布分辨率、最大化还原和窗口尺寸验收。其他系统配置、完整编辑交互和升级仍需实机测试。

macOS DMG 为实验性测试包，仅做 ad-hoc 签名，尚无 Developer ID 签名和 Apple 公证；首次打开可能被 Gatekeeper 拦截。两个架构在 macOS 15 CI 检查 DMG 挂载、架构、签名、许可和原生窗口启动，照片处理和首次安装仍待实机测试，不承诺最低系统版本。安装时打开 DMG，将「映框」拖入「应用程序」；遇到拦截时可按 [Apple 官方说明](https://support.apple.com/zh-cn/102445) 在「系统设置 → 隐私与安全性」处理，不要关闭全局安全保护。

AppImage 依赖系统 OpenGL/EGL/GLES 与 Wayland 客户端运行库。精简 Debian/Ubuntu 环境缺库时安装 `libgl1 libegl1 libgles2 libwayland-client0`。

AppImage 下载后赋予执行权限并运行：

```sh
chmod +x yingkuang_0.5.9-beta.3_linux-x64.AppImage
./yingkuang_0.5.9-beta.3_linux-x64.AppImage
```

系统不能挂载 AppImage 时，可添加 `--appimage-extract-and-run` 运行；此方式已在 CI 验证。

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
