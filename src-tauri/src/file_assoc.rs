//! argv parsing for "open with Sigil" workflows.
//!
//! When a user double-clicks a `.sigil/` workfile in Finder/Explorer, the
//! OS launches Sigil with the workfile path appended to argv. This module
//! extracts that path so the Tauri shell can pass it through to the
//! spawned sidecar via the `--workfile` flag.

use std::path::PathBuf;

/// Scan argv for the first positional argument that looks like a `.sigil`
/// workfile path. Skips CLI flags (`--foo`) and macOS Launch Services'
/// legacy `-psn_<pid>_<seq>` process serial number argument. Returns
/// `None` if no `.sigil` argument is present.
pub fn extract_workfile_path(argv: &[String]) -> Option<PathBuf> {
    for arg in argv.iter().skip(1) {
        if arg.starts_with("--") {
            continue;
        }
        if arg.starts_with("-psn_") {
            continue;
        }
        let path = PathBuf::from(arg);
        if path.extension().is_some_and(|ext| ext == "sigil") {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_workfile_path_from_macos_argv() {
        let argv = vec!["sigil".to_string(), "/Users/foo/main.sigil".to_string()];
        let result = extract_workfile_path(&argv);
        assert_eq!(
            result.as_deref().unwrap().to_str(),
            Some("/Users/foo/main.sigil")
        );
    }

    #[test]
    fn test_extract_workfile_path_from_windows_argv() {
        let argv = vec![
            "sigil.exe".to_string(),
            r"C:\Users\foo\design.sigil".to_string(),
        ];
        assert!(extract_workfile_path(&argv).is_some());
    }

    #[test]
    fn test_extract_workfile_path_returns_none_when_no_sigil_arg() {
        let argv = vec!["sigil".to_string(), "--version".to_string()];
        assert!(extract_workfile_path(&argv).is_none());
    }

    #[test]
    fn test_extract_workfile_path_skips_cli_flags() {
        let argv = vec![
            "sigil".to_string(),
            "--port".to_string(),
            "5000".to_string(),
            "/path/to/foo.sigil".to_string(),
        ];
        let result = extract_workfile_path(&argv);
        assert_eq!(
            result.as_deref().unwrap().to_str(),
            Some("/path/to/foo.sigil")
        );
    }

    #[test]
    fn test_extract_workfile_path_skips_macos_psn() {
        let argv = vec![
            "sigil".to_string(),
            "-psn_0_123456".to_string(),
            "/path/to/foo.sigil".to_string(),
        ];
        let result = extract_workfile_path(&argv);
        assert_eq!(
            result.as_deref().unwrap().to_str(),
            Some("/path/to/foo.sigil")
        );
    }
}
