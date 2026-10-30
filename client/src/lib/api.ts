import type { PostgrestError } from '@supabase/supabase-js';
import type { Command, Device, Message, PublicUser, UserSettings } from '$lib';
import { ensureAuthenticated, getSessionUserId, persistSession } from './auth';
import { getStore, setStore, initRealtime } from './tauri';
import { supabase, type Group } from './supabase';

// ---------------------------------------------------------------------------
// Response helpers
//
// Every exported function keeps its old signature and still returns a
// `Response`, so existing pages (`res.ok`, `await res.json()`, `res.status`,
// `await res.text()`) work unchanged. The `_token` parameters are kept for
// compatibility and ignored: supabase-js attaches the session JWT itself.
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fail = (message: string, status = 500): Response => json({ error: message }, status);
const notAuthenticated = (): Response => fail('Not authenticated', 401);

/** Map a PostgREST/Postgres error to an HTTP-style Response. */
function dbFail(error: PostgrestError, uniqueMessage = 'Already exists'): Response {
	switch (error.code) {
		case '23505':
			return fail(uniqueMessage, 409); // unique_violation
		case '23514':
			return fail('Invalid value: check names and message length', 400);
		case '23503':
			return fail('Related record not found', 400); // foreign_key_violation
		case '42501':
			return fail('Not allowed', 403); // RLS / privilege
		case 'PGRST116':
			return fail('Not found', 404); // .single() matched no rows
		default:
			return fail(error.message, 500);
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Row <-> UI mapping
// ---------------------------------------------------------------------------

type CommandRow = { id: string; name: string; command: string; aliases: string[] };
type DeviceRow = {
	id: string;
	name: string;
	type: 'client' | 'server';
	aliases: string[];
	assigned_group_id: string;
	assigned_user_id: string;
	commands: CommandRow[] | null;
};

/** `commands(...)` is an embedded relation (devices <- commands). */
const DEVICE_SELECT =
	'id, name, type, aliases, assigned_group_id, assigned_user_id, commands(id, name, command, aliases)';
const MESSAGE_SELECT = 'id, from_device_id, to_device_id, content, status, created_at';

export function rowToDevice(row: DeviceRow): Device {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		aliases: row.aliases ?? [],
		assignedGroup: { id: row.assigned_group_id },
		assignedUser: { id: row.assigned_user_id },
		deviceCommands: (row.commands ?? []).map((c) => ({
			id: c.id,
			name: c.name,
			command: c.command,
			aliases: c.aliases ?? []
		}))
	};
}

type MessageRow = {
	id: string;
	from_device_id: string | null;
	to_device_id: string;
	content: string;
	status: number;
	created_at: string;
};

const rowToMessage = (m: MessageRow): Message => ({
	id: m.id,
	from: m.from_device_id,
	to: m.to_device_id,
	content: m.content,
	status: m.status,
	createdAt: m.created_at
});

/**
 * What goes into the Tauri store as `device`. Same camelCase shape the Rust
 * `Device` struct deserializes. Messages are intentionally excluded.
 */
export function toStoredDevice(device: Device): Device {
	const { messages: _messages, ...rest } = device;
	return rest;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function fetchUserProfile(userId: string) {
	const { data, error } = await supabase
		.from('users')
		.select('id, email, username, settings')
		.eq('id', userId)
		.single();

	if (error) return null;
	return data;
}

const DEFAULT_SETTINGS: UserSettings = { primaryCommunicationMethod: 'realtime' };

function toPublicUser(
	authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> },
	profile: { id: string; email?: string; username?: string; settings?: unknown } | null,
	fallback?: { email?: string; username?: string }
): PublicUser {
	return {
		id: authUser.id,
		email:
			profile?.email ??
			authUser.email ??
			fallback?.email ??
			(typeof authUser.user_metadata?.email === 'string' ? authUser.user_metadata.email : ''),
		username:
			profile?.username ??
			(typeof authUser.user_metadata?.username === 'string'
				? authUser.user_metadata.username
				: (fallback?.username ?? '')),
		settings: {
			...DEFAULT_SETTINGS,
			...((profile?.settings ?? {}) as Partial<UserSettings>),
			primaryCommunicationMethod: 'realtime'
		}
	};
}

async function authSuccessResponse(
	session: NonNullable<
		Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data']['session']
	>,
	fallback?: { email?: string; username?: string }
): Promise<Response> {
	await persistSession(session);

	const profile = await fetchUserProfile(session.user.id);
	const user = toPublicUser(session.user, profile, fallback);

	const localDevice = (await getStore('device')) as Device | null;
	if (localDevice?.assignedUser?.id !== user.id) {
		await setStore('device', null);
		await setStore('group', null);
		await setStore('deviceType', '');
	}
	await setStore('user', user);
	await initRealtime();

	return json({
		user,
		accessToken: session.access_token,
		refreshToken: session.refresh_token
	});
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function loginApi(email: string, password: string): Promise<Response> {
	const normalizedEmail = email.trim().toLowerCase();
	if (!normalizedEmail || !password) return fail('Email and password are required', 400);

	const { data, error } = await supabase.auth.signInWithPassword({
		email: normalizedEmail,
		password
	});

	if (error || !data.session) return fail(error?.message ?? 'Invalid credentials', 401);

	return authSuccessResponse(data.session, { email: normalizedEmail });
}

export async function registerApi(
	email: string,
	username: string,
	password: string
): Promise<Response> {
	const normalizedEmail = email.trim().toLowerCase();
	const normalizedUsername = username.trim();

	if (!normalizedEmail || !normalizedUsername || !password) {
		return fail('Email, username, and password are required', 400);
	}
	if (normalizedUsername.length < 2 || normalizedUsername.length > 32) {
		return fail('Username must be 2–32 characters', 400);
	}

	// Pre-check so a taken username produces a clear error instead of the
	// signup trigger silently suffixing it (public.is_username_available is
	// callable before login).
	const { data: available } = await supabase.rpc('is_username_available', {
		p_username: normalizedUsername
	});
	if (available === false) return fail('That username is already taken', 409);

	const { data, error } = await supabase.auth.signUp({
		email: normalizedEmail,
		password,
		options: { data: { username: normalizedUsername } }
	});

	if (error || !data.user) return fail(error?.message ?? 'Registration failed', 400);

	let session = data.session;

	// signUp returns no session when "Confirm email" is still enabled in the dashboard.
	if (!session) {
		const signIn = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
		if (signIn.error || !signIn.data.session) {
			return fail(
				signIn.error?.message ??
					'Account created but sign-in failed. Disable "Confirm email" in Supabase → Authentication → Providers → Email.',
				400
			);
		}
		session = signIn.data.session;
	}

	// The profile row is created by the private.handle_new_user trigger.
	let profile = await fetchUserProfile(data.user.id);
	if (!profile) {
		await new Promise((r) => setTimeout(r, 500));
		profile = await fetchUserProfile(data.user.id);
	}
	if (!profile)
		return fail('Account created but profile was not found. Check schema.sql triggers.');

	return authSuccessResponse(session, { email: normalizedEmail, username: normalizedUsername });
}

export async function sessionRefreshApi(refreshToken: string): Promise<Response> {
	const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
	if (error || !data.session) return fail(error?.message ?? 'Invalid refresh token', 401);

	await persistSession(data.session);
	return json({
		accessToken: data.session.access_token,
		refreshToken: data.session.refresh_token
	});
}

export async function sessionUserApi(accessToken: string): Promise<Response> {
	const { data, error } = await supabase.auth.getUser(accessToken);
	if (error || !data.user) return fail('Invalid token', 401);

	const profile = await fetchUserProfile(data.user.id);
	if (!profile) return fail('User profile not found', 404);

	return json(toPublicUser(data.user, profile));
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export async function updateUserApi(user: PublicUser, _token: string): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	// NOTE: `email` is intentionally not updated here — it mirrors auth.users and
	// the column is not writable by clients. Change email via supabase.auth.updateUser().
	const { error } = await supabase
		.from('users')
		.update({ username: user.username, settings: user.settings })
		.eq('id', user.id);

	if (error) return dbFail(error, 'That username is already taken');
	return json(user);
}

// ---------------------------------------------------------------------------
// Groups  (reads use the `groups_with_devices` view -> group.devices.{client,server}: string[])
// ---------------------------------------------------------------------------

function viewRowToGroup(row: {
	id: string | null;
	name: string | null;
	assigned_user_id: string | null;
	settings: unknown;
	devices: unknown;
}): Group {
	const devices = (row.devices ?? {}) as { client?: string[]; server?: string[] };
	return {
		id: row.id ?? '',
		name: row.name ?? '',
		assigned_user_id: row.assigned_user_id ?? '',
		settings: (row.settings ?? {}) as Record<string, unknown>,
		devices: { client: devices.client ?? [], server: devices.server ?? [] }
	};
}

export async function fetchUserGroups(userId: string, _token: string): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	const { data, error } = await supabase
		.from('groups_with_devices')
		.select('*')
		.eq('assigned_user_id', userId)
		.order('created_at', { ascending: true });

	if (error) return dbFail(error);
	return json((data ?? []).map(viewRowToGroup));
}

export async function fetchGroupById(groupId: string, _token: string): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	const { data, error } = await supabase
		.from('groups_with_devices')
		.select('*')
		.eq('id', groupId)
		.single();

	if (error) return dbFail(error);
	return json(viewRowToGroup(data));
}

