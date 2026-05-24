# Expression Engine (Spec 13d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expression parser, evaluator, and function library to the core crate so token values can be computed expressions (e.g. `{spacing.md * 2}`, `{lighten(brand.primary, 20%)}`) rather than just literals or aliases. Also adds composite token types (Typography, Shadow, Border) and an atomic RenameToken operation.

**Architecture:** A hand-written recursive descent parser in the core crate produces an AST (`TokenExpression`). The evaluator walks the AST, resolving token references via `TokenContext::resolve()` and dispatching function calls to a registry. Color functions operate in HSL space internally (converting from/to sRGB). The frontend mirrors the evaluator in TypeScript for live preview. Composite tokens store sub-fields as `TokenExpression` values. All new code is pure computation — no I/O, WASM-safe.

**Tech Stack:** Rust (core crate), TypeScript (frontend evaluator), no new dependencies.

**Includes deferred finding:** RF-008 (atomic RenameToken FieldOperation)

---

## File Structure

### New files (Core Crate)

| File | Responsibility |
|------|---------------|
| `crates/core/src/tokens/mod.rs` | Token module root — re-exports from sub-modules |
| `crates/core/src/tokens/expression.rs` | `TokenExpression`, `ExprLiteral`, `BinaryOperator` AST types |
| `crates/core/src/tokens/parser.rs` | Recursive descent parser: string → `TokenExpression` |
| `crates/core/src/tokens/evaluator.rs` | AST evaluator: `TokenExpression` + `TokenContext` → `EvalResult` |
| `crates/core/src/tokens/functions/mod.rs` | Function registry + dispatch |
| `crates/core/src/tokens/functions/math.rs` | `round`, `ceil`, `floor`, `abs`, `min`, `max`, `clamp` |
| `crates/core/src/tokens/functions/size.rs` | `rem`, `em`, `px` conversion |
| `crates/core/src/tokens/functions/color.rs` | `lighten`, `darken`, `saturate`, `desaturate`, `alpha`, `mix`, `contrast`, `complement`, `hue`, channel setters/adjusters/extractors |
| `crates/core/src/tokens/functions/blend.rs` | `blend` with 11 blend modes |
| `crates/core/src/tokens/color_convert.rs` | sRGB ↔ HSL conversion helpers |
| `crates/core/src/tokens/composite.rs` | `CompositeTokenValue`, `TypographyToken`, `ShadowToken`, `BorderToken` |
| `crates/core/src/tokens/errors.rs` | `ExprError` enum (ParseError, TypeError, etc.) |

### New files (Frontend)

| File | Responsibility |
|------|---------------|
| `frontend/src/store/expression-eval.ts` | TypeScript expression evaluator (mirrors core for live preview) |
| `frontend/src/store/__tests__/expression-eval.test.ts` | Tests for frontend evaluator |

### Modified files

| File | Changes |
|------|---------|
| `crates/core/src/token.rs` | Refactor into `crates/core/src/tokens/` module, add `Expression` variant to `TokenValue` |
| `crates/core/src/lib.rs` | Update module declaration and re-exports |
| `crates/core/src/validate.rs` | Add expression validation constants |
| `crates/core/src/error.rs` | Add expression error variants |
| `crates/core/src/commands/token_commands.rs` | Add `RenameToken` FieldOperation |
| `crates/server/src/graphql/mutation.rs` | Add `RenameToken` to GraphQL mutations |
| `crates/server/src/graphql/types.rs` | Add expression-related input types |
| `crates/mcp/src/tools/tokens.rs` | Add `rename_token` MCP tool |
| `frontend/src/types/document.ts` | Add expression TokenValue variant |
| `frontend/src/store/token-store.ts` | Integrate expression evaluation |
| `frontend/src/store/document-store-solid.tsx` | Add `renameToken` store method |
| `frontend/src/operations/apply-remote.ts` | Add `rename_token` handler |

---

## Task Decomposition

### Task 1: Refactor token.rs into tokens/ module + expression AST types

**Files:**
- Create: `crates/core/src/tokens/mod.rs`
- Create: `crates/core/src/tokens/expression.rs`
- Create: `crates/core/src/tokens/errors.rs`
- Move: `crates/core/src/token.rs` → `crates/core/src/tokens/types.rs` (existing Token, TokenValue, etc.)
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/core/src/validate.rs`

This task restructures the single `token.rs` file into a `tokens/` module directory, adds the expression AST types, and adds expression-related error types and validation constants. No behavioral changes — all existing tests must continue to pass.

**Expression AST types to define:**
```rust
// tokens/expression.rs
pub enum TokenExpression {
    Literal(ExprLiteral),
    TokenRef(String),
    BinaryOp { left: Box<TokenExpression>, op: BinaryOperator, right: Box<TokenExpression> },
    UnaryNeg(Box<TokenExpression>),
    FunctionCall { name: String, args: Vec<TokenExpression> },
}

