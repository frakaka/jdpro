/*
cron:42 0 * * * jd_xinpin_hongbao_bean.js

新品红包浏览任务。

环境变量：
1. JD_XINPIN_HONGBAO_FULL_COOKIE
   可选，补充活动页完整 Cookie。

2. JD_XINPIN_HONGBAO_TARGETS
   可选，逗号分隔的任务名关键词。不配置时跑所有待逛的京豆/红包任务。

3. JD_XINPIN_HONGBAO_DEBUG
   可选，配置为 1 时打印接口原始返回片段。
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const got = require('got');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  createJsSecurityH5st,
  getGiasRiskContext,
  getRequestUuid,
  getUserAgent,
  getUserName,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('新品红包浏览任务');

const API_ENDPOINT = 'https://api.m.jd.com/';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3ejBfFZtaQMQ4RYpBxHekmm9vyrs/index.html';
const PAGE_REFERER = `${PAGE_URL}?stath=47&navh=44&spm=a0104.Babel_01697910&topOfHomePage=1&babelChannel=ttt30&tttparams=x0AMGI6JeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZGwiOjEsImRfYnJhbmQiOiJhcHBsZSIsImdMbmciOiIxMTMuMDM3MDIiLCJ1ZW1wcyI6IjAtMi0wIiwiZ0xhdCI6IjI4LjIxMDMxOSIsImxuZyI6IjExMy4wMzY4NzYiLCJvcmllbnQiOiJwIiwib3MiOiIyNi4yIiwibGJzTGF0IjoiMjguMjEwMzE5IiwibGJzTG5nIjoiMTEzLjAzNzAyIiwicHJzdGF0ZSI6IjAiLCJncHNfYXJlYSI6IjBfMF8wXzAiLCJzY2FsZSI6IjMiLCJhZGRyZXNzSWQiOiIxNTE1MjIwMDk4IiwidW5fYXJlYSI6IjE4XzE0ODJfMzYwNl82MDAwMCIsInJMbmciOiIxMTMuMDM3MDIiLCJ3aWR0aCI6IjExNzAiLCJsYnNBcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwickxhdCI6IjI4LjIxMDMxOSIsImxhdCI6IjI4LjIxMDI3NSIsIm1vZGVsIjoiaVBob25lMTQsNSIsInBvc0xhdCI6IjI4LjIxMDMxOSIsImFyZWFDb2RlIjoiMCIsImNvcm5lciI6MX80%3D&hybrid_err_view=1&has_native=0&homeNavH=139.00&mTabId=3ejBfFZtaQMQ4RYpBxHekmm9vyrs&useNativePV=1&embedMTab=1`;
const DEFAULT_PAGE_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777556587%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const APPID = 'newtry';
const DEFAULT_H5ST_APP_ID = '35fa0';
const CLIENT = 'apple';
const CLIENT_VERSION = '15.6.50';
const LOGIN_TYPE = '2';
const REQUEST_AREA = '18_1482_3606_60000';
const ACTIVITY_ID = '3ejBfFZtaQMQ4RYpBxHekmm9vyrs';
const PAGE_ID = '5830816';
const TASK_FLOOR_ID = '126454030';
const WORKFLOW_ID = '5b7b7ba0683542e3838798b04e2d8e92';
const BROWSE_WAIT_MS = 10000;
const JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_lite_0.1.5.js';
const COMMON_EXTRA_HEADERS = {
  'request-from': 'native',
  'sec-fetch-site': 'same-site',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  priority: 'u=3, i',
};
const DEFAULT_CHROME_BIN = '/usr/bin/chromium';
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_NAVIGATE_TIMEOUT_MS = 45000;
const CHROME_EVALUATE_TIMEOUT_MS = 900000;
const CHROME_SIGN_RUNTIME_TIMEOUT_MS = 45000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

function isDebugEnabled() {
  return process.env.JD_XINPIN_HONGBAO_DEBUG === '1';
}

function shouldPrintAllTasks() {
  return process.env.JD_XINPIN_HONGBAO_PRINT_ALL_TASKS !== '0';
}

function getRawResponseLogLimit() {
  const value = Number(process.env.JD_XINPIN_HONGBAO_RAW_LIMIT || 20000);
  return Number.isFinite(value) && value > 0 ? value : 20000;
}

function shouldUseChrome() {
  return process.env.JD_XINPIN_HONGBAO_USE_CHROME !== '0';
}

function getChromeBin() {
  return String(process.env.CHROME_BIN || process.env.JD_XINPIN_HONGBAO_CHROME_BIN || DEFAULT_CHROME_BIN).trim();
}

function getPageUserAgent() {
  const configuredUserAgent = String(process.env.JD_XINPIN_HONGBAO_USER_AGENT || '').trim();
  if (configuredUserAgent) {
    return configuredUserAgent;
  }
  if (process.env.JD_XINPIN_HONGBAO_DYNAMIC_UA === '1') {
    return getUserAgent(DEFAULT_PAGE_USER_AGENT);
  }
  return DEFAULT_PAGE_USER_AGENT;
}

function maskToken(value) {
  const text = String(value || '');
  if (text.length <= 16) {
    return text;
  }
  return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

function summarizeCookieKeys(cookie) {
  return Array.from(parseCookieString(cookie).keys()).join(',');
}

function debugRequest(functionId, url, formBody, h5st, eidToken) {
  if (!isDebugEnabled()) {
    return;
  }
  const h5stParts = String(h5st || '').split(';').slice(0, 7);
  $.log(`账号${$.index} ${$.UserName}: ${functionId} 请求URL => ${url}`);
  $.log(`账号${$.index} ${$.UserName}: ${functionId} form长度 => ${Buffer.byteLength(formBody)} | h5st长度 => ${String(h5st || '').length} | h5st段数 => ${String(h5st || '').split(';').length} | h5st头 => ${h5stParts.join(';')}`);
  $.log(`账号${$.index} ${$.UserName}: ${functionId} eid => ${maskToken(eidToken)} | form片段 => ${stringifySnippet(formBody, 500)}`);
}

function getTargetKeywords() {
  const rawValue = String(process.env.JD_XINPIN_HONGBAO_TARGETS || '').trim();
  return rawValue.split(',').map((item) => item.trim()).filter(Boolean);
}

function getMergedCookie(cookie) {
  const fullCookie = String(process.env.JD_XINPIN_HONGBAO_FULL_COOKIE || '').trim();
  return fullCookie ? mergeCookieString(fullCookie, cookie) : cookie;
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
  return { success: false, raw: result, _cookie: cookie };
}

async function getActivityCookie(cookie) {
  const mergedCookie = getMergedCookie(cookie);
  const pageUserAgent = getPageUserAgent();
  try {
    const risk = await getGiasRiskContext(mergedCookie, {
      pageUrl: PAGE_REFERER,
      userAgent: pageUserAgent,
      bizId: 'laputa',
    });
    const activityCookie = risk?.cookie ? mergeCookieString(mergedCookie, risk.cookie) : mergedCookie;
    if (isDebugEnabled()) {
      $.log(`账号${$.index} ${$.UserName}: 活动Cookie键 => ${summarizeCookieKeys(activityCookie)}`);
    }
    return activityCookie;
  } catch (error) {
    $.log(`账号${$.index} ${$.UserName}: gias 获取失败，继续使用当前 Cookie => ${error.message}`);
    return mergedCookie;
  }
}

function resolveApiEidToken(cookie) {
  const cookieMap = parseCookieString(cookie);
  return cookieMap.get('3AB9D23F7A4B3CSS') || '';
}

function createStableH5stFp(cookie) {
  const configuredFp = String(process.env.JD_XINPIN_HONGBAO_H5ST_FP || '').trim();
  if (/^[a-z0-9]{16}$/i.test(configuredFp)) {
    return configuredFp;
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seed = crypto
    .createHash('sha256')
    .update(`${getUserName(cookie)}:${ACTIVITY_ID}:${getH5stAppId()}`)
    .digest();
  let fp = '';
  for (let index = 0; index < 16; index += 1) {
    fp += alphabet[seed[index] % alphabet.length];
  }
  return fp;
}

function buildH5stLocalStorageSeed(cookie) {
  const fp = createStableH5stFp(cookie);
  const h5stAppId = getH5stAppId();
  return {
    WQ_dy1_vk: JSON.stringify({
      '5.3': {
        [h5stAppId]: {
          e: 31536000,
          v: fp,
          t: Date.now(),
        },
      },
    }),
  };
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex');
}

function getSignBodyText(bodyText) {
  const mode = String(process.env.JD_XINPIN_HONGBAO_SIGN_BODY_MODE || 'raw').trim().toLowerCase();
  if (mode === 'sha256') {
    return sha256Hex(bodyText);
  }
  if (mode === 'encoded') {
    return encodeURIComponent(bodyText);
  }
  if (mode === 'sha256_encoded') {
    return sha256Hex(encodeURIComponent(bodyText));
  }
  return bodyText;
}

function buildApiUrl(functionId, timestamp = Date.now(), options = {}) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('area', REQUEST_AREA);
  url.searchParams.set('clientVersion', CLIENT_VERSION);
  url.searchParams.set('client', CLIENT);
  url.searchParams.set('loginType', LOGIN_TYPE);
  url.searchParams.set('t', String(timestamp));
  url.searchParams.set('appid', APPID);
  url.searchParams.set('xAPIClientLanguage', 'zh_CN');
  url.searchParams.set('functionId', functionId);
  if (options.withUuid) {
    url.searchParams.set('uuid', getRequestUuid($.currentCookie || ''));
  }
  return url;
}

function getH5stAppId() {
  return String(process.env.JD_XINPIN_HONGBAO_H5ST_APP_ID || DEFAULT_H5ST_APP_ID).trim() || DEFAULT_H5ST_APP_ID;
}

async function signForm(cookie, functionId, bodyText, timestamp) {
  const pageUserAgent = getPageUserAgent();
  const bodySignText = getSignBodyText(bodyText);
  return createJsSecurityH5st({
    h5stAppId: getH5stAppId(),
    formFields: {
      functionId,
      appid: APPID,
      client: CLIENT,
      t: String(timestamp),
      body: bodySignText,
      clientVersion: CLIENT_VERSION,
    },
    cookie,
    userAgent: pageUserAgent,
    pageUrl: PAGE_REFERER,
    scriptUrl: JS_SECURITY_SCRIPT_URL,
    bizId: 'pro',
    localStorageSeed: buildH5stLocalStorageSeed(cookie),
    signerOptions: {
      preRequest: true,
      skipManualPrepare: process.env.JD_XINPIN_HONGBAO_SKIP_MANUAL_PREPARE === '1',
    },
  });
}

async function postNewtry(cookie, functionId, bodyObject, options = {}) {
  const timestamp = Date.now();
  const bodyText = JSON.stringify(bodyObject);
  const h5st = await signForm(cookie, functionId, bodyText, timestamp);
  const formParts = [
    `body=${encodeURIComponent(bodyText)}`,
    `h5st=${encodeURI(h5st)}`,
  ];

  const eidToken = resolveApiEidToken(cookie);
  if (eidToken) {
    formParts.push(`x-api-eid-token=${eidToken}`);
  }

  const requestUrl = buildApiUrl(functionId, timestamp, options).toString();
  const formBody = formParts.join('&');
  debugRequest(functionId, requestUrl, formBody, h5st, eidToken);

  const response = await got.post(requestUrl, {
    body: formBody,
    http2: process.env.JD_XINPIN_HONGBAO_HTTP2 === '1',
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: getPageUserAgent(),
      extraHeaders: COMMON_EXTRA_HEADERS,
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  const result = safeJsonParse(response.body, { code: response.statusCode, message: response.body });
  if (isDebugEnabled() && functionId === 'qryH5BabelFloors') {
    $.log(`账号${$.index} ${$.UserName}: qryH5BabelFloors 原始response => ${String(response.body || '').slice(0, getRawResponseLogLimit())}`);
  }
  const sdtoken = extractSdToken(response);
  const nextCookie = sdtoken ? mergeCookieString(cookie, { sdtoken }) : cookie;
  return attachUpdatedCookie(result, nextCookie);
}

async function queryBabelFloors(cookie) {
  const body = {
    activityId: ACTIVITY_ID,
    pageId: PAGE_ID,
    queryFloorsParam: {
      floorParams: {
        [TASK_FLOOR_ID]: {
          channel: '',
          showTask: '1',
        },
      },
      type: 2,
    },
  };
  const result = await postNewtry(cookie, 'qryH5BabelFloors', body);
  if (isDebugEnabled()) {
    $.log(`账号${$.index} ${$.UserName}: qryH5BabelFloors => ${stringifySnippet(result, 1200)}`);
  }
  return result;
}

function getAssignments(response) {
  return response?.floorResponse?.[TASK_FLOOR_ID]?.providerData?.data?.assignments?.assignmentList || [];
}

function hasRewardKeyword(task) {
  const taskText = JSON.stringify({
    name: task?.assignmentName,
    desc: task?.assignmentDesc,
    rewards: task?.rewards,
  });
  return /京豆|新品红包|红包/.test(taskText);
}

function isPendingItem(item) {
  return String(item?.status ?? item?.taskStatus ?? '1') !== '2' && Boolean(item?.url);
}

function isTaskNameAllowed(task, keywords) {
  if (!keywords.length) {
    return true;
  }
  const taskName = String(task?.assignmentName || '');
  return keywords.some((keyword) => taskName.includes(keyword));
}

function isTargetTask(task, keywords) {
  const ext = task?.ext || {};
  const items = Array.isArray(ext.shoppingActivity) ? ext.shoppingActivity : [];
  return (
    isTaskNameAllowed(task, keywords) &&
    Number(ext.waitDuration || 0) >= 0 &&
    items.some(isPendingItem) &&
    hasRewardKeyword(task)
  );
}

function summarizeTask(task) {
  const ext = task?.ext || {};
  const items = Array.isArray(ext.shoppingActivity) ? ext.shoppingActivity : [];
  const rewardText = (task?.rewards || [])
    .map((reward) => reward.rewardName || reward.rewardValue || reward.discount)
    .filter(Boolean)
    .join('/');
  const pendingCount = items.filter(isPendingItem).length;
  return `${task.assignmentName} | encAid=${task.encryptAssignmentId} | 待逛=${pendingCount}/${items.length} | reward=${rewardText || '-'}`;
}

function summarizeTargetFilter(task, keywords) {
  const ext = task?.ext || {};
  const items = Array.isArray(ext.shoppingActivity) ? ext.shoppingActivity : [];
  const keywordHit = isTaskNameAllowed(task, keywords);
  return `${summarizeTask(task)} | keyword=${keywordHit} | reward=${hasRewardKeyword(task)} | wait=${ext.waitDuration ?? '-'} | statuses=${items.map((item) => `${item.title || item.itemId}:${item.status ?? item.taskStatus ?? '-'}`).join(',') || '-'}`;
}

function extractOpenAppTaskUrl(toUrl) {
  const raw = String(toUrl || '');
  const match = raw.match(/[?&]params=([^&]+)/);
  if (!match) {
    return '';
  }
  try {
    const params = JSON.parse(decodeURIComponent(match[1]));
    return params.taskUrl || '';
  } catch (error) {
    return '';
  }
}

async function openBrowsePage(cookie, fallbackUrl, taskUrl) {
  const pageUrl = taskUrl || fallbackUrl;
  const response = await got.get(pageUrl, {
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: PAGE_REFERER,
      userAgent: getPageUserAgent(),
      contentType: undefined,
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        priority: 'u=3, i',
        'request-from': 'native',
      },
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });
  $.log(`账号${$.index} ${$.UserName}: 打开频道页 => ${pageUrl} | status=${response.statusCode}`);
  await sleep(BROWSE_WAIT_MS);
}

async function executeWorkflow(cookie, action, task, item, extraBody = {}) {
  const body = {
    workflowId: WORKFLOW_ID,
    action,
    encAid: task.encryptAssignmentId,
    itemId: String(item.itemId),
    interactNum: 0,
    ...extraBody,
  };
  return postNewtry(cookie, 'luban_executeWorkflow', body, { withUuid: true });
}

async function runTask(cookie, task) {
  $.log(`账号${$.index} ${$.UserName}: 尝试任务 => ${summarizeTask(task)}`);
  const items = (task?.ext?.shoppingActivity || []).filter(isPendingItem);
  let currentCookie = cookie;

  for (const item of items) {
    $.log(`账号${$.index} ${$.UserName}: 逛频道 => ${item.title || item.itemId} | itemId=${item.itemId}`);

    const startResult = await executeWorkflow(currentCookie, 1, task, item, { jumpUrl: item.url });
    currentCookie = startResult?._cookie || currentCookie;
    $.log(`账号${$.index} ${$.UserName}: 开始结果 => ${stringifySnippet(startResult)}`);

    const startOk = String(startResult?.subCode ?? '') === '1' || String(startResult?.msg || '').includes('成功');
    if (!startOk) {
      $.log(`账号${$.index} ${$.UserName}: 开始失败，继续下一个频道`);
      continue;
    }

    const taskUrl = extractOpenAppTaskUrl(startResult?.assignmentInfo?.toUrl);
    await openBrowsePage(currentCookie, item.url, taskUrl);

    const finishResult = await executeWorkflow(currentCookie, 0, task, item, { completionFlag: true });
    currentCookie = finishResult?._cookie || currentCookie;
    $.log(`账号${$.index} ${$.UserName}: 完成结果 => ${stringifySnippet(finishResult)}`);
  }

  return currentCookie;
}

async function warmupPage(cookie) {
  const response = await got.get(PAGE_REFERER, {
    headers: buildHeaders(cookie, {
      origin: 'https://pro.m.jd.com',
      referer: 'https://pro.m.jd.com/',
      userAgent: getPageUserAgent(),
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
  $.log(`账号${$.index} ${$.UserName}: 预热新品会场 => status=${response.statusCode}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, CHROME_DEBUG_HOST, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChromeJson(port, pathname, timeoutMs = CHROME_START_TIMEOUT_MS) {
  const startedAt = Date.now();
  const url = `http://${CHROME_DEBUG_HOST}:${port}${pathname}`;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await got.get(url, {
        throwHttpErrors: false,
        timeout: { request: 1000 },
      });
      if (response.statusCode >= 200 && response.statusCode < 300 && response.body) {
        return JSON.parse(response.body);
      }
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }

  throw new Error(`Chrome DevTools 启动超时: ${lastError?.message || url}`);
}

class ChromeCdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on('message', (rawMessage) => this.handleMessage(rawMessage));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 Chrome DevTools 超时')), CHROME_START_TIMEOUT_MS);
      this.ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  handleMessage(rawMessage) {
    const message = safeJsonParse(String(rawMessage), null);
    if (!message) {
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(`${message.error.message || 'CDP 调用失败'} ${stringifySnippet(message.error.data || '', 300)}`));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    const waiters = this.eventWaiters.get(message.method);
    if (!waiters?.length) {
      return;
    }
    const waiter = waiters.shift();
    clearTimeout(waiter.timer);
    waiter.resolve(message.params || {});
  }

  send(method, params = {}, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools 未连接'));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 调用超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, waiters.filter((item) => item.timer !== timer));
        reject(new Error(`等待 Chrome 事件超时: ${method}`));
      }, timeoutMs);
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push({ resolve, timer });
      this.eventWaiters.set(method, waiters);
    });
  }

  async close() {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      return;
    }
    await new Promise((resolve) => {
      this.ws.once('close', resolve);
      this.ws.close();
      setTimeout(resolve, 500);
    });
  }
}

async function launchChrome() {
  const chromeBin = getChromeBin();
  if (!fs.existsSync(chromeBin)) {
    throw new Error(`未找到 Chrome/Chromium: ${chromeBin}`);
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-xinpin-chrome-'));
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--mute-audio',
    `--remote-debugging-address=${CHROME_DEBUG_HOST}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  const chrome = spawn(chromeBin, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  chrome.once('exit', (code, signal) => {
    if (isDebugEnabled()) {
      $.log(`Chrome 已退出 => code=${code} signal=${signal || ''}`);
    }
  });

  try {
    await waitForChromeJson(port, '/json/version');
    const pages = await waitForChromeJson(port, '/json/list');
    const pageInfo = pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl) || pages[0];
    if (!pageInfo?.webSocketDebuggerUrl) {
      throw new Error('Chrome 未返回可调试页面');
    }
    const page = new ChromeCdpPage(pageInfo.webSocketDebuggerUrl);
    await page.connect();
    return { chrome, page, userDataDir };
  } catch (error) {
    chrome.kill('SIGTERM');
    throw error;
  }
}

async function closeChrome(runtime) {
  if (!runtime) {
    return;
  }
  await runtime.page?.close();
  if (runtime.chrome && !runtime.chrome.killed) {
    runtime.chrome.kill('SIGTERM');
  }
  if (runtime.userDataDir) {
    try {
      fs.rmSync(runtime.userDataDir, { recursive: true, force: true });
    } catch (error) {
      // 临时目录清理失败不影响任务结果。
    }
  }
}

function buildChromeTaskExpression(cookie) {
  const params = {
    cookie: getMergedCookie(cookie),
    pageReferer: PAGE_REFERER,
    pageUrl: PAGE_URL,
    userAgent: getPageUserAgent(),
    activityId: ACTIVITY_ID,
    pageId: PAGE_ID,
    taskFloorId: TASK_FLOOR_ID,
    workflowId: WORKFLOW_ID,
    appid: APPID,
    h5stAppId: getH5stAppId(),
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    loginType: LOGIN_TYPE,
    area: REQUEST_AREA,
    browseWaitMs: BROWSE_WAIT_MS,
    targetKeywords: getTargetKeywords(),
    debug: isDebugEnabled(),
    printAllTasks: shouldPrintAllTasks(),
    rawLogLimit: getRawResponseLogLimit(),
    signRuntimeTimeoutMs: CHROME_SIGN_RUNTIME_TIMEOUT_MS,
    jsSecurityScriptUrl: JS_SECURITY_SCRIPT_URL,
  };

  return `(${async function runXinpinHongbaoInChrome(input) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const logs = [];
    const log = (message) => logs.push(message);
    const safeJson = (content, fallback = null) => {
      try {
        return JSON.parse(content);
      } catch (error) {
        return fallback;
      }
    };
    const setCookie = (rawCookie) => {
      String(rawCookie || '')
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => {
          const index = item.indexOf('=');
          if (index <= 0) {
            return;
          }
          const key = item.slice(0, index).trim();
          const value = item.slice(index + 1).trim();
          if (!key || !value) {
            return;
          }
          document.cookie = `${key}=${value}; domain=.jd.com; path=/`;
        });
    };
    const waitFor = async (predicate, timeoutMs, label) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
          return;
        }
        await sleep(200);
      }
      throw new Error(`等待页面运行态超时: ${label}`);
    };
    const loadScript = (url, timeoutMs) => new Promise((resolve, reject) => {
      const existingScript = Array.from(document.scripts).find((script) => script.src === url);
      if (existingScript && existingScript.dataset.loaded === '1') {
        resolve();
        return;
      }
      const script = existingScript || document.createElement('script');
      const timer = setTimeout(() => reject(new Error(`加载脚本超时: ${url}`)), timeoutMs);
      script.onload = () => {
        clearTimeout(timer);
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`加载脚本失败: ${url}`));
      };
      if (!existingScript) {
        script.src = url;
        document.head.appendChild(script);
      }
    });
    const ensureSignRuntime = async () => {
      try {
        await waitFor(() => typeof window.ParamsSignLite === 'function', 15000, 'ParamsSignLite');
      } catch (error) {
        log(`Chrome 签名运行态未自动加载，注入脚本 => ${input.jsSecurityScriptUrl}`);
        await loadScript(input.jsSecurityScriptUrl, 15000);
        await waitFor(() => typeof window.ParamsSignLite === 'function', input.signRuntimeTimeoutMs, 'ParamsSignLite');
      }
      try {
        await waitFor(() => typeof window.getJsToken === 'function', 15000, 'getJsToken');
      } catch (error) {
        await loadScript(input.jsSecurityScriptUrl, 15000).catch(() => null);
        await waitFor(() => typeof window.getJsToken === 'function', input.signRuntimeTimeoutMs, 'getJsToken');
      }
    };
    const getRequestUuid = () => {
      const cookieMap = new Map(document.cookie.split(';').map((item) => {
        const index = item.trim().indexOf('=');
        if (index <= 0) {
          return ['', ''];
        }
        return [item.trim().slice(0, index), item.trim().slice(index + 1)];
      }));
      const jda = cookieMap.get('__jda') || '';
      const jdaParts = jda.split('.');
      return jdaParts[1] || cookieMap.get('mba_muid') || cookieMap.get('__jdu') || cookieMap.get('pt_pin') || String(Date.now());
    };
    const buildApiUrl = (functionId, timestamp, withUuid = false) => {
      const url = new URL('https://api.m.jd.com/');
      url.searchParams.set('area', input.area);
      url.searchParams.set('clientVersion', input.clientVersion);
      url.searchParams.set('client', input.client);
      url.searchParams.set('loginType', input.loginType);
      url.searchParams.set('t', String(timestamp));
      url.searchParams.set('appid', input.appid);
      url.searchParams.set('xAPIClientLanguage', 'zh_CN');
      url.searchParams.set('functionId', functionId);
      if (withUuid) {
        url.searchParams.set('uuid', getRequestUuid());
      }
      return url.toString();
    };
    const getJsToken = () => new Promise((resolve) => {
      try {
        window.getJsToken((result) => resolve(result?.jsToken || ''), 600);
      } catch (error) {
        resolve('');
      }
    });
    const postNewtry = async (functionId, bodyObject, options = {}) => {
      const bodyText = JSON.stringify(bodyObject);
      const timestamp = Date.now();
      const signer = new window.ParamsSignLite({ appId: input.h5stAppId, preRequest: true });
      const signResult = await signer.sign({
        functionId,
        appid: input.appid,
        client: input.client,
        t: String(timestamp),
        body: bodyText,
        clientVersion: input.clientVersion,
      });
      const eidToken = await getJsToken();
      const form = [
        `body=${encodeURIComponent(bodyText)}`,
        `h5st=${encodeURI(signResult.h5st || '')}`,
        eidToken ? `x-api-eid-token=${eidToken}` : '',
      ].filter(Boolean).join('&');
      if (input.debug) {
        log(`${functionId} h5stLen=${String(signResult.h5st || '').length} eid=${eidToken.slice(0, 16)}...`);
      }
      const response = await fetch(buildApiUrl(functionId, timestamp, options.withUuid), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      const text = await response.text();
      return {
        parsed: safeJson(text, { code: response.status, message: text }),
        raw: text,
      };
    };
    const queryBabelFloors = async () => {
      const response = await postNewtry('qryH5BabelFloors', {
        activityId: input.activityId,
        pageId: input.pageId,
        queryFloorsParam: {
          floorParams: {
            [input.taskFloorId]: {
              channel: '',
              showTask: '1',
            },
          },
          type: 2,
        },
      });
      if (input.debug) {
        const raw = response.raw || '';
        log(`Chrome qryH5BabelFloors 原始response => ${raw.slice(0, input.rawLogLimit)}`);
      }
      return response.parsed;
    };
    const getAssignments = (response) => response?.floorResponse?.[input.taskFloorId]?.providerData?.data?.assignments?.assignmentList || [];
    const isPendingItem = (item) => String(item?.status ?? item?.taskStatus ?? '1') !== '2' && Boolean(item?.url);
    const hasRewardKeyword = (task) => /京豆|新品红包|红包/.test(JSON.stringify({
      name: task?.assignmentName,
      desc: task?.assignmentDesc,
      rewards: task?.rewards,
    }));
    const isTaskNameAllowed = (task) => {
      if (!input.targetKeywords.length) {
        return true;
      }
      const taskName = String(task?.assignmentName || '');
      return input.targetKeywords.some((keyword) => taskName.includes(keyword));
    };
    const summarizeReward = (task) => (task?.rewards || [])
      .map((reward) => reward.rewardName || reward.rewardValue || reward.discount)
      .filter(Boolean)
      .join('/') || '-';
    const isTargetTask = (task) => {
      const items = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
      return isTaskNameAllowed(task) && items.some(isPendingItem) && hasRewardKeyword(task);
    };
    const summarizeTask = (task) => {
      const items = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
      const reward = summarizeReward(task);
      const itemStatus = items.map((item) => `${item.title || item.itemId}:${item.status ?? item.taskStatus ?? '-'}`).join(',');
      return `${task.assignmentName} | encAid=${task.encryptAssignmentId} | 待逛=${items.filter(isPendingItem).length}/${items.length} | reward=${reward} | itemStatus=${itemStatus || '-'}`;
    };
    const executeWorkflow = async (action, task, item, extraBody = {}) => {
      const response = await postNewtry('luban_executeWorkflow', {
        workflowId: input.workflowId,
        action,
        encAid: task.encryptAssignmentId,
        itemId: String(item.itemId),
        interactNum: 0,
        ...extraBody,
      }, { withUuid: true });
      return response.parsed;
    };

    setCookie(input.cookie);
    await ensureSignRuntime();

    const floors = await queryBabelFloors();
    const assignments = getAssignments(floors);
    const targetTasks = assignments.filter(isTargetTask);
    log(`Chrome qryH5BabelFloors => code=${floors?.code || '-'} isLogin=${floors?.isLogin} assignments=${assignments.length}`);
    if (input.printAllTasks) {
      assignments.forEach((task, index) => {
        log(`Chrome 任务条目${index + 1} => ${summarizeTask(task)}`);
      });
    }
    log(`Chrome 目标浏览任务数 => ${targetTasks.length}`);
    targetTasks.forEach((task) => log(`Chrome 任务摘要 => ${summarizeTask(task)}`));
    if (!targetTasks.length) {
      const keywordCandidates = assignments.filter((task) => {
        if (!input.targetKeywords.length) {
          return false;
        }
        const taskName = String(task?.assignmentName || '');
        return input.targetKeywords.some((keyword) => taskName.includes(keyword));
      });
      keywordCandidates.forEach((task) => {
        const items = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
        log(`Chrome 目标候选已过滤 => ${summarizeTask(task)} | reward=${summarizeReward(task)} | statuses=${items.map((item) => `${item.title || item.itemId}:${item.status ?? item.taskStatus ?? '-'}`).join(',') || '-'}`);
      });
      if (!keywordCandidates.length) {
        assignments.slice(0, 10).forEach((task) => {
          log(`Chrome 非目标任务样例 => ${summarizeTask(task)} | reward=${summarizeReward(task)}`);
        });
      }
    }

    for (const task of targetTasks) {
      const items = (task?.ext?.shoppingActivity || []).filter(isPendingItem);
      for (const item of items) {
        log(`Chrome 逛频道 => ${task.assignmentName} | ${item.title || item.itemId}`);
        const startResult = await executeWorkflow(1, task, item, { jumpUrl: item.url });
        log(`Chrome 开始结果 => ${startResult?.msg || '-'} | subCode=${startResult?.subCode ?? '-'}`);
        const startOk = String(startResult?.subCode ?? '') === '1' || String(startResult?.msg || '').includes('成功');
        if (!startOk) {
          continue;
        }
        try {
          await fetch(item.url, { credentials: 'include', mode: 'no-cors' });
        } catch (error) {
          // 部分频道跨域不可读，真实浏览停留时间仍继续。
        }
        await sleep(input.browseWaitMs);
        const finishResult = await executeWorkflow(0, task, item, { completionFlag: true });
        log(`Chrome 完成结果 => ${finishResult?.msg || '-'} | subCode=${finishResult?.subCode ?? '-'}`);
      }
    }

    const refreshed = await queryBabelFloors();
    const refreshedTargets = getAssignments(refreshed).filter(isTargetTask);
    log(`Chrome 刷新后剩余目标任务数 => ${refreshedTargets.length}`);
    refreshedTargets.forEach((task) => log(`Chrome 剩余任务 => ${summarizeTask(task)}`));
    return {
      ok: true,
      logs,
      assignments: assignments.length,
      targetCount: targetTasks.length,
      remainingTargetCount: refreshedTargets.length,
    };
  }})(${JSON.stringify(params)})`;
}

async function runChromeAccount(cookie, index) {
  $.index = index;
  $.UserName = getUserName(cookie);
  $.currentCookie = cookie;
  $.log(`\n==== 账号${index} ${$.UserName} ====`);
  $.log(`账号${index} ${$.UserName}: 使用 Chrome 模式 => ${getChromeBin()}`);

  let runtime = null;
  try {
    runtime = await launchChrome();
    const { page } = runtime;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: getPageUserAgent(),
      platform: 'iPhone',
      acceptLanguage: 'zh-CN,zh-Hans;q=0.9',
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await page.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
    const loadEvent = page.waitForEvent('Page.loadEventFired', CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
    await page.send('Page.navigate', { url: PAGE_REFERER }, CHROME_NAVIGATE_TIMEOUT_MS);
    await loadEvent;
    const expression = buildChromeTaskExpression(cookie);
    if (isDebugEnabled()) {
      fs.writeFileSync('/tmp/jd_xinpin_hongbao_chrome_expr.js', expression);
    }
    const result = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: CHROME_EVALUATE_TIMEOUT_MS,
    }, CHROME_EVALUATE_TIMEOUT_MS + 5000);
    if (result.exceptionDetails) {
      throw new Error(`Chrome 执行异常: ${stringifySnippet(result.exceptionDetails, 1000)}`);
    }
    const value = result.result?.value;
    if (!value?.ok) {
      throw new Error(`Chrome 任务未成功返回: ${stringifySnippet(value, 1000)}`);
    }
    for (const logLine of value.logs || []) {
      $.log(`账号${index} ${$.UserName}: ${logLine}`);
    }
  } finally {
    await closeChrome(runtime);
  }
}

async function handleAccount(cookie, index) {
  $.index = index;
  $.UserName = getUserName(cookie);
  $.currentCookie = cookie;
  $.log(`\n==== 账号${index} ${$.UserName} ====`);

  let currentCookie = await getActivityCookie(cookie);
  $.currentCookie = currentCookie;
  await warmupPage(currentCookie);

  const floors = await queryBabelFloors(currentCookie);
  currentCookie = floors?._cookie || currentCookie;
  $.currentCookie = currentCookie;
  const assignments = getAssignments(floors);
  const targetTasks = assignments.filter((task) => isTargetTask(task, getTargetKeywords()));

  $.log(`账号${index} ${$.UserName}: 新品任务数 => ${assignments.length}`);
  if (shouldPrintAllTasks()) {
    assignments.forEach((task, taskIndex) => {
      $.log(`账号${index} ${$.UserName}: 任务条目${taskIndex + 1} => ${summarizeTask(task)}`);
    });
  }
  $.log(`账号${index} ${$.UserName}: 目标浏览任务数 => ${targetTasks.length}`);
  for (const task of targetTasks) {
    $.log(`账号${index} ${$.UserName}: 任务摘要 => ${summarizeTask(task)}`);
  }
  if (!targetTasks.length) {
    const keywords = getTargetKeywords();
    const keywordCandidates = assignments.filter((task) => keywords.some((keyword) => String(task?.assignmentName || '').includes(keyword)));
    for (const task of keywordCandidates) {
      $.log(`账号${index} ${$.UserName}: 目标候选已过滤 => ${summarizeTargetFilter(task, keywords)}`);
    }
  }

  for (const task of targetTasks) {
    currentCookie = await runTask(currentCookie, task);
    $.currentCookie = currentCookie;
  }

  const refreshed = await queryBabelFloors(currentCookie);
  const refreshedTargets = getAssignments(refreshed).filter((task) => isTargetTask(task, getTargetKeywords()));
  $.log(`账号${index} ${$.UserName}: 刷新后剩余目标任务数 => ${refreshedTargets.length}`);
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
      if (shouldUseChrome()) {
        await runChromeAccount(cookie, index);
      } else {
        await handleAccount(cookie, index);
      }
    }
  } catch (error) {
    $.log(`执行异常 => ${error.stack || error.message}`);
  } finally {
    $.done();
  }
})();
