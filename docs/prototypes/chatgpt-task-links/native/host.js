(() => {
  'use strict';
  const CHANNEL = 'sp-chatgpt-native-demo-v1';
  const origin = location.origin;
  const params = new URLSearchParams(location.search);
  const chatOnly = params.get('view') === 'chat';
  const frame = document.querySelector('#application');
  const token = crypto.randomUUID();
  const bus = new BroadcastChannel(CHANNEL);
  const pending = new Map();
  let connected = false;
  let snapshot = { tasks: [], projects: [] };
  let snapshotSignature = '';
  let ui = {
    projectId: params.get('project') || 'p1',
    chatId: params.get('chat') || 'c2',
    taskId: params.get('task') || null,
    rootId: '',
    draft: null,
    saved: [],
    busy: false,
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem('native-demo-ui') || 'null');
    if (saved) ui = { ...ui, ...saved };
  } catch {}
  if (params.has('project')) ui.projectId = params.get('project');
  if (params.has('chat')) ui.chatId = params.get('chat');
  if (params.has('task')) ui.taskId = params.get('task');
  const projects = [
    { id: 'p1', title: '英国工单 BI' },
    { id: 'p2', title: '个人学习计划' },
  ];
  const chats = [
    {
      id: 'c1',
      projectId: 'p1',
      title: '需求分析与统计口径',
      draft: ['补齐统计口径说明', '核对边界场景'],
    },
    {
      id: 'c2',
      projectId: 'p1',
      title: '后端实现与接口联调',
      draft: ['完成前后端接口联调', '验证筛选与导出结果'],
    },
    {
      id: 'c3',
      projectId: 'p1',
      title: '发布与验收安排',
      draft: ['核对发布前检查项', '整理验收记录'],
    },
    {
      id: 'c4',
      projectId: 'p2',
      title: '每周学习安排',
      draft: ['完成本周学习内容', '整理本周学习笔记'],
    },
  ];
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const getTask = (id) => snapshot.tasks.find((task) => task.id === id);
  const rootOf = (task) => (task?.parentId ? getTask(task.parentId) : task);
  const roots = () => snapshot.tasks.filter((task) => !task.parentId);
  const boundRoots = () =>
    roots().filter((task) =>
      task.links.some((link) => link.kind === 'project' && link.id === ui.projectId),
    );
  function saveUI() {
    sessionStorage.setItem('native-demo-ui', JSON.stringify({ ...ui, busy: false }));
  }
  function navigateContext(projectId, chatId) {
    ui.projectId = projectId;
    ui.chatId = chatId;
    ui.rootId = '';
    ui.saved = [];
    const url = new URL(location.href);
    url.searchParams.set('project', projectId);
    if (chatId) url.searchParams.set('chat', chatId);
    else url.searchParams.delete('chat');
    history.pushState({}, '', url);
    render();
  }
  let toastTimer;
  function toast(message) {
    const el = document.querySelector('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 5000);
  }
  function setConnected(value) {
    connected = value;
    document.querySelector('#connection').textContent = value
      ? '已连接原生应用 · 任务由 Super Productivity 保存'
      : '等待原生插件连接。首次使用请启用本机关联插件。';
    document.querySelector('#connection').classList.toggle('ready', value);
    document.querySelector('#seed').disabled = !value;
  }
  function sendToPlugin(message) {
    frame.contentWindow.postMessage(
      { channel: CHANNEL, type: 'command', token, ...message },
      origin,
    );
  }
  function request(method, args = {}) {
    if (!connected)
      return Promise.reject(Error('原生插件尚未连接，请先启用本机关联插件。'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(Error('原生应用未及时返回，结果可能已保存。请先刷新核对，避免重复创建。'));
      }, 20000);
      pending.set(requestId, { resolve, reject, timeout });
      if (chatOnly) bus.postMessage({ type: 'command', requestId, method, args });
      else sendToPlugin({ requestId, method, args });
    });
  }
  function receiveResult(message) {
    const entry = pending.get(message.requestId);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pending.delete(message.requestId);
    if (message.error) entry.reject(Error(message.error));
    else entry.resolve(message.result);
  }
  function receiveSnapshot(next) {
    const signature = JSON.stringify({
      tasks: next.tasks.map(({ timeSpent, ...task }) => task),
      projects: next.projects,
      selectedTaskId: next.selectedTaskId,
    });
    snapshot = next;
    setConnected(true);
    if (signature === snapshotSignature) return;
    snapshotSignature = signature;
    if (ui.taskId && !ui.rootId && getTask(ui.taskId)) selectTask(ui.taskId, false);
    else if (!chatOnly && next.selectedTaskId && next.selectedTaskId !== ui.taskId)
      selectTask(next.selectedTaskId, false);
    else render();
  }
  function selectTask(id, showMessage = true) {
    const task = getTask(id);
    if (!task) return;
    ui.taskId = id;
    const root = rootOf(task);
    ui.rootId = root.id;
    const projectLinks = root.links.filter((link) => link.kind === 'project');
    if (projectLinks.length && !projectLinks.some((link) => link.id === ui.projectId)) {
      ui.projectId = projectLinks[0].id;
      ui.chatId = null;
    }
    const discussion =
      task.links.find((link) => link.kind === 'chat' && link.id === ui.chatId) ||
      task.links.find(
        (link) =>
          link.kind === 'chat' &&
          chats.find((chat) => chat.id === link.id)?.projectId === ui.projectId,
      );
    if (discussion) {
      ui.chatId = discussion.id;
      ui.projectId =
        chats.find((chat) => chat.id === discussion.id)?.projectId || ui.projectId;
    }
    render();
    if (showMessage) toast(`已选中原生任务：${task.title}`);
  }
  window.addEventListener('message', (event) => {
    if (
      chatOnly ||
      event.origin !== origin ||
      event.source !== frame.contentWindow ||
      event.data?.channel !== CHANNEL
    )
      return;
    const message = event.data;
    if (message.type === 'ready') {
      frame.contentWindow.postMessage(
        { channel: CHANNEL, type: 'connect', token },
        origin,
      );
      setConnected(true);
      request('snapshot')
        .then(receiveSnapshot)
        .catch((error) => toast(error.message));
      bus.postMessage({ type: 'owner-ready' });
    }
    if (message.type === 'snapshot') {
      receiveSnapshot(message.snapshot);
      bus.postMessage({ type: 'snapshot', snapshot: message.snapshot });
    }
    if (message.type === 'result') {
      receiveResult(message);
      bus.postMessage({ ...message, type: 'result' });
    }
    if (message.type === 'selected') {
      document.body.classList.remove('wide');
      selectTask(message.taskId);
      bus.postMessage({ type: 'selected', taskId: message.taskId });
    }
  });
  bus.onmessage = (event) => {
    const message = event.data;
    if (!chatOnly && message.type === 'hello' && connected) {
      bus.postMessage({ type: 'snapshot', snapshot });
      return;
    }
    if (!chatOnly && message.type === 'command' && connected) {
      sendToPlugin(message);
      return;
    }
    if (!chatOnly) return;
    if (message.type === 'snapshot') receiveSnapshot(message.snapshot);
    if (message.type === 'result') receiveResult(message);
    if (message.type === 'owner-ready') {
      setConnected(true);
      request('snapshot')
        .then(receiveSnapshot)
        .catch((error) => toast(error.message));
    }
  };
  async function refresh() {
    receiveSnapshot(await request('snapshot'));
  }
  function taskRow(task) {
    return `<div class="task ${task.isDone ? 'done' : ''}"><input type="checkbox" aria-label="更新原生任务：${escape(task.title)}" data-done="${task.id}" ${task.isDone ? 'checked' : ''}><span>${escape(task.title)}</span><button data-action="focus" data-id="${task.id}" aria-label="在原应用中查看：${escape(task.title)}">查看原任务</button></div>`;
  }
  function render() {
    const project = projects.find((item) => item.id === ui.projectId) || projects[0];
    ui.projectId = project.id;
    const chat = chats.find(
      (item) => item.id === ui.chatId && item.projectId === project.id,
    );
    const task = getTask(ui.taskId);
    const linked = boundRoots();
    if (ui.rootId && !linked.some((root) => root.id === ui.rootId)) ui.rootId = '';
    const root = getTask(ui.rootId);
    if (chat && ui.draft?.chatId !== chat.id) {
      ui.draft = {
        id: crypto.randomUUID(),
        chatId: chat.id,
        items: chat.draft.map((title) => ({ title, checked: true, minutes: 30 })),
      };
      ui.saved = [];
    }
    let html = `<div class="project-tabs">${projects.map((item) => `<button data-action="project" data-id="${item.id}" class="${project.id === item.id ? 'active' : ''}">${escape(item.title)}</button>`).join('')}</div>`;
    if (task)
      html += `<div class="selected"><small>原生应用中选中的${task.parentId ? '子任务' : '主任务'}</small><strong>${escape(task.title)}</strong><div class="actions"><button data-action="bind-current-project">关联此项目</button>${chat ? '<button data-action="bind-current-chat">关联此会话</button>' : ''}</div></div>`;
    if (!chat) {
      html += `<h1>${escape(project.title)}</h1><p class="muted">项目保留工作背景，会话按需关联具体任务。</p><h2>关联的原生主任务</h2>${linked.length ? linked.map(taskRow).join('') : '<p class="notice">尚未关联主任务。先在原应用选择任务，再点击“ChatGPT 关联”，或在下方选择主任务。</p>'}<label class="field"><span>关联已有原生主任务</span><select id="bind-root"><option value="">选择任务</option>${roots()
        .map((item) => `<option value="${item.id}">${escape(item.title)}</option>`)
        .join(
          '',
        )}</select></label><button data-action="bind-root">关联到当前项目</button><h2>项目里的会话</h2>${chats
        .filter((item) => item.projectId === project.id)
        .map(
          (item) =>
            `<button class="chat" data-action="chat" data-id="${item.id}"><strong>${escape(item.title)}</strong><small>继续讨论，并建立任务关联</small></button>`,
        )
        .join('')}`;
    } else {
      html += `<button class="back" data-action="overview">‹ 返回项目：${escape(project.title)}</button><h1>${escape(chat.title)}</h1><div class="message">把这次讨论拆成可执行的子任务，并关联到原应用。</div><p class="muted">确认后会通过插件创建真正的 Super Productivity 子任务。你也可以在原应用继续安排日期、提醒、标签和计时。</p><section class="card"><div class="card-head">Super Productivity · 原生任务</div><div class="card-body"><label class="field"><span>本次操作的主任务</span><select id="root"><option value="">请选择明确的主任务</option>${linked.map((item) => `<option value="${item.id}" ${item.id === ui.rootId ? 'selected' : ''}>${escape(item.title)}</option>`).join('')}</select></label>`;
      if (ui.saved.length) {
        html += `<h2>已创建 ${ui.saved.length} 条原生子任务</h2>${ui.saved
          .map((id) => getTask(id))
          .filter(Boolean)
          .map(taskRow)
          .join('')}<button data-action="new-draft">准备另一组子任务</button>`;
      } else {
        html += `${ui.draft.items.map((item, index) => `<label class="draft-row"><input type="checkbox" aria-label="选择草稿 ${index + 1}" data-draft-check="${index}" ${item.checked ? 'checked' : ''}><input type="text" aria-label="原生子任务标题 ${index + 1}" maxlength="160" data-draft-title="${index}" value="${escape(item.title)}"></label>`).join('')}<p class="muted">将保存这次会话的链接。创建与添加附件是两次原生操作，异常时会保留已创建任务供核对。</p><button class="primary" data-action="create" ${!root || !connected || ui.busy ? 'disabled' : ''}>${ui.busy ? '正在写入原生应用…' : '确认创建原生子任务'}</button>`;
      }
      html += `</div></section><h2>当前主任务的进度</h2>${root ? [root, ...snapshot.tasks.filter((item) => item.parentId === root.id)].map(taskRow).join('') : '<p class="notice">同一个项目可以关联多条主任务。请选择这次讨论对应的任务。</p>'}<div class="actions"><button data-action="existing">关联已有子任务</button><button data-action="refresh">刷新原生任务</button></div>`;
    }
    if (task?.links.length) {
      html += `<h2>选中任务的关联</h2>${task.links.map((link) => `<div class="link-row"><a href="${escape(link.url)}" target="_blank" rel="noopener">${escape(link.title)}</a><button data-action="unlink" data-id="${task.id}" data-link="${escape(link.attachmentId)}">解除</button></div>`).join('')}`;
    }
    if (!connected)
      html += `<p class="notice">${chatOnly ? '原应用窗口需要保持打开。' : '首次点击顶部“启用本机关联插件”，在原生界面确认安装。'}这里只模拟 ChatGPT 会话，任务端不是模拟界面。</p>`;
    document.querySelector('#content').innerHTML = html;
    saveUI();
  }
  /** 通过原生插件上传界面安装，仅填入本仓库 ZIP；仍由原生确认框处理授权。 */
  async function install() {
    if (chatOnly) return;
    if (connected) {
      toast('原生关联插件已经启用。');
      return;
    }
    const button = document.querySelector('#install');
    button.disabled = true;
    const waitFor = async (callback) => {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const value = callback();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw Error('未找到原生插件安装入口。可下载插件，在设置 → 插件中手动安装。');
    };
    try {
      frame.contentWindow.location.hash = '#/config';
      const tab = await waitFor(() =>
        [...frame.contentDocument.querySelectorAll('[role="tab"]')].find((element) =>
          /插件|Plugins/i.test(element.textContent),
        ),
      );
      tab.click();
      if (connected) return;
      const findCard = () =>
        [...frame.contentDocument.querySelectorAll('plugin-management mat-card')].find(
          (card) => card.textContent.includes('ChatGPT 任务关联演示'),
        );
      const enableCard = (card) => {
        const toggle = card.querySelector('[role="switch"]');
        if (toggle && toggle.getAttribute('aria-checked') !== 'true') toggle.click();
      };
      const installed = findCard();
      if (installed) {
        enableCard(installed);
        return;
      }
      const input = await waitFor(() =>
        frame.contentDocument.querySelector('plugin-management input[type="file"]'),
      );
      const bytes = await fetch('/native/plugin.zip').then((response) => response.blob());
      const transfer = new frame.contentWindow.DataTransfer();
      transfer.items.add(
        new frame.contentWindow.File([bytes], 'chatgpt-native-demo.zip', {
          type: 'application/zip',
        }),
      );
      input.files = transfer.files;
      input.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
      toast('请在左侧原生安装确认框中核对并确认插件。');
      const card = await waitFor(findCard);
      enableCard(card);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }
  async function runAction(action, button) {
    if (action === 'project') navigateContext(button.dataset.id, null);
    else if (action === 'chat') navigateContext(ui.projectId, button.dataset.id);
    else if (action === 'overview') navigateContext(ui.projectId, null);
    else if (action === 'refresh') await refresh();
    else if (action === 'focus') {
      await request('focusTask', { taskId: button.dataset.id });
      if (chatOnly) {
        try {
          window.opener?.top.focus();
        } catch {}
        toast('已在原应用窗口定位任务');
      } else {
        document.body.classList.remove('wide');
        frame.focus();
      }
      await refresh();
    } else if (action === 'bind-current-project') {
      const selected = rootOf(getTask(ui.taskId));
      if (!selected) throw Error('请先选择原生任务。');
      await request('bind', {
        taskId: selected.id,
        kind: 'project',
        resourceId: ui.projectId,
      });
      await refresh();
      ui.rootId = selected.id;
      render();
      toast('已保存到原生任务的链接附件');
    } else if (action === 'bind-current-chat') {
      if (!ui.chatId) throw Error('请先打开一段会话。');
      await request('bind', { taskId: ui.taskId, kind: 'chat', resourceId: ui.chatId });
      await refresh();
      toast('会话已关联到原生任务');
    } else if (action === 'bind-root') {
      const id = document.querySelector('#bind-root').value;
      if (!id) throw Error('请选择原生主任务。');
      await request('bind', { taskId: id, kind: 'project', resourceId: ui.projectId });
      await refresh();
      ui.rootId = id;
      render();
      toast('项目已关联到原生主任务');
    } else if (action === 'unlink') {
      await request('unlink', {
        taskId: button.dataset.id,
        attachmentId: button.dataset.link,
      });
      await refresh();
      toast('关联已解除，原生任务和会话保留');
    } else if (action === 'new-draft') {
      ui.draft = null;
      ui.saved = [];
      render();
    } else if (action === 'existing') {
      const root = getTask(ui.rootId);
      if (!root) throw Error('请先选择主任务。');
      const list = [root, ...snapshot.tasks.filter((task) => task.parentId === root.id)];
      const modal = document.querySelector('#modal');
      modal.innerHTML = `<h2>关联已有原生任务</h2><form id="existing-form"><label class="field"><span>选择这次讨论对应的任务</span><select name="taskId">${list.map((task) => `<option value="${task.id}">${escape(task.title)}</option>`).join('')}</select></label><div class="actions"><button type="button" data-action="close">取消</button><button class="primary">保存会话关联</button></div></form>`;
      modal.showModal();
    } else if (action === 'close') document.querySelector('#modal').close();
    else if (action === 'create') {
      const items = ui.draft.items.filter((item) => item.checked);
      if (!items.length) throw Error('请至少选择一条子任务。');
      if (items.some((item) => !item.title.trim())) throw Error('任务标题不能为空。');
      ui.busy = true;
      render();
      try {
        const result = await request('createSubtasks', {
          draftId: ui.draft.id,
          parentTaskId: ui.rootId,
          chatId: ui.chatId,
          items: items.map((item) => ({ title: item.title, minutes: item.minutes })),
        });
        ui.saved = result.taskIds;
        await refresh();
        toast(`已在原生应用创建 ${result.taskIds.length} 条子任务`);
      } finally {
        ui.busy = false;
        render();
      }
    }
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button)
      runAction(button.dataset.action, button).catch((error) => toast(error.message));
  });
  document.addEventListener('input', (event) => {
    if (event.target.dataset.draftTitle !== undefined) {
      ui.draft.items[+event.target.dataset.draftTitle].title = event.target.value;
      saveUI();
    }
  });
  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.id === 'root') {
      ui.rootId = el.value;
      ui.saved = [];
      render();
    }
    if (el.dataset.draftCheck !== undefined) {
      ui.draft.items[+el.dataset.draftCheck].checked = el.checked;
      saveUI();
    }
    if (el.dataset.done) {
      const task = getTask(el.dataset.done);
      const next = el.checked;
      el.checked = task.isDone;
      if (!confirm(`将原生任务“${task.title}”${next ? '标记完成' : '恢复为待办'}？`))
        return;
      request('setDone', { taskId: task.id, isDone: next })
        .then(refresh)
        .catch((error) => toast(error.message));
    }
  });
  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'existing-form') return;
    event.preventDefault();
    const taskId = new FormData(event.target).get('taskId');
    request('bind', { taskId, kind: 'chat', resourceId: ui.chatId })
      .then(async () => {
        document.querySelector('#modal').close();
        await refresh();
        toast('会话已关联到原生任务');
      })
      .catch((error) => toast(error.message));
  });
  document.querySelector('#install').onclick = install;
  document.querySelector('#native-features').onclick = () => {
    if (chatOnly) {
      toast('请在原应用窗口打开设置。');
      return;
    }
    frame.contentWindow.location.hash = '#/config?tab=0&section=appFeatures';
    toast('在原生设置中开启日程、看板、专注等功能，修改会自动保存。');
  };
  document.querySelector('#seed').onclick = async () => {
    try {
      const result = await request('seed');
      ui.rootId = result.taskId;
      ui.taskId = result.taskId;
      await refresh();
      toast('示例项目、主任务和子任务已写入原生应用');
    } catch (error) {
      toast(error.message);
    }
  };
  document.querySelector('#wide').onclick = () => {
    document.body.classList.toggle('wide');
    document.querySelector('#wide').textContent = document.body.classList.contains('wide')
      ? '应用＋会话'
      : '只看原应用';
  };
  const helpMarkup = document.querySelector('#modal').innerHTML;
  document.querySelector('#help').onclick = () => {
    document.querySelector('#modal').innerHTML = helpMarkup;
    document.querySelector('#modal').showModal();
  };
  if (chatOnly) {
    document.body.classList.add('chat-only');
    frame.removeAttribute('src');
    bus.postMessage({ type: 'hello' });
  } else {
    // 仅跳过隔离演示站点的介绍与示例引导；功能和用户设置仍由原生应用管理。
    if (!localStorage.getItem('sp-native-demo-bootstrapped')) {
      for (const key of [
        'SUP_ONBOARDING_PRESET_DONE',
        'SUP_ONBOARDING_HINTS_DONE',
        'SUP_IS_SHOW_TOUR',
        'SUP_EXAMPLE_TASKS_CREATED',
      ])
        if (!localStorage.getItem(key)) localStorage.setItem(key, 'true');
      localStorage.setItem('sp-native-demo-bootstrapped', 'true');
    }
    frame.src = '/app/#/tag/TODAY/tasks';
  }
  window.addEventListener('pagehide', () => bus.close());
  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    ui.projectId = url.searchParams.get('project') || 'p1';
    ui.chatId = url.searchParams.get('chat');
    ui.rootId = '';
    ui.saved = [];
    render();
  });
  render();
})();
