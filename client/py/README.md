# Raspberry Pi voice server

The Pi runs the Tauri app as a **server** device. Other devices run the app as
clients in the same Supabase group. Commands and aliases are managed in the UI;
voice input inserts `[RUN COMMAND] <registered name>` into the Supabase inbox.
The receiving Tauri app executes its current registered command and reports status.

On Raspberry Pi OS (64-bit), install the voice runtime:

```sh
sudo apt update
sudo apt install python3-venv python3-dev portaudio19-dev espeak-ng libespeak1
python3 -m venv ~/.venvs/spark
~/.venvs/spark/bin/python -m pip install -r py/requirements.txt
export SPARK_PYTHON="$HOME/.venvs/spark/bin/python"
```

Launch Tauri from that environment (or set these environment variables in your
launcher). Sign in, select/create a group, and select/create a **server** device.
The voice worker starts automatically after setup. Packaged builds include the
Python scripts; the virtual environment and system audio libraries must be
installed separately. No neural-network training packages are needed at runtime.

Say “Spark, open browser on my PC” using a registered device name/alias and command
name/alias. Saying “Spark” alone opens a second listening turn. See **This Device →
Voice server** for listening status and errors. Closing the window keeps the app in
the tray; quitting stops Python. Sign-out or switching to a client stops voice input.
The client app must be running to execute incoming commands.

Optional environment settings (set before starting Tauri):

- `SPARK_MIC_DEVICE_INDEX`: PyAudio microphone index; default uses the system input.
- `SPARK_OPENAI_BASE`: OpenAI-compatible chat endpoint, default `http://localhost:4000/v1`.
- `SPARK_OPENAI_MODEL`: model identifier loaded by that endpoint, default `local-model`.
- `SPARK_OPENAI_API_KEY`: endpoint key, default `lm-studio`.

For chat, point the endpoint at a running model server (use its LAN IP if it runs
on another computer). Registered device commands do not require a model server.
Speech recognition uses Google's online speech service and requires internet.
Tauri supplies Supabase configuration and the signed-in access token privately
through stdin; it restarts the worker after token rotation. Python does not refresh
the Tauri session independently.

For standalone use, run `python py/main.py` with `SPARK_SERVER_DEVICE_ID`,
`SPARK_ACCESS_TOKEN`, `SPARK_SUPABASE_URL`, and `SPARK_SUPABASE_ANON_KEY` set.
`SPARK_REFRESH_TOKEN` optionally enables refresh for the standalone process.

Run routing regressions without audio hardware:

```sh
python3 -m unittest discover -s py -p 'test_*.py'
```
