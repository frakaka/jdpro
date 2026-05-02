/*
cron:22 0 * * * jdHealth_scratch_card_bean.js

20260502: 最新的健康页面没有签到领京豆了

环境变量说明：
1. JD_SCRATCH_CARD_EID_TOKEN
   含义：可选的 x-api-eid-token，未配置时优先使用 gias 动态生成的 jsToken。
   是否必须：否。

2. JD_SCRATCH_CARD_MAX_TASKS
   含义：每个账号最多尝试执行的京豆任务数。
   是否必须：否，默认 3。

3. JD_SCRATCH_CARD_ACTIVITY_ID / JD_SCRATCH_CARD_APP_KEY / JD_SCRATCH_CARD_CHANNEL / JD_SCRATCH_CARD_DO_TASK_H5ST_APP_ID
   含义：当前任务楼层使用的活动参数，默认按 2026-05-02 当前页面实测值填写。
   是否必须：否，活动切换后可覆盖。

4. JD_SCRATCH_CARD_DEBUG
   含义：是否打印关键接口原始返回片段，便于排查任务页改版。
   是否必须：否，值为 1 时开启。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  DEFAULT_JR_USER_AGENT,
  Env,
  createH5st,
  getGiasRiskContext,
  getRequestUuid,
  getUserName,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('买药页健康抽奖领京豆');

const API_URL = 'https://api.m.jd.com/api';
const PAGE_URL = 'https://laputa.jd.com/lt32f7f7f0/pages/index/index?entry=bjpd';
const API_REFERER = 'https://laputa.jd.com/';
const APPID = 'laputa';
const CLIENT = 'wh5';
const CLIENT_VERSION = '1.0.0';
const TASK_LIST_APP_ID = 'JDHAPP';
const DO_TASK_APP_ID = 'JDHAPP';
const AWARD_APP_ID = 'JDHAPP';
const DEFAULT_ACTIVITY_ID = '34703';
const DEFAULT_APP_KEY = '250141600001';
const DEFAULT_CHANNEL = 'jdhapp';
const DEFAULT_DO_TASK_H5ST_APP_ID = '32438';
const FLOOR_BODY = {
  osName: 'lt32f7f7f0',
  version: 2,
  functionId: 'index',
};
const DEFAULT_MAX_TASKS = 3;
const REQUEST_TIMEOUT_MS = 15000;
const TASK_STATUS = {
  TODO: 1,
  CAN_REWARD: 3,
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_SCRATCH_CARD_DEBUG === '1';
}

function getMaxTasks() {
  const value = Number.parseInt(process.env.JD_SCRATCH_CARD_MAX_TASKS || String(DEFAULT_MAX_TASKS), 10);
  if (Number.isNaN(value) || value < 0) {
    return DEFAULT_MAX_TASKS;
  }
  return value;
}

function getActivityId() {
  return process.env.JD_SCRATCH_CARD_ACTIVITY_ID || DEFAULT_ACTIVITY_ID;
}

function getAppKey() {
  return process.env.JD_SCRATCH_CARD_APP_KEY || DEFAULT_APP_KEY;
}

function getChannel() {
  return process.env.JD_SCRATCH_CARD_CHANNEL || DEFAULT_CHANNEL;
}

function getDoTaskH5stAppId() {
  return process.env.JD_SCRATCH_CARD_DO_TASK_H5ST_APP_ID || DEFAULT_DO_TASK_H5ST_APP_ID;
}

function appendFormValue(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.set(key, String(value));
  }
}

function safeJsonParse(content, fallback = null) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function createApiHeaders(cookie) {
  return {
    Accept: '*/*',
    Cookie: cookie,
    Origin: 'https://laputa.jd.com',
    Referer: PAGE_URL,
    'User-Agent': DEFAULT_JR_USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-rp-client': 'h5_1.0.0',
    'x-referer-page': PAGE_URL,
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };
}

function createScratchExtraHeaders(riskContext) {
  const headers = {
    Accept: '*/*',
    'x-rp-client': 'h5_1.0.0',
    'x-referer-page': PAGE_URL,
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };

  if (riskContext?.jsToken) {
    headers['x-api-eid-token'] = riskContext.jsToken;
  }

  return headers;
}

