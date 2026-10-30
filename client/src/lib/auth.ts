import type { Session } from '@supabase/supabase-js';
import { getStore, setStore } from './tauri';
import { supabase } from './supabase';

export async function persistSession(session: Session): Promise<void> {
	await setStore('accessToken', session.access_token);
	await setStore('refreshToken', session.refresh_token);
}

/**
 * Keep the Tauri store in sync when supabase-js refreshes the access token
 * (hourly). The Rust Realtime listener reads `accessToken` from that store.
 * Registered once, at module load.
 */
let listenerRegistered = false;
function registerAuthListener() {
	if (listenerRegistered || typeof window === 'undefined') return;
	listenerRegistered = true;
	supabase.auth.onAuthStateChange((event, session) => {
		if (session && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
			// Don't await supabase calls inside this callback (deadlock risk); setStore is safe.
			setTimeout(() => void persistSession(session).catch(() => {}), 0);
		}
	});
}
registerAuthListener();

/** Restore the Supabase client session from tokens stored in the Tauri store. */
let restoring: Promise<boolean> | null = null;
export async function restoreAuthFromStore(): Promise<boolean> {
	if (restoring) return restoring;
	restoring = restoreSession().finally(() => {
		restoring = null;
	});
	return restoring;
}

async function restoreSession(): Promise<boolean> {
	const { data: current } = await supabase.auth.getSession();
	if (current.session) return true;
	const accessToken = await getStore('accessToken');
	const refreshToken = await getStore('refreshToken');

	if (typeof accessToken !== 'string' || !accessToken) return false;
	if (typeof refreshToken !== 'string' || !refreshToken) return false;

	const { data, error } = await supabase.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken
	});

	if (!error && data.session) {
		await persistSession(data.session); // setSession may have refreshed an expired token
		return true;
	}

	const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
		refresh_token: refreshToken
	});

	if (refreshError || !refreshed.session) return false;

	await persistSession(refreshed.session);
	return true;
}

/**
 * Current user's id, from the in-memory session (no network round trip),
 * restoring from the Tauri store if needed. Returns null when signed out.
 */
export async function getSessionUserId(): Promise<string | null> {
	const first = await supabase.auth.getSession();
	if (first.data.session) return first.data.session.user.id;
	if (!(await restoreAuthFromStore())) return null;
	const second = await supabase.auth.getSession();
	return second.data.session?.user.id ?? null;
}

export async function ensureAuthenticated(): Promise<boolean> {
	return (await getSessionUserId()) !== null;
}

export async function signOut(): Promise<void> {
	await supabase.auth.signOut();
	await setStore('accessToken', '');
	await setStore('refreshToken', '');
	await setStore('user', null);
	await setStore('device', null);
	await setStore('group', null);
	await setStore('deviceType', '');
}