pub enum ExprLiteral {
    Number(f64),
    Percentage(f64),  // 20% stored as 0.2
    Color(Color),
    Str(String),
}

pub enum BinaryOperator { Add, Sub, Mul, Div }
```

**Validation constants to add:**
```rust
pub const MAX_TOKEN_EXPRESSION_LENGTH: usize = 1024;
pub const MAX_EXPRESSION_AST_DEPTH: usize = 32;
pub const MAX_FUNCTION_ARGS: usize = 8;
```

**Error types to add:**
```rust
pub enum ExprError {
    Parse(String),
    UnknownFunction(String),
    ArityError { name: String, expected: usize, got: usize },
    TypeError { expected: String, got: String },
    CycleDetected(String),
    DepthExceeded,
    ReferenceNotFound(String),
    DomainError(String),
    DivisionByZero,
}
```

**Key constraint:** The module refactor must preserve ALL existing public API — `Token`, `TokenValue`, `TokenContext`, `TokenType`, etc. must continue to be importable from `agent_designer_core`. Run `cargo test --workspace` and `cargo clippy --workspace` after the refactor.

- [ ] Step 1: Create `crates/core/src/tokens/` directory
- [ ] Step 2: Move `token.rs` to `tokens/types.rs`, update `mod.rs` to re-export everything
- [ ] Step 3: Update `lib.rs` to use `mod tokens` instead of `mod token`
- [ ] Step 4: Run `cargo test --workspace` — all existing tests must pass
- [ ] Step 5: Create `tokens/expression.rs` with AST types (derive Serialize, Deserialize, Debug, Clone, PartialEq)
- [ ] Step 6: Create `tokens/errors.rs` with `ExprError` enum (use `thiserror`)
- [ ] Step 7: Add validation constants to `validate.rs`
- [ ] Step 8: Run `cargo test --workspace && cargo clippy --workspace -- -D warnings`
- [ ] Step 9: Commit: `refactor(core): restructure token.rs into tokens/ module, add expression AST types (spec-13d)`

---

### Task 2: Expression parser (recursive descent)

**Files:**
- Create: `crates/core/src/tokens/parser.rs`
- Test: inline `#[cfg(test)]` module

The parser converts a string expression into a `TokenExpression` AST. It implements the grammar from the spec with standard operator precedence (+/- < */  < unary neg).

**Public API:**
```rust
pub fn parse_expression(input: &str) -> Result<TokenExpression, ExprError>;
```

**Grammar (from spec §2.1):**
```
expression     = term (('+' | '-') term)*
term           = factor (('*' | '/') factor)*
factor         = '-' factor | atom
atom           = number | percentage | function_call | token_ref | '(' expression ')'
number         = DIGIT+ ('.' DIGIT+)?
percentage     = number '%'
function_call  = IDENT '(' (expression (',' expression)*)? ')'
token_ref      = '{' TOKEN_PATH '}' | TOKEN_PATH  (braces optional for standalone)
TOKEN_PATH     = IDENT ('.' IDENT)*
```

**Key behaviors:**
- Depth guard: track nesting depth, return `ExprError::Parse` when `>= MAX_EXPRESSION_AST_DEPTH`
- Input length guard: reject inputs longer than `MAX_TOKEN_EXPRESSION_LENGTH`
- Function arg count guard: reject calls with `> MAX_FUNCTION_ARGS` arguments
- Bare token path (no operators) → `TokenRef` node
- Percentage `20%` → `ExprLiteral::Percentage(0.2)`
- Whitespace is ignored between tokens