function readFloorWarmupStatus(response) {
  const statusCode = response?.statusCode || 0;
  const floorList = Array.isArray(response?.data?.cf?.floorTransferDTOS)
    ? response.data.cf.floorTransferDTOS
    : Array.isArray(response?.data?.data?.cf?.floorTransferDTOS)
      ? response.data.data.cf.floorTransferDTOS
      : [];
  const taskFloor = floorList.find((floor) => floor.floorLabelCode === 'taskList') || null;

  if (!taskFloor?.dataSource) {
    return {
      statusCode,
      taskFloorConfig: null,
    };
  }

  const taskFloorData = safeJsonParse(taskFloor.dataSource, {});
  return {
    statusCode,
    taskFloorConfig: taskFloorData?.base || null,
  };
}

async function loadTaskPageContext(cookie) {
  const riskContext = await getGiasRiskContext(cookie, {
    pageUrl: PAGE_URL,
    bizId: 'laputa',
    userAgent: DEFAULT_JR_USER_AGENT,
  });

  const floorResult = await postFormApi(riskContext.cookie, {
    endpoint: API_URL,
    functionId: 'jdh_laputa_queryFloorList3',
    appid: APPID,
    body: FLOOR_BODY,
    client: CLIENT,
    userAgent: DEFAULT_JR_USER_AGENT,
    origin: 'https://laputa.jd.com',
    referer: API_REFERER,
    includeUuid: true,
    includeMeta: true,
    extraHeaders: {
      Accept: '*/*',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    },
  });

  const floorStatus = readFloorWarmupStatus(floorResult);
  return {
    cookie: riskContext.cookie,
    jsToken: process.env.JD_SCRATCH_CARD_EID_TOKEN || riskContext.jsToken || '',
    floorStatus,
    riskError: riskContext.error || null,
  };
}

async function loadActivityRiskContext(cookie) {
  const riskContext = await getGiasRiskContext(cookie, {
    pageUrl: PAGE_URL,
    bizId: 'laputa',
    userAgent: DEFAULT_JR_USER_AGENT,
  });

  return {
    cookie: riskContext.cookie,
    jsToken: process.env.JD_SCRATCH_CARD_EID_TOKEN || riskContext.jsToken || '',
    riskError: riskContext.error || null,
  };
}

