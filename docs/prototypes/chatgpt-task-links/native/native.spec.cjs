'use strict';
const { test, expect } = require('@playwright/test');

/** 按实际原生安装流程启用 ZIP，不注入模拟 API 或改写应用数据库。 */
async function connect(page) {
  await page.goto('/native/');
  const app = page.frameLocator('#application');
  await expect(app.locator('.route-wrapper')).toBeVisible();
  await page.getByRole('button', { name: '启用本机关联插件', exact: true }).click();
  await expect(app.locator('dialog-confirm')).toBeVisible();
  await app.locator('dialog-confirm button[e2e="confirmBtn"]').click();
  await expect(page.locator('#connection')).toHaveClass(/ready/);
  await page.getByRole('button', { name: '添加示例任务', exact: true }).click();
  await expect(
    app
      .locator('work-view-page task task-title')
      .filter({ hasText: '英国工单 BI 看板（演示）' }),
  ).toBeVisible();
  return app;
}
function nativeTask(app, title) {
  return app
    .locator('work-view-page task task-title')
    .filter({ hasText: title })
    .locator('xpath=ancestor::task[1]');
}

test('完整原应用保留原生计划、日程、看板、统计和原有扩展', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const app = await connect(page);
  await expect(app.locator('work-view-page task')).toHaveCount(4);
  const timedTask = nativeTask(app, '开发统计接口');
  await expect(timedTask.locator('.time-wrapper')).toContainText('2h');
  await timedTask.hover();
  await timedTask.locator('.start-task-btn').click();
  await expect(timedTask).toHaveClass(/isCurrent/);
  await timedTask
    .locator('button')
    .filter({ has: app.locator('mat-icon').filter({ hasText: /^pause$/ }) })
    .click();
  await expect(timedTask).not.toHaveClass(/isCurrent/);
  let frame = page.frames().find((frame) => frame.url().includes('/app/'));
  const projectId = frame.url().match(/#\/project\/([^/]+)/)[1];
  await page.getByRole('button', { name: '原生功能设置', exact: true }).click();
  const switches = app.locator('.appFeatures [role="switch"]');
  await expect(switches.first()).toBeVisible();
  for (const toggle of await switches.all()) {
    if ((await toggle.getAttribute('aria-checked')) === 'false') {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }
  }
  await page.reload();
  await expect(page.locator('#connection')).toHaveClass(/ready/);
  frame = page.frames().find((frame) => frame.url().includes('/app/'));
  for (const [route, selector] of [
    ['/planner', 'planner'],
    ['/schedule', 'schedule'],
    ['/boards', 'boards'],
    [`/project/${projectId}/history`, 'history'],
    [`/project/${projectId}/metrics`, 'metric-page'],
  ]) {
    await frame.evaluate((route) => (location.hash = '#' + route), route);
    await expect(app.locator(selector)).toBeVisible();
  }
  await frame.evaluate(() => (location.hash = '#/config'));
  await page.getByRole('button', { name: '启用本机关联插件', exact: true }).click();
  await app
    .getByRole('tab')
    .filter({ has: app.locator('mat-icon').filter({ hasText: 'extension' }) })
    .click();
  expect(await app.locator('plugin-management mat-card').count()).toBeGreaterThanOrEqual(
    25,
  );
  await page.getByRole('button', { name: '只看原应用', exact: true }).click();
  await expect(page.locator('body')).toHaveClass('wide');
  await expect(page.locator('#application')).toBeVisible();
  await expect(page.locator('.companion')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('会话创建真正子任务，原生附件跳到独立会话窗口，再返回更新原生状态', async ({
  page,
}) => {
  const app = await connect(page);
  await page.getByLabel('原生子任务标题 1', { exact: true }).fill('原生联调验证');
  await page.getByRole('button', { name: '确认创建原生子任务', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '已创建 2 条原生子任务', exact: true }),
  ).toBeVisible();
  await expect(app.locator('work-view-page task')).toHaveCount(6);
  await page
    .getByRole('button', { name: '在原应用中查看：原生联调验证', exact: true })
    .first()
    .click();
  await expect(
    app
      .locator('task-attachment-list .attachment-link')
      .filter({ hasText: 'ChatGPT 会话' }),
  ).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await app
    .locator('task-attachment-list .attachment-link')
    .filter({ hasText: 'ChatGPT 会话' })
    .click();
  const companion = await popupPromise;
  await expect(companion.locator('body')).toHaveClass('chat-only');
  await expect(companion.locator('#connection')).toHaveClass(/ready/);
  await expect(companion.locator('.selected strong')).toHaveText('原生联调验证');
  await expect(
    companion.getByRole('heading', { name: '后端实现与接口联调', exact: true }),
  ).toBeVisible();
  companion.once('dialog', (dialog) => dialog.accept());
  await companion
    .getByRole('checkbox', { name: '更新原生任务：原生联调验证', exact: true })
    .first()
    .click();
  await expect(nativeTask(app, '原生联调验证')).toHaveClass(/isDone/);
  // 原生端的更改也必须回到会话窗口，验证真正的双向交互。
  await nativeTask(app, '原生联调验证').locator('done-toggle').click();
  await expect(
    companion
      .getByRole('checkbox', { name: '更新原生任务：原生联调验证', exact: true })
      .first(),
  ).not.toBeChecked();
  await nativeTask(app, '原生联调验证').locator('done-toggle').click();
  await expect(
    companion
      .getByRole('checkbox', { name: '更新原生任务：原生联调验证', exact: true })
      .first(),
  ).toBeChecked();
  await companion
    .getByRole('button', { name: '在原应用中查看：原生联调验证', exact: true })
    .first()
    .click();
  await expect(page.locator('.selected strong')).toHaveText('原生联调验证');
  await companion.close();
  await page.reload();
  await expect(page.locator('#connection')).toHaveClass(/ready/);
  await page.getByRole('button', { name: '添加示例任务', exact: true }).click();
  await expect(
    app.locator('work-view-page task task-title').filter({ hasText: '原生联调验证' }),
  ).toBeVisible();
  await expect(app.locator('work-view-page task')).toHaveCount(6);
});

test('原生任务关联去重、追加项目、解除关联都不删除任务', async ({ page }) => {
  const app = await connect(page);
  await page.getByRole('button', { name: '关联此会话', exact: true }).click();
  await page.getByRole('button', { name: '关联此会话', exact: true }).click();
  await expect(page.locator('.link-row')).toHaveCount(2);
  await page.getByRole('button', { name: '个人学习计划', exact: true }).click();
  await page.getByRole('button', { name: '关联此项目', exact: true }).click();
  await expect(page.locator('.link-row')).toHaveCount(3);
  await page
    .locator('.link-row')
    .filter({ hasText: 'ChatGPT 项目：个人学习计划' })
    .getByRole('button', { name: '解除', exact: true })
    .click();
  await expect(page.locator('.link-row')).toHaveCount(2);
  await expect(app.locator('work-view-page task')).toHaveCount(4);
  await expect(
    app
      .locator('work-view-page task task-title')
      .filter({ hasText: '英国工单 BI 看板（演示）' }),
  ).toBeVisible();
});
