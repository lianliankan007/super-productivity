'use strict';

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('双端展示与资源边界：不发送外部请求，没有页面脚本错误', async ({ page }) => {
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4178/')) external.push(request.url());
  });
  await page.reload();
  await expect(page.getByText('交互原型 · 本地模拟')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Super Productivity 任务端' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'ChatGPT 项目与会话端' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(
    await page.locator('[id]').evaluateAll((nodes) => {
      const ids = nodes.map((node) => node.id);
      return ids.length === new Set(ids).size;
    }),
  ).toBe(true);
});

test('主任务与项目双向跳转，浏览器返回恢复项目页', async ({ page }) => {
  await page.getByRole('link', { name: '打开项目：英国工单 BI', exact: true }).click();
  await expect(page.locator('#chat-heading')).toHaveText('英国工单 BI');
  await page.locator('.project-task-link').filter({ hasText: '上线准备与验收' }).click();
  await expect(page.locator('#selected-task-title')).toHaveText('上线准备与验收');
  await expect(page).toHaveURL(/#sp\/task\/t5$/);
  await page.goBack();
  await expect(page).toHaveURL(/#chat\/project\/p1$/);
  await expect(page.locator('#chat-heading')).toHaveText('英国工单 BI');
});

test('子任务打开确切会话，会话任务卡跳回确切子任务', async ({ page }) => {
  await page.getByRole('link', { name: '从任务 确认统计口径 打开关联会话' }).click();
  await expect(page.locator('#chat-heading')).toHaveText('需求分析与统计口径');
  await page.getByRole('button', { name: '查看关联任务', exact: true }).click();
  await page.getByLabel('选择 ChatGPT 操作的主任务').selectOption('t1');
  await page.getByRole('link', { name: '查看任务：确认统计口径', exact: true }).click();
  await expect(page.locator('#selected-task-title')).toHaveText('确认统计口径');
  await expect(page).toHaveURL(/#sp\/task\/t2$/);
});

test('会话预览后创建子任务，内容转义，刷新保留结果且不重复创建', async ({ page }) => {
  const title = '检查 <script> 与 "筛选"';
  await page.getByLabel('子任务标题 1', { exact: true }).fill(title);
  await page.getByLabel('选择草稿 2', { exact: true }).uncheck();
  await page.getByRole('button', { name: '确认创建子任务', exact: true }).click();
  await expect(page.getByText('已创建 1 条子任务', { exact: true })).toBeVisible();
  await expect(page.locator('#task-list .task-row')).toHaveCount(4);
  await page.reload();
  await expect(page.getByText('已创建 1 条子任务', { exact: true })).toBeVisible();
  await expect(page.locator('#task-list .task-row')).toHaveCount(4);
  await page.getByRole('link', { name: '查看任务', exact: true }).click();
  await expect(page.locator('#selected-task-title')).toHaveText(title);
  await expect(
    page.getByRole('link', { name: '打开会话：后端实现与接口联调', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: '打开会话：后端实现与接口联调', exact: true })
    .click();
  await expect(page.getByText('已创建 1 条子任务', { exact: true })).toBeVisible();
  await expect(page.locator('#task-list .task-row')).toHaveCount(4);
});

test('状态从两端更新，对话端取消不会修改任务', async ({ page }) => {
  await page.getByRole('button', { name: '查看关联任务', exact: true }).click();
  const chatCheck = page.getByRole('checkbox', {
    name: '在 ChatGPT 更新任务：开发统计接口',
    exact: true,
  });
  await chatCheck.check();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '完成任务：开发统计接口', exact: true }),
  ).not.toBeChecked();
  await chatCheck.check();
  await page.getByRole('button', { name: '标记完成', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '完成任务：开发统计接口', exact: true }),
  ).toBeChecked();
  await page
    .getByRole('checkbox', { name: '完成任务：开发统计接口', exact: true })
    .uncheck();
  await expect(chatCheck).not.toBeChecked();
});

test('从任务绑定多个项目，解除只影响选定关联', async ({ page }) => {
  await page.getByLabel('选择主任务', { exact: true }).selectOption('t7');
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.getByRole('radio', { name: /英国工单 BI/ }).check();
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '打开项目：英国工单 BI', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.getByRole('radio', { name: /个人学习计划/ }).check();
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await expect(page.locator('#task-context .context-link')).toHaveCount(2);
  await page.getByRole('button', { name: '管理关联', exact: true }).click();
  await page.getByRole('checkbox', { name: /个人学习计划/ }).check();
  await page.getByRole('button', { name: '解除选中关联', exact: true }).click();
  await expect(page.locator('#task-context .context-link')).toHaveCount(1);
  await expect(page.locator('#selected-task-title')).toHaveText('整理数据清理方案');
});

