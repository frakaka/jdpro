/*
cron:14 0 * * * jd_home_appliance_sign_task_bean.js
家电家居签到做任务领京豆和金币。

环境变量说明：
1. JD_HOME_APPLIANCE_DEBUG
   含义：是否打印更完整的接口 request/response。
   是否必须：否，值为 1 时开启。

2. JD_HOME_APPLIANCE_DRY_RUN
   含义：只查询签到、任务和金币余额，不执行签到、做任务、领奖。
   是否必须：否，值为 1 时开启。

3. JD_HOME_APPLIANCE_BEAN_MAX_TASKS / JD_HOME_APPLIANCE_GOLD_MAX_TASKS
   含义：单账号最多执行几个京豆浏览任务、金币任务。
   是否必须：否，默认京豆 6 个、金币 12 个。

4. JD_HOME_APPLIANCE_GOLD_MAX_ATTEMPTS
   含义：金币任务最多尝试多少次请求，防止浏览任务未领取时长时间扫子项。
   是否必须：否，默认取 JD_HOME_APPLIANCE_GOLD_MAX_TASKS + 5 和 8 的较大值。

5. JD_HOME_APPLIANCE_DO_CART
   含义：是否尝试金币加购任务。
   是否必须：否，默认不尝试；值为 1 时开启。

6. JD_HOME_APPLIANCE_EID_TOKEN
   含义：可选的 x-api-eid-token。接口触发风控时可从抓包里覆盖。
   是否必须：否。
*/

'use strict';

const crypto = require('crypto');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  getUserName,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('家电家居签到做任务');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const API_ENDPOINT = 'https://api.m.jd.com/api';
const BEAN_APPID = 'jx_h5_babel';
const BEAN_CHANNEL = 'jxh5';
const BEAN_CLIENT = 'jxh5';
const BEAN_CLIENT_VERSION = '1.2.5';
const BEAN_ACTIVITY_SOURCE = 'jxzy';
const BEAN_CRAFT_ID = '69ae8eb86a31c802e19f9f8f';
const BEAN_APP_CODE = 'ms1888ebbf';
const BEAN_BUID = 325;
const BEAN_SCENEVAL = 2;
const BEAN_PAGE_ID = '2H8G6a7JecjqHH3t1ZWSoJjPtziP';
const BEAN_PAGE_URL = `https://prodev.m.jd.com/mall/active/${BEAN_PAGE_ID}/index.html`;
const BEAN_REFERER = `${BEAN_PAGE_URL}?babelChannel=ttt15&hideAnchorBottomTab=1&topNavStyle=1`;
const BEAN_DRAW_H5ST_APP_ID = 'c50cc';
const BEAN_COMPLETE_H5ST_APP_ID = 'cec1e';
const BEAN_REWARD_H5ST_APP_ID = '573fe';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM6APJM2UAAAAAADOHNUOITADJOBEX';

const GOLD_APPID = 'home-channel';
const GOLD_PROJECT_ID = '6pvWvhxzcHzeEiWsqP5oKgUbHEy';
const GOLD_SOURCE_CODE = 'ace454250';
const GOLD_ENCODE_ACTIVITY_ID = '3mknCJXM9fpJGueqd7BDdknZgFpt';
const GOLD_ACTIVITY_ID = '01647428';
const GOLD_PAGE_ID = '5484560';
const GOLD_MODULE_ID = 116046674;
const GOLD_BABEL_CHANNEL = 'ttt2';
const GOLD_PAGE_URL = `https://pro.m.jd.com/mall/active/${GOLD_ENCODE_ACTIVITY_ID}/index.html`;
const GOLD_REFERER = `${GOLD_PAGE_URL}?babelChannel=${GOLD_BABEL_CHANNEL}&stath=47&navh=44`;
const GOLD_QUERY_EXT = {
  needNum: 50,
  rewardEncryptAssignmentId: '3K8BpMw2K1ArT5dGzvmupgYYibdy',
  assistEncryptAssignmentId: '36a4jWTk5hyZS5fq76FhWKHGHm9a',
  rewardEncryptNewAssignmentId: '49MSMSjufgKFuc6x2wyNydUmv4mK',
  assistInfoFlag: 4,
  assistNum: 5,
};
const DEFAULT_BEAN_MAX_TASKS = 6;
const DEFAULT_GOLD_MAX_TASKS = 12;
const DEFAULT_BEAN_WAIT_MS = 10 * 1000;
const DEFAULT_GOLD_WAIT_MS = 5 * 1000;
const TASK_INTERVAL_MS = 1000;
const USER_AGENT = process.env.JD_HOME_APPLIANCE_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778180112%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const GOLD_USER_AGENT = process.env.JD_HOME_APPLIANCE_GOLD_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const DEFAULT_BEAN_UUID = '6486947217451122050';
const GOLD_H5ST_APP_ID = '74333';

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_HOME_APPLIANCE_DEBUG === '1';
}

