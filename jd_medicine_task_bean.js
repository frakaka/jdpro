/*
cron:26 0 * * * jd_medicine_task_bean.js

环境变量说明：
1. JD_MEDICINE_PROJECT_ID
   含义：买药任务页接口里的 encryptProjectId。
   是否必须：否，默认使用当前 HAR 和前端 JS 中的项目值。
   如何覆盖：在青龙新增同名环境变量，值填最新抓包里的 encryptProjectId。

2. JD_MEDICINE_SIGN_ASSIGNMENT_ID
   含义：买药签到接口里的 encryptAssignmentId。
   是否必须：否，默认使用当前 HAR 和前端 JS 中的签到 assignmentId。
   如何覆盖：在青龙新增同名环境变量，值填最新抓包里的签到 encryptAssignmentId。

3. JD_MEDICINE_DO_ALL_TASKS
   含义：是否额外尝试 assignmentType=4/6 等非纯浏览任务。
   是否必须：否，默认只跑 1/3 类可自动完成任务，配置为 1 时扩大尝试范围。

4. JD_MEDICINE_DEBUG
   含义：是否打印接口原始返回片段，便于排查活动变更。
   是否必须：否，配置为 1 时开启。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getUserName,
  postFormApi,
  stringifySnippet,
} = require('./function/jdHarBeanCommon.js');

const $ = new Env('家庭常备药签到');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const API_ENDPOINT = 'https://api.m.jd.com/client.action';
const APP_ID = 'laputa';
const DEFAULT_PROJECT_ID = '3gUkbvwFqf4zciMRTtJ4d2uPhfaT';
const DEFAULT_SIGN_ASSIGNMENT_ID = '3uEBpEkXxnkhQYpLzXQKo914eVph';
const ACTIVITY_REFERER = 'https://pro.m.jd.com/mall/active/AZPuLq2CMt4zRj7cE8Uno31nvYz/index.html';

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MEDICINE_DEBUG === '1';
}

function getProjectId() {
  return process.env.JD_MEDICINE_PROJECT_ID || DEFAULT_PROJECT_ID;
}

function getSignAssignmentId() {
  return process.env.JD_MEDICINE_SIGN_ASSIGNMENT_ID || DEFAULT_SIGN_ASSIGNMENT_ID;
}

async function callApi(cookie, functionId, body) {
  return postFormApi(cookie, {
    endpoint: API_ENDPOINT,
    functionId,
    appid: APP_ID,
    body,
    referer: ACTIVITY_REFERER,
    origin: 'https://pro.m.jd.com',
  });
}

async function queryActivityPage(cookie) {
  return callApi(cookie, 'mb2capp_ma_queryActivityPageInfo', {
    encryptProjectId: getProjectId(),
    encryptAssignmentId: getSignAssignmentId(),
  });
}

async function doDailyAttendance(cookie) {
  return callApi(cookie, 'mb2capp_ma_doDailyAttendance', {
    encryptProjectId: getProjectId(),
    encryptAssignmentId: getSignAssignmentId(),
  });
}

function mergeSetCookieIntoCookie(cookie, setCookieHeaders) {
  const source = parseCookieString(cookie);
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [];

  for (const header of headers) {
    const firstPair = String(header || '').split(';')[0];
    const separatorIndex = firstPair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = firstPair.slice(0, separatorIndex).trim();
    const value = firstPair.slice(separatorIndex + 1).trim();
    if (key && value) {
      source.set(key, value);
    }
  }

  return Array.from(source.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function formatSignInfo(pageInfo) {
  const signInfo = pageInfo?.dailySignInfo || {};
  const signList = Array.isArray(signInfo.signList) ? signInfo.signList : [];
  const today = signList.find((item) => item?.todayFlag);
  return {
    receivedJingDouCount: signInfo.receivedJingDouCount || pageInfo?.receivedJingDouCount || 0,
    consecutiveSignInDays: signInfo.consecutiveSignInDays || 0,
    todaySigned: Boolean(today?.signed),
    todayReward: today?.getJingDouCount || 0,
  };
}

function summarizeTask(task) {
  return `${task.assignmentName || '未知任务'} | type=${task.assignmentType || '-'} | cnt=${task.completionCnt || 0}/${task.assignmentTimesLimit || 0}`;
}

async function handleAccount(cookie, index) {
  const username = getUserName(cookie);
  $.log(`\n==== 账号${index} ${username} ====`);

  let page = await queryActivityPage(cookie);
  if (page?.code !== '0000') {
    $.log(`账号 ${username}: 查询活动页失败 => ${stringifySnippet(page)}`);
    return;
  }

  let pageInfo = page.data || {};
  let signInfo = formatSignInfo(pageInfo);
  $.log(`账号 ${username}: 当前累计领豆 ${signInfo.receivedJingDouCount}，连续签到 ${signInfo.consecutiveSignInDays} 天，今日已签=${signInfo.todaySigned}`);

  if (!signInfo.todaySigned) {
    const signResult = await doDailyAttendance(cookie);
    $.log(`账号 ${username}: 签到结果 => ${stringifySnippet(signResult)}`);

    page = await queryActivityPage(cookie);
    if (page?.code === '0000') {
      pageInfo = page.data || {};
      signInfo = formatSignInfo(pageInfo);
      $.log(`账号 ${username}: 签到后状态 => 今日已签=${signInfo.todaySigned}，累计领豆 ${signInfo.receivedJingDouCount}`);
    }
  }

  const taskList = Array.isArray(pageInfo.assignmentList) ? pageInfo.assignmentList : [];
  $.log(`账号 ${username}: 任务列表 => ${taskList.map(summarizeTask).join(' || ') || '空'}`);
  $.log(`账号 ${username}: 当前脚本仅执行签到，其他任务已跳过`);

  if (isDebugEnabled()) {
    $.log(`账号 ${username}: queryActivityPage 原始返回 => ${stringifySnippet(page, 1500)}`);
  }
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
      const username = getUserName(cookies[index]);
      $.log(`账号 ${username}: 执行异常 => ${error.message}`);
    }
  }
}

main()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message}`);
  })
  .finally(async () => {
    if (notify && typeof notify.sendNotify === 'function') {
      try {
        await notify.sendNotify($.name, '执行完成');
      } catch (error) {
        // ignore
      }
    }
    $.done();
  });
