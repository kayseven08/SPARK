use std::process::Command;

/// Opens an application by name.
/// On macOS: uses `open -a <app>`
/// On Windows: uses `cmd /C start <app>`
/// On Linux: uses `xdg-open <app>`
#[tauri::command]
pub fn start_app(application: &str) {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .args(["-a", application])
            .output()
            .expect("failed to execute process");
        println!("output: {:?}", output);
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(["/C", &format!("start {}", application)])
            .output()
            .expect("failed to execute process");
        println!("output: {:?}", output);
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdg-open")
            .arg(application)
            .output()
            .expect("failed to execute process");
        println!("output: {:?}", output);
    }
}

/// Runs a registered command and reports whether it exited successfully.
pub fn execute_command(command: &str) -> std::io::Result<bool> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let status = Command::new("sh").args(["-c", command]).status()?;
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", command]).status()?;
    Ok(status.success())
}

#[tauri::command]
pub fn run_command(command: &str) -> Result<(), String> {
    match execute_command(command).map_err(|error| error.to_string())? {
        true => Ok(()),
        false => Err("Command exited unsuccessfully".into()),
    }
}
