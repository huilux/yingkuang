use base64::{Engine as _, engine::general_purpose::STANDARD};
use exif::{In, Reader as ExifReader, Tag, Value};
use image::{DynamicImage, GenericImageView, codecs::jpeg::JpegEncoder};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, hash_map::DefaultHasher},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{BufReader, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

mod export;
mod fonts;
mod templates;
#[cfg(test)]
mod test_fixtures;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoMetadata {
    camera: Option<String>,
    make: Option<String>,
    model: Option<String>,
    lens: Option<String>,
    focal_length: Option<String>,
    aperture: Option<String>,
    shutter: Option<String>,
    iso: Option<String>,
    captured_at: Option<String>,
    captured_date: Option<String>,
    captured_time: Option<String>,
    exposure_bias: Option<String>,
    white_balance: Option<String>,
    metering_mode: Option<String>,
    exposure_program: Option<String>,
    focal_length_35mm: Option<String>,
    artist: Option<String>,
    copyright: Option<String>,
    file_name: Option<String>,
    dimensions: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoAsset {
    id: String,
    path: String,
    file_name: String,
    width: u32,
    height: u32,
    megapixels: f64,
    thumbnail_data_url: String,
    metadata: PhotoMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectFailure {
    path: String,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectReport {
    items: Vec<PhotoAsset>,
    failures: Vec<InspectFailure>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoPathsReport {
    paths: Vec<String>,
    failures: Vec<InspectFailure>,
    ignored: usize,
}

#[derive(Default)]
pub(crate) struct ExifSnapshot {
    pub(crate) orientation: u32,
    pub(crate) camera: Option<String>,
    pub(crate) make: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) lens: Option<String>,
    pub(crate) focal_length: Option<String>,
    pub(crate) aperture: Option<String>,
    pub(crate) shutter: Option<String>,
    pub(crate) iso: Option<String>,
    pub(crate) captured_at: Option<String>,
    pub(crate) captured_date: Option<String>,
    pub(crate) captured_time: Option<String>,
    pub(crate) exposure_bias: Option<String>,
    pub(crate) white_balance: Option<String>,
    pub(crate) metering_mode: Option<String>,
    pub(crate) exposure_program: Option<String>,
    pub(crate) focal_length_35mm: Option<String>,
    pub(crate) artist: Option<String>,
    pub(crate) copyright: Option<String>,
    pub(crate) file_name: Option<String>,
    pub(crate) dimensions: Option<String>,
    pub(crate) extra: HashMap<String, String>,
}

fn clean_metadata_text(value: &str) -> Option<String> {
    let value = value.trim().trim_matches('\0').trim();
    let value = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
        .trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn display_exif_field(exif: &exif::Exif, field: &exif::Field) -> Option<String> {
    let value = match &field.value {
        Value::Ascii(values) => values
            .iter()
            .filter_map(|value| clean_metadata_text(&String::from_utf8_lossy(value)))
            .collect::<Vec<_>>()
            .join(" "),
        _ => field.display_value().with_unit(exif).to_string(),
    };
    clean_metadata_text(&value).filter(|value| value.len() <= 500)
}

fn display_field(exif: &exif::Exif, tag: Tag) -> Option<String> {
    exif.get_field(tag, In::PRIMARY)
        .and_then(|field| display_exif_field(exif, field))
}

fn captured_parts(value: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    let mut parts = value.split_whitespace();
    let date = parts
        .next()
        .map(|date| date.replacen(':', "-", 2))
        .filter(|date| !date.is_empty());
    let time = parts.collect::<Vec<_>>().join(" ");
    (date, (!time.is_empty()).then_some(time))
}

fn rational_number(exif: &exif::Exif, tag: Tag) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match &field.value {
        Value::Rational(values) => values.first().map(|value| value.to_f64()),
        _ => None,
    }
}

pub(crate) fn read_exif(path: &Path) -> ExifSnapshot {
    let mut snapshot = ExifSnapshot {
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned),
        ..ExifSnapshot::default()
    };
    let Ok(file) = File::open(path) else {
        return snapshot;
    };
    let mut reader = BufReader::new(file);
    let exif = ExifReader::new()
        .read_from_container(&mut reader)
        .ok()
        .or_else(|| {
            // Older exports stored EXIF in PNG zTXt chunks. Decode that legacy
            // container only as a fallback; new exports use the standard eXIf chunk.
            if image::ImageFormat::from_path(path).ok() != Some(image::ImageFormat::Png) {
                return None;
            }
            let metadata = little_exif::metadata::Metadata::new_from_path(path).ok()?;
            ExifReader::new().read_raw(metadata.encode().ok()?).ok()
        });
    let Some(exif) = exif else {
        return snapshot;
    };

    let make = display_field(&exif, Tag::Make);
    let model = display_field(&exif, Tag::Model);
    let camera = match (make.as_deref(), model.as_deref()) {
        (Some(make), Some(model)) if model.to_lowercase().contains(&make.to_lowercase()) => {
            Some(model.to_owned())
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (Some(make), None) => Some(make.to_owned()),
        (None, Some(model)) => Some(model.to_owned()),
        (None, None) => None,
    };

    let orientation = exif
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .unwrap_or(1);
    let aperture = rational_number(&exif, Tag::FNumber).map(|value| format!("f/{value:.1}"));
    let focal_length =
        rational_number(&exif, Tag::FocalLength).map(|value| format!("{}mm", value.round() as u32));
    let iso = exif
        .get_field(Tag::PhotographicSensitivity, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .map(|value| format!("ISO{value}"));
    let captured_at = display_field(&exif, Tag::DateTimeOriginal)
        .or_else(|| display_field(&exif, Tag::DateTimeDigitized))
        .or_else(|| display_field(&exif, Tag::DateTime));
    let (captured_date, captured_time) = captured_parts(captured_at.as_deref());
    let focal_length_35mm = exif
        .get_field(Tag::FocalLengthIn35mmFilm, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .map(|value| format!("{value}mm"));
    let extra = exif
        .fields()
        .filter(|field| field.tag != Tag::MakerNote)
        .filter_map(|field| {
            display_exif_field(&exif, field).map(|value| (format!("exif:{}", field.tag), value))
        })
        .collect();

    snapshot.orientation = orientation;
    snapshot.camera = camera;
    snapshot.make = make;
    snapshot.model = model;
    snapshot.lens = display_field(&exif, Tag::LensModel)
        .or_else(|| display_field(&exif, Tag::LensSpecification));
    snapshot.focal_length = focal_length;
    snapshot.aperture = aperture;
    snapshot.shutter = display_field(&exif, Tag::ExposureTime).map(|value| value.replace(' ', ""));
    snapshot.iso = iso;
    snapshot.captured_at = captured_at;
    snapshot.captured_date = captured_date;
    snapshot.captured_time = captured_time;
    snapshot.exposure_bias = display_field(&exif, Tag::ExposureBiasValue);
    snapshot.white_balance = display_field(&exif, Tag::WhiteBalance);
    snapshot.metering_mode = display_field(&exif, Tag::MeteringMode);
    snapshot.exposure_program = display_field(&exif, Tag::ExposureProgram);
    snapshot.focal_length_35mm = focal_length_35mm;
    snapshot.artist = display_field(&exif, Tag::Artist);
    snapshot.copyright = display_field(&exif, Tag::Copyright);
    snapshot.extra = extra;
    snapshot
}

pub(crate) fn apply_orientation(image: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        7 => image.rotate270().fliph(),
        8 => image.rotate270(),
        _ => image,
    }
}

fn inspect_image(path: PathBuf) -> Result<PhotoAsset, String> {
    let exif = read_exif(&path);
    let image = DynamicImage::ImageRgba8(export::decode_color_managed(&path, exif.orientation)?);
    let (width, height) = image.dimensions();
    let thumbnail = image.thumbnail(720, 720);
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 84)
        .encode_image(&thumbnail)
        .map_err(|error| format!("无法生成缩略图：{error}"))?;

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("未命名照片")
        .to_owned();

    Ok(PhotoAsset {
        id: format!("photo-{:x}", hasher.finish()),
        path: path.to_string_lossy().into_owned(),
        file_name: file_name.clone(),
        width,
        height,
        megapixels: (width as f64 * height as f64) / 1_000_000.0,
        thumbnail_data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)),
        metadata: PhotoMetadata {
            camera: exif.camera,
            make: exif.make,
            model: exif.model,
            lens: exif.lens,
            focal_length: exif.focal_length,
            aperture: exif.aperture,
            shutter: exif.shutter,
            iso: exif.iso,
            captured_at: exif.captured_at,
            captured_date: exif.captured_date,
            captured_time: exif.captured_time,
            exposure_bias: exif.exposure_bias,
            white_balance: exif.white_balance,
            metering_mode: exif.metering_mode,
            exposure_program: exif.exposure_program,
            focal_length_35mm: exif.focal_length_35mm,
            artist: exif.artist,
            copyright: exif.copyright,
            file_name: Some(file_name.clone()),
            dimensions: Some(format!("{width} × {height}")),
            extra: exif.extra,
        },
    })
}

fn editor_photo(path: &Path) -> Result<String, String> {
    let jpeg = image::ImageFormat::from_path(path).ok() == Some(image::ImageFormat::Jpeg);
    if jpeg && let Some(bytes) = vips_editor_jpeg(path) {
        return Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
    }

    let image = export::decode_color_managed(path, read_exif(path).orientation)?;
    // A single active 4096px editing texture covers 300% zoom on typical HiDPI
    // viewports. Export always reads the original, independently of this limit.
    let image = DynamicImage::ImageRgba8(image);
    let image = if image.width().max(image.height()) > 4096 {
        image.resize(4096, 4096, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut bytes = std::io::Cursor::new(Vec::new());
    if jpeg {
        JpegEncoder::new_with_quality(&mut bytes, 92)
            .encode_image(&image)
            .map_err(|error| format!("无法生成高清编辑图：{error}"))?;
    } else {
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .map_err(|error| format!("无法生成高清编辑图：{error}"))?;
    }
    let mime = if jpeg { "image/jpeg" } else { "image/png" };
    Ok(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}

// libvips shrinks JPEGs while loading and uses a fast native encoder. Keep the
// pure-Rust path above for installations without its CLI and for alpha images.
fn vips_editor_jpeg(path: &Path) -> Option<Vec<u8>> {
    let directory = tempfile::Builder::new()
        .prefix("yingkuang-editor-")
        .tempdir()
        .ok()?;
    let output = directory.path().join("photo.jpg");
    let profile_path = directory.path().join("srgb.icc");
    let profile = lcms2::Profile::new_srgb().icc().ok()?;
    std::fs::write(&profile_path, profile).ok()?;
    let target = format!("{}[Q=92,strip]", output.display());
    let result = std::process::Command::new("vips")
        .arg("thumbnail")
        .arg(path)
        .arg(target)
        .arg("4096")
        .args(["--size", "down"])
        .arg("--output-profile")
        .arg(&profile_path)
        .output();
    let bytes = match result {
        Ok(result) if result.status.success() => std::fs::read(&output).ok(),
        _ => None,
    };
    bytes.filter(|bytes| bytes.starts_with(&[0xff, 0xd8]))
}

#[tauri::command]
async fn load_editor_photo(path: String) -> Result<String, String> {
    use std::sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    };
    static DECODE: Mutex<()> = Mutex::new(());
    static LATEST: AtomicU64 = AtomicU64::new(0);
    let request = LATEST.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DECODE.lock().map_err(|_| "高清图片加载锁异常".to_owned())?;
        if request != LATEST.load(Ordering::SeqCst) {
            return Err("已取消过期的图片加载".to_owned());
        }
        editor_photo(Path::new(&path))
    })
    .await
    .map_err(|error| format!("高清图片任务异常结束：{error}"))?
}

#[tauri::command]
async fn inspect_images(paths: Vec<String>) -> Result<Vec<PhotoAsset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(PathBuf::from)
            .map(inspect_image)
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|error| format!("图片任务异常结束：{error}"))?
}

