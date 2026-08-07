use crate::{EscPosOptions, PrintResult};
use escpos::driver::Driver;
use escpos::errors::Result as EscposResult;
use escpos::printer::Printer;
use escpos::utils::{BitImageOption, BitImageSize, JustifyMode, Protocol};
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, Rgba};
use std::cell::RefCell;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const RECEIPT_BINARY_THRESHOLD: u8 = 196;
const RECEIPT_IMAGE_SLICE_HEIGHT: u32 = 128;
const SERIAL_WRITE_CHUNK_SIZE: usize = 2048;
const SERIAL_WRITE_TIMEOUT_MS: u64 = 5000;
const SERIAL_WRITE_DELAY_MS: u64 = 15;
#[cfg(windows)]
const WINDOWS_WRITE_CHUNK_SIZE: usize = 8192;

static RECEIPT_IMAGE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
struct ReceiptImagePrintOptions {
    printer_name: Option<String>,
    port: Option<String>,
    baud_rate: u32,
    width: u32,
    copies: u32,
}

#[derive(Clone, Default)]
struct BufferDriver {
    bytes: Rc<RefCell<Vec<u8>>>,
}

impl BufferDriver {
    fn snapshot(&self) -> Vec<u8> {
        self.bytes.borrow().clone()
    }
}

impl Driver for BufferDriver {
    fn name(&self) -> String {
        "buffer".to_string()
    }

    fn write(&self, data: &[u8]) -> EscposResult<()> {
        self.bytes.borrow_mut().extend_from_slice(data);
        Ok(())
    }

    fn flush(&self) -> EscposResult<()> {
        Ok(())
    }
}

impl Default for EscPosOptions {
    fn default() -> Self {
        Self {
            printer_name: None,
            port: None,
            baud_rate: Some(9600),
            width: Some(80),
            copies: Some(1),
        }
    }
}

pub fn print_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: Vec<u8>,
    options: Option<EscPosOptions>,
) -> PrintResult {
    let opts = options.unwrap_or_default();
    let receipt_opts = ReceiptImagePrintOptions {
        printer_name: opts.printer_name.clone(),
        port: opts.port.clone(),
        baud_rate: opts.baud_rate.unwrap_or(9600),
        width: opts.width.unwrap_or(80),
        copies: opts.copies.unwrap_or(1).clamp(1, 20),
    };

    let temp_path = match persist_receipt_pixels(width, height, channels, &pixels, receipt_opts.width) {
        Ok(path) => path,
        Err(message) => return failure_result(message),
    };

    let data = match build_receipt_image_data(&temp_path, &receipt_opts) {
        Ok(data) => data,
        Err(message) => {
            let _ = fs::remove_file(&temp_path);
            return failure_result(message);
        }
    };

    let result = if let Some(port) = &receipt_opts.port {
        send_to_serial(port, receipt_opts.baud_rate, &data)
    } else if let Some(printer_name) = &receipt_opts.printer_name {
        send_to_windows_printer(printer_name, &data)
    } else {
        failure_result("请指定打印机名称或串口".to_string())
    };

    let _ = fs::remove_file(&temp_path);
    result
}

fn persist_receipt_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: &[u8],
    target_width: u32,
) -> Result<PathBuf, String> {
    let processed = prepare_receipt_pixels(width, height, channels, pixels, target_width)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let counter = RECEIPT_IMAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_path = std::env::temp_dir().join(format!(
        "receipt-{}-{}-{}.png",
        std::process::id(),
        timestamp,
        counter
    ));

    processed
        .save_with_format(&file_path, ImageFormat::Png)
        .map_err(|error| format!("写入处理后 PNG 文件失败: {}", error))?;

    Ok(file_path)
}

fn prepare_receipt_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: &[u8],
    target_width: u32,
) -> Result<DynamicImage, String> {
    let image = match channels {
        4 => {
            let image = image::RgbaImage::from_raw(width, height, pixels.to_vec())
                .ok_or_else(|| "根据 RGBA 像素构建图片失败".to_string())?;
            DynamicImage::ImageRgba8(image)
        }
        3 => {
            let image = image::RgbImage::from_raw(width, height, pixels.to_vec())
                .ok_or_else(|| "根据 RGB 像素构建图片失败".to_string())?;
            DynamicImage::ImageRgb8(image)
        }
        1 => {
            let image = image::GrayImage::from_raw(width, height, pixels.to_vec())
                .ok_or_else(|| "根据灰度像素构建图片失败".to_string())?;
            DynamicImage::ImageLuma8(image)
        }
        _ => {
            return Err(format!("不支持的像素通道数: {}", channels));
        }
    };

    prepare_receipt_dynamic_image(image, target_width)
}

