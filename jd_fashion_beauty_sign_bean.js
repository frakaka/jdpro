/*
cron:11 0 * * * jd_fashion_beauty_sign_bean.js
服装美饰签到领京豆。

环境变量说明：
1. JD_FASHION_BEAUTY_SIGN_DEBUG
   含义：是否打印更完整的接口 request/response。
   是否必须：否，值为 1 时开启。

2. JD_FASHION_BEAUTY_SIGN_EID_TOKEN
   含义：可选的 x-api-eid-token。若签到接口触发风控，可从抓包提取后覆盖。
   是否必须：否，默认使用本次抓包里的值。

3. JD_FASHION_BEAUTY_SIGN_MAX_TASKS
   含义：单账号最多执行几个浏览任务。
   是否必须：否，默认 6。
*/

'use strict';

const crypto = require('crypto');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getRequestUuid,
  getUserAgent,
  getUserName,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('服装美饰签到领京豆');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const PAGE_ID = 'jgwurvXVswT7VFuX4S5DG2aaK1T';
const PAGE_URL = `https://pro.m.jd.com/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt1&collectionId=842`;
const APPID = 'jx_h5_babel';
const H5ST_APP_ID = 'c50cc';
const COMPLETE_TASK_H5ST_APP_ID = 'cec1e';
const REWARD_TASK_H5ST_APP_ID = '573fe';
const CHANNEL = 'jxh5';
const CLIENT = 'jxh5';
const CLIENT_VERSION = '1.2.5';
const ACTIVITY_SOURCE = 'jxzy';
const CRAFT_ID = '69266d9f129fbf6b80a8b1cd';
const APP_CODE = 'ms1888ebbf';
const BUID = 325;
const SCENEVAL = 2;
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM57R5VSKQAAAAACDGN6WZVNPYBZUX';
const DEFAULT_MAX_TASKS = 6;
const DEFAULT_BROWSE_WAIT_MS = 5500;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_FASHION_BEAUTY_SIGN_DEBUG === '1';
}

function getMaxTasks() {
  const value = Number(process.env.JD_FASHION_BEAUTY_SIGN_MAX_TASKS || DEFAULT_MAX_TASKS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_TASKS;
}

function md5(content) {
  return crypto.createHash('md5').update(String(content)).digest('hex');
}

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getEidToken(cookie) {
  return process.env.JD_FASHION_BEAUTY_SIGN_EID_TOKEN
    || getCookieValue(cookie, '3AB9D23F7A4B3CSS')
    || DEFAULT_EID_TOKEN;
}

function buildSignBody(payload, time) {
  const baseBody = {
    ...payload,
    sceneval: SCENEVAL,
    buid: BUID,
    appCode: APP_CODE,
    time,
  };

  return {
    ...baseBody,
    signStr: md5(JSON.stringify(baseBody)),
  };
}

function buildCommonForm(cookie, time, options = {}) {
  const form = {
    t: time,
    channel: CHANNEL,
    clientVersion: CLIENT_VERSION,
    client: CLIENT,
    uuid: getRequestUuid(cookie),
    cthr: '1',
    loginType: '2',
  };

  if (options.includeEidToken) {
    form['x-api-eid-token'] = getEidToken(cookie);
  }

  return form;
}

function sanitizeRequestLog(requestLog) {
  const sanitized = JSON.parse(JSON.stringify(requestLog));
  if (sanitized.extraForm?.['x-api-eid-token']) {
    sanitized.extraForm['x-api-eid-token'] = `${sanitized.extraForm['x-api-eid-token'].slice(0, 18)}...`;
  }
  return sanitized;
}

function logRequest(prefix, functionId, body, extraForm, options = {}) {
  const h5stAppId = options.h5stAppId || H5ST_APP_ID;
  const requestLog = {
    endpoint: 'https://api.m.jd.com/api',
    functionId,
    appid: APPID,
    client: CLIENT,
    referer: PAGE_REFERER,
    h5stAppId: options.requireH5st ? h5stAppId : '',
    body,
    extraForm,
  };
  $.log(`${prefix}: 请求 ${functionId} => ${stringifySnippet(sanitizeRequestLog(requestLog), isDebugEnabled() ? 3000 : 1200)}`);
}

function logResponse(prefix, functionId, meta) {
  const responseLog = {
    httpStatus: meta?.statusCode,
    response: meta?.data,
  };
  $.log(`${prefix}: 响应 ${functionId} => ${stringifySnippet(responseLog, isDebugEnabled() ? 4000 : 1200)}`);
}

async function requestActivityApi(cookie, functionId, bodyPayload, prefix, options = {}) {
  const time = Date.now();
  const body = buildSignBody(bodyPayload, time);
  const h5stAppId = options.h5stAppId || H5ST_APP_ID;
  const extraForm = buildCommonForm(cookie, time, {
    includeEidToken: options.includeEidToken,
  });

  logRequest(prefix, functionId, body, extraForm, options);

  const meta = await postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/api',
    functionId,
    appid: APPID,
    body,
    client: CLIENT,
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: PAGE_REFERER,
    extraForm,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
    h5stAppId: options.requireH5st ? h5stAppId : '',
    h5stVersion: '5.3',
    includeMeta: true,
  });

  logResponse(prefix, functionId, meta);
  return meta.data;
}

