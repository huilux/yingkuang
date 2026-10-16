# 开发验证

所有命令从仓库根目录运行，环境见 [贡献指南](../CONTRIBUTING.md)。常规测试使用生成图片与仓库内字体，无需私人原片。

## 常规检查

```sh
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

Node 测试覆盖模板、会话、几何、导出流程、字体与演示图隐私；前端构建还检查版本、类型和启动体积。Rust 测试覆盖真实编码、EXIF/ICC、字体与文件写入。专项入口包括 `npm run test:crop`、`test:camera`、`test:selection`、`test:templates`。

官方模板发布验证入口为 `npm run templates:check`。模板回归包括 `template-layout-regression.js`（旋转和换图等间距）、`template-layout-persistence-regression.js`（跨照片、两种操作顺序、旋转文字、仅居中、撤销和再次保存）、`distribution-range-regression.js`（比例输入、滑杆撤销、跨照片、两元素范围和整组拖动）、`distribution-direction-regression.js`（行只调宽、列只调高、混排禁用、旧范围兼容和解除时位置保留）及 `template-update-regression.js`（启动不联网、失败保留、个人冲突、重启、离线导入与回退）；桌面 CI 在最小窗口的 WebKit 中运行这五项。公开站点部署后可单独验证真实 HTTPS、签名和本机缓存：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked \
  templates::tests::official_feed_network_smoke -- --ignored --nocapture
```

发布归档使用 Python 3.11+ 验证：

```sh
python3 -m unittest discover -s scripts -p 'test_beta_release.py'
python3 -m unittest discover -s scripts -p 'test_appimage_audit.py'
```

不要把所有 `#[ignore]` 测试加入常规 CI：部分真实照片压力测试需要本机素材。

## Linux 界面与 CSP

需要系统 Python、PyGObject、GTK 3、WebKitGTK 4.1 和 Xvfb。先启动开发服务器：

```sh
npm run dev -- --host 127.0.0.1 --port 1422 --strictPort
```

另一个终端执行全部界面回归，或在 URL 后指定相关脚本名：

```sh
xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422
```

界面回归覆盖标题栏事件、主题、画布与裁切加载等交互。使用 IPC 模拟的测试只验证界面请求和状态；Windows 发布流程另外在真实安装后的 WebView2 中验证主题交互，调试端口仅由测试进程临时开启。

构建前端后检查生产 CSP：

```sh
xvfb-run -a python3 scripts/check-csp.py
```

该检查验证本地图像、字体与编辑器资源可加载，并拒绝内联脚本、动态代码和外部连接。它不替代原生 IPC 或其他平台 WebView 验收。

## 渲染与性能

保持开发服务器运行，执行 `python3 scripts/render-parity.py http://127.0.0.1:1422`，对比浏览器预览与 Rust 输出。修改几何、字体、模糊或阴影时，检查中文、字重、文字边界、透明 PNG 和不同成品尺寸。

原生导出基准工具为 `scripts/benchmark-export.py`，用 `--help` 查看所需的 release 测试程序与输入参数。画布性能脚本为 `scripts/zoom-performance.js`，可通过上述 WebKit 回归入口单独运行。测量时记录系统、CPU、构建模式、输入像素、模板、格式和重复次数，分别报告预览与导出耗时。

生成输出放在 `test-output/`；含本机路径、真实照片或任务记录的材料不提交。演示图必须保留合法来源、限制尺寸与体积，并移除附加元数据，`npm test` 会检查。