function isDryRun() {
  return process.env.JD_HOME_APPLIANCE_DRY_RUN === '1';
}

function shouldDoCartTask() {
  return process.env.JD_HOME_APPLIANCE_DO_CART === '1';
}

function readMaxTasks(envName, fallback) {
  const value = Number(process.env[envName] || fallback);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function getBeanMaxTasks() {
  return readMaxTasks('JD_HOME_APPLIANCE_BEAN_MAX_TASKS', DEFAULT_BEAN_MAX_TASKS);
}

function getGoldMaxTasks() {
  return readMaxTasks('JD_HOME_APPLIANCE_GOLD_MAX_TASKS', DEFAULT_GOLD_MAX_TASKS);
}

function getGoldMaxAttempts(maxTasks) {
  const fallback = Math.max(maxTasks + 5, 8);
  return readMaxTasks('JD_HOME_APPLIANCE_GOLD_MAX_ATTEMPTS', fallback);
}

function getBeanWaitMs(task) {
  const browseTask = task?.extInfo?.browseTask || {};
  const waitSeconds = Number(browseTask.browseTime || 0);
  return Math.max(waitSeconds * 1000, DEFAULT_BEAN_WAIT_MS);
}

function getGoldWaitMs(task) {
  const waitSeconds = Number(task?.ext?.waitDuration || 0);
  return Math.max(waitSeconds * 1000, DEFAULT_GOLD_WAIT_MS);
}

function stringifyForLog(value, maxLength = 1200) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 5000) : maxLength);
}

function md5(content) {
  return crypto.createHash('md5').update(String(content)).digest('hex');
}

function normalizeApiResult(result) {
  if (typeof result !== 'string') {
    return result;
  }

  try {
    const decoded = Buffer.from(result, 'base64').toString('utf8');
    if (decoded.trim().startsWith('{')) {
      return JSON.parse(decoded);
    }
  } catch (error) {
    return result;
  }
  return result;
}

function buildSignBody(payload) {
  const time = Date.now();
  const body = {
    ...payload,
    sceneval: BEAN_SCENEVAL,
    buid: BEAN_BUID,
    appCode: BEAN_APP_CODE,
    time,
  };

  return {
    ...body,
    signStr: md5(JSON.stringify(body)),
  };
}

function buildBeanForm(cookie) {
  return {
    t: Date.now(),
    channel: BEAN_CHANNEL,
    clientVersion: BEAN_CLIENT_VERSION,
    client: BEAN_CLIENT,
    uuid: process.env.JD_HOME_APPLIANCE_BEAN_UUID || DEFAULT_BEAN_UUID,
    cthr: '1',
    loginType: '2',
  };
}

function getEidToken() {
  return process.env.JD_HOME_APPLIANCE_EID_TOKEN || DEFAULT_EID_TOKEN;
}

