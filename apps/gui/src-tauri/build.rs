fn main() {
    println!(
        "cargo:rustc-env=APP_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("Cargo provides TARGET")
    );
    tauri_build::build()
}
