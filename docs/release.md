# 构建与发布

安装包通过 [GitHub Releases](https://github.com/huilux/yingkuang/releases) 分发。当前优先 Linux x64 与 Windows x64，macOS 暂缓公开交付；可下载的平台和限制以 README、发布说明为准。

## 构建

先按 [贡献指南](../CONTRIBUTING.md) 安装工具链与系统依赖，在对应系统运行：

```sh
# Debian/Ubuntu
npm run tauri build -- --bundles deb
# Linux AppImage
npm run build:appimage
# Windows
npm run tauri build -- --bundles nsis
```

产物位于 `src-tauri/target/release/bundle/`。Linux 发布构建使用 Ubuntu 22.04，不能用更新发行版构建后直接宣称兼容旧系统。AppImage 构建成功不代表运行、许可和对应源码交付均已验收。

使用项目脚本打包，不绕过 `npm run tauri`：脚本会从锁文件收集当前平台的依赖许可，拒绝缺少必要正文的构建，并把项目 MIT、第三方声明、字体 OFL 与依赖材料放入安装包。

## 发布流程

1. 使用 `npm run version:set -- <版本>` 同步版本，完成 [开发验证](development.md)，更新 CHANGELOG。
2. 提交并推送源码，创建指向该完整提交 SHA 的 `v<版本>` 标签及 Pre-release 草稿。
3. 运行受控测试包流程：

   ```sh
   gh workflow run beta-draft.yml --ref main -f release_tag=v<版本>
   ```

4. 下载草稿附件，核对 SHA-256、检查报告、依赖材料和实际运行结果，再发布草稿。

标签、草稿与本轮源码必须一致。工作流只写入已有未发布草稿；已经公开的安装包与标签保持原样，修复使用新版本。日常 CI 不上传公开安装包，临时文件通过草稿中转，汇总后只保留最终下载文件。

普通用户只需对应系统的安装包。校验文件与技术材料单独提供；许可证仍随安装包保留。技术材料包含依赖清单、许可正文、检查记录及需要提供的对应源码。GitHub 自动附加的两份 `Source code` 是项目源码，不是安装包。

## 验收范围

- Linux DEB：元数据、中文桌面入口、APT 实际安装、原生窗口、安装后的许可文件及卸载。
- Windows EXE：NSIS 安装、原生窗口、实际主题切换与颜色、设置保留、系统主题响应及卸载。
- AppImage：运行时与打包来源、载荷和对应源码核对，以及实际启动和功能检查。
- 实机回归：JPEG/PNG 导入、中文与空格路径、字体、裁切旋转、当前与批量导出、取消重试、升级后的模板和会话恢复。

CI 记录操作系统、架构、文件摘要和通过范围。构建机保留开发依赖，不能等同于干净用户环境；模拟 IPC 的界面测试也不能代替真实文件处理。未验收的系统与最低版本不作兼容承诺。

Windows 测试包暂未做可信代码签名；缺少 WebView2 时安装程序需要联网获取运行时。测试说明应准确列出这些安装限制。

## 许可证与源码

`npm run licenses:collect` 生成本机 Rust 目标的 `inventory.json` 与 `LICENSE-TEXTS.txt`；指定目标时使用 `npm run licenses:collect -- <目标三元组>`。升级依赖后重新收集，不能沿用旧版本材料。

- `missingTexts`：缺少必要许可正文，打包必须失败。
- `reviewRequired`：上游署名或 SDK 等待核对事项，材料齐全不等于核对完成。
- AppImage：另外核对实际携带的系统库、启动脚本、生成缓存和外层运行时；随分发提供适用的原始声明与对应源码。

来源索引见 [`licenses/`](../licenses/README.md) 和 [第三方许可说明](../THIRD_PARTY_NOTICES.md)。许可正文保持原样；生成清单与构建日志放在交付材料中，不提交到源码仓库。

## 发布内置模板

内置模板源为 `src/data/builtin-templates.json`，包含横竖布局与默认模板 ID，构建时打包。

在应用中调整模板并「更新原模板」，然后在模板库「导出内置文件」，替换上述 JSON，再运行 `npm run test:templates` 和 `npm run build`。该导出使用项目演示图封面，不包含本机照片缩略图。

不要用「导出完整备份」替换发布源：完整备份还包含个人模板与本机封面。应用内修改仅保存在本机；升级保留个人修改，用户可选择重置内置模板。
