use ab_glyph::{FontArc, FontVec, VariableFont};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::Manager;

const MAX_FONT_BYTES: u64 = 32 * 1024 * 1024;
const CUSTOM_PREFIX: &str = "YingkuangFont";
static FONT_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

pub fn initialize(directory: PathBuf) {
    let _ = FONT_DIRECTORY.set(directory);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFont {
    pub(crate) family: String,
    name: String,
    data: String,
}
#[derive(Serialize, Default)]
pub struct FontReport {
    fonts: Vec<ImportedFont>,
    errors: Vec<String>,
}

fn read_font(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("无法读取字体：{e}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_FONT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取字体：{e}"))?;
    if bytes.len() as u64 > MAX_FONT_BYTES {
        return Err("字体文件超过 32 MB，请选择较小的 TTF 或 OTF 文件".into());
    }
    Ok(bytes)
}

fn inspect_font(bytes: &[u8]) -> Result<ImportedFont, String> {
    if !bytes.starts_with(&[0, 1, 0, 0]) && !bytes.starts_with(b"OTTO") {
        return Err("请选择有效的 TTF 或 OTF 字体；不支持 TTC、WOFF 或 WOFF2".into());
    }
    // Validate both the metadata and the actual native renderer's parser.
    font_from_bytes(bytes.to_vec(), 400)?;
    let face = ttf_parser::Face::parse(bytes, 0)
        .map_err(|_| "字体文件损坏，请重新选择 TTF 或 OTF 文件")?;
    let name = face
        .names()
        .into_iter()
        .filter(|n| n.name_id == ttf_parser::name_id::FULL_NAME)
        .find_map(|n| n.to_string())
        .unwrap_or_else(|| "自定义字体".into());
    Ok(ImportedFont {
        family: format!("{CUSTOM_PREFIX}{:x}", Sha256::digest(bytes)),
        name,
        data: STANDARD.encode(bytes),
    })
}

pub(crate) fn import_at(directory: &Path, source: &Path) -> Result<ImportedFont, String> {
    let bytes = read_font(source)?;
    let font = inspect_font(&bytes)?;
    fs::create_dir_all(directory).map_err(|e| format!("无法创建字体库：{e}"))?;
    let destination = directory.join(format!("{}.ttf", font.family));
    // Content addressing deduplicates renamed copies without overwriting fonts.
    if destination.exists() && fs::read(&destination).ok().as_deref() == Some(&bytes) {
        return Ok(font);
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|e| format!("无法保存字体：{e}"))?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|e| format!("无法保存字体：{e}"))?;
    temporary
        .persist(destination)
        .map_err(|e| format!("无法保存字体：{}", e.error))?;
    Ok(font)
}

fn list_at(directory: &Path) -> Result<FontReport, String> {
    let mut report = FontReport::default();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(report),
        Err(e) => return Err(format!("无法读取字体库：{e}，可重试加载")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("无法读取字体库项目：{e}"))?;
        let path = entry.path();
        if path.extension().and_then(|v| v.to_str()) != Some("ttf") {
            continue;
        }
        match read_font(&path).and_then(|bytes| inspect_font(&bytes)) {
            Ok(font) if path.file_stem().and_then(|v| v.to_str()) == Some(font.family.as_str()) => {
                report.fonts.push(font)
            }
            Ok(_) => report.errors.push(format!(
                "{}：字体内容已改变，请重新导入",
                entry.file_name().to_string_lossy()
            )),
            Err(error) => report.errors.push(format!(
                "{}：{error}，可重新导入",
                entry.file_name().to_string_lossy()
            )),
        }
    }
    report.fonts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(report)
}

pub fn managed_font(family: &str, weight: u16) -> Option<Result<FontArc, String>> {
    if let Some(font) = builtin_font(family, weight) {
        return Some(font);
    }
    if !family.starts_with(CUSTOM_PREFIX) {
        return None;
    }
    Some((|| {
        let digest = family.strip_prefix(CUSTOM_PREFIX).unwrap();
        if digest.len() != 64 || !digest.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("自定义字体标识无效，请重新导入".into());
        }
        let directory = FONT_DIRECTORY
            .get()
            .ok_or("自定义字体库尚未初始化，请重新启动应用")?;
        let bytes = read_font(&directory.join(format!("{family}.ttf")))
            .map_err(|_| "找不到此自定义字体，请在水印面板重新导入原字体文件")?;
        if format!("{CUSTOM_PREFIX}{:x}", Sha256::digest(&bytes)) != family {
            return Err("自定义字体内容已改变，请重新导入".into());
        }
        font_from_bytes(bytes, weight)
    })())
}

#[tauri::command]
pub async fn list_fonts(app: tauri::AppHandle) -> Result<FontReport, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");
    tauri::async_runtime::spawn_blocking(move || list_at(&directory))
        .await
        .map_err(|e| format!("读取字体库失败：{e}"))?
}