async function postApi(cookie, options) {
  const {
    functionId,
    appid,
    body,
    riskContext,
    h5stAppId = '',
  } = options;
  const requestCookie = riskContext?.cookie || cookie;
  const bodyText = JSON.stringify(body || {});
  const form = new URLSearchParams();

  appendFormValue(form, 'body', bodyText);
  appendFormValue(form, 'appid', appid);
  appendFormValue(form, 'functionId', functionId);
  appendFormValue(form, 'client', CLIENT);
  appendFormValue(form, 'clientVersion', CLIENT_VERSION);
  appendFormValue(form, 'uuid', getRequestUuid(requestCookie));
  appendFormValue(form, 'pageUrl', PAGE_URL);

  if (riskContext?.jsToken) {
    appendFormValue(form, 'x-api-eid-token', riskContext.jsToken);
  }

  if (h5stAppId) {
    const h5st = await createH5st({
      functionId,
      body,
      h5stAppId,
      requestAppid: appid,
      cookie: requestCookie,
      userAgent: DEFAULT_JR_USER_AGENT,
      client: CLIENT,
      clientVersion: CLIENT_VERSION,
      version: '5.3',
    });
    appendFormValue(form, 'h5st', h5st);
  }

  const response = await got.post(`${API_URL}?functionId=${encodeURIComponent(functionId)}`, {
    body: form.toString(),
    headers: createApiHeaders(requestCookie),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return safeJsonParse(response.body.trim(), response.body.trim());
}

async function queryTaskList(cookie, riskContext) {
  return postApi(cookie, {
    functionId: 'jdh_bff_queryTaskList',
    appid: TASK_LIST_APP_ID,
    riskContext,
    body: {
      activityId: getActivityId(),
      appKey: getAppKey(),
      channel: getChannel(),
      platform: 3,
    },
  });
}

async function queryActivityPage(cookie, riskContext) {
  return postFormApi(riskContext?.cookie || cookie, {
    endpoint: API_URL,
    functionId: 'mb2capp_scratchCard_getActivityList',
    appid: APPID,
    body: {},
    client: CLIENT,
    userAgent: DEFAULT_JR_USER_AGENT,
    origin: 'https://laputa.jd.com',
    referer: API_REFERER,
    includeUuid: true,
    includeMeta: true,
    extraHeaders: createScratchExtraHeaders(riskContext),
  });
}

async function doScratchSign(cookie, riskContext, task) {
  return postFormApi(riskContext?.cookie || cookie, {
    endpoint: API_URL,
    functionId: 'mb2capp_scratchCard_doCompleteTask',
    appid: APPID,
    body: {
      assignmentType: Number(task?.assignmentType || 0),
      actionType: 0,
      itemId: task?.itemId || '',
      encryptAssignmentId: task?.encryptAssignmentId || '',
    },
    client: CLIENT,
    userAgent: DEFAULT_JR_USER_AGENT,
    origin: 'https://laputa.jd.com',
    referer: API_REFERER,
    includeUuid: true,
    includeMeta: true,
    extraHeaders: createScratchExtraHeaders(riskContext),
  });
}

async function doTask(cookie, riskContext, task) {
  return postApi(cookie, {
    functionId: 'jdh_msoa_doTaskGw',
    appid: DO_TASK_APP_ID,
    riskContext,
    h5stAppId: getDoTaskH5stAppId(),
    body: {
      encodeId: task.encodeId,
      taskId: task.id,
      appKey: task.appKey || getAppKey(),
      channel: task.channel || getChannel(),
      infoId: task.infoId || new Date().toISOString(),
      platform: 3,
    },
  });
}

async function claimReward(cookie, riskContext, task) {
  const extParam = Number(task.taskType) === 309
    ? {
      stage: task.stage || 0,
      taskCompleteNum: task.taskCompleteNum || 0,
    }
    : {};

  return postApi(cookie, {
    functionId: 'jdh_msoa_sendAwardGw',
    appid: AWARD_APP_ID,
    riskContext,
    body: {
      queryToken: task.queryToken,
      appKey: task.appKey || getAppKey(),
      channel: task.channel || getChannel(),
      activityId: task.activityId || Number(getActivityId()),
      taskId: task.id,
      infoId: task.infoId || '',
      extParam,
      platform: 3,
    },
  });
}

function extractTaskGroups(response) {
  if (Array.isArray(response?.result)) {
    return response.result;
  }
  if (Array.isArray(response?.data?.result)) {
    return response.data.result;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  return [];
}

function flattenTasks(response) {
  const groups = extractTaskGroups(response);
  const tasks = [];

  for (const group of groups) {
    const taskVoList = Array.isArray(group?.taskVoList) ? group.taskVoList : [];
    for (const task of taskVoList) {
      if (task && typeof task === 'object') {
        tasks.push(task);
      }
    }
  }

  return tasks;
}

function formatTask(task) {
  const reward = Array.isArray(task.prizeInfoList)
    ? task.prizeInfoList.map((item) => item.moneyStr || item.money || item.prizeName).filter(Boolean).join('/')
    : '';
  const title = task.mainTitle || task.title || task.assignmentName || '未命名任务';
  return `${task.id || '-'} ${title} status=${task.status} type=${task.taskType}${reward ? ` reward=${reward}` : ''}`;
}

function extractMessage(response) {
  if (typeof response === 'string') {
    return response;
  }

  const candidates = [
    response?.result?.result,
    response?.result?.data,
    response?.data,
    response?.result,
    response,
  ];
  const candidateKeys = ['msg', 'message', 'echo', 'errMsg'];

  for (const item of candidates) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    for (const key of candidateKeys) {
      const value = item[key];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
  }

  return stringifySnippet(response, 300);
}

function isQuerySuccess(response) {
  return Number(response?.code) === 0 && Array.isArray(response?.result);
}

function isActivityPageSuccess(response) {
  return String(response?.data?.code || '') === '0000' && response?.data?.data && typeof response.data.data === 'object';
}

function isScratchSignSuccess(response) {
  return String(response?.data?.code || '') === '0000';
}

function isRewardSuccess(response) {
  return Number(response?.code) === 0 && Number(response?.result?.code) === 0;
}

function isDoTaskSuccess(response) {
  const code = Number(response?.code);
  const resultCode = Number(response?.result?.code);
  const innerResult = response?.result?.result;
  const bizCode = Number(
    response?.data?.bizCode
      ?? response?.result?.bizCode
      ?? innerResult?.bizCode
  );

  if (code !== 0) {
    return false;
  }
  if (innerResult && typeof innerResult === 'object' && !Number.isNaN(bizCode)) {
    return bizCode === 0 || bizCode === 2;
  }
  if (!Number.isNaN(resultCode)) {
    return resultCode === 0;
  }
  if (!Number.isNaN(bizCode)) {
    return bizCode === 0 || bizCode === 2;
  }
  return false;
}

function hasBeanPrize(task) {
  const prizeList = Array.isArray(task?.prizeInfoList) ? task.prizeInfoList : [];
  return prizeList.some((item) => {
    const prizeType = Number(item?.prizeType);
    const rewardName = String(item?.prizeName || item?.moneyStr || '');
    return prizeType === 2 || rewardName.includes('京豆') || Number(item?.money || 0) > 0;
  });
}

function isShareTask(task) {
  const title = `${task?.mainTitle || ''}${task?.title || ''}`;
  return /分享|邀请|助力/.test(title) || Number(task?.taskType) === 25;
}

function extractActivityAssignments(response) {
  const list = response?.data?.data?.assignmentList;
  return Array.isArray(list) ? list : [];
}

function findSignTask(response) {
  return extractActivityAssignments(response).find((task) => Number(task?.assignmentType) === 5 || task?.signDetail) || null;
}

function formatSignTask(task) {
  if (!task) {
    return '无签到任务';
  }

  const signDetail = task.signDetail || {};
  const continueSignDay = Number(signDetail.continueSignDay || 0);
  const totalDays = Number(signDetail.signDays || 0);
  const status = Number(signDetail.status || 0);
  return `${task.assignmentName || '签到'} status=${status} completion=${Boolean(task.completionFlag)} 连签=${continueSignDay}/${totalDays || '-'}`;
}

function formatPrizeDetailList(prizeList) {
  if (!Array.isArray(prizeList) || !prizeList.length) {
    return '';
  }

  const text = prizeList
    .map((item) => {
      const rewardName = item?.rewardName || item?.name || '';
      const rewardValue = item?.rewardValue || item?.value || '';
      return rewardName && rewardValue ? `${rewardName}${rewardValue}` : rewardName || String(rewardValue || '');
    })
    .filter(Boolean)
    .join(' / ');

  return text;
}

function canAutoDoTask(task) {
  if (!task || Number(task.status) !== TASK_STATUS.TODO) {
    return false;
  }
  if (!task.encodeId || isShareTask(task)) {
    return false;
  }
  return hasBeanPrize(task);
}

function collectBeanTasks(tasks) {
  return tasks.filter((task) => hasBeanPrize(task)).slice(0, getMaxTasks());
}

function collectClaimableTasks(tasks) {
  return tasks.filter((task) => Number(task.status) === TASK_STATUS.CAN_REWARD && hasBeanPrize(task));
}

async function claimTasks(cookie, riskContext, tasks, prefix) {
  const lines = [];
  const claimableTasks = collectClaimableTasks(tasks);

  for (const task of claimableTasks) {
    const response = await claimReward(cookie, riskContext, task);
    if (isDebugEnabled()) {
      $.log(`${prefix}: 领奖原始返回 ${task.id} => ${stringifySnippet(response)}`);
    }

    const title = task.mainTitle || task.title || task.id;
    if (isRewardSuccess(response)) {
      const prize = response?.result?.result?.prizeInfovos?.[0]?.money || '';
      lines.push(`${prefix}: ${title} 领奖成功${prize ? `，领取 ${prize} 京豆` : ''}`);
    } else {
      lines.push(`${prefix}: ${title} 领奖失败，${extractMessage(response)}`);
    }

    await sleep(800);
  }

  return lines;
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const lines = [];

  $.log(`\n==== ${prefix} ====`);

  const activityContext = await loadActivityRiskContext(cookie);
  if (activityContext.riskError) {
    $.log(`${prefix}: 活动页 gias 动态 token 获取失败，降级使用 Cookie token：${activityContext.riskError.message}`);
  }

  const activityResponse = await queryActivityPage(cookie, activityContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 活动页原始返回 => ${stringifySnippet(activityResponse, 2000)}`);
  }

  if (isActivityPageSuccess(activityResponse)) {
    const signTask = findSignTask(activityResponse);
    if (signTask) {
      $.log(`${prefix}: 识别到签到任务 => ${formatSignTask(signTask)}`);
      if (signTask.completionFlag) {
        lines.push(`${prefix}: 今日签到已完成`);
      } else {
        const signResponse = await doScratchSign(cookie, activityContext, signTask);
        if (isDebugEnabled()) {
          $.log(`${prefix}: 签到原始返回 => ${stringifySnippet(signResponse, 1200)}`);
        }

        if (isScratchSignSuccess(signResponse)) {
          const signData = signResponse?.data?.data || {};
          const rewardText = formatPrizeDetailList(signData.prizeDetailList);
          const failText = signData.signInTaskRewardFailText || '';
          lines.push(`${prefix}: 签到成功${rewardText ? `，奖励 ${rewardText}` : ''}${failText ? `，${failText}` : ''}`);
        } else {
          lines.push(`${prefix}: 签到失败，${extractMessage(signResponse)}`);
        }

        await sleep(800);
      }
    } else {
      $.log(`${prefix}: 活动页未返回签到任务`);
    }
  } else {
    $.log(`${prefix}: 查询活动页失败 => ${extractMessage(activityResponse)}`);
  }

  const pageContext = await loadTaskPageContext(cookie);
  $.log(`${prefix}: 页面预热 => HTTP ${pageContext.floorStatus.statusCode}${pageContext.floorStatus.taskFloorConfig ? '，已识别 taskList 楼层' : '，未识别 taskList 楼层'}`);
  if (pageContext.riskError) {
    $.log(`${prefix}: gias 动态 token 获取失败，降级使用 Cookie token：${pageContext.riskError.message}`);
  }

  if (pageContext.floorStatus.taskFloorConfig) {
    const taskConfig = pageContext.floorStatus.taskFloorConfig;
    $.log(`${prefix}: 当前任务配置 => businessType=${taskConfig.taskBusinessType || '-'} specialTask=${taskConfig.specialTask || '-'} immediate=${taskConfig.immediatelyUploadTask || '-'}`);
  }

  const firstResponse = await queryTaskList(cookie, pageContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: jdh_bff_queryTaskList 原始返回 => ${stringifySnippet(firstResponse, 2000)}`);
  }

  if (!isQuerySuccess(firstResponse)) {
    $.log(`${prefix}: 查询任务失败 => ${extractMessage(firstResponse)}`);
    return;
  }

  const firstTasks = flattenTasks(firstResponse);
  const beanTasks = collectBeanTasks(firstTasks);
  $.log(`${prefix}: 识别到 ${beanTasks.length} 个买药页京豆任务`);

  if (!beanTasks.length) {
    $.log(`${prefix}: 任务列表片段 => ${stringifySnippet(firstResponse, 1200)}`);
    return;
  }

  $.log(`${prefix}: 京豆任务 => ${beanTasks.map(formatTask).join(' | ')}`);

  const firstClaimLines = await claimTasks(cookie, pageContext, beanTasks, prefix);
  lines.push(...firstClaimLines);

  const pendingTasks = beanTasks.filter(canAutoDoTask);
  if (!pendingTasks.length) {
    lines.push(`${prefix}: 未找到可自动上报的京豆任务`);
  } else {
    for (const task of pendingTasks) {
      const response = await doTask(cookie, pageContext, task);
      if (isDebugEnabled()) {
        $.log(`${prefix}: 做任务原始返回 ${task.id} => ${stringifySnippet(response, 1200)}`);
      }

      const title = task.mainTitle || task.title || task.id;
      if (isDoTaskSuccess(response)) {
        lines.push(`${prefix}: ${title} 完成成功`);
      } else {
        lines.push(`${prefix}: ${title} 完成失败，${extractMessage(response)}`);
      }

      await sleep(1000);
    }
  }

  const refreshResponse = await queryTaskList(cookie, pageContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 刷新任务原始返回 => ${stringifySnippet(refreshResponse, 2000)}`);
  }

  if (!isQuerySuccess(refreshResponse)) {
    $.log(`${prefix}: 刷新任务失败 => ${extractMessage(refreshResponse)}`);
  } else {
    const refreshTasks = collectBeanTasks(flattenTasks(refreshResponse));
    const rewardLines = await claimTasks(cookie, pageContext, refreshTasks, prefix);
    lines.push(...rewardLines);
  }

  for (const line of lines) {
    $.log(line);
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
