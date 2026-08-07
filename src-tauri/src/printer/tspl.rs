use crate::{PrintResult, TsplOptions};
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage, Rgba};
use std::io::Write;
use std::time::Duration;

const TSPL_BINARY_THRESHOLD: u8 = 196;
const TSPL_SERIAL_WRITE_CHUNK_SIZE: usize = 4096;
const TSPL_SERIAL_WRITE_TIMEOUT_MS: u64 = 5000;
const TSPL_SERIAL_WRITE_DELAY_MS: u64 = 15;
#[cfg(windows)]
const TSPL_WINDOWS_WRITE_CHUNK_SIZE: usize = 8192;

impl Default for TsplOptions {
    fn default() -> Self {
        Self {
            printer_name: None,
            port: None,
            baud_rate: Some(9600),
            label_width: Some(60),
            label_height: Some(40),
            speed: Some(4),
            density: Some(8),
            copies: Some(1),
        }
    }
}

pub fn print_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: Vec<u8>,
    options: Option<TsplOptions>,
) -> PrintResult {
    let opts = options.unwrap_or_default();

    let image = match prepare_tspl_pixels(width, height, channels, &pixels, &opts) {
        Ok(image) => image,
        Err(message) => {
            return PrintResult { success: false, message };
        }
    };

    let data = match build_tspl_bitmap_data(&image, &opts) {
        Ok(data) => data,
        Err(message) => {
            return PrintResult { success: false, message };
        }
    };

    if let Some(port) = &opts.port {
        send_to_serial(port, opts.baud_rate.unwrap_or(9600), &data)
    } else if let Some(printer_name) = &opts.printer_name {
        send_to_windows_printer(printer_name, &data)
    } else {
        PrintResult {
            success: false,
            message: "请指定打印机名称或串口".to_string(),
        }
    }
}

fn prepare_tspl_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: &[u8],
    opts: &TsplOptions,
) -> Result<GrayImage, String> {
    let image = match channels {
        4 => {
            let image = image::RgbaImage::from_raw(width, height, pixels.to_vec())
                .ok_or_else(|| "根据 RGBA 像素构建标签图片失败".to_string())?;
            DynamicImage::ImageRgba8(image)
        }
        3 => {
            let image = image::RgbImage::from_raw(width, height, pixels.to_vec())
                .ok_or_else(|| "根据 RGB 像素构建标签图片失败".to_string())?;
            DynamicImage::ImageRgb8(image)
        }
        1 => {
            let image = GrayImage::from_raw(width, height, pixels.to_vec())
                .ok_or_else(|| "根据灰度像素构建标签图片失败".to_string())?;
            DynamicImage::ImageLuma8(image)
        }
        _ => {
            return Err(format!("不支持的标签像素通道数: {}", channels));
        }
    };

    let prepared = flatten_alpha_to_white(image);
    let target_width = label_width_dots(opts);
    let target_height = label_height_dots(opts);

    let resized = if prepared.width() > target_width || prepared.height() > target_height {
        prepared.resize(target_width, target_height, FilterType::Triangle)
    } else {
        prepared
    };

    Ok(binarize_tspl_image(resized))
}

fn build_tspl_bitmap_data(image: &GrayImage, opts: &TsplOptions) -> Result<Vec<u8>, String> {
    let width_bytes = (image.width() + 7) / 8;
    let bitmap_bytes = gray_image_to_bitmap_bytes(image);
    let copies = opts.copies.unwrap_or(1).clamp(1, 200);
    let mut data = Vec::new();

    data.extend_from_slice(format!("SIZE {} mm,{} mm\r\n", opts.label_width.unwrap_or(60), opts.label_height.unwrap_or(40)).as_bytes());
    data.extend_from_slice(format!("SPEED {}\r\n", opts.speed.unwrap_or(4)).as_bytes());
    data.extend_from_slice(format!("DENSITY {}\r\n", opts.density.unwrap_or(8)).as_bytes());
    data.extend_from_slice(b"DIRECTION 0,0\r\n");
    data.extend_from_slice(b"CLS\r\n");
    data.extend_from_slice(format!("BITMAP 0,0,{},{},0,", width_bytes, image.height()).as_bytes());
    data.extend_from_slice(&bitmap_bytes);
    data.extend_from_slice(b"\r\n");
    data.extend_from_slice(format!("PRINT {}\r\n", copies).as_bytes());

    Ok(data)
}

fn label_width_dots(opts: &TsplOptions) -> u32 {
    opts.label_width.unwrap_or(60).max(1) * 8
}

fn label_height_dots(opts: &TsplOptions) -> u32 {
    opts.label_height.unwrap_or(40).max(1) * 8
}

fn flatten_alpha_to_white(image: DynamicImage) -> DynamicImage {
    let mut rgba = image.to_rgba8();

    for pixel in rgba.pixels_mut() {
        let alpha = pixel[3] as u32;
        let inverse_alpha = 255 - alpha;
        *pixel = Rgba([
            ((pixel[0] as u32 * alpha + inverse_alpha * 255) / 255) as u8,
            ((pixel[1] as u32 * alpha + inverse_alpha * 255) / 255) as u8,
            ((pixel[2] as u32 * alpha + inverse_alpha * 255) / 255) as u8,
            255,
        ]);
    }

    DynamicImage::ImageRgba8(rgba)
}

