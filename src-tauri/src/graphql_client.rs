//! Minimal GraphQL client for shell→server calls (openSession, closeSession,
//! sessions query). Not session-scoped; never sends X-Sigil-Session header.

use std::time::Duration;

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone)]
pub struct GqlClient {
    base_url: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    #[serde(rename = "workfilePath")]
    pub workfile_path: String,
    pub title: String,
    #[serde(rename = "openedAt")]
    pub opened_at: String,
    pub state: String,
}

impl GqlClient {
    pub fn new(port: u16) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client");
        Self {
            base_url: format!("http://127.0.0.1:{port}/graphql"),
            http,
        }
    }

    pub async fn open_session(&self, path: &std::path::Path) -> Result<SessionInfo> {
        let body = serde_json::json!({
            "query": "mutation($p: String!) { openSession(path: $p) { id workfilePath title openedAt state } }",
            "variables": { "p": path.to_string_lossy() }
        });
        let resp: Value = self
            .http
            .post(&self.base_url)
            .json(&body)
            .send()
            .await?
            .json()
            .await?;

        if let Some(errors) = resp.pointer("/errors") {
            anyhow::bail!("openSession errors: {errors}");
        }
        serde_json::from_value(
            resp.pointer("/data/openSession")
                .cloned()
                .context("missing data")?,
        )
        .context("parse SessionInfo")
    }

    pub async fn close_session(&self, id: &str) -> Result<()> {
        let body = serde_json::json!({
            "query": "mutation($id: ID!) { closeSession(id: $id) }",
            "variables": { "id": id }
        });
        let resp: Value = self
            .http
            .post(&self.base_url)
            .json(&body)
            .send()
            .await?
            .json()
            .await?;
        if let Some(errors) = resp.pointer("/errors") {
            anyhow::bail!("closeSession errors: {errors}");
        }
        Ok(())
    }
}
