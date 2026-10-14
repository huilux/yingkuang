# 参与开发

映框使用 React/TypeScript + Tauri 2/Rust。原创代码和文档采用 MIT，贡献代码应允许按该许可证分发；第三方素材必须附来源和原始许可证。

## 环境与运行

使用 `.node-version` 指定的 Node 24.18.1 和 `rust-toolchain.toml` 指定的 Rust 1.92.0。通过 rustup 运行 Cargo 时会选择项目工具链。

- Linux：安装 WebKitGTK 4.1 开发包、C/C++ 编译工具、OpenSSL 开发包、librsvg、AppIndicator、patchelf。Ubuntu 22.04 的安装命令见 CI。
- Windows：安装 Visual Studio Build Tools 的“使用 C++ 的桌面开发”、Windows SDK、WebView2，使用 MSVC Rust 工具链。
- macOS：安装 Xcode Command Line Tools (`xcode-select --install`)。

详见 [Tauri 官方前置依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run tauri dev
```

`npm run dev` 仅启动浏览器界面；原生文件与导出功能需要 Tauri。字体均随项目提供，无需安装 fontconfig 或 vips；vips 仅为可选预览加速，缺失时使用 Rust 路径。

## 检查

```sh
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

默认测试使用生成样本和仓库内字体，不需要 `assets/origin/`。带 `#[ignore]` 的真实照片性能测试需要自备本地素材，勿在常规 CI 中使用 `--include-ignored`。Linux WebKitGTK 流程测试参见 [开发验证](docs/development.md)，不代表 Windows/macOS 的原生验收。

提交应聚焦一个问题，注明复现方式、验证结果及模板/会话兼容性。增加导出行为时同时检查预览和 Rust 导出。不要提交原片、生成目录、证书或本机配置。版本变更使用 `npm run version:set -- <版本>`。

安装包构建与发布前清单见 [跨平台发布](docs/release.md)。

## 文件提交范围

开发脚本、测试、依赖锁文件和工程文档需要提交；编译产物、私人素材、任务流水与一次性原型不提交。验证方法与资料要求见 [开发验证](docs/development.md)。本地资料放在已忽略的 `.local-dev/`。
