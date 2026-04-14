// crates/core/src/tokens/parser.rs

//! Recursive descent parser for token expressions.
//!
//! Converts expression strings like `{spacing.md} * 2` or `round({a} + {b})`
//! into [`TokenExpression`] AST nodes.
//!
//! # Grammar
//!
//! ```text
//! expression     = term (('+' | '-') term)*
//! term           = factor (('*' | '/') factor)*
//! factor         = '-' factor | atom
//! atom           = number | percentage | function_call | token_ref | '(' expression ')'
//! number         = DIGIT+ ('.' DIGIT+)?
//! percentage     = number '%'
//! function_call  = IDENT '(' (expression (',' expression)*)? ')'
//! token_ref      = '{' TOKEN_PATH '}' | TOKEN_PATH
//! TOKEN_PATH     = IDENT ('.' IDENT)*
//! IDENT          = [a-zA-Z_][a-zA-Z0-9_]*
//! ```

use super::errors::ExprError;
use super::expression::{BinaryOperator, ExprLiteral, TokenExpression};
use crate::validate::{MAX_EXPRESSION_AST_DEPTH, MAX_FUNCTION_ARGS, MAX_TOKEN_EXPRESSION_LENGTH};

/// Parse an expression string into a [`TokenExpression`] AST.
///
/// # Errors
///
/// Returns [`ExprError::Parse`] if:
/// - The input is empty or exceeds [`MAX_TOKEN_EXPRESSION_LENGTH`] (1024) characters
/// - The input contains syntax errors
/// - Nesting depth exceeds [`MAX_EXPRESSION_AST_DEPTH`] (32)
/// - A function call has more than [`MAX_FUNCTION_ARGS`] (8) arguments
pub fn parse_expression(input: &str) -> Result<TokenExpression, ExprError> {
    if input.is_empty() {
        return Err(ExprError::Parse("empty expression".to_string()));
    }
    if input.len() > MAX_TOKEN_EXPRESSION_LENGTH {
        return Err(ExprError::Parse(format!(
            "expression exceeds maximum length of {MAX_TOKEN_EXPRESSION_LENGTH}"
        )));
    }

    let mut parser = Parser::new(input);
    let expr = parser.expression()?;

    parser.skip_whitespace();
    if parser.pos < parser.input.len() {
        return Err(ExprError::Parse(format!(
            "unexpected character '{}' at position {}",
            parser.current_char(),
            parser.pos,
        )));
    }

    Ok(expr)
}

