//! Heartbeat task that pings the sidecar server and detects crashes.
//!
//! On `MAX_FAILURES` consecutive heartbeat failures the supervisor sends
//! `SupervisionEvent::CrashDetected` on its event channel. The consumer
//! (the Tauri shell) listens on this channel and triggers crash recovery
//! UI + sidecar relaunch.

use std::time::Duration;

use tokio::sync::mpsc;

/// How often the supervisor pings `/heartbeat`.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// Per-request HTTP timeout. Set lower than `HEARTBEAT_INTERVAL` so a hung
/// server is treated as a heartbeat failure rather than stalling the loop.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(2);

/// Number of consecutive failures before declaring a crash.
const MAX_FAILURES: u32 = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisionEvent {
    Healthy,
    CrashDetected,
}

pub struct Supervisor {
    port: u16,
    tx: mpsc::Sender<SupervisionEvent>,
    failures: u32,
    /// RF-004: after firing `CrashDetected`, the supervisor enters a "draining"
    /// state until it observes the next `Healthy` ping. While draining, failed
    /// pings DO NOT increment `failures`, so a second `CrashDetected` cannot
    /// fire while the consumer is mid-recovery. The flag clears when the new
    /// sigil-server responds to `/heartbeat`, signaling recovery is complete.
    draining: bool,
}

impl Supervisor {
    /// Construct a supervisor for the given port. Returns the supervisor and
    /// the receiver end of its event channel.
    pub fn new(port: u16) -> (Self, mpsc::Receiver<SupervisionEvent>) {
        let (tx, rx) = mpsc::channel(16);
        (
            Self {
                port,
                tx,
                failures: 0,
                draining: false,
            },
            rx,
        )
    }

    /// Run the heartbeat loop until the receiver is dropped or the client
    /// fails to build. Sends `Healthy` on each success and `CrashDetected`
    /// after `MAX_FAILURES` consecutive failures (then resets the counter).
    pub async fn run(mut self) {
        let client = match reqwest::Client::builder()
            .timeout(HEARTBEAT_TIMEOUT)
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("supervisor: failed to build http client: {e}");
                return;
            }
        };
        let url = format!("http://127.0.0.1:{}/heartbeat", self.port);

        let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if self.draining {
                        tracing::info!("heartbeat returned after crash recovery — resuming");
                        self.draining = false;
                    } else if self.failures > 0 {
                        tracing::info!("heartbeat recovered after {} failures", self.failures);
                    }
                    self.failures = 0;
                    if self.tx.send(SupervisionEvent::Healthy).await.is_err() {
                        // Receiver dropped — supervisor is no longer needed.
                        return;
                    }
                }
                Ok(resp) => {
                    if !self.draining {
                        self.failures += 1;
                    }
                    tracing::warn!(
                        status = %resp.status(),
                        failures = self.failures,
                        draining = self.draining,
                        "heartbeat non-2xx",
                    );
                }
                Err(e) => {
                    if !self.draining {
                        self.failures += 1;
                    }
                    tracing::warn!(
                        error = %e,
                        failures = self.failures,
                        draining = self.draining,
                        "heartbeat error",
                    );
                }
            }
            if !self.draining && self.failures >= MAX_FAILURES {
                tracing::error!("heartbeat failed {} times — declaring crash", self.failures);
                if self.tx.send(SupervisionEvent::CrashDetected).await.is_err() {
                    return;
                }
                // RF-004: enter draining state. Subsequent failures don't
                // increment the counter and don't re-fire CrashDetected until
                // the new server responds to a heartbeat. This prevents the
                // double-respawn race when handle_crash takes longer than
                // MAX_FAILURES * HEARTBEAT_INTERVAL to bring the new server up.
                self.failures = 0;
                self.draining = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_returns_supervisor_and_channel() {
        let (sup, rx) = Supervisor::new(4680);
        assert_eq!(sup.port, 4680);
        assert_eq!(sup.failures, 0);
        assert!(!sup.draining);
        // The receiver is held so the channel stays open.
        drop(rx);
    }

    #[test]
    fn supervision_event_is_clonable_and_comparable() {
        let healthy = SupervisionEvent::Healthy;
        let crash = SupervisionEvent::CrashDetected;
        assert_eq!(healthy.clone(), SupervisionEvent::Healthy);
        assert_eq!(crash.clone(), SupervisionEvent::CrashDetected);
        assert_ne!(healthy, crash);
    }

    // Live HTTP behavior is exercised by integration tests in Task 22.
}
