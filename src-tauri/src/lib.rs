use base64::{Engine as _, engine::general_purpose::STANDARD};
use exif::{In, Reader as ExifReader, Tag, Value};
use image::{DynamicImage, GenericImageView, codecs::jpeg::JpegEncoder};
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs::File,
    hash::{Hash, Hasher},
    io::BufReader,
    path::{Path, PathBuf},
};

mod export;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoMetadata {
    camera: Option<String>,
    lens: Option<String>,
    focal_length: Option<String>,
    aperture: Option<String>,
    shutter: Option<String>,
    iso: Option<String>,
    captured_at: Option<String>,
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

#[derive(Default)]
pub(crate) struct ExifSnapshot {
    pub(crate) orientation: u32,
    pub(crate) camera: Option<String>,
    pub(crate) lens: Option<String>,
    pub(crate) focal_length: Option<String>,
    pub(crate) aperture: Option<String>,
    pub(crate) shutter: Option<String>,
    pub(crate) iso: Option<String>,
    pub(crate) captured_at: Option<String>,
}

fn display_field(exif: &exif::Exif, tag: Tag) -> Option<String> {
    exif.get_field(tag, In::PRIMARY)
        .map(|field| field.display_value().with_unit(exif).to_string())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn rational_number(exif: &exif::Exif, tag: Tag) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match &field.value {
        Value::Rational(values) => values.first().map(|value| value.to_f64()),
        _ => None,
    }
}

pub(crate) fn read_exif(path: &Path) -> ExifSnapshot {
    let Ok(file) = File::open(path) else {
        return ExifSnapshot::default();
    };
    let mut reader = BufReader::new(file);
    let Ok(exif) = ExifReader::new().read_from_container(&mut reader) else {
        return ExifSnapshot::default();
    };

    let make = display_field(&exif, Tag::Make);
    let model = display_field(&exif, Tag::Model);
    let camera = match (make, model) {
        (Some(make), Some(model)) if model.to_lowercase().contains(&make.to_lowercase()) => {
            Some(model)
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (Some(make), None) => Some(make),
        (None, model) => model,
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

    ExifSnapshot {
        orientation,
        camera,
        lens: display_field(&exif, Tag::LensModel),
        focal_length,
        aperture,
        shutter: display_field(&exif, Tag::ExposureTime).map(|value| value.replace(' ', "")),
        iso,
        captured_at: display_field(&exif, Tag::DateTimeOriginal),
    }
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
        file_name,
        width,
        height,
        megapixels: (width as f64 * height as f64) / 1_000_000.0,
        thumbnail_data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)),
        metadata: PhotoMetadata {
            camera: exif.camera,
            lens: exif.lens,
            focal_length: exif.focal_length,
            aperture: exif.aperture,
            shutter: exif.shutter,
            iso: exif.iso,
            captured_at: exif.captured_at,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            inspect_images,
            inspect_images_resilient,
            load_editor_photo,
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
    fn imports_real_jpeg_and_extracts_exif() {
        let photo = inspect_image(PathBuf::from("../assets/origin/PANA9432.JPG"))
            .expect("fixture should import");

        assert_eq!((photo.width, photo.height), (6000, 4000));
        assert!(
            photo
                .thumbnail_data_url
                .starts_with("data:image/jpeg;base64,")
        );
        assert_eq!(photo.metadata.focal_length.as_deref(), Some("60mm"));
        assert_eq!(photo.metadata.aperture.as_deref(), Some("f/5.6"));
        assert_eq!(photo.metadata.iso.as_deref(), Some("ISO100"));
    }

    #[test]
    fn rotates_orientation_six_to_landscape() {
        let image = DynamicImage::new_rgb8(2, 3);
        assert_eq!(apply_orientation(image, 6).dimensions(), (3, 2));
    }
}
