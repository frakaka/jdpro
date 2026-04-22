/*
cron:20 0 * * * jd_campus_task_bean.js

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
const {
  Env,
  getUserName,
  hasJingBeanReward,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jd_har_bean_common');

const $ = new Env('京东校园任务领京豆');

const APPID = 'schoolChannelHome';
const INTERACT_ACT_ID = '93';
const BABEL_CHANNEL = 'ttt11';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3B6CgwugAyBR67P3MSNhykj5Eqyr/index.html?babelChannel=ttt11';
const DEFAULT_MAX_TASKS = 5;
const DEFAULT_WAIT_MS = 6000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getMaxTasks() {
  return Number(process.env.JD_CAMPUS_TASK_MAX_TASKS || DEFAULT_MAX_TASKS);
}

function getDefaultWaitMs() {
  return Number(process.env.JD_CAMPUS_TASK_WAIT_MS || DEFAULT_WAIT_MS);
}

async function callCampusApi(cookie, functionId, body) {
  return postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/client.action',
    functionId,
    appid: APPID,
    loginType: '2',
    loginWQBiz: functionId,
    body,
    origin: 'https://pro.m.jd.com',
    referer: PAGE_URL,
  });
}

async function queryTasks(cookie) {
  return callCampusApi(cookie, 'campusTask_interact_load', {
    interactActId: INTERACT_ACT_ID,
    clientChannel: 0,
    requestType: 1,
    babelChannel: BABEL_CHANNEL,
  });
}

async function invokeTask(cookie, task, optType) {
  return callCampusApi(cookie, 'campusTask_interact_invoke', {
    interactActId: INTERACT_ACT_ID,
    taskId: task.taskId,
    itemId: getTaskItemId(task),
    optType,
    taskType: Number(task.taskType),
    clientChannel: 0,
    requestType: 1,
    babelChannel: BABEL_CHANNEL,
  });
}

function getTaskItemId(task) {
  return task.itemId || task.subTaskInfo?.itemId || task.visitTaskInfo?.itemId || '';
}

function getWaitMs(task) {
  const waitDurationSeconds = Number(task.subTaskInfo?.waitDuration || 0);
  if (waitDurationSeconds > 0) {
    return waitDurationSeconds * 1000 + 1000;
  }
  return getDefaultWaitMs();
}

function readBeanTasks(taskData) {
  const tasks = taskData?.data?.interactTasks || [];
  return tasks
    .filter((task) => hasJingBeanReward(task))
    .filter((task) => Number(task.status) !== 4)
    .slice(0, getMaxTasks());
}

async function completeTask(cookie, index, userName, task) {
  const taskName = task.taskName || task.taskId;
  const status = Number(task.status);
  $.log(`账号${index} ${userName}: 处理任务 ${taskName}，status=${status}`);

  if (status === 2) {
    const startResult = await invokeTask(cookie, task, 1);
    $.log(`账号${index} ${userName}: 领取任务 => ${stringifySnippet(startResult, 500)}`);
    await sleep(getWaitMs(task));

    const finishResult = await invokeTask(cookie, task, 0);
    $.log(`账号${index} ${userName}: 上报任务 => ${stringifySnippet(finishResult, 500)}`);
    await sleep(1000);
  }

  const rewardResult = await invokeTask(cookie, task, 2);
  $.log(`账号${index} ${userName}: 领取京豆 => ${stringifySnippet(rewardResult, 600)}`);
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const taskData = await queryTasks(cookie);
  const tasks = readBeanTasks(taskData);
  $.log(`账号${index} ${userName}: 识别到 ${tasks.length} 个校园京豆任务`);

  if (!tasks.length) {
    $.log(`账号${index} ${userName}: 任务列表片段 => ${stringifySnippet(taskData)}`);
    return;
  }

  for (const task of tasks) {
    await completeTask(cookie, index, userName, task);
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
