use crate::{ExifSnapshot, apply_orientation, read_exif};
use ab_glyph::{Font, FontArc, PxScale, ScaleFont};
use image::{
    DynamicImage, ImageDecoder, ImageEncoder, ImageReader, Pixel, Rgba, RgbaImage,
    codecs::{
        jpeg::JpegEncoder,
        png::{CompressionType, FilterType as PngFilterType, PngEncoder},
    },
    imageops::{self, FilterType},
};
use imageproc::drawing::{draw_text_mut, text_size};
use lcms2::{Intent, PixelFormat, Profile, Transform};
use little_exif::{exif_tag::ExifTag, ifd::ExifTagGroup, metadata::Metadata};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufWriter, ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Emitter};

static CANCEL_EXPORT: AtomicBool = AtomicBool::new(false);
static EXPORT_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    items: Vec<ExportItem>,
    settings: ExportSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportItem {
    path: String,
    document: EditorDocument,
    #[serde(default)]
    overrides: HashMap<String, String>,
    #[serde(default)]
    output_suffix: Option<String>,
    #[serde(default)]
    crop: Option<PhotoCrop>,
}

#[derive(Debug, Clone, Deserialize)]
struct PhotoCrop {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    rotation: f64,
}

fn normalized_rotation(rotation: f64) -> Result<f64, String> {
    if !rotation.is_finite() || rotation.abs() > 180.0 {
        return Err("旋转角度无效，请使用 -180° 至 180° 之间的角度".into());
    }
    let angle = (rotation + 180.0).rem_euclid(360.0) - 180.0;
    Ok((angle * 1_000_000.0 + 0.5).floor() / 1_000_000.0)
}

fn rotation_dimensions(width: u32, height: u32, rotation: f64) -> Result<(u32, u32), String> {
    let rotation = normalized_rotation(rotation)?;
    let quarter = (rotation / 90.0).round() as i32;
    let fine = (rotation - f64::from(quarter) * 90.0).abs().to_radians();
    let (w, h) = if quarter.abs() % 2 == 1 {
        (height, width)
    } else {
        (width, height)
    };
    if fine < 1e-10 {
        return Ok((w, h));
    }
    let (w, h) = (f64::from(w), f64::from(h));
    let (sin, cos) = fine.sin_cos();
    let (shorter, longer) = (w.min(h), w.max(h));
    let (rw, rh) = if shorter <= 2.0 * sin * cos * longer || (sin - cos).abs() < 1e-10 {
        (
            shorter / 2.0 / if w >= h { sin } else { cos },
            shorter / 2.0 / if w >= h { cos } else { sin },
        )
    } else {
        let cos2 = cos * cos - sin * sin;
        ((w * cos - h * sin) / cos2, (h * cos - w * sin) / cos2)
    };
    Ok((
        ((rw + 1e-9).floor() as u32).max(1),
        ((rh + 1e-9).floor() as u32).max(1),
    ))
}

// Coordinates refer to the orientation-corrected, rotated safe rectangle. Keep this nearest-edge
// rounding in sync with photo-crop.ts; even a subpixel selection retains one pixel.
fn crop_rectangle(
    width: u32,
    height: u32,
    crop: Option<&PhotoCrop>,
) -> Result<(u32, u32, u32, u32), String> {
    let (width, height) = rotation_dimensions(width, height, crop.map_or(0.0, |c| c.rotation))?;
    let Some(crop) = crop else {
        return Ok((0, 0, width, height));
    };
    if width == 0
        || height == 0
        || ![crop.x, crop.y, crop.width, crop.height]
            .iter()
            .all(|v| v.is_finite())
        || crop.x < 0.0
        || crop.y < 0.0
        || crop.width <= 0.0
        || crop.height <= 0.0
        || crop.x + crop.width > 1.0 + 1e-9
        || crop.y + crop.height > 1.0 + 1e-9
    {
        return Err("裁切区域无效，请重新选择照片区域".into());
    }
    let x = ((crop.x * f64::from(width)).round() as u32).min(width - 1);
    let y = ((crop.y * f64::from(height)).round() as u32).min(height - 1);
    let right = (((crop.x + crop.width) * f64::from(width)).round() as u32).clamp(x + 1, width);
    let bottom = (((crop.y + crop.height) * f64::from(height)).round() as u32).clamp(y + 1, height);
    Ok((x, y, right - x, bottom - y))
}

