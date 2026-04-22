/*
cron:11 0 * * * jd_jxzy_signin_bean.js

环境变量说明：
1. JD_JXZY_DEBUG
   含义：是否打印接口原始返回片段，便于排查活动下线或字段变化。
   是否必须：否，配置为 1 时开启。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  getUserAgent,
  getUserName,
  parseApiResponse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京喜赚豆签到领京豆');

const API_URL = 'https://api.m.jd.com/api';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/2iqSwv1JiDHxAkHAikfU6XAECFmo/index.html';
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt453&topNavStyle=1`;
const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_JXZY_DEBUG === '1';
}

function createHeaders(cookie) {
  return buildHeaders(cookie, {
    origin: 'https://pro.m.jd.com',
    referer: PAGE_REFERER,
    userAgent: getUserAgent(),
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
}

async function postActivityApi(cookie, functionId) {
  const response = await got.post(`${API_URL}?functionId=${encodeURIComponent(functionId)}`, {
    body: '',
    headers: createHeaders(cookie),
    throwHttpErrors: false,
    timeout: {
      request: 15000,
    },
  });

  return parseApiResponse(response);
}

function readSignStatus(response) {
  return Number(response?.data?.status ?? -1);
}

function readPopTask(response) {
  return response?.data?.taskInfo || null;
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;

  $.log(`\n==== ${prefix} ====`);

  const firstQuery = await postActivityApi(cookie, 'jxzy_active_querySign');
  if (isDebugEnabled()) {
    $.log(`${prefix}: querySign(首次) => ${stringifySnippet(firstQuery, 1000)}`);
  }

  let signStatus = readSignStatus(firstQuery);
  if (signStatus === 1) {
    const signResult = await postActivityApi(cookie, 'jxzy_active_drawSign');
    $.log(`${prefix}: 执行签到 => ${stringifySnippet(signResult, 800)}`);

    const secondQuery = await postActivityApi(cookie, 'jxzy_active_querySign');
    if (isDebugEnabled()) {
      $.log(`${prefix}: querySign(签到后) => ${stringifySnippet(secondQuery, 1000)}`);
    }
    signStatus = readSignStatus(secondQuery);
  } else if (signStatus === 2) {
    $.log(`${prefix}: 今日签到状态已完成，继续检查弹窗京豆奖励`);
  } else {
    $.log(`${prefix}: querySign 未识别签到状态 => ${stringifySnippet(firstQuery, 800)}`);
  }

  const popInfo = await postActivityApi(cookie, 'jxzy_active_getPopWindowInfo');
  if (isDebugEnabled()) {
    $.log(`${prefix}: getPopWindowInfo => ${stringifySnippet(popInfo, 1000)}`);
  }

  const taskInfo = readPopTask(popInfo);
  if (!taskInfo) {
    $.log(`${prefix}: 未找到弹窗奖励任务，签到状态=${signStatus}`);
    return;
  }

  const taskStatus = Number(taskInfo.taskStatus ?? -1);
  const beanCount = taskInfo.awardBeanNum || '';
  $.log(`${prefix}: 弹窗任务状态=${taskStatus} 奖励=${beanCount || '未知'}京豆`);

  if (taskStatus !== 10) {
    $.log(`${prefix}: 当前无需领取弹窗京豆`);
    return;
  }

  const drawResult = await postActivityApi(cookie, 'jxzy_active_drawBeanPopWindow');
  $.log(`${prefix}: 领取弹窗京豆 => ${stringifySnippet(drawResult, 800)}`);
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