async function requestBeanApi(cookie, prefix, functionId, body, options = {}) {
  const extraForm = buildBeanForm(cookie);
  if (options.includeEidToken && getEidToken()) {
    extraForm['x-api-eid-token'] = getEidToken();
  }

  const requestLog = {
    functionId,
    appid: BEAN_APPID,
    body,
    extraForm: {
      ...extraForm,
      'x-api-eid-token': extraForm['x-api-eid-token'] ? '[masked]' : undefined,
    },
  };
  $.log(`${prefix}: request ${functionId} => ${stringifyForLog(requestLog)}`);

  const result = normalizeApiResult(await postFormApi(cookie, {
    endpoint: API_ENDPOINT,
    functionId,
    appid: BEAN_APPID,
    body,
    client: BEAN_CLIENT,
    userAgent: USER_AGENT,
    origin: 'https://prodev.m.jd.com',
    referer: BEAN_REFERER,
    extraForm,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': BEAN_PAGE_URL,
    },
    h5stAppId: options.h5stAppId || '',
    h5stVersion: '5.3',
  }));

  $.log(`${prefix}: response ${functionId} => ${stringifyForLog(result, 1600)}`);
  return result;
}

async function queryBeanSign(cookie, prefix) {
  return requestBeanApi(cookie, prefix, 'jxzy_active_querySign', buildSignBody({
    source: BEAN_ACTIVITY_SOURCE,
    craftId: BEAN_CRAFT_ID,
  }));
}

async function drawBeanSign(cookie, prefix, itemId) {
  return requestBeanApi(cookie, prefix, 'jxzy_active_drawSign', buildSignBody({
    itemId: String(itemId || '1'),
    craftId: BEAN_CRAFT_ID,
    source: BEAN_ACTIVITY_SOURCE,
  }), {
    h5stAppId: BEAN_DRAW_H5ST_APP_ID,
    includeEidToken: true,
  });
}

async function queryBeanTasks(cookie, prefix) {
  return requestBeanApi(cookie, prefix, 'jxzy_active_task_queryTaskList', buildSignBody({
    source: BEAN_ACTIVITY_SOURCE,
    craftId: BEAN_CRAFT_ID,
  }));
}

async function completeBeanTask(cookie, prefix, task) {
  return requestBeanApi(cookie, prefix, 'jxzy_active_task_completeTask', buildSignBody({
    craftId: BEAN_CRAFT_ID,
    taskId: task.taskId,
    itemId: getBeanTaskItemId(task),
    taskType: Number(task.taskType),
  }), {
    h5stAppId: BEAN_COMPLETE_H5ST_APP_ID,
    includeEidToken: true,
  });
}

async function rewardBeanTask(cookie, prefix, task) {
  return requestBeanApi(cookie, prefix, 'jxzy_active_task_rewardTask', buildSignBody({
    craftId: BEAN_CRAFT_ID,
    taskId: task.taskId,
    itemId: getBeanTaskItemId(task),
    taskType: Number(task.taskType),
  }), {
    h5stAppId: BEAN_REWARD_H5ST_APP_ID,
    includeEidToken: true,
  });
}

function buildGoldExtParams() {
  return {
    activityId: GOLD_ACTIVITY_ID,
    pageId: GOLD_PAGE_ID,
    moduleId: GOLD_MODULE_ID,
    encodeActivityId: GOLD_ENCODE_ACTIVITY_ID,
    babelChannel: GOLD_BABEL_CHANNEL,
  };
}

function buildGoldForm() {
  return {
    loginType: '2',
    area: process.env.JD_HOME_APPLIANCE_GOLD_AREA || '',
    client: process.env.JD_HOME_APPLIANCE_GOLD_CLIENT || 'm',
    screen: process.env.JD_HOME_APPLIANCE_GOLD_SCREEN || '1512*982',
    clientVersion: process.env.JD_HOME_APPLIANCE_GOLD_CLIENT_VERSION || '13.8.2',
    ext: JSON.stringify(buildGoldExtParams()),
    t: Date.now(),
    'x-api-eid-token': getEidToken(),
  };
}

