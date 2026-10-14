//! Synthetic, redistributable test inputs: no private camera originals.
use image::{Rgb, RgbImage};
use little_exif::{exif_tag::ExifTag, metadata::Metadata, rational::uR64};
use std::path::{Path, PathBuf};

pub fn jpeg_with_exif(directory: &Path) -> PathBuf {
    let path = directory.join("fixture.JPG");
    RgbImage::from_fn(600, 400, |x, y| {
        Rgb([(x % 256) as u8, (y % 256) as u8, 100])
    })
    .save(&path)
    .unwrap();
    let mut metadata = Metadata::new();
    metadata.set_tag(ExifTag::Make("FixtureCamera".into()));
    metadata.set_tag(ExifTag::Model("Model 1".into()));
    metadata.set_tag(ExifTag::Orientation(vec![1]));
    metadata.set_tag(ExifTag::FocalLength(vec![uR64::from(60_u32)]));
    metadata.set_tag(ExifTag::FNumber(vec![uR64 {
        nominator: 56,
        denominator: 10,
    }]));
    metadata.set_tag(ExifTag::ISO(vec![100]));
    metadata.write_to_file(&path).unwrap();
    path
}
