use super::detect_printer_type;
use crate::{PrinterInfo, PrintResult};

pub fn list_printers() -> Vec<PrinterInfo> {
    #[cfg(windows)]
    {
        list_windows_printers()
    }

    #[cfg(target_os = "macos")]
    {
        list_macos_printers()
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        vec![]
    }
}

pub fn default_printer() -> Option<PrinterInfo> {
    list_printers().into_iter().find(|printer| printer.is_default)
}

pub fn test_connection(printer_name: &str) -> PrintResult {
    let printers = list_printers();
    if printers.iter().any(|printer| printer.name == printer_name) {
        PrintResult {
            success: true,
            message: format!("打印机 {} 连接正常", printer_name),
        }
    } else {
        PrintResult {
            success: false,
            message: format!("未找到打印机: {}", printer_name),
        }
    }
}

#[cfg(windows)]
fn list_windows_printers() -> Vec<PrinterInfo> {
    use super::wide_ptr_to_string;
    use std::ptr;
    use winapi::um::winspool::{
        EnumPrintersW, GetDefaultPrinterW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
        PRINTER_INFO_2W,
    };

    let mut printers = Vec::new();
    let default_name = unsafe {
        let mut needed: u32 = 0;
        GetDefaultPrinterW(ptr::null_mut(), &mut needed);
        if needed == 0 {
            None
        } else {
            let mut buffer = vec![0u16; needed as usize];
            if GetDefaultPrinterW(buffer.as_mut_ptr(), &mut needed) == 0 {
                None
            } else {
                Some(wide_ptr_to_string(buffer.as_ptr()))
            }
        }
    };

    unsafe {
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;

        EnumPrintersW(
            PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
            ptr::null_mut(),
            2,
            ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );

        if needed == 0 {
            return printers;
        }

        let mut buffer = vec![0u8; needed as usize];
        let success = EnumPrintersW(
            PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
            ptr::null_mut(),
            2,
            buffer.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        );

        if success == 0 {
            return printers;
        }

        let printer_info = buffer.as_ptr() as *const PRINTER_INFO_2W;
        for index in 0..returned as isize {
            let info = &*printer_info.offset(index);
            let name = wide_ptr_to_string(info.pPrinterName);
            if name.is_empty() {
                continue;
            }

            let driver = wide_ptr_to_string(info.pDriverName);
            let port = wide_ptr_to_string(info.pPortName);
            let is_default = default_name.as_deref() == Some(name.as_str());

            printers.push(PrinterInfo {
                printer_type: detect_printer_type(&name, &driver),
                name,
                driver,
                port,
                is_default,
            });
        }
    }

    printers
}

#[cfg(target_os = "macos")]
fn list_macos_printers() -> Vec<PrinterInfo> {
    use std::process::Command;

    let default_name = Command::new("lpstat")
        .arg("-d")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| stdout.split(':').nth(1).map(|value| value.trim().to_string()));

    Command::new("lpstat")
        .arg("-p")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|stdout| {
            stdout
                .lines()
                .filter_map(|line| {
                    let trimmed = line.trim();
                    if !trimmed.starts_with("printer ") {
                        return None;
                    }

                    let remainder = &trimmed["printer ".len()..];
                    let name = remainder
                        .split_whitespace()
                        .next()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())?
                        .to_string();

                    let driver = "CUPS".to_string();
                    Some(PrinterInfo {
                        printer_type: detect_printer_type(&name, &driver),
                        is_default: default_name.as_deref() == Some(name.as_str()),
                        name,
                        driver,
                        port: String::new(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}
