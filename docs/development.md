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
GDK_BACKEND=x11 xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422
```

`GDK_BACKEND=x11` 保证 GTK 使用 Xvfb 的虚拟显示；若继承桌面的 Wayland 设置，测试窗口可能出现在真实桌面上，遮挡时绘制帧会暂停并导致超时。

界面回归覆盖标题栏事件、主题、画布与裁切加载等交互。使用 IPC 模拟的测试只验证界面请求和状态；Windows 发布流程另外在真实安装后的 WebView2 中验证主题交互，调试端口仅由测试进程临时开启。

构建前端后检查生产 CSP：

```sh
xvfb-run -a python3 scripts/check-csp.py
```

该检查验证本地图像、字体与编辑器资源可加载，并拒绝内联脚本、动态代码和外部连接。它不替代原生 IPC 或其他平台 WebView 验收。

## 渲染与性能

`preview-fullscreen.test.mjs` 验证首次成功读取时保存原窗口状态、全屏请求串行处理、持续拒绝后关闭、失败重试、系统状态延迟、外部窗口管理器切换、关闭竞态及 StrictMode 清理隔离。预览浏览器回归通过 Tauri IPC 与窗口事件模拟验证持续拒绝时「返回编辑」和 Esc 均可关闭、外部全屏后的 Esc／F11 退出和系统退出、编辑状态和多选不变，以及恢复后的编辑、撤销与导出坐标、分布和对齐规则。还覆盖从编辑界面 F11 直接进入、长按防重复、输入框／其他对话框／空批次快捷键保护、纯图片视口不留编辑边距、鼠标移动和 Tab 不显示任何控件、光标／焦点框／悬停提示隐藏、Esc／F11 直接返回编辑、预先全屏的窗口恢复及切换未完成时关闭。真实浏览器还需用可信按键验证首次打开时的 Fullscreen API 用户激活及系统 Esc 退出。新增原生窗口权限需要重新启动 Tauri 开发程序；真实系统全屏须在 Linux／Windows 本机确认。

`result-preview-regression.js` 在实际应用中检查成品预览与主画布的干净渲染像素一致，覆盖中英数字、透明文字、旋转、模糊／纯色相框和照片裁切。还验证缩放平移、焦点与 Esc、原编辑状态和导出坐标不变、高清加载失败与过期响应、空批次禁用及原生标题栏避让；纳入 Linux 最小窗口 CI。它使用生成高清图和模拟 IPC，不替代原生文件解码与 Windows 实机验收。

保持开发服务器运行，执行 `python3 scripts/render-parity.py http://127.0.0.1:1422`，对比浏览器预览与 Rust 输出。修改几何、字体、模糊或阴影时，检查中文、字重、文字边界、透明 PNG 和不同成品尺寸。

字体回归包括 `mixed-font-alignment-regression.js`（六种内置字体的中英数字笔画居中）和 `mixed-font-layout-regression.js`（长文字、真实模板卡片与主画布、正反旋转、透明度、模板数据不变，以及 WebKit 中 cmap6 字体导入和恢复）。`render-parity.py` 使用真实 Rust 图片与模板卡片、Konva 绘制结果做三方对照，并检查交替字母数字的累计宽度、长文字和小字号标点；上述检查纳入 Linux CI。每次 WebKit 回归使用临时存储，避免不同运行的字体和会话串扰。像素比较允许不同光栅引擎的小幅抗锯齿差异，不替代 Windows WebView2 实机测试。

`line-alignment.test.mjs` 验证一行／一列对齐只修改垂直／水平坐标，覆盖不同字号、旋转、跨区域、固定范围和模板备份往返。`line-alignment-regression.js` 通过实际按钮验证选区参照、撤销重做、范围保留、横竖照片切换、重启恢复和导出坐标，并检查两元素、隐藏元素、关闭区域、零高度区域及窄面板；它也纳入 Linux CI。行列对齐复用现有 `selection` 居中规则，不新增模板字段。

原生导出基准工具为 `scripts/benchmark-export.py`，用 `--help` 查看所需的 release 测试程序与输入参数。画布性能脚本为 `scripts/zoom-performance.js`，可通过上述 WebKit 回归入口单独运行。测量时记录系统、CPU、构建模式、输入像素、模板、格式和重复次数，分别报告预览与导出耗时。

生成输出放在 `test-output/`；含本机路径、真实照片或任务记录的材料不提交。演示图必须保留合法来源、限制尺寸与体积，并移除附加元数据，`npm test` 会检查。
