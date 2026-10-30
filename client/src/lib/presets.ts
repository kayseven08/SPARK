import type { Command } from '$lib';

export const DEFAULT_PRESETS: Command[] = [
	{ name: 'Launch Notepad', aliases: ['Open Notepad', 'Start Notepad'], command: 'start notepad' },
	{ name: 'Open Browser', aliases: ['browse', 'web', 'chrome'], command: 'start chrome' },
	{ name: 'File Explorer', aliases: ['files', 'explorer'], command: 'explorer.exe' },
	{ name: 'System Shutdown', aliases: ['shutdown', 'poweroff'], command: 'shutdown /s /t 0' },
	{ name: 'System Restart', aliases: ['restart', 'reboot'], command: 'shutdown /r /t 0' },
	{ name: 'Task Manager', aliases: ['tasks', 'processes'], command: 'taskmgr.exe' },
	{ name: 'Control Panel', aliases: ['settings', 'config'], command: 'control.exe' },
	{ name: 'Terminal', aliases: ['cmd', 'command prompt'], command: 'cmd.exe' }
];
/** Built-ins must match the OS running the editor, not assume Windows. */
export function getDefaultPresets(platform: string): Command[] {
	if (/mac/i.test(platform))
		return [
			{ name: 'Open Browser', aliases: ['browse', 'web'], command: 'open https://www.google.com' },
			{ name: 'Open Finder', aliases: ['files', 'finder'], command: 'open .' },
			{ name: 'Open Terminal', aliases: ['terminal'], command: 'open -a Terminal' },
			{ name: 'Open Notes', aliases: ['notes'], command: 'open -a Notes' },
			{
				name: 'Activity Monitor',
				aliases: ['processes', 'tasks'],
				command: 'open -a "Activity Monitor"'
			},
			{ name: 'System Settings', aliases: ['settings'], command: 'open -a "System Settings"' }
		];
	if (/linux/i.test(platform))
		return [
			{
				name: 'Open Browser',
				aliases: ['browse', 'web'],
				command: 'xdg-open https://www.google.com'
			},
			{ name: 'Open Files', aliases: ['files'], command: 'xdg-open .' },
			{ name: 'Open Terminal', aliases: ['terminal'], command: 'x-terminal-emulator' }
		];
	return DEFAULT_PRESETS;
}
