# 照片阴影强度

- 「照片阴影」范围由 0–64 扩展到 0–100；0 关闭阴影。
- 原先不透明度在数值 40 时封顶为 40%，新上限为 90%。0–40 的模板保留原效果，较高值可继续加深。
- 编辑画布、模板预览和 Rust 导出使用相同的模糊、偏移和不透明度。SVG 滤镜范围按阴影尺寸计算，避免窄照片周围的强阴影被提前裁切。
- 回归：`cargo test --manifest-path src-tauri/Cargo.toml maximum_shadow`；`python3 scripts/render-parity.py http://127.0.0.1:1422`。
- WebKitGTK 实测：最大强度阴影与 Rust 导出平均通道差 1.15/255，最大差 4/255；原数值 40 的平均差 0.45/255。