async function querySign(cookie, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_querySign',
    {
      source: ACTIVITY_SOURCE,
      craftId: CRAFT_ID,
    },
    prefix,
  );
}

async function drawSign(cookie, itemId, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_drawSign',
    {
      itemId: String(itemId || '1'),
      craftId: CRAFT_ID,
      source: ACTIVITY_SOURCE,
    },
    prefix,
    {
      requireH5st: true,
      includeEidToken: true,
    },
  );
}

async function queryTaskList(cookie, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_task_queryTaskList',
    {
      source: ACTIVITY_SOURCE,
      craftId: CRAFT_ID,
    },
    prefix,
  );
}

async function completeTask(cookie, task, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_task_completeTask',
    buildTaskBody(task),
    prefix,
    {
      requireH5st: true,
      includeEidToken: true,
      h5stAppId: COMPLETE_TASK_H5ST_APP_ID,
    },
  );
}

async function rewardTask(cookie, task, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_task_rewardTask',
    buildTaskBody(task),
    prefix,
    {
      requireH5st: true,
      includeEidToken: true,
      h5stAppId: REWARD_TASK_H5ST_APP_ID,
    },
  );
}

function summarizePrizeInfos(response) {
  const prizeInfos = Array.isArray(response?.data?.prizeInfos) ? response.data.prizeInfos : [];
  return prizeInfos.map((item) => {
    if (Number(item.prizeType) === 2) {
      return `${item.discount || 0}京豆`;
    }
    return `prizeType=${item.prizeType}`;
  }).join('，') || '无奖励明细';
}

function buildTaskBody(task) {
  return {
    craftId: CRAFT_ID,
    taskId: task.taskId,
    itemId: getTaskItemId(task),
    taskType: Number(task.taskType),
  };
}

function readTaskList(response) {
  return Array.isArray(response?.data?.taskInfoList) ? response.data.taskInfoList : [];
}

function getBrowseTask(task) {
  return task?.extInfo?.browseTask || {};
}

function getTaskItem(task) {
  const items = getBrowseTask(task).shoppingActivityList;
  return Array.isArray(items) && items.length ? items[0] : {};
}

function getTaskItemId(task) {
  return task?.taskProgress?.itemId || getTaskItem(task).itemId || '';
}

function getTaskUrl(task) {
  return getTaskItem(task).url || '';
}

function getTaskWaitMs(task) {
  const browseTime = Number(getBrowseTask(task).browseTime || 0);
  return browseTime > 0 ? browseTime * 1000 : DEFAULT_BROWSE_WAIT_MS;
}

function isInviteTask(task) {
  return Number(task?.taskType) === 1 || /邀请|助力/.test(String(task?.taskName || ''));
}

function isBrowseBeanTask(task) {
  return Number(task?.showTask) === 1
    && Number(task?.taskType) === 3
    && Number(task?.prizeType) === 2
    && Number(task?.taskAmount || 0) > 0
    && Boolean(task?.taskId)
    && Boolean(getTaskItemId(task));
}

function isTaskTodo(task) {
  return Number(task?.taskStatus) === 1;
}

function isTaskRewardable(task) {
  return Number(task?.taskStatus) === 10;
}

function isTaskDone(task) {
  return Number(task?.taskStatus) === 2;
}

function getRunnableTasks(taskList) {
  return taskList
    .filter((task) => !isInviteTask(task))
    .filter(isBrowseBeanTask)
    .filter((task) => isTaskTodo(task) || isTaskRewardable(task));
}

function summarizeTask(task) {
  return [
    task?.taskName || '未知任务',
    `taskId=${task?.taskId || '-'}`,
    `type=${task?.taskType ?? '-'}`,
    `status=${task?.taskStatus ?? '-'}`,
    `progress=${task?.taskProgress?.current ?? '-'}/${task?.taskProgress?.total ?? '-'}`,
    `itemId=${getTaskItemId(task) || '-'}`,
    `reward=${task?.taskAmount || 0}京豆`,
  ].join(' | ');
}

function isApiSuccess(response) {
  return Number(response?.code) === 0;
}

function getResponseMessage(response) {
  return response?.msg || response?.message || response?.data?.msg || stringifySnippet(response, 300);
}

function readSignStatus(response) {
  return Number(response?.data?.status ?? -1);
}

function readItemId(response) {
  return response?.data?.itemId || '1';
}

function findTaskByKey(taskList, task) {
  const itemId = getTaskItemId(task);
  return taskList.find((item) => item.taskId === task.taskId && getTaskItemId(item) === itemId)
    || taskList.find((item) => item.taskId === task.taskId)
    || null;
}

async function refreshTaskList(cookie, prefix) {
  const response = await queryTaskList(cookie, prefix);
  const tasks = readTaskList(response);
  const runnableTasks = getRunnableTasks(tasks);
  $.log(`${prefix}: 任务列表 => ${runnableTasks.length ? runnableTasks.map(summarizeTask).join(' || ') : '无可执行浏览领豆任务'}`);
  return tasks;
}