export async function createGroupApi(name: string, _token: string): Promise<Response> {
	const userId = await getSessionUserId();
	if (!userId) return notAuthenticated();

	const { data, error } = await supabase
		.from('groups')
		.insert({ name: name.trim() || 'New Group', assigned_user_id: userId })
		.select('id, name, assigned_user_id, settings')
		.single();

	if (error) return dbFail(error);
	// A new group has no devices yet.
	return json(viewRowToGroup({ ...data, devices: { client: [], server: [] } }));
}

export async function deleteGroupApi(groupId: string, _token: string): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	// ON DELETE CASCADE removes the group's devices, commands, presets, and AI history.
	const { error } = await supabase.from('groups').delete().eq('id', groupId);
	if (error) return dbFail(error);
	return new Response(null, { status: 200 });
}

/**
 * Save a command preset on a group and copy it onto every device in the group
 * (replaces the old POST /group/addCommand).
 */
export async function addCommandPresetToGroupApi(
	groupId: string,
	command: Command,
	_token = ''
): Promise<Response> {
	const userId = await getSessionUserId();
	if (!userId) return notAuthenticated();

	const { data, error } = await supabase
		.from('command_presets')
		.upsert(
			{
				assigned_group_id: groupId,
				assigned_user_id: userId,
				name: command.name,
				command: command.command,
				aliases: command.aliases
			},
			{ onConflict: 'assigned_group_id,name' }
		)
		.select('id')
		.single();
	if (error) return dbFail(error);

	const { data: applied, error: rpcError } = await supabase.rpc('apply_command_preset', {
		p_preset_id: data.id
	});
	if (rpcError) return dbFail(rpcError);
	return json({ presetId: data.id, devicesUpdated: applied });
}

