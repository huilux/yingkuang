# 映框

面向摄影图片的本地桌面水印与相框编辑器。第一版以 Arch Linux 为目标，支持 JPEG/PNG、可编辑元数据水印、四边参数区、模板和批量导出。

## 仓库结构

- `docs/`：第一版范围、交互和相框模型。
- `prototypes/`：已验证交互的浏览器原型，仅作为设计与行为参考。
- `src/`：正式 React/TypeScript 界面。
- `src-tauri/`：正式 Tauri/Rust 桌面能力与图像处理。

功能边界以 [docs/v1-scope.md](docs/v1-scope.md) 为准。

## 当前里程碑

正式工程已经具备第一版主流程：本地 JPEG/PNG 导入、EXIF 拍摄参数读取、方向归一化、上次会话恢复、可拖拽水印画布、居中与三等分吸附、四边参数区、模板更新与另存、原图级顺序批量导出、取消与失败重试。导出支持 JPEG/PNG、尺寸与质量、基础元数据、GPS 开关和 sRGB 色彩转换。

当前自动化验证覆盖真实 3000 万像素 JPEG 的导入、EXIF、带文字相框导出和 ICC 输出。200 张混合批次与 9600 万像素原尺寸输出仍属于交付前性能验收项，见 [开发状态](docs/development-status.md)。

## 本地开发

需要 Node.js、Rust 和 WebKitGTK 4.1。安装依赖后运行：

```bash
npm install
npm run tauri dev
```

常用检查：

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

在干净的 Linux 构建环境中生成 AppImage：

```bash
npm run tauri build -- --bundles appimage
```

当前 Arch 开发机可生成并启动 release 二进制；AppImage 封装仍受本机 VMware 私有 GTK 库干扰，具体状态记录在 [开发状态](docs/development-status.md)。正式分发包应在隔离的构建环境中生成并复测。

`assets/image/` 和 `assets/origin/` 是本地设计参考与原尺寸测试照片，不进入版本库。正式界面使用压缩后的 `public/demo.jpg` 提供无原图环境下的演示内容。
