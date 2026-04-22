/*
cron:22 0 * * * jd_jdh_scratch_card_bean.js

环境变量说明：
1. JD_SCRATCH_CARD_EID_TOKEN
   含义：可选的 x-api-eid-token，买药页任务上报遇到风控时可从抓包提取后覆盖。
   是否必须：否。

2. JD_SCRATCH_CARD_MAX_TASKS
   含义：最多执行几个健康抽奖/买药页京豆任务。
   是否必须：否，默认 3。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const {
  DEFAULT_JR_USER_AGENT,
  Env,
  getGiasRiskContext,
  getUserName,
  hasJingBeanReward,
  mergeCookieString,
  postFormApi,
  stringifySnippet,
} = require('./function/jd_har_bean_common');

const $ = new Env('买药页健康抽奖领京豆');

const APPID = 'laputa';
const H5ST_APP_ID = '70777';
const CLIENT = 'wh5';
const API_REFERER = 'https://laputa.jd.com/';
const RISK_PAGE_URL = 'https://laputa.jd.com/lt32f7f7f0/pages/index/index?entry=bjpd';
const FLOOR_BODY = {
  osName: 'lt32f7f7f0',
  version: 2,
  functionId: 'index',
};
const DEFAULT_MAX_TASKS = 3;

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getMaxTasks() {
  return Number(process.env.JD_SCRATCH_CARD_MAX_TASKS || DEFAULT_MAX_TASKS);
}

function createExtraForm(includeRiskToken) {
  return includeRiskToken
    ? { 'x-api-eid-token': process.env.JD_SCRATCH_CARD_EID_TOKEN || '' }
    : {};
}

async function callScratchApi(cookie, functionId, body, options = {}) {
  return postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/api',
    functionId,
    appid: APPID,
    body,
    client: CLIENT,
    h5stAppId: H5ST_APP_ID,
    h5stMode: 'js_security',
    h5stVersion: '5.3',
    h5stPageUrl: RISK_PAGE_URL,
    h5stSignKeys: ['functionId', 'appid', 'client', 'body'],
    userAgent: DEFAULT_JR_USER_AGENT,
    origin: 'https://laputa.jd.com',
    referer: API_REFERER,
    includeUuid: true,
    extraHeaders: {
      Accept: '*/*',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    },
    extraForm: createExtraForm(options.includeRiskToken),
  });
}

function readSdToken(headers) {
  const tokenHeader = headers?.['x-rp-sdtoken'] || '';
  const parts = String(tokenHeader).split(';');
  return parts.length >= 3 ? parts.slice(2).join(';') : '';
}

async function warmupRiskCookie(cookie) {
  const riskContext = await getGiasRiskContext(cookie, {
    pageUrl: RISK_PAGE_URL,
    bizId: 'laputa',
    userAgent: DEFAULT_JR_USER_AGENT,
  });

  const warmupResult = await postFormApi(riskContext.cookie, {
    endpoint: 'https://api.m.jd.com/api',
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

  const sdToken = readSdToken(warmupResult.headers);
  return {
    cookie: mergeCookieString(riskContext.cookie, {
      sdtoken: sdToken,
    }),
    warmupResult,
    sdToken,
  };
}

async function queryActivityList(cookie) {
  return callScratchApi(cookie, 'mb2capp_scratchCard_getActivityList', {});
}

async function completeTask(cookie, task) {
  return callScratchApi(
    cookie,
    'mb2capp_scratchCard_doCompleteTask',
    {
      assignmentType: Number(task.assignmentType),
      actionType: 0,
      encryptAssignmentId: task.encryptAssignmentId,
    },
    { includeRiskToken: true },
  );
}

function readBeanTasks(activityData) {
  const tasks = activityData?.data?.assignmentList || [];
  return tasks
    .filter((task) => task.encryptAssignmentId)
    .filter((task) => task.completionFlag !== true)
    .filter((task) => Number(task.timeStatus || 1) === 1)
    .filter((task) => hasJingBeanReward(task))
    .slice(0, getMaxTasks());
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const riskCookie = await warmupRiskCookie(cookie);
  $.log(`账号${index} ${userName}: 风控预热 => HTTP ${riskCookie.warmupResult.statusCode}${riskCookie.sdToken ? '，已获取 sdtoken' : '，未获取 sdtoken'}`);

  const activityData = await queryActivityList(riskCookie.cookie);
  const tasks = readBeanTasks(activityData);
  $.log(`账号${index} ${userName}: 识别到 ${tasks.length} 个买药页京豆任务`);

  if (!tasks.length) {
    $.log(`账号${index} ${userName}: 活动列表片段 => ${stringifySnippet(activityData)}`);
    return;
  }

  for (const task of tasks) {
    $.log(`账号${index} ${userName}: 执行任务 ${task.assignmentName || task.encryptAssignmentId}`);
    const result = await completeTask(riskCookie.cookie, task);
    $.log(`账号${index} ${userName}: 任务结果 => ${stringifySnippet(result, 800)}`);
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
