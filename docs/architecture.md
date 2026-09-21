# 正式应用架构

## 技术选择

- 桌面壳：Tauri 2。Arch Linux 使用系统 WebKitGTK，安装包优先提供 AppImage，并保留源码构建路径。
- 界面：React 19、TypeScript、Vite。编辑器采用自有设计令牌和组件，不把营销页布局套入工作台。
- 图像与元数据：Rust 后端负责原图读取、方向归一化、高分辨率渲染、编码和元数据写入；前端只持有缩略图和编辑状态。
- 状态：第一版使用明确的领域状态与 reducer，持久化上次批次和模板。连续拖动值不进入全局 React 重渲染链路。

## 模块边界

```text
UI shell
  ├─ Library: 导入、照片选择、模板
  ├─ Canvas: 预览、选择、拖动、吸附
  ├─ Inspector: 相框、区域、字段属性
  └─ Export: 设置、检查、队列、结果
          │ Tauri commands/events
Rust core
  ├─ catalog: 文件引用、缩略图、元数据
  ├─ layout: 与前端共享的版本化模板数据
  ├─ render: 原尺寸相框和文字合成
  ├─ metadata: EXIF/XMP/IPTC 读取与受控写入
  └─ export: 受限并发、取消、进度、原子写入
```

前端预览与 Rust 导出必须读取同一份版本化布局结构，并用固定测试图片比较关键几何位置。9600 万像素图片不在前端完整解码，批量任务也不同时常驻内存。

## 视觉方向

这是密集型摄影工具，不使用营销页常见的巨大标题、玻璃卡片或装饰动画。设计参数为 `DESIGN_VARIANCE 4 / MOTION_INTENSITY 3 / VISUAL_DENSITY 7`。界面使用冷中性色、单一鼠尾草绿强调色、8px 控件圆角和 12px 浮层圆角；阴影只表达照片和浮层层级。动效仅用于操作反馈和状态切换，并遵守减少动态效果设置。