/// Internal parser state for recursive descent parsing.
struct Parser<'a> {
    input: &'a str,
    pos: usize,
    depth: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            input,
            pos: 0,
            depth: 0,
        }
    }

    /// Returns the current character without advancing, or `'\0'` at EOF.
    fn current_char(&self) -> char {
        self.input[self.pos..].chars().next().unwrap_or('\0')
    }

    /// Peek at the current character without advancing. Returns `None` at EOF.
    fn peek(&self) -> Option<char> {
        self.input[self.pos..].chars().next()
    }

    /// Advance past one character, returning it.
    fn advance(&mut self) -> Option<char> {
        let ch = self.input[self.pos..].chars().next()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }

    /// Skip over whitespace characters.
    fn skip_whitespace(&mut self) {
        while self.pos < self.input.len() {
            let ch = self.current_char();
            if ch.is_ascii_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    /// Enter a new nesting level, checking the depth guard.
    fn enter_depth(&mut self) -> Result<(), ExprError> {
        if self.depth >= MAX_EXPRESSION_AST_DEPTH {
            return Err(ExprError::Parse(format!(
                "expression nesting exceeds maximum depth of {MAX_EXPRESSION_AST_DEPTH}"
            )));
        }
        self.depth += 1;
        Ok(())
    }

    /// Leave a nesting level.
    fn leave_depth(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    /// Parse: expression = term (('+' | '-') term)*
    fn expression(&mut self) -> Result<TokenExpression, ExprError> {
        self.enter_depth()?;

        let mut left = self.term()?;

        loop {
            self.skip_whitespace();
            match self.peek() {
                Some('+') => {
                    self.advance();
                    let right = self.term()?;
                    left = TokenExpression::BinaryOp {
                        left: Box::new(left),
                        op: BinaryOperator::Add,
                        right: Box::new(right),
                    };
                }
                Some('-') => {
                    self.advance();
                    let right = self.term()?;
                    left = TokenExpression::BinaryOp {
                        left: Box::new(left),
                        op: BinaryOperator::Sub,
                        right: Box::new(right),
                    };
                }
                _ => break,
            }
        }

        self.leave_depth();
        Ok(left)
    }

    /// Parse: term = factor (('*' | '/') factor)*
    fn term(&mut self) -> Result<TokenExpression, ExprError> {
        let mut left = self.factor()?;

        loop {
            self.skip_whitespace();
            match self.peek() {
                Some('*') => {
                    self.advance();
                    let right = self.factor()?;
                    left = TokenExpression::BinaryOp {
                        left: Box::new(left),
                        op: BinaryOperator::Mul,
                        right: Box::new(right),
                    };
                }
                Some('/') => {
                    self.advance();
                    let right = self.factor()?;
                    left = TokenExpression::BinaryOp {
                        left: Box::new(left),
                        op: BinaryOperator::Div,
                        right: Box::new(right),
                    };
                }
                _ => break,
            }
        }

        Ok(left)
    }

    /// Parse: factor = '-' factor | atom
    fn factor(&mut self) -> Result<TokenExpression, ExprError> {
        self.skip_whitespace();
        if self.peek() == Some('-') {
            self.advance();
            let inner = self.factor()?;
            return Ok(TokenExpression::UnaryNeg(Box::new(inner)));
        }
        self.atom()
    }

    /// Parse: atom = number | percentage | `function_call` | `token_ref` | '(' expression ')'
    fn atom(&mut self) -> Result<TokenExpression, ExprError> {
        self.skip_whitespace();

        match self.peek() {
            None => Err(ExprError::Parse("unexpected end of expression".to_string())),
            Some('(') => {
                self.advance(); // consume '('
                let expr = self.expression()?;
                self.skip_whitespace();
                if self.peek() != Some(')') {
                    return Err(ExprError::Parse("expected closing ')'".to_string()));
                }
                self.advance(); // consume ')'
                Ok(expr)
            }
            Some('{') => {
                self.advance(); // consume '{'
                let path = self.parse_token_path()?;
                self.skip_whitespace();
                if self.peek() != Some('}') {
                    return Err(ExprError::Parse("expected closing '}'".to_string()));
                }
                self.advance(); // consume '}'
                Ok(TokenExpression::TokenRef(path))
            }
            Some(c) if c.is_ascii_digit() || c == '.' => self.parse_number_or_percentage(),
            Some(c) if is_ident_start(c) => self.parse_ident_or_function_or_bare_ref(),
            Some(c) => Err(ExprError::Parse(format!(
                "unexpected character '{c}' at position {}",
                self.pos,
            ))),
        }
    }

    /// Parse a number literal, potentially followed by `%` for percentage.
    fn parse_number_or_percentage(&mut self) -> Result<TokenExpression, ExprError> {
        let value = self.parse_number()?;

        if self.peek() == Some('%') {
            self.advance(); // consume '%'
            if !value.is_finite() {
                return Err(ExprError::Parse(
                    "percentage value must be finite".to_string(),
                ));
            }
            Ok(TokenExpression::Literal(ExprLiteral::Percentage(
                value / 100.0,
            )))
        } else {
            if !value.is_finite() {
                return Err(ExprError::Parse(
                    "number literal must be finite".to_string(),
                ));
            }
            Ok(TokenExpression::Literal(ExprLiteral::Number(value)))
        }
    }

    /// Parse a numeric value (integer or floating-point).
    fn parse_number(&mut self) -> Result<f64, ExprError> {
        let start = self.pos;

        // Consume digits before decimal point.
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.advance();
        }

        // Consume optional decimal part.
        if self.peek() == Some('.') {
            // Look ahead to see if the next char after '.' is a digit.
            let next_pos = self.pos + 1;
            let has_digit_after_dot = self
                .input
                .get(next_pos..next_pos + 1)
                .and_then(|s| s.chars().next())
                .is_some_and(|c| c.is_ascii_digit());

            if has_digit_after_dot {
                self.advance(); // consume '.'
                while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                    self.advance();
                }
            }
        }

        if self.pos == start {
            return Err(ExprError::Parse("expected number".to_string()));
        }

        let num_str = &self.input[start..self.pos];
        num_str
            .parse::<f64>()
            .map_err(|e| ExprError::Parse(format!("invalid number '{num_str}': {e}")))
    }

    /// Parse a token path: `IDENT ('.' IDENT)*`
    fn parse_token_path(&mut self) -> Result<String, ExprError> {
        self.skip_whitespace();
        let start = self.pos;
        let first = self.parse_ident()?;
        if first.is_empty() {
            return Err(ExprError::Parse(
                "expected identifier in token path".to_string(),
            ));
        }

        while self.peek() == Some('.') {
            // Look ahead: is the char after '.' an ident start?
            let next_pos = self.pos + 1;
            let has_ident_after_dot = self
                .input
                .get(next_pos..)
                .and_then(|s| s.chars().next())
                .is_some_and(is_ident_start);

            if has_ident_after_dot {
                self.advance(); // consume '.'
                let segment = self.parse_ident()?;
                if segment.is_empty() {
                    return Err(ExprError::Parse(
                        "expected identifier after '.' in token path".to_string(),
                    ));
                }
            } else {
                break;
            }
        }

        Ok(self.input[start..self.pos].to_string())
    }

    /// Parse an identifier: `[a-zA-Z_][a-zA-Z0-9_]*`
    fn parse_ident(&mut self) -> Result<String, ExprError> {
        let start = self.pos;

        match self.peek() {
            Some(c) if is_ident_start(c) => {
                self.advance();
            }
            _ => {
                return Err(ExprError::Parse("expected identifier".to_string()));
            }
        }

        while self.peek().is_some_and(is_ident_continue) {
            self.advance();
        }

        Ok(self.input[start..self.pos].to_string())
    }

    /// Parse an identifier that could be a function call, or a bare token reference.
    ///
    /// If the identifier is followed by `(`, it is parsed as a function call.
    /// Otherwise, it is parsed as a bare token path reference.
    fn parse_ident_or_function_or_bare_ref(&mut self) -> Result<TokenExpression, ExprError> {
        let path = self.parse_token_path()?;

        self.skip_whitespace();
        if self.peek() == Some('(') {
            // Function call — the "path" is really just the function name.
            // We only allow simple identifiers as function names (no dots).
            if path.contains('.') {
                return Err(ExprError::Parse(format!(
                    "function name cannot contain '.': '{path}'"
                )));
            }
            self.advance(); // consume '('
            let args = self.parse_function_args()?;
            self.skip_whitespace();
            if self.peek() != Some(')') {
                return Err(ExprError::Parse(
                    "expected closing ')' in function call".to_string(),
                ));
            }
            self.advance(); // consume ')'
            Ok(TokenExpression::FunctionCall { name: path, args })
        } else {
            // Bare token reference.
            Ok(TokenExpression::TokenRef(path))
        }
    }

    /// Parse function arguments: `(expression (',' expression)*)?`
    fn parse_function_args(&mut self) -> Result<Vec<TokenExpression>, ExprError> {
        self.skip_whitespace();
        if self.peek() == Some(')') {
            return Ok(Vec::new());
        }

        let mut args = Vec::new();
        let first = self.expression()?;
        args.push(first);

        loop {
            self.skip_whitespace();
            if self.peek() == Some(',') {
                self.advance(); // consume ','
                if args.len() >= MAX_FUNCTION_ARGS {
                    return Err(ExprError::Parse(format!(
                        "function call exceeds maximum of {MAX_FUNCTION_ARGS} arguments"
                    )));
                }
                let arg = self.expression()?;
                args.push(arg);
            } else {
                break;
            }
        }

        Ok(args)
    }
}

