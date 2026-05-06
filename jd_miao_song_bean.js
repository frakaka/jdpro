/*
cron:9 0 * * * jd_miao_song_bean.js

环境变量说明：
1. JD_MIAO_SONG_TASK_LIMIT
   含义：单次最多执行多少个京豆任务。
   是否必须：否，默认不限制。

2. JD_MIAO_SONG_BROWSE_WAIT_MS
   含义：任务页停留时长，单位毫秒。
   是否必须：否，默认 10000。

3. JD_MIAO_SONG_DEBUG
   含义：是否打印关键接口的 request/response。
   是否必须：否，值为 1 时开启。

4. JD_MIAO_SONG_LATITUDE / JD_MIAO_SONG_LONGITUDE / JD_MIAO_SONG_CHANNEL_ID
   含义：秒送签到接口定位与渠道参数。
   是否必须：否，默认使用抓包里的长沙/rn07。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_USER_AGENT,
  buildHeaders,
  getRequestUuid,
  getUserAgent,
  getUserName,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('秒送签到做任务领京豆');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const API_ENDPOINT = 'https://api.m.jd.com/api';
const PAGE_URL = 'https://laputa.jd.com/ltbdf232aa/pages/index/index?channelId=rn07';
const PAGE_ORIGIN = 'https://laputa.jd.com';
const APPID = 'laputa';
const CLIENT = 'wh5';
const CLIENT_VERSION = '1.0.0';
const OS_VERSION = '1.0.0';
const REQUEST_TIMEOUT_MS = 15000;
const CHANNEL_ID = process.env.JD_MIAO_SONG_CHANNEL_ID || 'rn07';
const USER_AGENT = getUserAgent(DEFAULT_USER_AGENT);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MIAO_SONG_DEBUG === '1';
}

function debugLog(accountLabel, title, value) {
  if (!isDebugEnabled()) {
    return;
  }
  console.log(`${accountLabel}: ${title} => ${stringifySnippet(value, 3000)}`);
}

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getLaputaUuid(cookie) {
  return getCookieValue(cookie, '__jda') || getRequestUuid(cookie);
}

function getBrowseWaitMs() {
  const raw = Number(process.env.JD_MIAO_SONG_BROWSE_WAIT_MS || 10000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10000;
}

function getTaskLimit() {
  const raw = process.env.JD_MIAO_SONG_TASK_LIMIT;
  if (!raw) {
    return Number.POSITIVE_INFINITY;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildLocationBody(extra = {}) {
  return {
    latitude: process.env.JD_MIAO_SONG_LATITUDE || '28.210319',
    longitude: process.env.JD_MIAO_SONG_LONGITUDE || '113.03702',
    provinceId: Number(process.env.JD_MIAO_SONG_PROVINCE_ID || 18),
    cityId: process.env.JD_MIAO_SONG_CITY_ID || '',
    countyId: process.env.JD_MIAO_SONG_COUNTY_ID || '',
    townId: process.env.JD_MIAO_SONG_TOWN_ID || '',
    addressId: process.env.JD_MIAO_SONG_ADDRESS_ID || '',
    jdAddressId: process.env.JD_MIAO_SONG_JD_ADDRESS_ID || '',
    addressDetail: process.env.JD_MIAO_SONG_ADDRESS_DETAIL || '万科·金域蓝湾二期-5号楼A座1802',
    fullAddress: process.env.JD_MIAO_SONG_FULL_ADDRESS || '湖南长沙市芙蓉区马王堆街道万科·金域蓝湾二期-5号楼A座1802',
    provinceName: process.env.JD_MIAO_SONG_PROVINCE_NAME || '',
    cityName: process.env.JD_MIAO_SONG_CITY_NAME || '长沙市',
    countyName: process.env.JD_MIAO_SONG_COUNTY_NAME || '芙蓉区',
    townName: process.env.JD_MIAO_SONG_TOWN_NAME || '',
    channelId: CHANNEL_ID,
    svcType: true,
    ...extra,
  };
}

function parseApiBody(response) {
  const parsed = safeJsonParse(response.body || '', null);
  if (parsed !== null) {
    return parsed;
  }
  return {
    code: `HTTP_${response.statusCode}`,
    msg: response.body || '',
  };
}

async function callLaputaApi(cookie, functionId, body, accountLabel, options = {}) {
  const form = new URLSearchParams();
  form.set('body', JSON.stringify(body || {}));
  form.set('appid', options.appid || APPID);
  form.set('functionId', functionId);
  form.set('client', CLIENT);
  form.set('clientVersion', CLIENT_VERSION);
  form.set('osVersion', OS_VERSION);
  form.set('uuid', getLaputaUuid(cookie));

  const url = `${API_ENDPOINT}?functionId=${encodeURIComponent(functionId)}`;
  debugLog(accountLabel, `请求 ${functionId}`, Object.fromEntries(form.entries()));

  const response = await got.post(url, {
    body: form.toString(),
    headers: buildHeaders(cookie, {
      origin: PAGE_ORIGIN,
      referer: PAGE_ORIGIN + '/',
      userAgent: USER_AGENT,
      contentType: 'application/x-www-form-urlencoded',
      extraHeaders: {
        Accept: '*/*',
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const parsed = parseApiBody(response);
  debugLog(accountLabel, `响应 ${functionId} HTTP ${response.statusCode}`, parsed);

  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}: ${stringifySnippet(parsed, 500)}`);
  }
  return parsed;
}

async function openPage(cookie, accountLabel, url = PAGE_URL) {
  const response = await got.get(url, {
    headers: buildHeaders(cookie, {
      origin: PAGE_ORIGIN,
      referer: PAGE_ORIGIN + '/',
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  debugLog(accountLabel, `打开页面 HTTP ${response.statusCode}`, url);
  return response.statusCode < 400;
}

async function queryFloorList(cookie, accountLabel) {
  return callLaputaApi(
    cookie,
    'jdh_laputa_queryFloorList3',
    {
      osName: 'ltbdf232aa',
      version: 1,
      functionId: 'index',
    },
    accountLabel,
  );
}

async function queryWelfareIndex(cookie, accountLabel) {
  return callLaputaApi(cookie, 'ds_api_ms_welfareCenterQueryIndex', buildLocationBody(), accountLabel);
}

async function queryCouponInfo(cookie, accountLabel) {
  return callLaputaApi(
    cookie,
    'ds_signIn_querySignInCouponInfo',
    buildLocationBody({ tipCouponKey: '' }),
    accountLabel,
  );
}

async function queryJingBean(cookie, accountLabel) {
  return callLaputaApi(cookie, 'ds_signIn_api_querySignInJingBean', buildLocationBody(), accountLabel);
}

async function signInGetRewards(cookie, accountLabel) {
  return callLaputaApi(cookie, 'ds_signIn_signInGetRewards', buildLocationBody(), accountLabel);
}

async function doInteractiveAssignment(cookie, task, item, accountLabel) {
  const body = {
    encryptAssignmentId: task.encryptAssignmentId,
    itemId: item.itemId,
    assignmentType: Number(task.assignmentType || 1),
    actionType: 1,
    waitDuration: Number(task.waitDuration || 0),
  };
  return callLaputaApi(cookie, 'ds_signIn_api_doInteractiveAssignment', body, accountLabel);
}

function isSuccessCode(response) {
  return response?.code === '0000' || response?.code === 0 || response?.success === true;
}

function getModuleData(indexResponse, businessId) {
  const modules = normalizeArray(indexResponse?.data?.modules);
  return modules.find((module) => Number(module?.businessId) === Number(businessId))?.data || {};
}

function getSignModule(indexResponse) {
  return getModuleData(indexResponse, 2026040101);
}

function hasSignModule(signModule) {
  return Boolean(
    signModule
      && typeof signModule.needSignIn === 'boolean',
  );
}

function getTaskList(indexResponse) {
  const taskModule = getModuleData(indexResponse, 2026040104);
  return normalizeArray(taskModule?.taskDetailResVOList);
}

function getRewardText(task) {
  return normalizeArray(task?.rewardVOList)
    .map((reward) => reward?.rewardDesc || reward?.rewardName || reward?.rewardValue || '')
    .filter(Boolean)
    .join(' | ');
}

function getTaskItem(task) {
  return normalizeArray(task?.taskExtVOList).find((item) => item?.itemId) || null;
}

function buildTaskSummary(task) {
  const item = getTaskItem(task);
  return [
    task?.assignmentName || '未知任务',
    `type=${task?.assignmentType ?? '-'}`,
    `itemId=${item?.itemId || '-'}`,
    `status=${item?.status ?? '-'}`,
    `completion=${task?.completionCnt ?? 0}/${task?.assignmentTimesLimit ?? 1}`,
    `done=${task?.completionFlag ? 1 : 0}`,
    `wait=${task?.waitDuration ?? 0}`,
    `reward=${getRewardText(task) || '-'}`,
  ].join(' | ');
}

function isExecutableTask(task) {
  if (!task?.encryptAssignmentId || Number(task.assignmentType) !== 1) {
    return false;
  }
  if (task.completionFlag || Number(task.completionCnt || 0) >= Number(task.assignmentTimesLimit || 1)) {
    return false;
  }
  const item = getTaskItem(task);
  return Boolean(item?.itemId);
}

function getWaitAfterTask(task) {
  const taskWaitMs = Number(task?.waitDuration || 0) * 1000;
  return Math.max(getBrowseWaitMs(), Number.isFinite(taskWaitMs) ? taskWaitMs : 0);
}

async function browseTaskPage(cookie, task, accountLabel) {
  const item = getTaskItem(task);
  const url = item?.url || '';
  if (!/^https?:\/\//i.test(url)) {
    console.log(`${accountLabel}: 任务无 H5 链接，跳过浏览 => ${task?.assignmentName || '未知任务'}`);
    return;
  }

  const response = await got.get(url, {
    headers: buildHeaders(cookie, {
      origin: PAGE_ORIGIN,
      referer: PAGE_URL,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });
  console.log(`${accountLabel}: 浏览任务页 => ${task.assignmentName} | HTTP ${response.statusCode} | ${url}`);
}

async function handleSignIn(cookie, accountLabel, indexResponse) {
  const signModule = getSignModule(indexResponse);
  if (!hasSignModule(signModule)) {
    console.log(`${accountLabel}: 未识别到签到模块，跳过签到`);
    return;
  }

  const beforeBean = await queryJingBean(cookie, accountLabel);
  const beforeBeanNum = Number(beforeBean?.data?.beanNum || 0);

  console.log(
    `${accountLabel}: 初始签到状态 => needSignIn=${signModule?.needSignIn}, signInNum=${signModule?.signInPeriodDetailResVO?.signInNum ?? '-'}, beanNum=${beforeBeanNum || '-'}`,
  );

  if (signModule?.needSignIn === false) {
    console.log(`${accountLabel}: 今日已签到，跳过签到动作`);
    return;
  }

  await queryCouponInfo(cookie, accountLabel);
  const signResult = await signInGetRewards(cookie, accountLabel);
  const rewardText = signResult?.data?.rewardText || signResult?.msg || stringifySnippet(signResult, 300);
  console.log(`${accountLabel}: 签到结果 => ${rewardText}`);

  const afterBean = await queryJingBean(cookie, accountLabel);
  const afterBeanNum = Number(afterBean?.data?.beanNum || 0);
  if (afterBeanNum || beforeBeanNum) {
    console.log(`${accountLabel}: 京豆余额 => ${beforeBeanNum || '-'} -> ${afterBeanNum || '-'}`);
  }
}

async function refreshTaskList(cookie, accountLabel) {
  const indexResponse = await queryWelfareIndex(cookie, accountLabel);
  const taskList = getTaskList(indexResponse);
  console.log(`${accountLabel}: 拉取任务列表 => ${taskList.length} 个`);
  if (taskList.length) {
    console.log(`${accountLabel}: 任务列表 => ${taskList.map(buildTaskSummary).join(' || ')}`);
  }
  return taskList;
}

async function handleTasks(cookie, accountLabel) {
  let taskList = await refreshTaskList(cookie, accountLabel);
  let completedCount = 0;
  const taskLimit = getTaskLimit();
  const handledTaskIds = new Set();

  while (completedCount < taskLimit) {
    const task = taskList.find((item) => {
      const taskKey = `${item?.encryptAssignmentId || ''}:${getTaskItem(item)?.itemId || ''}`;
      return isExecutableTask(item) && !handledTaskIds.has(taskKey);
    });

    if (!task) {
      break;
    }

    const item = getTaskItem(task);
    const taskKey = `${task.encryptAssignmentId}:${item.itemId}`;
    handledTaskIds.add(taskKey);

    console.log(`${accountLabel}: 开始任务 => ${buildTaskSummary(task)}`);
    try {
      await browseTaskPage(cookie, task, accountLabel);
      await sleep(getWaitAfterTask(task));

      const result = await doInteractiveAssignment(cookie, task, item, accountLabel);
      console.log(`${accountLabel}: 任务上报结果 => ${stringifySnippet(result, 800)}`);
      if (isSuccessCode(result) && Number(result?.data?.status || 0) === 1) {
        completedCount += 1;
      }
    } catch (error) {
      console.log(`${accountLabel}: 任务执行失败 => ${error.message}`);
    }

    taskList = await refreshTaskList(cookie, accountLabel);
    await sleep(1000);
  }

  console.log(`${accountLabel}: 本次完成任务数 => ${completedCount}`);
}

async function handleAccount(cookie, index) {
  const accountLabel = `账号${index + 1} ${getUserName(cookie)}`;

  console.log(`\n==== ${accountLabel} ====`);
  await openPage(cookie, accountLabel);
  await queryFloorList(cookie, accountLabel);

  const indexResponse = await queryWelfareIndex(cookie, accountLabel);
  if (!isSuccessCode(indexResponse)) {
    console.log(`${accountLabel}: 首页模块获取失败 => ${stringifySnippet(indexResponse, 800)}`);
    return;
  }

  await handleSignIn(cookie, accountLabel, indexResponse);
  await handleTasks(cookie, accountLabel);
}

(async () => {
  if (!cookies.length) {
    console.log('未找到有效的 JD Cookie');
    return;
  }

  console.log(`共${cookies.length}个京东账号Cookie`);
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await handleAccount(cookies[index], index);
    } catch (error) {
      console.log(`账号${index + 1} 执行异常 => ${error.message}`);
    }
  }
})()
  .catch((error) => {
    console.log(`脚本执行异常 => ${error.message}`);
  })
  .finally(() => {
    $.done();
  });
