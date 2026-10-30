import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from './database.types';
import type { Device } from './index';

// SvelteKit with adapter-static (used by Tauri) bakes env vars at build time
// via $env/static/public — NOT import.meta.env.
// Variables must be prefixed PUBLIC_ and live in client/.env

export const supabase = createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
	auth: {
		// Tokens are persisted in the Tauri store (see auth.ts), not browser storage.
		persistSession: false,
		// ON: the client keeps the in-memory session fresh. auth.ts listens for
		// TOKEN_REFRESHED and mirrors the new tokens into the Tauri store, which is
		// where the Rust Realtime listener reads them from.
		autoRefreshToken: true,
		detectSessionInUrl: false
	}
});

// ---------------------------------------------------------------------------
// Compatibility types — pages previously imported these from '$lib/xata'.
// Change those imports to '$lib/supabase'; the names are unchanged.
// ---------------------------------------------------------------------------

/** A group as returned by the `groups_with_devices` view. */
export type Group = {
	id: string;
	name: string;
	assigned_user_id: string;
	settings: Record<string, unknown>;
	devices: { client: string[]; server: string[] };
};

export type ClientDevice = Device;
export type ServerDevice = Device;

export type User = {
	id: string;
	email: string;
	username: string;
	settings: Record<string, unknown>;
};

export type { Message } from './index';