#[tauri::command]
async fn inspect_images_resilient(paths: Vec<String>) -> Result<InspectReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut items = Vec::new();
        let mut failures = Vec::new();
        for path in paths {
            match inspect_image(PathBuf::from(&path)) {
                Ok(photo) => items.push(photo),
                Err(reason) => failures.push(InspectFailure { path, reason }),
            }
        }
        InspectReport { items, failures }
    })
    .await
    .map_err(|error| format!("图片任务异常结束：{error}"))
}

fn image_files_in_directory(directory: &Path) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    let mut directories = vec![directory.to_path_buf()];
    while let Some(current) = directories.pop() {
        for entry in fs::read_dir(&current).map_err(|error| format!("无法读取文件夹：{error}"))?
        {
            let entry = entry.map_err(|error| format!("无法读取文件夹内容：{error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("无法读取文件类型：{error}"))?;
            let path = entry.path();
            if file_type.is_dir() {
                directories.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let is_image = path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    matches!(
                        extension.to_ascii_lowercase().as_str(),
                        "jpg" | "jpeg" | "png"
                    )
                });
            if is_image {
                paths.push(path.to_string_lossy().into_owned());
            }
        }
    }
    paths.sort_by_key(|path| path.to_lowercase());
    Ok(paths)
}

