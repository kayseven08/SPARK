class SupabaseAPI:
    """User-authenticated REST access; retries once after refreshing an expired JWT."""
    def __init__(self, http, url, anon_key, access_token, refresh_token=""):
        self.http = http
        self.url = url
        self.anon_key = anon_key
        self.access_token = access_token
        self.refresh_token = refresh_token

    async def request(self, method, table, *, params=None, body=None):
        for attempt in range(2):
            response = await self.http.request(method, f"{self.url}/rest/v1/{table}",
                headers={"apikey": self.anon_key, "Authorization": f"Bearer {self.access_token}"},
                params=params, json=body)
            if response.status_code == 401 and self.refresh_token and attempt == 0:
                refreshed = await self.http.post(f"{self.url}/auth/v1/token", params={"grant_type": "refresh_token"},
                    headers={"apikey": self.anon_key}, json={"refresh_token": self.refresh_token})
                refreshed.raise_for_status()
                session = refreshed.json()
                self.access_token = session["access_token"]
                self.refresh_token = session["refresh_token"]
                continue
            response.raise_for_status()
            return response.json() if response.content else None

    async def device(self, device_id):
        rows = await self.request("GET", "devices", params={"id": f"eq.{device_id}", "select": "*"})
        if not rows:
            raise ValueError("Device not found or not owned by the signed-in user")
        return rows[0]

