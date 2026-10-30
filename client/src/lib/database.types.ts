// Generated from the live SPARK Supabase project (schema v2).
// Regenerate after any schema change:
//   npx supabase gen types typescript --project-id knhwzdrjpkzeuuneqmbh > client/src/lib/database.types.ts
// Do not edit by hand.

export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Database = {
	// Allows to automatically instantiate createClient with right options
	// instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
	__InternalSupabase: {
		PostgrestVersion: '14.5';
	};
	public: {
		Tables: {
			ai_messages: {
				Row: {
					assigned_group_id: string;
					assigned_user_id: string;
					content: string;
					created_at: string;
					id: number;
					role: string;
				};
				Insert: {
					assigned_group_id: string;
					assigned_user_id: string;
					content: string;
					created_at?: string;
					id?: never;
					role: string;
				};
				Update: {
					assigned_group_id?: string;
					assigned_user_id?: string;
					content?: string;
					created_at?: string;
					id?: never;
					role?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'ai_messages_assigned_group_id_assigned_user_id_fkey';
						columns: ['assigned_group_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'groups';
						referencedColumns: ['id', 'assigned_user_id'];
					},
					{
						foreignKeyName: 'ai_messages_assigned_group_id_assigned_user_id_fkey';
						columns: ['assigned_group_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'groups_with_devices';
						referencedColumns: ['id', 'assigned_user_id'];
					}
				];
			};
			command_presets: {
				Row: {
					aliases: string[];
					assigned_group_id: string;
					assigned_user_id: string;
					command: string;
					created_at: string;
					id: string;
					name: string;
				};
				Insert: {
					aliases?: string[];
					assigned_group_id: string;
					assigned_user_id: string;
					command: string;
					created_at?: string;
					id?: string;
					name: string;
				};
				Update: {
					aliases?: string[];
					assigned_group_id?: string;
					assigned_user_id?: string;
					command?: string;
					created_at?: string;
					id?: string;
					name?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'command_presets_assigned_group_id_assigned_user_id_fkey';
						columns: ['assigned_group_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'groups';
						referencedColumns: ['id', 'assigned_user_id'];
					},
					{
						foreignKeyName: 'command_presets_assigned_group_id_assigned_user_id_fkey';
						columns: ['assigned_group_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'groups_with_devices';
						referencedColumns: ['id', 'assigned_user_id'];
					}
				];
			};
			commands: {
				Row: {
					aliases: string[];
					assigned_user_id: string;
					command: string;
					created_at: string;
					device_id: string;
					id: string;
					name: string;
				};
				Insert: {
					aliases?: string[];
					assigned_user_id: string;
					command: string;
					created_at?: string;
					device_id: string;
					id?: string;
					name: string;
				};
				Update: {
					aliases?: string[];
					assigned_user_id?: string;
					command?: string;
					created_at?: string;
					device_id?: string;
					id?: string;
					name?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'commands_device_id_assigned_user_id_fkey';
						columns: ['device_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'devices';
						referencedColumns: ['id', 'assigned_user_id'];
					}
				];
			};
			devices: {
				Row: {
					aliases: string[];
					assigned_group_id: string;
					assigned_user_id: string;
					created_at: string;
					id: string;
					name: string;
					settings: Json;
					type: Database['public']['Enums']['device_type'];
					updated_at: string;
				};
				Insert: {
					aliases?: string[];
					assigned_group_id: string;
					assigned_user_id: string;
					created_at?: string;
					id?: string;
					name: string;
					settings?: Json;
					type: Database['public']['Enums']['device_type'];
					updated_at?: string;
				};
				Update: {
					aliases?: string[];
					assigned_group_id?: string;
					assigned_user_id?: string;
					created_at?: string;
					id?: string;
					name?: string;
					settings?: Json;
					type?: Database['public']['Enums']['device_type'];
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'devices_assigned_user_id_fkey';
						columns: ['assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'devices_group_owner_fkey';
						columns: ['assigned_group_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'groups';
						referencedColumns: ['id', 'assigned_user_id'];
					},
					{
						foreignKeyName: 'devices_group_owner_fkey';
						columns: ['assigned_group_id', 'assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'groups_with_devices';
						referencedColumns: ['id', 'assigned_user_id'];
					}
				];
			};
			groups: {
				Row: {
					assigned_user_id: string;
					created_at: string;
					id: string;
					name: string;
					settings: Json;
					updated_at: string;
				};
				Insert: {
					assigned_user_id: string;
					created_at?: string;
					id?: string;
					name?: string;
					settings?: Json;
					updated_at?: string;
				};
				Update: {
					assigned_user_id?: string;
					created_at?: string;
					id?: string;
					name?: string;
					settings?: Json;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'groups_assigned_user_id_fkey';
						columns: ['assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					}
				];
			};
			messages: {
				Row: {
					assigned_user_id: string;
					content: string;
					created_at: string;
					from_device_id: string | null;
					id: string;
					status: number;
					to_device_id: string;
				};
				Insert: {
					assigned_user_id: string;
					content: string;
					created_at?: string;
					from_device_id?: string | null;
					id?: string;
					status?: number;
					to_device_id: string;
				};
				Update: {
					assigned_user_id?: string;
					content?: string;
					created_at?: string;
					from_device_id?: string | null;
					id?: string;
					status?: number;
					to_device_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'messages_assigned_user_id_fkey';
						columns: ['assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'messages_from_device_id_fkey';
						columns: ['from_device_id'];
						isOneToOne: false;
						referencedRelation: 'devices';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'messages_to_device_id_fkey';
						columns: ['to_device_id'];
						isOneToOne: false;
						referencedRelation: 'devices';
						referencedColumns: ['id'];
					}
				];
			};
			users: {
				Row: {
					created_at: string;
					email: string;
					id: string;
					integrations: Json;
					settings: Json;
					updated_at: string;
					username: string;
				};
				Insert: {
					created_at?: string;
					email: string;
					id: string;
					integrations?: Json;
					settings?: Json;
					updated_at?: string;
					username: string;
				};
				Update: {
					created_at?: string;
					email?: string;
					id?: string;
					integrations?: Json;
					settings?: Json;
					updated_at?: string;
					username?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			groups_with_devices: {
				Row: {
					assigned_user_id: string | null;
					created_at: string | null;
					devices: Json | null;
					id: string | null;
					name: string | null;
					settings: Json | null;
					updated_at: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'groups_assigned_user_id_fkey';
						columns: ['assigned_user_id'];
						isOneToOne: false;
						referencedRelation: 'users';
						referencedColumns: ['id'];
					}
				];
			};
		};
		Functions: {
			apply_command_preset: { Args: { p_preset_id: string }; Returns: number };
			is_username_available: { Args: { p_username: string }; Returns: boolean };
		};
		Enums: {
			device_type: 'client' | 'server';
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

export const Constants = {
	public: {
		Enums: {
			device_type: ['client', 'server']
		}
	}
} as const;