**Tests to write (minimum):**
- `test_parse_number_literal` — `42` → `Literal(Number(42.0))`
- `test_parse_percentage` — `20%` → `Literal(Percentage(0.2))`
- `test_parse_token_ref_bare` — `spacing.md` → `TokenRef("spacing.md")`
- `test_parse_token_ref_braces` — `{spacing.md}` → `TokenRef("spacing.md")`
- `test_parse_binary_add` — `{a} + {b}` → `BinaryOp(TokenRef("a"), Add, TokenRef("b"))`
- `test_parse_precedence` — `{a} + {b} * 2` → `BinaryOp(TokenRef("a"), Add, BinaryOp(TokenRef("b"), Mul, Literal(2)))`
- `test_parse_parentheses` — `({a} + {b}) * 2` → `BinaryOp(BinaryOp(...), Mul, Literal(2))`
- `test_parse_unary_neg` — `-{a}` → `UnaryNeg(TokenRef("a"))`
- `test_parse_function_call` — `round({a} * 1.5)` → `FunctionCall("round", [BinaryOp(...)])`
- `test_parse_nested_function` — `lighten({brand.primary}, 20%)` → `FunctionCall("lighten", [TokenRef("brand.primary"), Literal(Percentage(0.2))])`
- `test_parse_max_depth_exceeded` — deeply nested parens → `ExprError::Parse`
- `test_parse_max_length_exceeded` — string > 1024 chars → `ExprError::Parse`
- `test_parse_empty_string` — `""` → `ExprError::Parse`
- `test_parse_invalid_syntax` — `+ +` → `ExprError::Parse`

- [ ] Step 1: Write failing tests for parser
- [ ] Step 2: Implement `parse_expression` with a `Parser` struct holding position/depth
- [ ] Step 3: Run tests, verify all pass
- [ ] Step 4: Run clippy
- [ ] Step 5: Commit: `feat(core): add expression parser with recursive descent (spec-13d)`

---

### Task 3: Color conversion helpers (sRGB ↔ HSL)

**Files:**
- Create: `crates/core/src/tokens/color_convert.rs`
- Test: inline `#[cfg(test)]` module

Color functions (lighten, darken, saturate, etc.) operate in HSL space. Need conversion helpers that work with the existing `Color` enum.

**Public API:**
```rust
pub fn srgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64); // h: 0-360, s: 0-1, l: 0-1
pub fn hsl_to_srgb(h: f64, s: f64, l: f64) -> (f64, f64, f64); // r,g,b: 0-1
pub fn color_to_srgb(color: &Color) -> (f64, f64, f64, f64);     // returns (r,g,b,a) in 0-1
pub fn srgb_to_color(r: f64, g: f64, b: f64, a: f64) -> Color;
```

All functions guard against NaN/Infinity and return finite values. Color channel clamping is acceptable here (function outputs, not user inputs — per spec §6.2).

**Tests:** Round-trip (sRGB → HSL → sRGB), known values (red = 0°, green = 120°, blue = 240°), edge cases (black, white, gray — undefined hue preserved as 0).

- [ ] Step 1: Write failing tests for color conversion
- [ ] Step 2: Implement conversion functions
- [ ] Step 3: Run tests
- [ ] Step 4: Commit: `feat(core): add sRGB ↔ HSL color conversion helpers (spec-13d)`

---

### Task 4: Expression evaluator

**Files:**
- Create: `crates/core/src/tokens/evaluator.rs`
- Test: inline `#[cfg(test)]` module

The evaluator walks a `TokenExpression` AST and produces an `EvalResult`.

**Public API:**
```rust
pub enum EvalValue {
    Number(f64),
    Color(Color),
    Str(String),
}

pub fn evaluate(
    expr: &TokenExpression,
    context: &TokenContext,
    depth: usize,
) -> Result<EvalValue, ExprError>;
```

**Evaluation rules:**
- `Literal(Number(n))` → `EvalValue::Number(n)`
- `Literal(Percentage(p))` → `EvalValue::Number(p)` (percentage is just a number for math)
- `Literal(Color(c))` → `EvalValue::Color(c)`
- `Literal(Str(s))` → `EvalValue::Str(s)`
- `TokenRef(name)` → resolve via `context.resolve()`, convert `TokenValue` to `EvalValue`
- `BinaryOp` → evaluate both sides, both must be `Number`, apply operator. Division by zero → `DivisionByZero`
- `UnaryNeg` → evaluate inner, must be `Number`, negate
- `FunctionCall` → look up in function registry (Task 5), evaluate args, dispatch

**Tests:** Literal evaluation, token reference resolution (need a test `TokenContext`), arithmetic, division by zero, type mismatch errors, unknown token reference, depth exceeded.

- [ ] Step 1: Write failing tests
- [ ] Step 2: Implement `evaluate` function (function calls return `UnknownFunction` for now — registry comes in Task 5)
- [ ] Step 3: Run tests
- [ ] Step 4: Commit: `feat(core): add expression evaluator with token resolution (spec-13d)`

---

### Task 5: Function registry + math functions

**Files:**
- Create: `crates/core/src/tokens/functions/mod.rs`
- Create: `crates/core/src/tokens/functions/math.rs`
- Create: `crates/core/src/tokens/functions/size.rs`
- Modify: `crates/core/src/tokens/evaluator.rs` — wire registry into evaluator
- Test: inline `#[cfg(test)]` modules

