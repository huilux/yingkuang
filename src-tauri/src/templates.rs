use base64::{Engine as _, engine::general_purpose::STANDARD};
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;

const MAX_CATALOG: usize = 2 * 1024 * 1024;
const MAX_INDEX: usize = 16 * 1024;
const MAX_PACKAGE: usize = 8 * 1024 * 1024;
const FONTS: &[&str] = &[
    "Cormorant Garamond",
    "Allura",
    "Long Cang",
    "Sacramento",
    "Cinzel",
    "Space Mono",
];
static CACHE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    base_url: String,
    public_key: String,
    bundled_revision: u64,
}
fn config() -> Config {
    serde_json::from_str(include_str!("../../src/data/template-update.json"))
        .expect("embedded update configuration")
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct SignedIndex {
    index: String,
    signature: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct OfficialPackage {
    format: String,
    version: u8,
    index: String,
    signature: String,
    catalog: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    schema_version: u8,
    revision: u64,
    version: String,
    min_app_version: String,
    path: String,
    sha256: String,
    bytes: usize,
    template_count: usize,
    notes: String,
    fonts: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheStatus {
    current: Option<OfficialPackage>,
    previous_version: Option<String>,
    issue: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct UpdateCheck {
    #[serde(flatten)]
    signed: SignedIndex,
    compatible: bool,
}

fn safe_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

fn manifest(signed: &SignedIndex, public_key: &str) -> Result<Manifest, String> {
    if signed.index.len() > MAX_INDEX || signed.signature.len() > 128 {
        return Err("模板更新索引过大".into());
    }
    let key = STANDARD
        .decode(public_key)
        .map_err(|_| "模板更新公钥无效")?;
    let signature = STANDARD
        .decode(signed.signature.trim())
        .map_err(|_| "模板更新签名无效")?;
    UnparsedPublicKey::new(&ED25519, key)
        .verify(signed.index.as_bytes(), &signature)
        .map_err(|_| "模板更新签名校验失败，已保留原模板")?;
    let value: Manifest =
        serde_json::from_str(&signed.index).map_err(|_| "模板更新索引格式不正确")?;
    if value.format != "yingkuang-template-feed"
        || value.schema_version != 1
        || value.revision == 0
        || value.revision > 9_007_199_254_740_991
        || !safe_version(&value.version)
        || value.path != format!("releases/{}/templates.json", value.version)
        || value.sha256.len() != 64
        || !value
            .sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || value.bytes == 0
        || value.bytes > MAX_CATALOG
        || !(1..=100).contains(&value.template_count)
        || value.notes.chars().count() > 2000
        || value.fonts.len() > FONTS.len()
        || value
            .fonts
            .iter()
            .any(|font| !FONTS.contains(&font.as_str()))
    {
        return Err("模板更新索引字段不受支持".into());
    }
    semver::Version::parse(&value.min_app_version).map_err(|_| "模板最低版本格式无效")?;
    Ok(value)
}

fn compatible(value: &Manifest) -> bool {
    semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap()
        >= semver::Version::parse(&value.min_app_version).unwrap()
}
fn short_text(value: &Value, max: usize) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.encode_utf16().count() <= max)
}
fn identifier(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 100
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
            && !matches!(s, "__proto__" | "constructor" | "prototype")
    })
}