// ---------------------------------------------------------------------------
// Devices  (client + server live in one `devices` table; `type` distinguishes)
// ---------------------------------------------------------------------------

/**
 * The `_type` argument is kept for compatibility; ids are globally unique so it
 * is not needed for lookup. Pass `withMessages = true` to also load the most
 * recent messages sent to or from the device.
 */
export async function getDeviceApi(
	id: string,
	_type: string,
	_token: string,
	withMessages = false
): Promise<Device | null> {
	if (!(await ensureAuthenticated())) return null;

	const { data, error } = await supabase
		.from('devices')
		.select(DEVICE_SELECT)
		.eq('id', id)
		.single();
	if (error || !data) return null;

	const device = rowToDevice(data as unknown as DeviceRow);
	if (withMessages) device.messages = await fetchDeviceMessages(id);
	return device;
}

export async function listAllDevices(_token: string): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	// RLS already scopes this to the signed-in user's devices.
	const { data, error } = await supabase
		.from('devices')
		.select(DEVICE_SELECT)
		.order('created_at', { ascending: true });
	if (error) return dbFail(error);

	const devices = (data as unknown as DeviceRow[]).map((row) => ({
		type: row.type,
		device: rowToDevice(row)
	}));
	return json({
		clientDevices: devices.filter((d) => d.type === 'client').map((d) => d.device),
		serverDevices: devices.filter((d) => d.type === 'server').map((d) => d.device)
	});
}

export async function createDeviceApi(
	deviceType: 'client' | 'server',
	body: { name: string; assignedGroupId: string },
	_token: string
): Promise<Response> {
	const userId = await getSessionUserId();
	if (!userId) return notAuthenticated();

	const name = body.name.trim();
	const { data, error } = await supabase
		.from('devices')
		.insert({
			name,
			type: deviceType,
			assigned_group_id: body.assignedGroupId,
			assigned_user_id: userId,
			aliases: [name]
		})
		.select(DEVICE_SELECT)
		.single();

	if (error) return dbFail(error, 'A device with that name already exists in this group');
	return json(rowToDevice(data as unknown as DeviceRow));
}

/**
 * Persist `device.deviceCommands` for one device. Idempotent: upserts by
 * (device_id, name), then deletes rows whose name is no longer present.
 */
async function syncDeviceCommands(
	deviceId: string,
	userId: string,
	commands: Command[]
): Promise<PostgrestError | null> {
	// Last occurrence wins if the UI list contains duplicate names.
	const byName = new Map<string, Command>();
	for (const c of commands) {
		const name = c.name?.trim();
		const command = c.command?.trim();
		if (name && command) byName.set(name, { ...c, name, command });
	}

	if (byName.size > 0) {
		const { error } = await supabase.from('commands').upsert(
			[...byName.values()].map((c) => ({
				device_id: deviceId,
				assigned_user_id: userId,
				name: c.name,
				command: c.command,
				aliases: (c.aliases ?? []).filter((a) => a.trim() !== '')
			})),
			{ onConflict: 'device_id,name' }
		);
		if (error) return error;
	}

	const { data: existing, error: listError } = await supabase
		.from('commands')
		.select('name')
		.eq('device_id', deviceId);
	if (listError) return listError;

	const stale = (existing ?? []).map((r) => r.name).filter((n) => !byName.has(n));
	if (stale.length > 0) {
		const { error } = await supabase
			.from('commands')
			.delete()
			.eq('device_id', deviceId)
			.in('name', stale);
		if (error) return error;
	}
	return null;
}