**Registry design:**
```rust
pub fn call_function(
    name: &str,
    args: &[EvalValue],
) -> Result<EvalValue, ExprError>;
```

A match-based dispatch (not a HashMap — the function set is fixed and known at compile time).

**Math functions (7):** `round`, `ceil`, `floor`, `abs`, `min`, `max`, `clamp`
**Size functions (3):** `rem(px)`, `em(px)`, `px(rem)` — base size 16.0

All validate argument count (ArityError) and types (TypeError). All numeric results guarded with `f64::is_finite()`.

**Tests:** Each function with valid input, wrong arity, wrong type, edge cases (clamp min > max, division edge cases).

- [ ] Step 1: Write failing tests for math functions
- [ ] Step 2: Implement math functions
- [ ] Step 3: Write failing tests for size functions
- [ ] Step 4: Implement size functions
- [ ] Step 5: Wire `call_function` into evaluator
- [ ] Step 6: Write integration test: `parse_expression("round({a} * 1.5)")` → evaluate with context → correct result
- [ ] Step 7: Run all tests
- [ ] Step 8: Commit: `feat(core): add function registry with math and size functions (spec-13d)`

---

### Task 6: Color functions

**Files:**
- Create: `crates/core/src/tokens/functions/color.rs`
- Modify: `crates/core/src/tokens/functions/mod.rs` — add color function dispatch
- Test: inline `#[cfg(test)]` module

**Color manipulation (9):** `lighten`, `darken`, `saturate`, `desaturate`, `alpha`, `mix`, `contrast`, `complement`, `hue`

**Channel setters (6):** `setRed`, `setGreen`, `setBlue`, `setHue`, `setSaturation`, `setLightness`

**Channel adjusters (6):** `adjustRed`, `adjustGreen`, `adjustBlue`, `adjustHue`, `adjustSaturation`, `adjustLightness`

**Channel extractors (6):** `red`, `green`, `blue`, `hueOf`, `saturationOf`, `lightnessOf`

All functions:
- Validate first arg is `Color` (TypeError if not)
- Validate numeric args with `f64::is_finite()`
- Convert to sRGB internally via `color_to_srgb()`, operate in HSL where needed, convert back
- Clamp output channels to valid ranges (acceptable per spec — function outputs, not user inputs)

**Tests:** Each function with known input/output, wrong types, edge cases (lighten 100% = white, darken 100% = black, mix 0% = color1, mix 100% = color2, contrast on dark = white, contrast on light = black).

- [ ] Step 1: Write tests for color manipulation functions
- [ ] Step 2: Implement color manipulation functions
- [ ] Step 3: Write tests for channel setters/adjusters/extractors
- [ ] Step 4: Implement channel functions
- [ ] Step 5: Wire into function registry
- [ ] Step 6: Integration test: `parse_expression("lighten({brand.primary}, 20%)")` → evaluate → lighter color
- [ ] Step 7: Run all tests
- [ ] Step 8: Commit: `feat(core): add color manipulation functions (spec-13d)`

---

### Task 7: Blend mode functions

**Files:**
- Create: `crates/core/src/tokens/functions/blend.rs`
- Modify: `crates/core/src/tokens/functions/mod.rs`
- Test: inline `#[cfg(test)]` module

**Single function:** `blend(color1, color2, mode_string)` → blended color

**11 blend modes:** `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`

Each mode is a per-channel mathematical operation on sRGB values (0-1 range). Alpha is composited separately.

**Tests:** Each blend mode with known inputs, unknown mode string → error, wrong arg types.

- [ ] Step 1: Write tests
- [ ] Step 2: Implement blend modes
- [ ] Step 3: Wire into registry
- [ ] Step 4: Run tests
- [ ] Step 5: Commit: `feat(core): add blend mode function (spec-13d)`

---

### Task 8: RenameToken FieldOperation (RF-008)

**Files:**
- Modify: `crates/core/src/commands/token_commands.rs`
- Modify: `crates/server/src/graphql/mutation.rs`
- Modify: `crates/server/src/graphql/types.rs`
- Modify: `crates/mcp/src/tools/tokens.rs`
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/operations/apply-remote.ts`
- Modify: `frontend/src/operations/types.ts`
- Modify: `frontend/src/panels/token-editor/TokenEditor.tsx`
- Modify: `frontend/src/panels/TokensPanel.tsx`
- Test: inline tests in `token_commands.rs`

**Core crate:**
```rust
pub struct RenameToken {
    pub old_name: String,
    pub new_name: String,
}

