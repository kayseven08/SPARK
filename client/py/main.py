import asyncio
import os
import sys

import httpx
import speech_recognition as sr
import pyttsx3 as tts
from openai import AsyncOpenAI

import command_classifier_nn as command_classifier
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
        self.classifier = command_classifier.CommandClassifierSoftmax(
            "nn_scratch_data_device_specific.json", 3000
        )
        self.formatter = command_formatter.CommandFormatter()
        self.classifier.load_model("classifier_models/softmax_mixed_updated.json")
        self.classifier.validate()

    def speak(self, text):
        engine = tts.init()
        engine.say(text)
        engine.runAndWait()

    async def listen(self):
        while True:
            try:
                with _mic_factory() as source:
                    await self.print_to_console("Listening...")
                    audio = recognizer.listen(source, phrase_time_limit=6)
                    text = str(recognizer.recognize_google(audio))
                    await self.print_to_console(f"You said : {text}")
                    if "spark" in text.lower():
                        await self.print_to_console("SPARK ACTIVATED")
                        self.speak("SPARK ACTIVATED")
                        return text
            except sr.RequestError as e:
                await self.print_to_console(f"Could not request results; {e}")
            except sr.UnknownValueError:
                await self.print_to_console("unknown error occured")
            except sr.WaitTimeoutError:
                await self.print_to_console("Conversation timed out")

    async def handle_ai(self, text, group, client, client_devices, server_devices):
        client_devices_updated = [
            {
                "name": x["name"],
                "aliases": x["aliases"],
                "commands": [
                    {"name": command["name"], "aliases": command["aliases"]}
                    for command in x["deviceCommands"]
                ],
            }
            for x in client_devices
        ]
        server_devices_updated = [
            {
                "name": x["name"],
                "aliases": x["aliases"],
                "commands": [
                    {"name": command["name"], "aliases": command["aliases"]}
                    for command in x["deviceCommands"]
                ],
            }
            for x in server_devices
        ]
        if self.classifier.predict(text)["result"] == "command":
            result = self.formatter.parse_command(
                f"{text} || {client_devices_updated} || {server_devices_updated}",
                device_data={
                    "clients": client_devices_updated,
                    "servers": server_devices_updated,
                },
            )
            if not result["success"]:
                await self.print_to_console(result["error"])
                self.speak(result["error"])
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
            model="model-identifier",
            messages=messages,
            temperature=0.7,
        )
        content = response.choices[0].message.content or ""
        messages.append({"role": "assistant", "content": content})
        return content

    async def main(self):
        with _mic_factory() as source:
            recognizer.adjust_for_ambient_noise(source)

        oai = AsyncOpenAI(
            base_url=os.environ.get("SPARK_OPENAI_BASE", "http://localhost:4000/v1"),
            api_key=os.environ.get("SPARK_OPENAI_API_KEY", "lm-studio"),
        )

        server_device_id = os.environ.get("SPARK_SERVER_DEVICE_ID", sys.argv[1] if len(sys.argv) > 1 else "")
        access_token = os.environ.get("SPARK_ACCESS_TOKEN", sys.argv[2] if len(sys.argv) > 2 else "")
        refresh_token = os.environ.get("SPARK_REFRESH_TOKEN", "")
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
                    "order": "id.desc", "limit": "100",
                })
                history = list(reversed(history_rows))
                group = {"id": group_id, "aiMessages": history}
                history_length = len(history)
                clients = [d for d in devices if d["type"] == "client"]
                servers = [d for d in devices if d["type"] == "server"]
                content, device_name, updated_group = await self.handle_ai(text, group, oai, clients, servers)
                prefix = f"RUN COMMAND ON DEVICE: {device_name} | "
                target = next((d for d in devices if d["name"] == device_name), None)
                if target and content.startswith(prefix):
                    command_name = content[len(prefix):].split(" ||")[0].strip()
                    await db.request("POST", "messages", body={
                        "assigned_user_id": server_device["assigned_user_id"],
                        "from_device_id": server_device_id,
                        "to_device_id": target["id"],
                        "content": f"[RUN COMMAND] {command_name}",
                    })
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
