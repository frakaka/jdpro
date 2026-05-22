/*
cron:15 0 * * * jd_hudong_sign_bean.js

京东互动游戏签到和打卡领京豆。

环境变量：
1. JD_COOKIE
   必填，最小 Cookie 集合：pt_key=xxx;pt_pin=xxx;

2. JD_HUDONG_SIGN_FULL_COOKIE
   可选，仅用于补充非动态活动 Cookie。一般不需要配置；即使配置了，旧风控字段也会被剔除。

3. JD_HUDONG_SIGN_DEBUG
   可选，配置为 1 时打印接口返回片段。

4. JD_HUDONG_SIGN_MAX_TASKS
   可选，最多执行几个任务列表任务。默认不限制。

说明：x-api-eid-token 每次通过 GIAS 动态生成，不复用 Cookie 里的旧 3AB9D23F7A4B3CSS。
*/

'use strict';

const crypto = require('crypto');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  createJsSecurityH5st,
  getGiasRiskContext,
  getRequestUuid,
  getUserName,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东互动游戏签到');

const API_ENDPOINT = 'https://api.m.jd.com/';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3fcyrvLZALNPWCEDRvaZJVrzek8v/index.html';
const PAGE_REFERER = `${PAGE_URL}?stath=47&navh=44&disablePageSticky=1&babelChannel=ttt106&iconKey=dandanfan&commontitle=no&transparent=1&collectionId=527&jwebprog=0&hybrid_err_view=1`;
const DEFAULT_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777624086%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const APPID = 'activities_platform';
const H5ST_APP_ID = '2c4bd';
const CLIENT = 'ios';
const CLIENT_VERSION = '15.6.50';
const OS_VERSION = '26.2';
const BUILD = '170394';
const D_MODEL = 'iPhone14,5';
const D_BRAND = 'iPhone';
const NETWORK_TYPE = 'wifi';
const JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.5.js?v=2406';
const DEFAULT_GIAS_BIZ_ID = 'JDR_shields';
const DEFAULT_RECOMMEND_WAIT_SECONDS = 30;
const DEFAULT_TASK_WAIT_SECONDS = 10;

const COMMON_HEADERS = {
  'request-from': 'native',
  'sec-fetch-site': 'same-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  priority: 'u=3, i',
};

const RISK_COOKIE_KEYS = new Set([
  '3AB9D23F7A4B3CSS',
  '3AB9D23F7A4B3C9B',
  '_gia_d',
  'equipmentId',
]);

const cookies = Object.values(jdCookieNode).filter(Boolean);

function isDebugEnabled() {
  return process.env.JD_HUDONG_SIGN_DEBUG === '1';
}

function getPageUserAgent() {
  return String(process.env.JD_HUDONG_SIGN_USER_AGENT || DEFAULT_USER_AGENT).trim();
}