export async function updateDeviceApi(
	device: Device,
	_token: string,
	thisDeviceId?: string
): Promise<Response> {
	const userId = await getSessionUserId();
	if (!userId) return notAuthenticated();
	if (!device.id) return fail('Device id is required', 400);

	const type = device.type === 'server' ? 'server' : 'client';

	const { error } = await supabase
		.from('devices')
		.update({
			name: device.name?.trim() || undefined,
			type,
			aliases: device.aliases ?? []
		})
		.eq('id', device.id);
	if (error) return dbFail(error, 'A device with that name already exists in this group');

	if (device.deviceCommands) {
		const cmdError = await syncDeviceCommands(device.id, userId, device.deviceCommands);
		if (cmdError) return dbFail(cmdError, 'Two commands on this device share a name');
	}

	// Keep the local store in sync when editing THIS machine's device. The store
	// uses the same camelCase shape the Rust listener deserializes.
	if (device.id === thisDeviceId) {
		await setStore('device', toStoredDevice({ ...device, type }));
		await setStore('deviceType', type);
	}
	return new Response(null, { status: 200 });
}

export async function deleteDeviceApi(
	deviceId: string,
	_deviceType: 'client' | 'server',
	_token: string
): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	// Commands are deleted by cascade; messages TO the device cascade, messages
	// FROM it are kept with from_device_id = null.
	const { error } = await supabase.from('devices').delete().eq('id', deviceId);
	if (error) return dbFail(error);
	return new Response(null, { status: 200 });
}

/**
 * Kept for compatibility with device-setup. A device now belongs to a group via
 * `devices.assigned_group_id` (set at creation), so "adding" is a (re)assignment
 * and a no-op when it is already in that group.
 */
export async function addDeviceToGroupApi(
	body: { groupId: string; deviceId: string; deviceType: string },
	_token: string
): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	const { error } = await supabase
		.from('devices')
		.update({ assigned_group_id: body.groupId })
		.eq('id', body.deviceId);
	if (error) return dbFail(error, 'A device with that name already exists in this group');
	return new Response(null, { status: 200 });
}

// ---------------------------------------------------------------------------
// Messages  (one row per message; a device's messages = rows sent to/from it)
// ---------------------------------------------------------------------------

async function fetchDeviceMessages(
	deviceId: string,
	limit = 50,
	strict = false
): Promise<Message[]> {
	if (!UUID_RE.test(deviceId)) return [];

	const { data, error } = await supabase
		.from('messages')
		.select(MESSAGE_SELECT)
		.or(`to_device_id.eq.${deviceId},from_device_id.eq.${deviceId}`)
		.order('created_at', { ascending: false })
		.limit(limit);
	if (error) {
		if (strict) throw new Error(error.message);
		return [];
	}
	if (!data) return [];

	// Newest last, like the old embedded arrays.
	return (data as MessageRow[]).reverse().map(rowToMessage);
}

export async function getDeviceMessagesApi(deviceId: string, limit = 50): Promise<Message[]> {
	if (!(await ensureAuthenticated())) return [];
	return fetchDeviceMessages(deviceId, limit, true);
}

export async function sendMessageApi(body: {
	fromDeviceId: string | null;
	toDeviceId: string;
	content: string;
}): Promise<Response> {
	const userId = await getSessionUserId();
	if (!userId) return notAuthenticated();

	const { data, error } = await supabase
		.from('messages')
		.insert({
			assigned_user_id: userId,
			from_device_id: body.fromDeviceId,
			to_device_id: body.toDeviceId,
			content: body.content
		})
		.select(MESSAGE_SELECT)
		.single();

	// RLS rejects (42501) a message whose devices aren't the caller's.
	if (error) return dbFail(error);
	return json(rowToMessage(data as MessageRow));
}

export async function deleteMessageApi(id: string, _token: string): Promise<boolean> {
	if (!(await ensureAuthenticated())) return false;

	const { error } = await supabase.from('messages').delete().eq('id', id);
	return !error;
}

// ---------------------------------------------------------------------------
// Device session
// ---------------------------------------------------------------------------

export async function refreshDeviceSessionApi(_body: {
	user: PublicUser;
	device: unknown;
}): Promise<Response> {
	if (!(await ensureAuthenticated())) return notAuthenticated();

	const { data } = await supabase.auth.getSession();
	return json({ refreshToken: data.session?.refresh_token ?? '' });
}
