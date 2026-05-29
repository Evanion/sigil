//! Liveness endpoint for the Tauri shell's supervision task.
//!
//! Spec 20 §3.3: the desktop shell pings `/heartbeat` on a fixed cadence to
//! detect a wedged or unresponsive sidecar. The handler is deliberately
//! trivial (constant 200) — supervision logic lives in the Tauri shell
//! (Task 13), not in the server.
//!
//! This route MUST be mounted OUTSIDE the `X-Sigil-Session` middleware
//! layer: the heartbeat is session-less by design (the shell has no session
//! when it first probes liveness), and adding the middleware would force
//! the shell to invent an unused session id.

use axum::http::StatusCode;

/// Returns 200 OK. The body is empty — the supervision task in the Tauri
/// shell only checks the status code.
pub async fn handler() -> StatusCode {
    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn handler_returns_200() {
        assert_eq!(handler().await, StatusCode::OK);
    }
}
