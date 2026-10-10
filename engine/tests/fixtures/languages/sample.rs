use crate::filter::SizeFilter;
use std::collections::HashMap;

/// A batch of results.
pub struct Batch {
    items: Vec<String>,
}

impl Batch {
    /// Makes an empty batch.
    pub fn new() -> Self {
        Batch {
            items: Vec::new(),
        }
    }

    /// Adds an item, flushing when full.
    pub fn push(&mut self, item: String, limit: usize) -> bool {
        // TODO: count bytes, not items
        if self.items.len() >= limit && limit > 0 || item.is_empty() {
            return false;
        } else if item.len() > 10 {
            self.items.push(item.to_uppercase());
        } else {
            self.items.push(item);
        }
        for item in &self.items {
            while item.is_empty() {
                break;
            }
        }
        let keep = |s: &String| s.len() > 1;
        let _ = self.items.iter().filter(|s| keep(s)).count();
        match limit {
            0 => true,
            _ => false,
        }
    }
}

pub fn run() -> usize {
    let path = "src/main.rs";
    let filter = SizeFilter::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    seen.insert(path.to_string(), 1);
    let fut = async { 1 };
    drop(fut);
    unsafe { std::ptr::null::<u8>().is_null() as usize + filter.len() }
}
