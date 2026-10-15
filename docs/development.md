# 开发验证

所有命令从仓库根目录运行。工具链和系统依赖见 [贡献指南](../CONTRIBUTING.md)。常规测试使用生成图片与仓库内字体，不需要私人原片。

## 常规检查

```sh
npm test
npm run build
npm run version:check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

`npm test` 执行 Node 测试，包括几何、模板、会话、导出流程、字体完整性和演示图隐私检查。`npm run build` 执行版本一致性、类型与指定回归检查，生成前端产物并验证启动体积。Rust 测试检查真实 JPEG/PNG 编码、EXIF/ICC、字体及文件写入行为。默认忽略的专项测试不应使用 `--include-ignored` 一次性加入普通 CI。

针对改动可运行 `npm run test:crop`、`npm run test:camera`、`npm run test:selection` 或 `npm run test:templates`。测试数量随代码变化，以实际输出为准。

## Linux 界面回归

需要系统 Python、PyGObject、GTK 3、WebKitGTK 4.1 和 Xvfb。先启动独立开发服务器：

```sh
npm run dev -- --host 127.0.0.1 --port 1422 --strictPort
```

保持该终端运行，在另一个终端执行：

```sh
xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422
```

也可以只运行相关脚本：

```sh
xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422 font-library-regression.js native-font-import-regression.js
```

回归通过 DOM 事件驱动界面，并使用 Konva 公共 API 观测结果。标题栏检查包含鼠标按下事件，防止交互控件被误判为窗口拖动；裁切加载回归用可控的延迟模块验证布局、取消和焦点恢复。Windows 测试包流程还会在真实安装后的 WebView2 中通过 CDP 发送鼠标与键盘事件，检查主题循环、实际背景色、重新加载后保留选择和系统主题响应；调试端口仅由 CI 测试进程的临时环境变量开启。含原生 IPC 模拟的测试只能证明界面请求和状态处理，不等于真实文件对话框、解码或安装包验收。WebKitGTK 结果不能替代 Windows WebView2、macOS WKWebView 的原生运行检查。

## 预览与 Rust 渲染对比

保持上述服务器运行，执行：

```sh
python3 scripts/render-parity.py http://127.0.0.1:1422
```

脚本在临时目录运行 Rust 的 `preview_parity_fixtures` 专项测试生成图片，再启动 WebKitGTK 对比相框、阴影和文字。默认使用生成样本与内置字体；不要将本机真实照片扩展模式作为公共 CI 的必要输入。

修改字体或几何时，检查中文回退、不同字重、旋转后的文字边界以及透明 PNG；修改阴影或模糊时，同时检查不同强度、成品尺寸和边缘裁切。

## 性能测量

性能测量单独运行，避免与其他测试争用 CPU。记录操作系统、CPU、构建模式、输入像素、模板、格式和重复次数；浏览器预览耗时与原生导出耗时分别报告。

画布缩放测量：

```sh
xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422 zoom-performance.js
```

Linux 原生导出测量需要 Python 和 GNU `/usr/bin/time`。先编译 release 测试程序：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --release --no-run --locked
python3 scripts/benchmark-export.py --help
```

将 Cargo 输出的测试可执行文件传给 `--binary`，自行准备有权使用的 JPEG 并传给 `--input`：

```sh
python3 scripts/benchmark-export.py \
  --binary /absolute/path/to/test-executable \
  --input /absolute/path/to/photo.jpg \
  --label local-release --repeats 3 --matrix \
  --output test-output/benchmark.json
```

上面两个绝对路径是需替换的示例值。报告包含本机路径，不直接提交到公开仓库。其他被忽略的真实照片压力测试可能依赖 `assets/origin/` 中的特定素材，运行前检查对应测试源码；公共仓库不提供这些原片。

## 测试资料与提交范围

保留源码、构建脚本、锁文件、测试代码及可公开样本。`test-output/`、`assets/origin/`、`assets/image/`、本机配置和 `.local-dev/` 不提交。演示图须保持最长边不超过 1920px、文件不超过 600 KiB，且无 EXIF/XMP/IPTC 等附加元数据；`npm test` 会检查。

版本变更使用 `npm run version:set -- <版本>`，它同步 npm、Cargo 和 Tauri 的版本。新增行为应补充相关回归，并说明实际测试的平台、模拟范围和未验证部分。

## 生产 CSP 检查

运行 `npm run build` 后，执行 `xvfb-run -a python3 scripts/check-csp.py`。脚本启动临时本地服务，按 Tauri 配置发送生产 CSP，并用 WebKit 验证编辑器、本地图像和字体可加载，内联脚本、动态代码及外部连接被阻止。它不替代原生 IPC 和其他平台 WebView 的验收。开发 CSP 单独允许 Vite 的内联脚本和本机 WebSocket。