fn resolve_photo_paths_sync(paths: Vec<String>) -> PhotoPathsReport {
    let mut report = PhotoPathsReport {
        paths: Vec::new(),
        failures: Vec::new(),
        ignored: 0,
    };
    let mut visited = HashSet::new();
    let mut images = HashSet::new();
    for path in paths {
        if !visited.insert(path.clone()) {
            continue;
        }
        let input = Path::new(&path);
        let resolved = match fs::metadata(input) {
            Ok(metadata) if metadata.is_dir() => image_files_in_directory(input),
            Ok(metadata)
                if metadata.is_file()
                    && input
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| {
                            matches!(
                                extension.to_ascii_lowercase().as_str(),
                                "jpg" | "jpeg" | "png"
                            )
                        }) =>
            {
                Ok(vec![path.clone()])
            }
            Ok(_) => {
                report.ignored += 1;
                continue;
            }
            Err(error) => Err(format!("无法读取拖入项目：{error}")),
        };
        match resolved {
            Ok(paths) => report
                .paths
                .extend(paths.into_iter().filter(|path| images.insert(path.clone()))),
            Err(reason) => report.failures.push(InspectFailure { path, reason }),
        }
    }
    report
}

#[tauri::command]
async fn resolve_photo_paths(paths: Vec<String>) -> Result<PhotoPathsReport, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_photo_paths_sync(paths))
        .await
        .map_err(|error| format!("读取拖入项目任务异常结束：{error}"))
}

