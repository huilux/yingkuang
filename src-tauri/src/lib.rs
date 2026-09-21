use base64::{Engine as _, engine::general_purpose::STANDARD};
use exif::{In, Reader as ExifReader, Tag, Value};
use image::{DynamicImage, GenericImageView, ImageReader, codecs::jpeg::JpegEncoder};
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
    let image = ImageReader::open(&path)
        .map_err(|error| format!("无法打开图片：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("无法识别图片格式：{error}"))?
        .decode()
        .map_err(|error| format!("无法解码图片：{error}"))?;
    let image = apply_orientation(image, exif.orientation);
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
