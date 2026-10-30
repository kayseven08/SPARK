import type { Page } from '@playwright/test';

export const USER_ID = '10000000-0000-4000-8000-000000000001';
export const GROUP_ID = '20000000-0000-4000-8000-000000000001';
export const LOCAL_ID = '30000000-0000-4000-8000-000000000001';
export const REMOTE_ID = '30000000-0000-4000-8000-000000000002';

export async function mockDesktop(page: Page, signedIn = true) {
	const user = {
		id: USER_ID,
		email: 'spark@example.test',
		username: 'spark',
		settings: { primaryCommunicationMethod: 'realtime' }
	};
	const authUser = {
		...user,
		aud: 'authenticated',
		role: 'authenticated',
		email_confirmed_at: '2026-01-01T00:00:00Z',
		app_metadata: { provider: 'email' },
		user_metadata: { username: user.username },
		created_at: '2026-01-01T00:00:00Z'
	};
	const encode = (value: unknown) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: USER_ID, aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.signature`;
	const session = {
		access_token: token,
		refresh_token: 'test-refresh-token',
		token_type: 'bearer',
		expires_in: 3600,
		expires_at: 4102444800,
		user: authUser
	};
	const commands = [
		{
			id: '40000000-0000-4000-8000-000000000001',
			device_id: LOCAL_ID,
			assigned_user_id: USER_ID,
			name: 'Open browser',
			command: 'open https://example.test',
			aliases: ['browse', 'open the web']
		},
		{
			id: '40000000-0000-4000-8000-000000000002',
			device_id: REMOTE_ID,
			assigned_user_id: USER_ID,
			name: 'Open files',
			command: 'open .',
			aliases: ['files']
		}
	];
	const devices = [
		{
			id: LOCAL_ID,
			name: 'Local Mac',
			type: 'client',
			assigned_user_id: USER_ID,
			assigned_group_id: GROUP_ID,
			aliases: ['my laptop'],
			created_at: '2026-01-01T00:00:00Z'
		},
		{
			id: REMOTE_ID,
			name: 'Studio Desktop',
			type: 'server',
			assigned_user_id: USER_ID,
			assigned_group_id: GROUP_ID,
			aliases: ['desktop'],
			created_at: '2026-01-01T00:00:00Z'
		}
	];
	const groups = [
		{
			id: GROUP_ID,
			name: 'Home devices',
			assigned_user_id: USER_ID,
			settings: {},
			created_at: '2026-01-01T00:00:00Z'
		}
	];
	const messages = [
		{
			id: '50000000-0000-4000-8000-000000000001',
			from_device_id: REMOTE_ID,
			to_device_id: LOCAL_ID,
			assigned_user_id: USER_ID,
			content: '[RUN COMMAND] Open browser',
			status: 1,
			created_at: '2026-01-01T00:00:00Z'
		}
	];
	const storedDevice = {
		...devices[0],
		assignedGroup: { id: GROUP_ID },
		assignedUser: { id: USER_ID },
		deviceCommands: commands.filter((command) => command.device_id === LOCAL_ID)
	};
	const storedGroup = { ...groups[0], devices: { client: [LOCAL_ID], server: [REMOTE_ID] } };
	const errors: string[] = [];
	const writes: { table: string; method: string; body: any }[] = [];
	page.on('pageerror', (error) => errors.push(error.message));

	await page.addInitScript(
		({ user, session, storedDevice, storedGroup, signedIn }) => {
			const store: Record<string, unknown> = signedIn
				? {
						user,
						device: storedDevice,
						group: storedGroup,
						accessToken: session.access_token,
						refreshToken: session.refresh_token,
						deviceType: 'client'
					}
				: { user: null, device: null, group: null, accessToken: '', refreshToken: '' };
			const target = window as any;
			target.__SPARK_TEST_STORE__ = store;
			target.__SPARK_TEST_COMMANDS__ = [];
			target.__TAURI_IPC__ = (message: any) => {
				let value: unknown = null;
				if (message.cmd === 'get_store') value = store[message.key] ?? null;
				else if (message.cmd === 'set_store') store[message.key] = message.value;
				else if (message.cmd === 'run_command')
					target.__SPARK_TEST_COMMANDS__.push(message.command);
				queueMicrotask(() => target[`_${message.callback}`](value));
			};
		},
		{ user, session, storedDevice, storedGroup, signedIn }
	);

	await page.route('**/auth/v1/**', async (route) => {
		const url = new URL(route.request().url());
		await route.fulfill({ json: url.pathname.endsWith('/user') ? authUser : session });
	});
	await page.route('**/rest/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const table = url.pathname.split('/').pop()!;
		const method = request.method();
		const body = request.postDataJSON();
		const id = url.searchParams.get('id')?.replace('eq.', '');
		if (method !== 'GET') writes.push({ table, method, body });
		const withCommands = (device: (typeof devices)[number]) => ({
			...device,
			commands: commands.filter((command) => command.device_id === device.id)
		});
		let data: any[] | object | boolean = [];
		if (table === 'users') data = [user];
		else if (table === 'groups_with_devices')
			data = groups
				.filter((group) => !id || group.id === id)
				.map((group) => ({
					...group,
					devices: {
						client: devices
							.filter((device) => device.assigned_group_id === group.id && device.type === 'client')
							.map((device) => device.id),
						server: devices
							.filter((device) => device.assigned_group_id === group.id && device.type === 'server')
							.map((device) => device.id)
					}
				}));
		else if (table === 'devices') {
			if (method === 'PATCH') Object.assign(devices.find((device) => device.id === id)!, body);
			data = devices.filter((device) => !id || device.id === id).map(withCommands);
		} else if (table === 'commands') {
			const deviceId = url.searchParams.get('device_id')?.replace('eq.', '');
			if (method === 'POST')
				for (const incoming of Array.isArray(body) ? body : [body]) {
					const existing = commands.find(
						(command) => command.device_id === incoming.device_id && command.name === incoming.name
					);
					if (existing) Object.assign(existing, incoming);
					else commands.push({ id: `command-${commands.length + 1}`, ...incoming });
				}
			if (method === 'DELETE') {
				const names = url.searchParams.get('name') ?? '';
				for (let i = commands.length - 1; i >= 0; i--)
					if (commands[i].device_id === deviceId && names.includes(commands[i].name))
						commands.splice(i, 1);
			}
			data = commands.filter((command) => !deviceId || command.device_id === deviceId);
		} else if (table === 'command_presets')
			data = [
				{ name: 'Project terminal', command: 'open -a Terminal', aliases: ['code terminal'] }
			];
		else if (table === 'messages') {
			if (method === 'POST')
				messages.push({
					id: `message-${messages.length + 1}`,
					status: 0,
					created_at: '2026-01-01T00:00:00Z',
					...body
				});
			if (method === 'DELETE') {
				const index = messages.findIndex((message) => message.id === id);
				if (index >= 0) messages.splice(index, 1);
			}
			data = messages;
		} else if (table === 'groups') {
			if (method === 'POST')
				groups.push({
					id: `group-${groups.length + 1}`,
					settings: {},
					created_at: '2026-01-01T00:00:00Z',
					...body
				});
			data = method === 'POST' ? [groups.at(-1)!] : groups;
		} else if (table === 'is_username_available') data = true;
		if (
			request.headers().accept?.includes('application/vnd.pgrst.object+json') &&
			Array.isArray(data)
		)
			data = data[0] ?? null;
		await route.fulfill({ json: data });
	});
	return { writes, errors, devices, commands, messages, groups };
}