fn transform_photo(source: RgbaImage, crop: Option<&PhotoCrop>) -> Result<RgbaImage, String> {
    let (width, height) = source.dimensions();
    let (x, y, crop_width, crop_height) = crop_rectangle(width, height, crop)?;
    let angle = normalized_rotation(crop.map_or(0.0, |c| c.rotation))?;
    // Quarter turns are pixel permutations: preserve exact detail and alpha.
    if (angle % 90.0).abs() < 1e-10 {
        let turned = match ((angle / 90.0).round() as i32).rem_euclid(4) {
            1 => imageops::rotate90(&source),
            2 => imageops::rotate180(&source),
            3 => imageops::rotate270(&source),
            _ => source,
        };
        return Ok(
            if (x, y, crop_width, crop_height) == (0, 0, turned.width(), turned.height()) {
                turned
            } else {
                imageops::crop_imm(&turned, x, y, crop_width, crop_height).to_image()
            },
        );
    }
    let (rotated_width, rotated_height) = rotation_dimensions(width, height, angle)?;
    let (sin, cos) = angle.to_radians().sin_cos();
    // Sample only the final selected rectangle, avoiding a full rotated allocation.
    // Interpolate premultiplied alpha to prevent dark fringes on transparent PNGs.
    Ok(RgbaImage::from_fn(crop_width, crop_height, |px, py| {
        let dx = f64::from(x + px) + 0.5 - f64::from(rotated_width) / 2.0;
        let dy = f64::from(y + py) + 0.5 - f64::from(rotated_height) / 2.0;
        let sx =
            (cos * dx + sin * dy + f64::from(width) / 2.0 - 0.5).clamp(0.0, f64::from(width - 1));
        let sy = (-sin * dx + cos * dy + f64::from(height) / 2.0 - 0.5)
            .clamp(0.0, f64::from(height - 1));
        let (x0, y0) = (sx.floor() as u32, sy.floor() as u32);
        let (fx, fy) = (sx - f64::from(x0), sy - f64::from(y0));
        let mut channels = [0.0_f64; 4];
        for (xx, yy, weight) in [
            (x0, y0, (1.0 - fx) * (1.0 - fy)),
            ((x0 + 1).min(width - 1), y0, fx * (1.0 - fy)),
            (x0, (y0 + 1).min(height - 1), (1.0 - fx) * fy),
            ((x0 + 1).min(width - 1), (y0 + 1).min(height - 1), fx * fy),
        ] {
            let pixel = source.get_pixel(xx, yy).0;
            let alpha = f64::from(pixel[3]) * weight;
            for channel in 0..3 {
                channels[channel] += f64::from(pixel[channel]) * alpha;
            }
            channels[3] += alpha;
        }
        if channels[3] <= 0.0 {
            return Rgba([0, 0, 0, 0]);
        }
        Rgba([
            (channels[0] / channels[3]).round() as u8,
            (channels[1] / channels[3]).round() as u8,
            (channels[2] / channels[3]).round() as u8,
            channels[3].round() as u8,
        ])
    }))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportSettings {
    directory: String,
    format: String,
    quality: u8,
    size: String,
    long_edge: u32,
    #[serde(default)]
    no_upscale: bool,
    metadata: String,
    include_gps: bool,
    suffix: String,
    collision: String,
    #[serde(default = "default_png_compression")]
    png_compression: String,
}

fn default_png_compression() -> String {
    "standard".to_owned()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorDocument {
    frame: FrameSettings,
    regions: Regions,
    layers: Vec<WatermarkLayer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameSettings {
    #[serde(rename = "type")]
    frame_type: String,
    color: String,
    blur: f32,
    brightness: f32,
    padding_x: f32,
    padding_y: f32,
    radius: f32,
    shadow: f32,
}

#[derive(Debug, Clone, Deserialize)]
struct Regions {
    top: RegionSettings,
    bottom: RegionSettings,
    left: RegionSettings,
    right: RegionSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegionSettings {
    enabled: bool,
    extra: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatermarkLayer {
    name: String,
    source: String,
    custom_value: String,
    region: String,
    x: f32,
    y: f32,
    font_family: String,
    font_size: f32,
    font_weight: u16,
    color: String,
    opacity: f32,
    rotation: i32,
    visible: bool,
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Clone)]
struct Geometry {
    width: f32,
    height: f32,
    photo: Rect,
    regions: HashMap<&'static str, Rect>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    current: usize,
    completed: usize,
    total: usize,
    file_name: String,
    succeeded: usize,
    failed: usize,
    skipped: usize,
    stage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFailure {
    file_name: String,
    path: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    elapsed_ms: u64,
    total: usize,
    succeeded: usize,
    failed: usize,
    skipped: usize,
    cancelled: bool,
    output_directory: String,
    failures: Vec<ExportFailure>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreflight {
    ready: bool,
    total: usize,
    estimated_pixels: u64,
    largest_width: u32,
    largest_height: u32,
    largest_file_name: String,
    errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Default)]
struct ExportRenderer {
    fonts: HashMap<String, FontArc>,
}

struct ExportGuard;

impl Drop for ExportGuard {
    fn drop(&mut self) {
        EXPORT_RUNNING.store(false, Ordering::SeqCst);
    }
}

fn calculate_geometry(width: u32, height: u32, document: &EditorDocument) -> Geometry {
    let ratio = width as f32 / height as f32;
    let (photo_width, photo_height) = if ratio >= 1.0 {
        (ratio * 1000.0, 1000.0)
    } else {
        (1000.0, 1000.0 / ratio)
    };
    let horizontal = document.frame.padding_x * 10.0;
    let vertical = document.frame.padding_y * 10.0;
    let left_extra = if document.regions.left.enabled {
        document.regions.left.extra * 10.0
    } else {
        0.0
    };
    let right_extra = if document.regions.right.enabled {
        document.regions.right.extra * 10.0
    } else {
        0.0
    };
    let top_extra = if document.regions.top.enabled {
        document.regions.top.extra * 10.0
    } else {
        0.0
    };
    let bottom_extra = if document.regions.bottom.enabled {
        document.regions.bottom.extra * 10.0
    } else {
        0.0
    };
    let canvas_width = photo_width + horizontal * 2.0 + left_extra + right_extra;
    let canvas_height = photo_height + vertical * 2.0 + top_extra + bottom_extra;
    let photo = Rect {
        x: horizontal + left_extra,
        y: vertical + top_extra,
        width: photo_width,
        height: photo_height,
    };
    let mut regions = HashMap::new();
    regions.insert(
        "canvas",
        Rect {
            x: 0.0,
            y: 0.0,
            width: canvas_width,
            height: canvas_height,
        },
    );
    regions.insert(
        "top",
        Rect {
            x: 0.0,
            y: 0.0,
            width: canvas_width,
            height: photo.y,
        },
    );
    regions.insert(
        "bottom",
        Rect {
            x: 0.0,
            y: photo.y + photo.height,
            width: canvas_width,
            height: canvas_height - photo.y - photo.height,
        },
    );
    regions.insert(
        "left",
        Rect {
            x: 0.0,
            y: photo.y,
            width: photo.x,
            height: photo.height,
        },
    );
    regions.insert(
        "right",
        Rect {
            x: photo.x + photo.width,
            y: photo.y,
            width: canvas_width - photo.x - photo.width,
            height: photo.height,
        },
    );
    Geometry {
        width: canvas_width,
        height: canvas_height,
        photo,
        regions,
    }
}

fn output_scale(source_width: u32, geometry: &Geometry, settings: &ExportSettings) -> f32 {
    let original = source_width as f32 / geometry.photo.width;
    if settings.size != "long-edge" {
        return original;
    }
    let requested = settings.long_edge as f32 / geometry.width.max(geometry.height);
    if settings.no_upscale {
        requested.min(original)
    } else {
        requested
    }
}

fn output_dimensions(
    width: u32,
    height: u32,
    document: &EditorDocument,
    settings: &ExportSettings,
) -> (u32, u32) {
    let geometry = calculate_geometry(width, height, document);
    let scale = output_scale(width, &geometry, settings);
    (
        (geometry.width * scale).round().max(1.0) as u32,
        (geometry.height * scale).round().max(1.0) as u32,
    )
}

fn validate_export_settings(settings: &ExportSettings) -> Vec<String> {
    let mut errors = Vec::new();
    if !matches!(settings.format.as_str(), "jpeg" | "png") {
        errors.push("不支持的导出格式".to_owned());
    }
    if !matches!(settings.size.as_str(), "original" | "long-edge") {
        errors.push("不支持的成品尺寸模式".to_owned());
    }
    if settings.size == "long-edge" && !(800..=30_000).contains(&settings.long_edge) {
        errors.push("成品长边须为 800–30000 之间的整数".to_owned());
    }
    if !(1..=100).contains(&settings.quality) {
        errors.push("JPEG 质量须为 1–100 之间的整数".to_owned());
    }
    if settings.suffix.chars().count() > 80
        || settings
            .suffix
            .chars()
            .any(|character| character.is_control() || r#"<>:"/\|?*"#.contains(character))
    {
        errors.push("文件名后缀不能包含路径或系统保留字符，且最多 80 个字符".to_owned());
    }
    if !matches!(settings.collision.as_str(), "number" | "skip") {
        errors.push("不支持的重名处理方式".to_owned());
    }
    if !matches!(settings.metadata.as_str(), "none" | "basic" | "supported") {
        errors.push("不支持的元数据保留方式".to_owned());
    }
    if !matches!(
        settings.png_compression.as_str(),
        "fast" | "standard" | "small"
    ) {
        errors.push("不支持的 PNG 压缩方式".to_owned());
    }
    errors
}

// Keep the supported 96 MP photos plus framing within the budget while
// rejecting accidental multi-gigabyte canvases before allocating them.
const MAX_OUTPUT_PIXELS: u64 = 256_000_000;
const MAX_TEXT_PIXELS: u64 = 64_000_000;

fn validate_output_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 30_000
        || height > 30_000
        || width as u64 * height as u64 > MAX_OUTPUT_PIXELS
    {
        return Err(format!(
            "成品 {width} × {height} px 超出限制：单边最多 30000，像素总数最多 2.56 亿；请降低成品长边或边框尺寸"
        ));
    }
    Ok(())
}

fn validate_document(document: &EditorDocument) -> Result<(), String> {
    let frame = &document.frame;
    let bounded = |value: f32, maximum: f32| value.is_finite() && (0.0..=maximum).contains(&value);
    let color = |value: &str| {
        value.len() == 7
            && value.starts_with('#')
            && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    };
    if !matches!(frame.frame_type.as_str(), "solid" | "blur")
        || !color(&frame.color)
        || !bounded(frame.blur, 200.0)
        || !bounded(frame.brightness, 200.0)
        || !bounded(frame.padding_x, 100.0)
        || !bounded(frame.padding_y, 100.0)
        || !bounded(frame.radius, 100.0)
        || !bounded(frame.shadow, 100.0)
    {
        return Err("边框参数超出支持范围，请检查模板".into());
    }
    if [
        &document.regions.top,
        &document.regions.bottom,
        &document.regions.left,
        &document.regions.right,
    ]
    .iter()
    .any(|region| !bounded(region.extra, 100.0))
    {
        return Err("区域尺寸超出支持范围，请检查模板".into());
    }
    if document.layers.len() > 100 {
        return Err("每张照片最多支持 100 个文字图层".into());
    }
    for layer in &document.layers {
        if !layer.x.is_finite()
            || !layer.y.is_finite()
            || !layer.font_size.is_finite()
            || !(1.0..=1000.0).contains(&layer.font_size)
            || !bounded(layer.opacity, 1.0)
            || !color(&layer.color)
            || layer.custom_value.chars().count() > 2000
            || layer.font_family.len() > 800
            || !matches!(layer.rotation, -90 | 0 | 90)
            || !matches!(
                layer.region.as_str(),
                "canvas" | "top" | "bottom" | "left" | "right"
            )
        {
            return Err(format!(
                "文字图层“{}”的参数超出支持范围，请检查模板",
                layer.name
            ));
        }
    }
    Ok(())
}

fn validate_export_request(request: &ExportRequest) -> Vec<String> {
    let mut errors = validate_export_settings(&request.settings);
    if request.items.is_empty() {
        errors.push("当前范围没有可导出的本地照片".to_owned());
    }
    for item in &request.items {
        if let Some(suffix) = &item.output_suffix {
            let mut settings = request.settings.clone();
            settings.suffix.clone_from(suffix);
            errors.extend(validate_export_settings(&settings));
        }
        if let Err(error) = validate_document(&item.document) {
            errors.push(format!(
                "{}：{error}",
                Path::new(&item.path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ));
        }
    }
    let directory = Path::new(&request.settings.directory);
    if !directory.is_dir() {
        errors.push("输出文件夹不存在".to_owned());
    } else if let Err(error) = tempfile::NamedTempFile::new_in(directory) {
        errors.push(format!("输出文件夹不可写：{error}"));
    }
    errors
}

fn preflight_export_sync(request: &ExportRequest) -> ExportPreflight {
    let mut errors = validate_export_request(request);
    let mut estimated_pixels = 0_u64;
    let mut largest_width = 0;
    let mut largest_height = 0;
    let mut largest_file_name = String::new();
    let mut reserved_outputs = HashSet::new();
    let mut checked_fonts = HashMap::new();
    let mut file_name_counts = HashMap::new();
    for item in &request.items {
        let name = Path::new(&item.path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名照片");
        *file_name_counts.entry(name).or_insert(0_usize) += 1;
    }
    for item in &request.items {
        if errors.len() >= 20 {
            errors.truncate(20);
            errors.push("其余预检错误已省略，请先处理以上项目".to_owned());
            break;
        }
        let path = Path::new(&item.path);
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名照片");
        let error_name = if file_name_counts[file_name] > 1 {
            item.path.as_str()
        } else {
            file_name
        };
        if !path.is_file() {
            errors.push(format!("{error_name}：原图不存在或不可读取"));
            continue;
        }
        for layer in
            item.document.layers.iter().filter(|layer| {
                layer.visible && region_enabled(&layer.region, &item.document.regions)
            })
        {
            if layer.font_family.starts_with("YingkuangFont")
                && let Err(error) =
                    load_font(&layer.font_family, layer.font_weight, &mut checked_fonts)
            {
                errors.push(format!("{error_name}：{}：{error}", layer.name));
                break;
            }
        }
        let mut item_settings = request.settings.clone();
        if let Some(suffix) = &item.output_suffix {
            item_settings.suffix.clone_from(suffix);
        }
        match unique_output_path_with_reserved(path, &item_settings, &reserved_outputs) {
            Ok(Some(output)) => {
                reserved_outputs.insert(output);
            }
            Ok(None) => {}
            Err(error) => {
                errors.push(format!("{error_name}：{error}"));
                continue;
            }
        }
        let (mut width, mut height) = match image::image_dimensions(path) {
            Ok(dimensions) => dimensions,
            Err(error) => {
                errors.push(format!("{error_name}：无法读取图片尺寸（{error}）"));
                continue;
            }
        };
        if matches!(read_exif(path).orientation, 5..=8) {
            std::mem::swap(&mut width, &mut height);
        }
        let (_, _, width, height) = match crop_rectangle(width, height, item.crop.as_ref()) {
            Ok(rect) => rect,
            Err(error) => {
                errors.push(format!("{error_name}：{error}"));
                continue;
            }
        };
        let (output_width, output_height) =
            output_dimensions(width, height, &item.document, &request.settings);
        if let Err(error) = validate_output_dimensions(output_width, output_height) {
            errors.push(format!("{error_name}：{error}"));
        }
        let pixels = output_width as u64 * output_height as u64;
        estimated_pixels = estimated_pixels.saturating_add(pixels);
        if pixels > largest_width as u64 * largest_height as u64 {
            largest_width = output_width;
            largest_height = output_height;
            largest_file_name = file_name.to_owned();
        }
    }
    let mut warnings = Vec::new();
    let largest_pixels = largest_width as u64 * largest_height as u64;
    if largest_pixels > 80_000_000 {
        warnings.push(format!(
            "最大成品 {largest_width} × {largest_height} px，导出时会占用较多内存"
        ));
    }
    ExportPreflight {
        ready: errors.is_empty(),
        total: request.items.len(),
        estimated_pixels,
        largest_width,
        largest_height,
        largest_file_name,
        errors,
        warnings,
    }
}

fn parse_color(value: &str, alpha: u8) -> Rgba<u8> {
    let value = value.trim_start_matches('#');
    if value.len() == 6 && value.is_ascii() {
        let red = u8::from_str_radix(&value[0..2], 16).unwrap_or(255);
        let green = u8::from_str_radix(&value[2..4], 16).unwrap_or(255);
        let blue = u8::from_str_radix(&value[4..6], 16).unwrap_or(255);
        Rgba([red, green, blue, alpha])
    } else {
        Rgba([255, 255, 255, alpha])
    }
}

pub(crate) fn decode_color_managed(path: &Path, orientation: u32) -> Result<RgbaImage, String> {
    let reader = ImageReader::open(path)
        .map_err(|error| format!("无法打开图片：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("无法识别图片格式：{error}"))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("无法创建图片解码器：{error}"))?;
    let profile = decoder
        .icc_profile()
        .map_err(|error| format!("无法读取 ICC 色彩配置：{error}"))?;
    let image =
        DynamicImage::from_decoder(decoder).map_err(|error| format!("无法解码图片：{error}"))?;
    let mut image = apply_orientation(image, orientation).into_rgba8();
    if let Some(profile) = profile.filter(|profile| !profile.is_empty()) {
        let input = Profile::new_icc(&profile)
            .map_err(|error| format!("无法解析输入 ICC 色彩配置：{error}"))?;
        let output = Profile::new_srgb();
        let transform = Transform::<u8, u8>::new(
            &input,
            PixelFormat::RGBA_8,
            &output,
            PixelFormat::RGBA_8,
            Intent::Perceptual,
        )
        .map_err(|error| format!("无法创建 sRGB 色彩转换：{error}"))?;
        transform.transform_in_place(image.as_mut());
    }
    Ok(image)
}

fn resize_to_fill(image: &RgbaImage, width: u32, height: u32) -> RgbaImage {
    let scale = (width as f64 / image.width() as f64).max(height as f64 / image.height() as f64);
    let resized_width = (image.width() as f64 * scale).ceil() as u32;
    let resized_height = (image.height() as f64 * scale).ceil() as u32;
    let resized = imageops::resize(image, resized_width, resized_height, FilterType::Triangle);
    let x = (resized_width.saturating_sub(width)) / 2;
    let y = (resized_height.saturating_sub(height)) / 2;
    imageops::crop_imm(&resized, x, y, width, height).to_image()
}

fn background_overscan(width: u32, height: u32, blur: f32) -> u32 {
    let short_edge = width.min(height) as f32;
    (short_edge * 0.08)
        .max(blur * 3.0)
        .min(short_edge * 0.25)
        .ceil() as u32
}

fn srgb_to_linear(value: u8) -> f32 {
    let value = value as f32 / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(value: f32) -> f32 {
    let value = value.clamp(0.0, 1.0);
    (if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }) * 255.0
}

// Enlargement needs only the two neighbours on each axis. Precompute their
// positions once rather than rebuilding a general resampling kernel per pixel.
// This path is for the already blurred background; photo resizing keeps its
// antialiasing filter for downsampling and Lanczos for near-size output.
fn upscale_background(source: RgbaImage, width: u32, height: u32) -> RgbaImage {
    if source.dimensions() == (width, height) {
        return source;
    }
    let columns = interpolation_axis(source.width(), width);
    let rows = interpolation_axis(source.height(), height);
    let mut output = RgbaImage::new(width, height);
    let stride = source.width() as usize * 4;
    let pixels = source.as_raw();
    for (target, &(top, bottom, fy)) in output
        .as_mut()
        .chunks_exact_mut(width as usize * 4)
        .zip(&rows)
    {
        let upper = &pixels[top * stride..(top + 1) * stride];
        let lower = &pixels[bottom * stride..(bottom + 1) * stride];
        for (pixel, &(left, right, fx)) in target.chunks_exact_mut(4).zip(&columns) {
            for channel in 0..4 {
                let a = upper[left * 4 + channel] as f32;
                let b = upper[right * 4 + channel] as f32;
                let c = lower[left * 4 + channel] as f32;
                let d = lower[right * 4 + channel] as f32;
                let top = a + (b - a) * fx;
                let bottom = c + (d - c) * fx;
                pixel[channel] = (top + (bottom - top) * fy).round() as u8;
            }
        }
    }
    output
}

fn interpolation_axis(source: u32, target: u32) -> Vec<(usize, usize, f32)> {
    let ratio = source as f32 / target as f32;
    interpolation_axis_at_scale(source, target, ratio)
}

fn interpolation_axis_at_scale(source: u32, target: u32, ratio: f32) -> Vec<(usize, usize, f32)> {
    (0..target)
        .map(|position| {
            let coordinate =
                ((position as f32 + 0.5) * ratio - 0.5).clamp(0.0, (source - 1) as f32);
            let left = coordinate.floor() as usize;
            (
                left,
                (left + 1).min(source as usize - 1),
                coordinate - left as f32,
            )
        })
        .collect()
}

fn make_blurred_background(
    source: &RgbaImage,
    width: u32,
    height: u32,
    blur: f32,
    brightness: f32,
    base: Rgba<u8>,
) -> RgbaImage {
    let preview_scale = (1800.0 / width.max(height) as f32).min(1.0);
    let small_width = (width as f32 * preview_scale).max(1.0).round() as u32;
    let small_height = (height as f32 * preview_scale).max(1.0).round() as u32;
    let small_blur = blur * preview_scale;
    let overscan = background_overscan(small_width, small_height, small_blur);
    let filled = resize_to_fill(
        source,
        small_width.saturating_add(overscan * 2),
        small_height.saturating_add(overscan * 2),
    );
    // SVG filters run in linearRGB. Blur premultiplied linear light and apply
    // brightness there, then return to sRGB before the dark overlay.
    let linear = image::Rgba32FImage::from_fn(filled.width(), filled.height(), |x, y| {
        let pixel = filled.get_pixel(x, y);
        let alpha = pixel[3] as f32 / 255.0;
        Rgba([
            srgb_to_linear(pixel[0]) * alpha,
            srgb_to_linear(pixel[1]) * alpha,
            srgb_to_linear(pixel[2]) * alpha,
            alpha,
        ])
    });
    let filtered = if small_blur >= 4.0 {
        imageops::fast_blur(&linear, small_blur)
    } else if small_blur > 0.0 {
        imageops::blur(&linear, small_blur)
    } else {
        linear
    };
    let brightness = brightness / 100.0;
    let blurred = RgbaImage::from_fn(small_width, small_height, |x, y| {
        let pixel = filtered.get_pixel(x + overscan, y + overscan);
        let alpha = pixel[3];
        let mut result = [0, 0, 0, 255];
        for (channel, overlay) in [16.0, 19.0, 18.0].into_iter().enumerate() {
            let light = if alpha > 0.0 {
                pixel[channel] / alpha * brightness
            } else {
                0.0
            };
            let composited = linear_to_srgb(light) * alpha + base[channel] as f32 * (1.0 - alpha);
            result[channel] = (composited * 0.92 + overlay * 0.08).round() as u8;
        }
        Rgba(result)
    });
    upscale_background(blurred, width, height)
}

fn rounded_contains(x: u32, y: u32, width: u32, height: u32, radius: u32) -> bool {
    if radius == 0 || (x >= radius && x + radius < width) || (y >= radius && y + radius < height) {
        return true;
    }
    let corner_x = if x < radius {
        radius
    } else {
        width.saturating_sub(radius + 1)
    };
    let corner_y = if y < radius {
        radius
    } else {
        height.saturating_sub(radius + 1)
    };
    let dx = x as i64 - corner_x as i64;
    let dy = y as i64 - corner_y as i64;
    dx * dx + dy * dy <= radius as i64 * radius as i64
}

fn apply_rounded_corners(image: &mut RgbaImage, radius: u32) {
    if radius == 0 {
        return;
    }
    let radius = radius.min(image.width() / 2).min(image.height() / 2);
    for y in 0..radius {
        for x in 0..radius {
            if !rounded_contains(x, y, image.width(), image.height(), radius) {
                image.get_pixel_mut(x, y).0[3] = 0;
                image.get_pixel_mut(image.width() - 1 - x, y).0[3] = 0;
                image.get_pixel_mut(x, image.height() - 1 - y).0[3] = 0;
                image
                    .get_pixel_mut(image.width() - 1 - x, image.height() - 1 - y)
                    .0[3] = 0;
            }
        }
    }
}

fn draw_soft_shadow(canvas: &mut RgbaImage, rect: Rect, scale: f32, amount: f32, radius: f32) {
    if amount <= 0.0 {
        return;
    }
    // Match the SVG alpha-mask Gaussian shadow. Bound the working mask instead
    // of allocating an extra full-resolution RGBA image during large exports.
    let work_scale = (1800.0 / canvas.width().max(canvas.height()) as f32).min(1.0);
    let width = (canvas.width() as f32 * work_scale).round().max(1.0) as u32;
    let height = (canvas.height() as f32 * work_scale).round().max(1.0) as u32;
    let s = scale * work_scale;
    let left = rect.x * s;
    let top = (rect.y + amount * 0.28) * s;
    let right = left + rect.width * s;
    let bottom = top + rect.height * s;
    let radius = (radius * s)
        .min((right - left) / 2.0)
        .min((bottom - top) / 2.0);
    let mask = image::GrayImage::from_fn(width, height, |x, y| {
        // Four subpixel samples keep rounded edges stable at preview sizes.
        let mut coverage = 0;
        for dy in [0.25, 0.75] {
            for dx in [0.25, 0.75] {
                let px = x as f32 + dx;
                let py = y as f32 + dy;
                if px < left || px > right || py < top || py > bottom {
                    continue;
                }
                let cx = px.clamp(left + radius, right - radius);
                let cy = py.clamp(top + radius, bottom - radius);
                if (px - cx).powi(2) + (py - cy).powi(2) <= radius * radius {
                    coverage += 1;
                }
            }
        }
        image::Luma([(coverage as f32 * 255.0 / 4.0).round() as u8])
    });
    let mask = imageops::blur(&mask, (amount * 0.42 * s).max(0.1));
    // Keep subtle presets unchanged, but let the upper range deepen the shadow.
    let opacity = (amount / 100.0).min(0.9);
    composite_shadow(canvas, &mask, work_scale, opacity);
}

fn composite_shadow(canvas: &mut RgbaImage, mask: &image::GrayImage, scale: f32, opacity: f32) {
    let alphas: [u8; 256] =
        std::array::from_fn(|sample| (sample as f32 / 255.0 * opacity * 255.0).round() as u8);
    let columns = interpolation_axis_at_scale(mask.width(), canvas.width(), scale);
    let rows = interpolation_axis_at_scale(mask.height(), canvas.height(), scale);
    let stride = mask.width() as usize;
    let target_stride = canvas.width() as usize * 4;
    let samples = mask.as_raw();
    for (target, &(top, bottom, fy)) in canvas.as_mut().chunks_exact_mut(target_stride).zip(&rows) {
        let upper = &samples[top * stride..(top + 1) * stride];
        let lower = &samples[bottom * stride..(bottom + 1) * stride];
        for (pixel, &(left, right, fx)) in target.chunks_exact_mut(4).zip(&columns) {
            let sample = ((1.0 - fx) * (1.0 - fy) * upper[left] as f32
                + (1.0 - fx) * fy * lower[left] as f32
                + fx * (1.0 - fy) * upper[right] as f32
                + fx * fy * lower[right] as f32)
                .round();
            let alpha = alphas[sample as usize];
            if alpha == 0 {
                continue;
            }
            if pixel[3] == 255 {
                // The frame is opaque. Integer source-over avoids converting
                // four channels to premultiplied floats for every output pixel.
                for (channel, shadow) in [7_u16, 9, 9].into_iter().enumerate() {
                    pixel[channel] = ((pixel[channel] as u16 * (255 - alpha as u16)
                        + shadow * alpha as u16)
                        / 255) as u8;
                }
            } else {
                image::Pixel::blend(Rgba::from_slice_mut(pixel), &Rgba([7, 9, 9, alpha]));
            }
        }
    }
}

fn region_enabled(region: &str, regions: &Regions) -> bool {
    match region {
        "top" => regions.top.enabled,
        "bottom" => regions.bottom.enabled,
        "left" => regions.left.enabled,
        "right" => regions.right.enabled,
        _ => true,
    }
}

fn resolve_text(
    layer: &WatermarkLayer,
    exif: &ExifSnapshot,
    overrides: &HashMap<String, String>,
) -> Option<String> {
    if layer.source == "custom" {
        return (!layer.custom_value.trim().is_empty()).then(|| layer.custom_value.clone());
    }
    if let Some(value) = overrides.get(&layer.source) {
        return (!value.trim().is_empty()).then(|| format_layer_value(&layer.source, value));
    }
    let value = match layer.source.as_str() {
        "camera" => exif.camera.clone(),
        "make" => exif.make.clone(),
        "model" => exif.model.clone(),
        "lens" => exif.lens.clone(),
        "focalLength" => exif.focal_length.clone(),
        "aperture" => exif.aperture.clone(),
        "shutter" => exif.shutter.clone(),
        "iso" => exif.iso.clone(),
        "capturedAt" => exif.captured_at.clone(),
        "capturedDate" => exif.captured_date.clone(),
        "capturedTime" => exif.captured_time.clone(),
        "exposureBias" => exif.exposure_bias.clone(),
        "whiteBalance" => exif.white_balance.clone(),
        "meteringMode" => exif.metering_mode.clone(),
        "exposureProgram" => exif.exposure_program.clone(),
        "focalLength35mm" => exif.focal_length_35mm.clone(),
        "artist" => exif.artist.clone(),
        "copyright" => exif.copyright.clone(),
        "fileName" => exif.file_name.clone(),
        "dimensions" => exif.dimensions.clone(),
        source => exif.extra.get(source).cloned(),
    };
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| format_layer_value(&layer.source, &value))
}

fn format_layer_value(source: &str, value: &str) -> String {
    if source != "capturedAt" {
        return value.to_owned();
    }
    let value = value.trim();
    let Some((date, rest)) = value.split_once(' ') else {
        return value.replacen(':', "-", 2);
    };
    format!("{} {rest}", date.replacen(':', "-", 2))
}

fn load_font(
    family: &str,
    weight: u16,
    cache: &mut HashMap<String, FontArc>,
) -> Result<FontArc, String> {
    let cache_key = format!("{family}-{weight}");
    if let Some(font) = cache.get(&cache_key) {
        return Ok(font.clone());
    }
    let requested = family.split(',').next().unwrap_or("sans-serif").trim();
    let font = crate::fonts::managed_font(requested, weight).ok_or_else(|| {
        format!("不支持字体 {requested}，请在水印面板选择内置字体或导入原字体文件")
    })??;
    cache.insert(cache_key, font.clone());
    Ok(font)
}

fn draw_layers(
    canvas: &mut RgbaImage,
    item: &ExportItem,
    exif: &ExifSnapshot,
    geometry: &Geometry,
    scale: f32,
    fonts: &mut HashMap<String, FontArc>,
) -> Result<(), String> {
    for layer in &item.document.layers {
        if !layer.visible || !region_enabled(&layer.region, &item.document.regions) {
            continue;
        }
        let Some(text) = resolve_text(layer, exif, &item.overrides) else {
            continue;
        };
        if text.chars().count() > 2000 {
            return Err(format!(
                "文字图层“{}”超过 2000 个字符，请缩短显示值",
                layer.name
            ));
        }
        let bounds = geometry
            .regions
            .get(layer.region.as_str())
            .unwrap_or(&geometry.regions["canvas"]);
        let center_x = (bounds.x + bounds.width * layer.x) * scale;
        let center_y = (bounds.y + bounds.height * layer.y) * scale;
        let font = load_font(&layer.font_family, layer.font_weight, fonts)
            .map_err(|error| format!("{}：{error}", layer.name))?;
        let font_scale = css_font_scale(&font, (layer.font_size * scale).max(1.0));
        // Use the same Chinese fallback as the browser when a Latin/custom face
        // lacks glyphs. Keep runs on the primary font's baseline and line box.
        let fallback = if text.chars().any(|c| font.glyph_id(c).0 == 0) {
            load_font("LXGW WenKai TC", layer.font_weight, fonts)?
        } else {
            font.clone()
        };
        let mut runs: Vec<(String, bool)> = Vec::new();
        for c in text.chars() {
            let missing = font.glyph_id(c).0 == 0;
            if let Some((run, _)) = runs.last_mut().filter(|(_, previous)| *previous == missing) {
                run.push(c);
            } else {
                runs.push((c.to_string(), missing));
            }
        }
        let run_sizes: Vec<_> = runs
            .iter()
            .map(|(text, missing)| {
                let face = if *missing { &fallback } else { &font };
                let scale = css_font_scale(face, (layer.font_size * scale).max(1.0));
                let (width, _) = text_size(scale, face, text);
                (scale, width.saturating_sub(1))
            })
            .collect();
        let text_width = run_sizes
            .iter()
            .map(|(_, width)| *width)
            .sum::<u32>()
            .saturating_add(1);
        let text_height = font_scale.y.ceil() as u32;
        let padding = (font_scale.y * 0.35).ceil() as u32 + 4;
        let width = text_width.checked_add(padding.saturating_mul(2));
        let height = text_height.checked_add(padding.saturating_mul(2));
        let (Some(width), Some(height)) = (width, height) else {
            return Err(format!(
                "文字图层“{}”过大，请缩小字号或缩短文字",
                layer.name
            ));
        };
        if width as u64 * height as u64 > MAX_TEXT_PIXELS {
            return Err(format!(
                "文字图层“{}”过大，请缩小字号或缩短文字",
                layer.name
            ));
        }
        let mut text_image = RgbaImage::new(width, height);
        let color = parse_color(&layer.color, (layer.opacity.clamp(0.0, 1.0) * 255.0) as u8);
        let mut cursor = padding as i32;
        let baseline = font.as_scaled(font_scale).ascent();
        for ((text, missing), (run_scale, width)) in runs.iter().zip(run_sizes) {
            let face = if *missing { &fallback } else { &font };
            let top =
                padding as i32 + (baseline - face.as_scaled(run_scale).ascent()).round() as i32;
            draw_text_mut(&mut text_image, color, cursor, top, run_scale, face, text);
            cursor += width as i32;
        }
        let text_image = match layer.rotation {
            90 => imageops::rotate90(&text_image),
            -90 => imageops::rotate270(&text_image),
            _ => text_image,
        };
        let x = (center_x - text_image.width() as f32 / 2.0).round() as i64;
        let y = (center_y - text_image.height() as f32 / 2.0).round() as i64;
        imageops::overlay(canvas, &text_image, x, y);
    }
    Ok(())
}

fn css_font_scale(font: &impl Font, css_pixels: f32) -> PxScale {
    let font_units = font
        .units_per_em()
        .filter(|units| units.is_finite() && *units > 0.0)
        .unwrap_or_else(|| font.height_unscaled());
    PxScale::from(css_pixels * font.height_unscaled() / font_units)
}

fn resize_photo(source: RgbaImage, width: u32, height: u32) -> RgbaImage {
    if source.width() == width && source.height() == height {
        return source;
    }
    let needs_prefilter =
        source.width() > width.saturating_mul(2) || source.height() > height.saturating_mul(2);
    if needs_prefilter {
        imageops::resize(&source, width, height, FilterType::Triangle)
    } else {
        imageops::resize(&source, width, height, FilterType::Lanczos3)
    }
}

fn render_item_with_renderer(
    item: &ExportItem,
    settings: &ExportSettings,
    renderer: &mut ExportRenderer,
) -> Result<(RgbaImage, u32, u32), String> {
    validate_document(&item.document)?;
    let mut exif = read_exif(Path::new(&item.path));
    let (mut width, mut height) = image::image_dimensions(&item.path)
        .map_err(|error| format!("无法读取图片尺寸：{error}"))?;
    if matches!(exif.orientation, 5..=8) {
        std::mem::swap(&mut width, &mut height);
    }
    let (_, _, width, height) = crop_rectangle(width, height, item.crop.as_ref())?;
    let (output_width, output_height) = output_dimensions(width, height, &item.document, settings);
    validate_output_dimensions(output_width, output_height)?;
    let source = decode_color_managed(Path::new(&item.path), exif.orientation)?;
    let (source_width, source_height) = source.dimensions();
    exif.dimensions = Some(format!("{source_width} × {source_height}"));
    let source = transform_photo(source, item.crop.as_ref())?;
    let (source_width, source_height) = source.dimensions();
    let geometry = calculate_geometry(source_width, source_height, &item.document);
    let scale = output_scale(source_width, &geometry, settings);
    let canvas_width = (geometry.width * scale).round().max(1.0) as u32;
    let canvas_height = (geometry.height * scale).round().max(1.0) as u32;
    validate_output_dimensions(canvas_width, canvas_height)?;
    let photo_width = (geometry.photo.width * scale).round().max(1.0) as u32;
    let photo_height = (geometry.photo.height * scale).round().max(1.0) as u32;
    let mut photo = resize_photo(source, photo_width, photo_height);
    let mut canvas = if item.document.frame.frame_type == "blur" {
        make_blurred_background(
            &photo,
            canvas_width,
            canvas_height,
            item.document.frame.blur * scale,
            item.document.frame.brightness,
            parse_color(&item.document.frame.color, 255),
        )
    } else {
        RgbaImage::from_pixel(
            canvas_width,
            canvas_height,
            parse_color(&item.document.frame.color, 255),
        )
    };
    draw_soft_shadow(
        &mut canvas,
        geometry.photo,
        scale,
        item.document.frame.shadow,
        item.document.frame.radius * 2.0,
    );
    apply_rounded_corners(
        &mut photo,
        (item.document.frame.radius * scale * 2.0).round() as u32,
    );
    imageops::overlay(
        &mut canvas,
        &photo,
        (geometry.photo.x * scale).round() as i64,
        (geometry.photo.y * scale).round() as i64,
    );
    drop(photo);
    draw_layers(
        &mut canvas,
        item,
        &exif,
        &geometry,
        scale,
        &mut renderer.fonts,
    )?;
    Ok((canvas, canvas_width, canvas_height))
}

#[cfg(test)]
fn render_item(
    item: &ExportItem,
    settings: &ExportSettings,
) -> Result<(RgbaImage, u32, u32), String> {
    render_item_with_renderer(item, settings, &mut ExportRenderer::default())
}

fn unique_output_path(input: &Path, settings: &ExportSettings) -> Result<Option<PathBuf>, String> {
    unique_output_path_with_reserved(input, settings, &HashSet::new())
}

fn unique_output_path_with_reserved(
    input: &Path,
    settings: &ExportSettings,
    reserved: &HashSet<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let directory = Path::new(&settings.directory);
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("照片");
    let extension = if settings.format == "png" {
        "png"
    } else {
        "jpg"
    };
    let suffix = &settings.suffix;
    let candidate = directory.join(format!("{stem}{suffix}.{extension}"));
    if !reserved.contains(&candidate) && !path_occupied(&candidate)? && candidate != input {
        return Ok(Some(candidate));
    }
    if settings.collision == "skip" {
        return Ok(None);
    }
    for number in 2..=9999 {
        let path = directory.join(format!("{stem}{suffix}-{number}.{extension}"));
        if !reserved.contains(&path) && !path_occupied(&path)? && path != input {
            return Ok(Some(path));
        }
    }
    Err("同名文件编号已超过 9999".to_owned())
}

fn path_occupied(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) if error.kind() == ErrorKind::InvalidFilename => Err(format!(
            "输出文件名或路径过长或无效，请缩短原文件名、后缀或输出目录路径（{error}）"
        )),
        Err(error) => Err(format!("无法检查输出文件：{error}")),
    }
}

fn encode_image(
    image: RgbaImage,
    path: &Path,
    settings: &ExportSettings,
    exif: Vec<u8>,
) -> Result<(), String> {
    let file = File::create(path).map_err(|error| format!("无法创建临时文件：{error}"))?;
    let mut writer = BufWriter::new(file);
    let srgb_profile = Profile::new_srgb()
        .icc()
        .map_err(|error| format!("无法生成 sRGB 色彩标识：{error}"))?;
    if settings.format == "png" {
        let compression = match settings.png_compression.as_str() {
            "fast" => CompressionType::Fast,
            "small" => CompressionType::Best,
            // Level 6 spends several seconds finding slightly smaller matches
            // in large photos. Level 3 preserves all pixels at a useful balance
            // of file size and latency; "small" remains available explicitly.
            _ => CompressionType::Level(3),
        };
        let opaque = image.pixels().all(|pixel| pixel[3] == 255);
        let image = if opaque {
            DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(image).into_rgb8())
        } else {
            DynamicImage::ImageRgba8(image)
        };
        let mut encoder =
            PngEncoder::new_with_quality(&mut writer, compression, PngFilterType::Adaptive);
        encoder
            .set_exif_metadata(exif)
            .map_err(|error| format!("无法写入 EXIF：{error}"))?;
        encoder
            .set_icc_profile(srgb_profile)
            .map_err(|error| format!("无法写入 sRGB 色彩标识：{error}"))?;
        encoder
            .write_image(
                image.as_bytes(),
                image.width(),
                image.height(),
                image.color().into(),
            )
            .map_err(|error| format!("PNG 编码失败：{error}"))?;
    } else {
        let rgb = DynamicImage::ImageRgba8(image).into_rgb8();
        let mut encoder =
            JpegEncoder::new_with_quality(&mut writer, settings.quality.clamp(1, 100));
        encoder
            .set_exif_metadata(exif)
            .map_err(|error| format!("无法写入 EXIF：{error}"))?;
        encoder
            .set_icc_profile(srgb_profile)
            .map_err(|error| format!("无法写入 sRGB 色彩标识：{error}"))?;
        encoder
            .encode_image(&DynamicImage::ImageRgb8(rgb))
            .map_err(|error| format!("JPEG 编码失败：{error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("无法写入输出文件：{error}"))
}

fn prepare_metadata(
    input: &Path,
    settings: &ExportSettings,
    width: u32,
    height: u32,
) -> Result<(Vec<u8>, Option<String>), String> {
    if settings.metadata == "none" {
        return Ok((Vec::new(), None));
    }
    let original = match Metadata::new_from_path(input) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok((
                Vec::new(),
                Some(format!("{}：未能读取元数据（{error}）", input.display())),
            ));
        }
    };
    let mut metadata = if settings.metadata == "supported" {
        original.clone()
    } else {
        let mut basic = Metadata::new();
        for hex in [
            0x010f, 0x0110, 0x829a, 0x829d, 0x8827, 0x9003, 0x920a, 0xa434,
        ] {
            for tag in original.get_tag_by_hex(hex, None) {
                basic.set_tag(tag.clone());
            }
        }
        basic
    };
    for hex in [0x0100, 0x0101, 0x0112, 0x0201, 0x0202, 0xa002, 0xa003] {
        metadata.remove_tag_by_hex_group(hex, ExifTagGroup::GENERIC);
        metadata.remove_tag_by_hex_group(hex, ExifTagGroup::EXIF);
    }
    metadata.remove_tag_by_hex_group(0x927c, ExifTagGroup::EXIF);
    if settings.include_gps {
        if settings.metadata != "supported" {
            for hex in 0x0000..=0x001f {
                for tag in original.get_tag_by_hex(hex, Some(ExifTagGroup::GPS)) {
                    metadata.set_tag(tag.clone());
                }
            }
        }
    } else {
        for hex in 0x0000..=0x001f {
            metadata.remove_tag_by_hex_group(hex, ExifTagGroup::GPS);
        }
        metadata.remove_tag_by_hex_group(0x8825, ExifTagGroup::GENERIC);
    }
    metadata.set_tag(ExifTag::Orientation(vec![1]));
    metadata.set_tag(ExifTag::ImageWidth(vec![width]));
    metadata.set_tag(ExifTag::ImageHeight(vec![height]));
    metadata.set_tag(ExifTag::ExifImageWidth(vec![width]));
    metadata.set_tag(ExifTag::ExifImageHeight(vec![height]));
    let exif = metadata
        .encode()
        .map_err(|error| format!("无法编码 EXIF：{error}"))?;
    let warning = (settings.metadata == "supported")
        .then(|| "已保留编码器支持的 EXIF；XMP、IPTC 与厂商私有 MakerNote 未复制".to_owned());
    Ok((exif, warning))
}

fn export_one_with_renderer(
    item: &ExportItem,
    settings: &ExportSettings,
    renderer: &mut ExportRenderer,
    mut on_stage: impl FnMut(&'static str),
) -> Result<Option<(PathBuf, Vec<String>)>, String> {
    let mut item_settings = settings.clone();
    if let Some(suffix) = &item.output_suffix {
        item_settings.suffix.clone_from(suffix);
    }
    let settings = &item_settings;
    let input = Path::new(&item.path);
    if !input.is_file() {
        return Err("原图不存在或不可读取".to_owned());
    }
    let Some(mut output) = unique_output_path(input, settings)? else {
        return Ok(None);
    };
    let extension = if settings.format == "png" {
        ".png"
    } else {
        ".jpg"
    };
    let mut temp = tempfile::Builder::new()
        .prefix(".yingkuang-part-")
        .suffix(extension)
        .tempfile_in(&settings.directory)
        .map_err(|error| format!("无法创建临时文件：{error}"))?
        .into_temp_path();
    on_stage("rendering");
    let (image, width, height) = render_item_with_renderer(item, settings, renderer)?;
    on_stage("metadata");
    let (exif, warning) = prepare_metadata(input, settings, width, height)?;
    on_stage("encoding");
    encode_image(image, &temp, settings, exif)?;
    let warnings = warning.into_iter().collect();
    on_stage("finishing");
    loop {
        match temp.persist_noclobber(&output) {
            Ok(()) => break,
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
                temp = error.path;
                let Some(next) = unique_output_path(input, settings)? else {
                    return Ok(None);
                };
                output = next;
            }
            Err(error) => return Err(format!("无法完成输出文件：{}", error.error)),
        }
    }
    Ok(Some((output, warnings)))
}

#[cfg(test)]
fn export_one(
    item: &ExportItem,
    settings: &ExportSettings,
) -> Result<Option<(PathBuf, Vec<String>)>, String> {
    export_one_with_renderer(item, settings, &mut ExportRenderer::default(), |_| {})
}

fn emit_progress(app: &AppHandle, progress: ExportProgress) {
    let _ = app.emit("export-progress", progress);
}

fn run_export_with_progress(
    request: ExportRequest,
    cancel: &AtomicBool,
    mut progress: impl FnMut(ExportProgress),
) -> Result<ExportSummary, String> {
    let started = Instant::now();
    let validation_errors = validate_export_request(&request);
    if !validation_errors.is_empty() {
        return Err(validation_errors.join("；"));
    }
    let total = request.items.len();
    let mut succeeded = 0;
    let mut failed = 0;
    let mut skipped = 0;
    let mut failures = Vec::new();
    let mut warnings = Vec::new();
    let mut renderer = ExportRenderer::default();
    for (index, item) in request.items.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let file_name = Path::new(&item.path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名照片")
            .to_owned();
        progress(ExportProgress {
            current: index + 1,
            completed: index,
            total,
            file_name: file_name.clone(),
            succeeded,
            failed,
            skipped,
            stage: "preparing".to_owned(),
        });
        match export_one_with_renderer(item, &request.settings, &mut renderer, |stage| {
            progress(ExportProgress {
                current: index + 1,
                completed: index,
                total,
                file_name: file_name.clone(),
                succeeded,
                failed,
                skipped,
                stage: stage.to_owned(),
            });
        }) {
            Ok(Some((_path, item_warnings))) => {
                succeeded += 1;
                warnings.extend(item_warnings);
            }
            Ok(None) => skipped += 1,
            Err(reason) => {
                failed += 1;
                failures.push(ExportFailure {
                    file_name: file_name.clone(),
                    path: item.path.clone(),
                    reason,
                });
            }
        }
        progress(ExportProgress {
            current: index + 1,
            completed: index + 1,
            total,
            file_name,
            succeeded,
            failed,
            skipped,
            stage: "completed-item".to_owned(),
        });
    }
    warnings.sort();
    warnings.dedup();
    Ok(ExportSummary {
        elapsed_ms: started.elapsed().as_millis() as u64,
        total,
        succeeded,
        failed,
        skipped,
        cancelled: succeeded + failed + skipped < total && cancel.load(Ordering::SeqCst),
        output_directory: request.settings.directory,
        failures,
        warnings,
    })
}

#[tauri::command]
pub async fn preflight_export(request: ExportRequest) -> Result<ExportPreflight, String> {
    tauri::async_runtime::spawn_blocking(move || preflight_export_sync(&request))
        .await
        .map_err(|error| format!("导出预检异常结束：{error}"))
}

#[tauri::command]
pub async fn export_images(
    app: AppHandle,
    request: ExportRequest,
) -> Result<ExportSummary, String> {
    if EXPORT_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("已有导出任务正在运行".to_owned());
    }
    CANCEL_EXPORT.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        // The blocking worker can outlive the awaiting IPC future.
        let _guard = ExportGuard;
        run_export_with_progress(request, &CANCEL_EXPORT, |progress| {
            emit_progress(&app, progress)
        })
    })
    .await
    .map_err(|error| format!("导出任务异常结束：{error}"))?
}

#[tauri::command]
pub fn cancel_export() {
    CANCEL_EXPORT.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_continues_after_failure_and_reports_exact_progress() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("good.png");
        RgbaImage::from_pixel(24, 16, Rgba([120, 80, 40, 255]))
            .save(&input)
            .unwrap();
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document: test_document(),
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let request = ExportRequest {
            items: vec![
                item.clone(),
                ExportItem {
                    path: root
                        .path()
                        .join("missing.png")
                        .to_string_lossy()
                        .into_owned(),
                    ..item.clone()
                },
                item,
            ],
            settings: ExportSettings {
                size: "original".into(),
                format: "png".into(),
                metadata: "none".into(),
                ..test_settings(root.path())
            },
        };
        let mut events = Vec::new();
        let started = Instant::now();
        let summary = run_export_with_progress(request, &AtomicBool::new(false), |event| {
            if events.is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            events.push(event);
        })
        .unwrap();
        assert!(summary.elapsed_ms >= 20);
        assert!(u128::from(summary.elapsed_ms) <= started.elapsed().as_millis());
        assert_eq!(
            (
                summary.total,
                summary.succeeded,
                summary.failed,
                summary.skipped
            ),
            (3, 2, 1, 0)
        );
        assert!(!summary.cancelled);
        assert!(summary.failures[0].path.ends_with("missing.png"));
        assert_eq!(
            events
                .iter()
                .filter(|event| event.stage == "completed-item")
                .map(|event| event.completed)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            (
                events.last().unwrap().succeeded,
                events.last().unwrap().failed
            ),
            (2, 1)
        );
        assert!(root.path().join("good-frame-2.png").is_file());
    }

    #[test]
    fn cancellation_finishes_current_photo_and_only_marks_unfinished_queue() {
        for total in [1, 3] {
            let root = tempfile::tempdir().unwrap();
            let input = root.path().join("photo.png");
            RgbaImage::new(24, 16).save(&input).unwrap();
            let item = ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            };
            let request = ExportRequest {
                items: vec![item; total],
                settings: ExportSettings {
                    size: "original".into(),
                    format: "png".into(),
                    metadata: "none".into(),
                    ..test_settings(root.path())
                },
            };
            let cancel = AtomicBool::new(false);
            let summary = run_export_with_progress(request, &cancel, |event| {
                if event.stage == "encoding" {
                    cancel.store(true, Ordering::SeqCst);
                }
            })
            .unwrap();
            assert_eq!(summary.succeeded, 1);
            assert_eq!(summary.cancelled, total > 1);
            assert!(root.path().join("photo-frame.png").is_file());
            assert!(!root.path().join("photo-frame-2.png").exists());
        }
    }

    #[test]
    #[cfg(unix)]
    fn dangling_output_symlink_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("photo.png");
        RgbaImage::new(24, 16).save(&input).unwrap();
        let output = root.path().join("photo-frame.png");
        std::os::unix::fs::symlink(root.path().join("missing-target"), &output).unwrap();
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document: test_document(),
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let settings = ExportSettings {
            size: "original".into(),
            format: "png".into(),
            ..test_settings(root.path())
        };
        let result = export_one(&item, &settings).unwrap().unwrap();
        assert_eq!(result.0.file_name().unwrap(), "photo-frame-2.png");
        assert!(fs::symlink_metadata(output).unwrap().is_symlink());
    }

    #[test]
    fn oversized_text_is_rejected_before_bitmap_allocation() {
        let mut document = test_document();
        let mut layer = test_layer("custom");
        layer.font_size = 1000.0;
        layer.custom_value = "W".repeat(2000);
        document.layers.push(layer);
        let geometry = calculate_geometry(1000, 1000, &document);
        let item = ExportItem {
            path: String::new(),
            document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let error = draw_layers(
            &mut RgbaImage::new(10, 10),
            &item,
            &ExifSnapshot::default(),
            &geometry,
            1.0,
            &mut HashMap::new(),
        )
        .unwrap_err();
        assert!(error.contains("缩小字号"));
    }

    #[test]
    fn rendering_rejects_pixel_budget_without_relying_on_preflight() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("square.png");
        RgbaImage::new(100, 100).save(&input).unwrap();
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document: test_document(),
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let settings = ExportSettings {
            long_edge: 30_000,
            ..test_settings(root.path())
        };
        assert!(export_one(&item, &settings).unwrap_err().contains("像素"));
        assert_eq!(
            fs::read_dir(root.path()).unwrap().count(),
            1,
            "failed export must clean up its temporary file"
        );
    }

    #[test]
    fn export_validation_rejects_unbounded_document_values() {
        let root = tempfile::tempdir().unwrap();
        let mut request = ExportRequest {
            items: vec![ExportItem {
                path: "photo.png".into(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            }],
            settings: test_settings(root.path()),
        };
        request.items[0].document.frame.padding_x = 1e20;
        assert!(
            !validate_export_request(&request).is_empty(),
            "unbounded padding must fail before allocation"
        );
        request.items[0].document = test_document();
        let mut layer = test_layer("custom");
        layer.font_size = f32::INFINITY;
        request.items[0].document.layers.push(layer);
        assert!(
            !validate_export_request(&request).is_empty(),
            "infinite font size must fail before rendering"
        );
    }

    #[test]
    fn preflight_rejects_output_above_pixel_budget() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("square.png");
        RgbaImage::new(100, 100).save(&input).unwrap();
        let request = ExportRequest {
            items: vec![ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            }],
            settings: ExportSettings {
                long_edge: 30_000,
                ..test_settings(root.path())
            },
        };
        let result = preflight_export_sync(&request);
        assert!(
            !result.ready,
            "a 900MP canvas must be rejected before a multi-GB allocation"
        );
        assert!(result.errors.iter().any(|error| error.contains("像素")));
    }

    #[test]
    fn export_never_overwrites_a_file_created_while_rendering() {
        for collision in ["number", "skip"] {
            let root = tempfile::tempdir().unwrap();
            let input = root.path().join("photo.png");
            RgbaImage::from_pixel(24, 16, Rgba([120, 80, 40, 255]))
                .save(&input)
                .unwrap();
            let item = ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            };
            let settings = ExportSettings {
                size: "original".into(),
                format: "png".into(),
                collision: collision.into(),
                ..test_settings(root.path())
            };
            let first = root.path().join("photo-frame.png");
            let result = export_one_with_renderer(
                &item,
                &settings,
                &mut ExportRenderer::default(),
                |stage| {
                    if stage == "finishing" {
                        fs::write(&first, b"another export completed first").unwrap();
                    }
                },
            )
            .unwrap();
            assert!(
                fs::read(&first).unwrap() == b"another export completed first",
                "must preserve a concurrent result"
            );
            if collision == "skip" {
                assert!(result.is_none());
            } else {
                assert_eq!(result.unwrap().0.file_name().unwrap(), "photo-frame-2.png");
            }
            assert!(fs::read_dir(root.path()).unwrap().all(|entry| {
                !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with('.')
            }));
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn export_reports_buffered_write_failures() {
        let root = tempfile::tempdir().unwrap();
        let settings = ExportSettings {
            format: "png".into(),
            metadata: "none".into(),
            ..test_settings(root.path())
        };
        let result = encode_image(
            RgbaImage::from_pixel(2, 2, Rgba([0, 0, 0, 255])),
            Path::new("/dev/full"),
            &settings,
            Vec::new(),
        );
        assert!(
            result.is_err(),
            "flush errors must not be reported as successful exports"
        );
    }

    #[test]
    fn empty_override_does_not_restore_original_exif_in_output() {
        let exif = ExifSnapshot {
            camera: Some("Original camera".into()),
            ..ExifSnapshot::default()
        };
        for value in ["", "   "] {
            let overrides = HashMap::from([("camera".into(), value.into())]);
            assert!(
                resolve_text(&test_layer("camera"), &exif, &overrides).is_none(),
                "a cleared display value must remain omitted"
            );
        }
        assert_eq!(
            resolve_text(&test_layer("camera"), &exif, &HashMap::new()).as_deref(),
            Some("Original camera")
        );
    }

    #[test]
    fn png_encoding_preserves_pixels_and_omits_only_redundant_alpha() {
        let root = tempfile::tempdir().unwrap();
        for transparent in [false, true] {
            let source = RgbaImage::from_fn(13, 11, |x, y| {
                Rgba([
                    (x * 17) as u8,
                    (y * 23) as u8,
                    137,
                    if transparent { (x * 19) as u8 } else { 255 },
                ])
            });
            for compression in ["fast", "standard", "small"] {
                let path = root.path().join(format!("{transparent}-{compression}.png"));
                let settings = ExportSettings {
                    format: "png".into(),
                    png_compression: compression.into(),
                    ..test_settings(root.path())
                };
                encode_image(source.clone(), &path, &settings, Vec::new()).unwrap();
                let output = image::open(&path).unwrap();
                assert_eq!(
                    output.color(),
                    if transparent {
                        image::ColorType::Rgba8
                    } else {
                        image::ColorType::Rgb8
                    }
                );
                assert_eq!(output.into_rgba8(), source);
                let mut decoder = ImageReader::open(path).unwrap().into_decoder().unwrap();
                assert!(decoder.icc_profile().unwrap().is_some());
            }
        }
    }

    #[test]
    fn shadow_compositing_matches_bilinear_source_over() {
        for opacity in [0.01, 0.12, 0.4] {
            for transparent in [false, true] {
                let mask = image::GrayImage::from_fn(13, 9, |x, y| {
                    image::Luma([((x * 47 + y * 31) % 256) as u8])
                });
                let mut reference = RgbaImage::from_fn(41, 29, |x, y| {
                    Rgba([
                        ((x * 17 + y * 43) % 256) as u8,
                        ((x * 29 + y * 13) % 256) as u8,
                        180,
                        if transparent {
                            ((x * 11 + y * 7) % 256) as u8
                        } else {
                            255
                        },
                    ])
                });
                let mut actual = reference.clone();
                let scale = 13.0 / 41.0;
                for (x, y, pixel) in reference.enumerate_pixels_mut() {
                    let sample = imageops::interpolate_bilinear(
                        &mask,
                        ((x as f32 + 0.5) * scale - 0.5).clamp(0.0, 12.0),
                        ((y as f32 + 0.5) * scale - 0.5).clamp(0.0, 8.0),
                    )
                    .unwrap()[0];
                    pixel.blend(&Rgba([
                        7,
                        9,
                        9,
                        (sample as f32 / 255.0 * opacity * 255.0).round() as u8,
                    ]));
                }
                composite_shadow(&mut actual, &mask, scale, opacity);
                let max_error = reference
                    .as_raw()
                    .iter()
                    .zip(actual.as_raw())
                    .map(|(a, b)| a.abs_diff(*b))
                    .max()
                    .unwrap();
                assert!(
                    max_error <= 1,
                    "opacity {opacity}, transparent {transparent}: {max_error}"
                );
            }
        }
    }

    #[test]
    fn background_enlargement_matches_triangle_sampling() {
        for (width, height, target_width, target_height) in [
            (1, 1, 1, 1),
            (1, 3, 5, 9),
            (7, 1, 21, 2),
            (3, 5, 11, 17),
            (17, 13, 93, 74),
            (80, 60, 160, 120),
        ] {
            let source = RgbaImage::from_fn(width, height, |x, y| {
                Rgba([
                    ((x * 47 + y * 31) % 256) as u8,
                    ((x * 89 + y * 11) % 256) as u8,
                    ((x * 23 + y * 71) % 256) as u8,
                    ((x * 17 + y * 53) % 256) as u8,
                ])
            });
            let reference =
                imageops::resize(&source, target_width, target_height, FilterType::Triangle);
            let actual = upscale_background(source, target_width, target_height);
            let max_error = reference
                .as_raw()
                .iter()
                .zip(actual.as_raw())
                .map(|(a, b)| a.abs_diff(*b))
                .max()
                .unwrap();
            assert!(
                max_error <= 1,
                "{width}x{height} -> {target_width}x{target_height}: {max_error}"
            );
        }
    }

    #[test]
    fn maximum_shadow_is_deep_and_zero_disables_it() {
        let render = |amount| {
            let mut canvas = RgbaImage::from_pixel(680, 580, Rgba([255, 255, 255, 255]));
            draw_soft_shadow(
                &mut canvas,
                Rect {
                    x: 80.0,
                    y: 80.0,
                    width: 520.0,
                    height: 360.0,
                },
                1.0,
                amount,
                24.0,
            );
            canvas.get_pixel(340, 465).0[0]
        };
        assert_eq!(render(0.0), 255);
        let medium = render(40.0);
        let strong = render(64.0);
        let maximum = render(100.0);
        assert!(medium > strong && strong > maximum);
        assert!(maximum < 170, "maximum shadow stayed too faint: {maximum}");
        assert!(
            strong - maximum > 20,
            "upper range must visibly deepen the shadow"
        );
    }

    #[test]
    #[ignore = "writes fixtures for scripts/render-parity.py"]
    fn preview_parity_fixtures() {
        let root = PathBuf::from(std::env::var("YINGKUANG_PARITY_DIR").expect("fixture directory"));
        fs::create_dir_all(&root).unwrap();
        let source = RgbaImage::from_fn(600, 400, |x, y| {
            if x < 300 {
                Rgba([20, 40, 80, 255])
            } else if y < 200 {
                Rgba([240, 220, 180, 255])
            } else {
                Rgba([70, 180, 100, 255])
            }
        });
        source.save(root.join("source.png")).unwrap();
        make_blurred_background(&source, 680, 580, 32.0, 75.0, Rgba([255, 255, 255, 255]))
            .save(root.join("background.png"))
            .unwrap();
        make_blurred_background(&source, 1360, 1160, 64.0, 75.0, Rgba([255, 255, 255, 255]))
            .save(root.join("scaled_background.png"))
            .unwrap();
        let mut shadow = RgbaImage::from_pixel(680, 580, Rgba([255, 255, 255, 255]));
        draw_soft_shadow(
            &mut shadow,
            Rect {
                x: 80.0,
                y: 80.0,
                width: 520.0,
                height: 360.0,
            },
            1.0,
            40.0,
            24.0,
        );
        shadow.save(root.join("shadow.png")).unwrap();
        let mut strong_shadow = RgbaImage::from_pixel(680, 580, Rgba([255, 255, 255, 255]));
        draw_soft_shadow(
            &mut strong_shadow,
            Rect {
                x: 80.0,
                y: 80.0,
                width: 520.0,
                height: 360.0,
            },
            1.0,
            100.0,
            24.0,
        );
        strong_shadow.save(root.join("strong_shadow.png")).unwrap();
        let text_geometry = Geometry {
            width: 600.0,
            height: 400.0,
            photo: Rect {
                x: 0.0,
                y: 0.0,
                width: 600.0,
                height: 400.0,
            },
            regions: HashMap::from([(
                "canvas",
                Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 600.0,
                    height: 400.0,
                },
            )]),
        };
        let mut text_document = test_document();
        text_document.layers.push(WatermarkLayer {
            name: "文字度量".to_owned(),
            source: "custom".to_owned(),
            custom_value: "映框 50mm f/2.8".to_owned(),
            region: "canvas".to_owned(),
            x: 0.5,
            y: 0.5,
            font_family: "LXGW WenKai TC, sans-serif".to_owned(),
            font_size: 32.0,
            font_weight: 400,
            color: "#000000".to_owned(),
            opacity: 1.0,
            rotation: 0,
            visible: true,
        });
        let mut text_canvas = RgbaImage::new(600, 400);
        let text_item = ExportItem {
            path: String::new(),
            document: text_document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        draw_layers(
            &mut text_canvas,
            &text_item,
            &ExifSnapshot::default(),
            &text_geometry,
            1.0,
            &mut HashMap::new(),
        )
        .unwrap();
        text_canvas.save(root.join("text.png")).unwrap();
        for (name, family, weight) in [
            ("retired_sans", "DejaVu Sans, sans-serif", 400),
            ("system_mono", "monospace", 400),
            ("manrope_mixed", "Manrope, LXGW WenKai TC, sans-serif", 400),
            ("manrope_bold", "Manrope, LXGW WenKai TC, sans-serif", 700),
            (
                "serif_mixed",
                "Cormorant Garamond, LXGW WenKai TC, serif",
                600,
            ),
        ] {
            let mut item = text_item.clone();
            item.document.layers[0].font_family = family.to_owned();
            item.document.layers[0].font_weight = weight;
            let mut canvas = RgbaImage::new(600, 400);
            draw_layers(
                &mut canvas,
                &item,
                &ExifSnapshot::default(),
                &text_geometry,
                1.0,
                &mut HashMap::new(),
            )
            .unwrap();
            canvas.save(root.join(format!("{name}.png"))).unwrap();
        }
        let custom_directory = root.join("fonts");
        crate::fonts::initialize(custom_directory.clone());
        let custom = crate::fonts::import_at(
            &custom_directory,
            Path::new("../public/fonts/barlowsemicondensed/BarlowSemiCondensed-Regular.ttf"),
        )
        .unwrap();
        let mut item = text_item.clone();
        item.document.layers[0].font_family =
            format!("{}, LXGW WenKai TC, sans-serif", custom.family);
        let mut canvas = RgbaImage::new(600, 400);
        draw_layers(
            &mut canvas,
            &item,
            &ExifSnapshot::default(),
            &text_geometry,
            1.0,
            &mut HashMap::new(),
        )
        .unwrap();
        canvas.save(root.join("imported_mixed.png")).unwrap();

        let mut rotated_document = text_item.document.clone();
        rotated_document.layers[0].rotation = 90;
        let rotated_item = ExportItem {
            path: String::new(),
            document: rotated_document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let mut rotated_canvas = RgbaImage::new(600, 400);
        draw_layers(
            &mut rotated_canvas,
            &rotated_item,
            &ExifSnapshot::default(),
            &text_geometry,
            1.0,
            &mut HashMap::new(),
        )
        .unwrap();
        rotated_canvas.save(root.join("text_rotated.png")).unwrap();
        if std::env::var_os("YINGKUANG_PARITY_REAL").is_some() {
            let path = "../assets/origin/PANA9432.JPG";
            let source =
                decode_color_managed(Path::new(path), read_exif(Path::new(path)).orientation)
                    .unwrap();
            imageops::resize(&source, 1500, 1000, FilterType::Lanczos3)
                .save(root.join("real_source.png"))
                .unwrap();
            let mut document = test_document();
            document.frame.frame_type = "blur".into();
            document.frame.blur = 32.0;
            document.frame.brightness = 75.0;
            document.frame.radius = 10.0;
            document.frame.shadow = 32.0;
            let item = ExportItem {
                path: path.into(),
                document,
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            };
            let settings = ExportSettings {
                directory: root.to_string_lossy().into_owned(),
                format: "png".into(),
                quality: 92,
                size: "long-edge".into(),
                long_edge: 1580,
                no_upscale: false,
                metadata: "none".into(),
                include_gps: false,
                suffix: "-frame".into(),
                collision: "number".into(),
                png_compression: "fast".into(),
            };
            render_item(&item, &settings)
                .unwrap()
                .0
                .save(root.join("real_export.png"))
                .unwrap();
        }
    }

    #[test]
    fn missing_imported_font_is_reported_before_export() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("photo.png");
        RgbaImage::new(24, 16).save(&input).unwrap();
        let mut document = test_document();
        let mut layer = test_layer("custom");
        layer.custom_value = "映框 50mm".into();
        layer.font_family = format!(
            "YingkuangFont{}, LXGW WenKai TC, sans-serif",
            "0".repeat(64)
        );
        document.layers.push(layer);
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let request = ExportRequest {
            items: vec![item.clone()],
            settings: test_settings(root.path()),
        };
        let preflight = preflight_export_sync(&request);
        assert!(!preflight.ready);
        assert!(preflight.errors.iter().any(|error| error.contains("字体")));
        assert!(
            render_item(&item, &request.settings)
                .unwrap_err()
                .contains("字体")
        );
        assert!(!root.path().join("photo-frame.jpg").exists());
    }

    fn test_document() -> EditorDocument {
        EditorDocument {
            frame: FrameSettings {
                frame_type: "solid".to_owned(),
                color: "#ffffff".to_owned(),
                blur: 0.0,
                brightness: 100.0,
                padding_x: 4.0,
                padding_y: 4.0,
                radius: 0.0,
                shadow: 0.0,
            },
            regions: Regions {
                top: RegionSettings {
                    enabled: false,
                    extra: 0.0,
                },
                bottom: RegionSettings {
                    enabled: true,
                    extra: 13.0,
                },
                left: RegionSettings {
                    enabled: false,
                    extra: 0.0,
                },
                right: RegionSettings {
                    enabled: false,
                    extra: 0.0,
                },
            },
            layers: Vec::new(),
        }
    }

    fn test_layer(source: &str) -> WatermarkLayer {
        WatermarkLayer {
            name: source.to_owned(),
            source: source.to_owned(),
            custom_value: String::new(),
            region: "bottom".to_owned(),
            x: 0.5,
            y: 0.5,
            font_family: "DejaVu Sans, sans-serif".to_owned(),
            font_size: 24.0,
            font_weight: 500,
            color: "#202522".to_owned(),
            opacity: 1.0,
            rotation: 0,
            visible: true,
        }
    }

    fn test_settings(directory: &Path) -> ExportSettings {
        ExportSettings {
            directory: directory.to_string_lossy().into_owned(),
            format: "jpeg".to_owned(),
            quality: 92,
            size: "long-edge".to_owned(),
            long_edge: 1200,
            no_upscale: false,
            metadata: "none".to_owned(),
            include_gps: false,
            suffix: "-frame".to_owned(),
            collision: "number".to_owned(),
            png_compression: "standard".to_owned(),
        }
    }

    #[test]
    fn export_validation_rejects_unsafe_suffix_and_invalid_long_edge() {
        let directory = tempfile::tempdir().unwrap();
        let mut settings = test_settings(directory.path());
        settings.long_edge = 0;
        settings.suffix = "../../escape".to_owned();
        let errors = validate_export_settings(&settings);
        assert!(errors.iter().any(|error| error.contains("800–30000")));
        assert!(errors.iter().any(|error| error.contains("系统保留字符")));
    }

    #[test]
    fn empty_suffix_is_preserved_in_output_name() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("photo.png");
        File::create(&input).unwrap();
        let mut settings = test_settings(directory.path());
        settings.suffix.clear();
        let output = unique_output_path(&input, &settings).unwrap().unwrap();
        assert_eq!(output.file_name().unwrap(), "photo.jpg");
    }

    #[test]
    fn per_photo_suffixes_match_preflight_export_and_collision_handling() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("photo.png");
        RgbaImage::from_pixel(24, 16, Rgba([120, 80, 40, 255]))
            .save(&input)
            .unwrap();
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document: test_document(),
            overrides: HashMap::new(),
            output_suffix: Some("-旅行白框".into()),
            crop: None,
        };
        let mut request = ExportRequest {
            items: vec![
                item.clone(),
                ExportItem {
                    output_suffix: Some("-黑框".into()),
                    ..item.clone()
                },
                item,
            ],
            settings: ExportSettings {
                format: "png".into(),
                size: "original".into(),
                metadata: "none".into(),
                ..test_settings(root.path())
            },
        };
        assert!(preflight_export_sync(&request).ready);
        let summary =
            run_export_with_progress(request.clone(), &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(summary.succeeded, 3);
        for name in [
            "photo-旅行白框.png",
            "photo-黑框.png",
            "photo-旅行白框-2.png",
        ] {
            assert!(root.path().join(name).is_file(), "Missing {name}");
        }
        request.settings.collision = "skip".into();
        assert!(preflight_export_sync(&request).ready);
        let summary =
            run_export_with_progress(request.clone(), &AtomicBool::new(false), |_| {}).unwrap();
        assert_eq!(summary.skipped, 3);
        request.items[0].output_suffix = Some("/../escape".into());
        assert!(!preflight_export_sync(&request).ready);
        assert!(run_export_with_progress(request, &AtomicBool::new(false), |_| {}).is_err());
    }

    #[test]
    fn preflight_matches_filesystem_filename_limits() {
        let root = tempfile::tempdir().unwrap();
        for stem in ["a".repeat(249), "图".repeat(83), "📷".repeat(62)] {
            let input = root.path().join(format!("{stem}.png"));
            RgbaImage::from_pixel(8, 8, Rgba([120, 80, 40, 255]))
                .save(&input)
                .unwrap();
            let settings = test_settings(root.path());
            let item = ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            };
            // APFS/NTFS and common Linux filesystems count Unicode filename
            // lengths differently. Check against the filesystem, not UTF-8 bytes.
            let candidate = root.path().join(format!("{stem}-frame.jpg"));
            let can_create = match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(file) => {
                    drop(file);
                    fs::remove_file(&candidate).unwrap();
                    true
                }
                Err(_) => false,
            };
            let planned = unique_output_path(&input, &settings);
            if can_create {
                assert_eq!(planned.unwrap(), Some(candidate));
            } else {
                let error = planned.unwrap_err();
                assert!(error.contains("请缩短"), "{error}");
            }
            let preflight = preflight_export_sync(&ExportRequest {
                items: vec![item],
                settings,
            });
            assert_eq!(preflight.ready, can_create, "{:?}", preflight.errors);
            if !can_create {
                assert!(
                    preflight
                        .errors
                        .iter()
                        .any(|error| error.contains("输出文件"))
                );
            }
        }
    }

    fn same_name_batch(root: &Path, stem: &str, count: usize, format: &str) -> ExportRequest {
        let output = root.join("exports");
        fs::create_dir(&output).unwrap();
        let mut document = test_document();
        document.layers.clear();
        let items = (0..count)
            .map(|index| {
                let directory = root.join(format!("source-{index}"));
                fs::create_dir(&directory).unwrap();
                let input = directory.join(format!("{stem}.png"));
                RgbaImage::from_pixel(8, 8, Rgba([120, 80, 40, 255]))
                    .save(&input)
                    .unwrap();
                ExportItem {
                    path: input.to_string_lossy().into_owned(),
                    document: document.clone(),
                    overrides: HashMap::new(),
                    output_suffix: None,
                    crop: None,
                }
            })
            .collect();
        ExportRequest {
            items,
            settings: ExportSettings {
                suffix: String::new(),
                size: "original".into(),
                format: format.into(),
                ..test_settings(&output)
            },
        }
    }

    #[test]
    fn preflight_identifies_each_same_name_original() {
        let root = tempfile::tempdir().unwrap();
        let mut request = same_name_batch(root.path(), "same-photo", 2, "png");
        for item in &request.items {
            fs::write(&item.path, b"corrupt image").unwrap();
        }
        let preflight = preflight_export_sync(&request);
        assert!(!preflight.ready);
        assert_eq!(preflight.errors.len(), 2);
        for item in &request.items {
            assert!(
                preflight
                    .errors
                    .iter()
                    .any(|error| error.contains(&item.path)),
                "The user cannot identify which same-photo.png original failed: {:?}",
                preflight.errors
            );
        }
        request.items.pop();
        let single = preflight_export_sync(&request);
        assert!(single.errors[0].starts_with("same-photo.png："));
    }

    #[test]
    fn preflight_rejects_batch_numbering_that_exceeds_filename_limit() {
        for format in ["png", "jpeg"] {
            let root = tempfile::tempdir().unwrap();
            let request = same_name_batch(root.path(), &"a".repeat(249), 10, format);
            let preflight = preflight_export_sync(&request);
            assert_eq!(
                fs::read_dir(&request.settings.directory).unwrap().count(),
                0
            );
            let summary =
                run_export_with_progress(request, &AtomicBool::new(false), |_| {}).unwrap();
            assert_eq!((summary.succeeded, summary.failed), (9, 1));
            assert!(summary.failures[0].reason.contains("请缩短"));
            assert!(
                !preflight.ready,
                "Preflight accepted a batch that exports nine files then fails at -10"
            );
            assert!(preflight.errors[0].contains("请缩短"));
        }
    }

    #[test]
    fn preflight_matches_numbered_and_skipped_same_name_batches() {
        for collision in ["number", "skip"] {
            let root = tempfile::tempdir().unwrap();
            let mut request = same_name_batch(root.path(), "same-photo", 200, "png");
            request.settings.collision = collision.into();
            let directory = PathBuf::from(&request.settings.directory);
            let originals: Vec<_> = request
                .items
                .iter()
                .map(|item| (item.path.clone(), fs::read(&item.path).unwrap()))
                .collect();
            let preflight = preflight_export_sync(&request);
            assert!(preflight.ready, "{:?}", preflight.errors);
            assert_eq!(preflight.total, 200);
            assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
            let summary =
                run_export_with_progress(request.clone(), &AtomicBool::new(false), |_| {}).unwrap();
            assert_eq!(summary.failed, 0);
            let expected = if collision == "number" {
                (200, 0)
            } else {
                (1, 199)
            };
            assert_eq!((summary.succeeded, summary.skipped), expected);
            assert_eq!(fs::read_dir(&directory).unwrap().count(), expected.0);
            for (path, bytes) in originals {
                assert_eq!(fs::read(path).unwrap(), bytes);
            }
            for entry in fs::read_dir(&directory).unwrap() {
                assert!(image::image_dimensions(entry.unwrap().path()).is_ok());
            }
            if collision == "number" {
                assert!(directory.join("same-photo-200.png").is_file());
            } else {
                assert!(preflight_export_sync(&request).ready);
                let existing = fs::read(directory.join("same-photo.png")).unwrap();
                let repeated =
                    run_export_with_progress(request, &AtomicBool::new(false), |_| {}).unwrap();
                assert_eq!(
                    (repeated.succeeded, repeated.skipped, repeated.failed),
                    (0, 200, 0)
                );
                assert_eq!(
                    fs::read(directory.join("same-photo.png")).unwrap(),
                    existing
                );
            }
        }
    }

    #[test]
    fn preflight_accepts_shortened_batch_names_and_long_name_skip() {
        for format in ["png", "jpeg"] {
            for collision in ["number", "skip"] {
                let root = tempfile::tempdir().unwrap();
                let stem = "a".repeat(if collision == "number" { 248 } else { 249 });
                let mut request = same_name_batch(root.path(), &stem, 10, format);
                request.settings.collision = collision.into();
                let preflight = preflight_export_sync(&request);
                assert!(preflight.ready, "{:?}", preflight.errors);
                let summary =
                    run_export_with_progress(request, &AtomicBool::new(false), |_| {}).unwrap();
                let expected = if collision == "number" {
                    (10, 0)
                } else {
                    (1, 9)
                };
                assert_eq!((summary.succeeded, summary.skipped), expected);
                assert_eq!(summary.failed, 0);
            }
        }
    }

    #[test]
    fn preflight_bounds_errors_when_every_original_is_missing() {
        let root = tempfile::tempdir().unwrap();
        let request = ExportRequest {
            items: (0..200)
                .map(|index| ExportItem {
                    path: root
                        .path()
                        .join(format!("missing-{index}.png"))
                        .to_string_lossy()
                        .into_owned(),
                    document: test_document(),
                    overrides: HashMap::new(),
                    output_suffix: None,
                    crop: None,
                })
                .collect(),
            settings: test_settings(root.path()),
        };
        let preflight = preflight_export_sync(&request);
        assert!(!preflight.ready);
        assert_eq!(preflight.errors.len(), 21);
        assert!(preflight.errors.last().unwrap().contains("省略"));
    }

    #[test]
    fn preflight_checks_collision_number_length_and_preserves_skip() {
        let root = tempfile::tempdir().unwrap();
        let stem = "a".repeat(245);
        let input = root.path().join(format!("{stem}.png"));
        RgbaImage::from_pixel(8, 8, Rgba([120, 80, 40, 255]))
            .save(&input)
            .unwrap();
        let settings = test_settings(root.path());
        let candidate = unique_output_path(&input, &settings).unwrap().unwrap();
        fs::write(&candidate, b"existing export").unwrap();
        let mut request = ExportRequest {
            items: vec![ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            }],
            settings,
        };
        let preflight = preflight_export_sync(&request);
        assert!(!preflight.ready);
        assert!(preflight.errors[0].contains("请缩短"));
        request.settings.collision = "skip".into();
        assert!(preflight_export_sync(&request).ready);
        assert!(
            export_one(&request.items[0], &request.settings)
                .unwrap()
                .is_none()
        );
        assert_eq!(fs::read(candidate).unwrap(), b"existing export");
        request.settings.collision = "number".into();
        request.settings.suffix.clear();
        assert!(preflight_export_sync(&request).ready);
        request.settings.format = "png".into();
        let (output, _) = export_one(&request.items[0], &request.settings)
            .unwrap()
            .unwrap();
        assert_ne!(output, input);
        assert!(
            output
                .file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with("-2.png")
        );
        assert!(image::image_dimensions(output).is_ok());
        assert_eq!(image::image_dimensions(input).unwrap(), (8, 8));
    }

    #[test]
    fn no_upscale_matches_preflight_and_encoded_dimensions() {
        let root = tempfile::tempdir().unwrap();
        for (width, height, expected) in [
            (600, 400, (632, 484)),
            (400, 600, (432, 684)),
            (400, 400, (432, 484)),
            (2400, 1600, (1200, 919)),
        ] {
            let input = root.path().join(format!("{width}-{height}.png"));
            RgbaImage::from_pixel(width, height, Rgba([120, 80, 40, 255]))
                .save(&input)
                .unwrap();
            let item = ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            };
            let settings = ExportSettings {
                no_upscale: true,
                format: "png".into(),
                ..test_settings(root.path())
            };
            let preflight = preflight_export_sync(&ExportRequest {
                items: vec![item.clone()],
                settings: settings.clone(),
            });
            assert!(preflight.ready, "{:?}", preflight.errors);
            assert_eq!(
                (preflight.largest_width, preflight.largest_height),
                expected
            );
            assert_eq!(
                preflight.estimated_pixels,
                u64::from(expected.0) * u64::from(expected.1)
            );
            let (output, _) = export_one(&item, &settings).unwrap().unwrap();
            assert_eq!(image::image_dimensions(output).unwrap(), expected);
            let fixed = ExportSettings {
                no_upscale: false,
                ..settings.clone()
            };
            let dimensions = output_dimensions(width, height, &item.document, &fixed);
            assert_eq!(dimensions.0.max(dimensions.1), 1200);
            let original = ExportSettings {
                size: "original".into(),
                ..settings
            };
            let original_fixed = ExportSettings {
                no_upscale: false,
                ..original.clone()
            };
            assert_eq!(
                output_dimensions(width, height, &item.document, &original),
                output_dimensions(width, height, &item.document, &original_fixed)
            );
        }
        let legacy: ExportSettings = serde_json::from_value(serde_json::json!({
            "directory": "/tmp", "format": "jpeg", "quality": 92, "size": "long-edge", "longEdge": 1200,
            "metadata": "none", "includeGps": false, "suffix": "", "collision": "number"
        })).unwrap();
        assert!(!legacy.no_upscale);
    }

    #[test]
    fn preflight_reads_real_dimensions_before_export() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("photo.png");
        RgbaImage::from_pixel(120, 80, Rgba([120, 80, 40, 255]))
            .save(&input)
            .unwrap();
        let request = ExportRequest {
            items: vec![ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: test_document(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: None,
            }],
            settings: ExportSettings {
                long_edge: 800,
                ..test_settings(directory.path())
            },
        };
        let preflight = preflight_export_sync(&request);
        assert!(preflight.ready, "{:?}", preflight.errors);
        assert_eq!(preflight.total, 1);
        assert_eq!(preflight.largest_width.max(preflight.largest_height), 800);
        assert!(preflight.estimated_pixels > 0);
    }

    #[test]
    fn resolves_full_timestamp_and_dynamic_exif_without_corrupting_time() {
        let mut exif = ExifSnapshot {
            captured_at: Some("2026:07:24 17:30:23".to_owned()),
            ..ExifSnapshot::default()
        };
        exif.extra
            .insert("exif:BodySerialNumber".to_owned(), "ABC123".to_owned());
        assert_eq!(
            resolve_text(&test_layer("capturedAt"), &exif, &HashMap::new()).as_deref(),
            Some("2026-07-24 17:30:23")
        );
        assert_eq!(
            resolve_text(&test_layer("exif:BodySerialNumber"), &exif, &HashMap::new()).as_deref(),
            Some("ABC123")
        );
    }

    #[test]
    fn geometry_keeps_photo_ratio_and_independent_padding() {
        let geometry = calculate_geometry(6000, 4000, &test_document());
        assert_eq!(geometry.photo.width, 1500.0);
        assert_eq!(geometry.photo.height, 1000.0);
        assert_eq!(geometry.photo.x, 40.0);
        assert_eq!(geometry.photo.y, 40.0);
        assert_eq!(geometry.width, 1580.0);
        assert_eq!(geometry.height, 1210.0);
    }

    #[test]
    fn blurred_background_uses_safe_overscan_and_preview_tone() {
        assert_eq!(background_overscan(1580, 1210, 32.0), 97);
        assert_eq!(background_overscan(1580, 1210, 70.0), 210);

        let source = RgbaImage::from_pixel(32, 24, Rgba([200, 100, 50, 255]));
        let background =
            make_blurred_background(&source, 120, 90, 10.0, 75.0, Rgba([255, 255, 255, 255]));
        assert_eq!(background.dimensions(), (120, 90));
        for point in [(0, 0), (119, 0), (0, 89), (119, 89), (60, 45)] {
            assert_eq!(
                *background.get_pixel(point.0, point.1),
                Rgba([163, 82, 41, 255])
            );
        }
    }

    #[test]
    fn transparent_blur_composites_over_the_frame_color() {
        let source = RgbaImage::from_pixel(8, 8, Rgba([255, 0, 0, 0]));
        let output =
            make_blurred_background(&source, 20, 20, 2.0, 75.0, Rgba([200, 200, 200, 255]));
        assert_eq!(*output.get_pixel(10, 10), Rgba([185, 186, 185, 255]));
    }

    #[test]
    fn renders_small_png_with_real_frame_dimensions() {
        let root =
            std::env::temp_dir().join(format!("yingkuang-export-test-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create test directory");
        let input = root.join("input.png");
        RgbaImage::from_pixel(120, 80, Rgba([120, 80, 40, 255]))
            .save(&input)
            .expect("save input");
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document: test_document(),
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let settings = ExportSettings {
            directory: root.to_string_lossy().into_owned(),
            format: "png".to_owned(),
            quality: 92,
            size: "long-edge".to_owned(),
            long_edge: 240,
            no_upscale: false,
            metadata: "none".to_owned(),
            include_gps: false,
            suffix: "-frame".to_owned(),
            collision: "number".to_owned(),
            png_compression: "fast".to_owned(),
        };
        let (image, width, height) = render_item(&item, &settings).expect("render image");
        assert_eq!(width, 240);
        assert!(height > 80);
        assert_eq!(image.dimensions(), (width, height));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "200 real-photo exports; run alone in release mode"]
    fn batch_200_real_photo_exports() {
        let root = tempfile::tempdir().unwrap();
        let output = root.path().join("output");
        fs::create_dir(&output).unwrap();
        let portrait = root.path().join("portrait.jpg");
        image::open("../assets/origin/PANA9432.JPG")
            .unwrap()
            .rotate90()
            .save(&portrait)
            .unwrap();
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../src/data/builtin-templates.json")).unwrap();
        let template = catalog["templates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|template| template["id"] == "wide-float")
            .unwrap();
        let inputs = [
            PathBuf::from("../assets/origin/PANA9432.JPG"),
            PathBuf::from("../assets/origin/PANA9448.JPG"),
            portrait,
        ];
        let started = std::time::Instant::now();
        for format in ["jpeg", "png"] {
            let items = (0..100)
                .map(|index| ExportItem {
                    path: inputs[index % inputs.len()].to_string_lossy().into_owned(),
                    document: serde_json::from_value(
                        template["layouts"][if index % 3 == 2 {
                            "portrait"
                        } else {
                            "landscape"
                        }]
                        .clone(),
                    )
                    .unwrap(),
                    overrides: HashMap::new(),
                    output_suffix: None,
                    crop: None,
                })
                .collect();
            let request = ExportRequest {
                items,
                settings: ExportSettings {
                    format: format.into(),
                    metadata: "basic".into(),
                    ..test_settings(&output)
                },
            };
            let preflight = preflight_export_sync(&request);
            assert!(preflight.ready, "{:?}", preflight.errors);
            let summary = run_export_with_progress(request, &AtomicBool::new(false), |event| {
                if event.stage == "completed-item" && event.completed % 25 == 0 {
                    let rss = fs::read_to_string("/proc/self/status")
                        .unwrap_or_default()
                        .lines()
                        .find(|line| line.starts_with("VmRSS:"))
                        .unwrap_or("RSS unavailable")
                        .to_owned();
                    eprintln!(
                        "batch {format} {} / 100 elapsed={:.3}s {rss}",
                        event.completed,
                        started.elapsed().as_secs_f64()
                    );
                }
            })
            .unwrap();
            assert_eq!(
                (summary.succeeded, summary.failed, summary.skipped),
                (100, 0, 0),
                "{:?}",
                summary.failures
            );
            assert!(!summary.cancelled);
        }
        let entries = fs::read_dir(&output)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 200);
        for entry in entries {
            let (width, height) = image::image_dimensions(entry.path()).unwrap();
            assert_eq!(width.max(height), 1200);
        }
        eprintln!(
            "batch 200 complete: {:.3}s",
            started.elapsed().as_secs_f64()
        );
    }

    #[test]
    fn rotation_bounds_match_shared_frontend_fixtures() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../scripts/fixtures/photo-rotation.json"))
                .unwrap();
        for f in fixtures.as_array().unwrap() {
            assert_eq!(
                rotation_dimensions(
                    f["width"].as_u64().unwrap() as u32,
                    f["height"].as_u64().unwrap() as u32,
                    f["angle"].as_f64().unwrap()
                )
                .unwrap(),
                (
                    f["outputWidth"].as_u64().unwrap() as u32,
                    f["outputHeight"].as_u64().unwrap() as u32
                ),
                "{f}"
            );
        }
        let legacy: PhotoCrop =
            serde_json::from_str(r#"{"x":0,"y":0,"width":1,"height":1}"#).unwrap();
        assert_eq!(legacy.rotation, 0.0);
        for angle in [f64::NAN, f64::INFINITY, -180.1, 180.1] {
            assert!(
                crop_rectangle(
                    10,
                    20,
                    Some(&PhotoCrop {
                        rotation: angle,
                        ..legacy.clone()
                    })
                )
                .is_err()
            );
        }
    }

    #[test]
    fn rotation_preserves_quarter_turn_pixels_and_interpolates_transparency_without_dark_halos() {
        let source = RgbaImage::from_fn(47, 31, |x, y| {
            Rgba([(x * 5) as u8, (y * 7) as u8, 80, (x * 5) as u8])
        });
        let mut crop = PhotoCrop {
            x: 0.2,
            y: 0.1,
            width: 0.5,
            height: 0.7,
            rotation: 0.0,
        };
        for (angle, turned) in [
            (0.0, source.clone()),
            (90.0, imageops::rotate90(&source)),
            (-90.0, imageops::rotate270(&source)),
            (180.0, imageops::rotate180(&source)),
        ] {
            crop.rotation = angle;
            let (x, y, w, h) =
                crop_rectangle(source.width(), source.height(), Some(&crop)).unwrap();
            assert_eq!(
                transform_photo(source.clone(), Some(&crop)).unwrap(),
                imageops::crop_imm(&turned, x, y, w, h).to_image()
            );
        }
        crop.x = 0.0;
        crop.y = 0.0;
        crop.width = 1.0;
        crop.height = 1.0;
        for angle in [
            -179.9, -135.0, -90.1, -45.0, -17.3, -0.1, 0.1, 17.3, 45.0, 89.9, 135.0, 179.9,
        ] {
            crop.rotation = angle;
            let opaque = RgbaImage::from_pixel(47, 31, Rgba([240, 80, 20, 255]));
            let rotated = transform_photo(opaque, Some(&crop)).unwrap();
            assert!(
                rotated.pixels().all(|p| p.0 == [240, 80, 20, 255]),
                "empty or discolored corner at {angle}"
            );
            let transparent = RgbaImage::from_fn(47, 31, |x, _| {
                if x < 23 {
                    Rgba([240, 80, 20, 180])
                } else {
                    Rgba([0, 0, 0, 0])
                }
            });
            let rotated = transform_photo(transparent, Some(&crop)).unwrap();
            assert!(
                rotated
                    .pixels()
                    .all(|p| p.0[3] == 0 || p.0[..3] == [240, 80, 20]),
                "dark fringe at {angle}"
            );
        }
    }

    #[test]
    fn rotated_export_applies_after_exif_and_matches_preflight_and_encoded_dimensions() {
        let root = tempfile::tempdir().unwrap();
        let source =
            RgbaImage::from_fn(48, 32, |x, y| Rgba([(x * 4) as u8, (y * 7) as u8, 80, 255]));
        let mut document = test_document();
        document.frame.padding_x = 0.0;
        document.frame.padding_y = 0.0;
        document.regions.bottom.enabled = false;
        for orientation in 1..=8 {
            let input = root.path().join(format!("rotation-{orientation}.png"));
            source.save(&input).unwrap();
            let mut metadata = Metadata::new();
            metadata.set_tag(ExifTag::Orientation(vec![orientation]));
            metadata.write_to_file(&input).unwrap();
            for rotation in [90.0, -17.3, 135.0] {
                let crop = PhotoCrop {
                    x: 0.1,
                    y: 0.2,
                    width: 0.8,
                    height: 0.7,
                    rotation,
                };
                let item = ExportItem {
                    path: input.to_string_lossy().into_owned(),
                    document: document.clone(),
                    overrides: HashMap::new(),
                    output_suffix: None,
                    crop: Some(crop.clone()),
                };
                let expected = transform_photo(
                    decode_color_managed(&input, orientation.into()).unwrap(),
                    Some(&crop),
                )
                .unwrap();
                for format in ["png", "jpeg"] {
                    let settings = ExportSettings {
                        size: "original".into(),
                        format: format.into(),
                        metadata: "basic".into(),
                        ..test_settings(root.path())
                    };
                    let preflight = preflight_export_sync(&ExportRequest {
                        items: vec![item.clone()],
                        settings: settings.clone(),
                    });
                    assert!(preflight.ready, "{:?}", preflight.errors);
                    assert_eq!(
                        (preflight.largest_width, preflight.largest_height),
                        expected.dimensions()
                    );
                    assert_eq!(render_item(&item, &settings).unwrap().0, expected);
                    let (output, _) = export_one(&item, &settings).unwrap().unwrap();
                    let encoded = image::open(&output).unwrap().into_rgba8();
                    assert_eq!(encoded.dimensions(), expected.dimensions());
                    assert_eq!(read_exif(&output).orientation, 1);
                    if format == "png" {
                        assert_eq!(encoded, expected);
                    }
                }
            }
            assert_eq!(
                image::image_dimensions(&input).unwrap(),
                source.dimensions()
            );
        }
    }

    #[test]
    fn crop_coordinates_round_edges_and_reject_invalid_regions() {
        assert_eq!(
            crop_rectangle(6000, 4000, None).unwrap(),
            (0, 0, 6000, 4000)
        );
        let crop = PhotoCrop {
            rotation: 0.0,
            x: 0.5,
            y: 0.5,
            width: 0.5,
            height: 0.5,
        };
        assert_eq!(crop_rectangle(3, 5, Some(&crop)).unwrap(), (2, 3, 1, 2));
        let tiny = PhotoCrop {
            rotation: 0.0,
            x: 0.999999,
            y: 0.999999,
            width: 0.000001,
            height: 0.000001,
        };
        assert_eq!(
            crop_rectangle(6000, 4000, Some(&tiny)).unwrap(),
            (5999, 3999, 1, 1)
        );
        for invalid in [
            PhotoCrop {
                x: -0.1,
                ..crop.clone()
            },
            PhotoCrop {
                width: 0.0,
                ..crop.clone()
            },
            PhotoCrop {
                height: f64::NAN,
                ..crop.clone()
            },
            PhotoCrop {
                width: f64::INFINITY,
                ..crop.clone()
            },
            PhotoCrop {
                y: 0.8,
                ..crop.clone()
            },
        ] {
            assert!(crop_rectangle(6000, 4000, Some(&invalid)).is_err());
        }
    }

    #[test]
    fn cropped_export_matches_selected_original_pixels_after_every_exif_orientation() {
        let root = tempfile::tempdir().unwrap();
        let source =
            RgbaImage::from_fn(48, 32, |x, y| Rgba([(x * 4) as u8, (y * 7) as u8, 80, 255]));
        let mut document = test_document();
        document.frame.padding_x = 0.0;
        document.frame.padding_y = 0.0;
        document.regions.bottom.enabled = false;
        for orientation in 1..=8 {
            let input = root.path().join(format!("orientation-{orientation}.png"));
            source.save(&input).unwrap();
            let mut metadata = Metadata::new();
            metadata.set_tag(ExifTag::Orientation(vec![orientation]));
            metadata.write_to_file(&input).unwrap();
            let crop = PhotoCrop {
                rotation: 0.0,
                x: 0.25,
                y: 0.25,
                width: 0.5,
                height: 0.5,
            };
            let item = ExportItem {
                path: input.to_string_lossy().into_owned(),
                document: document.clone(),
                overrides: HashMap::new(),
                output_suffix: None,
                crop: Some(crop.clone()),
            };
            let corrected = decode_color_managed(&input, orientation.into()).unwrap();
            let (x, y, w, h) =
                crop_rectangle(corrected.width(), corrected.height(), Some(&crop)).unwrap();
            let expected = imageops::crop_imm(&corrected, x, y, w, h).to_image();
            for format in ["png", "jpeg"] {
                let settings = ExportSettings {
                    size: "original".into(),
                    format: format.into(),
                    metadata: "basic".into(),
                    ..test_settings(root.path())
                };
                let preflight = preflight_export_sync(&ExportRequest {
                    items: vec![item.clone()],
                    settings: settings.clone(),
                });
                assert!(preflight.ready, "{:?}", preflight.errors);
                assert_eq!((preflight.largest_width, preflight.largest_height), (w, h));
                let (rendered, width, height) = render_item(&item, &settings).unwrap();
                assert_eq!((width, height), (w, h));
                assert_eq!(rendered, expected, "orientation {orientation}");
                let (output, _) = export_one(&item, &settings).unwrap().unwrap();
                let encoded = image::open(&output).unwrap().into_rgba8();
                assert_eq!(encoded.dimensions(), (w, h));
                assert_eq!(read_exif(&output).orientation, 1);
                if format == "png" {
                    assert_eq!(encoded, expected);
                }
            }
            assert_eq!(image::image_dimensions(&input).unwrap(), (48, 32));
        }
    }

    #[test]
    fn cropped_blur_frame_and_watermarks_match_a_physically_cropped_source() {
        let root = tempfile::tempdir().unwrap();
        let source = RgbaImage::from_fn(320, 200, |x, _| {
            if x < 160 {
                Rgba([240, 20, 10, 255])
            } else {
                Rgba([0, 0, 250, 255])
            }
        });
        let input = root.path().join("original.png");
        source.save(&input).unwrap();
        let cropped_input = root.path().join("cropped.png");
        imageops::crop_imm(&source, 0, 0, 160, 200)
            .to_image()
            .save(&cropped_input)
            .unwrap();
        let mut document = test_document();
        document.frame.frame_type = "blur".into();
        document.frame.blur = 20.0;
        let mut layer = test_layer("custom");
        layer.custom_value = "CROP".into();
        document.layers.push(layer);
        let item = ExportItem {
            path: input.to_string_lossy().into_owned(),
            document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: Some(PhotoCrop {
                rotation: 0.0,
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
        };
        let reference = ExportItem {
            path: cropped_input.to_string_lossy().into_owned(),
            crop: None,
            ..item.clone()
        };
        for (size, no_upscale) in [
            ("original", false),
            ("long-edge", true),
            ("long-edge", false),
        ] {
            let settings = ExportSettings {
                size: size.into(),
                no_upscale,
                format: "png".into(),
                ..test_settings(root.path())
            };
            let (rendered, w, h) = render_item(&item, &settings).unwrap();
            assert_eq!(rendered, render_item(&reference, &settings).unwrap().0);
            let preflight = preflight_export_sync(&ExportRequest {
                items: vec![item.clone()],
                settings: settings.clone(),
            });
            assert!(preflight.ready, "{:?}", preflight.errors);
            assert_eq!((preflight.largest_width, preflight.largest_height), (w, h));
            let (output, _) = export_one(&item, &settings).unwrap().unwrap();
            assert_eq!(image::image_dimensions(output).unwrap(), (w, h));
        }
        let invalid = ExportItem {
            crop: Some(PhotoCrop {
                rotation: 0.0,
                x: 0.9,
                y: 0.0,
                width: 0.5,
                height: 1.0,
            }),
            ..item
        };
        let settings = test_settings(root.path());
        let preflight = preflight_export_sync(&ExportRequest {
            items: vec![invalid.clone()],
            settings: settings.clone(),
        });
        assert!(!preflight.ready);
        assert!(preflight.errors.iter().any(|error| error.contains("裁切")));
        assert!(render_item(&invalid, &settings).is_err());
    }

    #[test]
    fn imports_legacy_png_text_chunk_metadata() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("legacy.png");
        RgbaImage::new(32, 24).save(&path).unwrap();
        let mut metadata = Metadata::new();
        metadata.set_tag(ExifTag::Make("LegacyCamera".into()));
        metadata.set_tag(ExifTag::Orientation(vec![6]));
        // Versions through 0.1.1 used little_exif's legacy zTXt representation.
        metadata.write_to_file(&path).unwrap();
        let snapshot = read_exif(&path);
        assert_eq!(snapshot.make.as_deref(), Some("LegacyCamera"));
        assert_eq!(snapshot.orientation, 6);
    }

    #[test]
    fn metadata_policy_controls_gps_and_normalizes_orientation() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("input.jpg");
        DynamicImage::new_rgb8(32, 24).save(&input).unwrap();
        let mut metadata = Metadata::new();
        metadata.set_tag(ExifTag::Make("TestCamera".into()));
        metadata.set_tag(ExifTag::Orientation(vec![6]));
        metadata.set_tag(ExifTag::GPSLatitudeRef("N".into()));
        metadata.set_tag(ExifTag::GPSLongitudeRef("E".into()));
        metadata.set_tag(ExifTag::Artist("Test Artist".into()));
        metadata.write_to_file(&input).unwrap();
        for format in ["jpeg", "png"] {
            for policy in ["none", "basic", "supported"] {
                for gps in [false, true] {
                    let output = root.path().join(format!(
                        "{format}-{policy}-{gps}.{}",
                        if format == "png" { "png" } else { "jpg" }
                    ));
                    let settings = ExportSettings {
                        format: format.into(),
                        metadata: policy.into(),
                        include_gps: gps,
                        ..test_settings(root.path())
                    };
                    let (exif, _) = prepare_metadata(&input, &settings, 48, 64).unwrap();
                    encode_image(
                        RgbaImage::from_pixel(48, 64, Rgba([10, 20, 30, 255])),
                        &output,
                        &settings,
                        exif,
                    )
                    .unwrap();
                    let output_metadata = match Metadata::new_from_path(&output) {
                        Ok(metadata) => metadata,
                        Err(_) if policy == "none" => Metadata::new(),
                        Err(error) => panic!("missing {policy} metadata: {error}"),
                    };
                    assert_eq!(
                        output_metadata
                            .get_tag_by_hex(0x0001, Some(ExifTagGroup::GPS))
                            .count()
                            > 0,
                        gps && policy != "none"
                    );
                    assert_eq!(
                        output_metadata.get_tag_by_hex(0x013b, None).count() > 0,
                        policy == "supported"
                    );
                    if policy != "none" {
                        assert_eq!(
                            read_exif(&output).orientation,
                            1,
                            "{format} {policy} gps={gps}"
                        );
                        assert_eq!(read_exif(&output).make.as_deref(), Some("TestCamera"));
                        assert_eq!(image::image_dimensions(&output).unwrap(), (48, 64));
                    }
                    let mut decoder = ImageReader::open(output).unwrap().into_decoder().unwrap();
                    assert!(
                        decoder.icc_profile().unwrap().is_some(),
                        "metadata writing must preserve sRGB profile"
                    );
                }
            }
        }
    }

    #[test]
    #[ignore = "local PNG encoding tradeoff measurement"]
    fn png_encoding_comparison() {
        use std::io::Write;
        let root = tempfile::tempdir().unwrap();
        let source = decode_color_managed(Path::new("../assets/origin/PANA9432.JPG"), 1).unwrap();
        let rgb = DynamicImage::ImageRgba8(source.clone()).into_rgb8();
        for (name, compression) in [
            ("fast", CompressionType::Fast),
            ("level1", CompressionType::Level(1)),
            ("level3", CompressionType::Level(3)),
            ("level6", CompressionType::Default),
        ] {
            for color in ["rgba", "rgb"] {
                let path = root.path().join(format!("{name}-{color}.png"));
                let started = std::time::Instant::now();
                let mut writer = BufWriter::new(File::create(&path).unwrap());
                let mut encoder =
                    PngEncoder::new_with_quality(&mut writer, compression, PngFilterType::Adaptive);
                encoder
                    .set_icc_profile(Profile::new_srgb().icc().unwrap())
                    .unwrap();
                let (bytes, color_type) = if color == "rgb" {
                    (rgb.as_raw(), image::ExtendedColorType::Rgb8)
                } else {
                    (source.as_raw(), image::ExtendedColorType::Rgba8)
                };
                encoder
                    .write_image(bytes, source.width(), source.height(), color_type)
                    .unwrap();
                writer.flush().unwrap();
                let elapsed = started.elapsed();
                eprintln!(
                    "PNG {name} {color}: {elapsed:?}, {} bytes",
                    fs::metadata(&path).unwrap().len()
                );
                assert_eq!(image::open(path).unwrap().into_rgba8(), source);
            }
        }
    }

    #[test]
    #[ignore = "local real-photo performance budget; run without other CPU-heavy tests"]
    fn export_latency_budget() {
        let root = tempfile::tempdir().unwrap();
        let mut document = test_document();
        document.frame.frame_type = "blur".into();
        document.frame.blur = 32.0;
        document.frame.brightness = 75.0;
        document.layers.push(test_layer("focalLength"));
        if let Ok(template_id) = std::env::var("YINGKUANG_BENCH_TEMPLATE") {
            let catalog: serde_json::Value =
                serde_json::from_str(include_str!("../../src/data/builtin-templates.json"))
                    .unwrap();
            let template = catalog["templates"]
                .as_array()
                .unwrap()
                .iter()
                .find(|template| template["id"] == template_id)
                .expect("known template");
            document = serde_json::from_value(template["layouts"]["landscape"].clone()).unwrap();
        }
        let item = ExportItem {
            path: std::env::var("YINGKUANG_BENCH_INPUT")
                .unwrap_or_else(|_| "../assets/origin/PANA9432.JPG".into()),
            document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let mut settings = test_settings(root.path());
        settings.metadata = "basic".into();
        if let Ok(format) = std::env::var("YINGKUANG_BENCH_FORMAT") {
            settings.format = format;
        }
        if std::env::var_os("YINGKUANG_BENCH_ORIGINAL").is_some() {
            settings.size = "original".into();
        }
        let started = std::time::Instant::now();
        let mut last_stage = "preparing";
        let mut last_time = started;
        let result =
            export_one_with_renderer(&item, &settings, &mut ExportRenderer::default(), |stage| {
                let now = std::time::Instant::now();
                eprintln!("export benchmark {last_stage}: {:?}", now - last_time);
                last_stage = stage;
                last_time = now;
            })
            .unwrap()
            .unwrap();
        let elapsed = started.elapsed();
        eprintln!(
            "export benchmark {last_stage}: {:?}; total: {elapsed:?}",
            last_time.elapsed()
        );
        let dimensions = image::image_dimensions(&result.0).unwrap();
        eprintln!(
            "export benchmark output: {}x{}; bytes: {}",
            dimensions.0,
            dimensions.1,
            fs::metadata(&result.0).unwrap().len()
        );
        if settings.size == "long-edge" {
            assert_eq!(dimensions.0.max(dimensions.1), 1200);
            assert!(
                elapsed.as_secs_f64() < 2.0,
                "1200px single-image export exceeded 2s budget: {elapsed:?}"
            );
        } else {
            assert!(dimensions.0 >= 6000 && dimensions.1 >= 4000);
            assert!(
                elapsed.as_secs_f64() < 10.0,
                "original-size single-image export exceeded 10s budget: {elapsed:?}"
            );
        }
    }

    #[test]
    fn exports_jpeg_with_text_and_basic_metadata() {
        let root =
            std::env::temp_dir().join(format!("yingkuang-real-export-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test directory");
        let fixture = crate::test_fixtures::jpeg_with_exif(&root);
        let mut document = test_document();
        document.frame.frame_type = "blur".to_owned();
        document.frame.blur = 32.0;
        document.frame.brightness = 75.0;
        document.layers.push(WatermarkLayer {
            name: "焦距".to_owned(),
            source: "focalLength".to_owned(),
            custom_value: String::new(),
            region: "bottom".to_owned(),
            x: 0.5,
            y: 0.5,
            font_family: "DejaVu Sans, sans-serif".to_owned(),
            font_size: 24.0,
            font_weight: 500,
            color: "#202522".to_owned(),
            opacity: 1.0,
            rotation: 0,
            visible: true,
        });
        let item = ExportItem {
            path: fixture.to_string_lossy().into_owned(),
            document,
            overrides: HashMap::new(),
            output_suffix: None,
            crop: None,
        };
        let settings = ExportSettings {
            directory: root.to_string_lossy().into_owned(),
            format: "jpeg".to_owned(),
            quality: 90,
            size: "long-edge".to_owned(),
            long_edge: 1200,
            no_upscale: false,
            metadata: "basic".to_owned(),
            include_gps: false,
            suffix: "-frame".to_owned(),
            collision: "number".to_owned(),
            png_compression: "standard".to_owned(),
        };
        let (output, warnings) = export_one(&item, &settings)
            .expect("export should succeed")
            .expect("output should not be skipped");
        assert!(warnings.is_empty());
        let (width, height) = image::image_dimensions(&output).expect("read output dimensions");
        assert_eq!(width.max(height), 1200);
        let reader = ImageReader::open(&output)
            .expect("open output")
            .with_guessed_format()
            .expect("guess output format");
        let mut decoder = reader.into_decoder().expect("create output decoder");
        assert!(decoder.icc_profile().expect("read output ICC").is_some());
        let metadata = read_exif(&output);
        assert_eq!(metadata.orientation, 1);
        assert_eq!(metadata.focal_length.as_deref(), Some("60mm"));
        if std::env::var_os("YINGKUANG_KEEP_TEST_OUTPUT").is_some() {
            eprintln!("kept blurred export at {}", output.display());
        } else {
            let _ = fs::remove_dir_all(root);
        }
    }
}
