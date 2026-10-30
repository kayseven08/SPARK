import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	from: vi.fn(),
	rpc: vi.fn(),
	authenticated: vi.fn(),
	userId: vi.fn(),
	setStore: vi.fn(),
	getStore: vi.fn()
}));
vi.mock('./supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock('./auth', () => ({
	ensureAuthenticated: mocks.authenticated,
	getSessionUserId: mocks.userId,
	persistSession: vi.fn()
}));
vi.mock('./tauri', () => ({
	setStore: mocks.setStore,
	getStore: mocks.getStore,
	initRealtime: vi.fn()
}));
import { createDeviceApi, getDeviceMessagesApi, sendMessageApi, updateDeviceApi } from './api';

function query(data: unknown = null, error: unknown = null) {
	const result = { data, error };
	const chain = {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		upsert: vi.fn(),
		delete: vi.fn(),
		eq: vi.fn(),
		in: vi.fn(),
		or: vi.fn(),
		order: vi.fn(),
		limit: vi.fn(),
		single: vi.fn(),
		then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
	};
	for (const [name, method] of Object.entries(chain))
		if (name !== 'then') (method as ReturnType<typeof vi.fn>).mockReturnValue(chain);
	return chain;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.authenticated.mockResolvedValue(true);
	mocks.userId.mockResolvedValue('user-1');
});

describe('schema v2 application boundary', () => {
	it('creates a typed device in the unified table and maps its commands to UI fields', async () => {
		const q = query({
			id: 'device-1',
			name: 'Laptop',
			type: 'server',
			aliases: ['Laptop'],
			assigned_group_id: 'group-1',
			assigned_user_id: 'user-1',
			commands: [{ id: 'command-1', name: 'Open', command: 'open app', aliases: [] }]
		});
		mocks.from.mockReturnValue(q);
		const response = await createDeviceApi(
			'server',
			{ name: ' Laptop ', assignedGroupId: 'group-1' },
			''
		);
		expect(mocks.from).toHaveBeenCalledWith('devices');
		expect(q.insert).toHaveBeenCalledWith({
			name: 'Laptop',
			type: 'server',
			assigned_group_id: 'group-1',
			assigned_user_id: 'user-1',
			aliases: ['Laptop']
		});
		expect(await response.json()).toMatchObject({
			type: 'server',
			assignedGroup: { id: 'group-1' },
			deviceCommands: [{ id: 'command-1', name: 'Open' }]
		});
	});

	it('sends one normalized message row using the signed-in owner', async () => {
		const q = query({
			id: 'message-1',
			from_device_id: null,
			to_device_id: 'device-1',
			content: '[RUN COMMAND] Open',
			status: 0,
			created_at: 'now'
		});
		mocks.from.mockReturnValue(q);
		const response = await sendMessageApi({
			fromDeviceId: null,
			toDeviceId: 'device-1',
			content: '[RUN COMMAND] Open'
		});
		expect(q.insert).toHaveBeenCalledWith({
			assigned_user_id: 'user-1',
			from_device_id: null,
			to_device_id: 'device-1',
			content: '[RUN COMMAND] Open'
		});
		expect(await response.json()).toMatchObject({ from: null, to: 'device-1', status: 0 });
		expect(mocks.from.mock.calls).toEqual([['messages']]);
	});

	it('does not write anything when signed out', async () => {
		mocks.userId.mockResolvedValue(null);
		const response = await sendMessageApi({
			fromDeviceId: null,
			toDeviceId: 'device-1',
			content: 'Open'
		});
		expect(response.status).toBe(401);
		expect(mocks.from).not.toHaveBeenCalled();
	});

	it('updates commands as relational rows, removes old names, and excludes histories from the desktop store', async () => {
		const deviceQuery = query();
		const upsert = query();
		const existing = query([{ name: 'Old command' }, { name: 'Open' }]);
		const removed = query();
		mocks.from
			.mockReturnValueOnce(deviceQuery)
			.mockReturnValueOnce(upsert)
			.mockReturnValueOnce(existing)
			.mockReturnValueOnce(removed);
		const response = await updateDeviceApi(
			{
				id: 'device-1',
				name: 'Laptop',
				type: 'server',
				deviceCommands: [{ name: 'Open', command: 'open app', aliases: [] }],
				messages: [
					{
						id: 'message-1',
						from: null,
						to: 'device-1',
						content: 'old',
						status: 1,
						createdAt: 'now'
					}
				]
			},
			'',
			'device-1'
		);
		expect(response.ok).toBe(true);
		expect(deviceQuery.update).toHaveBeenCalledWith({
			name: 'Laptop',
			type: 'server',
			aliases: []
		});
		expect(upsert.upsert).toHaveBeenCalledWith(
			[
				{
					device_id: 'device-1',
					assigned_user_id: 'user-1',
					name: 'Open',
					command: 'open app',
					aliases: []
				}
			],
			{ onConflict: 'device_id,name' }
		);
		expect(removed.in).toHaveBeenCalledWith('name', ['Old command']);
		const stored = mocks.setStore.mock.calls.find(([key]) => key === 'device')?.[1];
		expect(stored).not.toHaveProperty('messages');
		expect(stored.type).toBe('server');
	});

	it('rejects malformed device IDs before building a message filter', async () => {
		expect(await getDeviceMessagesApi('id,other.eq.any')).toEqual([]);
		expect(mocks.from).not.toHaveBeenCalled();
	});
});
