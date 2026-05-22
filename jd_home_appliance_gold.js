/*
cron:13 0 * * * jd_home_appliance_gold.js
家电家居金币。

环境变量说明：
1. JD_HOME_GOLD_DEBUG
   含义：是否打印更完整的接口 request/response。
   是否必须：否，值为 1 时开启。

2. JD_HOME_GOLD_MAX_TASKS / JD_HOME_GOLD_WAIT_MS
   含义：单账号最多执行几个金币任务、浏览等待兜底毫秒数。
   是否必须：否，默认最多执行 8 个任务、浏览默认等待 11000ms。

3. JD_HOME_GOLD_DO_ALL
   含义：是否尝试关注频道/店铺、入会等非浏览任务。
   是否必须：否，默认尝试全部支持任务；值为 0 时只执行签到和浏览任务。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  getRequestUuid,
  getUserName,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('家电家居金币');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const API_ENDPOINT = 'https://api.m.jd.com/api';
const APPID = 'home-marketing';
const ACTIVITY_ID = '4';
const ENCODE_ACTIVITY_ID = '4SitPQagKibGQK1HX7J83sroHj5x';
const BABEL_ACTIVITY_ID = '02015566';
const PAGE_ID = '6145671';
const MODULE_ID = 127736824;
const PAGE_URL = `https://pro.m.jd.com/mall/active/${ENCODE_ACTIVITY_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?navh=44&stath=47&collectionId=224`;
const AREA = '18_1482_3606_60000';
const DEFAULT_MAX_TASKS = 8;
const DEFAULT_WAIT_MS = 11000;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = process.env.JD_HOME_GOLD_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778179241%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_HOME_GOLD_DEBUG === '1';
}

function isDoAllEnabled() {
  return process.env.JD_HOME_GOLD_DO_ALL !== '0';
}

function getMaxTasks() {
  const value = Number(process.env.JD_HOME_GOLD_MAX_TASKS || DEFAULT_MAX_TASKS);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_MAX_TASKS;
}

function getDefaultWaitMs() {
  const value = Number(process.env.JD_HOME_GOLD_WAIT_MS || DEFAULT_WAIT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_WAIT_MS;
}

function stringifyForLog(value, maxLength = 1200) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 5000) : maxLength);
}

function maskRequestForLog(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key.toLowerCase && key.toLowerCase() === 'cookie') {
      return '[masked]';
    }
    return item;
  }));
}

function getExtParams() {
  return {
    activityId: BABEL_ACTIVITY_ID,
    pageId: PAGE_ID,
    moduleId: MODULE_ID,
    encodeActivityId: ENCODE_ACTIVITY_ID,
  };
}

function buildQuery(cookie, functionId, body) {
  const query = new URLSearchParams();
  query.set('functionId', functionId);
  query.set('body', JSON.stringify(body));
  query.set('appid', APPID);
  query.set('loginType', '2');
  query.set('area', AREA);
  query.set('gpsArea', AREA);
  query.set('client', 'apple');
  query.set('osVersion', process.env.JD_HOME_GOLD_OS_VERSION || '26.2');
  query.set('networkType', 'wifi');
  query.set('d_model', process.env.JD_HOME_GOLD_MODEL || 'iPhone14,5');
  query.set('d_brand', 'iPhone');
  query.set('screen', process.env.JD_HOME_GOLD_SCREEN || '390*844');
  query.set('openudid', process.env.JD_HOME_GOLD_OPENUDID || getRequestUuid(cookie));
  query.set('clientVersion', process.env.JD_HOME_GOLD_CLIENT_VERSION || '15.7.20');
  query.set('ext', JSON.stringify(getExtParams()));
  query.set('t', Date.now());
  return query;
}

async function callHomeApi(cookie, prefix, functionId, body) {
  const query = buildQuery(cookie, functionId, body);
  const url = `${API_ENDPOINT}?${query.toString()}`;
  $.log(`${prefix}: request ${functionId} => ${stringifyForLog(maskRequestForLog({ url: API_ENDPOINT, query: Object.fromEntries(query.entries()) }))}`);

  const response = await got.post(url, {
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: USER_AGENT,
      extraHeaders: {
        Accept: 'application/json, text/plain, */*',
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    }),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  const parsed = parseResponse(response.body);
  $.log(`${prefix}: response ${functionId} => ${stringifyForLog({ httpStatus: response.statusCode, response: parsed }, 1600)}`);
  return parsed;
}