#[tauri::command]
pub async fn import_font(app: tauri::AppHandle, path: String) -> Result<ImportedFont, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");
    tauri::async_runtime::spawn_blocking(move || import_at(&directory, Path::new(&path)))
        .await
        .map_err(|e| format!("导入字体失败：{e}"))?
}

#[derive(Deserialize)]
struct BuiltinFont {
    family: String,
    files: Vec<FontFile>,
}
#[derive(Deserialize)]
struct FontFile {
    path: String,
    weight: String,
}

fn builtin_bytes(path: &str) -> Option<&'static [u8]> {
    match path {
        "spacemono/SpaceMono-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/spacemono/SpaceMono-Regular.ttf"
        )),
        "spacemono/SpaceMono-Bold.ttf" => Some(include_bytes!(
            "../../public/fonts/spacemono/SpaceMono-Bold.ttf"
        )),
        "manrope/Manrope[wght].ttf" => Some(include_bytes!(
            "../../public/fonts/manrope/Manrope[wght].ttf"
        )),
        "barlowsemicondensed/BarlowSemiCondensed-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/barlowsemicondensed/BarlowSemiCondensed-Regular.ttf"
        )),
        "barlowsemicondensed/BarlowSemiCondensed-Medium.ttf" => Some(include_bytes!(
            "../../public/fonts/barlowsemicondensed/BarlowSemiCondensed-Medium.ttf"
        )),
        "barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf" => Some(include_bytes!(
            "../../public/fonts/barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf"
        )),
        "barlowsemicondensed/BarlowSemiCondensed-Bold.ttf" => Some(include_bytes!(
            "../../public/fonts/barlowsemicondensed/BarlowSemiCondensed-Bold.ttf"
        )),
        "cormorantgaramond/CormorantGaramond[wght].ttf" => Some(include_bytes!(
            "../../public/fonts/cormorantgaramond/CormorantGaramond[wght].ttf"
        )),
        "allura/Allura-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/allura/Allura-Regular.ttf"
        )),
        "lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf"
        )),
        "lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf" => Some(include_bytes!(
            "../../public/fonts/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf"
        )),
        "zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf"
        )),
        "longcang/LongCang-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/longcang/LongCang-Regular.ttf"
        )),
        "sacramento/Sacramento-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/sacramento/Sacramento-Regular.ttf"
        )),
        "cinzel/Cinzel[wght].ttf" => {
            Some(include_bytes!("../../public/fonts/cinzel/Cinzel[wght].ttf"))
        }
        "rajdhani/Rajdhani-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/rajdhani/Rajdhani-Regular.ttf"
        )),
        "rajdhani/Rajdhani-Medium.ttf" => Some(include_bytes!(
            "../../public/fonts/rajdhani/Rajdhani-Medium.ttf"
        )),
        "rajdhani/Rajdhani-SemiBold.ttf" => Some(include_bytes!(
            "../../public/fonts/rajdhani/Rajdhani-SemiBold.ttf"
        )),
        "rajdhani/Rajdhani-Bold.ttf" => Some(include_bytes!(
            "../../public/fonts/rajdhani/Rajdhani-Bold.ttf"
        )),
        "bebasneue/BebasNeue-Regular.ttf" => Some(include_bytes!(
            "../../public/fonts/bebasneue/BebasNeue-Regular.ttf"
        )),
        _ => None,
    }
}

pub fn builtin_font(family: &str, weight: u16) -> Option<Result<FontArc, String>> {
    static CATALOG: OnceLock<Vec<BuiltinFont>> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/font-catalog.json"))
            .expect("valid built-in font catalog")
    });
    static RETIRED: OnceLock<HashMap<String, String>> = OnceLock::new();
    let retired = RETIRED.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/retired-fonts.json"))
            .expect("valid retired font mapping")
    });
    let family = retired.get(family).map(String::as_str).unwrap_or(family);
    let font = catalog.iter().find(|font| font.family == family)?;
    Some((|| {
        let file = font
            .files
            .iter()
            .find(|file| {
                let bounds: Vec<u16> = file
                    .weight
                    .split_whitespace()
                    .filter_map(|v| v.parse().ok())
                    .collect();
                bounds.len() == 2 && (bounds[0]..=bounds[1]).contains(&weight)
            })
            .ok_or_else(|| format!("内置字体 {family} 不支持字重 {weight}"))?;
        let bytes =
            builtin_bytes(&file.path).ok_or_else(|| format!("内置字体文件缺失：{}", file.path))?;
        font_from_bytes(bytes.to_vec(), weight)
    })())
}