async function requestGoldApi(cookie, prefix, functionId, body) {
  const extraForm = buildGoldForm();
  $.log(`${prefix}: request ${functionId} => ${stringifyForLog({
    url: API_ENDPOINT,
    functionId,
    appid: GOLD_APPID,
    body,
    extraForm: {
      ...extraForm,
      'x-api-eid-token': extraForm['x-api-eid-token'] ? '[masked]' : undefined,
    },
  })}`);

  const meta = await postFormApi(cookie, {
    endpoint: API_ENDPOINT,
    functionId,
    appid: GOLD_APPID,
    body,
    client: extraForm.client,
    userAgent: GOLD_USER_AGENT,
    origin: 'https://pro.m.jd.com',
    referer: GOLD_REFERER,
    extraForm,
    extraHeaders: {
      Accept: 'application/json, text/plain, */*',
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': GOLD_PAGE_URL,
    },
    h5stAppId: GOLD_H5ST_APP_ID,
    h5stVersion: '5.3',
    includeMeta: true,
  });

  const result = normalizeApiResult(meta.data);
  $.log(`${prefix}: response ${functionId} => ${stringifyForLog({ httpStatus: meta.statusCode, response: result }, 1600)}`);
  return result;
}

async function queryGoldTasks(cookie, prefix) {
  return requestGoldApi(cookie, prefix, 'home.zzj.MyPage.queryInteractiveInfo', {
    encryptProjectId: GOLD_PROJECT_ID,
    sourceCode: GOLD_SOURCE_CODE,
    ext: GOLD_QUERY_EXT,
  });
}

async function queryMyGold(cookie, prefix) {
  return requestGoldApi(cookie, prefix, 'home.zzj.MyPage.myGold', {
    encryptProjectId: GOLD_PROJECT_ID,
  });
}

async function validGoldOpen(cookie, prefix) {
  return requestGoldApi(cookie, prefix, 'home.zzj.DoTask.validOpen', {
    actionType: 2,
  });
}

async function finishGoldTask(cookie, prefix, task, item = {}) {
  const body = {
    encryptAssignmentId: task.encryptAssignmentId,
    encryptProjectId: GOLD_PROJECT_ID,
  };
  const itemId = getGoldTaskItemId(task, item);
  if (itemId) {
    body.itemId = itemId;
  }

  return requestGoldApi(cookie, prefix, 'home.zzj.DoTask.finishTask', body);
}

function isApiSuccess(result) {
  const subCode = result?.data?.subCode;
  if (subCode !== undefined && String(subCode) !== '0') {
    return false;
  }
  if (String(result?.data?.msg || '').includes('任务已结束')) {
    return false;
  }
  return result?.success === true || Number(result?.code) === 0 || result?.msg === 'success';
}

function isBeanSignReady(result) {
  return Number(result?.data?.status) === 1;
}

function isBeanSignDone(result) {
  return Number(result?.data?.status) === 2;
}

function getBeanTasks(result) {
  return Array.isArray(result?.data?.taskInfoList) ? result.data.taskInfoList : [];
}

function getBeanTaskItemId(task) {
  return task?.taskProgress?.itemId || task?.extInfo?.browseTask?.shoppingActivityList?.[0]?.itemId || '';
}

function getBeanTaskUrl(task) {
  return task?.extInfo?.browseTask?.shoppingActivityList?.[0]?.url || '';
}

function isBeanTaskPending(task) {
  return Number(task?.taskType) === 3
    && Number(task?.taskStatus) === 1
    && Boolean(task?.taskId)
    && Boolean(getBeanTaskItemId(task))
    && Boolean(getBeanTaskUrl(task));
}

function isBeanTaskClaimable(task) {
  return Number(task?.taskStatus) === 10 && Boolean(task?.taskId) && Boolean(getBeanTaskItemId(task));
}

function summarizeBeanTask(task) {
  return [
    task?.taskName || '未知任务',
    `id=${task?.taskId || '-'}`,
    `type=${task?.taskType ?? '-'}`,
    `status=${task?.taskStatus ?? '-'}`,
    `progress=${task?.taskProgress?.current ?? 0}/${task?.taskProgress?.total ?? 0}`,
    `item=${getBeanTaskItemId(task) || '-'}`,
    `reward=${task?.taskAmount || '-'}京豆`,
  ].join(' | ');
}

