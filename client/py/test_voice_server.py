"""Exercise voice routing without requiring microphone drivers on the test host."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

from command_formatter import CommandFormatter


def load_server():
    modules = {name: types.ModuleType(name) for name in
               ("httpx", "speech_recognition", "pyttsx3", "openai")}
    modules["speech_recognition"].Recognizer = Mock
    modules["openai"].AsyncOpenAI = Mock
    modules["openai"].OpenAIError = Exception
    spec = importlib.util.spec_from_file_location("voice_server_test_target", Path(__file__).with_name("main.py"))
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_spoken_command_posts_to_supabase_inbox(self):
        spark = load_server().SPARK()
        spark.speak = Mock()
        db = AsyncMock()
        db.device.return_value = {"id": "pi", "assigned_group_id": "group", "assigned_user_id": "user"}
        db.request.side_effect = [[{
            "id": "pc", "name": "Office PC", "type": "client", "aliases": ["computer"],
            "commands": [{"name": "Open Browser", "aliases": ["open chrome"]}]
        }], [], None]
        await spark.process_text("open chrome on computer", db, "pi", Mock())
        call = db.request.call_args_list[-1]
        self.assertEqual(call.args, ("POST", "messages"))
        self.assertEqual(call.kwargs["body"], {
            "assigned_user_id": "user", "from_device_id": "pi", "to_device_id": "pc",
            "content": "[RUN COMMAND] Open Browser"})
        spark.speak.assert_not_called()

    async def test_chat_response_is_spoken_and_history_persisted(self):
        spark = load_server().SPARK()
        spark.speak = Mock()
        db = AsyncMock()
        db.device.return_value = {"assigned_group_id": "group", "assigned_user_id": "user"}
        db.request.side_effect = [[], [], None]
        ai = Mock()
        ai.chat.completions.create = AsyncMock(return_value=types.SimpleNamespace(
            choices=[types.SimpleNamespace(message=types.SimpleNamespace(content="Hello"))]))
        await spark.process_text("hello", db, "pi", ai)
        spark.speak.assert_called_once_with("Hello")
        call = db.request.call_args_list[-1]
        self.assertEqual(call.args, ("POST", "ai_messages"))
        self.assertEqual([m["role"] for m in call.kwargs["body"]], ["user", "assistant"])

    def test_reversed_phrasing_and_alias_refresh(self):
        parser = CommandFormatter()
        data = {"clients": [{"name": "PC", "aliases": ["computer"], "commands": [
            {"name": "Open Browser", "aliases": ["open chrome"]}]}], "servers": []}
        result = parser.parse_command("on computer open chrome", data)
        self.assertTrue(result["success"], result)
        data["clients"][0]["commands"] = [{"name": "Lock", "aliases": []}]
        self.assertFalse(parser.parse_command("open chrome on computer", data)["success"])

    def test_command_aliases_are_scoped_to_target(self):
        data = {"clients": [
            {"name": "PC", "aliases": [], "commands": [{"name": "Open Browser", "aliases": ["open web"]}]},
            {"name": "Laptop", "aliases": [], "commands": [{"name": "Open Safari", "aliases": ["open web"]}]}
        ], "servers": []}
        result = CommandFormatter().parse_command("open web on PC", data)
        self.assertEqual(result.get("command"), "Open Browser")


if __name__ == "__main__":
    unittest.main()
