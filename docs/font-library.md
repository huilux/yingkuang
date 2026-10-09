# 内置字体与本地字体导入

在右侧「水印」面板选择一个或多个图层，在「字体」下拉框选择字体。列表保留已有系统字体，新增真实离线资源：

| 字体 | 用途 |
| --- | --- |
| 思源黑体（Noto Sans SC） | 中文简洁排版、通用文字 |
| 思源宋体（Noto Serif SC） | 中文标题、经典相框 |
| Montserrat | 几何风格品牌名、相机名 |
| Lato | 简洁参数与说明 |
| Playfair Display | 经典衬线标题 |
| Oswald | 窄体标题、较长相机名称 |
| Space Mono | 等宽 EXIF 参数 |
| 马善政毛笔楷书 | 中文手写签名、标题 |

思源黑体、思源宋体原先依赖系统安装，现在随应用提供。选型参考 [Chexif 的六种相框字体](https://chexif.com/en/)（包括 Montserrat、Lato、Playfair Display、Oswald）和 [ExifRegistry 的 Space Mono 参数相框](https://github.com/daviarndt/exifregistry)。资源来自 Google Fonts 官方仓库，固定版本、完整许可证与校验值随资源保存在 `public/fonts/`。

## 导入与保存

- 点击「导入字体」可一次选择多个 TTF / OTF，每个文件最多 32 MB；不支持 TTC、WOFF、WOFF2。
- 导入后在列表选择字体，再应用到当前所选图层。导入本身不会修改图层，切换照片或图层期间完成导入也不会误改其他内容。
- 字体按内容 SHA-256 去重；同一文件改名再次导入不会产生第二个字体项。损坏文件单独提示，其他有效文件继续导入。
- 桌面版将字体原文件复制到应用数据目录的 `fonts/`，原文件移动或删除后仍可使用；网页开发版用 IndexedDB 保存。
- 重新启动后自动恢复。字体库读取失败可以重试；某一字体损坏不影响其他字体。缺失自定义字体会提示重新导入，导出预检也会阻止静默替换字体。
- 字体选择、批量样式、撤销、模板和会话继续保存原有 `fontFamily` 字段。模板 JSON 备份只保存字体标识，不嵌入字体文件；换设备时需重新导入同一字体文件。

## 渲染

画布字体使用独立名称，不影响界面控件的系统字体与对齐。画布和模板预览等待可见文字所需的字体加载后重新测量；导出读取相同文件，不依赖系统查找新增字体。英文或自定义字体缺少的中文字符回退到内置思源黑体，混排保留主字体基线。可变字体按 400 / 500 / 600 / 700 实际字重渲染；静态字体使用文件自身的字形，Lato 与 Space Mono 提供常规和粗体两个文件。

## 验证

- `npm run build`：类型检查、35 项数据/资源回归、生产构建、启动包体积检查。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：字体解析、所有字重、导入去重、持久化、损坏条目隔离、大小边界、缺失字体预检与现有导出回归。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。
- `xvfb-run -a python3 scripts/run-webkit-regressions.py http://127.0.0.1:1422`：原有流程及字体库、桌面导入对话框的回归。
- `python3 scripts/render-parity.py http://127.0.0.1:1422`：真实 Rust 图像与 WebKit 预览对比，包含中文、英文混排、粗体、导入字体和阴影。

混排用例实测：Montserrat 的文字边界差异 1 px、粗体高度差 1 px；思源宋体与导入的 Space Mono 混排边界一致。
