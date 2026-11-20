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
  await page.getByRole('button', { name: 'Go to path', exact: true }).click();
  await page.getByRole('textbox', { name: 'Directory', exact: true }).fill(fixtures);
  await page.getByRole('textbox', { name: 'Directory', exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Explorer directory' })).toHaveValue(fixtures);
}
async function layoutCheck(page: Page, name: string, checked: boolean) {
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  const control = page.getByRole('button', { name, exact: true });
  if ((await control.getAttribute('aria-pressed')) !== String(checked)) await control.click();
  await page.keyboard.press('Escape');
}
async function drag(page: Page, label: string, dx: number, dy = 0) {
  const handle = page.getByRole('separator', { name: label });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2 + dy, { steps: 10 }); await page.mouse.up();
}
test.beforeEach(async ({ request }) => { await request.delete('/api/windows/default'); });
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
  await expect(page.locator('#version .version-info')).toHaveCount(0);
  await expect(page.locator('#version .popover')).toContainText(os.hostname());
  await expect(page.locator('#version .popover')).toContainText('sessions');
  const next = page.context().waitForEvent('page');
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  const other = await next;
  await expect(other).toHaveURL(/w=/);
  await expect(other.locator('.xterm')).toBeVisible();
  expect(await other.evaluate(() => { const id = new URLSearchParams(location.search).get('w'); return localStorage.getItem('rp2.window.' + id + '.session'); })).not.toBe(shell);
  expect(await other.locator('#files-index').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(250, 0);
  await other.goto('/');
  await expect(other.getByRole('textbox', { name: 'Explorer directory' })).toHaveValue(fixtures);
  expect(await other.locator('#files-index').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(left, 0);
  await other.close();
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

test('file address is a popup; hidden files and frozen roots survive scrolling', async ({page}) => {
  await writeFile(path.join(fixtures, '.hidden-file'), 'hidden');
  for (let n=0;n<65;n++) await writeFile(path.join(fixtures, 'long-' + n.toString().padStart(2,'0') + '.txt'), 'line');
  await browse(page);
  await expect(page.getByRole('textbox', {name:'Directory',exact:true})).toHaveCount(0);
  await expect(row(page,'.hidden-file')).toHaveCount(0);
  await page.getByRole('button',{name:'Show hidden files',exact:true}).click();
  await expect(row(page,'.hidden-file')).toBeVisible();
  const tree = page.locator('.file-tree');
  await tree.evaluate(el=>el.scrollTop=500);
  const rootRow=page.locator('.tree-row').filter({has:page.locator('.tree-name',{hasText:/^fixtures$/})});
  const bounds=(await tree.boundingBox())!, sticky=(await rootRow.boundingBox())!;
  expect(sticky.y).toBeGreaterThanOrEqual(bounds.y); expect(sticky.y).toBeLessThan(bounds.y+60);
  await page.reload();
  await expect(page.getByRole('button',{name:'Show hidden files',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('editor uses bottom source toggle, menu save and shared editable split panes', async ({page}) => {
  await browse(page);
  await row(page,'README.md').locator('.tree-name').click();
  await expect(page.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
  const mode=page.getByRole('button',{name:'Show source',exact:true});
  await expect(mode.locator('..')).toHaveClass('editor-status');
  await mode.click();
  await page.getByRole('textbox',{name:'File content'}).fill('# Shared buffer\n');
  await page.getByRole('button',{name:'Split the editor in two',exact:true}).click();
  await expect(page.frameLocator('#secondary-content iframe').getByRole('heading')).toHaveText('Shared buffer');
  await page.locator('#secondary-content').getByRole('button',{name:'Show source',exact:true}).click();
  await page.locator('#secondary-content').getByRole('textbox',{name:'File content'}).fill('# Edited on right\n');
  await expect(page.locator('#editor-content').getByRole('textbox',{name:'File content'})).toHaveValue('# Edited on right\n');
  await page.locator('#secondary-content').getByRole('textbox',{name:'File content'}).press('ControlOrMeta+s');
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('#secondary-editor')).toBeVisible();
  await expect(page.frameLocator('#editor-content iframe').getByRole('heading')).toHaveText('Edited on right');
});

test('SSH progress and failure stay visible while aliases remain expanded', async ({page,request}) => {
  let failed=false;
  const terminal={...(await(await request.post('/api/sessions')).json()),kind:'ssh-connect',name:'SSH · test-cloud',sshTarget:'test-cloud'};
  await page.route('**/api/ssh/test-cloud/status*',route=>route.fulfill({json:{terminal,phase:failed?'Failed':'Installing backend dependencies',startedAt:Date.now()-3000,...(failed?{error:'Test forwarding failure'}:{})}}));
  await page.route('**/api/ssh/connect',route=>route.fulfill({json:{terminal,connected:false}}));
  await page.goto('/');await page.locator('#host > button').click();await page.locator('#host summary').click();
  await page.getByRole('button',{name:'test-cloud',exact:true}).click();
  const progress=page.locator('.connection-progress');
  await expect(progress).toBeInViewport();await expect(progress).toContainText('Installing backend dependencies');
  await expect(progress).toContainText('s');
  await expect(page.locator('#terminal-tabs .tab.active')).toContainText('SSH · test-cloud');
  await expect(page.locator('.terminal-body:not([hidden]) .xterm')).toBeVisible();
  failed=true;await expect(progress).toContainText('Test forwarding failure');
  await expect(page.getByRole('button',{name:'test-cloud',exact:true})).toBeEnabled();
});

test('SSH target stays in header after local-host discovery; layout/reset/refresh are icons', async ({page}) => {
  let unavailable = false;
  await page.route('**/api/ssh/cloudKuai/proxy/**', async route => {
    const url = new URL(route.request().url());
    const suffix = url.pathname.split('/proxy/')[1];
    if (suffix === 'health') return unavailable ? route.fulfill({status:503,json:{error:'SSH disconnected'}}) : route.fulfill({json:{ok:true,hostname:'remote-worker'}});
    const response = await route.fetch({url:url.origin+'/api/'+suffix+url.search});
    await route.fulfill({response});
  });
  await page.goto('/?ssh=cloudKuai');
  await expect(page.locator('#host > button')).toHaveText('cloudKuai');
  await page.locator('#host > button').click();
  await expect(page.locator('#host .popover')).toContainText(os.hostname());
  await expect(page.locator('#host > button')).toHaveText('cloudKuai');
  await expect(page.locator('#host > button')).toHaveAttribute('title',/remote-worker/);
  await page.keyboard.press('Escape');
  const layout=page.getByRole('button',{name:'Layout',exact:true});
  await expect(layout).toHaveText(''); await expect(layout.locator('svg')).toBeVisible();
  await layout.click();
  await expect(page.getByRole('button',{name:'Reset layout',exact:true})).toHaveText('');
  await page.keyboard.press('Escape');
  const refresh=page.getByRole('button',{name:'Refresh tree',exact:true});
  await expect(refresh).toHaveText(''); await expect(refresh.locator('svg')).toBeVisible();
  unavailable = true;
  await page.reload();
  await expect(page.locator('#status')).toContainText('SSH disconnected');
  await expect(page.locator('#host > button')).toHaveText('cloudKuai');
  await page.locator('#host > button').click();
  await expect(page.getByRole('button',{name:'Switch to local',exact:true})).toBeVisible();
});

test('nested expanded folders freeze without selecting a leaf, with no gaps or sibling bleed', async ({page}) => {
  const a=path.join(fixtures,'sticky-A'), b=path.join(a,'sticky-B'), c=path.join(fixtures,'sticky-C');
  await mkdir(b,{recursive:true});await mkdir(c,{recursive:true});
  for(let i=0;i<60;i++){await writeFile(path.join(b,'file-'+i+'.txt'),'x');await writeFile(path.join(c,'sibling-'+i+'.txt'),'x');}
  await browse(page);
  await row(page,'sticky-A').locator('.tree-name').click();
  await row(page,'sticky-B').locator('.tree-name').click();
  await expect(row(page,'file-0.txt')).toHaveCount(1);
  await row(page,'sticky-C').locator('.tree-name').click();
  const tree=page.locator('.file-tree');
  await tree.evaluate(el=>{const a=Array.from(el.querySelectorAll<HTMLElement>('.tree-row')).find(r=>r.dataset.path?.endsWith('/sticky-A'))!;el.scrollTop+=a.closest('.tree-branch')!.getBoundingClientRect().top-el.getBoundingClientRect().top+300;});
  const rootRow=page.locator('.tree-row').filter({has:page.locator('.tree-name',{hasText:/^fixtures$/})});
  const up=(await tree.locator(':scope > .tree-parent').boundingBox())!, rootBox=(await rootRow.boundingBox())!, aBox=(await row(page,'sticky-A').boundingBox())!, bBox=(await row(page,'sticky-B').boundingBox())!;
  const treeBox=(await tree.boundingBox())!;
  expect(Math.abs(up.y-treeBox.y-1)).toBeLessThan(1.5);
  expect(Math.abs(rootBox.y-up.y-up.height)).toBeLessThan(1.5);
  expect(Math.abs(aBox.y-rootBox.y-rootBox.height)).toBeLessThan(1.5);
  expect(Math.abs(bBox.y-aBox.y-aBox.height)).toBeLessThan(1.5);
  await page.screenshot({path:path.join(root,'tree-nested.png')});
  await tree.evaluate(el=>{const c=Array.from(el.querySelectorAll<HTMLElement>('.tree-row')).find(r=>r.dataset.path?.endsWith('/sticky-C'))!;el.scrollTop+=c.closest('.tree-branch')!.getBoundingClientRect().top-el.getBoundingClientRect().top+200;});
  const nextRoot=(await rootRow.boundingBox())!, nextC=(await row(page,'sticky-C').boundingBox())!;
  expect(Math.abs(nextC.y-nextRoot.y-nextRoot.height)).toBeLessThan(1.5);
  expect((await row(page,'sticky-B').boundingBox())!.y+28).toBeLessThanOrEqual(nextRoot.y+nextRoot.height+1);
});

test('search Favorites and Repos are independent docked tools and remember visibility',async({page})=>{
  await browse(page);
  const toolbar=page.getByRole('toolbar',{name:'Files tools'});
  for(const name of ['Search','Favorites','Repos']){
    const control=toolbar.getByRole('button',{name,exact:true});
    await expect(control).toHaveText('');await expect(control.locator('svg')).toBeVisible();
    await expect(control).toHaveAttribute('aria-pressed','true');
  }
  await expect(page.getByLabel('Favorites panel',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Repos panel',{exact:true})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search files'}).fill('note.py');
  await expect(page.locator('.file-search-hit')).toContainText('note.py');
  await expect(page.getByLabel('Favorites panel',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Repos panel',{exact:true})).toBeVisible();
  await page.locator('.file-search-hit').click();
  await expect(page.getByRole('textbox',{name:'File content'})).toHaveValue('print("hello")\n');
  await toolbar.getByRole('button',{name:'Favorites',exact:true}).click();
  await expect(page.getByLabel('Favorites panel',{exact:true})).toBeHidden();
  await expect(page.getByLabel('Repos panel',{exact:true})).toBeVisible();
  await page.reload();
  await expect(toolbar.getByRole('button',{name:'Favorites',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('searchbox',{name:'Search files'})).toBeVisible();
  await expect(page.getByLabel('Repos panel',{exact:true})).toBeVisible();
});

test('expansion responds before a slow listing and double-click shares the pending request',async({page})=>{
  const folder=path.join(fixtures,'latency-folder');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'ready.txt'),'ready');
  await browse(page);
  let requests=0,release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/files?path=*',async route=>{
    if(new URL(route.request().url()).searchParams.get('path')===folder){requests++;await pending;}
    await route.continue();
  });
  const directory=row(page,'latency-folder');
  await directory.locator('.tree-name').dblclick();
  await expect(directory).toHaveAttribute('aria-expanded','true');
  await expect.poll(()=>requests).toBe(1);
  release();
  await expect(row(page,'ready.txt')).toBeVisible();
});


test('blocked new tab exposes a remote link on the real terminal tab and retains the original shell', async ({page,request}) => {
  const terminal={...(await(await request.post('/api/sessions')).json()),kind:'ssh-connect',name:'SSH · test-cloud',sshTarget:'test-cloud'};
  await page.addInitScript(()=>{window.open=()=>null;});
  await page.route('**/api/ssh/connect',route=>route.fulfill({json:{connected:true,terminal}}));
  await page.goto('/?w=connection-blocked');await expect(page.locator('.xterm')).toBeVisible();
  const shell=await page.evaluate(()=>localStorage.getItem('rp2.window.connection-blocked.session'));
  await page.locator('#host > button').click();await page.locator('#host summary').click();
  await page.getByRole('button',{name:'test-cloud',exact:true}).click();
  await expect(page.locator('#terminal-tabs').getByRole('link',{name:'Open remote workspace',exact:true})).toHaveAttribute('href',/w=connection-blocked&ssh=test-cloud/);
  expect(new URL(page.url()).searchParams.has('ssh')).toBe(false);await page.keyboard.press('Escape');
  const body=page.locator('.terminal-body:not([hidden])');
  await body.locator('.xterm-helper-textarea').focus();await page.keyboard.type("printf 'ssh-terminal-%s\\n' works");await page.keyboard.press('Enter');
  await expect(body.locator('.xterm-screen')).toContainText('ssh-terminal-works');
  await page.locator('#terminal-tabs .tab.active').getByRole('button',{name:'Close tab and end session',exact:true}).click();
  await expect(page.locator('#terminal-tabs .tab').filter({hasText:'SSH · test-cloud'})).toHaveCount(0);
  await expect(page.locator('.terminal-body:not([hidden]) .xterm')).toBeVisible();
  expect((await(await request.get('/api/sessions')).json()).sessions.some((s:any)=>s.id===terminal.id)).toBe(false);
  expect(await page.evaluate(()=>localStorage.getItem('rp2.window.connection-blocked.session'))).toBe(shell);
});

test('SSH manager saves destinations, restores them and removes only the saved entry',async({page,request})=>{
  const command='ssh -J jump user@saved-cloud';
  const existing=(await(await request.get('/api/ssh/hosts')).json()).saved||[];
  for(const machine of existing.filter((x:any)=>x.command===command))await request.delete('/api/ssh/machines/'+machine.id);
  await page.goto('/?w=ssh-manager');await expect(page.locator('.xterm')).toBeVisible();
  await page.locator('#host > button').click();await page.locator('#host summary').click();
  await page.getByRole('textbox',{name:'SSH command',exact:true}).fill(command);
  await page.getByRole('textbox',{name:'Machine name',exact:true}).fill('Work cloud');
  await page.getByRole('button',{name:'Save machine',exact:true}).click();
  const row=page.locator('.ssh-machine').filter({has:page.locator('strong',{hasText:'Work cloud'})});
  await expect(row).toContainText('Not connected');await expect(row).toContainText(command);
  await expect(page.locator('#host details')).not.toHaveAttribute('open','');
  await page.reload();await page.locator('#host > button').click();
  await expect(row.getByRole('button',{name:'Connect',exact:true})).toBeVisible();
  let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/ssh/connect',async route=>{await pending;await route.fulfill({status:502,json:{error:'Test machine unavailable'}});});
  await row.getByRole('button',{name:'Connect',exact:true}).click();
  await expect(row).toContainText('Connecting…');release();
  await expect(page.locator('.connection-progress')).toContainText('Test machine unavailable');
  await expect(row).toContainText('Not connected');await expect(row.getByRole('button',{name:'Connect',exact:true})).toBeEnabled();
  await row.getByRole('button',{name:'Remove saved machine Work cloud',exact:true}).click();
  await expect(row).toHaveCount(0);
  await page.locator('#host summary').click();
  await expect(page.getByRole('button',{name:'test-cloud',exact:true})).toBeVisible();
  await page.reload();await page.locator('#host > button').click();await expect(row).toHaveCount(0);
});

test('SSH manager refreshes connection state and opens an already connected machine',async({page,request,context})=>{
  const command='user@connected-cloud';
  const saved=(await(await request.post('/api/ssh/machines',{data:{command,name:'Connected cloud'}})).json());
  let connected=false,connectCalls=0;
  await page.route('**/api/ssh/hosts',async route=>{
    const response=await route.fetch();const data=await response.json();data.connected=connected?[command]:[];
    await route.fulfill({json:data});
  });
  await page.route('**/api/ssh/connect',route=>{connectCalls++;return route.fulfill({json:{connected:true}});});
  await page.goto('/?w=connected-menu');await expect(page.locator('.xterm')).toBeVisible();await page.locator('#host > button').click();
  const row=page.locator('.ssh-machine').filter({has:page.locator('strong',{hasText:'Connected cloud'})});
  await expect(row).toContainText('Not connected');connected=true;
  await page.getByRole('button',{name:'Refresh SSH connections',exact:true}).click();
  await expect(row).toContainText('Connected');await expect(row.getByRole('button',{name:'Open',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(root,'ssh-manager.png')});
  const next=context.waitForEvent('page');await row.getByRole('button',{name:'Open',exact:true}).click();
  const remote=await next;await expect(remote).toHaveURL(/w=connected-menu&ssh=user%40connected-cloud/);await remote.close();
  expect(connectCalls).toBe(0);
  await page.locator('#host > button').click();
  let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/ssh/disconnect',async route=>{
    expect(route.request().postDataJSON()).toEqual({host:command});await pending;connected=false;await route.fulfill({json:{connected:false}});
  });
  const disconnect=row.getByRole('button',{name:'Disconnect',exact:true});
  await expect(disconnect).toHaveText('');await expect(disconnect.locator('svg')).toBeVisible();
  await disconnect.click();await expect(row).toContainText('Disconnecting…');release();
  await expect(row).toContainText('Not connected');await expect(row.getByRole('button',{name:'Connect',exact:true})).toHaveText('');
  expect((await(await request.get('/api/ssh/hosts')).json()).saved.some((machine:any)=>machine.id===saved.id)).toBe(true);
  connected=true;await page.getByRole('button',{name:'Refresh SSH connections',exact:true}).click();
  await expect(row.getByRole('button',{name:'Disconnect',exact:true})).toBeVisible();
  await page.route('**/api/ssh/disconnect',route=>route.fulfill({status:502,json:{error:'Test disconnect failed'}}));
  await row.getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Test disconnect failed');
  await expect(row.getByRole('button',{name:'Disconnect',exact:true})).toBeEnabled();
  await row.getByRole('button',{name:'Remove saved machine Connected cloud',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove saved machine Connected cloud',exact:true})).toHaveCount(0);
  await expect(page.locator('.ssh-machine').filter({hasText:command}).getByRole('button',{name:'Open',exact:true})).toBeVisible();
  await request.delete('/api/ssh/machines/'+saved.id);
});


test('SSH config aliases can be saved and removed without changing config',async({page,request})=>{
  const entries=(await(await request.get('/api/ssh/hosts')).json()).saved||[];
  for(const machine of entries.filter((x:any)=>x.command==='test-cloud'))await request.delete('/api/ssh/machines/'+machine.id);
  await page.goto('/');await page.locator('#host > button').click();await page.locator('#host summary').click();
  await page.getByRole('button',{name:'Save test-cloud',exact:true}).click();
  const row=page.locator('.ssh-machine').filter({has:page.locator('strong',{hasText:/^test-cloud$/})});
  await expect(row).toContainText('Not connected');
  await expect(page.getByRole('button',{name:'Saved test-cloud',exact:true})).toBeDisabled();
  await row.getByRole('button',{name:'Remove saved machine test-cloud',exact:true}).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('button',{name:'test-cloud',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save test-cloud',exact:true})).toBeEnabled();
});


test('SSH favorite icons stay clickable beside scrollbars and long aliases',async({page})=>{
  const aliases=Array.from({length:35},(_,i)=>'cloud-'+i+'-'+('long-host-name-'.repeat(12)));
  await page.route('**/api/ssh/hosts',route=>route.fulfill({json:{local:{hostname:'test-local',user:'test',platform:'test',arch:'test',homedir:fixtures},connected:[],saved:[],hosts:aliases}}));
  await page.goto('/');await page.locator('#host > button').click();await page.locator('#host summary').click();
  const list=page.locator('.ssh-aliases');
  expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  for(const alias of [aliases[0],aliases[17],aliases[34]]){
    const pin=page.getByRole('button',{name:'Save '+alias,exact:true});await pin.scrollIntoViewIfNeeded();
    const bounds=(await pin.boundingBox())!,scroll=(await list.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(27);expect(scroll.x+scroll.width-bounds.x-bounds.width).toBeGreaterThanOrEqual(10);
    expect(await pin.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    await pin.click({trial:true});
  }
  await page.screenshot({path:path.join(root,'ssh-icons-scrollbar.png')});
});
