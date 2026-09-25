//! SSIMULACRA 2 scoring for web-image-optimiser, exposed to Node through wasm-bindgen.

use ssimulacra2::{ColorPrimaries, Rgb, TransferCharacteristic, compute_frame_ssimulacra2};
use wasm_bindgen::prelude::*;

/// Scores `distorted` against `reference` with SSIMULACRA 2. 100 means identical, and lower
/// scores mean more visible distortion.
///
/// Both images are 8-bit sRGB pixels in RGB order with no alpha, `width * height * 3` bytes long.
///
/// # Errors
///
/// Throws when a buffer's length doesn't match the dimensions, or when the images are smaller
/// than 8x8 pixels.
#[wasm_bindgen]
pub fn score(reference: &[u8], distorted: &[u8], width: u32, height: u32) -> Result<f64, JsError> {
    let reference = to_rgb(reference, width, height)?;
    let distorted = to_rgb(distorted, width, height)?;

    compute_frame_ssimulacra2(reference, distorted).map_err(|error| JsError::new(&error.to_string()))
}

/// Converts 8-bit sRGB RGB bytes into the crate's floating-point image.
fn to_rgb(pixels: &[u8], width: u32, height: u32) -> Result<Rgb, JsError> {
    let width = width as usize;
    let height = height as usize;
    let expected = width
        .checked_mul(height)
        .and_then(|count| count.checked_mul(3));

    if expected != Some(pixels.len()) {
        return Err(JsError::new(&format!(
            "Expected {width}x{height}x3 bytes of RGB pixels, got {}",
            pixels.len()
        )));
    }

    let (triples, _) = pixels.as_chunks::<3>();
    let data = triples
        .iter()
        .map(|pixel| pixel.map(|channel| f32::from(channel) / 255.0))
        .collect();

    Rgb::new(data, width, height, TransferCharacteristic::SRGB, ColorPrimaries::BT709)
        .map_err(|error| JsError::new(&error.to_string()))
}
