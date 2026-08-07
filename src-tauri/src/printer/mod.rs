pub mod escpos;
pub mod system;
pub mod tspl;

#[cfg(windows)]
use std::ffi::{OsStr, OsString};

#[cfg(windows)]
use std::os::windows::ffi::{OsStrExt, OsStringExt};

#[cfg(windows)]
pub(super) fn to_wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
pub(super) unsafe fn wide_ptr_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }

    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }

    OsString::from_wide(std::slice::from_raw_parts(ptr, len))
        .to_string_lossy()
        .into_owned()
}

pub fn detect_printer_type(name: &str, driver: &str) -> String {
    let name_lower = name.to_lowercase();
    let driver_lower = driver.to_lowercase();

    let thermal_keywords = ["thermal", "receipt", "pos", "小票", "热敏", "tm-", "tm_", "rp-"];
    let label_keywords = ["label", "barcode", "tspl", "zpl", "epl", "标签", "条码", "不干胶", "gp-", "zd-", "gc-"];

    for keyword in thermal_keywords {
        if name_lower.contains(keyword) || driver_lower.contains(keyword) {
            return "thermal".to_string();
        }
    }

    for keyword in label_keywords {
        if name_lower.contains(keyword) || driver_lower.contains(keyword) {
            return "label".to_string();
        }
    }

    "normal".to_string()
}