function getMaxTasks() {
  const value = Number(process.env.JD_HUDONG_SIGN_MAX_TASKS || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMergedCookie(cookie) {
  const fullCookie = String(process.env.JD_HUDONG_SIGN_FULL_COOKIE || '').trim();
  return fullCookie ? mergeCookieString(fullCookie, cookie) : cookie;
}

function stripRiskCookie(cookie) {
  return Array.from(parseCookieString(cookie).entries())
    .filter(([key]) => !RISK_COOKIE_KEYS.has(key))
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function getCookieValue(cookie, key) {
  return parseCookieString(cookie).get(key) || '';
}

function resolveUuid(cookie) {
  const configuredUuid = String(process.env.JD_HUDONG_SIGN_UUID || '').trim();
  if (configuredUuid) {
    return configuredUuid;
  }

  const preSession = getCookieValue(cookie, 'pre_session').split('|')[0];
  return getCookieValue(cookie, 'deviceId')
    || preSession
    || getCookieValue(cookie, '__jdu')
    || getCookieValue(cookie, 'mba_muid')
    || getRequestUuid(cookie);
}

function createStableFp(cookie) {
  const configuredFp = String(process.env.JD_HUDONG_SIGN_H5ST_FP || '').trim();
  if (/^[a-z0-9]{16}$/i.test(configuredFp)) {
    return configuredFp;
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seed = crypto
    .createHash('sha256')
    .update(`${getUserName(cookie)}:${H5ST_APP_ID}:hudong-sign`)
    .digest();
  let fp = '';
  for (let index = 0; index < 16; index += 1) {
    fp += alphabet[seed[index] % alphabet.length];
  }
  return fp;
}

function buildH5stLocalStorageSeed(cookie) {
  const fp = createStableFp(cookie);
  return {
    WQ_dy1_vk: JSON.stringify({
      '5.3': {
        [H5ST_APP_ID]: {
          e: 31536000,
          v: fp,
          t: Date.now(),
        },
      },
    }),
  };
}

function createBaseForm(cookie, functionId, bodyText, eidToken) {
  const uuid = resolveUuid(cookie);
  const form = {
    appid: APPID,
    loginType: '2',
    loginWQBiz: '',
    functionId,
    body: bodyText,
    'x-api-eid-token': eidToken,
    ua: getPageUserAgent(),
    client: CLIENT,
    osVersion: OS_VERSION,
    clientVersion: CLIENT_VERSION,
    uuid,
    d_model: D_MODEL,
    d_brand: D_BRAND,
    networkType: NETWORK_TYPE,
    build: BUILD,
    partner: '-1',
    openudid: uuid,
  };

  if (!form['x-api-eid-token']) {
    delete form['x-api-eid-token'];
  }

  return form;
}

async function signForm(cookie, formFields) {
  return createJsSecurityH5st({
    h5stAppId: H5ST_APP_ID,
    formFields,
    cookie,
    userAgent: getPageUserAgent(),
    pageUrl: PAGE_REFERER,
    scriptUrl: JS_SECURITY_SCRIPT_URL,
    bizId: 'pro',
    localStorageSeed: buildH5stLocalStorageSeed(cookie),
    signerOptions: {
      preRequest: true,
      skipManualPrepare: process.env.JD_HUDONG_SIGN_SKIP_MANUAL_PREPARE === '1',
    },
  });
}

function encodeForm(formFields) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(formFields)) {
    if (value !== undefined && value !== null) {
      form.set(key, String(value));
    }
  }
  return form.toString();
}

async function postInteractGame(cookie, eidToken, functionId, body) {
  const timestamp = Date.now();
  const bodyText = JSON.stringify(body);
  const formFields = createBaseForm(cookie, functionId, bodyText, eidToken);
  formFields.h5st = await signForm(cookie, formFields);

  const url = new URL(API_ENDPOINT);
  url.searchParams.set('functionId', functionId);
  url.searchParams.set('_', String(timestamp));

  if (isDebugEnabled()) {
    $.log(`账号${$.index} ${$.UserName}: ${functionId} 请求body => ${bodyText}`);
  }

  const response = await got.post(url.toString(), {
    body: encodeForm(formFields),
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: getPageUserAgent(),
      extraHeaders: COMMON_HEADERS,
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });

  const result = safeJsonParse(response.body, { code: response.statusCode, message: response.body || '' });
  if (isDebugEnabled()) {
    $.log(`账号${$.index} ${$.UserName}: ${functionId} 返回 => ${stringifySnippet(result, 1500)}`);
  }
  return result;
}

async function getActivityContext(cookie) {
  const cleanCookie = stripRiskCookie(getMergedCookie(cookie));
  const giasBizId = String(process.env.JD_HUDONG_SIGN_GIAS_BIZ_ID || DEFAULT_GIAS_BIZ_ID).trim();
  try {
    const risk = await getGiasRiskContext(cleanCookie, {
      pageUrl: PAGE_REFERER,
      userAgent: getPageUserAgent(),
      bizId: giasBizId,
    });
    if (!risk?.jsToken) {
      throw new Error(`GIAS 未生成 x-api-eid-token: ${stringifySnippet(risk, 300)}`);
    }
    return {
      cookie: risk.cookie ? mergeCookieString(cleanCookie, risk.cookie) : cleanCookie,
      eidToken: risk.jsToken,
    };
  } catch (error) {
    throw new Error(`GIAS 动态生成 x-api-eid-token 失败：${error.message || error}`);
  }
}

async function queryHome(cookie, eidToken, body = {}) {
  return postInteractGame(cookie, eidToken, 'interact_game_home', {
    actionSign: 'gameBack',
    version: '2.0',
    channel: '',
    ...body,
  });
}

async function queryEntryHome(cookie, eidToken) {
  return postInteractGame(cookie, eidToken, 'interact_game_home', {
    iconKey: 'dandanfan',
    functionId: '',
    babelChannel: 'ttt106',
    version: '2.0',
    channel: 'ttt106',
  });
}

function getBannerInfos(homeResult) {
  return homeResult?.data?.assetInfos?.bannerInfos || [];
}

function findGameRewardBanner(banners) {
  return banners.find((item) => item?.assignmentId && item.functionId !== 'beanSign') || null;
}

function findBeanSignBanner(banners) {
  return banners.find((item) => item?.functionId === 'beanSign' || String(item?.titleText || '').includes('打卡')) || null;
}

function parseWaitSeconds(task, fallbackSeconds) {
  const explicitSeconds = Number(task?.waitDuration || 0);
  if (Number.isFinite(explicitSeconds) && explicitSeconds > 0) {
    return explicitSeconds;
  }

  const text = [
    task?.subTitle,
    task?.subTitle?.value,
    task?.subTitleName,
  ].filter(Boolean).join(' ');
  const match = String(text).match(/(\d+)\s*(?:s|秒)/i);
  return match ? Number(match[1]) : fallbackSeconds;
}

function getTaskTitle(task) {
  return task?.title?.value || task?.titleText || task?.title || task?.taskName || task?.assignmentId || '未知任务';
}

function getTaskSubtitle(task) {
  return task?.subTitle?.value || task?.subTitle || task?.subTitleName || '';
}

function normalizeTask(task, source) {
  return {
    source,
    assignmentId: task.assignmentIdForJingDou || task.assignmentId,
    itemId: task.itemId || '',
    jumpUrl: task.jumpInfo?.jumpUrl || '',
    prizeNum: Number(task.prizeNum || 0),
    status: Number(task.status),
    title: getTaskTitle(task),
    subtitle: getTaskSubtitle(task),
    waitSeconds: parseWaitSeconds(
      task,
      source === 'recommendInfos' ? DEFAULT_RECOMMEND_WAIT_SECONDS : DEFAULT_TASK_WAIT_SECONDS,
    ),
    raw: task,
  };
}

function isExecutableTask(task) {
  if (!task.assignmentId) {
    return false;
  }
  if (task.status === 2 || task.status === 3) {
    return false;
  }
  return true;
}

function readTaskList(homeResult) {
  const bannerTasks = (homeResult?.data?.taskInfos?.bannerInfos || [])
    .map((task) => normalizeTask(task, 'taskInfos'))
    .filter(isExecutableTask);

  const recommendTasks = (homeResult?.data?.recommendInfos?.recommendInfos || [])
    .map((task) => normalizeTask(task, 'recommendInfos'))
    .filter((task) => {
      const hasBeanText = `${task.title}${task.subtitle}`.includes('京豆');
      return isExecutableTask(task) && (task.prizeNum > 0 || hasBeanText);
    });

  const maxTasks = getMaxTasks();
  const tasks = [...bannerTasks, ...recommendTasks];
  return maxTasks > 0 ? tasks.slice(0, maxTasks) : tasks;
}

function describeBanner(item) {
  if (!item) {
    return '-';
  }
  const title = item.titleText || item.functionId || '互动游戏任务';
  return `${title} | assignmentId=${item.assignmentId || '-'} | itemId=${item.itemId || '-'} | status=${item.status}`;
}

async function receiveGameReward(cookie, eidToken, banner) {
  return postInteractGame(cookie, eidToken, 'interact_game_receive_reward', {
    encryptAssignmentId: banner.assignmentId,
    type: 1,
    version: '2.0',
  });
}

async function signBean(cookie, eidToken, banner) {
  return postInteractGame(cookie, eidToken, 'interact_game_sign', {
    encryptAssignmentId: banner.assignmentId,
    itemId: String(banner.itemId || '1'),
    version: '2.0',
  });
}

async function startTask(cookie, eidToken, task, actionType) {
  return postInteractGame(cookie, eidToken, 'interact_game_start_task', {
    encryptAssignmentId: task.assignmentId,
    actionType,
    itemId: task.itemId,
    version: '2.0',
    jumpUrl: actionType === 1 ? task.jumpUrl : '',
  });
}

async function receiveTaskReward(cookie, eidToken, task) {
  return postInteractGame(cookie, eidToken, 'interact_game_receive_reward', {
    encryptAssignmentId: task.assignmentId,
    type: 2,
    version: '2.0',
  });
}

function describeTask(task) {
  return `${task.title} | source=${task.source} | assignmentId=${task.assignmentId || '-'} | itemId=${task.itemId || '-'} | status=${task.status} | wait=${task.waitSeconds}s | reward=${task.prizeNum || '-'}`;
}

function isStartSuccess(result) {
  return Number(result?.code) === 0;
}

function isFinishSuccess(result) {
  return Number(result?.code) === 0 || Number(result?.code) === 200;
}

async function runBrowseTask(cookie, eidToken, task, index, userName) {
  $.log(`账号${index} ${userName}: 开始任务 => ${describeTask(task)}`);

  const startResult = await startTask(cookie, eidToken, task, 1);
  $.log(`账号${index} ${userName}: 开始浏览 => ${stringifySnippet(startResult, 500)}`);
  if (!isStartSuccess(startResult)) {
    $.log(`账号${index} ${userName}: 开始浏览未成功，跳过完成上报 => ${startResult?.message || stringifySnippet(startResult, 300)}`);
    await sleep(2000);
    return;
  }

  await sleep(task.waitSeconds * 1000);

  const finishResult = await startTask(cookie, eidToken, task, 0);
  $.log(`账号${index} ${userName}: 完成上报 => ${stringifySnippet(finishResult, 500)}`);
  if (!isFinishSuccess(finishResult)) {
    $.log(`账号${index} ${userName}: 完成上报未成功，跳过领奖 => ${finishResult?.message || stringifySnippet(finishResult, 300)}`);
    await sleep(2000);
    return;
  }

  await queryHome(cookie, eidToken);

  if (task.source === 'recommendInfos') {
    const rewardResult = await receiveTaskReward(cookie, eidToken, task);
    $.log(`账号${index} ${userName}: 领取任务奖励 => ${stringifySnippet(rewardResult, 500)}`);
  } else {
    $.log(`账号${index} ${userName}: ${task.source} 任务已完成上报，跳过逐项领奖`);
  }
  await sleep(1000);
}

function summarizeFinalState(homeResult) {
  const banners = getBannerInfos(homeResult);
  return banners.map(describeBanner).join(' || ') || stringifySnippet(homeResult, 500);
}

async function runAccount(rawCookie, index) {
  $.index = index;
  $.UserName = getUserName(rawCookie);
  $.log(`\n==== 账号${index} ${$.UserName} ====`);

  const { cookie, eidToken } = await getActivityContext(rawCookie);
  const home = await queryEntryHome(cookie, eidToken);
  const banners = getBannerInfos(home);
  const gameRewardBanner = findGameRewardBanner(banners);
  const beanSignBanner = findBeanSignBanner(banners);
  const tasks = readTaskList(home);

  $.log(`账号${index} ${$.UserName}: banner任务 => ${banners.map(describeBanner).join(' || ') || '未识别到'}`);
  $.log(`账号${index} ${$.UserName}: 任务列表待执行 => ${tasks.length}`);
  if (tasks.length) {
    $.log(`账号${index} ${$.UserName}: 任务列表明细 => ${tasks.map(describeTask).join(' || ')}`);
  }

  if (gameRewardBanner) {
    if (Number(gameRewardBanner.status) === 2 && process.env.JD_HUDONG_SIGN_FORCE_RECEIVE !== '1') {
      $.log(`账号${index} ${$.UserName}: 互动游戏奖励已完成，跳过领取`);
    } else {
      const result = await receiveGameReward(cookie, eidToken, gameRewardBanner);
      $.log(`账号${index} ${$.UserName}: 互动游戏奖励领取 => ${stringifySnippet(result, 600)}`);
      await sleep(800);
    }
  } else {
    $.log(`账号${index} ${$.UserName}: 未识别到互动游戏奖励 banner`);
  }

  const afterRewardHome = await queryHome(cookie, eidToken);
  const refreshedSignBanner = findBeanSignBanner(getBannerInfos(afterRewardHome)) || beanSignBanner;
  if (refreshedSignBanner) {
    if (Number(refreshedSignBanner.status) === 2 && process.env.JD_HUDONG_SIGN_FORCE_SIGN !== '1') {
      $.log(`账号${index} ${$.UserName}: 打卡领京豆已完成，跳过签到`);
    } else {
      const result = await signBean(cookie, eidToken, refreshedSignBanner);
      $.log(`账号${index} ${$.UserName}: 打卡领京豆 => ${stringifySnippet(result, 600)}`);
      await sleep(800);
    }
  } else {
    $.log(`账号${index} ${$.UserName}: 未识别到打卡领京豆 banner`);
  }

  for (const task of tasks) {
    try {
      await runBrowseTask(cookie, eidToken, task, index, $.UserName);
    } catch (error) {
      $.log(`账号${index} ${$.UserName}: 任务失败，继续下一个 => ${describeTask(task)} | ${error.message || error}`);
      await sleep(2000);
    }
  }

  const finalHome = await queryHome(cookie, eidToken);
  $.log(`账号${index} ${$.UserName}: 最终状态 => ${summarizeFinalState(finalHome)}`);
  const remainTasks = readTaskList(finalHome);
  $.log(`账号${index} ${$.UserName}: 最终剩余任务数 => ${remainTasks.length}`);
  if (remainTasks.length) {
    $.log(`账号${index} ${$.UserName}: 最终剩余任务 => ${remainTasks.map(describeTask).join(' || ')}`);
  }
}

async function main() {
  $.log('', `🔔${$.name}, 开始!`);
  if (!cookies.length) {
    $.log('未找到有效账号 Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行异常 => ${error.stack || error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常 => ${error.stack || error.message || error}`))
  .finally(() => {
    $.done();
    process.exit(0);
  });
