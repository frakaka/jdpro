'use strict';

const Module = require('module');
const got = require('got');

let userAgents = {};
try {
  userAgents = require('../USER_AGENTS');
} catch (error) {
  userAgents = {};
}

let h5stFactory = null;
let h5stShimInstalled = false;

const DEFAULT_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const DEFAULT_JR_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.70&HiClVersion=8.1.70&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR';
const REQUEST_TIMEOUT_MS = 15000;

function Env(name) {
  return {
    name,
    startTime: Date.now(),
    log(...messages) {
      console.log(messages.join('\n'));
    },
    done() {
      const seconds = ((Date.now() - this.startTime) / 1000).toFixed(3);
      this.log('', `🔔${this.name}, 结束! 🕛 ${seconds} 秒`, '');
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUserName(cookie) {
  const match = String(cookie || '').match(/pt_pin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '未知账号';
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = String(cookie || '').match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
}

function getRequestUuid(cookie) {
  const jda = getCookieValue(cookie, '__jda');
  if (jda) {
    const parts = jda.split('.');
    if (parts.length >= 2 && parts[1]) {
      return parts[1];
    }
  }

  for (const key of ['mba_muid', '__jdu', 'pt_pin']) {
    const value = getCookieValue(cookie, key);
    if (value) {
      return value;
    }
  }

  return String(Date.now());
}

function getUserAgent(fallback = DEFAULT_USER_AGENT) {
  try {
    if (typeof userAgents.UARAM === 'function') {
      return userAgents.UARAM();
    }
    if (userAgents.USER_AGENT) {
      return userAgents.USER_AGENT;
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function safeJsonParse(content, fallback = null) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function stringifySnippet(value, maxLength = 800) {
  let content;
  try {
    content = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    content = String(value);
  }
  return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
}

function appendFormValue(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.set(key, String(value));
  }
}

function parseApiResponse(response) {
  const responseText = (response.body || '').trim();
  const httpStatus = response.statusCode;

  if (!responseText) {
    return {
      success: false,
      httpStatus,
      message: httpStatus >= 400 ? `HTTP ${httpStatus}` : '空响应',
    };
  }

  if (httpStatus >= 400) {
    return {
      success: false,
      httpStatus,
      message: `HTTP ${httpStatus}`,
      responseSnippet: stringifySnippet(responseText),
    };
  }

  return safeJsonParse(responseText, responseText);
}

function formatDate(date, pattern) {
  const current = date instanceof Date ? date : new Date(date);
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return String(pattern)
    .replace('yyyy', String(current.getFullYear()))
    .replace('MM', pad(current.getMonth() + 1))
    .replace('dd', pad(current.getDate()))
    .replace('HH', pad(current.getHours()))
    .replace('mm', pad(current.getMinutes()))
    .replace('ss', pad(current.getSeconds()))
    .replace('SSS', pad(current.getMilliseconds(), 3));
}

function installDateFnsShim() {
  if (h5stShimInstalled) {
    return;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'date-fns') {
      return { format: formatDate };
    }
    return originalLoad.apply(this, arguments);
  };
  h5stShimInstalled = true;
}

function getH5stFactory() {
  if (h5stFactory) {
    return h5stFactory;
  }

  installDateFnsShim();
  h5stFactory = require('./h5st41.js');
  return h5stFactory;
}

async function createH5st(options) {
  const {
    functionId,
    body,
    h5stAppId,
    requestAppid,
    cookie,
    userAgent = DEFAULT_USER_AGENT,
    client = 'wh5',
    clientVersion = '1.0.0',
    version = '5.3',
  } = options;

  const H5ST = getH5stFactory();
  const signer = new H5ST({
    appId: h5stAppId,
    appid: requestAppid,
    client,
    clientVersion,
    pin: getUserName(cookie),
    ua: userAgent,
    version,
  });

  await signer.genAlgo();
  const query = await signer.genUrlParams(functionId, body || {}, true);
  return new URLSearchParams(query).get('h5st') || '';
}

function buildHeaders(cookie, options = {}) {
  const {
    origin = 'https://pro.m.jd.com',
    referer = 'https://pro.m.jd.com/',
    userAgent = getUserAgent(),
    contentType = 'application/x-www-form-urlencoded',
  } = options;

  const headers = {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: origin,
    Referer: referer,
    'User-Agent': userAgent,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

async function postFormApi(cookie, options) {
  const {
    endpoint = 'https://api.m.jd.com/',
    functionId,
    appid,
    body = {},
    client = '',
    loginType = '',
    loginWQBiz = '',
    h5stAppId = '',
    h5stVersion = '5.3',
    userAgent = getUserAgent(),
    origin,
    referer,
    extraForm = {},
    includeUuid = false,
  } = options;

  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  const form = new URLSearchParams();
  appendFormValue(form, 'appid', appid);
  appendFormValue(form, 'loginType', loginType);
  appendFormValue(form, 'loginWQBiz', loginWQBiz);
  appendFormValue(form, 'functionId', functionId);
  appendFormValue(form, 'body', bodyText);
  appendFormValue(form, 'client', client);
  if (includeUuid) {
    appendFormValue(form, 'uuid', getRequestUuid(cookie));
  }

  for (const [key, value] of Object.entries(extraForm)) {
    appendFormValue(form, key, value);
  }

  if (h5stAppId) {
    const h5st = await createH5st({
      functionId,
      body,
      h5stAppId,
      requestAppid: appid,
      cookie,
      userAgent,
      client: client || 'wh5',
      version: h5stVersion,
    });
    appendFormValue(form, 'h5st', h5st);
  }

  const response = await got.post(`${endpoint}?functionId=${encodeURIComponent(functionId)}`, {
    body: form.toString(),
    headers: buildHeaders(cookie, { origin, referer, userAgent }),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  return parseApiResponse(response);
}

async function getQueryApi(cookie, options) {
  const {
    endpoint,
    functionId,
    appid,
    body = {},
    h5stAppId = '',
    h5stVersion = '5.3',
    userAgent = getUserAgent(),
    origin,
    referer,
    extraQuery = {},
  } = options;

  const url = new URL(endpoint);
  url.searchParams.set('functionId', functionId);
  url.searchParams.set('body', JSON.stringify(body));
  url.searchParams.set('appid', appid);

  if (h5stAppId) {
    const h5st = await createH5st({
      functionId,
      body,
      h5stAppId,
      requestAppid: appid,
      cookie,
      userAgent,
      version: h5stVersion,
    });
    url.searchParams.set('h5st', h5st);
  }

  for (const [key, value] of Object.entries(extraQuery)) {
    appendFormValue(url.searchParams, key, value);
  }

  const response = await got.get(url.toString(), {
    headers: buildHeaders(cookie, {
      origin,
      referer,
      userAgent,
      contentType: undefined,
    }),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  return parseApiResponse(response);
}

function hasJingBeanReward(task) {
  const reward = task?.reward || {};
  const rewards = [
    reward,
    ...(Array.isArray(task?.rewards) ? task.rewards : []),
    ...(Array.isArray(task?.rewardsList) ? task.rewardsList : []),
  ];

  return rewards.some((item) => {
    const rewardType = String(item?.rewardType || '');
    const rewardName = String(item?.rewardName || item?.name || '');
    return rewardType === '3' || rewardName.includes('京豆');
  });
}

module.exports = {
  buildHeaders,
  createH5st,
  DEFAULT_JR_USER_AGENT,
  DEFAULT_USER_AGENT,
  Env,
  getQueryApi,
  getRequestUuid,
  getUserAgent,
  getUserName,
  hasJingBeanReward,
  postFormApi,
  parseApiResponse,
  safeJsonParse,
  sleep,
  stringifySnippet,
};
