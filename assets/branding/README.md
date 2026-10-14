# 项目图标

`app-icon.png` 为 2026-10-14 使用 OpenAI 图像生成工具为映框新生成的图标源文件，未提供旧图标或第三方标志作为参考。设计为墨绿色圆角底、暖白相框、山形与橙色太阳，不含文字。

此项目提供的图标素材按根目录 MIT 许可证分发。该记录说明生成来源，不代表商标注册或独占性保证。

桌面图标由项目锁定版本的 Tauri CLI 转换：

```sh
npm run tauri icon -- assets/branding/app-icon.png --output test-output/generated-icons
```

将输出目录中的桌面 PNG、ICO、ICNS 文件复制到 `src-tauri/icons/`；无需提交 Android/iOS 目录。更新图标时同步源文件和桌面派生文件。
