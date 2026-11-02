//! Supervise the voice process. Tauri owns auth refresh; Python receives no refresh token.
use crate::store;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::Manager;
static STARTED: AtomicBool = AtomicBool::new(false);
static CHILD: Mutex<Option<Child>> = Mutex::new(None);
const STORE: &str = "stores/store.json";

fn config() -> Option<Value> {
    let read = |key: &str| store::get(STORE.into(), key.into());
    let device = read("device");
    let kind = device
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| read("deviceType").as_str().unwrap_or("").to_owned());
    if kind != "server" {
        return None;
    }
    let result = json!({
        "SPARK_SERVER_DEVICE_ID": device.get("id")?,
        "SPARK_ACCESS_TOKEN": read("accessToken"),
        "SPARK_SUPABASE_URL": read("supabaseUrl"),
        "SPARK_SUPABASE_ANON_KEY": read("supabaseAnonKey")
    });
    if result
        .as_object()?
        .values()
        .any(|v| v.as_str().unwrap_or("").is_empty())
    {
        return None;
    }
    Some(result)
}

fn status(text: &str, running: bool) {
    store::set(STORE.into(), "serverStatus".into(), json!(text));
    store::set(STORE.into(), "runningServerBackend".into(), json!(running));
}

pub fn stop() {
    if let Some(mut child) = CHILD.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn start(app: tauri::AppHandle) -> Result<(), String> {
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
    thread::spawn(move || {
        let script = if cfg!(debug_assertions) {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../py/main.py")
        } else {
            resource.join("py/main.py")
        };
        let mut previous = None;
        let mut retry = std::time::Instant::now();
        loop {
            let current = config();
            let changed = current != previous;
            if changed {
                stop();
                previous = current.clone();
            }
            let exited = {
                let mut guard = CHILD.lock().unwrap();
                match guard.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(_)) | Err(_) => {
                            *guard = None;
                            true
                        }
                        _ => false,
                    },
                    None => false,
                }
            };
            if exited {
                status("Voice process stopped. Check microphone, Python dependencies and AI configuration; retrying in 10 seconds.", false);
                retry = std::time::Instant::now() + Duration::from_secs(10);
            }
            if let Some(config) = current {
                if CHILD.lock().unwrap().is_none()
                    && (changed || std::time::Instant::now() >= retry)
                {
                    let python = std::env::var("SPARK_PYTHON").unwrap_or_else(|_| "python3".into());
                    let spawned = Command::new(python)
                        .arg("-u")
                        .arg(&script)
                        .arg("--tauri")
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::inherit())
                        .spawn();
                    match spawned {
                        Ok(mut child) => {
                            let sent = child.stdin.take().map(|mut input| writeln!(input, "{}", config).is_ok()).unwrap_or(false);
                            if sent {
                                if let Some(output) = child.stdout.take() {
                                    thread::spawn(move || {
                                        for line in BufReader::new(output).lines().map_while(Result::ok) {
                                            store::set(STORE.into(), "serverStatus".into(), json!(line));
                                        }
                                    });
                                }
                                *CHILD.lock().unwrap() = Some(child);
                                status("Starting voice server…", true);
                            } else { let _ = child.kill(); let _ = child.wait(); status("Could not configure voice process", false); }
                        },
                        Err(_) => status("Could not start Python. Set SPARK_PYTHON to your virtual environment's Python executable.", false),
                    }
                    retry = std::time::Instant::now() + Duration::from_secs(10);
                }
            } else {
                status("Voice server inactive", false);
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
    Ok(())
}