#[tauri::command]
async fn list_image_files(directory: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || image_files_in_directory(Path::new(&directory)))
        .await
        .map_err(|error| format!("读取文件夹任务异常结束：{error}"))?
}

#[tauri::command]
async fn read_template_backup(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let size = fs::metadata(&path)
            .map_err(|error| format!("无法读取备份文件：{error}"))?
            .len();
        if size > 32 * 1024 * 1024 {
            return Err("模板备份文件超过 32 MB".to_owned());
        }
        fs::read_to_string(path).map_err(|error| format!("无法读取备份内容：{error}"))
    })
    .await
    .map_err(|error| format!("读取备份任务异常结束：{error}"))?
}

#[tauri::command]
async fn write_template_backup(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let destination = Path::new(&path);
        let parent = destination.parent().ok_or("无法确定备份文件夹")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| format!("无法创建备份临时文件：{error}"))?;
        temporary
            .write_all(content.as_bytes())
            .map_err(|error| format!("无法写入备份：{error}"))?;
        temporary
            .persist(destination)
            .map_err(|error| format!("无法保存备份：{}", error.error))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("保存备份任务异常结束：{error}"))?
}

fn validated_export_directory(path: &Path) -> Result<PathBuf, String> {
    let directory =
        fs::canonicalize(path).map_err(|error| format!("无法访问输出文件夹：{error}"))?;
    if !directory.is_dir() {
        return Err("只能打开已存在的文件夹".into());
    }
    Ok(directory)
}

