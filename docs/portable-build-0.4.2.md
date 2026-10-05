# 0.4.2 AppImage 构建与真实操作验收

## 修复

新增 `npm run build:appimage`，执行正式前端检查、Rust release 编译和 AppImage 封装。

本机 Arch 的两个阻断点均有失败日志：

1. linuxdeploy 自带旧版 `strip` 无法识别系统库中的 `.relr.dyn` 段。构建子进程设置 `NO_STRIP=1`；应用本身仍由 Cargo 的 release 配置去除符号。
2. GTK 插件递归搜索 `/usr/lib`，误收集 VMware 私有 GTK 库与其他应用的调试文件，因 `libffi.so.6` 缺失失败。插件现在只搜索 pkg-config 指定库目录的直接文件，模块子目录仍由插件原有逻辑处理。

插件取自官方仓库固定提交 `dda522bce37387f1b853d9095713bfaa924c8423`，下载与补丁结果分别验证 SHA-256。工具缓存放在 Cargo 目标目录的 `.tauri` 下；通过 Cargo metadata 定位目录，支持自定义目标目录。用户全局工具缓存和系统库均未修改。

依据：[Tauri 2.11.5 打包实现](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs)、[官方 GTK 插件固定版本](https://github.com/tauri-apps/linuxdeploy-plugin-gtk/blob/dda522bce37387f1b853d9095713bfaa924c8423/linuxdeploy-plugin-gtk.sh)、[linuxdeploy 的 NO_STRIP 支持](https://github.com/linuxdeploy/linuxdeploy/issues/72)。

## 使用

```bash
npm ci
npm run build:appimage
```

首次构建需要联网下载插件及 Tauri 打包工具。生成位置为 Cargo 目标目录下的 `release/bundle/appimage/`，默认文件名 `映框_0.4.2_amd64.AppImage`。后续命中已验证插件缓存时无须重新下载该插件。仍需满足 Tauri 的 Linux 编译依赖。

## 验证证据

- 构建脚本在缺少项目 GTK 插件时完成下载、校验和补丁；缓存命中后完整重跑成功。
- `npm run build` 包含的 29 项功能检查、TypeScript、生产构建和入口体积预算通过；另外 11 项相机、选择与本地代理测试通过。
- 最终 AppImage 约 99 MiB。本机实际启动使用独立 Xvfb、D-Bus 会话和 XDG 数据目录；通过真实 GTK 文件选择器导入 6000×4000 原片并选取导出目录，没有使用 IPC 模拟。
- 0.4.1 封装验证包导出 JPEG 成功，0.4.2 最终包重启恢复照片、编辑和输出目录后导出 PNG 成功。两种成品均为 6640×4800，可完整解码，ICC 为 588 字节、EXIF 为 326 字节。
- 界面记录 JPEG 约 2 秒、PNG 约 3 秒；这是单次真实操作记录，精确性能对照仍以早期受控基准为准。
- 打包日志不再收集 `/usr/lib/vmware` 或 `/usr/lib/debug` 下的库。

本机原始证据：`test-output/appimage-baseline-verbose.log`、`appimage-no-strip.log`、`appimage-0.4.2-final.log`；实际窗口与输出在 `test-output/native-smoke/`。

首次完整封装曾仅返回通用失败，未保留具体工具错误；后续详细封装和完整入口重跑成功。脚本已默认启用详细日志，后续失败可以定位具体命令。

## 边界

- 验证环境是当前 Arch x86_64 主机上的独立显示和数据目录，尚未完成全新操作系统或其他 Linux 发行版兼容性验收。
- 无 FUSE 环境使用 `--appimage-extract-and-run` 启动；未把该结果声称为桌面双击与 FUSE 验证。
- WebKit 启动有 GStreamer appsink 警告，已验证的照片编辑与导出正常；本应用不提供音视频功能。
- 独立 D-Bus 会话存在服务激活警告；GTK 目录选择器从“最近使用”视图切换到目录视图后可正常选择。普通桌面门户行为仍需干净桌面环境复测。

## 版本管理

- 分支：`codex/iteration-08-portable-build`，基于 `v0.4.1`。
- 提交：`fix(build): isolate AppImage tools and bound GTK library discovery`。
- 版本与标签：`0.4.2` / `v0.4.2`。