fn validate_catalog(source: &str, expected_count: usize) -> Result<(), String> {
    let catalog: Value = serde_json::from_str(source).map_err(|_| "官方模板不是有效 JSON")?;
    let templates = catalog["templates"]
        .as_array()
        .ok_or("官方模板缺少模板列表")?;
    let mut ids = HashSet::new();
    if catalog["format"] != "yingkuang-builtin-templates"
        || catalog["version"] != 1
        || templates.len() != expected_count
    {
        return Err("官方模板格式不支持".into());
    }
    for template in templates {
        if !identifier(&template["id"])
            || !ids.insert(template["id"].as_str().unwrap())
            || !short_text(&template["name"], 120)
            || template["name"].as_str().unwrap().trim().is_empty()
            || !short_text(&template["description"], 500)
            || template["builtIn"] != true
            || template["cover"] != "/demo.jpg"
            || template["updatedAt"]
                .as_f64()
                .is_none_or(|v| !v.is_finite())
        {
            return Err("官方模板基本信息无效，或包含本机照片".into());
        }
        let layouts = &template["layouts"];
        if !layouts.is_object()
            || (layouts.get("landscape").is_none() && layouts.get("portrait").is_none())
        {
            return Err("官方模板没有可用布局".into());
        }
        for orientation in ["landscape", "portrait"] {
            let Some(document) = layouts.get(orientation) else {
                continue;
            };
            if document["version"] != 1 {
                return Err("官方模板文档版本不支持".into());
            }
            crate::export::validate_template_document(document)?;
            for region in ["top", "bottom", "left", "right"] {
                let settings = &document["regions"][region];
                if !settings["enabled"].is_boolean()
                    || settings["safePadding"]
                        .as_f64()
                        .is_none_or(|v| !(0.0..=100.0).contains(&v))
                    || ![-90, 0, 90].contains(&settings["direction"].as_i64().unwrap_or(1))
                {
                    return Err("官方模板区域参数无效".into());
                }
            }
            let layers = document["layers"].as_array().ok_or("官方模板图层无效")?;
            let mut layer_ids = HashSet::new();
            for layer in layers {
                let source = layer["source"].as_str().ok_or("模板内容来源无效")?;
                let known = [
                    "camera",
                    "make",
                    "model",
                    "lens",
                    "focalLength",
                    "aperture",
                    "shutter",
                    "iso",
                    "capturedAt",
                    "capturedDate",
                    "capturedTime",
                    "exposureBias",
                    "whiteBalance",
                    "meteringMode",
                    "exposureProgram",
                    "focalLength35mm",
                    "artist",
                    "copyright",
                    "fileName",
                    "dimensions",
                    "custom",
                ];
                let exif = source.strip_prefix("exif:").is_some_and(|key| {
                    !key.is_empty()
                        && key.len() <= 120
                        && key
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"_ ()/.,+:-".contains(&c))
                });
                if !short_text(&layer["id"], 100)
                    || layer["id"].as_str().unwrap().trim().is_empty()
                    || !layer_ids.insert(layer["id"].as_str().unwrap())
                    || !short_text(&layer["name"], 120)
                    || (!known.contains(&source) && !exif)
                    || !short_text(&layer["customValue"], 2000)
                    || !short_text(&layer["fontFamily"], 200)
                    || ![400, 500, 600, 700].contains(&layer["fontWeight"].as_u64().unwrap_or(0))
                    || !layer["visible"].is_boolean()
                {
                    return Err("官方模板图层字段无效".into());
                }
                if layer["fontFamily"]
                    .as_str()
                    .unwrap()
                    .split(',')
                    .any(|font| {
                        !FONTS.contains(&font.trim())
                            && !["serif", "sans-serif", "monospace"].contains(&font.trim())
                    })
                {
                    return Err("官方模板需要额外字体，请先更新软件".into());
                }
            }
            if let Some(rules) = document.get("distributions") {
                let rules = rules.as_array().ok_or("模板等间距规则无效")?;
                if rules.len() > 64 {
                    return Err("模板等间距规则过多".into());
                }
                let mut used = HashSet::new();
                for rule in rules {
                    let axis = rule["axis"]
                        .as_str()
                        .filter(|v| matches!(*v, "x" | "y"))
                        .ok_or("模板等间距方向无效")?;
                    let ids = rule["layerIds"]
                        .as_array()
                        .filter(|v| (3..=100).contains(&v.len()))
                        .ok_or("模板等间距图层无效")?;
                    for id in ids {
                        let id = id.as_str().ok_or("模板等间距图层无效")?;
                        if !layer_ids.contains(id) || !used.insert((axis, id)) {
                            return Err("模板等间距图层重复或不存在".into());
                        }
                    }
                }
            }
        }
    }
    if !ids.contains(catalog["defaultTemplateId"].as_str().unwrap_or("")) {
        return Err("官方默认模板不存在".into());
    }
    Ok(())
}

