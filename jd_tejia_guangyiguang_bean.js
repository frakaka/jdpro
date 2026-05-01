/*
cron:35 0 * * * jd_tejia_guangyiguang_bean.js

环境变量说明：
1. JD_TEJIA_GUANGYIGUANG_FULL_COOKIE
   含义：可选，补充活动页抓包中的完整 Cookie，用于补齐 sdtoken、3AB9... 等页面态。
   默认值：空。

2. JD_TEJIA_GUANGYIGUANG_DEBUG
   含义：是否打印接口原始返回片段。
   默认值：0，配置为 1 开启。
*/

'use strict';

const got = require('got');
const crypto = require('crypto');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_USER_AGENT,
  buildHeaders,
  createBabelSecurityParams,
  createJsSecurityH5st,
  getRequestUuid,
  getUserName,
  getGiasRiskContext,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('特价逛一逛领京豆');

const API_ENDPOINT = 'https://api.m.jd.com/';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/4WMAPf9VCBdEE8Rva1AVEPH7CBbj/index.html';
const PAGE_REFERER = `${PAGE_URL}?stath=47&navh=44&initiativeVisit=1&finishStatus=1&tttparams=2j0nwDzJleyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEyLjk3MDg5MiIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMDEyMDMiLCJsYnNMbmciOiIxMTIuOTcxNDM3IiwicHJzdGF0ZSI6IjAiLCJncHNfYXJlYSI6IjE4XzE0ODJfNDg5MzhfNTQ2MDIiLCJzY2FsZSI6IjMiLCJhZGRyZXNzSWQiOiIxNTE1MjIwMDk4IiwidW5fYXJlYSI6IjE4XzE0ODJfMzYwNl82MDAwMCIsIndpZHRoIjoiMTE3MCIsImxic0FyZWEiOiIxOF8xNDgyXzQ4OTM4XzU0NjAyIiwibGF0IjoiMjguMjAxNTI2IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX90%3D&isxview=1&everyVisit=1&visitScene=shouyezhudong&from=entry`;
const PAGE_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777534500%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const CHANNEL_ID = '16';
const DESKTOP_TASK_APP_ID = '1759058595200001';
const COMMON_APPID = 'newtry';
const COMMON_H5ST_APP_ID = '35fa0';
const COMMON_CLIENT = 'apple';
const COMMON_CLIENT_VERSION = '15.6.50';
const LOGIN_TYPE = '2';
const REQUEST_AREA = '18_1482_3606_60000';
const COMMON_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_lite_0.1.4.js';
const COMMON_BABEL_SECURITY_SCRIPT_URL = 'https://storage11.360buyimg.com/tower/babelnode/js/security.5e3cd16f.js';
const REQUEST_META = {
  clientVersion: COMMON_CLIENT_VERSION,
  client: COMMON_CLIENT,
  loginType: LOGIN_TYPE,
  appid: COMMON_APPID,
  xAPIClientLanguage: 'zh_CN',
  uuid: '224e6c34e7638196d45b7006b8f1713f8d4ec463',
  d_model: 'iPhone14,5',
  d_brand: 'iPhone',
  model: 'iPhone14,5',
  osVersion: '26.2',
};
const REPORT_APPID = 'risk_h5_info';
const BROWSE_WAIT_MS = 5000;
const EXTRA_BROWSE_WAIT_MS = 3000;
const COMMON_EXTRA_HEADERS = {
  'x-rp-client': 'h5_1.0.0',
  'x-referer-page': PAGE_URL,
  'sec-fetch-site': 'same-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  priority: 'u=3, i',
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

function isDebugEnabled() {
  return process.env.JD_TEJIA_GUANGYIGUANG_DEBUG === '1';
}

function getMergedCookie(cookie) {
  const fullCookie = String(process.env.JD_TEJIA_GUANGYIGUANG_FULL_COOKIE || '').trim();
  return fullCookie ? mergeCookieString(fullCookie, cookie) : cookie;
}

function buildDynamicActivityCookiePatch(cookie) {
  const cookieMap = parseCookieString(cookie);
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const requestUuid = getRequestUuid(cookie);
  const randomId = crypto.randomUUID();
  const randomSeed = String(Math.floor(1000 + Math.random() * 9000));
  const ptPin = getUserName(cookie);
  const shshshfpa = cookieMap.get('shshshfpa') || `${crypto.randomUUID()}-${nowSeconds}`;

  return {
    pwdt_id: cookieMap.get('pwdt_id') || ptPin,
    mba_muid: cookieMap.get('mba_muid') || `${requestUuid}.${randomSeed}.${now}`,
    mba_sid: cookieMap.get('mba_sid') || `${randomSeed}.${Math.floor(1 + Math.random() * 9)}`,
    pre_seq: cookieMap.get('pre_seq') || '5',
    pre_session: cookieMap.get('pre_session') || `${REQUEST_META.uuid}|${nowSeconds}`,
    qid_evord: cookieMap.get('qid_evord') || String(Math.floor(100 + Math.random() * 900)),
    qid_fs: cookieMap.get('qid_fs') || String(now - 5000),
    qid_ls: cookieMap.get('qid_ls') || String(now - 5000),
    qid_ts: cookieMap.get('qid_ts') || String(now),
    qid_uid: cookieMap.get('qid_uid') || randomId,
    qid_vis: cookieMap.get('qid_vis') || '1',
    showedCardInfo: cookieMap.get('showedCardInfo') || '1_default',
    joyya: cookieMap.get('joyya') || `${nowSeconds}.0.30.${Math.random().toString(36).slice(2, 9)}`,
    b_dh: cookieMap.get('b_dh') || '760',
    b_avif: cookieMap.get('b_avif') || '1',
    b_dpr: cookieMap.get('b_dpr') || '3',
    b_dw: cookieMap.get('b_dw') || '390',
    b_webp: cookieMap.get('b_webp') || '1',
    webp: cookieMap.get('webp') || '1',
    wxa_level: cookieMap.get('wxa_level') || '1',
    TARGET_UNIT: cookieMap.get('TARGET_UNIT') || 'bjcenter',
    __jdc: cookieMap.get('__jdc') || '122270672',
    __jda: cookieMap.get('__jda') || `122270672.${requestUuid}.${nowSeconds}.${nowSeconds}.${nowSeconds}.1`,
    __jdb: cookieMap.get('__jdb') || `122270672.1.${requestUuid}|1.${nowSeconds}`,
    __jdv: cookieMap.get('__jdv') || `122270672|direct|-|none|-|${now}`,
    shshshfpa,
    shshshfpx: cookieMap.get('shshshfpx') || shshshfpa,
    sid: cookieMap.get('sid') || '',
  };
}

function extractSdToken(response) {
  const rawHeader = response?.headers?.['x-rp-sdtoken'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!headerValue) {
    return '';
  }

  const parts = String(headerValue).split(';');
  return parts.length >= 3 ? parts[2].trim() : '';
}

function attachUpdatedCookie(result, cookie) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    result._cookie = cookie;
    return result;
  }

  return {
    success: false,
    raw: result,
    _cookie: cookie,
  };
}

