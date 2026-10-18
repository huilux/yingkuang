# 贡献指南

欢迎报告问题和提交改进。原创代码与文档采用 MIT；贡献者应有权按该许可证提供改动，新增第三方素材需保留来源和原始许可证。

## 开发环境

使用 [.node-version](.node-version) 指定的 Node.js 和 [rust-toolchain.toml](rust-toolchain.toml) 指定的 Rust。通过 rustup 运行 Cargo 时会自动选择项目工具链。

| 系统 | 前置依赖 |
| --- | --- |
| Linux | C/C++ 编译工具、pkg-config、OpenSSL 开发包、WebKitGTK 4.1、librsvg、AppIndicator、patchelf |
| Windows | Visual Studio Build Tools 的「使用 C++ 的桌面开发」、Windows SDK、WebView2、MSVC Rust 工具链 |
| macOS | Xcode Command Line Tools（`xcode-select --install`） |

Ubuntu 22.04 的依赖安装方式见 [桌面 CI](.github/workflows/desktop.yml)，其他系统参考 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。

从仓库根目录启动：

```sh
npm ci
npm run tauri dev
```

`npm run dev` 仅用于浏览器界面开发，不能代替原生文件处理和正式导出。字体随项目提供，不依赖系统字体；可选 `vips` CLI 只用于加速 JPEG 编辑预览，缺失时使用 Rust 路径。

## 验证

修改应用代码后运行：

```sh
npm test
npm run build
```

涉及 Rust 时另运行：

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

Node 测试覆盖模板、会话、几何、导出流程和资源校验；构建检查版本、类型及资源体积。Rust 测试覆盖图像编码、EXIF/ICC、字体和文件写入。专项 Node 测试入口见 [package.json](package.json)。

常规测试使用生成图片和仓库字体，不需要私人原片。不要批量启用所有 `#[ignore]` 测试：其中部分压力测试依赖本机照片。纯文档改动检查链接、路径与命令即可。

### Linux 界面与渲染

需要系统 Python 的 PyGObject、GTK 3、WebKitGTK 4.1 和 Xvfb。启动服务器：

```sh
npm run dev -- --host 127.0.0.1 --port 1422 --strictPort
```

在另一终端运行；URL 后可追加 `scripts/` 中的回归脚本名，只执行相关场景：

```sh
GDK_BACKEND=x11 xvfb-run -a /usr/bin/python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422
GDK_BACKEND=x11 /usr/bin/python3 scripts/render-parity.py http://127.0.0.1:1422
```

第一条检查实际界面交互，第二条将模板卡片、画布与真实 Rust 输出对照。修改几何、字体、模糊或阴影时应运行相关回归。测试期间保持服务器运行且源码不变；`GDK_BACKEND=x11` 避免测试窗口误用桌面的 Wayland 会话。

构建前端后检查生产 CSP：

```sh
GDK_BACKEND=x11 xvfb-run -a /usr/bin/python3 scripts/check-csp.py
```

模拟 IPC 的界面测试不替代真实文件处理，也不代表 Windows/macOS 实机验收。CI 的平台与步骤见 [工作流](.github/workflows/desktop.yml)。

### 模板与发布工具

模板更新执行 `npm run templates:check`。修改发布工具时，使用 Python 3.11 或更高版本运行：

```sh
python3 -m unittest discover -s scripts -p 'test_beta_release.py'
python3 -m unittest discover -s scripts -p 'test_appimage*.py'
```

需要测试真实模板站点时，可单独运行联网检查；它不属于离线单元测试：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked \
  templates::tests::official_feed_network_smoke -- --ignored --nocapture
```

画布性能可通过界面回归入口执行 `zoom-performance.js`；原生导出基准参数见 `python3 scripts/benchmark-export.py --help`。记录系统、CPU、构建模式、照片尺寸、模板和重复次数，区分预览与导出耗时。

## 提交与兼容性

- 提交聚焦一个问题，说明复现步骤、改动原因和验证结果。安全问题按 [SECURITY.md](SECURITY.md) 私密报告。
- 改动渲染时同时核对模板预览、主画布和 Rust 导出；改动模板或会话结构时验证旧数据迁移、个人修改与损坏恢复。
- 开发脚本、测试、锁文件和必要文档随代码提交。不要提交私人照片、完整个人路径、账号、证书、签名私钥、任务笔记或一次性调试材料。
- 生成输出放在已忽略的 `test-output/`，本机资料可放在已忽略的 `.local-dev/`。不要提交 `node_modules/`、`dist/` 或 `target/`。
- 版本变更使用 `npm run version:set -- <版本>`；打包和模板发布见 [构建与发布](docs/release.md)。

## 图片与图标

演示图需有公开分发授权，移除 EXIF/GPS 等附加元数据并控制尺寸和体积；资源回归会检查。字体文件、来源清单和各自的 OFL 正文应一并保留，见 [素材与第三方许可](THIRD_PARTY_NOTICES.md)。

更新项目图标时，从 [源图](assets/branding/app-icon.png) 生成桌面派生文件：

```sh
npm run tauri icon -- assets/branding/app-icon.png --output test-output/generated-icons
```

将桌面 PNG、ICO、ICNS 同步到 `src-tauri/icons/`，不提交 Android/iOS 派生目录。
