import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root = process.env.E2E_WORK_ROOT || path.join(os.homedir(), 'work/tmp/remotepad2-e2e');
const fixtures = path.join(root, 'fixtures');
const repo = path.join(fixtures, 'demo-repo');
const row = (page: Page, target: string) => page.locator('.tree-row').filter({ has: page.locator('.tree-name', { hasText: target }) });
async function browse(page: Page) {
  await page.goto('/');
  await expect(page.locator('.xterm')).toBeVisible();
  await page.getByRole('textbox', { name: 'Directory', exact: true }).fill(fixtures);
  await page.getByRole('textbox', { name: 'Directory', exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Explorer directory' })).toHaveValue(fixtures);
}
async function layoutCheck(page: Page, name: string, checked: boolean) {
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await page.getByRole('checkbox', { name, exact: true }).setChecked(checked);
  await page.keyboard.press('Escape');
}
async function drag(page: Page, label: string, dx: number, dy = 0) {
  const handle = page.getByRole('separator', { name: label });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2 + dy, { steps: 10 }); await page.mouse.up();
}
test.beforeAll(async () => {
  await mkdir(repo, { recursive: true });
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  await writeFile(path.join(repo, 'note.py'), 'print("hello")\n');
  await writeFile(path.join(fixtures, 'README.md'), '# Workbench preview\n');
  await writeFile(path.join(fixtures, 'data.csv'), 'name,value\n"a,b",42\n');
  await mkdir(path.join(root, 'home/.ssh'), { recursive: true });
  await writeFile(path.join(root, 'home/.ssh/config'), 'Host test-cloud\n  HostName example.invalid\n');
});
test('folder pin controls and immediate double-click expansion stay independent', async ({ page }) => {
  await browse(page);
  await expect(page.getByRole('button', { name: 'Open folder', exact: true })).toHaveCount(0);
  const folder = row(page, 'demo-repo');
  await folder.getByRole('button', { name: 'Add to Favorite: demo-repo', exact: true }).click();
  await expect(folder.getByRole('button', { name: 'Remove from Favorite: demo-repo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await folder.getByRole('button', { name: 'Add to Repo: demo-repo', exact: true }).click();
  await expect(folder.getByRole('button', { name: 'Remove from Repo: demo-repo', exact: true })).toBeVisible();
  await folder.locator('.tree-name').dblclick();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'note.py')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Explorer directory' }).filter({ visible: true })).toHaveValue(repo);
  // Starting expanded must finish expanded too, without a single-click timer.
  await folder.locator('.tree-name').dblclick();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await folder.getByRole('button', { name: 'Remove from Favorite: demo-repo', exact: true }).click();
  await expect(folder.getByRole('button', { name: 'Add to Favorite: demo-repo', exact: true })).toBeVisible();
  await folder.getByRole('button', { name: 'Remove from Repo: demo-repo', exact: true }).click();
});
test('Explorer supports context Open, multi-selection, Details and folder refresh', async ({ page }) => {
  await browse(page);
  const folder = page.locator('.folder-body:not([hidden])');
  await folder.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(folder.locator('.folder-detail-heading')).toBeVisible();
  await folder.locator('.folder-item').filter({ hasText: 'README.md' }).click();
  await folder.locator('.folder-item').filter({ hasText: 'data.csv' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(folder.locator('.folder-item.selected')).toHaveCount(2);
  await folder.locator('.folder-item').filter({ hasText: 'README.md' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Open/ }).click();
  await expect(page.frameLocator('.editor-body:not([hidden]) iframe').getByRole('heading')).toHaveText('Workbench preview');
  await row(page, 'demo-repo').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Open in Explorer/ }).click();
  await expect(page.getByRole('textbox', { name: 'Explorer directory' }).filter({ visible: true })).toHaveValue(repo);
  await page.locator('.folder-body:not([hidden]) .folder-item').filter({ hasText: 'note.py' }).dblclick();
  await expect(page.getByRole('textbox', { name: 'File content' })).toHaveCSS('font-size', '12px');
  const refreshed = 'refreshed-' + Date.now() + '.txt';
  await writeFile(path.join(repo, refreshed), 'new file');
  await page.locator('#editor-tabs .folder-tab').last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Refresh folder', exact: true }).click();
  await page.locator('#editor-tabs .folder-tab').last().getByRole('button').first().click();
  await expect(page.locator('.folder-body:not([hidden]) .folder-item').filter({ hasText: refreshed })).toBeVisible();
});
test('drag geometry survives hiding, reload and workspace session switching', async ({ page }) => {
  await browse(page);
  const shell = await page.evaluate(() => localStorage.getItem('rp2.session'));
  await drag(page, 'Files width', 70);
  await drag(page, 'Sessions width', -50);
  await drag(page, 'Editor height', 0, -110);
  const left = await page.locator('#files-index').evaluate(el => el.getBoundingClientRect().width);
  const right = await page.locator('#sessions-index').evaluate(el => el.getBoundingClientRect().width);
  const height = await page.locator('#editor').evaluate(el => el.getBoundingClientRect().height);
  expect(left).toBeGreaterThan(300); expect(right).toBeGreaterThan(300);
  await layoutCheck(page, 'Files', false); await layoutCheck(page, 'Editor', false);
  await layoutCheck(page, 'Files', true); await layoutCheck(page, 'Editor', true);
  expect(await page.locator('#files-index').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(left, 0);
  expect(await page.locator('#editor').evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(height, 0);
  await layoutCheck(page, 'Terminal', false);
  await page.reload();
  await expect(page.locator('#terminal')).toBeHidden();
  await layoutCheck(page, 'Terminal', true);
  expect(await page.locator('#editor').evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(height, 0);
  await page.getByRole('button', { name: 'RemotePad2', exact: true }).click();
  await expect(page.locator('.version-info')).toContainText('dev');
  page.once('dialog', dialog => dialog.accept('Second workspace'));
  await page.getByRole('button', { name: '+ New workspace session' }).click();
  await expect(page).toHaveURL(/w=/);
  await expect(page.locator('.xterm')).toBeVisible();
  expect(await page.evaluate(() => { const id = new URLSearchParams(location.search).get('w'); return localStorage.getItem('rp2.window.' + id + '.session'); })).not.toBe(shell);
  expect(await page.locator('#files-index').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(250, 0);
  await page.getByRole('button', { name: 'RemotePad2', exact: true }).click();
  await page.getByRole('button', { name: 'Default', exact: true }).click();
  await expect(page).not.toHaveURL(/w=/);
  await expect(page.getByRole('textbox', { name: 'Explorer directory' })).toHaveValue(fixtures);
  expect(await page.locator('#files-index').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(left, 0);
  expect(await page.locator('#sessions-index').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(right, 0);
});
test('machine menu starts with local details and reveals SSH aliases only on request', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#host > button')).not.toHaveText('Local machine');
  await page.locator('#host > button').click();
  const menu = page.locator('#host .popover');
  await expect(menu).toContainText(os.hostname());
  await expect(menu.getByRole('button', { name: 'test-cloud', exact: true })).toBeHidden();
  await menu.locator('summary').click();
  await expect(menu.getByRole('button', { name: 'test-cloud', exact: true })).toBeVisible();
  await expect(menu.getByRole('textbox', { name: 'SSH command' })).toBeVisible();
});
