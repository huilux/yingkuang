# 映框

面向摄影图片的本地桌面水印与相框编辑器。第一版以 Arch Linux 为目标，支持 JPEG/PNG、可编辑元数据水印、四边参数区、模板和批量导出。

## 仓库结构

- `docs/`：第一版范围、交互和相框模型。
- `prototypes/`：已验证交互的浏览器原型，仅作为设计与行为参考。
- `src/`：正式 React/TypeScript 界面。
- `src-tauri/`：正式 Tauri/Rust 桌面能力与图像处理。

功能边界以 [docs/v1-scope.md](docs/v1-scope.md) 为准。

## 当前里程碑

正式工程已经能够启动为 Arch Linux 桌面应用，完成本地 JPEG/PNG 导入、EXIF 拍摄参数读取、方向归一化、缩略图生成、上次会话恢复、相框实时预览和导出参数保存。画布图层编辑、高分辨率渲染与批量导出队列是下一阶段。

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

`assets/image/` 和 `assets/origin/` 是本地设计参考与原尺寸测试照片，不进入版本库。正式界面使用压缩后的 `public/demo.jpg` 提供无原图环境下的演示内容。
