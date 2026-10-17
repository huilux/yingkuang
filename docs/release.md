# 构建与发布

安装包通过 [GitHub Releases](https://github.com/huilux/yingkuang/releases) 分发。支持 Linux x64、Windows x64，以及 macOS Apple 芯片和 Intel 的实验性 DMG；可下载的平台和限制以 README、发布说明为准。

## 构建

先按 [贡献指南](../CONTRIBUTING.md) 安装工具链与系统依赖，在对应系统运行：

```sh
# Debian/Ubuntu
npm run tauri build -- --bundles deb
# Linux AppImage 预备包；完整交付继续使用下方发布流程
npm run build:appimage
# Windows
npm run tauri build -- --bundles nsis
# macOS 测试包：仅在对应架构的 Apple 硬件构建，ad-hoc 签名
APPLE_SIGNING_IDENTITY=- npm run tauri build -- --bundles dmg --ci
```

产物位于 `src-tauri/target/release/bundle/`。Linux 发布构建使用 Ubuntu 22.04，不能用更新发行版构建后直接宣称兼容旧系统。AppImage 构建成功不代表运行、许可和对应源码交付均已验收。最终受控包使用 zstd 压缩文件系统，保持照片处理的速度优先编译设置。

使用项目脚本打包，不绕过 `npm run tauri`：脚本会从锁文件收集当前平台的依赖许可，拒绝缺少必要正文的构建，并把项目 MIT、第三方声明、字体 OFL 与依赖材料放入安装包。

## 发布流程

1. 使用 `npm run version:set -- <版本>` 同步版本，完成 [开发验证](development.md)，更新 CHANGELOG。
2. 提交并推送源码，创建指向该完整提交 SHA 的 `v<版本>` 标签及 Pre-release 草稿。
3. 运行受控测试包流程：

   ```sh
   gh workflow run beta-draft.yml --ref main -f release_tag=v<版本> -f include_macos=true
   ```

   `include_macos=true` 同时构建 Apple 芯片和 Intel DMG；省略时仅构建 Linux/Windows。macOS 构建复用 `macos-test.yml`，两个架构全部验收通过才汇总。

4. 下载草稿附件，核对 SHA-256、检查报告、依赖材料和实际运行结果，再发布草稿。

标签、草稿与本轮源码必须一致。工作流只写入已有未发布草稿；已经公开的安装包与标签保持原样，修复使用新版本。日常 PR、main 提交和标签 CI 只做检查，不构建安装包。需要内部检查安装包时，可手动运行 `Desktop checks and packages` 并勾选 `build_packages`；公开测试包仍使用 `Prepare beta release draft`。临时文件通过草稿中转，汇总后只保留最终下载文件。

只修复验证或汇总流程时，可用工作流的 `assemble_only` 与 `build_commit` 重新汇总已验证草稿；流程只允许验证与汇总脚本、相关测试和该工作流中明确列出的文件有差异，拒绝程序、资源或依赖变更。材料分别记录程序源码提交与汇总提交。

包含 macOS 时最终保留七个附件：五个安装包、`SHA256SUMS.txt` 和一个 `release-materials.zip`；仅 Linux/Windows 时仍为五个附件。macOS 临时测试 ZIP 在汇总成功后从未发布草稿移除，其材料与原始源码保存在统一技术材料内。

普通用户只需对应系统的安装包。校验文件与技术材料单独提供；许可证仍随安装包保留。技术材料包含依赖清单、许可正文、检查记录及需要提供的对应源码。GitHub 自动附加的两份 `Source code` 是项目源码，不是安装包。

## 验收范围

- Linux DEB：元数据、中文桌面入口、APT 实际安装、原生窗口、安装后的许可文件及卸载。
- Windows EXE：NSIS 安装、原生窗口、实际主题切换与颜色、设置保留、系统主题响应及卸载。
- AppImage：运行时与打包来源、载荷和对应源码核对，实际解压、窗口与 WebKit 进程，以及真实 PNG/JPEG 导入、旋转、默认模板和字体渲染、原生导出；首次导入 24 MP 照片后的全部模板像素、4096px 编辑图、原生 Wayland 2 倍画布、最大化还原与窗口尺寸操作。
- macOS 两架构：只读挂载 DMG、二进制架构、ad-hoc 签名、系统动态库链接、安装包内许可与原生窗口启动；首次安装、Gatekeeper 和照片处理仍待实机验证。
- 实机回归：JPEG/PNG 导入、中文与空格路径、字体、裁切旋转、当前与批量导出、取消重试、升级后的模板和会话恢复。

CI 记录操作系统、架构、文件摘要和通过范围。构建机保留开发依赖，不能等同于干净用户环境；模拟 IPC 的界面测试也不能代替真实文件处理。未验收的系统与最低版本不作兼容承诺。

Windows 测试包暂未做可信代码签名；缺少 WebView2 时安装程序需要联网获取运行时。测试说明应准确列出这些安装限制。macOS 实验性包不要求 App Store 或开发者账号，但未做 Developer ID 签名和 Apple 公证，首次启动可能被系统拦截；引导测试者参考 Apple 官方的「隐私与安全性」操作，不关闭全局安全保护。正式签名、公证需另行配置凭据。

## 许可证与源码

`npm run licenses:collect` 生成本机 Rust 目标的 `inventory.json` 与 `LICENSE-TEXTS.txt`；指定目标时使用 `npm run licenses:collect -- <目标三元组>`。升级依赖后重新收集，不能沿用旧版本材料。

- `missingTexts`：缺少必要许可正文，打包必须失败。
- `reviewRequired`：上游署名或 SDK 等待核对事项，材料齐全不等于核对完成。
- macOS：用 [`macos-review.json`](../licenses/macos-review.json) 匹配明确版本和原始声明摘要，保留上游审查项、作者及原始源码；未知版本或材料变化阻止汇总。范围和限制见 [macOS 审查记录](../licenses/MACOS-REVIEW.md)。
- AppImage：另外核对实际携带的系统库、启动脚本、生成缓存和外层运行时；随分发提供适用的原始声明与对应源码。

来源索引见 [`licenses/`](../licenses/README.md) 和 [第三方许可说明](../THIRD_PARTY_NOTICES.md)。许可正文保持原样；生成清单与构建日志放在交付材料中，不提交到源码仓库。

## 发布内置模板

官方模板静态文件存放在 `template-feed/`，通过独立的 `Official template feed` 工作流发布到 GitHub Pages。更新不创建软件 Release，也不重新构建安装包。公开索引为 `https://huilux.github.io/yingkuang/index.json`，离线模板包从站点首页下载。

维护者在应用中调整模板后，可以导出内置文件；发布全部模板（包括新增自定义模板）时使用完整备份作为发布工具的输入。不要直接将完整备份提交到仓库，它可能包含私人照片封面。发布工具只保留已知排版字段、将封面替换为项目演示图，并映射旧字体名称。发布前检查模板名称、描述和固定文字是否适合公开。

当前线上和内置模板为 `2026.10.3`（revision 3），最低需要映框 `0.5.9-beta.3`；旧版本继续使用原有模板并提示升级。

以后发布模板按以下步骤操作：

1. 在应用中完成横图、竖图和不同照片的验证，从模板库导出「内置文件」；如需包含自定义模板，则导出完整备份。
2. 查看 `template-feed/index.json` 的当前版本和 revision，选择未使用的版本号和更大的 revision。下面以下一次更新为例：

```sh
node scripts/template-feed.mjs prepare \
  --source /path/to/builtin-templates.json \
  --version 2026.10.4 --revision 4 \
  --notes "说明新增或修改的模板" \
  --min-app-version 0.5.9-beta.3 \
  --key /private/path/to/official-ed25519.pem
npm run templates:check
```

含 `alignments` 对齐规则或 `distributions[].range` 固定范围的模板需要支持这些功能的软件版本，最低版本应设置为 `0.5.9-beta.3` 或后续版本；`beta.1`、`beta.2` 不支持这些规则。发布工具要求明确传入 `--min-app-version`，避免误标兼容性。模板更新不必改变软件版本；仅引入新的渲染能力时才需要提高最低版本。

3. 检查新增版本内的名称、描述和固定文字，确认模板数量、默认模板和布局正确，运行 `npm test`。私钥在本机的 `.local-dev/template-signing/official-ed25519.pem`，也可通过 `--key` 指向自己的安全存放位置。
4. 只更新线上模板时，提交 `template-feed/index.json`、`template-feed/index.sig` 和新增的 `template-feed/releases/<版本>/`，推送分支并合入 main。等待 Actions 中的 `Official template feed` 成功，再打开 [模板站点](https://huilux.github.io/yingkuang/) 核对版本。无需创建标签、软件 Release，也无需运行打包工作流。
5. 用户在应用的模板库中点击「检查更新」，或从站点下载对应的官方模板包后离线导入。用户自己的模板和修改会保留；模板名称相同也不强制替换个人版本。

提交新增的版本目录、`index.json` 和 `index.sig`，合入 main 后自动部署。工作流验证全部版本的签名和内容，禁止修改或删除已有版本目录；构建站点时使用仓库 Secret `TEMPLATE_SIGNING_PRIVATE_KEY` 签名。私钥不进入仓库、安装包或公开站点，公钥保存在 `src/data/template-update.json`。维护者需自行安全备份私钥；更换公钥需要发布支持新公钥的软件。

每个版本包括原始模板配置 `templates.json` 和包含签名索引的离线包 `official-templates.json`。索引包含格式版本、内容版本、单调 revision、最低应用版本、模板数量、字体、大小及 SHA-256。普通模板包只使用软件自带字体，引用项目演示图，不包含照片、外部图像地址、脚本或字体下载。

如果还要让下一次安装包自带这批模板，在软件源码版本不低于模板最低版本时，同步离线基础版本：

```sh
node scripts/template-feed.mjs sync-bundled --version 2026.10.3
npm test
npm run build
```

该命令同步 `src/data/builtin-templates.json`、`src/data/bundled-template-package.json` 和 `src/data/template-update.json`，将这三个文件一并提交即可；不会生成安装包。应用内修改只保存在用户本机；官方更新、离线导入及回退均保留个人模板和修改。
