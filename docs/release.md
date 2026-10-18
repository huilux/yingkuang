# 构建与发布

本页供维护者使用。用户安装见 [使用指南](user-guide.md#安装)，开发环境和检查命令见 [贡献指南](../CONTRIBUTING.md)。

## 构建安装包

在对应系统运行项目包装脚本，它会收集锁定依赖的许可证并放入安装包：

```sh
# Debian/Ubuntu
npm run tauri build -- --bundles deb
# Windows
npm run tauri build -- --bundles nsis
# macOS：在对应架构的 Apple 硬件构建，使用 ad-hoc 测试签名
APPLE_SIGNING_IDENTITY=- npm run tauri build -- --bundles dmg --ci
```

产物在 `src-tauri/target/release/bundle/`。Linux 交付使用 Ubuntu 22.04 构建；其他发行版需单独验证兼容性。

`npm run build:appimage` 只生成预备包。公开 AppImage 还需完成运行时封装、系统库来源与对应源码核对，以及原生验收，应通过发布工作流生成。

## 发布软件测试版

1. 使用 `npm run version:set -- <版本>` 同步版本，完成贡献指南中的相关检查，更新 [CHANGELOG](../CHANGELOG.md)，提交 PR 并合入 main。
2. 切换到已同步的 main，创建与该完整提交 SHA 一致的标签和 Pre-release 草稿。下面使用 Bash；版本号需替换为 `package.json` 中尚未发布的版本，发布说明文件需预先准备。

   ```sh
   release_version=0.5.9-beta.4
   release_commit=$(git rev-parse HEAD)
   git tag -a "v$release_version" "$release_commit" -m "Yingkuang $release_version"
   git push origin "v$release_version"
   gh release create "v$release_version" --target "$release_commit" \
     --verify-tag --draft --prerelease --title "映框 $release_version" \
     --notes-file /path/to/release-notes.md
   ```

3. 在同一终端启动 [测试版发布工作流](../.github/workflows/beta-draft.yml)：

   ```sh
   gh workflow run beta-draft.yml --ref main \
     -f release_tag="v$release_version" -f include_macos=true
   ```

   默认构建 Linux 和 Windows；`include_macos=true` 加入 Apple 芯片和 Intel DMG。工作流校验草稿、版本和完整源码 SHA，只上传至未公开草稿。

4. 等待全部构建、验收和汇总成功，核对最终附件、`SHA256SUMS.txt`、技术材料和实机测试结果。发布说明应列出通过范围与待验证事项，再公开草稿。

已公开的标签和安装包不覆盖，修复使用新版本。日常 PR、main 和标签 CI 只做检查；手动 `Desktop checks and packages` 的 `build_packages` 用于构建检查，公开交付仍走上述发布流程。

包含 macOS 时，最终为五个安装包、统一校验文件和一个 `*_release-materials.zip`，共七个附件；仅 Linux/Windows 时为五个。中间清单和测试 ZIP 在汇总后从草稿移除，记录保留在技术材料中。

汇总失败时，仅在应用源码未变化且差异属于工作流允许的验证文件时，才可使用 `assemble_only` 和 `build_commit` 恢复；程序、资源或依赖变化应重新构建。

## 验收范围

| 产物 | 自动检查 |
| --- | --- |
| Linux DEB | 元数据、桌面入口、实际安装、原生窗口、安装后许可及卸载 |
| Windows EXE | 安装、原生窗口、主题切换与设置保留、系统主题响应及卸载 |
| Linux AppImage | 载荷与源码来源、解压和启动、真实 PNG/JPEG 导入、模板与字体、旋转和原生导出、Wayland 高清画布与窗口操作 |
| macOS 两种 DMG | 挂载、架构、ad-hoc 签名、系统动态库、安装包内许可与原生窗口 |

CI 不等同于干净用户环境。还需实测照片导入、裁切旋转、字体、当前与批量导出、取消重试、升级和会话恢复。

Windows 测试包未做可信代码签名，缺少 WebView2 时需联网安装运行时。macOS 实验性包未做 Developer ID 签名和 Apple 公证，Gatekeeper、首次安装及照片处理仍需实机验证；正式签名和公证需另外配置凭据。

## 许可证与源码

`npm run licenses:collect` 生成当前 Rust 目标的依赖清单和许可正文；指定目标可使用 `npm run licenses:collect -- <目标三元组>`。依赖升级后需重新核对材料。

- `missingTexts` 表示缺少必要正文，阻止打包。
- `reviewRequired` 保留上游署名或 SDK 等核对事项，正文齐全不代表核对完成。
- macOS 通过 [版本化记录](../licenses/macos-review.json) 和 [核对说明](../licenses/MACOS-REVIEW.md) 匹配依赖、作者元数据与声明摘要；未知或变更事项阻止汇总。
- AppImage 额外核对实际携带的系统库和运行时，提供适用的原始声明与对应源码。

安装包内保留必要许可；技术材料提供依赖清单、检查记录和所需源码，不要求普通用户下载。原始许可与来源索引见 [licenses](../licenses/README.md) 和 [第三方许可](../THIRD_PARTY_NOTICES.md)，不得作为冗余文档删除。

## 发布内置模板

模板放在 `template-feed/`，通过 [Official template feed](../.github/workflows/templates.yml) 工作流独立发布到 [GitHub Pages](https://huilux.github.io/yingkuang/)。更新模板不需要创建软件 Release 或重打安装包。

### 准备与验证

在应用内验证不同照片、横竖构图和参数文字后，导出「内置文件」；包含自定义模板时可使用完整备份作为输入。完整备份可能含私人照片封面，不要直接提交。准备工具只保留已知排版字段并替换封面，但名称、描述和固定文字仍需人工检查。

查看 `template-feed/index.json`，选择未使用的版本和更大的 revision。下面以 Bash 为例；私钥路径使用维护者自行保管的位置，不写入仓库：

```sh
template_version=2026.10.4
template_revision=4
node scripts/template-feed.mjs prepare \
  --source /path/to/builtin-templates.json \
  --version "$template_version" --revision "$template_revision" \
  --notes "说明新增或修改的模板" \
  --min-app-version 0.5.9-beta.3 \
  --key /secure/path/official-ed25519.pem
npm run templates:check
npm test
```

最低应用版本必须与所用渲染能力一致。`alignments` 和 `distributions[].range` 需要 `0.5.9-beta.3` 或更新版本；普通模板内容更新不必提高软件版本。

### 部署与离线快照

提交新的 `template-feed/releases/<版本>/`、`template-feed/index.json` 和 `template-feed/index.sig`，通过 PR 合入 main。工作流拒绝修改或删除历史模板版本，并使用仓库 Secret `TEMPLATE_SIGNING_PRIVATE_KEY` 部署签名站点。部署后核对站点版本、签名和模板内容。

用户在应用内「检查更新」，或下载官方模板包离线导入。更新保留个人模板、本机修改、默认选择和已编辑照片；断网或校验失败时继续使用本地版本。

若还需让后续安装包自带这批模板，先确认软件版本不低于模板最低版本，再在同一终端同步离线快照：

```sh
node scripts/template-feed.mjs sync-bundled --version "$template_version"
npm test
npm run build
```

一并提交 `src/data/builtin-templates.json`、`src/data/bundled-template-package.json` 和 `src/data/template-update.json`。只同步快照不会生成安装包。

私钥应安全备份，不能进入仓库、日志、安装包或站点。部署私钥需与 `src/data/template-update.json` 的公钥匹配；更换公钥需发布支持新公钥的软件。
