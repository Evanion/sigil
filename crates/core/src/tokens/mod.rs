pub mod color_convert;
pub mod errors;
pub mod evaluator;
pub mod expression;
pub mod parser;
mod types;
pub use evaluator::{EvalValue, evaluate};
pub use parser::parse_expression;
pub use types::*;
