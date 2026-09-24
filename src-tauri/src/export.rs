use crate::{ExifSnapshot, apply_orientation, read_exif};
use ab_glyph::{Font, FontArc, FontVec, PxScale};
use image::{
    DynamicImage, ImageDecoder, ImageEncoder, ImageReader, Rgba, RgbaImage,
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
    collections::HashMap,
    fs::{self, File},
    io::{BufWriter, Read},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportSettings {
    directory: String,
    format: String,
    quality: u8,
    size: String,
    long_edge: u32,
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
    total: usize,
    succeeded: usize,
    failed: usize,
    skipped: usize,
    cancelled: bool,
    output_directory: String,
    failures: Vec<ExportFailure>,
    warnings: Vec<String>,
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

fn parse_color(value: &str, alpha: u8) -> Rgba<u8> {
    let value = value.trim_start_matches('#');
    if value.len() == 6 {
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
    let filtered = if small_blur > 0.0 {
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
    imageops::resize(&blurred, width, height, FilterType::Triangle)
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
    let opacity = (amount / 100.0).min(0.4);
    for (x, y, pixel) in canvas.enumerate_pixels_mut() {
        let alpha = imageops::interpolate_bilinear(
            &mask,
            ((x as f32 + 0.5) * work_scale - 0.5).clamp(0.0, (width - 1) as f32),
            ((y as f32 + 0.5) * work_scale - 0.5).clamp(0.0, (height - 1) as f32),
        )
        .unwrap()
        .0[0] as f32
            / 255.0
            * opacity;
        image::Pixel::blend(pixel, &Rgba([7, 9, 9, (alpha * 255.0).round() as u8]));
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
    if let Some(value) = overrides
        .get(&layer.source)
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format_layer_value(&layer.source, value));
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
    let style = if weight >= 700 {
        "Bold"
    } else if weight >= 600 {
        "SemiBold"
    } else if weight >= 500 {
        "Medium"
    } else {
        "Regular"
    };
    let pattern = format!("{requested}:style={style}");
    let output = Command::new("fc-match")
        .args(["--format=%{file}|%{index}", &pattern])
        .output()
        .map_err(|error| format!("无法查询字体 {requested}：{error}"))?;
    if !output.status.success() {
        return Err(format!("系统找不到字体 {requested}"));
    }
    let result = String::from_utf8_lossy(&output.stdout);
    let (path, index) = result.split_once('|').unwrap_or((result.as_ref(), "0"));
    let mut data = Vec::new();
    File::open(path)
        .and_then(|mut file| file.read_to_end(&mut data))
        .map_err(|error| format!("无法读取字体 {path}：{error}"))?;
    let index = index.trim().parse::<u32>().unwrap_or(0);
    let font = FontArc::new(
        FontVec::try_from_vec_and_index(data, index).map_err(|_| format!("无法解析字体 {path}"))?,
    );
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
        let bounds = geometry
            .regions
            .get(layer.region.as_str())
            .unwrap_or(&geometry.regions["canvas"]);
        let center_x = (bounds.x + bounds.width * layer.x) * scale;
        let center_y = (bounds.y + bounds.height * layer.y) * scale;
        let font = load_font(&layer.font_family, layer.font_weight, fonts)
            .map_err(|error| format!("{}：{error}", layer.name))?;
        let font_scale = css_font_scale(&font, (layer.font_size * scale).max(1.0));
        let (text_width, text_height) = text_size(font_scale, &font, &text);
        let padding = (font_scale.y * 0.35).ceil() as u32 + 4;
        let mut text_image = RgbaImage::new(text_width + padding * 2, text_height + padding * 2);
        let color = parse_color(&layer.color, (layer.opacity.clamp(0.0, 1.0) * 255.0) as u8);
        draw_text_mut(
            &mut text_image,
            color,
            padding as i32,
            padding as i32,
            font_scale,
            &font,
            &text,
        );
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

fn render_item(
    item: &ExportItem,
    settings: &ExportSettings,
) -> Result<(RgbaImage, u32, u32), String> {
    let mut exif = read_exif(Path::new(&item.path));
    let source = decode_color_managed(Path::new(&item.path), exif.orientation)?;
    let (source_width, source_height) = source.dimensions();
    exif.dimensions = Some(format!("{source_width} × {source_height}"));
    let geometry = calculate_geometry(source_width, source_height, &item.document);
    let original_scale = source_width as f32 / geometry.photo.width;
    let scale = if settings.size == "long-edge" {
        settings.long_edge as f32 / geometry.width.max(geometry.height)
    } else {
        original_scale
    };
    let canvas_width = (geometry.width * scale).round().max(1.0) as u32;
    let canvas_height = (geometry.height * scale).round().max(1.0) as u32;
    let mut canvas = if item.document.frame.frame_type == "blur" {
        make_blurred_background(
            &source,
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
    let photo_width = (geometry.photo.width * scale).round().max(1.0) as u32;
    let photo_height = (geometry.photo.height * scale).round().max(1.0) as u32;
    let mut photo = if source.width() == photo_width && source.height() == photo_height {
        source
    } else {
        imageops::resize(&source, photo_width, photo_height, FilterType::Lanczos3)
    };
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
    let mut fonts = HashMap::new();
    draw_layers(&mut canvas, item, &exif, &geometry, scale, &mut fonts)?;
    Ok((canvas, canvas_width, canvas_height))
}

fn unique_output_path(input: &Path, settings: &ExportSettings) -> Result<Option<PathBuf>, String> {
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
    let suffix = if settings.suffix.is_empty() {
        "-相框"
    } else {
        &settings.suffix
    };
    let candidate = directory.join(format!("{stem}{suffix}.{extension}"));
    if !candidate.exists() && candidate != input {
        return Ok(Some(candidate));
    }
    if settings.collision == "skip" {
        return Ok(None);
    }
    for number in 2..=9999 {
        let path = directory.join(format!("{stem}{suffix}-{number}.{extension}"));
        if !path.exists() && path != input {
            return Ok(Some(path));
        }
    }
    Err("同名文件编号已超过 9999".to_owned())
}

fn temporary_path(output: &Path) -> PathBuf {
    let file_name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("output.jpg");
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jpg");
    output.with_file_name(format!(".{file_name}.yingkuang-part.{extension}"))
}

fn encode_image(image: RgbaImage, path: &Path, settings: &ExportSettings) -> Result<(), String> {
    let file = File::create(path).map_err(|error| format!("无法创建临时文件：{error}"))?;
    let mut writer = BufWriter::new(file);
    let srgb_profile = Profile::new_srgb()
        .icc()
        .map_err(|error| format!("无法生成 sRGB 色彩标识：{error}"))?;
    if settings.format == "png" {
        let compression = match settings.png_compression.as_str() {
            "fast" => CompressionType::Fast,
            "small" => CompressionType::Best,
            _ => CompressionType::Default,
        };
        let mut encoder =
            PngEncoder::new_with_quality(&mut writer, compression, PngFilterType::Adaptive);
        encoder
            .set_icc_profile(srgb_profile)
            .map_err(|error| format!("无法写入 sRGB 色彩标识：{error}"))?;
        encoder
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|error| format!("PNG 编码失败：{error}"))?;
    } else {
        let rgb = DynamicImage::ImageRgba8(image).into_rgb8();
        let mut encoder =
            JpegEncoder::new_with_quality(&mut writer, settings.quality.clamp(1, 100));
        encoder
            .set_icc_profile(srgb_profile)
            .map_err(|error| format!("无法写入 sRGB 色彩标识：{error}"))?;
        encoder
            .encode_image(&DynamicImage::ImageRgb8(rgb))
            .map_err(|error| format!("JPEG 编码失败：{error}"))?;
    }
    Ok(())
}

fn copy_metadata(
    input: &Path,
    output: &Path,
    settings: &ExportSettings,
    width: u32,
    height: u32,
) -> Result<Option<String>, String> {
    if settings.metadata == "none" {
        return Ok(None);
    }
    let original = match Metadata::new_from_path(input) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok(Some(format!(
                "{}：未能读取元数据（{error}）",
                input.display()
            )));
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
    metadata
        .write_to_file(output)
        .map_err(|error| format!("写入元数据失败：{error}"))?;
    if settings.metadata == "supported" {
        Ok(Some(format!(
            "{}：已保留编码器支持的 EXIF；XMP、IPTC 与厂商私有 MakerNote 未复制",
            input.display()
        )))
    } else {
        Ok(None)
    }
}

fn export_one(
    item: &ExportItem,
    settings: &ExportSettings,
) -> Result<Option<(PathBuf, Vec<String>)>, String> {
    let input = Path::new(&item.path);
    if !input.is_file() {
        return Err("原图不存在或不可读取".to_owned());
    }
    let Some(output) = unique_output_path(input, settings)? else {
        return Ok(None);
    };
    let temp = temporary_path(&output);
    let (image, width, height) = render_item(item, settings)?;
    encode_image(image, &temp, settings)?;
    let mut warnings = Vec::new();
    match copy_metadata(input, &temp, settings, width, height) {
        Ok(Some(warning)) => warnings.push(warning),
        Ok(None) => {}
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    }
    fs::rename(&temp, &output).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("无法完成输出文件：{error}")
    })?;
    Ok(Some((output, warnings)))
}

fn run_export(app: &AppHandle, request: ExportRequest) -> Result<ExportSummary, String> {
    let directory = Path::new(&request.settings.directory);
    if !directory.is_dir() {
        return Err("输出文件夹不存在".to_owned());
    }
    let test_path = directory.join(".yingkuang-write-test");
    File::create(&test_path)
        .and_then(|_| fs::remove_file(&test_path))
        .map_err(|error| format!("输出文件夹不可写：{error}"))?;
    let total = request.items.len();
    let mut succeeded = 0;
    let mut failed = 0;
    let mut skipped = 0;
    let mut failures = Vec::new();
    let mut warnings = Vec::new();
    for (index, item) in request.items.iter().enumerate() {
        if CANCEL_EXPORT.load(Ordering::SeqCst) {
            break;
        }
        let file_name = Path::new(&item.path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名照片")
            .to_owned();
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                current: index,
                total,
                file_name: file_name.clone(),
                succeeded,
                failed,
                skipped,
                stage: "rendering".to_owned(),
            },
        );
        match export_one(item, &request.settings) {
            Ok(Some((_path, item_warnings))) => {
                succeeded += 1;
                warnings.extend(item_warnings);
            }
            Ok(None) => skipped += 1,
            Err(reason) => {
                failed += 1;
                failures.push(ExportFailure {
                    file_name,
                    path: item.path.clone(),
                    reason,
                });
            }
        }
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                current: index + 1,
                total,
                file_name: Path::new(&item.path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("未命名照片")
                    .to_owned(),
                succeeded,
                failed,
                skipped,
                stage: "completed-item".to_owned(),
            },
        );
    }
    warnings.sort();
    warnings.dedup();
    Ok(ExportSummary {
        total,
        succeeded,
        failed,
        skipped,
        cancelled: CANCEL_EXPORT.load(Ordering::SeqCst),
        output_directory: request.settings.directory,
        failures,
        warnings,
    })
}

#[tauri::command]
pub async fn export_images(
    app: AppHandle,
    request: ExportRequest,
) -> Result<ExportSummary, String> {
    if EXPORT_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("已有导出任务正在运行".to_owned());
    }
    let _guard = ExportGuard;
    CANCEL_EXPORT.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || run_export(&app, request))
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
            font_family: "Noto Sans CJK SC, sans-serif".to_owned(),
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
        let mut rotated_document = text_item.document.clone();
        rotated_document.layers[0].rotation = 90;
        let rotated_item = ExportItem {
            path: String::new(),
            document: rotated_document,
            overrides: HashMap::new(),
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
            };
            let settings = ExportSettings {
                directory: root.to_string_lossy().into_owned(),
                format: "png".into(),
                quality: 92,
                size: "long-edge".into(),
                long_edge: 1580,
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
        };
        let settings = ExportSettings {
            directory: root.to_string_lossy().into_owned(),
            format: "png".to_owned(),
            quality: 92,
            size: "long-edge".to_owned(),
            long_edge: 240,
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
    fn exports_real_jpeg_with_text_and_basic_metadata() {
        let root =
            std::env::temp_dir().join(format!("yingkuang-real-export-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test directory");
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
            path: "../assets/origin/PANA9432.JPG".to_owned(),
            document,
            overrides: HashMap::new(),
        };
        let settings = ExportSettings {
            directory: root.to_string_lossy().into_owned(),
            format: "jpeg".to_owned(),
            quality: 90,
            size: "long-edge".to_owned(),
            long_edge: 1200,
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
