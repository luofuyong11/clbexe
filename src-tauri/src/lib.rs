use napi::bindgen_prelude::Buffer as JsBuffer;
use napi_derive::napi;

pub mod printer;

#[napi(object)]
pub struct PrinterInfo {
    pub name: String,
    pub driver: String,
    pub port: String,
    pub is_default: bool,
    pub printer_type: String,
}

#[napi(object)]
pub struct PrintResult {
    pub success: bool,
    pub message: String,
}

#[napi(object)]
pub struct EscPosOptions {
    pub printer_name: Option<String>,
    pub port: Option<String>,
    pub baud_rate: Option<u32>,
    pub width: Option<u32>,
    pub copies: Option<u32>,
}

#[napi(object)]
pub struct TsplOptions {
    pub printer_name: Option<String>,
    pub port: Option<String>,
    pub baud_rate: Option<u32>,
    pub label_width: Option<u32>,
    pub label_height: Option<u32>,
    pub speed: Option<u32>,
    pub density: Option<u32>,
    pub copies: Option<u32>,
}

#[napi]
pub fn get_printers() -> Vec<PrinterInfo> {
    printer::system::list_printers()
}

#[napi]
pub fn get_default_printer() -> Option<PrinterInfo> {
    printer::system::default_printer()
}

#[napi]
pub fn print_escpos_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: JsBuffer,
    options: Option<EscPosOptions>,
) -> PrintResult {
    printer::escpos::print_pixels(width, height, channels, pixels.to_vec(), options)
}

#[napi]
pub fn print_tspl_pixels(
    width: u32,
    height: u32,
    channels: u32,
    pixels: JsBuffer,
    options: Option<TsplOptions>,
) -> PrintResult {
    printer::tspl::print_pixels(width, height, channels, pixels.to_vec(), options)
}

#[napi]
pub fn test_printer(printer_name: String) -> PrintResult {
    printer::system::test_connection(&printer_name)
}

#[napi]
pub fn get_serial_ports() -> Vec<String> {
    match serialport::available_ports() {
        Ok(ports) => ports.into_iter().map(|port| port.port_name).collect(),
        Err(_) => vec![],
    }
}