fn prepare_receipt_dynamic_image(image: DynamicImage, width: u32) -> Result<DynamicImage, String> {
    let image = flatten_alpha_to_white(image);
    let target_width = receipt_image_max_width(width);

    let resized = if image.width() > target_width {
        let target_height = ((image.height() as u64 * target_width as u64) / image.width() as u64)
            .max(1) as u32;
        image.resize_exact(target_width, target_height, FilterType::Triangle)
    } else {
        image
    };

    Ok(DynamicImage::ImageLuma8(binarize_receipt_image(resized)))
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

fn binarize_receipt_image(image: DynamicImage) -> image::GrayImage {
    let mut luma = image.to_luma8();

    for pixel in luma.pixels_mut() {
        pixel[0] = if pixel[0] <= RECEIPT_BINARY_THRESHOLD { 0 } else { 255 };
    }

    luma
}

fn build_receipt_image_data(image_path: &Path, options: &ReceiptImagePrintOptions) -> Result<Vec<u8>, String> {
    let source_image = image::open(image_path).map_err(|error| format!("读取处理后图片失败: {}", error))?;
    let slice_paths = persist_receipt_image_slices(&source_image)?;

    let build_result = (|| {
        let mut all_bytes = Vec::new();

        for _ in 0..options.copies {
            let driver = BufferDriver::default();
            let mut printer = Printer::new(driver.clone(), Protocol::default());
            printer
                .init()
                .map_err(|error| format!("初始化 ESC/POS 打印机失败: {}", error))?;

            for slice_path in &slice_paths {
                printer
                    .justify(JustifyMode::CENTER)
                    .map_err(|error| format!("设置图片对齐失败: {}", error))?
                    .bit_image_option(
                        slice_path.to_string_lossy().as_ref(),
                        BitImageOption::new(
                            Some(receipt_image_max_width(options.width)),
                            None,
                            BitImageSize::Normal,
                        )
                        .map_err(|error| format!("配置图片打印失败: {}", error))?,
                    )
                    .map_err(|error| format!("生成图片打印指令失败: {}", error))?
                    .print()
                    .map_err(|error| format!("提交图片切片打印指令失败: {}", error))?;
            }

            printer
                .feeds(4)
                .map_err(|error| format!("生成走纸指令失败: {}", error))?
                .print_cut()
                .map_err(|error| format!("提交图片打印结束指令失败: {}", error))?;

            all_bytes.extend_from_slice(&driver.snapshot());
        }

        Ok(all_bytes)
    })();

    cleanup_temp_paths(&slice_paths);
    build_result
}

fn persist_receipt_image_slices(image: &DynamicImage) -> Result<Vec<PathBuf>, String> {
    let mut slice_paths = Vec::new();
    let image_width = image.width();
    let image_height = image.height();
    let mut offset_y = 0;

    while offset_y < image_height {
        let slice_height = (image_height - offset_y).min(RECEIPT_IMAGE_SLICE_HEIGHT);
        let slice = image.crop_imm(0, offset_y, image_width, slice_height);
        let slice_path = next_receipt_temp_path("receipt-slice", "png");

        slice
            .save_with_format(&slice_path, ImageFormat::Png)
            .map_err(|error| format!("写入小票切片失败: {}", error))?;

        slice_paths.push(slice_path);
        offset_y += slice_height;
    }

    Ok(slice_paths)
}

fn next_receipt_temp_path(prefix: &str, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let counter = RECEIPT_IMAGE_COUNTER.fetch_add(1, Ordering::Relaxed);

    std::env::temp_dir().join(format!(
        "{}-{}-{}-{}.{}",
        prefix,
        std::process::id(),
        timestamp,
        counter,
        extension
    ))
}

fn cleanup_temp_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn receipt_image_max_width(width: u32) -> u32 {
    if width == 58 { 384 } else { 576 }
}

fn failure_result(message: String) -> PrintResult {
    PrintResult { success: false, message }
}

fn send_to_serial(port: &str, baud_rate: u32, data: &[u8]) -> PrintResult {
    let total_chunks = data.chunks(SERIAL_WRITE_CHUNK_SIZE).len();

    match serialport::new(port, baud_rate)
        .timeout(Duration::from_millis(SERIAL_WRITE_TIMEOUT_MS))
        .open()
    {
        Ok(mut serial) => {
            let mut written_total = 0usize;

            for (index, chunk) in data.chunks(SERIAL_WRITE_CHUNK_SIZE).enumerate() {
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
                    std::thread::sleep(Duration::from_millis(SERIAL_WRITE_DELAY_MS));
                }
            }

            PrintResult {
                success: true,
                message: format!("打印成功，写入 {} 字节", written_total),
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

        if OpenPrinterW(
            printer_name_w.as_ptr() as *mut u16,
            &mut h_printer,
            ptr::null_mut(),
        ) == 0
        {
            return PrintResult {
                success: false,
                message: "打开打印机失败".to_string(),
            };
        }

        let doc_name = to_wide_null("Raw Print");
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

        let mut written_total = 0usize;
        let mut result = 1;

        for chunk in data.chunks(WINDOWS_WRITE_CHUNK_SIZE) {
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
                message: format!("打印成功，写入 {} 字节", written_total),
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
