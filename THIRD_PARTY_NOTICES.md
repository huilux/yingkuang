# 第三方与素材许可

根目录 MIT 适用于项目原创代码和文档，不替换第三方许可证。

| 内容 | 来源与许可 |
| --- | --- |
| 内置字体 | [固定来源与摘要](public/fonts/sources.json)，各字体目录保留原始 `OFL.txt` |
| npm / Rust 依赖 | `package-lock.json` 与 `src-tauri/Cargo.lock` 固定版本，许可材料随安装包提供 |
| AppImage 系统库与打包组件 | [来源记录](licenses/README.md)，按实际交付提供原始声明和所需对应源码 |
| 用户导入的照片与字体 | 用户本机素材，不属于本仓库的再分发授权 |

`public/demo.jpg` 为 Ming 原创摄影，按项目 MIT 提供；已移除 EXIF/GPS、XMP、IPTC 等附加元数据。更换演示图时需重新核对来源与元数据。

项目图标按 MIT 提供，来源和转换方法见 [图标说明](assets/branding/README.md)。

运行 `npm run licenses:collect` 收集锁定依赖的许可声明与正文。此文件是来源索引，实际分发核对见 [发布指南](docs/release.md#许可证与源码)。第三方许可原文不得因文档精简而删除。
