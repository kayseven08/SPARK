// UI-facing domain types. These are the shapes the Svelte pages and the Tauri
// store use (camelCase + nested assignedUser/assignedGroup). `$lib/api.ts` maps
// Supabase rows (snake_case) to/from these, so pages never see raw rows.

export type Message = {
	id: string;
	from: string | null; // sender device id (null if the sender device was deleted)
	to: string; // receiver device id
	content: string;
	status: number; // 0 = pending, 1 = handled, 2 = failed
	createdAt: string;
};

export type Command = {
	id?: string; // present once persisted
	command: string;
	name: string;
	aliases: string[];
};

export type Device = {
	id?: string;
	name?: string;
	type?: 'client' | 'server' | string;
	aliases?: string[];
	assignedGroup?: { id: string };
	assignedUser?: { id: string };
	deviceCommands?: Command[];
	/** Loaded on demand via getDeviceMessagesApi(); never stored in the Tauri store. */
	messages?: Message[];
};

export type UserSettings = {
	primaryCommunicationMethod: 'realtime' | 'api' | 'localhost';
};

export type PublicUser = {
	id: string;
	email?: string;
	username: string;
	settings: UserSettings;
};