function parseResponse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    return { code: -1, msg: 'JSON解析失败', raw: stringifySnippet(text || '', 800) };
  }
}

async function queryMainPage(cookie, prefix) {
  return callHomeApi(cookie, prefix, 'jjg_mainPage', { activityId: ACTIVITY_ID });
}

async function queryInteractiveInfo(cookie, prefix) {
  return callHomeApi(cookie, prefix, 'jjg_queryInteractiveInfo', { activityId: ACTIVITY_ID });
}

async function doAssignment(cookie, prefix, body) {
  return callHomeApi(cookie, prefix, 'jjg_doInteractiveAssignment', body);
}

function isApiSuccess(response) {
  return response?.success === true || Number(response?.code) === 0;
}

function readAssignments(response) {
  const groups = Array.isArray(response?.data) ? response.data : [];
  return groups.flatMap((group) => Array.isArray(group.assignmentList) ? group.assignmentList : []);
}

function getProjectId(task, mainPage) {
  const mainTasks = mainPage?.data?.mainTaskDtoList || [];
  const matched = mainTasks.find((item) => item.assignmentId === task.encryptAssignmentId);
  return matched?.projectId || task.encryptProjectId || process.env.JD_HOME_GOLD_PROJECT_ID || '8HoEASbP7wrRmmLitaDHK1LJEWf';
}

function getTaskItems(task) {
  const ext = task?.ext || {};
  const lists = [
    ext.shoppingActivity,
    ext.followShop,
    ext.followChannel,
    ext.brandMemberList,
  ];
  return lists.find((list) => Array.isArray(list) && list.length) || [];
}

function pickTaskItem(task, blockedKeys = new Set()) {
  const items = getTaskItems(task);
  return items.find((item) => Number(item.status) !== 2 && !blockedKeys.has(getTaskItemKey(task, item)))
    || items.find((item) => !blockedKeys.has(getTaskItemKey(task, item)))
    || {};
}

function getTaskItemId(task, item = {}) {
  return item.itemId || item.shopId || item.venderId || task.itemId || '';
}

function getTaskUrl(task, item = {}) {
  return item.url || item.jumpUrl || item.linkUrl || task.url || '';
}

function getTaskWaitMs(task) {
  const waitSeconds = Number(task?.ext?.waitDuration || 0);
  return Math.max(waitSeconds * 1000, getDefaultWaitMs());
}

function isTaskDone(task) {
  const completionCnt = Number(task?.completionCnt || 0);
  const limit = Number(task?.assignmentTimesLimit || 0);
  return Boolean(task?.completionFlag) || (limit > 0 && completionCnt >= limit);
}

function getTaskKey(task) {
  return String(task?.encryptAssignmentId || task?.assignmentName || 'unknown');
}

function getTaskItemKey(task, item) {
  return `${getTaskKey(task)}::${getTaskItemId(task, item) || 'default'}`;
}

function formatRewards(task) {
  return (task?.rewards || [])
    .map((reward) => `${reward.rewardName || reward.prizeName || '奖励'}:${reward.quantity || reward.rewardValue || ''}`)
    .join(',');
}

function hasGoldReward(task) {
  return String(formatRewards(task)).includes('金币');
}

