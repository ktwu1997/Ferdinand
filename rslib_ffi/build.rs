// Generate ferdinand.h from the public C ABI surface of this crate.
// Output goes alongside the .a/.so so iOS/macOS clients can pick it up
// from a single artifact directory.

use std::env;
use std::path::PathBuf;

fn main() {
    let crate_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR set by cargo");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR set by cargo"));

    let header_path = out_dir.join("ferdinand.h");
    let config = cbindgen::Config::from_file(PathBuf::from(&crate_dir).join("cbindgen.toml"))
        .expect("cbindgen.toml must parse");

    cbindgen::Builder::new()
        .with_crate(&crate_dir)
        .with_config(config)
        .generate()
        .expect("cbindgen header generation failed")
        .write_to_file(&header_path);

    // Re-run if anything in src/ or the cbindgen config changes.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=cbindgen.toml");
    println!("cargo:rerun-if-changed=build.rs");

    // Surface the header path to downstream tooling (and test scripts).
    println!(
        "cargo:rustc-env=FERDINAND_FFI_HEADER={}",
        header_path.display()
    );
}