impl FieldOperation for RenameToken {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // old_name must exist
        // new_name must pass validate_token_name()
        // new_name must not already exist
    }
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        // Remove token by old_name, re-insert with new_name (preserving id, value, type, description)
    }
}
```

**Server:** Add `RenameTokenInput { old_name, new_name }` to GraphQL mutations, broadcast `rename_token` op_type.

**MCP:** Add `rename_token_impl` tool.

**Frontend:** Replace the create+delete rename pattern in `TokenEditor.tsx` and `TokensPanel.tsx` with the atomic `renameToken` store method. Add `rename_token` handler in `apply-remote.ts`.

**Tests:** Rename success, rename to existing name (reject), rename nonexistent (reject), rename preserves token id.

- [ ] Step 1: Write failing tests for RenameToken validate/apply
- [ ] Step 2: Implement RenameToken FieldOperation
- [ ] Step 3: Add GraphQL mutation + broadcast
- [ ] Step 4: Add MCP tool
- [ ] Step 5: Add frontend store method + apply-remote handler
- [ ] Step 6: Update TokenEditor and TokensPanel to use atomic rename
- [ ] Step 7: Run all tests (Rust + frontend)
- [ ] Step 8: Commit: `feat: add atomic RenameToken operation across all transports (spec-13d, RF-008)`

---

### Task 9: Frontend expression evaluator

**Files:**
- Create: `frontend/src/store/expression-eval.ts`
- Create: `frontend/src/store/__tests__/expression-eval.test.ts`
- Modify: `frontend/src/store/token-store.ts`
- Modify: `frontend/src/types/document.ts`

**TypeScript evaluator** mirrors the core crate evaluator for live preview in the browser. Since we can't run Rust in the browser yet (pre-WASM), the frontend needs its own evaluator.

**Scope:** Parser + evaluator + math/size functions + color functions. Blend modes can be deferred (they're rarely used in live preview).

**Integration:** Update `resolveToken()` in `token-store.ts` to detect expression values and evaluate them using the new evaluator.

**Tests:** Parse + evaluate round-trip tests matching the Rust tests.

- [ ] Step 1: Add `expression` variant to frontend `TokenValue` type
- [ ] Step 2: Write failing tests for expression parser
- [ ] Step 3: Implement TypeScript expression parser
- [ ] Step 4: Write failing tests for evaluator
- [ ] Step 5: Implement TypeScript evaluator with function registry
- [ ] Step 6: Integrate into `resolveToken()` in token-store.ts
- [ ] Step 7: Run all frontend tests
- [ ] Step 8: Commit: `feat(frontend): add expression parser and evaluator for live preview (spec-13d)`

---

### Task 10: Integration verification

**Files:** None new — verification only.

- [ ] Step 1: Run `cargo test --workspace` — all Rust tests pass
- [ ] Step 2: Run `cargo clippy --workspace -- -D warnings` — no warnings
- [ ] Step 3: Run `cargo fmt --check` — formatted
- [ ] Step 4: Run `pnpm --prefix frontend test -- --run` — all frontend tests pass
- [ ] Step 5: Run `pnpm --prefix frontend lint` — no lint errors
- [ ] Step 6: Run `pnpm --prefix frontend build` — build succeeds
- [ ] Step 7: Commit any remaining fixes

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| §2.1 Syntax / Grammar | Task 2 (parser) |
| §2.2 AST Types | Task 1 (expression.rs) |
| §2.3 Function Registry — math | Task 5 |
| §2.3 Function Registry — size | Task 5 |
| §2.3 Function Registry — color | Task 6 |
| §2.3 Function Registry — channel ops | Task 6 |
| §2.3 Function Registry — blend | Task 7 |
| §2.4 Evaluator | Task 4 |
| §2.4 Error types | Task 1 (errors.rs) |
| §2.5 Composite token types | Deferred to separate plan (composites need UI work in 13e) |
| §6.2 Validation constants | Task 1 |
| §9 Recursion safety | Task 2 (parser depth) + Task 4 (evaluator depth) |
| RF-008 Atomic rename | Task 8 |

### Deferred from this plan
- **Composite token types** (TypographyToken, ShadowToken, BorderToken) — deferred because they need UI support (13e) to be useful. The expression engine doesn't depend on composites; composites depend on expressions. Ship expressions first, add composites when the enhanced input (13e) can edit them.
- **Server-side expression validation** — the server stores expression strings as-is in TokenValue. Validation (parsing) happens when the frontend evaluates them. Server-side parsing can be added when the core crate evaluator is used for export (M4 plugin system).