async function getTaskCookie(cookie) {
  const mergedCookie = mergeCookieString(getMergedCookie(cookie), buildDynamicActivityCookiePatch(cookie));
  try {
    const riskContext = await getGiasRiskContext({
      cookie: mergedCookie,
      pageUrl: PAGE_REFERER,
      userAgent: PAGE_USER_AGENT,
      bizId: 'pro',
    });
    if (riskContext?.cookie) {
      return mergeCookieString(mergedCookie, riskContext.cookie);
    }
  } catch (error) {
    $.log(`账号${$.index} ${$.UserName}: gias Cookie 获取失败，继续使用原 Cookie => ${error.message}`);
  }
  return mergedCookie;
}

async function resolveApiEidToken(cookie) {
  const cookieMap = parseCookieString(cookie);
  const cookieToken = cookieMap.get('3AB9D23F7A4B3CSS') || '';
  if (cookieToken) {
    return cookieToken;
  }

  try {
    const riskContext = await getGiasRiskContext({
      cookie,
      pageUrl: PAGE_REFERER,
      userAgent: PAGE_USER_AGENT,
      bizId: 'pro',
    });
    if (riskContext?.jsToken) {
      return riskContext.jsToken;
    }
  } catch (error) {
    $.log(`账号${$.index} ${$.UserName}: gias x-api-eid-token 获取失败，回退 Cookie => ${error.message}`);
  }
  return '';
}

function buildCommonApiUrl(functionId, timestamp = Date.now()) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('area', REQUEST_AREA);
  url.searchParams.set('clientVersion', COMMON_CLIENT_VERSION);
  url.searchParams.set('client', COMMON_CLIENT);
  url.searchParams.set('loginType', LOGIN_TYPE);
  url.searchParams.set('t', String(timestamp));
  url.searchParams.set('appid', COMMON_APPID);
  url.searchParams.set('xAPIClientLanguage', 'zh_CN');
  url.searchParams.set('uuid', REQUEST_META.uuid);
  url.searchParams.set('d_model', REQUEST_META.d_model);
  url.searchParams.set('d_brand', REQUEST_META.d_brand);
  url.searchParams.set('model', REQUEST_META.model);
  url.searchParams.set('osVersion', REQUEST_META.osVersion);
  url.searchParams.set('functionId', functionId);
  return url;
}

