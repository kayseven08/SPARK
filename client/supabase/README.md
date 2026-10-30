# SPARK schema v2 integration

Claude applied `spark_schema_v2_normalized` and `spark_schema_v2_tighten_grants`
to the SPARK Supabase project. `schema.sql` is the consolidated bootstrap for a
new project. This code integration does not apply or reset the live database.
For a new project, disable email confirmation as described in the SQL header.

The active application is `client/`. The root `api/` and `nats_server/` directories
are legacy implementations; the desktop client and Python voice server no longer
call them. The TypeScript files supplied in `claude_exported_data/claude_files`
were installed under `client/src/lib` and adapted alongside the existing UI.

## Data flow

- One `devices` table holds client and server devices; `type` distinguishes them.
- Commands, group presets, messages, and AI history have their own tables.
- `groups_with_devices` supplies the UI's client/server ID lists. The API adapter
  maps database fields to the camelCase domain objects used by Svelte and Tauri.
- Message history is loaded separately and excluded from the persisted device.
- Auth tokens live in the Tauri store. Supabase refreshes them in memory and the
  auth listener persists rotated tokens. Rust reconnects when its credentials or
  selected device change. Sign-out clears the selected user, device, and group.
- Remote Run buttons insert a `messages` row with `[RUN COMMAND] <name>`.
  The receiver subscribes to authenticated INSERTs filtered by `to_device_id`,
  then reads its pending inbox and current registered commands through REST.
  It executes only exact registered names and updates only `status`:
  `0` pending, `1` successful, `2` failed or unrecognized.
- A single Rust worker reconnects and checks pending messages after subscribing
  and every 15 seconds, recovering deliveries missed while offline. Read timeouts
  allow heartbeats and credential changes to be handled while the inbox is idle.
  Results are retained in memory if status acknowledgement fails, preventing
  repeated execution during reconnects in that process. A crash between shell
  execution and acknowledgement can still cause replay after restarting; this
  is not an exactly-once command protocol. Only one machine should select a
  particular device identity.

## Python voice server

Install `client/py/requirements.txt` and launch `main.py` from `client/py` so its
existing classifier/model paths resolve. Set these environment variables:

- `SPARK_SUPABASE_URL`, `SPARK_SUPABASE_ANON_KEY`
- `SPARK_SERVER_DEVICE_ID` (a device whose type is `server`)
- `SPARK_ACCESS_TOKEN` (the owning user's access token)
- `SPARK_REFRESH_TOKEN` for sessions that outlive the access token
- Existing microphone and OpenAI/LM Studio options remain supported.

The voice server reads devices and commands directly from Supabase, inserts
command messages, and appends AI conversation rows. It no longer uses NATS
credentials or the Fly.dev API. Give it its own authenticated session when
running independently of Tauri so refresh-token rotation does not compete with
another process. The Python process keeps refreshed credentials in memory.

## Validation

From `client/`: `npm run check`, `npm run build`, and
`npm run test:unit -- --run`. From `client/src-tauri/`: `cargo test --offline`.
From the repository root:
`python3 -m unittest discover -s client/py -p 'test_supabase_api.py' -v`.

The unit tests use mocked database/auth boundaries and do not write live data.
Actual microphone/LLM operation and command execution between two signed-in
Tauri instances require a manual runtime check against Supabase.