function summarizeBeanPrize(result) {
  return (result?.data?.prizeInfos || [])
    .map((item) => `${item.discount || item.amount || ''}京豆`)
    .filter(Boolean)
    .join(',');
}

function getGoldTasks(result) {
  return Array.isArray(result?.assignmentList) ? result.assignmentList : [];
}

function isGoldTaskDone(task) {
  const completionCnt = Number(task?.completionCnt || 0);
  const limit = Number(task?.assignmentTimesLimit || 0);
  return Boolean(task?.completionFlag) || (limit > 0 && completionCnt >= limit);
}

function getGoldTaskItems(task) {
  const ext = task?.ext || {};
  const lists = [
    ext.shoppingActivity,
    ext.followShop,
    ext.followChannel,
    ext.addCart,
  ];
  return lists.find((list) => Array.isArray(list) && list.length) || [];
}

function pickGoldTaskItem(task, blockedItems = new Set()) {
  const items = getGoldTaskItems(task);
  return items.find((item) => Number(item.status) !== 2 && !blockedItems.has(getGoldTaskItemKey(task, item)))
    || items.find((item) => !blockedItems.has(getGoldTaskItemKey(task, item)))
    || {};
}

function getGoldTaskItemId(task, item = {}) {
  return item.itemId || item.shopId || item.venderId || task?.ext?.sign?.itemId || task?.ext?.sign1?.itemId || '';
}

function getGoldTaskUrl(task, item = {}) {
  return item.url || item.jumpUrl || item.linkUrl || '';
}

function getGoldTaskKey(task) {
  return String(task?.encryptAssignmentId || task?.assignmentName || 'unknown');
}

function getGoldTaskItemKey(task, item = {}) {
  return `${getGoldTaskKey(task)}::${getGoldTaskItemId(task, item) || 'default'}`;
}

function formatGoldRewards(task) {
  return (task?.rewards || [])
    .map((reward) => reward.rewardName || reward.rewardDesc || reward.prizeName || reward.rewardValue || '奖励')
    .join(',');
}

function hasWantedGoldReward(task) {
  const rewards = formatGoldRewards(task);
  return rewards.includes('金币') || rewards.includes('京豆');
}

function isGoldOrderTask(task) {
  const name = String(task?.assignmentName || '');
  return name.includes('下单') || name.includes('订单') || name.includes('购买');
}

function isGoldExchangeTask(task) {
  const name = String(task?.assignmentName || '');
  return Number(task?.assignmentType) === 30 || name.includes('兑换') || name.includes('抓抓机');
}

function isGoldCartTask(task) {
  return Number(task?.assignmentType) === 4 || String(task?.ext?.extraType || '') === 'addCart';
}

function shouldRunGoldTask(task) {
  if (!task?.encryptAssignmentId || isGoldTaskDone(task) || !hasWantedGoldReward(task)) {
    return false;
  }
  if (isGoldOrderTask(task) || isGoldExchangeTask(task)) {
    return false;
  }
  if (isGoldCartTask(task)) {
    return shouldDoCartTask();
  }
  return [0, 1, 3, 5].includes(Number(task.assignmentType));
}

function summarizeGoldTask(task) {
  const item = pickGoldTaskItem(task);
  return [
    task?.assignmentName || '未知任务',
    `id=${task?.encryptAssignmentId || '-'}`,
    `type=${task?.assignmentType ?? '-'}`,
    `cnt=${task?.completionCnt || 0}/${task?.assignmentTimesLimit || 0}`,
    `done=${Boolean(task?.completionFlag)}`,
    `item=${getGoldTaskItemId(task, item) || '-'}`,
    `reward=${formatGoldRewards(task) || '-'}`,
  ].join(' | ');
}

function summarizeGoldResult(result) {
  const data = result?.data || {};
  if (data.rewardsDetail) {
    return `奖励=${data.rewardsDetail}${data.rewardsType === 1 ? '金币' : ''}`;
  }
  return data.msg || result?.msg || '-';
}

