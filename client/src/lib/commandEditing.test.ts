import { describe, expect, it } from 'vitest';
import { copyDevice, normalizeCommand, replaceCommand } from './commandEditing';

describe('command editor drafts', () => {
	it('isolates commands and aliases so cancelling edits leaves the source unchanged', () => {
		const source = {
			id: 'device-1',
			aliases: ['laptop'],
			deviceCommands: [{ name: 'Open', command: 'open .', aliases: ['files'] }]
		};
		const draft = copyDevice(source);
		draft.aliases[0] = 'edited laptop';
		draft.deviceCommands[0].name = 'Edited command';
		draft.deviceCommands[0].aliases[0] = 'edited files';
		expect(source.aliases).toEqual(['laptop']);
		expect(source.deviceCommands[0]).toEqual({
			name: 'Open',
			command: 'open .',
			aliases: ['files']
		});
	});
	it('trims values and removes empty or duplicate aliases', () => {
		expect(
			normalizeCommand({
				name: ' Open ',
				command: ' open . ',
				aliases: [' files ', '', 'files', ' folder ']
			})
		).toEqual({ name: 'Open', command: 'open .', aliases: ['files', 'folder'] });
	});
	it('replaces a renamed command without mutating the original or appending a duplicate', () => {
		const original = { id: 'command-1', name: 'Old', command: 'open .', aliases: [] };
		const result = replaceCommand([original], { ...original, name: 'New' }, original);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('New');
		expect(original.name).toBe('Old');
	});
	it('rejects duplicate names and blank fields without changing the source', () => {
		const source = [{ name: 'Open', command: 'open .', aliases: [] }];
		expect(() =>
			replaceCommand(source, { name: ' Open ', command: 'open -a Notes', aliases: [] })
		).toThrow('already exists');
		expect(() => normalizeCommand({ name: ' ', command: 'open .', aliases: [] })).toThrow(
			'command name'
		);
		expect(() => normalizeCommand({ name: 'Open', command: ' ', aliases: [] })).toThrow(
			'shell command'
		);
		expect(source).toHaveLength(1);
	});
});