async function claimTaskReward(cookie, task, prefix) {
  $.log(`${prefix}: 开始领取任务奖励 => ${summarizeTask(task)}`);
  const response = await rewardTask(cookie, task, prefix);
  if (isApiSuccess(response)) {
    $.log(`${prefix}: 任务领奖成功 => ${task.taskName || task.taskId} | ${summarizePrizeInfos(response)}`);
  } else {
    $.log(`${prefix}: 任务领奖失败 => ${task.taskName || task.taskId} | ${getResponseMessage(response)}`);
  }
  return response;
}

async function completeBrowseTask(cookie, task, prefix) {
  $.log(`${prefix}: 开始浏览任务 => ${summarizeTask(task)}`);
  const taskUrl = getTaskUrl(task);
  if (taskUrl) {
    $.log(`${prefix}: 任务浏览链接 => ${taskUrl}`);
  }

  await sleep(getTaskWaitMs(task));
  const response = await completeTask(cookie, task, prefix);
  if (isApiSuccess(response)) {
    $.log(`${prefix}: 浏览任务上报成功 => ${task.taskName || task.taskId}`);
  } else {
    $.log(`${prefix}: 浏览任务上报失败 => ${task.taskName || task.taskId} | ${getResponseMessage(response)}`);
  }
  return response;
}

async function runBeanTasks(cookie, prefix) {
  let tasks = await refreshTaskList(cookie, prefix);
  let processedCount = 0;
  const maxTasks = getMaxTasks();

  while (processedCount < maxTasks) {
    const runnableTasks = getRunnableTasks(tasks);
    const task = runnableTasks.find(isTaskRewardable) || runnableTasks.find(isTaskTodo);
    if (!task) {
      $.log(`${prefix}: 没有更多可执行浏览领豆任务`);
      return;
    }

    if (isTaskRewardable(task)) {
      await claimTaskReward(cookie, task, prefix);
      processedCount += 1;
      tasks = await refreshTaskList(cookie, prefix);
      continue;
    }

    if (isTaskTodo(task)) {
      await completeBrowseTask(cookie, task, prefix);
      await sleep(1000);
      tasks = await refreshTaskList(cookie, prefix);
      const refreshedTask = findTaskByKey(tasks, task);
      if (refreshedTask && isTaskRewardable(refreshedTask)) {
        await claimTaskReward(cookie, refreshedTask, prefix);
      } else if (refreshedTask && isTaskDone(refreshedTask)) {
        $.log(`${prefix}: 任务已完成 => ${summarizeTask(refreshedTask)}`);
      } else {
        $.log(`${prefix}: 上报后未进入可领奖状态 => ${refreshedTask ? summarizeTask(refreshedTask) : task.taskName || task.taskId}`);
      }
      processedCount += 1;
      tasks = await refreshTaskList(cookie, prefix);
    }
  }

  $.log(`${prefix}: 已达到本次任务执行上限 => ${maxTasks}`);
}

async function runAccount(cookie, index) {
  const prefix = `账号${index} ${getUserName(cookie)}`;
  $.log(`\n==== ${prefix} ====`);

  const firstQuery = await querySign(cookie, prefix);
  const signStatus = readSignStatus(firstQuery);
  $.log(
    `${prefix}: 初始签到状态 => status=${signStatus}, already=${firstQuery?.data?.alreadySignDays ?? '-'}`
      + `/${firstQuery?.data?.totalSignDays ?? '-'}, canClaim=${firstQuery?.data?.canClaimAmount ?? '-'}`,
  );

  if (signStatus === 1) {
    const signResult = await drawSign(cookie, readItemId(firstQuery), prefix);
    $.log(`${prefix}: 签到结果 => code=${signResult?.code ?? '-'} msg=${signResult?.msg || '-'} | ${summarizePrizeInfos(signResult)}`);

    const secondQuery = await querySign(cookie, prefix);
    $.log(
      `${prefix}: 复查签到状态 => status=${readSignStatus(secondQuery)}, already=${secondQuery?.data?.alreadySignDays ?? '-'}`
        + `/${secondQuery?.data?.totalSignDays ?? '-'}, canClaim=${secondQuery?.data?.canClaimAmount ?? '-'}`,
    );
    await runBeanTasks(cookie, prefix);
    return;
  }

  if (signStatus === 2) {
    $.log(`${prefix}: 今日已签到 => ${summarizePrizeInfos(firstQuery)}`);
    await runBeanTasks(cookie, prefix);
    return;
  }

  $.log(`${prefix}: 未识别签到状态 => ${stringifySnippet(firstQuery, 1000)}`);
  await runBeanTasks(cookie, prefix);
}

(async () => {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  $.log(`共${cookies.length}个京东账号Cookie`);
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1} 执行异常 => ${error.message || error}`);
    }
  }
})()
  .catch((error) => {
    $.log(`脚本执行异常 => ${error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
