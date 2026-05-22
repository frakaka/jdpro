/*
cron:32 0 * * * jd_medicine_family_sign_bean.js

家庭常备药签到领京豆。

基于 files/traffic_jd_家庭常备药签到_filtered.har 分析得到的主流程：
1. mb2capp_ma_queryActivityPageInfo 查询签到页信息。
2. dailySignInfo.signList 里 todayFlag=true 且 signed=false 时调用 mb2capp_ma_doDailyAttendance。
3. 签到后再次查询页面信息确认状态。

环境变量：
1. JD_MEDICINE_FAMILY_DEBUG
   配置为 1 时打印更长 request/response。
2. JD_MEDICINE_FAMILY_FORCE_SIGN
   配置为 1 时即使查询显示今日已签，也会尝试调用签到接口。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getUserName,
  mergeCookieString,
  parseApiResponse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('家庭常备药签到领京豆');

const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = 'AZPuLq2CMt4zRj7cE8Uno31nvYz';
const PAGE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?cu=true&utm_source=lianmeng__11__kong__kong&utm_medium=jingfen&utm_campaign=t_1000441370_`;
const API_ENDPOINT = 'https://api.m.jd.com/client.action';

const APPID = 'laputa';
const ENCRYPT_PROJECT_ID = '3gUkbvwFqf4zciMRTtJ4d2uPhfaT';
const ENCRYPT_SIGN_ASSIGNMENT_ID = '3uEBpEkXxnkhQYpLzXQKo914eVph';
const REQUEST_TIMEOUT_MS = 15000;

const USER_AGENT = process.env.JD_MEDICINE_FAMILY_USER_AGENT || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.90&HiClVersion=8.1.90&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR&stockSDK=stocksdk-iphone_6.0.0&sPoint=&jdPay=(*#@jdPaySDK*#@jdPayChannel=jdfinance&jdPayChannelVersion=8.1.90&jdPaySdkVersion=4.02.00.00&jdPayClientName=iOS*#@)';
const DEFAULT_ACTIVITY_COOKIE = [
  'qid_uid=c991fba1-64ce-4228-866a-3d80c6c8023d',
].join('; ');

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MEDICINE_FAMILY_DEBUG === '1';
}

function shouldForceSign() {
  return process.env.JD_MEDICINE_FAMILY_FORCE_SIGN === '1';
}

function stringifyForLog(value, maxLength = 1200) {
  const length = isDebugEnabled() ? Math.max(maxLength, 5000) : maxLength;
  return stringifySnippet(value, length);
}

function buildActivityCookie(rawCookie) {
  return mergeCookieString(DEFAULT_ACTIVITY_COOKIE, rawCookie);
}

function buildHeaders(cookie) {
  return {
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookie,
    Origin: ORIGIN,
    Referer: PAGE_REFERER,
    'User-Agent': USER_AGENT,
  };
}

function buildBody() {
  return {
    encryptProjectId: ENCRYPT_PROJECT_ID,
    encryptAssignmentId: ENCRYPT_SIGN_ASSIGNMENT_ID,
  };
}

function redactFormForLog(form) {
  return Object.fromEntries(form.entries());
}

function logRequest(userName, functionId, url, form, headers) {
  $.log(`账号 ${userName}: ${functionId} request => ${stringifyForLog({
    url,
    form: redactFormForLog(form),
    headers: {
      ...headers,
      Cookie: '已隐藏',
    },
  })}`);
}

function logResponse(userName, functionId, response) {
  $.log(`账号 ${userName}: ${functionId} response => ${stringifyForLog(response, 1800)}`);
}

async function postApi(cookie, userName, functionId) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('functionId', functionId);

  const form = new URLSearchParams();
  form.set('appid', APPID);
  form.set('functionId', functionId);
  form.set('body', JSON.stringify(buildBody()));

  const headers = buildHeaders(cookie);
  logRequest(userName, functionId, url.toString(), form, headers);

  const response = await got.post(url.toString(), {
    body: form.toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const data = parseApiResponse(response);
  logResponse(userName, functionId, data);
  return data;
}

async function queryActivityPageInfo(cookie, userName) {
  return postApi(cookie, userName, 'mb2capp_ma_queryActivityPageInfo');
}

async function doDailyAttendance(cookie, userName) {
  return postApi(cookie, userName, 'mb2capp_ma_doDailyAttendance');
}

function getTodaySignInfo(response) {
  const signList = response?.data?.dailySignInfo?.signList || response?.data?.signList || [];
  return Array.isArray(signList) ? signList.find((item) => item?.todayFlag === true) : null;
}

function summarizeSignInfo(response) {
  const today = getTodaySignInfo(response) || {};
  const dailySignInfo = response?.data?.dailySignInfo || response?.data || {};
  return [
    `todayDay=${today.dayIndex || '-'}`,
    `todaySigned=${today.signed}`,
    `todayBeans=${today.getJingDouCount || '-'}`,
    `consecutive=${dailySignInfo.consecutiveSignInDays || '-'}`,
    `receivedBeans=${dailySignInfo.receivedJingDouCount || response?.data?.receivedJingDouCount || '-'}`,
  ].join(' | ');
}

async function runAccount(rawCookie, index) {
  const userName = getUserName(rawCookie);
  const cookie = buildActivityCookie(rawCookie);
  $.log(`\n账号${index} ${userName}: 开始`);

  const pageInfo = await queryActivityPageInfo(cookie, userName);
  $.log(`账号 ${userName}: 签到状态 => ${summarizeSignInfo(pageInfo)}`);

  const today = getTodaySignInfo(pageInfo);
  if (!shouldForceSign() && today?.signed === true) {
    $.log(`账号 ${userName}: 今日已签到`);
    return;
  }

  const signResponse = await doDailyAttendance(cookie, userName);
  $.log(`账号 ${userName}: 签到结果 => ${summarizeSignInfo(signResponse)} currentBeans=${signResponse?.data?.currentSighJDCount || '-'}`);

  await sleep(1000);
  const finalInfo = await queryActivityPageInfo(cookie, userName);
  $.log(`账号 ${userName}: 复查状态 => ${summarizeSignInfo(finalInfo)}`);
}

(async () => {
  if (!cookies.length) {
    $.log('未找到京东 cookie，请先配置 jdCookie.js');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行失败 => ${error.stack || error.message || error}`);
    }
    await sleep(1000);
  }
})()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