function summarizeTask(task) {
  const item = pickTaskItem(task);
  return [
    task.assignmentName || '未知任务',
    `id=${task.encryptAssignmentId || '-'}`,
    `type=${task.assignmentType ?? '-'}`,
    `cnt=${task.completionCnt || 0}/${task.assignmentTimesLimit || 0}`,
    `done=${Boolean(task.completionFlag)}`,
    `item=${getTaskItemId(task, item) || '-'}`,
    `reward=${formatRewards(task) || '-'}`,
  ].join(' | ');
}

function shouldRunTask(task) {
  if (!task?.encryptAssignmentId || isTaskDone(task) || !hasGoldReward(task)) {
    return false;
  }
  if (isSignTask(task) || isBrowseTask(task) || isHomeVisitTask(task)) {
    return true;
  }
  return isDoAllEnabled() && isSupportedDoAllTask(task);
}

function isSignTask(task) {
  return Number(task?.assignmentType) === 5 || String(task?.assignmentName || '').includes('签到');
}

function isBrowseTask(task) {
  return Number(task?.assignmentType) === 1 && Boolean(getTaskUrl(task, pickTaskItem(task)));
}

function isHomeVisitTask(task) {
  return Number(task?.assignmentType) === 0 || String(task?.assignmentName || '').includes('首页访问');
}

function isSupportedDoAllTask(task) {
  const type = Number(task?.assignmentType);
  return [3, 7].includes(type) && getTaskItems(task).length > 0;
}

function buildCommonAssignmentBody(task, mainPage, type, item = {}) {
  return {
    encryptAssignId: task.encryptAssignmentId,
    encryptAssignmentId: task.encryptAssignmentId,
    assignId: task.encryptAssignmentId,
    type,
    itemId: getTaskItemId(task, item) || undefined,
    encryptProjectId: getProjectId(task, mainPage),
    activityId: ACTIVITY_ID,
  };
}

async function runSignTask(cookie, prefix, task, mainPage) {
  const body = buildCommonAssignmentBody(task, mainPage, 13, { itemId: '1' });
  body.itemId = '1';
  const result = await doAssignment(cookie, prefix, body);
  $.log(`${prefix}: 签到结果 => ${formatRewardResult(result) || stringifyForLog(result, 800)}`);
  return result;
}

async function runHomeVisitTask(cookie, prefix, task, mainPage) {
  const result = await doAssignment(cookie, prefix, buildCommonAssignmentBody(task, mainPage, 11));
  $.log(`${prefix}: 首页访问结果 => ${formatRewardResult(result) || stringifyForLog(result, 800)}`);
  return result;
}

async function runBrowseTask(cookie, prefix, task, item, mainPage) {
  const taskUrl = getTaskUrl(task, item);
  const startBody = buildCommonAssignmentBody(task, mainPage, 4, item);
  startBody.actionType = 1;
  startBody.jumpUrl = taskUrl;
  startBody.ext = { jumpUrl: taskUrl };

  const startResult = await doAssignment(cookie, prefix, startBody);
  $.log(`${prefix}: 开始浏览结果 => ${formatRewardResult(startResult) || stringifyForLog(startResult, 800)}`);
  if (!isApiSuccess(startResult)) {
    return startResult;
  }

  await openTaskUrl(cookie, prefix, taskUrl);
  const waitMs = getTaskWaitMs(task);
  $.log(`${prefix}: 等待浏览完成 => ${waitMs}ms`);
  await sleep(waitMs);

  const finishBody = buildCommonAssignmentBody(task, mainPage, 4, item);
  finishBody.actionType = 0;
  const finishResult = await doAssignment(cookie, prefix, finishBody);
  $.log(`${prefix}: 完成浏览结果 => ${formatRewardResult(finishResult) || stringifyForLog(finishResult, 800)}`);
  return finishResult;
}

async function runDoAllTask(cookie, prefix, task, item, mainPage) {
  const type = Number(task?.ext?.outerTaskType || task.assignmentType);
  const result = await doAssignment(cookie, prefix, buildCommonAssignmentBody(task, mainPage, type, item));
  $.log(`${prefix}: 执行扩展任务结果 => ${formatRewardResult(result) || stringifyForLog(result, 800)}`);
  return result;
}