/// Returns `true` if `c` is a valid identifier start character.
fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

/// Returns `true` if `c` is a valid identifier continuation character.
fn is_ident_continue(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Literal parsing ─────────────────────────────────────────────

    #[test]
    fn test_parse_number_literal() {
        let result = parse_expression("42").expect("should parse");
        assert_eq!(result, TokenExpression::Literal(ExprLiteral::Number(42.0)));
    }

    #[test]
    fn test_parse_float_literal() {
        let result = parse_expression("3.14").expect("should parse");
        assert_eq!(result, TokenExpression::Literal(ExprLiteral::Number(3.14)));
    }

    #[test]
    fn test_parse_percentage() {
        let result = parse_expression("20%").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::Literal(ExprLiteral::Percentage(0.2))
        );
    }

    // ── Token references ────────────────────────────────────────────

    #[test]
    fn test_parse_token_ref_bare() {
        let result = parse_expression("spacing.md").expect("should parse");
        assert_eq!(result, TokenExpression::TokenRef("spacing.md".to_string()));
    }

    #[test]
    fn test_parse_token_ref_braces() {
        let result = parse_expression("{spacing.md}").expect("should parse");
        assert_eq!(result, TokenExpression::TokenRef("spacing.md".to_string()));
    }

    // ── Binary operations ───────────────────────────────────────────

    #[test]
    fn test_parse_binary_add() {
        let result = parse_expression("{a} + {b}").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("a".to_string())),
                op: BinaryOperator::Add,
                right: Box::new(TokenExpression::TokenRef("b".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_binary_mul() {
        let result = parse_expression("{a} * 2").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("a".to_string())),
                op: BinaryOperator::Mul,
                right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
            }
        );
    }

    #[test]
    fn test_parse_precedence() {
        // {a} + {b} * 2 should parse as Add(a, Mul(b, 2))
        let result = parse_expression("{a} + {b} * 2").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("a".to_string())),
                op: BinaryOperator::Add,
                right: Box::new(TokenExpression::BinaryOp {
                    left: Box::new(TokenExpression::TokenRef("b".to_string())),
                    op: BinaryOperator::Mul,
                    right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
                }),
            }
        );
    }

    #[test]
    fn test_parse_parentheses() {
        // ({a} + {b}) * 2 should parse as Mul(Add(a, b), 2)
        let result = parse_expression("({a} + {b}) * 2").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::BinaryOp {
                    left: Box::new(TokenExpression::TokenRef("a".to_string())),
                    op: BinaryOperator::Add,
                    right: Box::new(TokenExpression::TokenRef("b".to_string())),
                }),
                op: BinaryOperator::Mul,
                right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
            }
        );
    }

    // ── Unary negation ──────────────────────────────────────────────

    #[test]
    fn test_parse_unary_neg() {
        let result = parse_expression("-{a}").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::UnaryNeg(Box::new(TokenExpression::TokenRef("a".to_string())))
        );
    }

    // ── Function calls ──────────────────────────────────────────────

    #[test]
    fn test_parse_function_no_args() {
        let result = parse_expression("pi()").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::FunctionCall {
                name: "pi".to_string(),
                args: vec![],
            }
        );
    }

    #[test]
    fn test_parse_function_one_arg() {
        let result = parse_expression("round({a})").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::FunctionCall {
                name: "round".to_string(),
                args: vec![TokenExpression::TokenRef("a".to_string())],
            }
        );
    }

    #[test]
    fn test_parse_function_multi_args() {
        let result = parse_expression("mix({a}, {b}, 50%)").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::FunctionCall {
                name: "mix".to_string(),
                args: vec![
                    TokenExpression::TokenRef("a".to_string()),
                    TokenExpression::TokenRef("b".to_string()),
                    TokenExpression::Literal(ExprLiteral::Percentage(0.5)),
                ],
            }
        );
    }

    #[test]
    fn test_parse_nested_function() {
        let result = parse_expression("lighten({x}, 20%)").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::FunctionCall {
                name: "lighten".to_string(),
                args: vec![
                    TokenExpression::TokenRef("x".to_string()),
                    TokenExpression::Literal(ExprLiteral::Percentage(0.2)),
                ],
            }
        );
    }

    #[test]
    fn test_parse_complex() {
        // round({a} * 1.5 + {b})
        let result = parse_expression("round({a} * 1.5 + {b})").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::FunctionCall {
                name: "round".to_string(),
                args: vec![TokenExpression::BinaryOp {
                    left: Box::new(TokenExpression::BinaryOp {
                        left: Box::new(TokenExpression::TokenRef("a".to_string())),
                        op: BinaryOperator::Mul,
                        right: Box::new(TokenExpression::Literal(ExprLiteral::Number(1.5))),
                    }),
                    op: BinaryOperator::Add,
                    right: Box::new(TokenExpression::TokenRef("b".to_string())),
                }],
            }
        );
    }

    // ── Guard tests ─────────────────────────────────────────────────

    #[test]
    fn test_max_expression_ast_depth_enforced() {
        // Build deeply nested expression: (((((...))))) exceeding MAX_EXPRESSION_AST_DEPTH
        let depth = MAX_EXPRESSION_AST_DEPTH + 1;
        let mut input = String::new();
        for _ in 0..depth {
            input.push('(');
        }
        input.push('1');
        for _ in 0..depth {
            input.push(')');
        }

        let result = parse_expression(&input);
        assert!(result.is_err(), "should reject deeply nested expression");
        let err = result.unwrap_err();
        match &err {
            ExprError::Parse(msg) => {
                assert!(
                    msg.contains("maximum depth"),
                    "error should mention depth: {msg}"
                );
            }
            _ => panic!("expected Parse error, got: {err}"),
        }
    }

    #[test]
    fn test_max_token_expression_length_enforced() {
        let input = "a".repeat(MAX_TOKEN_EXPRESSION_LENGTH + 1);
        let result = parse_expression(&input);
        assert!(result.is_err(), "should reject overly long expression");
        let err = result.unwrap_err();
        match &err {
            ExprError::Parse(msg) => {
                assert!(
                    msg.contains("maximum length"),
                    "error should mention length: {msg}"
                );
            }
            _ => panic!("expected Parse error, got: {err}"),
        }
    }

    #[test]
    fn test_max_function_args_enforced() {
        // Build function call with MAX_FUNCTION_ARGS + 1 arguments
        let arg_count = MAX_FUNCTION_ARGS + 1;
        let args: Vec<String> = (0..arg_count).map(|_| "1".to_string()).collect();
        let input = format!("f({})", args.join(", "));

        let result = parse_expression(&input);
        assert!(
            result.is_err(),
            "should reject function call with too many arguments"
        );
        let err = result.unwrap_err();
        match &err {
            ExprError::Parse(msg) => {
                assert!(
                    msg.contains("maximum"),
                    "error should mention maximum: {msg}"
                );
            }
            _ => panic!("expected Parse error, got: {err}"),
        }
    }

    // ── Error cases ─────────────────────────────────────────────────

    #[test]
    fn test_parse_empty_string() {
        let result = parse_expression("");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match &err {
            ExprError::Parse(msg) => {
                assert!(msg.contains("empty"), "error should mention empty: {msg}");
            }
            _ => panic!("expected Parse error, got: {err}"),
        }
    }

    #[test]
    fn test_parse_invalid_syntax() {
        let result = parse_expression("+ +");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_unclosed_paren() {
        let result = parse_expression("(1 + 2");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match &err {
            ExprError::Parse(msg) => {
                assert!(
                    msg.contains(")") || msg.contains("closing"),
                    "error should mention closing paren: {msg}"
                );
            }
            _ => panic!("expected Parse error, got: {err}"),
        }
    }

    #[test]
    fn test_parse_unclosed_brace() {
        let result = parse_expression("{foo");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match &err {
            ExprError::Parse(msg) => {
                assert!(
                    msg.contains("}") || msg.contains("closing"),
                    "error should mention closing brace: {msg}"
                );
            }
            _ => panic!("expected Parse error, got: {err}"),
        }
    }

    #[test]
    fn test_parse_trailing_input() {
        let result = parse_expression("1 + 2 +");
        assert!(result.is_err());
    }

    // ── Additional edge cases ───────────────────────────────────────

    #[test]
    fn test_parse_whitespace_handling() {
        let result = parse_expression("  {a}   +   {b}  ").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("a".to_string())),
                op: BinaryOperator::Add,
                right: Box::new(TokenExpression::TokenRef("b".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_subtraction() {
        let result = parse_expression("{a} - {b}").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("a".to_string())),
                op: BinaryOperator::Sub,
                right: Box::new(TokenExpression::TokenRef("b".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_division() {
        let result = parse_expression("{a} / 2").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::BinaryOp {
                left: Box::new(TokenExpression::TokenRef("a".to_string())),
                op: BinaryOperator::Div,
                right: Box::new(TokenExpression::Literal(ExprLiteral::Number(2.0))),
            }
        );
    }

    #[test]
    fn test_parse_multi_segment_token_path() {
        let result = parse_expression("{color.primary.base}").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::TokenRef("color.primary.base".to_string())
        );
    }

    #[test]
    fn test_parse_bare_single_ident() {
        let result = parse_expression("spacing").expect("should parse");
        assert_eq!(result, TokenExpression::TokenRef("spacing".to_string()));
    }

    #[test]
    fn test_parse_underscore_ident() {
        let result = parse_expression("{_private_token}").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::TokenRef("_private_token".to_string())
        );
    }

    #[test]
    fn test_parse_double_negation() {
        let result = parse_expression("--1").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::UnaryNeg(Box::new(TokenExpression::UnaryNeg(Box::new(
                TokenExpression::Literal(ExprLiteral::Number(1.0))
            ))))
        );
    }

    #[test]
    fn test_parse_percentage_100() {
        let result = parse_expression("100%").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::Literal(ExprLiteral::Percentage(1.0))
        );
    }

    #[test]
    fn test_parse_zero_percentage() {
        let result = parse_expression("0%").expect("should parse");
        assert_eq!(
            result,
            TokenExpression::Literal(ExprLiteral::Percentage(0.0))
        );
    }
}
