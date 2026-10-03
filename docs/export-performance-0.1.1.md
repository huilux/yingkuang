# 第一轮导出性能验收

版本：0.1.1。基线提交：`8eaa4d1`。测试数据：本机真实 6000×4000 JPEG，三个内置模板，基础 EXIF，JPEG 质量 92 / PNG 标准压缩。

## Release 对照

每种组合分别运行 3 次，下表为内部导出耗时中位数。编译时间不计入；逐次启动独立测试进程，单进程顺序处理，没有同时运行其他压力测试。

| 模板 | 格式 | 成品尺寸 | 优化前 | 优化后 | 耗时减少 | 峰值 RSS 前→后 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| blur-bottom | JPEG | 1200 | 0.670s | 0.484s | 27.8% | 169→169 MiB |
| blur-bottom | JPEG | original | 3.984s | 2.157s | 45.9% | 429→310 MiB |
| blur-bottom | PNG | 1200 | 0.966s | 0.538s | 44.3% | 170→170 MiB |
| blur-bottom | PNG | original | 11.421s | 3.509s | 69.3% | 429→310 MiB |
| wide-float | JPEG | 1200 | 0.666s | 0.493s | 25.9% | 166→166 MiB |
| wide-float | JPEG | original | 4.283s | 2.381s | 44.4% | 464→332 MiB |
| wide-float | PNG | 1200 | 0.922s | 0.536s | 41.9% | 166→166 MiB |
| wide-float | PNG | original | 11.867s | 3.650s | 69.2% | 463→332 MiB |
| solid-white | JPEG | 1200 | 0.300s | 0.299s | 0.3% | 169→169 MiB |
| solid-white | JPEG | original | 0.970s | 0.954s | 1.7% | 212→212 MiB |
| solid-white | PNG | 1200 | 0.573s | 0.345s | 39.9% | 170→169 MiB |
| solid-white | PNG | original | 8.270s | 2.253s | 72.8% | 205→205 MiB |

纯白模板 JPEG 没有背景/阴影开销，因此速度基本不变。PNG 加速同时适用于纯白模板。测量存在本机调度波动，不保证其他设备的固定耗时。

## 改动原因

- 应用 crate 开启开发模式优化：依赖中的泛型缩放和合成代码会在调用方实例化，只优化依赖不能解决完整问题。保留调试信息和断言；同时优化元数据编码依赖。
- 大半径装饰背景使用三次方框滤波近似高斯；sigma<4 继续使用精确高斯。保持预乘透明度与 linearRGB 色彩流程。
- 预计算背景放大和阴影插值坐标，避免逐像素重复构建通用采样过程；主照片缩放策略不变。
- 完全不透明 PNG 输出 RGB，存在透明度时仍使用 RGBA；标准 PNG 使用 Deflate level 3，快速/最小体积选项仍保留。

## PNG 压缩选择证据

独立编码同一张 24MP RGB 照片，不包含相框渲染：旧 RGBA/level 6 为 7.997s / 27,045,680 字节；RGB/level 3 为 1.532s / 25,782,640 字节。RGB/level 6 为 6.507s / 24,765,060 字节。这里选 level 3 是时间与体积的折中，像素内容无损；有透明像素的图片不会移除 alpha。

## 开发模式

原基准（模糊背景、单个文字、1200px JPEG）从 6.71s 降到约 1s；原尺寸无阴影从 25.76s 降到约 4s，仅改编译配置即可重现。最终代码还包含算法优化，最终开发模式计时另行记录。不能把此比例当成 release 收益。

## 复现方法

```bash
cargo test --manifest-path src-tauri/Cargo.toml --release --lib --no-run
# 将打印出的测试可执行文件绝对路径传入 --binary
python3 scripts/benchmark-export.py --binary /absolute/path/to/test-binary \
  --label local-release --matrix --repeats 3 --output test-output/export-local.json
cargo test --manifest-path src-tauri/Cargo.toml --lib export_latency_budget -- --ignored --nocapture
```

完整原始记录在本机 `test-output/export-baseline-release.json`、`test-output/export-final-release.json`；只在文档中提交汇总，测试原片与生成成品不进入版本库。

## 验证边界

- 不透明/透明 PNG、三种压缩模式均逐像素回读相等，并验证 ICC。
- 背景放大相对 Triangle 重采样每通道误差≤1；阴影相对原双线性/source-over 误差≤1，含低透明度及半透明底图。
- WebKit 实际预览的背景、阴影、文字几何对比继续作为发布检查。
- 96MP 为放大生成的压力输入；尚非真实 96MP 摄影原片。
- 200 张队列、取消/失败恢复的长批次验收将在第二轮完成。

### 96MP 压力结果

由同一原片放大为 12000×8000 JPEG，默认模糊模板原尺寸输出 13280×9600（约 1.275 亿像素）。Release 三次为 7.483 / 7.533 / 7.511 秒，中位数 7.511 秒，峰值 RSS 994,792 KiB（约 972 MiB），均通过 10 秒本机性能门槛。原始记录：`test-output/export-96mp-release.json`。此输入用于验证分配规模，不代表真实 96MP 原片的解码复杂度。

最终开发模式原基准复测：0.714s（渲染 0.682s、编码 0.031s、元数据 0.001s），相对 6.709s 基线减少约 89.4%。

发布检查：Rust 默认测试 18 项通过 / 5 项显式性能或夹具测试默认忽略；前端构建、相机/选择/本地代理回归、Clippy `-D warnings`、Rust 格式、Git diff 检查通过。最终 WebKit 对比背景平均差 1.844 / 最大 8，阴影平均差 0.454 / 最大 2，文字与旋转文字几何通过。