async function openTaskUrl(cookie, prefix, taskUrl) {
  if (!taskUrl) {
    return;
  }
  $.log(`${prefix}: 打开任务页 => ${taskUrl}`);
  const response = await got.get(taskUrl, {
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: USER_AGENT,
      contentType: undefined,
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  $.log(`${prefix}: 任务页响应 => HTTP ${response.statusCode}, finalUrl=${response.url || taskUrl}`);
}

function formatRewardResult(response) {
  const rewardsInfo = response?.data?.rewardsInfo || {};
  const rewards = [];
  for (const list of Object.values(rewardsInfo.successRewards || {})) {
    const items = Array.isArray(list) ? list : [list];
    for (const item of items) {
      if (Array.isArray(item?.quantityDetails)) {
        for (const detail of item.quantityDetails) {
          rewards.push(`${detail.rewardName || detail.prizeName || '奖励'}x${detail.quantity || 1}`);
        }
      } else if (item) {
        rewards.push(`${item.rewardName || item.prizeName || '奖励'}x${item.quantity || 1}`);
      }
    }
  }
  return rewards.join(',');
}

function logTaskList(prefix, tasks) {
  $.log(`${prefix}: 金币任务列表 => ${tasks.map(summarizeTask).join(' || ') || '空'}`);
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);

  let mainPage = await queryMainPage(cookie, prefix);
  $.log(`${prefix}: 金币余额 => available=${mainPage?.data?.availableScore ?? '-'}, total=${mainPage?.data?.totalScore ?? '-'}`);

  let taskResponse = await queryInteractiveInfo(cookie, prefix);
  let tasks = readAssignments(taskResponse);
  logTaskList(prefix, tasks);

  const blockedTasks = new Set();
  const blockedItems = new Set();
  let executedCount = 0;
  while (executedCount < getMaxTasks()) {
    const task = tasks.find((item) => shouldRunTask(item) && !blockedTasks.has(getTaskKey(item)));
    if (!task) {
      $.log(`${prefix}: 没有可继续执行的金币任务`);
      break;
    }

    const item = pickTaskItem(task, blockedItems);
    $.log(`${prefix}: 执行任务 => ${summarizeTask(task)}`);

    let result;
    if (isSignTask(task)) {
      result = await runSignTask(cookie, prefix, task, mainPage);
    } else if (isHomeVisitTask(task)) {
      result = await runHomeVisitTask(cookie, prefix, task, mainPage);
    } else if (isBrowseTask(task)) {
      if (!getTaskItemId(task, item)) {
        blockedTasks.add(getTaskKey(task));
        $.log(`${prefix}: 浏览任务缺少 itemId，跳过`);
        continue;
      }
      result = await runBrowseTask(cookie, prefix, task, item, mainPage);
    } else {
      result = await runDoAllTask(cookie, prefix, task, item, mainPage);
    }

    if (!isApiSuccess(result)) {
      const itemKey = getTaskItemKey(task, item);
      blockedItems.add(itemKey);
      $.log(`${prefix}: 任务未成功，跳过当前子项 => ${itemKey}`);
      if (!pickTaskItem(task, blockedItems)?.itemId) {
        blockedTasks.add(getTaskKey(task));
      }
      continue;
    }

    executedCount += 1;
    await sleep(1000);
    mainPage = await queryMainPage(cookie, prefix);
    taskResponse = await queryInteractiveInfo(cookie, prefix);
    tasks = readAssignments(taskResponse);
    $.log(`${prefix}: 刷新金币余额 => available=${mainPage?.data?.availableScore ?? '-'}, total=${mainPage?.data?.totalScore ?? '-'}`);
    logTaskList(prefix, tasks);
  }

  $.log(`${prefix}: 本轮执行金币任务数 => ${executedCount}`);
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
