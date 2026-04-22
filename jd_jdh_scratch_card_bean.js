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
  getUserName,
  hasJingBeanReward,
  postFormApi,
  stringifySnippet,
} = require('./function/jd_har_bean_common');

const $ = new Env('买药页健康抽奖领京豆');

const APPID = 'laputa';
const H5ST_APP_ID = '70777';
const CLIENT = 'wh5';
const PAGE_URL = 'https://laputa.jd.com/onlineDoctorWel/pages/index/index?apicode=Hospital&hy_entry=hos_zxys';
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
    h5stVersion: '5.3',
    userAgent: DEFAULT_JR_USER_AGENT,
    origin: 'https://laputa.jd.com',
    referer: PAGE_URL,
    includeUuid: true,
    extraForm: createExtraForm(options.includeRiskToken),
  });
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

  const activityData = await queryActivityList(cookie);
  const tasks = readBeanTasks(activityData);
  $.log(`账号${index} ${userName}: 识别到 ${tasks.length} 个买药页京豆任务`);

  if (!tasks.length) {
    $.log(`账号${index} ${userName}: 活动列表片段 => ${stringifySnippet(activityData)}`);
    return;
  }

  for (const task of tasks) {
    $.log(`账号${index} ${userName}: 执行任务 ${task.assignmentName || task.encryptAssignmentId}`);
    const result = await completeTask(cookie, task);
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
