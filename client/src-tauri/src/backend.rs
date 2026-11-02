//! Schema v2 command delivery. One worker per process, authenticated as the
//! signed-in user. Realtime wakes the inbox; REST catches messages missed offline.
use crate::{app, store};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{connect, stream::MaybeTlsStream, Message as WsMessage};

static STARTED: AtomicBool = AtomicBool::new(false);
const STORE: &str = "stores/store.json";

#[derive(Clone, Debug, PartialEq)]
struct Connection {
    url: String,
    key: String,
    token: String,
    device_id: String,
}

fn connection() -> Option<Connection> {
    let read = |key: &str| store::get(STORE.into(), key.into());
    let config = Connection {
        url: read("supabaseUrl").as_str()?.trim_end_matches('/').into(),
        key: read("supabaseAnonKey").as_str()?.into(),
        token: read("accessToken").as_str()?.into(),
        device_id: read("device").get("id")?.as_str()?.into(),
    };
    if [&config.url, &config.key, &config.token, &config.device_id]
        .iter()
        .any(|s| s.is_empty())
    {
        return None;
    }
    Some(config)
}

#[derive(Deserialize)]
struct InboxMessage {
    id: String,
    to_device_id: String,
    content: String,
    status: i16,
}

#[derive(Deserialize)]
struct DeviceCommand {
    name: String,
    command: String,
}

fn join_message(config: &Connection) -> Value {
    json!({
        "topic": "realtime:spark-inbox", "event": "phx_join", "ref": "1",
        "payload": {
            "access_token": config.token,
            "config": {"broadcast": {"self": false}, "presence": {"key": ""},
                "postgres_changes": [{"event": "INSERT", "schema": "public",
                    "table": "messages", "filter": format!("to_device_id=eq.{}", config.device_id)}]}
        }
    })
}

fn request(
    client: &Client,
    config: &Connection,
    method: reqwest::Method,
    table: &str,
) -> reqwest::blocking::RequestBuilder {
    client
        .request(method, format!("{}/rest/v1/{table}", config.url))
        .header("apikey", &config.key)
        .bearer_auth(&config.token)
}

fn command_for_message<'a>(content: &str, commands: &'a [DeviceCommand]) -> Option<&'a str> {
    let name = content.strip_prefix("[RUN COMMAND] ")?;
    commands
        .iter()
        .find(|c| c.name == name)
        .map(|c| c.command.as_str())
}

fn drain_inbox(
    client: &Client,
    config: &Connection,
    completed: &mut HashMap<String, i16>,
) -> Result<(), Box<dyn std::error::Error>> {
    let messages: Vec<InboxMessage> = request(client, config, reqwest::Method::GET, "messages")
        .query(&[
            ("to_device_id", format!("eq.{}", config.device_id)),
            ("status", "eq.0".into()),
            ("order", "created_at.asc,id.asc".into()),
            ("limit", "100".into()),
        ])
        .send()?
        .error_for_status()?
        .json()?;
    for message in messages {
        // Sign-out, token refresh, or selecting another device ends this connection.
        if connection().as_ref() != Some(config) {
            return Ok(());
        }
        if message.to_device_id != config.device_id || message.status != 0 {
            continue;
        }
        let status = if let Some(status) = completed.get(&message.id) {
            *status
        } else {
            // Fetch current commands instead of executing stale commands from the store.
            let commands: Vec<DeviceCommand> =
                request(client, config, reqwest::Method::GET, "commands")
                    .query(&[
                        ("device_id", format!("eq.{}", config.device_id)),
                        ("select", "name,command".into()),
                    ])
                    .send()?
                    .error_for_status()?
                    .json()?;
            if connection().as_ref() != Some(config) {
                return Ok(());
            }
            let status = match command_for_message(&message.content, &commands) {
                Some(command) => match app::execute_command(command) {
                    Ok(true) => 1,
                    _ => 2,
                },
                None => 2,
            };
            // Retain the result if acknowledgement fails; reconnect must not rerun it.
            completed.insert(message.id.clone(), status);
            status
        };
        #[derive(Serialize)]
        struct Status {
            status: i16,
        }
        request(client, config, reqwest::Method::PATCH, "messages")
            .query(&[
                ("id", format!("eq.{}", message.id)),
                ("status", "eq.0".into()),
            ])
            .json(&Status { status })
            .send()?
            .error_for_status()?;
        // Keep IDs for the lifetime of the worker to ignore duplicate deliveries.
    }
    Ok(())
}

