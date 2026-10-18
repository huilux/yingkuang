# 架构说明

映框使用 React/TypeScript 管理编辑文档与交互、Konva 绘制画布、Tauri 2/Rust 处理原图和导出。开发与验证入口见 [贡献指南](../CONTRIBUTING.md)。

## 模块边界

路径相对于仓库根目录。

| 模块 | 职责 |
| --- | --- |
| `src/App.tsx`、`src/EditorWorkspace.tsx` | 照片批次、编辑状态和界面协调 |
| `src/EditorCanvas.tsx`、`src/canvas-camera.ts`、`src/selection-model.ts` | 视口、坐标换算、选择和拖动 |
| `src/CropEditor.tsx`、`src/photo-crop.ts`、`src/photo-transform.ts` | 裁切、旋转及像素几何 |
| `src/document-layout.ts`、`src/browser-layout.ts`、`src/template-layout.ts` | 等间距、对齐、分布范围及横竖布局切换 |
| `src/template-library.ts`、`src/builtin-template-catalog.ts`、`src/official-templates.ts` | 模板校验、备份、官方基准与个人修改合并 |
| `src/session-storage.ts`、`src/font-library.ts` | 会话恢复和字体加载、导入 |
| `src/font-glyphs.ts`、`src/text-segments.ts`、`src/watermark-text.ts` | 字形覆盖、混排分段及共用文字测量与绘制 |
| `src/ResultPreview.tsx`、`src/use-preview-fullscreen.ts` | 只读成品预览与全屏状态恢复 |
| `src/export-workflow.ts` | 导出快照、进度和重试范围 |
| `src-tauri/src/lib.rs`、`src-tauri/src/fonts.rs` | 原生命令、照片检查、预览、字体存储与查找 |
| `src-tauri/src/export.rs` | 图像变换、色彩转换、渲染、编码与队列 |
| `src-tauri/src/templates.rs` | 模板 HTTPS 请求、签名验证、原子缓存与回退 |

## 编辑文档与排版

每张照片独立保存编辑文档、参数覆盖、裁切和旋转。模板复制样式，不复制照片或裁切；视口缩放和平移不属于文档。React 保存已提交状态，Konva 保存拖动过程中的临时位置，松手只提交一次撤销步骤。

等间距、对齐和固定范围作为规则保存，按当前照片的文字尺寸解析，再将结果用于画布和导出。行只调整横向范围，列只调整纵向范围；操作只写回对应轴，区域空间不足时保留规则和原坐标。整组拖动保留内部间距，单独移动成员会解除受影响的关系。

横竖布局切换以旋转前照片的几何与同一字体度量比较模板基准和当前文档，区分自动排版与真正的个人修改；浮点误差不算编辑。局部修改带入目标布局，切换与裁切合为一个撤销步骤。

模板库保存官方基准、个人修改、修改时的原版和默认选择，兼容旧版数据。更新按 ID 合并，保留修改、个人模板和引用，不修改已导入照片的文档。会话丢失原图时保留排版并允许重定位；损坏数据先备份，阻止自动覆盖。模板备份不嵌入字体文件。

## 预览与导出

列表缩略图最长边为 720px，编辑图为 4096px，相框背景预览缓存为 1600px。原生高清解码串行执行，过期响应不覆盖当前照片。拖动或缩放复用缓存；可选 `vips` CLI 缺失时回退 Rust 解码。

成品预览复用画布的照片、文字和排版，使用独立视口，不写入编辑状态。全屏退出时恢复原来的画布、选区和窗口状态。

导出重新读取原图，顺序如下：

```text
原图 → EXIF 方向与 ICC→sRGB → 旋转与裁切 → 成品缩放
     → 相框、阴影、水印 → 编码与选定元数据 → 临时文件 → 成品
```

前端几何、预检与 Rust 渲染遵循相同约定，旋转样例见 `scripts/fixtures/photo-rotation.json`。整数倍 90° 旋转直接重排像素，小角度旋转处理预乘透明度。

预览与导出使用相同字体文件和回退顺序，不依赖系统字体。浏览器统一缩放测量与绘制，避免小字号宽度取整累计；文字按各段实际笔画居中，保留连笔和数字标点。模糊使用 linearRGB，阴影几何与字号换算保持一致。不同光栅引擎允许小幅抗锯齿差异，由真实像素对照检查。

导出冻结照片和设置，等待字体加载并解析布局；重试沿用该快照。Rust 再校验文件、尺寸、参数与路径，顺序处理队列并复用字体缓存，禁止覆盖已有文件。取消停止后续任务，失败逐项报告。

## 模板更新与安全边界

官方模板通过 GitHub Pages 独立分发，来源和公钥随应用固定。启动只验证本机缓存；联网发生在用户检查和下载时，不上传照片、EXIF、路径或个人模板。

Rust 验证 Ed25519 签名、SHA-256、最低应用版本、固定路径、大小及字体和字段约束，再原子替换缓存并保留上一版；前端再次校验文档。发布步骤见 [构建与发布](release.md#发布内置模板)。

生产 WebView 使用 CSP 限制脚本和网络来源；开发环境单独放行本机 Vite。图像和文字像素数量受资源限制；基础 EXIF 使用白名单复制，方向与尺寸按成品重写，无法安全迁移的元数据会省略。打开导出目录由 Rust 校验，不授予前端通用文件或 URL 打开权限。