test('关联已有任务时重复操作不创建重复链接，支持切换关联类型', async ({ page }) => {
  await page.getByRole('button', { name: '关联已有任务', exact: true }).first().click();
  await page.getByRole('radio', { name: /核对页面筛选项/ }).check();
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await page.getByRole('button', { name: '关联已有任务', exact: true }).first().click();
  await page.getByRole('radio', { name: /核对页面筛选项/ }).check();
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await page.locator('[data-action="select-task"][data-id="t4"]').click();
  await expect(page.locator('#task-context [data-jump="chat"]')).toHaveCount(1);
  await page.getByRole('button', { name: '关联', exact: true }).click();
  await page.locator('#bind-kind').selectOption('project');
  await page.getByRole('radio', { name: /个人学习计划/ }).check();
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('项目背景由主任务继承');
  await page.keyboard.press('Escape');
});

test('多个主任务的项目要求选择，空选择刷新后不会自动落到第一项', async ({ page }) => {
  await page.getByRole('link', { name: '打开项目：英国工单 BI', exact: true }).click();
  await page
    .getByRole('button', { name: /后端实现与接口联调/ })
    .last()
    .click();
  await page.getByLabel('选择 ChatGPT 操作的主任务').selectOption('');
  await expect(
    page.getByRole('button', { name: '确认创建子任务', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('选择 ChatGPT 操作的主任务')).toHaveValue('');
  await expect(
    page.getByRole('button', { name: '确认创建子任务', exact: true }),
  ).toBeDisabled();
});

test('独立窗口共享状态，单端跳转切换到另一端并可返回', async ({ page }) => {
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#sp-window').click();
  const sp = await popupPromise;
  await expect(sp.locator('body')).toHaveAttribute('data-view', 'sp');
  await sp.getByRole('checkbox', { name: '完成任务：开发统计接口', exact: true }).check();
  await expect(
    page.getByRole('checkbox', { name: '完成任务：开发统计接口', exact: true }),
  ).toBeChecked();
  await sp
    .getByRole('link', { name: '打开会话：后端实现与接口联调', exact: true })
    .click();
  await expect(sp.locator('body')).toHaveAttribute('data-view', 'chat');
  await expect(sp.locator('#chat-heading')).toHaveText('后端实现与接口联调');
  await sp.goBack();
  await expect(sp.locator('body')).toHaveAttribute('data-view', 'sp');
  await expect(sp.locator('#selected-task-title')).toHaveText('开发统计接口');
  await sp.close();
});

test('输入清单生成可编辑草稿，并拒绝空标题', async ({ page }) => {
  await page.getByLabel('输入演示指令').fill('核对空数据\n核对权限\n核对导出');
  await page.getByRole('button', { name: '发送演示指令', exact: true }).click();
  await expect(page.locator('.draft-item')).toHaveCount(3);
  await page.getByLabel('子任务标题 1', { exact: true }).fill(' ');
  await page.getByRole('button', { name: '确认创建子任务', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('请填写任务标题');
  await expect(page.locator('#task-list .task-row')).toHaveCount(3);
});

test('新建主任务、添加子任务、从项目端关联已有主任务', async ({ page }) => {
  await page.getByRole('button', { name: '主任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务名称' }).fill('演示中的新工作');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('textbox', { name: '任务名称' }).fill('新工作的第一步');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.locator('#selected-task-title')).toHaveText('新工作的第一步');
  await page.locator('#chat-sidebar [data-action="project"][data-id="p1"]').click();
  await page.getByRole('button', { name: '关联任务', exact: true }).click();
  await page.getByRole('radio', { name: /演示中的新工作/ }).check();
  await page.getByRole('button', { name: '保存关联', exact: true }).click();
  await expect(
    page.locator('.project-task-link').filter({ hasText: '演示中的新工作' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: '打开项目：英国工单 BI', exact: true }),
  ).toBeVisible();
});

test('桌面与窄屏无横向溢出，指引支持键盘关闭', async ({ page }) => {
  for (const width of [1920, 1366, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: '体验指引', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('单文件通过文件协议打开时也能创建任务和双边跳转', async ({ page }) => {
  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
  await page.getByRole('button', { name: '确认创建子任务', exact: true }).click();
  await expect(page.getByText('已创建 2 条子任务', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看任务', exact: true }).first().click();
  await expect(page.locator('#selected-task-title')).toHaveText('完成前后端接口联调');
  await page
    .getByRole('link', { name: '打开会话：后端实现与接口联调', exact: true })
    .click();
  await expect(page.locator('#chat-heading')).toHaveText('后端实现与接口联调');
});
