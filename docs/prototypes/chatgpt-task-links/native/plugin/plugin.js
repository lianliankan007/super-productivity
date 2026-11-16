/* global PluginAPI */
(() => {
  'use strict';
  const CHANNEL = 'sp-chatgpt-native-demo-v1';
  const JOURNAL = 'sp-chatgpt-native-demo-operations';
  const PROJECTS = { p1: '英国工单 BI', p2: '个人学习计划' };
  const CHATS = {
    c1: '需求分析与统计口径',
    c2: '后端实现与接口联调',
    c3: '发布与验收安排',
    c4: '每周学习安排',
  };
  const PROJECT_OF_CHAT = { c1: 'p1', c2: 'p1', c3: 'p1', c4: 'p2' };
  let token = null;
  let timer = null;
  let queue = Promise.resolve();
  const embedded = window.parent !== window;
  const ownOrigin = window.location.origin;

  function send(type, payload = {}) {
    if (embedded)
      window.parent.postMessage({ channel: CHANNEL, type, ...payload }, ownOrigin);
  }
  function journal() {
    try {
      return JSON.parse(localStorage.getItem(JOURNAL) || '{}');
    } catch {
      return {};
    }
  }
  function record(key, value) {
    const entries = journal();
    entries[key] = value;
    localStorage.setItem(JOURNAL, JSON.stringify(entries));
  }
  function requireTask(tasks, id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) throw Error('任务不存在或已归档，请刷新后重新选择。');
    return task;
  }
  function companionUrl(kind, id, taskId) {
    const url = new URL('/native/', ownOrigin);
    url.searchParams.set('view', 'chat');
    url.searchParams.set('project', kind === 'project' ? id : PROJECT_OF_CHAT[id]);
    if (kind === 'chat') url.searchParams.set('chat', id);
    if (taskId) url.searchParams.set('task', taskId);
    return url.href;
  }
  function managedLinks(task) {
    return (task.attachments || []).flatMap((attachment) => {
      if (attachment.type !== 'LINK' || !attachment.id?.startsWith('cg-native-'))
        return [];
      try {
        const url = new URL(attachment.path);
        if (url.origin !== ownOrigin || url.pathname !== '/native/') return [];
        const kind = url.searchParams.has('chat') ? 'chat' : 'project';
        const id = url.searchParams.get(kind === 'chat' ? 'chat' : 'project');
        return [
          {
            kind,
            id,
            title: attachment.title,
            url: attachment.path,
            attachmentId: attachment.id,
          },
        ];
      } catch {
        return [];
      }
    });
  }
  async function snapshot() {
    const tasks = await PluginAPI.getTasks();
    const selected = await PluginAPI.getSelectedTask();
    return {
      version: 1,
      selectedTaskId: selected?.id || null,
      tasks: tasks.slice(0, 1000).map((task) => ({
        id: task.id,
        title: task.title,
        parentId: task.parentId || null,
        projectId: task.projectId,
        isDone: task.isDone,
        timeEstimate: task.timeEstimate,
        timeSpent: task.timeSpent,
        subTaskIds: task.subTaskIds,
        repeatCfgId: task.repeatCfgId || null,
        links: managedLinks(task),
      })),
      projects: (await PluginAPI.getAllProjects()).map((project) => ({
        id: project.id,
        title: project.title,
      })),
      truncated: tasks.length > 1000,
    };
  }
  function refreshSoon() {
    if (!token || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        send('snapshot', { snapshot: await snapshot() });
      } catch {
        send('refresh-required');
      }
    }, 250);
  }
  /** 关联写入普通 LINK 附件，不改备注、日期或其他插件的附件。 */
  async function bind(taskId, kind, id) {
    if (
      !['project', 'chat'].includes(kind) ||
      !(kind === 'project' ? PROJECTS : CHATS)[id]
    )
      throw Error('请选择有效的演示项目或会话。');
    const task = requireTask(await PluginAPI.getTasks(), taskId);
    if (kind === 'project' && task.parentId)
      throw Error('项目背景由主任务继承，请在主任务上关联项目。');
    const attachmentId = `cg-native-${kind}-${id}`;
    const attachment = {
      id: attachmentId,
      type: 'LINK',
      path: companionUrl(kind, id, taskId),
      title: `ChatGPT ${kind === 'project' ? '项目' : '会话'}：${(kind === 'project' ? PROJECTS : CHATS)[id]}`,
      icon: 'open_in_new',
    };
    const current = task.attachments || [];
    const existing = current.find((item) => item.id === attachmentId);
    if (existing?.path === attachment.path) return { taskId, alreadyLinked: true };
    await PluginAPI.updateTask(taskId, {
      attachments: [...current.filter((item) => item.id !== attachmentId), attachment],
    });
    return { taskId, alreadyLinked: false };
  }
  async function seed() {
    const tasks = await PluginAPI.getTasks();
    const saved = journal().seed;
    if (saved?.taskId && tasks.some((task) => task.id === saved.taskId)) {
      await focusTask(saved.taskId);
      return saved;
    }
    const day = await PluginAPI.getDayContext();
    const projectId = await PluginAPI.addProject({
      title: 'ChatGPT 关联演示',
      theme: { primary: '#315bf2' },
    });
    const taskId = await PluginAPI.addTask({
      title: '英国工单 BI 看板（演示）',
      projectId,
      dueDay: day.todayStr,
      isIgnoreShortSyntax: true,
    });
    record('seed', { taskId, projectId });
    await bind(taskId, 'project', 'p1');
    for (const [title, chat, minutes] of [
      ['确认统计口径', 'c1', 30],
      ['开发统计接口', 'c2', 120],
      ['核对页面筛选项', null, 45],
    ]) {
      const id = await PluginAPI.addTask({
        title,
        parentId: taskId,
        timeEstimate: minutes * 60000,
        isIgnoreShortSyntax: true,
      });
      if (chat) await bind(id, 'chat', chat);
    }
    await focusTask(taskId);
    return { taskId, projectId };
  }
  /** 已知创建结果保留 ID；附件失败时返回部分结果，不通过重建来掩盖失败。 */
  async function createSubtasks(args) {
    const parent = requireTask(await PluginAPI.getTasks(), args.parentTaskId);
    if (parent.parentId || parent.isDone || parent.repeatCfgId)
      throw Error('请选择未完成、非重复模板的顶层主任务。');
    if (!Array.isArray(args.items) || !args.items.length || args.items.length > 10)
      throw Error('每次创建 1～10 条子任务。');
    if (typeof args.draftId !== 'string' || args.draftId.length > 100)
      throw Error('缺少有效的草稿标识。');
    const fingerprint = JSON.stringify({
      parentTaskId: parent.id,
      chatId: args.chatId,
      items: args.items,
    });
    const key = `draft:${args.draftId}`;
    let state = journal()[key];
    if (state && state.fingerprint !== fingerprint)
      throw Error('草稿内容已经改变，请重新准备。');
    if (!state) state = { fingerprint, items: [] };
    for (let i = 0; i < args.items.length; i++) {
      const item = args.items[i];
      if (
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 160 ||
        !Number.isInteger(item.minutes) ||
        item.minutes < 1 ||
        item.minutes > 10080
      )
        throw Error('任务标题不能为空，估时为 1～10080 的整数分钟。');
      if (state.items[i]?.status === 'unknown')
        throw Error('上次创建结果未知，请先在原生应用核对，不能直接重试。');
      if (!state.items[i]) {
        state.items[i] = { status: 'unknown' };
        record(key, state);
        const id = await PluginAPI.addTask({
          title: item.title.trim(),
          parentId: parent.id,
          timeEstimate: item.minutes * 60000,
          isIgnoreShortSyntax: true,
        });
        state.items[i] = { taskId: id, status: 'created' };
        record(key, state);
      }
      requireTask(await PluginAPI.getTasks(), state.items[i].taskId);
      if (args.chatId) await bind(state.items[i].taskId, 'chat', args.chatId);
      state.items[i].status = 'linked';
      record(key, state);
    }
    return { taskIds: state.items.map((item) => item.taskId) };
  }
  /** 使用公开的原生 action 选中任务；路由保留在真实应用中。 */
  async function focusTask(id) {
    const task = requireTask(await PluginAPI.getTasks(), id);
    const parent = task.parentId
      ? requireTask(await PluginAPI.getTasks(), task.parentId)
      : task;
    const hash = `#/project/${encodeURIComponent(parent.projectId)}/tasks`;
    if (window.location.hash !== hash) {
      await new Promise((resolve) => {
        const done = () => {
          window.removeEventListener('hashchange', done);
          resolve();
        };
        window.addEventListener('hashchange', done, { once: true });
        window.location.hash = hash;
      });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    }
    PluginAPI.dispatchAction({ type: '[Task] SetSelectedTask', id, isSkipToggle: true });
    send('selected', { taskId: id });
    return { taskId: id };
  }
  async function openCompanion(taskId) {
    const task = taskId
      ? requireTask(await PluginAPI.getTasks(), taskId)
      : (await PluginAPI.getSelectedTask()) || (await PluginAPI.getFocusedTask());
    if (embedded && token) send('selected', { taskId: task?.id || null });
    else
      window.open(
        task
          ? companionUrl('project', 'p1', task.id)
          : new URL('/native/?view=chat', ownOrigin).href,
        'sp-chatgpt-companion',
      );
  }
  async function execute(method, args) {
    if (method === 'snapshot') return snapshot();
    if (method === 'seed') return seed();
    if (method === 'bind') return bind(args.taskId, args.kind, args.resourceId);
    if (method === 'createSubtasks') return createSubtasks(args);
    if (method === 'focusTask') return focusTask(args.taskId);
    if (method === 'setDone') {
      const task = requireTask(await PluginAPI.getTasks(), args.taskId);
      if (typeof args.isDone !== 'boolean') throw Error('缺少目标状态。');
      if (task.isDone !== args.isDone)
        await PluginAPI.updateTask(task.id, { isDone: args.isDone });
      return { taskId: task.id, isDone: args.isDone };
    }
    if (method === 'unlink') {
      const task = requireTask(await PluginAPI.getTasks(), args.taskId);
      if (
        typeof args.attachmentId !== 'string' ||
        !args.attachmentId.startsWith('cg-native-')
      )
        throw Error('只能解除本演示创建的关联。');
      await PluginAPI.updateTask(task.id, {
        attachments: (task.attachments || []).filter(
          (item) => item.id !== args.attachmentId,
        ),
      });
      return { taskId: task.id };
    }
    throw Error('不支持的演示操作。');
  }
  // 只接受本机同源外层演示窗口，令牌用于隔离其他窗口中的普通消息。
  function onMessage(event) {
    if (
      !embedded ||
      event.source !== window.parent ||
      event.origin !== ownOrigin ||
      event.data?.channel !== CHANNEL
    )
      return;
    const message = event.data;
    if (message.type === 'connect' && typeof message.token === 'string') {
      token = message.token;
      refreshSoon();
      return;
    }
    if (
      message.type !== 'command' ||
      !token ||
      message.token !== token ||
      typeof message.requestId !== 'string'
    )
      return;
    queue = queue.then(async () => {
      try {
        const result = await execute(message.method, message.args || {});
        send('result', { requestId: message.requestId, result });
        refreshSoon();
      } catch (error) {
        send('result', { requestId: message.requestId, error: error.message });
      }
    });
  }
  window.addEventListener('message', onMessage);
  PluginAPI.registerHook(PluginAPI.Hooks.DATA_CHANGED, refreshSoon);
  PluginAPI.registerHeaderButton({
    label: 'ChatGPT 关联',
    icon: 'forum',
    onClick: () => openCompanion(),
  });
  PluginAPI.registerTaskContextMenuEntry({
    id: 'chatgpt-context',
    label: '在 ChatGPT 侧关联或继续讨论',
    icon: 'forum',
    onClick: ({ taskId }) => openCompanion(taskId),
  });
  PluginAPI.onUnload?.(() => {
    window.removeEventListener('message', onMessage);
    clearTimeout(timer);
    token = null;
  });
  send('ready');
})();
