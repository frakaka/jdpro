/*
cron:28 0 * * * jd_supermarket_wangbei_task.js
京东超市每日签到和活动任务领汪贝。

环境变量说明：
1. JD_SUPERMARKET_WANGBEI_DEBUG
   含义：是否打印更完整的接口 request/response。
   是否必须：否，值为 1 时开启。

2. JD_SUPERMARKET_WANGBEI_EID_TOKEN
   含义：可选的 x-api-eid-token。若接口触发风控，可从抓包提取后覆盖。
   是否必须：否，默认使用当前抓包中已验证值。

3. JD_SUPERMARKET_WANGBEI_MAX_TASKS / JD_SUPERMARKET_WANGBEI_WAIT_MS
   含义：单账号最多执行几个浏览任务、浏览等待兜底毫秒数。
   是否必须：否，默认最多执行 12 个任务，按任务 waitDuration 等待且不少于 5500ms。

4. JD_SUPERMARKET_WANGBEI_DO_ALL
   含义：是否尝试关注店铺、入会等非浏览任务。
   是否必须：否，默认只执行签到和浏览类汪贝任务。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getRequestUuid,
  getUserAgent,
  getUserName,
  parseCookieString,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东超市签到做任务领汪贝');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const APPID = 'jd-super-market';
const CLIENT = 'm';
const BIZ_CODE = 'cn_retail_jdsupermarket';
const SCENARIO = 'sign';
const MAIN_ACTIVITY_ID = '02082539';
const SIGN_ACTIVITY_ID = '01462716';
const PAGE_ID = '3vFqh3QAT1ukndZbhKYGYRZT7mZQ';
const PAGE_URL = `https://pro.m.jd.com/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?xview=1&babelChannel=ttt1`;
const ORIGIN = 'https://pro.m.jd.com';
const SIGN_H5ST_APP_ID = '35fa0';
const TASK_INFO_H5ST_APP_ID = '33c74';
const COMPLETE_TASK_H5ST_APP_ID = '51113';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM6AOSBKQIAAAAACS62JLMHB76KEYX';
const DEFAULT_MAX_TASKS = 12;
const DEFAULT_WAIT_MS = 5500;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_PAGE_USER_AGENT = 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778177573%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_SUPERMARKET_WANGBEI_DEBUG === '1';
}

function isDoAllEnabled() {
  return process.env.JD_SUPERMARKET_WANGBEI_DO_ALL === '1';
}

function getMaxTasks() {
  const value = Number(process.env.JD_SUPERMARKET_WANGBEI_MAX_TASKS || DEFAULT_MAX_TASKS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_TASKS;
}

function getWaitMs(task) {
  const waitDuration = Number(task?.ext?.waitDuration || 0) * 1000;
  const envWait = Number(process.env.JD_SUPERMARKET_WANGBEI_WAIT_MS || 0);
  const waitMs = Math.max(waitDuration, envWait, DEFAULT_WAIT_MS);
  return Number.isFinite(waitMs) ? waitMs : DEFAULT_WAIT_MS;
}

function getEidToken(cookie) {
  const cookieMap = parseCookieString(cookie);
  return process.env.JD_SUPERMARKET_WANGBEI_EID_TOKEN
    || cookieMap.get('3AB9D23F7A4B3CSS')
    || DEFAULT_EID_TOKEN;
}

function getPageUserAgent() {
  return String(process.env.JD_SUPERMARKET_WANGBEI_USER_AGENT || DEFAULT_PAGE_USER_AGENT).trim();
}

function sanitizeLog(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === 'Cookie' || key === 'cookie') {
      return '[masked]';
    }
    if (key === 'x-api-eid-token' && typeof item === 'string') {
      return `${item.slice(0, 18)}...`;
    }
    if (key === 'h5st' && typeof item === 'string') {
      return `${item.slice(0, 30)}...len=${item.length}`;
    }
    return item;
  }));
}

function stringifyForLog(value, maxLength = 1400) {
  return stringifySnippet(sanitizeLog(value), maxLength);
}

function logRequest(prefix, functionId, body, h5stAppId) {
  $.log(`${prefix}: request ${functionId} => ${stringifyForLog({
    endpoint: `https://api.m.jd.com/${functionId}`,
    appid: APPID,
    client: CLIENT,
    h5stAppId,
    body,
  }, isDebugEnabled() ? 5000 : 1400)}`);
}

function logResponse(prefix, functionId, meta) {
  $.log(`${prefix}: response ${functionId} => ${stringifyForLog({
    httpStatus: meta?.statusCode,
    response: meta?.data,
  }, isDebugEnabled() ? 7000 : 1800)}`);
}

function buildBaseBody(payload = {}) {
  return {
    bizCode: BIZ_CODE,
    scenario: SCENARIO,
    ...payload,
    babelChannel: payload.babelChannel || 'ttt1',
    isJdApp: '1',
    isWx: '0',
  };
}

async function requestSuperApi(cookie, prefix, functionId, body, h5stAppId) {
  logRequest(prefix, functionId, body, h5stAppId);
  const meta = await postFormApi(cookie, {
    endpoint: `https://api.m.jd.com/${functionId}`,
    functionId,
    appid: APPID,
    body,
    client: CLIENT,
    userAgent: getPageUserAgent() || getUserAgent(),
    origin: ORIGIN,
    referer: PAGE_REFERER,
    includeUuid: true,
    extraForm: {
      t: Date.now(),
      'x-api-eid-token': getEidToken(cookie),
    },
    extraHeaders: {
      bizcode: BIZ_CODE,
      scenario: SCENARIO,
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
    h5stAppId,
    h5stVersion: '5.3',
    includeMeta: true,
  });
  logResponse(prefix, functionId, meta);
  return meta.data;
}

async function querySignTab(cookie, prefix) {
  return requestSuperApi(
    cookie,
    prefix,
    'atop_channel_sign_tab',
    buildBaseBody({
      babelActivityId: SIGN_ACTIVITY_ID,
      source: '0',
    }),
    SIGN_H5ST_APP_ID,
  );
}

async function signIn(cookie, signToken, prefix) {
  return requestSuperApi(
    cookie,
    prefix,
    'atop_channel_sign_in',
    buildBaseBody({
      signToken,
      babelChannel: 'ttt9',
    }),
    SIGN_H5ST_APP_ID,
  );
}

async function queryTasks(cookie, prefix) {
  return requestSuperApi(
    cookie,
    prefix,
    'atop_channel_interactive_info',
    buildBaseBody({
      lat: Number(process.env.JD_SUPERMARKET_WANGBEI_LAT || 28.210319),
      lng: Number(process.env.JD_SUPERMARKET_WANGBEI_LNG || 113.03702),
      babelActivityId: MAIN_ACTIVITY_ID,
    }),
    TASK_INFO_H5ST_APP_ID,
  );
}

function buildCompleteBody(task, item, options = {}) {
  const body = buildBaseBody({
    babelActivityId: MAIN_ACTIVITY_ID,
    assignmentType: Number(task.assignmentType),
    encryptAssignmentId: task.encryptAssignmentId,
    babelChannel: 'ttt1',
  });

  if (options.actionType !== undefined) {
    body.actionType = options.actionType;
  }
  if (item?.itemId) {
    body.itemId = String(item.itemId);
  }
  return body;
}

async function completeTask(cookie, task, item, prefix, options = {}) {
  return requestSuperApi(
    cookie,
    prefix,
    'atop_channel_complete_task',
    buildCompleteBody(task, item, options),
    COMPLETE_TASK_H5ST_APP_ID,
  );
}

function getSignInfo(response) {
  return response?.data?.floorData?.items?.[0]?.signTabInfo || {};
}

function getTaskList(response) {
  const items = response?.data?.floorData?.items;
  return Array.isArray(items) ? items : [];
}

function getTaskItems(task) {
  const ext = task?.ext || {};
  const lists = [
    ext.shoppingActivity,
    ext.followShop,
    ext.brandMemberList,
  ];
  return lists.find((list) => Array.isArray(list) && list.length) || [];
}

function formatReward(task) {
  const rewards = Array.isArray(task?.rewards) ? task.rewards : task?.scoreRewardList || [];
  return rewards
    .map((reward) => `${reward.rewardName || reward.prizeName || '奖励'}:${reward.rewardValue || reward.quantity || ''}`)
    .join(',');
}

function summarizeTask(task) {
  return [
    task.encryptAssignmentId || '-',
    task.assignmentName || '未知任务',
    `type=${task.assignmentType}`,
    `status=${task.taskStatus}`,
    `cnt=${task.completionCnt || 0}/${task.assignmentTimesLimit || 0}`,
    `done=${Boolean(task.completionFlag)}`,
    `reward=${formatReward(task) || '-'}`,
  ].join(' | ');
}

function isTaskDone(task) {
  const completionCnt = Number(task?.completionCnt || 0);
  const assignmentTimesLimit = Number(task?.assignmentTimesLimit || 0);
  return Boolean(task?.completionFlag) || (assignmentTimesLimit > 0 && completionCnt >= assignmentTimesLimit);
}

function hasWangbeiReward(task) {
  return String(formatReward(task)).includes('汪贝');
}

function shouldRunTask(task) {
  if (!task?.encryptAssignmentId || isTaskDone(task) || !hasWangbeiReward(task)) {
    return false;
  }
  if (Number(task.assignmentType) === 1) {
    return getTaskItems(task).length > 0;
  }
  return isDoAllEnabled();
}

function getTaskKey(task) {
  return String(task?.encryptAssignmentId || task?.assignmentName || 'unknown');
}

function getTaskItemKey(task, item) {
  return `${getTaskKey(task)}::${item?.itemId || item?.title || 'default'}`;
}

function pickTaskItem(task, blockedItemKeys = new Set()) {
  const items = getTaskItems(task);
  return items.find((item) => Number(item.status) !== 2 && !blockedItemKeys.has(getTaskItemKey(task, item)))
    || items.find((item) => !blockedItemKeys.has(getTaskItemKey(task, item)))
    || {};
}

function formatRewardResult(response) {
  const rewards = response?.data?.doTaskRewardsInfo?.successRewards || {};
  const result = [];
  for (const list of Object.values(rewards)) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const reward of list) {
      result.push(`${reward.rewardName || reward.prizeName || '奖励'}x${reward.quantity || reward.rewardValue || 1}`);
    }
  }
  return result.join(',');
}

function isTrafficBusyCode(response) {
  return String(response?.code || '') === '14025';
}

async function visitTaskUrl(cookie, task, item, prefix) {
  if (!item?.url) {
    return;
  }
  $.log(`${prefix}: 浏览任务页 => ${task.assignmentName} / ${item.title || item.itemId || '-'} / ${item.url}`);
  const response = await got.get(item.url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: cookie,
      Referer: PAGE_REFERER,
      'User-Agent': getPageUserAgent() || getUserAgent(),
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    },
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  $.log(`${prefix}: 浏览任务页响应 => HTTP ${response.statusCode}, finalUrl=${response.url || item.url}`);
}

async function runSign(cookie, prefix) {
  const signTab = await querySignTab(cookie, prefix);
  const signInfo = getSignInfo(signTab);
  $.log(`${prefix}: 签到状态 => status=${signInfo.signStatus}, days=${signInfo.signDays}, restScore=${signInfo.restScore}, token=${signInfo.signToken || '-'}`);

  if (Number(signInfo.signStatus) === 1) {
    return;
  }
  if (!signInfo.signToken) {
    $.log(`${prefix}: 未获取到 signToken，跳过签到`);
    return;
  }

  const signResult = await signIn(cookie, signInfo.signToken, prefix);
  const rewards = (signResult?.data?.rewards || [])
    .map((reward) => reward.rewardDesc || `${reward.rewardValue || ''}汪贝`)
    .join(',');
  $.log(`${prefix}: 签到结果 => code=${signResult?.code}, success=${signResult?.success}, reward=${rewards || '-'}`);
}

async function runTasks(cookie, prefix) {
  let taskResponse = await queryTasks(cookie, prefix);
  let tasks = getTaskList(taskResponse);
  $.log(`${prefix}: 任务列表 => ${tasks.map(summarizeTask).join(' || ') || '空'}`);

  let executedCount = 0;
  const maxTasks = getMaxTasks();
  const blockedTaskKeys = new Set();
  const blockedItemKeys = new Set();
  while (executedCount < maxTasks) {
    const task = tasks.find((currentTask) => shouldRunTask(currentTask) && !blockedTaskKeys.has(getTaskKey(currentTask)));
    if (!task) {
      $.log(`${prefix}: 没有可继续执行的汪贝任务`);
      break;
    }

    const item = pickTaskItem(task, blockedItemKeys);
    if (Number(task.assignmentType) === 1 && !item?.itemId) {
      blockedTaskKeys.add(getTaskKey(task));
      $.log(`${prefix}: 任务缺少可执行子项，跳过 => ${summarizeTask(task)}`);
      continue;
    }
    $.log(`${prefix}: 执行任务 => ${summarizeTask(task)} | item=${item.itemId || '-'} ${item.title || ''}`);

    if (Number(task.assignmentType) === 1) {
      const startResult = await completeTask(cookie, task, item, prefix, { actionType: 1 });
      $.log(`${prefix}: 开始任务结果 => code=${startResult?.code}, msg=${startResult?.data?.msg || startResult?.msg || '-'}`);
      if (isTrafficBusyCode(startResult)) {
        const itemKey = getTaskItemKey(task, item);
        blockedItemKeys.add(itemKey);
        $.log(`${prefix}: 任务开始命中风控/繁忙，跳过当前子项 => ${itemKey}`);
        if (!pickTaskItem(task, blockedItemKeys)?.itemId) {
          blockedTaskKeys.add(getTaskKey(task));
          $.log(`${prefix}: 当前任务全部子项均不可执行，跳过任务 => ${task.assignmentName}`);
        }
        continue;
      }
      await visitTaskUrl(cookie, task, item, prefix);
      const waitMs = getWaitMs(task);
      $.log(`${prefix}: 等待浏览完成 => ${waitMs}ms`);
      await sleep(waitMs);
    }

    const finishResult = await completeTask(cookie, task, item, prefix);
    const rewardText = formatRewardResult(finishResult);
    $.log(`${prefix}: 完成任务结果 => code=${finishResult?.code}, msg=${finishResult?.data?.msg || finishResult?.msg || '-'}, reward=${rewardText || '-'}`);
    if (isTrafficBusyCode(finishResult)) {
      const itemKey = getTaskItemKey(task, item);
      blockedItemKeys.add(itemKey);
      $.log(`${prefix}: 任务完成命中风控/繁忙，跳过当前子项 => ${itemKey}`);
      if (!pickTaskItem(task, blockedItemKeys)?.itemId) {
        blockedTaskKeys.add(getTaskKey(task));
        $.log(`${prefix}: 当前任务全部子项均不可执行，跳过任务 => ${task.assignmentName}`);
      }
      continue;
    }
    executedCount += 1;

    await sleep(1200);
    taskResponse = await queryTasks(cookie, prefix);
    tasks = getTaskList(taskResponse);
    $.log(`${prefix}: 刷新任务列表 => ${tasks.map(summarizeTask).join(' || ') || '空'}`);
  }

  $.log(`${prefix}: 本轮执行任务数 => ${executedCount}`);
}

async function handleAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);
  await runSign(cookie, prefix);
  await runTasks(cookie, prefix);
  const finalSignTab = await querySignTab(cookie, prefix);
  const finalSignInfo = getSignInfo(finalSignTab);
  $.log(`${prefix}: 最终汪贝余额 => ${finalSignInfo.restScore || '-'}`);
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await handleAccount(cookies[index], index + 1);
    } catch (error) {
      const userName = getUserName(cookies[index]);
      $.log(`账号${index + 1} ${userName}: 执行异常 => ${error.stack || error.message}`);
    }
  }
}

main()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message}`);
  })
  .finally(() => {
    $.done();
  });
