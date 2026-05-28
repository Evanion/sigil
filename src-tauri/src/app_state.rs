//! Tauri-side application state: server handle, window registry, GraphQL client.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::graphql_client::GqlClient;
use crate::sidecar::SidecarProcess;

pub struct AppState {
    // server_proc is mutated on crash recovery (windows::handle_crash drops
    // the dead child and stores the freshly-spawned one). Graceful Tauri-quit
    // shutdown wiring lands in a later task; the field's storage role is
    // independent of that.
    pub server_proc: Mutex<Option<SidecarProcess>>,
    pub windows: Mutex<HashMap<String, WindowBinding>>,
    pub gql: GqlClient,
    pub server_port: u16,
}

#[derive(Debug, Clone)]
pub struct WindowBinding {
    pub workfile_path: PathBuf,
    pub session_id: String,
}

impl AppState {
    pub fn new(sidecar: SidecarProcess) -> Self {
        let port = sidecar.port;
        Self {
            server_proc: Mutex::new(Some(sidecar)),
            windows: Mutex::new(HashMap::new()),
            gql: GqlClient::new(port),
            server_port: port,
        }
    }

    pub fn first_window_for_path(&self, path: &std::path::Path) -> Option<String> {
        self.windows
            .lock()
            .expect("windows lock")
            .iter()
            .find(|(_, b)| b.workfile_path == path)
            .map(|(k, _)| k.clone())
    }
}
