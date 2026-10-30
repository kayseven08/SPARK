import { expect, test } from '@playwright/test';
import { mockDesktop } from './desktop-fixture';

test('signed-out startup reaches login without a redirect loop', async ({ page }) => {
	const app = await mockDesktop(page, false);
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toBeVisible();
	expect(app.errors).toEqual([]);
});

test('login saves the session and advances to group setup', async ({ page }) => {
	const app = await mockDesktop(page, false);
	await page.goto('/login');
	await page.getByLabel('Email', { exact: true }).fill('spark@example.test');
	await page.getByLabel('Password', { exact: true }).fill('test-password');
	await page.getByRole('button', { name: 'Log In', exact: true }).click();
	await expect(page).toHaveURL(/\/group-info$/);
	await expect(page.getByRole('heading', { name: 'Choose a group', exact: true })).toBeVisible();
	expect(app.errors).toEqual([]);
});

test('settings save errors are visible and retry updates the persisted profile', async ({
	page
}) => {
	const app = await mockDesktop(page);
	let fail = true;
	await page.route('**/rest/v1/users?**', async (route) => {
		if (route.request().method() === 'PATCH' && fail) {
			fail = false;
			await route.fulfill({
				status: 500,
				json: { code: 'XX000', message: 'Settings are temporarily unavailable' }
			});
		} else await route.fallback();
	});
	await page.goto('/settings');
	await page.getByLabel('Username', { exact: true }).fill('updated-user');
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Settings are temporarily unavailable');
	expect(await page.evaluate(() => (window as any).__SPARK_TEST_STORE__.user.username)).toBe(
		'spark'
	);
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Settings saved.');
	expect(await page.evaluate(() => (window as any).__SPARK_TEST_STORE__.user.username)).toBe(
		'updated-user'
	);
	expect(app.errors).toEqual([]);
});