#[tauri::command]
fn open_export_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let directory = validated_export_directory(Path::new(&path))?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("无法打开输出文件夹：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            fonts::initialize(app.path().app_data_dir()?.join("fonts"));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fonts::list_fonts,
            fonts::import_font,
            inspect_images,
            inspect_images_resilient,
            list_image_files,
            read_template_backup,
            write_template_backup,
            templates::read_official_templates,
            templates::check_template_update,
            templates::install_template_update,
            templates::import_official_templates,
            templates::rollback_official_templates,
            open_export_directory,
            load_editor_photo,
            export::preflight_export,
            resolve_photo_paths,
            export::export_images,
            export::cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Yingkuang");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_export_directory_rejects_files_missing_paths_and_urls() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            validated_export_directory(root.path()).unwrap(),
            fs::canonicalize(root.path()).unwrap()
        );
        let file = root.path().join("program.exe");
        fs::write(&file, b"not a directory").unwrap();
        assert!(validated_export_directory(&file).is_err());
        assert!(validated_export_directory(&root.path().join("missing")).is_err());
        assert!(validated_export_directory(Path::new("https://example.invalid")).is_err());
    }

    #[test]
    fn recovery_backup_keeps_raw_content_and_cleans_failed_writes() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("recovery.json");
        let content = "{broken original\n原始记录".to_owned();
        tauri::async_runtime::block_on(write_template_backup(
            destination.to_string_lossy().into_owned(),
            content.clone(),
        ))
        .unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), content);
        let blocked = root.path().join("existing-directory");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("keep.txt"), "existing contents").unwrap();
        assert!(
            tauri::async_runtime::block_on(write_template_backup(
                blocked.to_string_lossy().into_owned(),
                "replacement".into()
            ))
            .is_err()
        );
        assert_eq!(
            fs::read_to_string(blocked.join("keep.txt")).unwrap(),
            "existing contents"
        );
        assert_eq!(fs::read_to_string(destination).unwrap(), content);
        assert_eq!(
            fs::read_dir(root.path()).unwrap().count(),
            2,
            "failed backup left a temporary file"
        );
    }

    #[test]
    fn dropped_paths_expand_folders_deduplicate_and_keep_good_inputs_after_errors() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("nested");
        fs::create_dir(&nested).unwrap();
        for name in ["a.JPG", "b.jPeG", "c.PNG", "notes.txt"] {
            File::create(nested.join(name)).unwrap();
        }
        let image = nested.join("a.JPG").to_string_lossy().into_owned();
        let folder = root.path().to_string_lossy().into_owned();
        let text = nested.join("notes.txt").to_string_lossy().into_owned();
        let missing = root
            .path()
            .join("missing.jpg")
            .to_string_lossy()
            .into_owned();
        let report = resolve_photo_paths_sync(vec![
            image.clone(),
            missing.clone(),
            text,
            folder.clone(),
            folder,
            image.clone(),
        ]);
        assert_eq!(report.paths.len(), 3);
        assert_eq!(report.paths[0], image);
        assert_eq!(report.ignored, 1);
        assert_eq!(report.failures.len(), 1);
        assert_eq!(report.failures[0].path, missing);
        assert!(resolve_photo_paths_sync(Vec::new()).paths.is_empty());
    }

    #[test]
    fn folder_import_lists_supported_images_including_subfolders() {
        let directory = tempfile::tempdir().unwrap();
        for name in ["b.PNG", "a.jpg", "notes.txt"] {
            File::create(directory.path().join(name)).unwrap();
        }
        let nested = directory.path().join("nested");
        fs::create_dir(&nested).unwrap();
        File::create(nested.join("c.jpeg")).unwrap();

        let paths = image_files_in_directory(directory.path()).unwrap();
        let names: Vec<_> = paths
            .iter()
            .map(|path| Path::new(path).file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, ["a.jpg", "b.PNG", "c.jpeg"]);
    }

    #[test]
    fn editor_photo_keeps_original_detail_and_alpha() {
        let path =
            std::env::temp_dir().join(format!("yingkuang-detail-{}.png", std::process::id()));
        let source = image::RgbaImage::from_fn(3200, 200, |x, _| {
            if x % 4 < 2 {
                image::Rgba([0, 0, 0, 128])
            } else {
                image::Rgba([255, 255, 255, 255])
            }
        });
        source.save(&path).unwrap();
        let encoded = editor_photo(&path).unwrap();
        let decoded =
            image::load_from_memory(&STANDARD.decode(encoded.split_once(',').unwrap().1).unwrap())
                .unwrap()
                .into_rgba8();
        assert_eq!(decoded.dimensions(), source.dimensions());
        assert_eq!(decoded.get_pixel(1600, 100), source.get_pixel(1600, 100));
        assert_eq!(decoded.get_pixel(1602, 100), source.get_pixel(1602, 100));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn editor_photo_jpeg_preserves_exif_orientation() {
        use little_exif::{exif_tag::ExifTag, metadata::Metadata};
        let path =
            std::env::temp_dir().join(format!("yingkuang-orientation-{}.jpg", std::process::id()));
        let source = image::RgbImage::from_fn(80, 40, |x, _| {
            if x < 40 {
                image::Rgb([250, 20, 20])
            } else {
                image::Rgb([20, 20, 250])
            }
        });
        source.save(&path).unwrap();
        let mut metadata = Metadata::new();
        metadata.set_tag(ExifTag::Orientation(vec![6]));
        metadata.write_to_file(&path).unwrap();

        let encoded = editor_photo(&path).unwrap();
        assert!(encoded.starts_with("data:image/jpeg;base64,"));
        let decoded =
            image::load_from_memory(&STANDARD.decode(encoded.split_once(',').unwrap().1).unwrap())
                .unwrap()
                .into_rgb8();
        assert_eq!(decoded.dimensions(), (40, 80));
        let top = decoded.get_pixel(20, 10);
        let bottom = decoded.get_pixel(20, 70);
        assert!(top[0] > top[2], "red half should rotate to top: {top:?}");
        assert!(
            bottom[2] > bottom[0],
            "blue half should rotate to bottom: {bottom:?}"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn editor_photo_converts_embedded_icc_to_srgb() {
        use image::ImageEncoder;
        use lcms2::{CIExyY, CIExyYTRIPLE, Profile, ToneCurve};
        let path = std::env::temp_dir().join(format!("yingkuang-icc-{}.jpg", std::process::id()));
        let point = |x, y| CIExyY { x, y, Y: 1.0 };
        let primaries = CIExyYTRIPLE {
            Red: point(0.64, 0.33),
            Green: point(0.30, 0.60),
            Blue: point(0.15, 0.06),
        };
        let curve = ToneCurve::new(1.0);
        let linear_rgb = Profile::new_rgb(&point(0.3127, 0.3290), &primaries, &[&curve; 3])
            .unwrap()
            .icc()
            .unwrap();
        let source = image::RgbImage::from_pixel(80, 40, image::Rgb([128, 128, 128]));
        let mut bytes = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 95);
        encoder.set_icc_profile(linear_rgb).unwrap();
        encoder.encode_image(&source).unwrap();
        std::fs::write(&path, bytes).unwrap();

        let encoded = editor_photo(&path).unwrap();
        let decoded =
            image::load_from_memory(&STANDARD.decode(encoded.split_once(',').unwrap().1).unwrap())
                .unwrap()
                .into_rgb8();
        let pixel = decoded.get_pixel(40, 20);
        assert!(
            (175..=200).contains(&pixel[0]),
            "linear RGB should become sRGB, got {pixel:?}"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    #[ignore = "local photo performance check; run explicitly with --ignored --nocapture"]
    fn import_latency_budget() {
        let start = std::time::Instant::now();
        let photo = inspect_image(PathBuf::from("../assets/origin/PANA9432.JPG")).unwrap();
        let elapsed = start.elapsed();
        eprintln!("24 MP import: {elapsed:?}");
        assert_eq!((photo.width, photo.height), (6000, 4000));
        assert!(
            elapsed.as_secs_f64() < 2.0,
            "single-photo import exceeded 2s: {elapsed:?}"
        );
    }

    #[test]
    #[ignore = "local 24 MP editing-photo performance check; run explicitly"]
    fn editor_photo_latency_budget() {
        let path = PathBuf::from("../assets/origin/PANA9432.JPG");
        let started = std::time::Instant::now();
        let photo = inspect_image(path.clone()).unwrap();
        let inspected = started.elapsed();
        let source = editor_photo(&path).unwrap();
        let total = started.elapsed();
        eprintln!(
            "24 MP ready: inspect={inspected:?} total={total:?} editor_data_url={} bytes",
            source.len()
        );
        assert_eq!((photo.width, photo.height), (6000, 4000));
        assert!(source.starts_with("data:image/jpeg;base64,"));
        assert!(source.len() < 5_000_000, "editor transfer exceeded 5 MB");
        let editor =
            image::load_from_memory(&STANDARD.decode(source.split_once(',').unwrap().1).unwrap())
                .unwrap();
        assert_eq!(editor.dimensions(), (4096, 2731));
        assert!(
            total.as_secs_f64() < 2.0,
            "24 MP preview exceeded 2s: {total:?}"
        );
    }

    #[test]
    fn imports_jpeg_and_extracts_exif() {
        let root = tempfile::tempdir().unwrap();
        let photo = inspect_image(crate::test_fixtures::jpeg_with_exif(root.path()))
            .expect("fixture should import");

        assert_eq!((photo.width, photo.height), (600, 400));
        assert!(
            photo
                .thumbnail_data_url
                .starts_with("data:image/jpeg;base64,")
        );
        assert_eq!(photo.metadata.focal_length.as_deref(), Some("60mm"));
        assert_eq!(photo.metadata.aperture.as_deref(), Some("f/5.6"));
        assert_eq!(photo.metadata.iso.as_deref(), Some("ISO100"));
        assert_eq!(
            photo.metadata.camera.as_deref(),
            Some("FixtureCamera Model 1")
        );
        assert_eq!(photo.metadata.make.as_deref(), Some("FixtureCamera"));
        assert_eq!(photo.metadata.model.as_deref(), Some("Model 1"));
        assert_eq!(
            photo.metadata.extra.get("exif:Make").map(String::as_str),
            Some("FixtureCamera")
        );
    }

    #[test]
    fn rotates_orientation_six_to_landscape() {
        let image = DynamicImage::new_rgb8(2, 3);
        assert_eq!(apply_orientation(image, 6).dimensions(), (3, 2));
    }
}