async function openTaskUrl(cookie, prefix, taskUrl, referer) {
  if (!taskUrl || !/^https?:\/\//.test(taskUrl)) {
    return;
  }

  $.log(`${prefix}: 打开任务页 => ${taskUrl}`);
  try {
    const response = await got.get(taskUrl, {
      headers: buildHeaders(cookie, {
        origin: new URL(taskUrl).origin,
        referer,
        userAgent: USER_AGENT,
        contentType: undefined,
        extraHeaders: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      }),
      followRedirect: true,
      throwHttpErrors: false,
      timeout: { request: 30000 },
    });
    $.log(`${prefix}: 任务页响应 => HTTP ${response.statusCode}, finalUrl=${response.url || taskUrl}`);
  } catch (error) {
    $.log(`${prefix}: 任务页异常，继续上报 => ${error.message || error}`);
  }
}

function logBeanTaskList(prefix, tasks) {
  $.log(`${prefix}: 京豆任务列表 => ${tasks.map(summarizeBeanTask).join(' || ') || '空'}`);
}

function logGoldTaskList(prefix, tasks) {
  $.log(`${prefix}: 金币任务列表 => ${tasks.map(summarizeGoldTask).join(' || ') || '空'}`);
}

async function claimReadyBeanTasks(cookie, prefix, tasks) {
  const readyTasks = tasks.filter(isBeanTaskClaimable);
  for (const task of readyTasks) {
    if (isDryRun()) {
      $.log(`${prefix}: dry-run 跳过领取京豆任务 => ${summarizeBeanTask(task)}`);
      continue;
    }
    const result = await rewardBeanTask(cookie, prefix, task);
    $.log(`${prefix}: 领取京豆任务 => ${summarizeBeanTask(task)} | ${summarizeBeanPrize(result) || stringifyForLog(result, 800)}`);
    await sleep(TASK_INTERVAL_MS);
  }
}

async function runBeanTask(cookie, prefix, task) {
  await openTaskUrl(cookie, prefix, getBeanTaskUrl(task), BEAN_REFERER);
  const waitMs = getBeanWaitMs(task);
  $.log(`${prefix}: 等待京豆浏览完成 => ${waitMs}ms`);
  await sleep(waitMs);

  const completeResult = await completeBeanTask(cookie, prefix, task);
  $.log(`${prefix}: 完成京豆任务上报 => ${summarizeBeanTask(task)} | code=${completeResult?.code ?? '-'} msg=${completeResult?.msg || '-'}`);
  await sleep(TASK_INTERVAL_MS);
}

async function runBeanWorkflow(cookie, prefix) {
  const signInfo = await queryBeanSign(cookie, prefix);
  $.log(`${prefix}: 京豆签到信息 => status=${signInfo?.data?.status ?? '-'} 已签=${signInfo?.data?.alreadySignDays ?? '-'} 可领=${signInfo?.data?.canClaimAmount ?? '-'}`);

  if (isDryRun()) {
    $.log(`${prefix}: dry-run 跳过京豆签到执行`);
  } else if (isBeanSignReady(signInfo)) {
    const signResult = await drawBeanSign(cookie, prefix, signInfo?.data?.itemId || '1');
    $.log(`${prefix}: 京豆签到结果 => ${summarizeBeanPrize(signResult) || stringifyForLog(signResult, 800)}`);
  } else if (isBeanSignDone(signInfo)) {
    $.log(`${prefix}: 今日京豆签到已完成`);
  } else {
    $.log(`${prefix}: 京豆签到状态未识别 => ${stringifyForLog(signInfo, 800)}`);
  }

  let taskInfo = await queryBeanTasks(cookie, prefix);
  let tasks = getBeanTasks(taskInfo);
  $.log(`${prefix}: 京豆任务面板 => 可领=${taskInfo?.data?.canClaimAmount ?? '-'} 总额=${taskInfo?.data?.totalAmount ?? '-'} 任务数=${tasks.length}`);
  logBeanTaskList(prefix, tasks);
  await claimReadyBeanTasks(cookie, prefix, tasks);

  const attemptedTasks = new Set();
  let executedCount = 0;
  while (executedCount < getBeanMaxTasks()) {
    taskInfo = await queryBeanTasks(cookie, prefix);
    tasks = getBeanTasks(taskInfo);
    const task = tasks.find((item) => isBeanTaskPending(item) && !attemptedTasks.has(item.taskId));
    if (!task) {
      break;
    }

    $.log(`${prefix}: 执行京豆任务 => ${summarizeBeanTask(task)}`);
    attemptedTasks.add(task.taskId);
    if (!isDryRun()) {
      await runBeanTask(cookie, prefix, task);
      const refreshed = await queryBeanTasks(cookie, prefix);
      await claimReadyBeanTasks(cookie, prefix, getBeanTasks(refreshed));
    }
    executedCount += 1;
  }

  $.log(`${prefix}: 本轮执行京豆任务数 => ${executedCount}`);
}