pub fn handle_device_updates_api_call() -> Result<(), Box<dyn std::error::Error>> {
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Err(error) = thread::Builder::new()
        .name("supabase-realtime".into())
        .spawn(run_worker)
    {
        STARTED.store(false, Ordering::SeqCst);
        return Err(error.into());
    }
    Ok(())
}

fn run_worker() {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("HTTP client");
    let mut completed = HashMap::new();
    loop {
        let Some(config) = connection() else {
            thread::sleep(Duration::from_secs(1));
            continue;
        };
        if let Err(error) = run_connection(&client, &config, &mut completed) {
            // Do not log connection URLs or credentials.
            println!("[realtime] Connection interrupted: {}", error);
        }
        thread::sleep(Duration::from_secs(2));
    }
}

fn run_connection(
    client: &Client,
    config: &Connection,
    completed: &mut HashMap<String, i16>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut url = reqwest::Url::parse(&config.url)?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme).map_err(|_| "Invalid Supabase URL")?;
    url.set_path("/realtime/v1/websocket");
    url.query_pairs_mut()
        .append_pair("apikey", &config.key)
        .append_pair("vsn", "1.0.0");
    let (mut socket, _) = connect(url.as_str()).map_err(|_| "WebSocket connection failed")?;
    let timeout = Some(Duration::from_secs(1));
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => {
            stream.set_read_timeout(timeout)?;
            stream.set_write_timeout(timeout)?;
        }
        MaybeTlsStream::NativeTls(stream) => {
            stream.get_mut().set_read_timeout(timeout)?;
            stream.get_mut().set_write_timeout(timeout)?;
        }
        _ => return Err("Unsupported WebSocket transport".into()),
    }
    socket.send(WsMessage::Text(join_message(config).to_string()))?;
    let mut heartbeat = Instant::now();
    let mut inbox_check = Instant::now();
    let mut joined = false;
    let mut reference = 2u64;
    loop {
        if connection().as_ref() != Some(config) {
            let _ = socket.close(None);
            return Ok(());
        }
        if heartbeat.elapsed() >= Duration::from_secs(25) {
            socket.send(WsMessage::Text(json!({"topic":"phoenix", "event":"heartbeat", "payload":{}, "ref": reference.to_string()}).to_string()))?;
            reference += 1;
            heartbeat = Instant::now();
        }
        if joined && inbox_check.elapsed() >= Duration::from_secs(15) {
            drain_inbox(client, config, completed)?;
            inbox_check = Instant::now();
        }
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                let message: Value = serde_json::from_str(&text)?;
                match message["event"].as_str() {
                    Some("phx_reply") if message["ref"] == "1" => {
                        if message["payload"]["status"] != "ok" {
                            return Err("Realtime join rejected".into());
                        }
                        joined = true;
                        drain_inbox(client, config, completed)?;
                        inbox_check = Instant::now();
                    }
                    Some("postgres_changes") if joined => {
                        drain_inbox(client, config, completed)?;
                    }
                    Some("phx_error" | "phx_close") => return Err("Realtime channel closed".into()),
                    _ => {}
                }
            }
            Ok(WsMessage::Ping(data)) => {
                socket.send(WsMessage::Pong(data))?;
            }
            Ok(WsMessage::Close(_)) => return Ok(()),
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(error) => return Err(error.into()),
            _ => {}
        }
        if !joined && inbox_check.elapsed() > Duration::from_secs(15) {
            return Err("Realtime join timed out".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subscription_uses_authenticated_message_inbox() {
        let c = Connection {
            url: "https://example.test".into(),
            key: "anon".into(),
            token: "user-token".into(),
            device_id: "device-1".into(),
        };
        let join = join_message(&c);
        assert_eq!(join["payload"]["access_token"], "user-token");
        let subscription = &join["payload"]["config"]["postgres_changes"][0];
        assert_eq!(subscription["table"], "messages");
        assert_eq!(subscription["event"], "INSERT");
        assert_eq!(subscription["filter"], "to_device_id=eq.device-1");
    }
    #[test]
    fn only_exact_registered_command_names_execute() {
        let commands = vec![DeviceCommand {
            name: "Open Browser".into(),
            command: "open browser".into(),
        }];
        assert_eq!(
            command_for_message("[RUN COMMAND] Open Browser", &commands),
            Some("open browser")
        );
        assert_eq!(
            command_for_message("prefix [RUN COMMAND] Open Browser", &commands),
            None
        );
        assert_eq!(
            command_for_message("[RUN COMMAND] rm -rf /", &commands),
            None
        );
    }
}