fn verify_package(pack: &OfficialPackage) -> Result<Manifest, String> {
    if pack.format != "yingkuang-official-template-package" || pack.version != 1 {
        return Err("不是受支持的官方模板包".into());
    }
    let value = manifest(
        &SignedIndex {
            index: pack.index.clone(),
            signature: pack.signature.clone(),
        },
        &config().public_key,
    )?;
    if !compatible(&value) {
        return Err(format!(
            "此模板需要映框 {} 或更高版本",
            value.min_app_version
        ));
    }
    if pack.catalog.len() != value.bytes
        || format!("{:x}", Sha256::digest(pack.catalog.as_bytes())) != value.sha256
    {
        return Err("官方模板文件校验失败，已保留原模板".into());
    }
    validate_catalog(&pack.catalog, value.template_count)?;
    let catalog: Value = serde_json::from_str(&pack.catalog).map_err(|_| "官方模板格式无效")?;
    if catalog["revision"].as_u64() != Some(value.revision)
        || catalog["contentVersion"] != value.version
    {
        return Err("官方模板内容版本与签名索引不一致".into());
    }
    Ok(value)
}

fn read_limited(path: &Path, max: usize) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|_| "无法读取本机官方模板缓存")?;
    let mut data = Vec::new();
    file.take((max + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|_| "读取模板文件失败")?;
    if data.len() > max {
        return Err("模板文件过大".into());
    }
    String::from_utf8(data).map_err(|_| "模板文件不是 UTF-8".into())
}
fn read_package(path: &Path) -> Result<OfficialPackage, String> {
    let pack = serde_json::from_str(&read_limited(path, MAX_PACKAGE)?)
        .map_err(|_| "本机官方模板缓存损坏")?;
    verify_package(&pack)?;
    Ok(pack)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("模板缓存目录无效")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建模板缓存目录")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建临时模板文件")?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "无法完整保存模板，请检查磁盘空间")?;
    temporary
        .persist(path)
        .map_err(|_| "无法切换官方模板缓存，已保留原模板")?;
    Ok(())
}
fn status(directory: &Path) -> CacheStatus {
    let current = directory.join("current.json");
    let previous = read_package(&directory.join("previous.json")).ok();
    match read_package(&current) {
        Ok(pack) => CacheStatus {
            previous_version: previous
                .filter(|p| p.index != pack.index)
                .and_then(|p| verify_package(&p).ok().map(|m| m.version)),
            current: Some(pack),
            issue: None,
        },
        Err(error) if current.exists() => CacheStatus {
            current: previous,
            previous_version: None,
            issue: Some(format!("{error}；继续使用可用的离线模板")),
        },
        Err(_) => CacheStatus {
            current: previous,
            previous_version: None,
            issue: None,
        },
    }
}
fn install(directory: &Path, pack: OfficialPackage) -> Result<CacheStatus, String> {
    let incoming = verify_package(&pack)?;
    let _guard = CACHE_LOCK.lock().map_err(|_| "模板缓存正忙，请重试")?;
    let current = status(directory).current.or_else(|| {
        if incoming.revision > config().bundled_revision {
            serde_json::from_str::<OfficialPackage>(include_str!(
                "../../src/data/bundled-template-package.json"
            ))
            .ok()
            .filter(|pack| verify_package(pack).is_ok())
        } else {
            None
        }
    });
    if incoming.revision < config().bundled_revision
        || current
            .as_ref()
            .and_then(|p| verify_package(p).ok())
            .is_some_and(|m| m.revision > incoming.revision)
    {
        return Err("此模板版本较旧，请使用恢复上一版功能".into());
    }
    if let Some(current) = current {
        if current.index == pack.index {
            return Ok(status(directory));
        }
        if verify_package(&current)?.revision == incoming.revision {
            return Err("官方模板版本号重复且内容不一致，已保留原模板".into());
        }
        atomic_write(
            &directory.join("previous.json"),
            &serde_json::to_vec(&current).map_err(|_| "无法保存模板回退记录")?,
        )?;
    }
    atomic_write(
        &directory.join("current.json"),
        &serde_json::to_vec(&pack).map_err(|_| "模板包序列化失败")?,
    )?;
    Ok(status(directory))
}
fn template_http_client() -> Result<reqwest::blocking::Client, String> {
    // rustls-no-provider requires selection before reqwest starts its runtime.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("Yingkuang/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "无法初始化模板下载连接".into())
}
fn download(path: &str, limit: usize) -> Result<String, String> {
    let client = template_http_client()?;
    let response = client
        .get(format!("{}{path}", config().base_url))
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .map_err(|_| "无法连接官方模板源，请稍后重试或离线导入")?;
    if !response.status().is_success() {
        return Err(format!(
            "官方模板源暂不可用（HTTP {}），已有模板仍可离线使用",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("官方模板响应过大".into());
    }
    let mut data = Vec::new();
    response
        .take((limit + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|_| "模板下载中断，已保留原模板")?;
    if data.len() > limit {
        return Err("官方模板响应过大".into());
    }
    String::from_utf8(data).map_err(|_| "官方模板响应格式无效".into())
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("templates"))
        .map_err(|_| "无法定位模板缓存目录".into())
}

#[tauri::command]
pub(crate) async fn read_official_templates(app: tauri::AppHandle) -> Result<CacheStatus, String> {
    let path = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CACHE_LOCK.lock().map_err(|_| "模板缓存正忙")?;
        Ok(status(&path))
    })
    .await
    .map_err(|_| "模板缓存读取任务失败")?
}
#[tauri::command]
pub(crate) async fn check_template_update() -> Result<UpdateCheck, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let signed = SignedIndex {
            index: download("index.json", MAX_INDEX)?,
            signature: download("index.sig", 128)?.trim().to_owned(),
        };
        let value = manifest(&signed, &config().public_key)?;
        Ok(UpdateCheck {
            signed,
            compatible: compatible(&value),
        })
    })
    .await
    .map_err(|_| "模板更新检查任务失败")?
}
#[tauri::command]
pub(crate) async fn install_template_update(
    app: tauri::AppHandle,
    signed: SignedIndex,
) -> Result<CacheStatus, String> {
    let path = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let value = manifest(&signed, &config().public_key)?;
        if !compatible(&value) {
            return Err(format!(
                "此模板需要映框 {} 或更高版本",
                value.min_app_version
            ));
        }
        let catalog = download(&value.path, value.bytes)?;
        install(
            &path,
            OfficialPackage {
                format: "yingkuang-official-template-package".into(),
                version: 1,
                index: signed.index,
                signature: signed.signature,
                catalog,
            },
        )
    })
    .await
    .map_err(|_| "模板更新安装任务失败")?
}
#[tauri::command]
pub(crate) async fn import_official_templates(
    app: tauri::AppHandle,
    source: String,
) -> Result<CacheStatus, String> {
    let path = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if source.len() > MAX_PACKAGE {
            return Err("官方模板包超过 8 MB".into());
        }
        let pack = serde_json::from_str(&source).map_err(|_| "不是有效的官方模板包")?;
        install(&path, pack)
    })
    .await
    .map_err(|_| "官方模板导入任务失败")?
}
#[tauri::command]
pub(crate) async fn rollback_official_templates(
    app: tauri::AppHandle,
) -> Result<CacheStatus, String> {
    let path = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CACHE_LOCK.lock().map_err(|_| "模板缓存正忙")?;
        let previous = read_package(&path.join("previous.json"))?;
        atomic_write(
            &path.join("current.json"),
            &serde_json::to_vec(&previous).map_err(|_| "模板回退失败")?,
        )?;
        // The previous file stays intact so a failed pointer switch is recoverable.
        Ok(CacheStatus {
            current: Some(previous),
            previous_version: None,
            issue: None,
        })
    })
    .await
    .map_err(|_| "模板回退任务失败")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_http_client_initializes_tls_without_network() {
        let first = template_http_client().expect("cold HTTPS client initialization");
        let second = template_http_client().expect("repeated HTTPS client initialization");
        drop((first, second));
        tauri::async_runtime::block_on(async {
            tauri::async_runtime::spawn_blocking(|| {
                drop(template_http_client().expect("Tauri blocking worker HTTPS client"));
            })
            .await
            .expect("Tauri blocking worker completed");
        });
    }
    fn published() -> OfficialPackage {
        serde_json::from_str(include_str!("../../src/data/bundled-template-package.json")).unwrap()
    }
    #[test]
    #[ignore = "requires the deployed public GitHub Pages template feed"]
    fn official_feed_network_smoke() {
        let signed = SignedIndex {
            index: download("index.json", MAX_INDEX).unwrap(),
            signature: download("index.sig", 128).unwrap().trim().into(),
        };
        let metadata = manifest(&signed, &config().public_key).unwrap();
        let catalog = download(&metadata.path, metadata.bytes).unwrap();
        let pack = OfficialPackage {
            format: "yingkuang-official-template-package".into(),
            version: 1,
            index: signed.index,
            signature: signed.signature,
            catalog,
        };
        let directory = tempfile::tempdir().unwrap();
        let result = install(directory.path(), pack).unwrap();
        assert!(result.current.is_some());
        println!(
            "Verified public template feed {} with {} templates",
            metadata.version, metadata.template_count
        );
    }
    #[test]
    fn actual_published_package_has_valid_signature_hash_fonts_and_documents() {
        let value = verify_package(&published()).unwrap();
        assert_eq!(value.template_count, 5);
    }
    #[test]
    fn tampering_and_unsupported_payloads_do_not_replace_existing_cache() {
        let temp = tempfile::tempdir().unwrap();
        let pack = published();
        install(temp.path(), pack.clone()).unwrap();
        let original = fs::read(temp.path().join("current.json")).unwrap();
        let mut changed = pack.clone();
        changed.catalog.push(' ');
        assert!(install(temp.path(), changed).is_err());
        let mut changed = pack;
        changed.index = changed.index.replace("2026.10.1", "2026.10.2");
        assert!(install(temp.path(), changed).is_err());
        assert_eq!(
            fs::read(temp.path().join("current.json")).unwrap(),
            original
        );
    }
    #[test]
    fn corrupt_cache_uses_verified_previous_without_deleting_corrupt_data() {
        let temp = tempfile::tempdir().unwrap();
        let pack = published();
        fs::write(
            temp.path().join("previous.json"),
            serde_json::to_vec(&pack).unwrap(),
        )
        .unwrap();
        fs::write(temp.path().join("current.json"), b"broken").unwrap();
        let result = status(temp.path());
        assert!(result.current.is_some());
        assert!(result.issue.is_some());
        assert_eq!(
            fs::read(temp.path().join("current.json")).unwrap(),
            b"broken"
        );
    }
    #[test]
    fn malformed_rules_external_covers_and_missing_fonts_are_rejected() {
        let pack = published();
        let catalog: Value = serde_json::from_str(&pack.catalog).unwrap();
        for (pointer, value) in [
            (
                "/templates/0/cover",
                Value::String("https://example.com/photo.jpg".into()),
            ),
            (
                "/templates/0/layouts/landscape/layers/0/fontFamily",
                Value::String("Unknown Font".into()),
            ),
            (
                "/templates/0/layouts/landscape/distributions/0/layerIds/0",
                Value::String("missing".into()),
            ),
        ] {
            let mut changed = catalog.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(validate_catalog(&changed.to_string(), 5).is_err());
        }
    }
}