async function runGoldTask(cookie, prefix, task, item) {
  await validGoldOpen(cookie, prefix);

  const taskUrl = getGoldTaskUrl(task, item);
  if (taskUrl) {
    await openTaskUrl(cookie, prefix, taskUrl, GOLD_REFERER);
    const waitMs = getGoldWaitMs(task);
    $.log(`${prefix}: 等待金币任务完成 => ${waitMs}ms`);
    await sleep(waitMs);
  }

  const result = await finishGoldTask(cookie, prefix, task, item);
  $.log(`${prefix}: 金币任务结果 => ${summarizeGoldTask(task)} | ${summarizeGoldResult(result)}`);
  return result;
}

async function runGoldWorkflow(cookie, prefix) {
  let goldInfo = await queryMyGold(cookie, prefix);
  $.log(`${prefix}: 金币余额 => ${goldInfo?.data?.myGold?.num ?? '-'}`);

  let taskInfo = await queryGoldTasks(cookie, prefix);
  let tasks = getGoldTasks(taskInfo);
  logGoldTaskList(prefix, tasks);

  const blockedTasks = new Set();
  const blockedItems = new Set();
  const maxTasks = getGoldMaxTasks();
  const maxAttempts = getGoldMaxAttempts(maxTasks);
  let executedCount = 0;
  let attemptCount = 0;
  while (executedCount < maxTasks && attemptCount < maxAttempts) {
    const task = tasks.find((item) => shouldRunGoldTask(item) && !blockedTasks.has(getGoldTaskKey(item)));
    if (!task) {
      break;
    }

    const item = pickGoldTaskItem(task, blockedItems);
    $.log(`${prefix}: 执行金币任务 => ${summarizeGoldTask(task)}`);

    if (isDryRun()) {
      blockedTasks.add(getGoldTaskKey(task));
      executedCount += 1;
      attemptCount += 1;
      continue;
    }

    attemptCount += 1;
    const result = await runGoldTask(cookie, prefix, task, item);
    if (!isApiSuccess(result)) {
      blockedItems.add(getGoldTaskItemKey(task, item));
      $.log(`${prefix}: 金币任务未成功，跳过当前子项 => ${getGoldTaskItemKey(task, item)}`);
      if (!pickGoldTaskItem(task, blockedItems)?.itemId) {
        blockedTasks.add(getGoldTaskKey(task));
      }
      continue;
    }

    executedCount += 1;
    await sleep(TASK_INTERVAL_MS);
    goldInfo = await queryMyGold(cookie, prefix);
    taskInfo = await queryGoldTasks(cookie, prefix);
    tasks = getGoldTasks(taskInfo);
    $.log(`${prefix}: 刷新金币余额 => ${goldInfo?.data?.myGold?.num ?? '-'}`);
    logGoldTaskList(prefix, tasks);
  }

  $.log(`${prefix}: 本轮执行金币任务数 => ${executedCount}，尝试次数 => ${attemptCount}/${maxAttempts}`);
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);

  await runBeanWorkflow(cookie, prefix);
  await sleep(TASK_INTERVAL_MS);
  await runGoldWorkflow(cookie, prefix);
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行异常 => ${error.stack || error.message}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常 => ${error.stack || error.message}`))
  .finally(() => $.done());
