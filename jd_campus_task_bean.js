/*
cron:5 0 * * * jd_campus_task_bean.js

环境变量说明：
1. JD_CAMPUS_TASK_MAX_TASKS
   含义：最多执行几个京东校园领豆任务。
   是否必须：否，默认 5。

2. JD_CAMPUS_TASK_WAIT_MS
   含义：任务未指定等待时间时使用的默认等待毫秒数。
   是否必须：否，默认 6000。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const got = require('got');
const {
  Env,
  getUserName,
  hasJingBeanReward,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东校园任务领京豆');

const APPID = 'schoolChannelHome';
const INTERACT_ACT_ID = '93';
const BABEL_CHANNEL = 'ttt11';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3B6CgwugAyBR67P3MSNhykj5Eqyr/index.html?babelChannel=ttt11';
const DEFAULT_MAX_TASKS = 5;
const DEFAULT_WAIT_MS = 6000;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = process.env.JD_CAMPUS_TASK_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778061391%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getMaxTasks() {
  return Number(process.env.JD_CAMPUS_TASK_MAX_TASKS || DEFAULT_MAX_TASKS);
}

function getDefaultWaitMs() {
  return Number(process.env.JD_CAMPUS_TASK_WAIT_MS || DEFAULT_WAIT_MS);
}

function isDebugEnabled() {
  return process.env.JD_CAMPUS_TASK_DEBUG === '1';
}

function stringifyForLog(value, maxLength = 1000) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 3000) : maxLength);
}

function isSuccess(response) {
  const code = String(response?.code ?? response?.data?.businessCode ?? '');
  return response?.success === true || code === '11000' || code === '0' || /成功/.test(String(response?.message || response?.data?.businessContext || ''));
}

async function callCampusApi(cookie, functionId, body, userName = '') {
  if (userName) {
    $.log(`账号 ${userName}: ${functionId} request => ${stringifyForLog(body)}`);
  }

  const response = await postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/client.action',
    functionId,
    appid: APPID,
    loginType: '2',
    loginWQBiz: functionId,
    body,
    origin: 'https://pro.m.jd.com',
    referer: PAGE_URL,
    userAgent: USER_AGENT,
  });

  if (userName) {
    $.log(`账号 ${userName}: ${functionId} response => ${stringifyForLog(response, 1200)}`);
  }

  return response;
}

async function queryTasks(cookie, userName, requestType = 1) {
  return callCampusApi(cookie, 'campusTask_interact_load', {
    interactActId: INTERACT_ACT_ID,
    clientChannel: 0,
    requestType,
    babelChannel: BABEL_CHANNEL,
  }, userName);
}

async function querySignModule(cookie, userName) {
  return queryTasks(cookie, userName, 0);
}

async function invokeTask(cookie, userName, task, optType) {
  const body = {
    interactActId: INTERACT_ACT_ID,
    taskId: task.taskId,
    itemId: getTaskItemId(task),
    optType,
    taskType: Number(task.taskType),
    clientChannel: 0,
    requestType: 1,
    babelChannel: BABEL_CHANNEL,
  };

  return callCampusApi(cookie, 'campusTask_interact_invoke', body, userName);
}

async function invokeSign(cookie, userName, signModule) {
  const body = {
    interactActId: INTERACT_ACT_ID,
    taskId: signModule.taskId,
    itemId: signModule.itemId || '1',
    optType: 0,
    taskType: Number(signModule.taskType || 5),
    clientChannel: 0,
    babelChannel: BABEL_CHANNEL,
    requestType: 0,
  };

  return callCampusApi(cookie, 'campusTask_interact_invoke', body, userName);
}

function getTaskItemId(task) {
  return task.itemId || task.subTaskInfo?.itemId || task.visitTaskInfo?.itemId || '';
}

function getTaskUrl(task) {
  return task.subTaskInfo?.url || task.visitTaskInfo?.url || task.url || '';
}

function getWaitMs(task) {
  const waitDurationSeconds = Number(task.subTaskInfo?.waitDuration || 0);
  if (waitDurationSeconds > 0) {
    return waitDurationSeconds * 1000 + 1000;
  }
  return getDefaultWaitMs();
}

function isTaskCompleted(task) {
  const status = Number(task?.status);
  return status === 3 || status === 4;
}

function shouldStartTask(task) {
  return [0, 1].includes(Number(task?.status));
}

function shouldClaimReward(task) {
  return Number(task?.status) === 2;
}

function isBrowseTask(task) {
  return Number(task?.taskType) === 1 && Boolean(getTaskUrl(task));
}

function isHomeCampusClickTask(task) {
  return Number(task?.taskType) === 10234 || String(task?.taskName || '').includes('首页点击京东校园');
}

function readBeanTasks(taskData) {
  const tasks = taskData?.data?.interactTasks || [];
  return tasks
    .filter((task) => hasJingBeanReward(task))
    .filter((task) => !isTaskCompleted(task))
    .slice(0, getMaxTasks());
}

function summarizeTask(task) {
  return [
    task.taskName || task.taskId || '未知任务',
    `taskId=${task.taskId || '-'}`,
    `type=${task.taskType ?? '-'}`,
    `status=${task.status ?? '-'}`,
    `times=${task.times ?? 0}/${task.maxTimes ?? 0}`,
    `itemId=${getTaskItemId(task) || '-'}`,
    `wait=${getWaitMs(task)}ms`,
    getTaskUrl(task) || '-',
  ].join(' | ');
}

function getTaskKey(task) {
  return `${task.taskId || '-'}:${getTaskItemId(task) || '-'}`;
}

function logTaskList(index, userName, tasks) {
  $.log(`账号${index} ${userName}: 任务列表(${tasks.length})`);
  for (const task of tasks) {
    $.log(`账号${index} ${userName}: - ${summarizeTask(task)}`);
  }
}

async function openTaskUrl(cookie, index, userName, task) {
  const taskUrl = getTaskUrl(task);
  if (!taskUrl) {
    return;
  }

  $.log(`账号${index} ${userName}: 打开任务页 => ${taskUrl}`);
  const response = await got.get(taskUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: cookie,
      Referer: PAGE_URL,
      'User-Agent': USER_AGENT,
    },
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  $.log(`账号${index} ${userName}: 任务页响应 => HTTP ${response.statusCode}`);
}

async function tryClaimReward(cookie, index, userName, task, label = '领取京豆') {
  const rewardResult = await invokeTask(cookie, userName, task, 2);
  $.log(`账号${index} ${userName}: ${label} => ${stringifyForLog(rewardResult, 1200)}`);
  return rewardResult;
}

function findSameTask(tasks, task) {
  const sameTask = tasks.find((item) => item.taskId === task.taskId && getTaskItemId(item) === getTaskItemId(task));
  if (sameTask) {
    return sameTask;
  }
  return tasks.find((item) => item.taskId === task.taskId) || null;
}

async function refreshTasks(cookie, index, userName) {
  const taskData = await queryTasks(cookie, userName, 1);
  const tasks = readBeanTasks(taskData);
  logTaskList(index, userName, tasks);
  return tasks;
}

async function completeHomeCampusClickTask(cookie, index, userName, task) {
  $.log(`账号${index} ${userName}: 首页点击校园任务上报`);
  if (Number(task?.status) === 0) {
    const startResult = await invokeTask(cookie, userName, task, 1);
    $.log(`账号${index} ${userName}: 首页点击校园开始 => ${stringifyForLog(startResult, 1200)}`);
    await sleep(1000);
  }

  const finishResult = await invokeTask(cookie, userName, task, 0);
  $.log(`账号${index} ${userName}: 首页点击校园完成 => ${stringifyForLog(finishResult, 1200)}`);
  await sleep(1000);
  const tasks = await refreshTasks(cookie, index, userName);
  const refreshedTask = findSameTask(tasks, task);
  if (refreshedTask && shouldClaimReward(refreshedTask)) {
    await tryClaimReward(cookie, index, userName, refreshedTask);
    return refreshTasks(cookie, index, userName);
  }
  return tasks;
}

async function completeBrowseTask(cookie, index, userName, task) {
  let currentTask = task;
  let tasks = [];
  const remainingTimes = Number(task?.maxTimes || 0) - Number(task?.times || 0);
  const maxBrowseRounds = Math.max(remainingTimes > 0 ? remainingTimes + 1 : getMaxTasks(), 1);
  let browseRound = 0;

  while (currentTask && isBrowseTask(currentTask) && browseRound < maxBrowseRounds) {
    browseRound += 1;
    $.log(`账号${index} ${userName}: 浏览一轮 => ${summarizeTask(currentTask)}`);

    if (shouldClaimReward(currentTask)) {
      await tryClaimReward(cookie, index, userName, currentTask);
      return refreshTasks(cookie, index, userName);
    }

    const startResult = await invokeTask(cookie, userName, currentTask, 1);
    $.log(`账号${index} ${userName}: 开始浏览 => ${stringifyForLog(startResult, 1200)}`);

    await openTaskUrl(cookie, index, userName, currentTask);
    await sleep(getWaitMs(currentTask));

    $.log(`账号${index} ${userName}: 浏览后刷新任务列表`);
    tasks = await refreshTasks(cookie, index, userName);
    currentTask = findSameTask(tasks, currentTask);
    if (!currentTask) {
      return tasks;
    }

    if (shouldClaimReward(currentTask)) {
      await tryClaimReward(cookie, index, userName, currentTask);
      return refreshTasks(cookie, index, userName);
    }

    const finishResult = await invokeTask(cookie, userName, currentTask, 0);
    $.log(`账号${index} ${userName}: 上报浏览 => ${stringifyForLog(finishResult, 1200)}`);
    await sleep(1000);

    tasks = await refreshTasks(cookie, index, userName);
    currentTask = findSameTask(tasks, currentTask);
    if (!currentTask || shouldClaimReward(currentTask)) {
      if (currentTask) {
        await tryClaimReward(cookie, index, userName, currentTask);
        return refreshTasks(cookie, index, userName);
      }
      return tasks;
    }
  }

  if (browseRound >= maxBrowseRounds) {
    $.log(`账号${index} ${userName}: 浏览轮次达到上限，等待下次运行继续`);
  }

  return tasks;
}

async function completeTask(cookie, index, userName, task) {
  $.log(`账号${index} ${userName}: 处理任务 => ${summarizeTask(task)}`);

  if (shouldClaimReward(task)) {
    await tryClaimReward(cookie, index, userName, task);
    return refreshTasks(cookie, index, userName);
  }

  if (isHomeCampusClickTask(task)) {
    return completeHomeCampusClickTask(cookie, index, userName, task);
  }

  if (isBrowseTask(task)) {
    return completeBrowseTask(cookie, index, userName, task);
  }

  if (shouldStartTask(task)) {
    const startResult = await invokeTask(cookie, userName, task, 1);
    $.log(`账号${index} ${userName}: 开始任务 => ${stringifyForLog(startResult, 1200)}`);

    await openTaskUrl(cookie, index, userName, task);
    await sleep(getWaitMs(task));

    const finishResult = await invokeTask(cookie, userName, task, 0);
    $.log(`账号${index} ${userName}: 上报任务 => ${stringifyForLog(finishResult, 1200)}`);
    await sleep(1000);

    if (isSuccess(finishResult)) {
      await tryClaimReward(cookie, index, userName, task, '完成后领取京豆');
    }
    return refreshTasks(cookie, index, userName);
  }

  $.log(`账号${index} ${userName}: 当前状态不支持自动执行，跳过`);
  return [];
}

function readSignModule(signData) {
  return signData?.data?.signBeanModule || null;
}

async function handleSignModule(cookie, index, userName) {
  const signData = await querySignModule(cookie, userName);
  const signModule = readSignModule(signData);
  if (!signModule) {
    $.log(`账号${index} ${userName}: 未识别到校园签到模块 => ${stringifyForLog(signData, 1000)}`);
    return;
  }

  $.log(`账号${index} ${userName}: 签到状态 => today=${signModule.todaySignStatus}, continuousDays=${signModule.continuousDays}, todayBean=${signModule.todaySignBeanNum}`);
  if (Number(signModule.todaySignStatus) === 2) {
    return;
  }

  if (!signModule.taskId) {
    $.log(`账号${index} ${userName}: 校园签到缺少 taskId，跳过 => ${stringifyForLog(signModule, 1000)}`);
    return;
  }

  const signResult = await invokeSign(cookie, userName, signModule);
  $.log(`账号${index} ${userName}: 校园签到 => ${stringifyForLog(signResult, 1200)}`);

  if (!isSuccess(signResult)) {
    return;
  }

  const refreshedSignData = await querySignModule(cookie, userName);
  const refreshedSignModule = readSignModule(refreshedSignData);
  if (refreshedSignModule) {
    $.log(`账号${index} ${userName}: 签到后状态 => today=${refreshedSignModule.todaySignStatus}, continuousDays=${refreshedSignModule.continuousDays}, totalBean=${refreshedSignModule.totalBean?.amount || '-'}`);
  }
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  await handleSignModule(cookie, index, userName);

  let taskData = await queryTasks(cookie, userName, 1);
  let tasks = readBeanTasks(taskData);
  $.log(`账号${index} ${userName}: 识别到 ${tasks.length} 个校园京豆任务`);
  logTaskList(index, userName, tasks);

  if (!tasks.length) {
    $.log(`账号${index} ${userName}: 任务列表片段 => ${stringifyForLog(taskData)}`);
    return;
  }

  let executedCount = 0;
  const attemptedSingleActionTaskKeys = new Set();
  while (executedCount < getMaxTasks()) {
    const task = tasks.find((item) => isHomeCampusClickTask(item) && !attemptedSingleActionTaskKeys.has(getTaskKey(item)))
      || tasks.find((item) => !shouldClaimReward(item) && isBrowseTask(item))
      || tasks.find(shouldClaimReward)
      || tasks.find((item) => !isHomeCampusClickTask(item) || !attemptedSingleActionTaskKeys.has(getTaskKey(item)));
    if (!task) {
      $.log(`账号${index} ${userName}: 没有新的校园任务可执行`);
      break;
    }

    if (isHomeCampusClickTask(task)) {
      attemptedSingleActionTaskKeys.add(getTaskKey(task));
    }
    tasks = await completeTask(cookie, index, userName, task);
    executedCount += 1;
    await sleep(1000);
  }
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效账号 Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行失败：${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常：${error.message || error}`))
  .finally(() => $.done());