fn binarize_tspl_image(image: DynamicImage) -> GrayImage {
    let mut luma = image.to_luma8();

    for pixel in luma.pixels_mut() {
        pixel[0] = if pixel[0] <= TSPL_BINARY_THRESHOLD { 0 } else { 255 };
    }

    luma
}

fn gray_image_to_bitmap_bytes(image: &GrayImage) -> Vec<u8> {
    let width = image.width();
    let height = image.height();
    let mut bytes = Vec::with_capacity((((width + 7) / 8) * height) as usize);

    for y in 0..height {
        for x in (0..width).step_by(8) {
            let mut byte = 0u8;

            for bit in 0..8 {
                let px = x + bit;
                if px >= width {
                    byte <<= 1;
                    continue;
                }

                let is_black = image.get_pixel(px, y)[0] == 0;
                byte = (byte << 1) | u8::from(is_black);
            }

            bytes.push(byte);
        }
    }

    bytes
}

fn send_to_serial(port: &str, baud_rate: u32, data: &[u8]) -> PrintResult {
    let total_chunks = data.chunks(TSPL_SERIAL_WRITE_CHUNK_SIZE).len();

    match serialport::new(port, baud_rate)
        .timeout(Duration::from_millis(TSPL_SERIAL_WRITE_TIMEOUT_MS))
        .open()
    {
        Ok(mut serial) => {
            let mut written_total = 0usize;

            for (index, chunk) in data.chunks(TSPL_SERIAL_WRITE_CHUNK_SIZE).enumerate() {
                if let Err(error) = serial.write_all(chunk) {
                    return PrintResult {
                        success: false,
                        message: format!("写入串口失败: {} (块 {}/{})", error, index + 1, total_chunks),
                    };
                }

                if let Err(error) = serial.flush() {
                    return PrintResult {
                        success: false,
                        message: format!("刷新串口缓冲失败: {}", error),
                    };
                }

                written_total += chunk.len();

                if index + 1 < total_chunks {
                    std::thread::sleep(Duration::from_millis(TSPL_SERIAL_WRITE_DELAY_MS));
                }
            }

            PrintResult {
                success: true,
                message: format!("标签打印成功，写入 {} 字节", written_total),
            }
        }
        Err(error) => PrintResult {
            success: false,
            message: format!("打开串口失败: {}", error),
        },
    }
}

#[cfg(windows)]
fn send_to_windows_printer(printer_name: &str, data: &[u8]) -> PrintResult {
    use super::to_wide_null;
    use std::ptr;
    use winapi::um::winspool::{
        ClosePrinter, DOC_INFO_1W, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter,
    };

    unsafe {
        let printer_name_w = to_wide_null(printer_name);
        let mut h_printer = ptr::null_mut();

        if OpenPrinterW(printer_name_w.as_ptr() as *mut u16, &mut h_printer, ptr::null_mut()) == 0 {
            return PrintResult {
                success: false,
                message: "打开打印机失败".to_string(),
            };
        }

        let doc_name = to_wide_null("Label Print");
        let data_type = to_wide_null("RAW");
        let mut doc_info = DOC_INFO_1W {
            pDocName: doc_name.as_ptr() as *mut u16,
            pOutputFile: ptr::null_mut(),
            pDatatype: data_type.as_ptr() as *mut u16,
        };

        let doc_id = StartDocPrinterW(h_printer, 1, &mut doc_info as *mut _ as *mut u8);
        if doc_id == 0 {
            ClosePrinter(h_printer);
            return PrintResult {
                success: false,
                message: "开始文档失败".to_string(),
            };
        }

        if StartPagePrinter(h_printer) == 0 {
            EndDocPrinter(h_printer);
            ClosePrinter(h_printer);
            return PrintResult {
                success: false,
                message: "开始页面失败".to_string(),
            };
        }

        let mut result = 1;
        let mut written_total = 0usize;

        for chunk in data.chunks(TSPL_WINDOWS_WRITE_CHUNK_SIZE) {
            let mut written: u32 = 0;
            result = WritePrinter(
                h_printer,
                chunk.as_ptr() as *mut _,
                chunk.len() as u32,
                &mut written,
            );

            if result == 0 || written as usize != chunk.len() {
                result = 0;
                break;
            }

            written_total += written as usize;
        }

        EndPagePrinter(h_printer);
        EndDocPrinter(h_printer);
        ClosePrinter(h_printer);

        if result != 0 {
            PrintResult {
                success: true,
                message: format!("标签打印成功，写入 {} 字节", written_total),
            }
        } else {
            PrintResult {
                success: false,
                message: "写入打印机失败".to_string(),
            }
        }
    }
}

#[cfg(not(windows))]
fn send_to_windows_printer(printer_name: &str, _data: &[u8]) -> PrintResult {
    PrintResult {
        success: false,
        message: format!("当前平台不支持通过系统打印机发送原始数据: {}", printer_name),
    }
}