async function createCommonH5st(cookie, functionId, bodyText, timestamp) {
  return createJsSecurityH5st({
    h5stAppId: COMMON_H5ST_APP_ID,
    formFields: {
      functionId,
      appid: COMMON_APPID,
      client: COMMON_CLIENT,
      clientVersion: COMMON_CLIENT_VERSION,
      t: String(timestamp),
      body: bodyText,
    },
    cookie,
    userAgent: PAGE_USER_AGENT,
    pageUrl: PAGE_REFERER,
    scriptUrl: COMMON_JS_SECURITY_SCRIPT_URL,
    bizId: 'pro',
    signerOptions: {
      preRequest: false,
    },
  });
}

async function queryTaskList(cookie) {
  const timestamp = Date.now();
  const bodyObject = {
    ext: { queryReceiveTimes: 1 },
    extMap: {
      sceneType: 2,
      desktopTaskAppId: DESKTOP_TASK_APP_ID,
    },
    channelId: CHANNEL_ID,
  };
  const bodyText = JSON.stringify(bodyObject);
  const baseHeaders = buildHeaders(cookie, {
    origin: 'https://pro.m.jd.com',
    referer: PAGE_REFERER,
    userAgent: PAGE_USER_AGENT,
    extraHeaders: COMMON_EXTRA_HEADERS,
  });
  let formFields = { body: bodyText };
  let headers = { ...baseHeaders };
  let mergedToken = '';

  try {
    const secured = await createBabelSecurityParams({
      formFields,
      headers,
      signSourceFields: {
        functionId: 'common_task_list',
        appid: COMMON_APPID,
        client: COMMON_CLIENT,
        clientVersion: COMMON_CLIENT_VERSION,
        t: String(timestamp),
        body: bodyText,
      },
      signerOptions: {
        appId: COMMON_H5ST_APP_ID,
        preRequest: false,
      },
      cookie,
      pageUrl: PAGE_REFERER,
      userAgent: PAGE_USER_AGENT,
      bizId: 'pro',
      scriptUrl: COMMON_BABEL_SECURITY_SCRIPT_URL,
    });
    mergedToken = secured?.formFields?.['x-api-eid-token'] || '';
    if (secured?.formFields?.h5st) {
      formFields = {
        body: bodyText,
        h5st: secured.formFields.h5st,
      };
      if (mergedToken) {
        formFields['x-api-eid-token'] = mergedToken;
      }
    } else {
      throw new Error(`babelSecurity 未生成有效 h5st: ${stringifySnippet(secured?.formFields || {}, 300)}`);
    }
    headers = secured.headers;
  } catch (error) {
    const eidToken = mergedToken || await resolveApiEidToken(cookie);
    formFields.h5st = await createCommonH5st(cookie, 'common_task_list', bodyText, timestamp);
    if (eidToken) {
      formFields['x-api-eid-token'] = eidToken;
    }
    $.log(`账号${$.index} ${$.UserName}: queryTaskList mergeSecurityParams 失败，回退旧签名 => ${error.message}`);
  }

  const response = await got.post(buildCommonApiUrl('common_task_list', timestamp).toString(), {
    body: new URLSearchParams(formFields).toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  const result = safeJsonParse(response.body, { code: response.statusCode, message: response.body });
  const mergedCookie = extractSdToken(response)
    ? mergeCookieString(cookie, { sdtoken: extractSdToken(response) })
    : cookie;
  const attachedResult = attachUpdatedCookie(result, mergedCookie);
  $.log(`账号${$.index} ${$.UserName}: queryTaskList 原始返回 => ${stringifySnippet(attachedResult)}`);
  return attachedResult;
}

function normalizeTaskList(response) {
  return response?.data?.result?.taskInfo?.taskList || [];
}

function hasBeanReward(task) {
  const rewards = Array.isArray(task?.rewards) ? task.rewards : [];
  return rewards.some((reward) => String(reward?.rewardType) === '3' || String(reward?.rewardName || '').includes('京豆'));
}

function isTargetTask(task) {
  return (
    Number(task?.assignmentType) === 1 &&
    [4, 6].includes(Number(task?.assignmentTimesLimit || 0)) &&
    Number(task?.ext?.waitDuration || 0) === 5 &&
    Array.isArray(task?.ext?.shoppingActivity) &&
    task.ext.shoppingActivity.length >= Number(task?.assignmentTimesLimit || 0) &&
    hasBeanReward(task)
  );
}

function summarizeTask(task) {
  return `${task.assignmentName} | 已完成 ${task.completionCnt}/${task.assignmentTimesLimit} | reward=${(task.rewards || []).map((item) => item.rewardName || item.rewardValue).join('/')}`;
}

function getPendingActivities(task) {
  const activities = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
  return activities.filter((item) => Number(item?.status) !== 2 && item?.url);
}

async function reportInvokeLog(cookie, targetUrl) {
  const body = {
    sdkClient: 'handler',
    sdkVersion: '1.1.0',
    url: Buffer.from(String(targetUrl)).toString('base64'),
    timestamp: Date.now(),
  };
  const form = new URLSearchParams();
  form.set('appid', REPORT_APPID);
  form.set('functionId', 'reportInvokeLog');
  form.set('body', JSON.stringify(body));
  const response = await got.post(API_ENDPOINT, {
    body: form.toString(),
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: PAGE_USER_AGENT,
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  const result = safeJsonParse(response.body, { code: response.statusCode, message: response.body });
  if (isDebugEnabled()) {
    $.log(`账号${$.index} ${$.UserName}: reportInvokeLog => ${stringifySnippet(result)}`);
  }
  return result;
}

async function warmupPage(cookie) {
  const response = await got.get(PAGE_REFERER, {
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: 'https://pro.m.jd.com/',
      userAgent: PAGE_USER_AGENT,
      contentType: undefined,
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        priority: 'u=3, i',
      },
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  $.log(`账号${$.index} ${$.UserName}: 预热主会场 => status=${response.statusCode}`);
}

async function openActivityPage(cookie, activity) {
  const pageUrl = String(activity?.url || '');
  await reportInvokeLog(cookie, pageUrl);
  await sleep(EXTRA_BROWSE_WAIT_MS);
  const response = await got.get(pageUrl, {
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: PAGE_USER_AGENT,
      contentType: undefined,
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        priority: 'u=3, i',
        'request-from': 'native',
        'jd-hybrid-refer': 'https://pro.m.jd.com/',
      },
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  $.log(`账号${$.index} ${$.UserName}: 打开频道页 => ${pageUrl} | status=${response.statusCode}`);
  await sleep(BROWSE_WAIT_MS);
  await sleep(EXTRA_BROWSE_WAIT_MS);
}

async function doCommonTask(cookie, activity, assignmentId, actionType, jumpUrl = '') {
  const body = {
    channelId: CHANNEL_ID,
    itemId: activity.itemId,
    assignmentId,
    actionType,
    ext: actionType === 1
      ? { jumpUrl }
      : { doReceiveRewards: null },
  };
  const timestamp = Date.now();
  const bodyText = JSON.stringify(body);
  const baseHeaders = buildHeaders(cookie, {
    origin: 'https://pro.m.jd.com',
    referer: PAGE_REFERER,
    userAgent: PAGE_USER_AGENT,
    extraHeaders: COMMON_EXTRA_HEADERS,
  });
  let formFields = { body: bodyText };
  let headers = { ...baseHeaders };
  let mergedToken = '';

  try {
    const secured = await createBabelSecurityParams({
      formFields,
      headers,
      signSourceFields: {
        functionId: 'common_do_task',
        appid: COMMON_APPID,
        client: COMMON_CLIENT,
        clientVersion: COMMON_CLIENT_VERSION,
        t: String(timestamp),
        body: bodyText,
      },
      signerOptions: {
        appId: COMMON_H5ST_APP_ID,
        preRequest: false,
      },
      cookie,
      pageUrl: PAGE_REFERER,
      userAgent: PAGE_USER_AGENT,
      bizId: 'pro',
      scriptUrl: COMMON_BABEL_SECURITY_SCRIPT_URL,
    });
    mergedToken = secured?.formFields?.['x-api-eid-token'] || '';
    if (secured?.formFields?.h5st) {
      formFields = {
        body: bodyText,
        h5st: secured.formFields.h5st,
      };
      if (mergedToken) {
        formFields['x-api-eid-token'] = mergedToken;
      }
    } else {
      throw new Error(`babelSecurity 未生成有效 h5st: ${stringifySnippet(secured?.formFields || {}, 300)}`);
    }
    headers = secured.headers;
  } catch (error) {
    const eidToken = mergedToken || await resolveApiEidToken(cookie);
    formFields.h5st = await createCommonH5st(cookie, 'common_do_task', bodyText, timestamp);
    if (eidToken) {
      formFields['x-api-eid-token'] = eidToken;
    }
    $.log(`账号${$.index} ${$.UserName}: common_do_task mergeSecurityParams 失败，回退旧签名 => ${error.message}`);
  }

  const response = await got.post(buildCommonApiUrl('common_do_task', timestamp).toString(), {
    body: new URLSearchParams(formFields).toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  const result = safeJsonParse(response.body, { code: response.statusCode, message: response.body });
  const mergedCookie = extractSdToken(response)
    ? mergeCookieString(cookie, { sdtoken: extractSdToken(response) })
    : cookie;
  return attachUpdatedCookie(result, mergedCookie);
}

function findTaskByAssignmentId(taskList, assignmentId) {
  return taskList.find((task) => String(task?.encryptAssignmentId || '') === String(assignmentId));
}

async function handleTask(cookie, task) {
  $.log(`账号${$.index} ${$.UserName}: 尝试任务 => ${summarizeTask(task)}`);
  const pendingActivities = getPendingActivities(task);
  let localCompletion = Number(task?.completionCnt || 0);
  let currentCookie = cookie;

  for (const activity of pendingActivities) {
    $.log(`账号${$.index} ${$.UserName}: 逛频道 => itemId=${activity.itemId} | url=${activity.url}`);

    const startResponse = await doCommonTask(currentCookie, activity, task.encryptAssignmentId, 1, activity.url);
    currentCookie = startResponse?._cookie || currentCookie;
    $.log(`账号${$.index} ${$.UserName}: 领取/开始结果 => ${stringifySnippet(startResponse)}`);

    const startBizCode = Number(startResponse?.data?.bizCode ?? startResponse?.bizCode ?? -1);
    if (startBizCode !== 0) {
      $.log(`账号${$.index} ${$.UserName}: 开始任务未成功，跳过该频道 => bizCode=${startBizCode}`);
      continue;
    }

    await openActivityPage(currentCookie, activity);

    const finishResponse = await doCommonTask(currentCookie, activity, task.encryptAssignmentId, 0);
    currentCookie = finishResponse?._cookie || currentCookie;
    $.log(`账号${$.index} ${$.UserName}: 完成结果 => ${stringifySnippet(finishResponse)}`);

    const finishBizCode = Number(finishResponse?.data?.bizCode ?? finishResponse?.bizCode ?? -1);
    if (finishBizCode === 0) {
      localCompletion += 1;
      $.log(`账号${$.index} ${$.UserName}: 本地进度 => ${localCompletion}/${task.assignmentTimesLimit}`);
    }
  }

  const refreshed = await queryTaskList(currentCookie);
  const refreshedTask = findTaskByAssignmentId(normalizeTaskList(refreshed), task.encryptAssignmentId);
  if (refreshedTask) {
    $.log(`账号${$.index} ${$.UserName}: 刷新任务 => ${summarizeTask(refreshedTask)}`);
  } else {
    $.log(`账号${$.index} ${$.UserName}: 刷新后未找到任务 => ${task.assignmentName}`);
  }
  return refreshed?._cookie || currentCookie;
}

async function handleAccount(cookie, index) {
  $.index = index;
  $.UserName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${$.UserName} ====`);

  const taskCookie = await getTaskCookie(cookie);
  await warmupPage(taskCookie);
  const taskListResponse = await queryTaskList(taskCookie);
  if (isDebugEnabled()) {
    $.log(`账号${index} ${$.UserName}: common_task_list 原始返回 => ${stringifySnippet(taskListResponse)}`);
  }

  const taskList = normalizeTaskList(taskListResponse);
  const targetTasks = taskList.filter(isTargetTask);
  let currentCookie = taskListResponse?._cookie || taskCookie;

  $.log(`账号${index} ${$.UserName}: 目标任务数 => ${targetTasks.length}`);
  for (const task of targetTasks) {
    $.log(`账号${index} ${$.UserName}: 任务摘要 => ${summarizeTask(task)}`);
  }

  for (const task of targetTasks) {
    if (task.completionFlag || Number(task.completionCnt || 0) >= Number(task.assignmentTimesLimit || 0)) {
      $.log(`账号${index} ${$.UserName}: 跳过已完成任务 => ${summarizeTask(task)}`);
      continue;
    }
    currentCookie = await handleTask(currentCookie, task);
  }
}

(async () => {
  try {
    if (!cookies.length) {
      $.log('未找到有效的 JD_COOKIE');
      return;
    }

    let index = 0;
    for (const cookie of cookies) {
      index += 1;
      await handleAccount(cookie, index);
    }
  } catch (error) {
    $.log(`执行异常 => ${error.stack || error.message}`);
  } finally {
    $.done();
  }
})();
