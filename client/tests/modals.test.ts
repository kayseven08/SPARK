import { expect, test, type Locator } from '@playwright/test';
import { mockDesktop, LOCAL_ID, REMOTE_ID } from './desktop-fixture';

async function contained(dialog: Locator) {
	await expect(dialog).toBeVisible();
	expect(
		await dialog.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const body = element.querySelector('.modal-body')!;
			return (
				rect.left >= 0 &&
				rect.right <= window.innerWidth + 1 &&
				rect.top >= 0 &&
				rect.bottom <= window.innerHeight + 1 &&
				element.scrollWidth <= element.clientWidth + 1 &&
				body.scrollWidth <= body.clientWidth + 1
			);
		})
	).toBe(true);
	const footer = dialog.locator('.modal-footer');
	await expect(footer).toBeInViewport();
	expect(
		await dialog.evaluate((element) => {
			const header = element.querySelector('.modal-header')!.getBoundingClientRect();
			const body = element.querySelector('.modal-body')!.getBoundingClientRect();
			const footer = element.querySelector('.modal-footer')!.getBoundingClientRect();
			return header.bottom <= body.top + 1 && body.bottom <= footer.top + 1;
		})
	).toBe(true);
}

for (const viewport of [
	{ width: 1366, height: 900 },
	{ width: 768, height: 900 },
	{ width: 390, height: 844 },
	{ width: 900, height: 560 }
]) {
	test(`nested editors fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
		await page.setViewportSize(viewport);
		const app = await mockDesktop(page);
		await page.goto('/this-device');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.getByRole('button', { name: 'Manage device', exact: true }).click();
		const device = page.getByRole('dialog', { name: 'Device settings', exact: true });
		await contained(device);
		await device.getByRole('button', { name: '+ Add command', exact: true }).click();
		const command = page.getByRole('dialog', { name: 'Create command', exact: true });
		await contained(command);
		await command.getByRole('button', { name: 'Browse presets' }).click();
		await expect(command.getByRole('region', { name: 'Command presets' })).toBeVisible();
		await contained(command);
		await page.screenshot({ path: testInfo.outputPath(`command-${viewport.width}.png`) });
		await command.getByRole('button', { name: 'Project terminal' }).click();
		await expect(command.getByLabel('Command name', { exact: true })).toHaveValue(
			'Project terminal'
		);
		await page.keyboard.press('Escape');
		await expect(command).toHaveCount(0);
		await expect(device).toBeVisible();
		await expect(device.getByRole('button', { name: '+ Add command', exact: true })).toBeFocused();
		await page.screenshot({ path: testInfo.outputPath(`device-${viewport.width}.png`) });
		await device.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(device).toHaveCount(0);
		expect(app.writes).toHaveLength(0);
		expect(app.errors).toEqual([]);
	});
}

test('cancel discards edited commands; save persists names, code, and aliases', async ({
	page
}) => {
	const app = await mockDesktop(page);
	await page.goto('/commands');
	await page.getByRole('button', { name: 'Edit Open browser', exact: true }).click();
	const edit = page.getByRole('dialog', { name: 'Edit command', exact: true });
	await edit.getByLabel('Command name', { exact: true }).fill('Unsaved name');
	await edit.getByLabel('Voice aliases 1', { exact: true }).fill('unsaved alias');
	await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Edit Open browser', exact: true })).toBeVisible();
	expect(app.writes).toHaveLength(0);
	await page.getByRole('button', { name: 'Edit Open browser', exact: true }).click();
	await expect(edit.getByLabel('Command name', { exact: true })).toHaveValue('Open browser');
	await expect(edit.getByLabel('Voice aliases 1', { exact: true })).toHaveValue('browse');
	await edit.getByLabel('Command name', { exact: true }).fill('Open docs');
	await edit.getByLabel('Shell command', { exact: true }).fill('open https://docs.example.test');
	await edit.getByLabel('Voice aliases 1', { exact: true }).fill('documentation');
	await edit.getByRole('button', { name: 'Save command', exact: true }).click();
	await expect(edit).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Edit Open docs', exact: true })).toBeVisible();
	expect(app.commands.find((command) => command.device_id === LOCAL_ID)).toMatchObject({
		name: 'Open docs',
		command: 'open https://docs.example.test',
		aliases: ['documentation', 'open the web']
	});
	expect(app.errors).toEqual([]);
});

test('failed saves keep the editor open and can be retried without duplicate commands', async ({
	page
}) => {
	const app = await mockDesktop(page);
	let failed = false;
	await page.route('**/rest/v1/devices?**', async (route) => {
		if (route.request().method() === 'PATCH' && !failed) {
			failed = true;
			await route.fulfill({
				status: 500,
				json: { code: 'XX000', message: 'Temporary save failure' }
			});
		} else await route.fallback();
	});
	await page.goto('/commands');
	await page.getByRole('button', { name: '+ New Command', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Create command', exact: true });
	await dialog.getByLabel('Command name', { exact: true }).fill('Open notes');
	await dialog.getByLabel('Shell command', { exact: true }).fill('open -a Notes');
	await dialog.getByRole('button', { name: 'Save command', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('Temporary save failure');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Save command', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(app.commands.filter((command) => command.name === 'Open notes')).toHaveLength(1);
	expect(app.errors).toEqual([]);
});

test('nested command changes are staged; cancel discards them and save commits the device', async ({
	page
}) => {
	const app = await mockDesktop(page);
	await page.goto('/this-device');
	await page.getByRole('button', { name: 'Manage device', exact: true }).click();
	const device = page.getByRole('dialog', { name: 'Device settings', exact: true });
	await device.getByLabel('Device name', { exact: true }).fill('Work Mac');
	await device.getByRole('button', { name: '+ Add command', exact: true }).click();
	const command = page.getByRole('dialog', { name: 'Create command', exact: true });
	await command.getByLabel('Command name', { exact: true }).fill('Open notes');
	await command.getByLabel('Shell command', { exact: true }).fill('open -a Notes');
	await command.getByRole('button', { name: 'Save command', exact: true }).click();
	await expect(device.getByRole('button', { name: 'Edit Open notes', exact: true })).toBeVisible();
	expect(app.writes).toHaveLength(0);
	await device.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'Manage device', exact: true }).click();
	await expect(device.getByLabel('Device name', { exact: true })).toHaveValue('Local Mac');
	await expect(device.getByRole('button', { name: 'Edit Open notes', exact: true })).toHaveCount(0);
	await device.getByLabel('Device name', { exact: true }).fill('Work Mac');
	await device.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(device).toHaveCount(0);
	expect(app.devices.find((item) => item.id === LOCAL_ID)?.name).toBe('Work Mac');
	await expect(page.getByRole('heading', { name: 'Work Mac', exact: true })).toBeVisible();
	expect(app.errors).toEqual([]);
});

test('remote commands send a message instead of invoking a local shell', async ({ page }) => {
	const app = await mockDesktop(page);
	await page.goto('/servers');
	await page.getByRole('button', { name: /Studio Desktop/ }).click();
	const device = page.getByRole('dialog', { name: 'Device settings', exact: true });
	await device.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(device.getByRole('status')).toContainText('Command sent');
	expect(app.messages.at(-1)).toMatchObject({
		from_device_id: LOCAL_ID,
		to_device_id: REMOTE_ID,
		content: '[RUN COMMAND] Open files'
	});
	expect(await page.evaluate(() => (window as any).__SPARK_TEST_COMMANDS__)).toEqual([]);
	expect(app.errors).toEqual([]);
});

test('create-group dialog fits a phone and submits only once', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const app = await mockDesktop(page);
	await page.addInitScript(() => {
		(window as any).__SPARK_TEST_STORE__.device = null;
	});
	await page.goto('/groups-select');
	await page.getByRole('button', { name: '+ Create a new group', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Create group', exact: true });
	await contained(dialog);
	await dialog.getByLabel('Group name', { exact: true }).fill('Office devices');
	await dialog.getByRole('button', { name: 'Create group', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Office devices', exact: true })).toBeVisible();
	expect(app.writes.filter((write) => write.table === 'groups')).toHaveLength(1);
	expect(app.errors).toEqual([]);
});

for (const width of [1366, 390]) {
	test(`main application routes fit and navigation works at ${width}px`, async ({
		page
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		const app = await mockDesktop(page);
		for (const path of [
			'/dashboard',
			'/clients',
			'/servers',
			'/commands',
			'/this-device',
			'/settings',
			'/group/20000000-0000-4000-8000-000000000001'
		]) {
			await page.goto(path);
			await expect(page.locator('main h1').first()).toBeVisible();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			if (path === '/settings')
				await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`) });
			expect(
				await page
					.locator('main')
					.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
				path
			).toBe(true);
		}
		if (width < 768) {
			await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
			await page
				.getByRole('navigation', { name: 'Main navigation', exact: true })
				.getByRole('button', { name: 'Commands', exact: true })
				.click();
			await expect(page).toHaveURL(/\/commands$/);
			await expect(
				page.getByRole('button', { name: 'Open navigation', exact: true })
			).toHaveAttribute('aria-expanded', 'false');
		}
		expect(app.errors).toEqual([]);
	});
}

test('test-run errors are visible and the dialog remains editable', async ({ page }) => {
	await mockDesktop(page);
	await page.addInitScript(() => {
		const target = window as any;
		const original = target.__TAURI_IPC__;
		target.__TAURI_IPC__ = (message: any) => {
			if (message.cmd === 'run_command')
				queueMicrotask(() => target[`_${message.error}`]('Command exited unsuccessfully'));
			else original(message);
		};
	});
	await page.goto('/commands');
	await page.getByRole('button', { name: 'Edit Open browser', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Edit command', exact: true });
	await dialog.getByRole('button', { name: 'Test run', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('Command exited unsuccessfully');
	await expect(dialog.getByLabel('Shell command', { exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toHaveCount(0);
});
