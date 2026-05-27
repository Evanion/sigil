//! Sigil desktop shell entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sigil_shell_lib::run();
}
