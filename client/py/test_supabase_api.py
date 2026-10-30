import unittest
from unittest.mock import AsyncMock

from supabase_api import SupabaseAPI


class Response:
    def __init__(self, status, body=None):
        self.status_code = status
        self.body = body
        self.content = b'json' if body is not None else b''

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f'HTTP {self.status_code}')


class SupabaseAPITests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_retries_with_rotated_tokens(self):
        http = AsyncMock()
        http.request.side_effect = [Response(401), Response(200, [{'id': 'device-1'}])]
        http.post.return_value = Response(200, {'access_token': 'new-access', 'refresh_token': 'new-refresh'})
        db = SupabaseAPI(http, 'https://example.test', 'anon', 'expired', 'refresh')
        self.assertEqual(await db.device('device-1'), {'id': 'device-1'})
        first, second = http.request.call_args_list
        self.assertEqual(first.kwargs['headers']['Authorization'], 'Bearer expired')
        self.assertEqual(second.kwargs['headers']['Authorization'], 'Bearer new-access')
        self.assertEqual(second.kwargs['params']['id'], 'eq.device-1')
        self.assertEqual(db.refresh_token, 'new-refresh')
        self.assertEqual(http.post.call_args.kwargs['json'], {'refresh_token': 'refresh'})

    async def test_writes_normalized_message_without_legacy_endpoint(self):
        http = AsyncMock()
        http.request.return_value = Response(201)
        db = SupabaseAPI(http, 'https://example.test', 'anon', 'jwt')
        body = {'assigned_user_id': 'user-1', 'from_device_id': 'server-1', 'to_device_id': 'client-1', 'content': '[RUN COMMAND] Open'}
        self.assertIsNone(await db.request('POST', 'messages', body=body))
        self.assertEqual(http.request.call_args.args, ('POST', 'https://example.test/rest/v1/messages'))
        self.assertEqual(http.request.call_args.kwargs['json'], body)
        http.post.assert_not_called()

    async def test_missing_device_is_not_treated_as_usable(self):
        http = AsyncMock()
        http.request.return_value = Response(200, [])
        db = SupabaseAPI(http, 'https://example.test', 'anon', 'jwt')
        with self.assertRaisesRegex(ValueError, 'Device not found'):
            await db.device('unknown')

    async def test_refresh_is_bounded_and_failed_writes_surface(self):
        http = AsyncMock()
        http.request.return_value = Response(401)
        http.post.return_value = Response(200, {'access_token': 'new-access', 'refresh_token': 'new-refresh'})
        db = SupabaseAPI(http, 'https://example.test', 'anon', 'expired', 'refresh')
        with self.assertRaisesRegex(RuntimeError, '401'):
            await db.request('POST', 'messages', body={})
        self.assertEqual(http.request.await_count, 2)
        http.post.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
