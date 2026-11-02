import asyncio
import os
import sys
import json
import re

import httpx
import speech_recognition as sr
import pyttsx3 as tts
from openai import AsyncOpenAI, OpenAIError

import command_formatter
from supabase_api import SupabaseAPI

recognizer = sr.Recognizer()


def _mic_factory():
    raw = os.environ.get("SPARK_MIC_DEVICE_INDEX")
    if raw is None or raw == "":
        return sr.Microphone()
    return sr.Microphone(device_index=int(raw))


class SPARK:
    def __init__(self):
        self.formatter = command_formatter.CommandFormatter()

    def speak(self, text):
        try:
            engine = tts.init()
            engine.say(text)
            engine.runAndWait()
        except Exception as error:
            print(f"Speech output unavailable: {error}", flush=True)

    async def listen(self):
        while True:
            try:
                with _mic_factory() as source:
                    await self.print_to_console("Listening...")
                    audio = recognizer.listen(source, timeout=5, phrase_time_limit=8)
                    text = str(recognizer.recognize_google(audio))
                    await self.print_to_console(f"You said : {text}")
                    if re.search(r"\bspark\b", text, re.IGNORECASE):
                        await self.print_to_console("SPARK ACTIVATED")
                        command = re.sub(r"^.*?\bspark\b[, :]*", "", text, flags=re.IGNORECASE).strip()
                        if command:
                            return command
                        self.speak("Yes?")
                        audio = recognizer.listen(source, timeout=5, phrase_time_limit=8)
                        return str(recognizer.recognize_google(audio))
            except sr.RequestError as e:
                await self.print_to_console(f"Could not request results; {e}")
            except sr.UnknownValueError:
                await self.print_to_console("Speech was not understood")
            except sr.WaitTimeoutError:
                await self.print_to_console("Conversation timed out")

    async def handle_ai(self, text, group, client, client_devices, server_devices):
        client_devices_updated = [
            {
                "name": x["name"],
                "aliases": x.get("aliases") or [],
                "commands": [
                    {"name": command["name"], "aliases": command.get("aliases") or []}
                    for command in x["deviceCommands"]
                ],
            }
            for x in client_devices
        ]
        server_devices_updated = [
            {
                "name": x["name"],
                "aliases": x.get("aliases") or [],
                "commands": [
                    {"name": command["name"], "aliases": command.get("aliases") or []}
                    for command in x["deviceCommands"]
                ],
            }
            for x in server_devices
        ]
        if self.formatter.parse_natural_language(text)[0] is not None:
            result = self.formatter.parse_command(
                f"{text} || {client_devices_updated} || {server_devices_updated}",
                device_data={
                    "clients": client_devices_updated,
                    "servers": server_devices_updated,
                },
            )
            if not result["success"]:
                await self.print_to_console(result["error"])
                return result["error"], "", group

            device_name = result["device"]
            return result["formatted_command"], device_name, group

        content = await self.send_to_ai(text, group["aiMessages"], client)
        if "<Error: " in content:
            await self.print_to_console(content)
            return content, "", group
        return content, "", group

    async def send_to_ai(self, message, messages: list, client: AsyncOpenAI):
        messages.append({"role": "user", "content": message})
        response = await client.chat.completions.create(
            model=os.environ.get("SPARK_OPENAI_MODEL", "local-model"),
            messages=messages,
            temperature=0.7,
        )
        content = response.choices[0].message.content or ""
        messages.append({"role": "assistant", "content": content})
        return content

    async def main(self):
        config = json.loads(sys.stdin.readline()) if "--tauri" in sys.argv else {}
        os.environ.update({key: str(value) for key, value in config.items()})
        with _mic_factory() as source:
            recognizer.adjust_for_ambient_noise(source)

        recognizer.operation_timeout = 15
        oai = AsyncOpenAI(
            base_url=os.environ.get("SPARK_OPENAI_BASE", "http://localhost:4000/v1"),
            api_key=os.environ.get("SPARK_OPENAI_API_KEY", "lm-studio"),
            timeout=30.0,
            max_retries=1,
        )

        server_device_id = os.environ.get("SPARK_SERVER_DEVICE_ID", sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "--tauri" else "")
        access_token = os.environ.get("SPARK_ACCESS_TOKEN", sys.argv[2] if len(sys.argv) > 2 else "")
        refresh_token = "" if "--tauri" in sys.argv else os.environ.get("SPARK_REFRESH_TOKEN", "")
        url = os.environ.get("SPARK_SUPABASE_URL", "").rstrip("/")
        anon_key = os.environ.get("SPARK_SUPABASE_ANON_KEY", "")
        if not all((server_device_id, access_token, url, anon_key)):
            raise ValueError("Set SPARK_SERVER_DEVICE_ID, SPARK_ACCESS_TOKEN, SPARK_SUPABASE_URL and SPARK_SUPABASE_ANON_KEY")

        async with httpx.AsyncClient(timeout=30.0) as http:
            db = SupabaseAPI(http, url, anon_key, access_token, refresh_token)
            server_device = await db.device(server_device_id)
            if server_device["type"] != "server":
                raise ValueError("SPARK_SERVER_DEVICE_ID must identify a server device")

            while True:
                text = await self.listen()
                if not text:
                    continue
                try:
                    await self.process_text(text, db, server_device_id, oai)
                except (httpx.HTTPError, OpenAIError, ValueError) as error:
                    await self.print_to_console(f"Request failed: {error}")
                    await asyncio.sleep(2)

    async def process_text(self, text, db, server_device_id, oai):
        # Load routing data after listening: names and commands may have changed.
        server_device = await db.device(server_device_id)
        group_id = server_device["assigned_group_id"]
        device_rows = await db.request("GET", "devices", params={
            "assigned_group_id": f"eq.{group_id}",
            "select": "*,commands(id,name,command,aliases)",
        })
        devices = [{**d, "deviceCommands": d.get("commands", [])} for d in device_rows]
        history_rows = await db.request("GET", "ai_messages", params={
            "assigned_group_id": f"eq.{group_id}", "select": "role,content",
            "order": "created_at.desc,id.desc", "limit": "100",
        })
        history = list(reversed(history_rows))
        group = {"id": group_id, "aiMessages": history}
        history_length = len(history)
        clients = [d for d in devices if d["type"] == "client"]
        servers = [d for d in devices if d["type"] == "server"]
        content, device_name, updated_group = await self.handle_ai(text, group, oai, clients, servers)
        prefix = f"|| RUN COMMAND ON DEVICE: {device_name} | "
        target = next((d for d in devices if d["name"] == device_name), None)
        if target and content.startswith(prefix):
            command_name = content[len(prefix):].split(" ||")[0].strip()
            await db.request("POST", "messages", body={
                "assigned_user_id": server_device["assigned_user_id"],
                "from_device_id": server_device_id,
                "to_device_id": target["id"],
                "content": f"[RUN COMMAND] {command_name}",
            })
            await self.print_to_console(f"Command sent to {device_name}: {command_name}")
        else:
            self.speak(content)
        new_history = updated_group["aiMessages"][history_length:]
        if new_history:
            await db.request("POST", "ai_messages", body=[{
                "assigned_group_id": group_id,
                "assigned_user_id": server_device["assigned_user_id"],
                "role": m["role"], "content": m["content"],
            } for m in new_history])

    async def print_to_console(self, content: str):
        print(content, flush=True)



if __name__ == "__main__":
    spark = SPARK()
    asyncio.run(spark.main())
