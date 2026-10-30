import type { Command, Device } from '$lib';

export const emptyCommand = (): Command => ({ name: '', command: '', aliases: [] });
export const copyCommand = (command: Command): Command => ({
	...command,
	aliases: [...(command.aliases ?? [])]
});
export const copyDevice = (
	device: Device
): Device & { aliases: string[]; deviceCommands: Command[] } => ({
	...device,
	aliases: [...(device.aliases ?? [])],
	deviceCommands: (device.deviceCommands ?? []).map(copyCommand)
});

export function normalizeCommand(command: Command): Command {
	const normalized = {
		...command,
		name: command.name.trim(),
		command: command.command.trim(),
		aliases: [...new Set(command.aliases.map((alias) => alias.trim()).filter(Boolean))]
	};
	if (!normalized.name) throw new Error('Enter a command name.');
	if (!normalized.command) throw new Error('Enter the shell command to run.');
	return normalized;
}

export function replaceCommand(
	commands: Command[],
	updated: Command,
	original?: Command
): Command[] {
	const next = normalizeCommand(updated);
	const index = original
		? commands.findIndex(
				(command) => command === original || (!!original.id && command.id === original.id)
			)
		: -1;
	if (commands.some((command, i) => i !== index && command.name.trim() === next.name)) {
		throw new Error('A command with this name already exists on this device.');
	}
	return index < 0
		? [...commands, next]
		: commands.map((command, i) => (i === index ? next : command));
}