pub fn font_from_bytes(bytes: Vec<u8>, weight: u16) -> Result<FontArc, String> {
    let mut font = FontVec::try_from_vec(bytes)
        .map_err(|_| "无法解析字体，请选择有效的 TTF 或 OTF 文件".to_owned())?;
    font.set_variation(b"wght", weight as f32);
    // Canvas uses no optical sizing or other variation overrides either.
    Ok(FontArc::new(font))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ab_glyph::Font;

    #[test]
    fn all_builtins_parse_at_every_editor_weight_and_cover_their_scripts() {
        let catalog: Vec<BuiltinFont> =
            serde_json::from_str(include_str!("../../src/font-catalog.json")).unwrap();
        for entry in catalog {
            for weight in [400, 500, 600, 700] {
                let font = builtin_font(&entry.family, weight).unwrap().unwrap();
                for c in "50mm f/2.8 ISO100".chars() {
                    assert_ne!(font.glyph_id(c).0, 0, "{} missing {c}", entry.family);
                }
                if ["ZCOOL XiaoWei", "Long Cang"].contains(&entry.family.as_str()) {
                    for c in "映框摄影照片版权署名镜头参数".chars() {
                        assert_ne!(font.glyph_id(c).0, 0, "{} missing {c}", entry.family);
                    }
                }
                if entry.family == "LXGW WenKai TC" {
                    for c in "映框摄影照片版权署名镜头参数時間光圈©".chars() {
                        assert_ne!(font.glyph_id(c).0, 0, "{} missing {c}", entry.family);
                    }
                }
            }
        }
    }

    #[test]
    fn import_persists_deduplicates_and_survives_bad_library_entries() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("library");
        initialize(directory.clone());
        let source = root.path().join("Title.TTF");
        let bytes = builtin_bytes("manrope/Manrope[wght].ttf").unwrap();
        fs::write(&source, bytes).unwrap();
        let first = import_at(&directory, &source).unwrap();
        let renamed = root.path().join("Renamed.ttf");
        fs::write(&renamed, bytes).unwrap();
        let second = import_at(&directory, &renamed).unwrap();
        assert_eq!(first.family, second.family);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_file(source).unwrap();
        fs::remove_file(renamed).unwrap();
        let regular = managed_font(&first.family, 400).unwrap().unwrap();
        let bold = managed_font(&first.family, 700).unwrap().unwrap();
        let coverage = |font: FontArc| {
            let mut value = 0.0;
            font.outline_glyph(font.glyph_id('M').with_scale(40.0))
                .unwrap()
                .draw(|_, _, alpha| value += alpha);
            value
        };
        assert!(coverage(bold) > coverage(regular) * 1.2);
        fs::write(directory.join("broken.ttf"), b"broken font").unwrap();
        let report = list_at(&directory).unwrap();
        assert_eq!(report.fonts.len(), 1);
        assert_eq!(report.errors.len(), 1);
        fs::write(
            directory.join(format!("{}.ttf", first.family)),
            b"broken font",
        )
        .unwrap();
        assert!(managed_font(&first.family, 400).unwrap().is_err());
        assert!(
            managed_font("YingkuangFont../../outside", 400)
                .unwrap()
                .is_err()
        );
        let invalid = root.path().join("invalid.otf");
        fs::write(&invalid, b"not a font").unwrap();
        assert!(import_at(&directory, &invalid).is_err());
        let large = root.path().join("large.ttf");
        fs::File::create(&large)
            .unwrap()
            .set_len(MAX_FONT_BYTES + 1)
            .unwrap();
        assert!(read_font(&large).unwrap_err().contains("32 MB"));
    }

    #[test]
    fn retired_bundled_names_resolve_to_replacements() {
        let retired: HashMap<String, String> =
            serde_json::from_str(include_str!("../../src/retired-fonts.json")).unwrap();
        for (old, new) in retired {
            for weight in [400, 500, 600, 700] {
                let old_font = builtin_font(&old, weight).unwrap().unwrap();
                let new_font = builtin_font(&new, weight).unwrap().unwrap();
                assert_eq!(
                    old_font.h_advance_unscaled(old_font.glyph_id('M')),
                    new_font.h_advance_unscaled(new_font.glyph_id('M'))
                );
            }
        }
    }

    #[test]
    fn variable_font_weight_changes_outlines() {
        let regular = builtin_font("Manrope", 400).unwrap().unwrap();
        let bold = builtin_font("Manrope", 700).unwrap().unwrap();
        let glyph = regular.glyph_id('M').with_scale(40.0);
        let outline = |font: FontArc| {
            let mut coverage = 0.0;
            font.outline_glyph(glyph.clone())
                .unwrap()
                .draw(|_, _, alpha| coverage += alpha);
            coverage
        };
        assert!(outline(bold) > outline(regular) * 1.2);
    }
}
