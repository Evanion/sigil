#![warn(clippy::all, clippy::pedantic)]

pub mod error;
pub mod validate;

pub use error::{ComponentId, CoreError, NodeId, PageId, TokenId};

#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_set() {
        assert!(!version().is_empty());
    }
}
