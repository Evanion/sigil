#![warn(clippy::all, clippy::pedantic)]

//! `sigil-cli` — operational tooling for `.sigil/` workfiles.
//!
//! Subcommands live in dedicated modules; this file contains only the
//! clap argument surface and dispatch.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

mod migrate;

/// Top-level CLI entry. Running `sigil-cli` with no arguments prints the
/// build version (preserved from the original stub).
#[derive(Debug, Parser)]
#[command(name = "sigil-cli", version, about = "Sigil workfile tooling", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Migrate a `.sigil/` workfile in place from schema v1 to the current
    /// schema. Originals are copied to `<path>/.backup-v1/` before any
    /// overwrite.
    Migrate {
        /// Path to the `.sigil/` directory to migrate.
        path: PathBuf,
        /// Validate only — report whether migration would succeed without
        /// modifying any files on disk.
        #[arg(long)]
        check: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        None => {
            println!("sigil-cli v{}", agent_designer_core::version());
            ExitCode::SUCCESS
        }
        Some(Command::Migrate { path, check }) => {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            match migrate::run(&path, check, &mut handle) {
                Ok(outcome) if outcome.had_failures() => ExitCode::from(1),
                Ok(_) => ExitCode::SUCCESS,
                Err(err) => {
                    eprintln!("error: {err:#}");
                    ExitCode::from(2)
                }
            }
        }
    }
}
