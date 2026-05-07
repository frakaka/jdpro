/*
cron:16 0 * * * jd_jdh_online_doctor_bean.js

环境变量说明：
1. JD_JDH_ONLINE_DOCTOR_DEBUG
   含义：是否打印接口原始返回片段，便于排查风控、活动下线、参数变化。
   是否必须：否，配置为 1 时开启。

2. JD_JDH_ONLINE_DOCTOR_DO_ALL_TASKS
   含义：是否尝试上报所有 status=1 的非分享任务。
   是否必须：否，默认只上报前端配置的 immediatelyUploadTask 和 specialTask，配置为 1 时扩大范围。
*/

'use strict';

const crypto = require('crypto');
const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  createJsSecurityH5st,
} = require('./function/jdHarBeanCommon');
const $ = new Env('在线医生福利中心领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const API_URL = 'https://api.m.jd.com/api';
const PAGE_URL = 'https://laputa.jd.com/onlineDoctorWel/pages/index/index?apicode=Hospital&hy_entry=hos_zxys';
const GIAS_SCRIPT_URL = 'https://gias.jd.com/js/m-tk.js';
const GIAS_BIZ_ID = 'laputa';
const APP_KEY = '250141600001';
const ACTIVITY_ID = '34703';
const CHANNEL = 'jdhapp';
const TASK_LIST_APP_ID = 'JDHAPP';
const DO_TASK_APP_ID = 'JDHAPP';
const AWARD_APP_ID = 'JDHAPP';
const AWARD_QUERY_APP_ID = 'laputa';
const KIT_TASK_APP_ID = 'jdh-middle';
const KIT_SIGN_APP_ID = 'laputa';
const DO_TASK_H5ST_APP_ID = '32438';
const KIT_H5ST_APP_ID = 'f0e57';
const H5ST_VERSION = '4.1';
const KIT_H5ST_VERSION = '5.3';
const KIT_H5ST_MODE = 'js_security';
const JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/main/js_security_v3_main.js?v=20260506';
const CLIENT = 'wh5';
const CLIENT_VERSION = '1.0.0';
const SPECIAL_TASK_ID = '5570368';
const KIT_GROUP_CODE = 'openkits';
const KIT_INFO_ID = 'kits';
const AUTO_TASK_IDS = new Set([
  SPECIAL_TASK_ID,
  '6631109',
  '6836799',
  '6848692',
  '6857106',
  '6923556',
  '6923557',
  '6923558',
  '6923559',
]);
const SHARE_TASK_TYPE = 25;
const TASK_STATUS = {
  TODO: 1,
  CAN_REWARD: 3,
  DONE: 4,
};
const RISK_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.90&HiClVersion=8.1.90&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR&stockSDK=stocksdk-iphone_6.0.0&sPoint=&jdPay=(*#@jdPaySDK*#@jdPayChannel=jdfinance&jdPayChannelVersion=8.1.90&jdPaySdkVersion=4.02.00.00&jdPayClientName=iOS*#@)';

const cookies = Object.values(jdCookieNode).filter(Boolean);
const riskContextCache = new Map();
let jsdomDeps = null;
let h5stFactory = null;
let h5stShimInstalled = false;
let giasScriptPromise = null;

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

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_JDH_ONLINE_DOCTOR_DEBUG === '1';
}

function shouldDoAllTasks() {
  return process.env.JD_JDH_ONLINE_DOCTOR_DO_ALL_TASKS === '1';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUserName(cookie) {
  const match = cookie.match(/pt_pin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '未知账号';
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = cookie.match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
}

function parseCookieString(cookie) {
  const cookieMap = new Map();
  const items = String(cookie || '').split(';');

  for (const item of items) {
    const pair = item.trim();
    if (!pair) {
      continue;
    }

    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key) {
      cookieMap.set(key, value);
    }
  }

  return cookieMap;
}

function stringifyCookieMap(cookieMap) {
  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function mergeCookieString(baseCookie, extraCookieValues) {
  const cookieMap = parseCookieString(baseCookie);
  for (const [key, value] of Object.entries(extraCookieValues || {})) {
    if (value) {
      cookieMap.set(key, value);
    }
  }
  return stringifyCookieMap(cookieMap);
}

function getRequestUuid(cookie) {
  const jda = getCookieValue(cookie, '__jda');
  if (jda) {
    const parts = jda.split('.');
    if (parts.length >= 2 && parts[1]) {
      return parts[1];
    }
  }

  const fallbackKeys = ['mba_muid', '__jdu', 'pt_pin'];
  for (const key of fallbackKeys) {
    const value = getCookieValue(cookie, key);
    if (value) {
      return decodeURIComponent(value);
    }
  }

  return String(Date.now());
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

function safeJsonParse(content, fallback = null) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function loadJsdomDependencies() {
  if (jsdomDeps) {
    return jsdomDeps;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'canvas') {
      return {};
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    jsdomDeps = require('jsdom');
    return jsdomDeps;
  } finally {
    Module._load = originalLoad;
  }
}

function patchRiskWindow(window) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: USER_AGENT,
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: 'zh-CN',
  });
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: ['zh-CN', 'zh'],
  });
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(window.navigator, 'plugins', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(window.navigator, 'mimeTypes', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(window.screen, 'width', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.screen, 'availWidth', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'availHeight', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.screen, 'colorDepth', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value() {
      return 'data:image/png;base64,AA==';
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(type) {
      if (type === '2d') {
        return {
          textBaseline: 'top',
          font: '14px Arial',
          fillStyle: '#f60',
          fillRect() {},
          fillText() {},
          beginPath() {},
          arc() {},
          closePath() {},
          fill() {},
          stroke() {},
          measureText() {
            return { width: 10 };
          },
          getImageData() {
            return { data: new Uint8ClampedArray(16) };
          },
        };
      }

      return {
        getParameter() {
          return 1;
        },
        getExtension() {
          return null;
        },
        createBuffer() {
          return {};
        },
        bindBuffer() {},
        bufferData() {},
        createProgram() {
          return {};
        },
        createShader() {
          return {};
        },
        shaderSource() {},
        compileShader() {},
        attachShader() {},
        linkProgram() {},
        useProgram() {},
        getAttribLocation() {
          return 0;
        },
        getUniformLocation() {
          return {};
        },
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        uniform2f() {},
        drawArrays() {},
        canvas: {
          toDataURL() {
            return 'data:image/png;base64,AA==';
          },
        },
      };
    },
  });

  window.console = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  window.bp_bizid = GIAS_BIZ_ID;
}

async function getGiasScript() {
  if (!giasScriptPromise) {
    giasScriptPromise = got(GIAS_SCRIPT_URL, {
      headers: {
        Referer: PAGE_URL,
        'User-Agent': USER_AGENT,
      },
      timeout: {
        request: 10000,
      },
    }).text();
  }
  return giasScriptPromise;
}

async function getRiskContext(cookie) {
  const cacheKey = getUserName(cookie);
  if (riskContextCache.has(cacheKey)) {
    return riskContextCache.get(cacheKey);
  }

  const promise = (async () => {
    const cookieToken = getCookieValue(cookie, '3AB9D23F7A4B3CSS');

    try {
      const { JSDOM, VirtualConsole } = loadJsdomDependencies();
      const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: PAGE_URL,
        referrer: PAGE_URL,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        resources: 'usable',
        virtualConsole: new VirtualConsole(),
      });

      try {
        const { window } = dom;
        patchRiskWindow(window);

        for (const [key, value] of parseCookieString(cookie).entries()) {
          window.document.cookie = `${key}=${value}; path=/`;
        }

        window.eval(await getGiasScript());

        const tokenResult = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('gias 获取 jsToken 超时'));
          }, RISK_TIMEOUT_MS);

          window.getJsToken((result) => {
            clearTimeout(timer);
            resolve(result || {});
          }, RISK_TIMEOUT_MS);
        });

        const riskCookieMap = parseCookieString(window.document.cookie);
        const jsToken = riskCookieMap.get('3AB9D23F7A4B3CSS') || tokenResult.jsToken || cookieToken;
        const equipmentId = riskCookieMap.get('3AB9D23F7A4B3C9B') || tokenResult.eid || getCookieValue(cookie, '3AB9D23F7A4B3C9B');
        const giaD = riskCookieMap.get('_gia_d') || getCookieValue(cookie, '_gia_d') || '1';

        return {
          jsToken,
          cookie: mergeCookieString(cookie, {
            '3AB9D23F7A4B3CSS': jsToken,
            '3AB9D23F7A4B3C9B': equipmentId,
            _gia_d: giaD,
            equipmentId,
          }),
        };
      } finally {
        dom.window.close();
      }
    } catch (error) {
      return {
        jsToken: cookieToken,
        cookie,
        error,
      };
    }
  })();

  riskContextCache.set(cacheKey, promise);
  return promise;
}

function installDateFnsShim() {
  if (h5stShimInstalled) {
    return;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'date-fns') {
      return { format: formatH5stDate };
    }
    return originalLoad.apply(this, arguments);
  };
  h5stShimInstalled = true;
}

function padNumber(value, length = 2) {
  return String(value).padStart(length, '0');
}

function formatH5stDate(date, pattern) {
  const current = new Date(date);
  return pattern
    .replace('yyyy', String(current.getFullYear()))
    .replace('MM', padNumber(current.getMonth() + 1))
    .replace('dd', padNumber(current.getDate()))
    .replace('HH', padNumber(current.getHours()))
    .replace('mm', padNumber(current.getMinutes()))
    .replace('ss', padNumber(current.getSeconds()))
    .replace('SSS', padNumber(current.getMilliseconds(), 3));
}

function getH5stFactory() {
  if (h5stFactory) {
    return h5stFactory;
  }

  installDateFnsShim();
  h5stFactory = require('./function/h5st41.js');
  return h5stFactory;
}

async function createH5st(functionId, body, h5stAppId, requestAppid, cookie, h5stVersion = H5ST_VERSION) {
  const H5ST = getH5stFactory();
  const signer = new H5ST({
    appId: h5stAppId,
    appid: requestAppid,
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    pin: getUserName(cookie),
    ua: USER_AGENT,
    version: h5stVersion,
  });

  await signer.genAlgo();
  const query = await signer.genUrlParams(functionId, body, true);
  return new URLSearchParams(query).get('h5st') || '';
}

function createStableFp(cookie, h5stAppId) {
  const configuredFp = String(process.env.JD_JDH_ONLINE_DOCTOR_H5ST_FP || 'yeeeyennezbivmp1').trim();
  if (/^[a-z0-9]{16}$/i.test(configuredFp)) {
    return configuredFp;
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seed = crypto
    .createHash('sha256')
    .update(`${getUserName(cookie)}:${h5stAppId}:jdh-online-doctor`)
    .digest();
  let fp = '';
  for (let index = 0; index < 16; index += 1) {
    fp += alphabet[seed[index] % alphabet.length];
  }
  return fp;
}

function buildH5stLocalStorageSeed(cookie, h5stAppId) {
  return {
    WQ_dy1_vk: JSON.stringify({
      [KIT_H5ST_VERSION]: {
        [h5stAppId]: {
          e: 31536000,
          v: createStableFp(cookie, h5stAppId),
          t: Date.now(),
        },
      },
    }),
  };
}

async function createRequestH5st(options) {
  const {
    functionId,
    body,
    h5stAppId,
    appid,
    requestCookie,
    formFields,
    h5stVersion,
    h5stMode,
  } = options;

  if (h5stMode === KIT_H5ST_MODE) {
    return createJsSecurityH5st({
      h5stAppId,
      formFields,
      cookie: requestCookie,
      userAgent: USER_AGENT,
      pageUrl: PAGE_URL,
      scriptUrl: String(process.env.JD_JDH_ONLINE_DOCTOR_JS_SECURITY_URL || JS_SECURITY_SCRIPT_URL).trim(),
      bizId: GIAS_BIZ_ID,
      localStorageSeed: buildH5stLocalStorageSeed(requestCookie, h5stAppId),
      signerOptions: {
        preRequest: true,
        prepareDelayMs: Number(process.env.JD_JDH_ONLINE_DOCTOR_H5ST_DELAY_MS || 800),
      },
    });
  }

  return createH5st(functionId, body, h5stAppId, appid, requestCookie, h5stVersion);
}

function createApiHeaders(cookie) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookie,
    Origin: 'https://laputa.jd.com',
    Referer: PAGE_URL,
    'User-Agent': USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
  };
}

function appendFormValue(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.set(key, String(value));
  }
}

async function postApi(cookie, options) {
  const {
    functionId,
    appid,
    body,
    riskContext,
    h5stAppId = '',
    h5stVersion = H5ST_VERSION,
    h5stMode = '',
  } = options;
  const requestCookie = riskContext?.cookie || cookie;
  const bodyText = JSON.stringify(body || {});
  const form = new URLSearchParams();
  const pageUuid = getRequestUuid(requestCookie);
  const isJsSecurityH5st = h5stMode === KIT_H5ST_MODE;

  appendFormValue(form, 'body', bodyText);
  appendFormValue(form, 'appid', appid);
  appendFormValue(form, 'functionId', functionId);
  if (!isJsSecurityH5st) {
    appendFormValue(form, 'client', CLIENT);
    appendFormValue(form, 'clientVersion', CLIENT_VERSION);
    appendFormValue(form, 'uuid', pageUuid);
    appendFormValue(form, 'pageUrl', PAGE_URL);
  }

  if (!isJsSecurityH5st && riskContext?.jsToken) {
    appendFormValue(form, 'x-api-eid-token', riskContext.jsToken);
  }

  if (h5stAppId) {
    try {
      const formFields = isJsSecurityH5st
        ? {
          body: bodyText,
          appid,
          functionId,
          client: CLIENT,
          uuid: pageUuid,
        }
        : Object.fromEntries(form.entries());
      const h5st = await createRequestH5st({
        functionId,
        body,
        h5stAppId,
        appid,
        requestCookie,
        formFields,
        h5stVersion,
        h5stMode,
      });
      appendFormValue(form, 'h5st', h5st);
    } catch (error) {
      $.log(`h5st 生成失败，继续请求：${error.message}`);
    }
  }

  if (isJsSecurityH5st) {
    appendFormValue(form, 'client', CLIENT);
    appendFormValue(form, 'uuid', pageUuid);
  }

  if (isDebugEnabled()) {
    const h5st = String(form.get('h5st') || '');
    $.log(`postApi REQUEST ${functionId} => ${stringifySnippet({
      appid,
      body,
      hasH5st: !!h5st,
      h5stLength: h5st.length,
      h5stHead: h5st ? h5st.split(';').slice(0, 6).join(';') : '',
    }, 1200)}`);
  }

  const response = await got.post(`${API_URL}?functionId=${encodeURIComponent(functionId)}`, {
    body: form.toString(),
    headers: createApiHeaders(requestCookie),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });
  const responseText = String(response.body || '');
  if (isDebugEnabled()) {
    $.log(`postApi RESPONSE ${functionId} => ${stringifySnippet({
      statusCode: response.statusCode,
      body: responseText,
    }, 1200)}`);
  }

  return safeJsonParse(responseText.trim(), responseText.trim());
}

async function queryTaskList(cookie, riskContext) {
  return postApi(cookie, {
    functionId: 'jdh_bff_queryTaskList',
    appid: TASK_LIST_APP_ID,
    riskContext,
    body: {
      activityId: ACTIVITY_ID,
      appKey: APP_KEY,
      channel: CHANNEL,
    },
  });
}

async function doTask(cookie, riskContext, task) {
  return postApi(cookie, {
    functionId: 'jdh_msoa_doTaskGw',
    appid: DO_TASK_APP_ID,
    riskContext,
    h5stAppId: DO_TASK_H5ST_APP_ID,
    body: {
      encodeId: task.encodeId,
      taskId: task.id,
      appKey: task.appKey || APP_KEY,
      channel: CHANNEL,
      infoId: new Date().toISOString(),
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
      appKey: task.appKey || APP_KEY,
      channel: task.channel || CHANNEL,
      activityId: task.activityId || ACTIVITY_ID,
      taskId: task.id,
      infoId: task.infoId || '',
      extParam,
      platform: 3,
    },
  });
}

async function queryAwardBalance(cookie, riskContext) {
  return postApi(cookie, {
    functionId: 'jdh_msoa_queryAwardGw',
    appid: AWARD_QUERY_APP_ID,
    riskContext,
    body: {
      appKey: APP_KEY,
      activityId: ACTIVITY_ID,
      channel: CHANNEL,
      awardType: 2,
    },
  });
}

async function queryKitTask(cookie, riskContext) {
  return postApi(cookie, {
    functionId: 'jdh_bm_getKitTask',
    appid: KIT_TASK_APP_ID,
    riskContext,
    body: {
      m_patch_appKey: APP_KEY,
      groupCode: KIT_GROUP_CODE,
      channel: CHANNEL,
    },
  });
}

async function doKitSign(cookie, riskContext, kitTask) {
  return postApi(cookie, {
    functionId: 'jdh_msoa_doTaskGw',
    appid: KIT_SIGN_APP_ID,
    riskContext,
    h5stAppId: KIT_H5ST_APP_ID,
    h5stVersion: KIT_H5ST_VERSION,
    h5stMode: KIT_H5ST_MODE,
    body: {
      appKey: kitTask.appKey || APP_KEY,
      channel: kitTask.channel || CHANNEL,
      encodeId: kitTask.encodeId,
      infoId: KIT_INFO_ID,
      platform: 3,
    },
  });
}

async function claimKitReward(cookie, riskContext, kitTask) {
  return postApi(cookie, {
    functionId: 'jdh_msoa_sendAwardGw',
    appid: AWARD_APP_ID,
    riskContext,
    body: {
      appKey: kitTask.appKey || APP_KEY,
      activityId: kitTask.activityId || ACTIVITY_ID,
      channel: kitTask.channel || CHANNEL,
      taskId: kitTask.id,
      queryToken: kitTask.queryToken,
      infoId: KIT_INFO_ID,
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

  const candidateKeys = ['msg', 'message', 'echo', 'errMsg'];
  const candidateObjects = [
    response?.result?.result,
    response?.data?.result,
    response?.result,
    response?.data,
    response,
  ];
  for (const key of candidateKeys) {
    for (const candidate of candidateObjects) {
      const value = candidate?.[key];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
  }

  return stringifySnippet(response, 300);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAwardNum(response) {
  const num = response?.result?.num ?? response?.data?.result?.num ?? response?.data?.num;
  return Number.isFinite(Number(num)) ? Number(num) : null;
}

function getKitTask(response) {
  const kitTask = response?.result || response?.data?.result || response?.data;
  return kitTask && typeof kitTask === 'object' ? kitTask : null;
}

function formatKitTask(kitTask) {
  const continued = stripHtml(kitTask?.kitCenterRightLabel);
  const center = stripHtml(kitTask?.kitCenterLabel);
  return [
    `id=${kitTask?.id || '-'}`,
    `status=${kitTask?.status ?? '-'}`,
    continued,
    center,
  ].filter(Boolean).join(' | ');
}

function isQuerySuccess(response) {
  return Number(response?.code) === 0 && Array.isArray(response?.result);
}

function isRewardSuccess(response) {
  return Number(response?.code) === 0 && Number(response?.result?.code) === 0;
}

function isDoTaskSuccess(response) {
  const code = Number(response?.code);
  const bizCode = Number(response?.data?.bizCode ?? response?.result?.bizCode ?? response?.result?.result?.bizCode);
  const resultCode = Number(response?.result?.code);
  if (code !== 0) {
    return false;
  }
  if (!Number.isNaN(bizCode)) {
    return bizCode === 0 || bizCode === 2;
  }
  if (!Number.isNaN(resultCode)) {
    return resultCode === 0;
  }
  return false;
}

function isKitTaskSuccess(response) {
  return Number(response?.code) === 0 && !!getKitTask(response)?.encodeId;
}

function isKitAlreadyDone(kitTask) {
  return Number(kitTask?.status) === TASK_STATUS.DONE;
}

function isKitSignSuccess(response) {
  return isDoTaskSuccess(response);
}

function pushAndLog(lines, message) {
  lines.push(message);
  $.log(message);
}

function summarizeKitResponse(response) {
  const kitTask = getKitTask(response);
  return stringifySnippet({
    code: response?.code,
    msg: response?.msg || response?.message || response?.echo,
    topKeys: response && typeof response === 'object' ? Object.keys(response) : [],
    resultKeys: response?.result && typeof response.result === 'object' ? Object.keys(response.result) : [],
    dataKeys: response?.data && typeof response.data === 'object' ? Object.keys(response.data) : [],
    encodeId: kitTask?.encodeId ? '存在' : '不存在',
    status: kitTask?.status,
    id: kitTask?.id,
  }, 800);
}

function extractPrizeMoney(response) {
  const prizeList = response?.result?.result?.prizeInfovos ||
    response?.result?.result?.prizeInfovo ||
    response?.result?.prizeInfovos ||
    response?.result?.prizeInfovo ||
    response?.data?.prizeInfovos ||
    response?.data?.prizeInfovo ||
    [];
  const prizes = Array.isArray(prizeList) ? prizeList : [prizeList];
  return prizes
    .map((item) => item?.money || item?.moneyStr || item?.prizeName)
    .filter(Boolean)
    .join('/');
}

function canAutoDoTask(task) {
  if (!task || Number(task.status) !== TASK_STATUS.TODO) {
    return false;
  }
  if (Number(task.taskType) === SHARE_TASK_TYPE) {
    return false;
  }
  return shouldDoAllTasks() || AUTO_TASK_IDS.has(String(task.id));
}

function collectClaimableTasks(tasks) {
  return tasks.filter((task) => Number(task.status) === TASK_STATUS.CAN_REWARD);
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
      const prizeText = prize ? `，领取 ${prize} 京豆` : '';
      lines.push(`${prefix}: ${title} 领奖成功${prizeText}`);
    } else {
      lines.push(`${prefix}: ${title} 领奖失败，${extractMessage(response)}`);
    }

    await sleep(800);
  }

  return lines;
}

async function logAwardBalance(cookie, riskContext, prefix, label) {
  const response = await queryAwardBalance(cookie, riskContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: ${label}健康币/京豆余额原始返回 => ${stringifySnippet(response)}`);
  }

  const num = extractAwardNum(response);
  if (num === null) {
    $.log(`${prefix}: ${label}奖励余额查询失败，${extractMessage(response)}`);
    return null;
  }

  $.log(`${prefix}: ${label}奖励余额 => ${num}`);
  return num;
}

async function handleKitSign(cookie, riskContext, prefix) {
  const lines = [];
  $.log(`${prefix}: 开始检查签到锦囊`);
  const kitResponse = await queryKitTask(cookie, riskContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 签到锦囊原始返回 => ${stringifySnippet(kitResponse)}`);
  }

  if (!isKitTaskSuccess(kitResponse)) {
    pushAndLog(lines, `${prefix}: 签到信息查询失败，${extractMessage(kitResponse)}，诊断=${summarizeKitResponse(kitResponse)}`);
    return lines;
  }

  const kitTask = getKitTask(kitResponse);
  $.log(`${prefix}: 签到锦囊 => ${formatKitTask(kitTask)}`);

  if (isKitAlreadyDone(kitTask)) {
    pushAndLog(lines, `${prefix}: 今日已签到，${formatKitTask(kitTask)}`);
    return lines;
  }

  if (Number(kitTask.status) === TASK_STATUS.CAN_REWARD) {
    lines.push(...await handleKitClaim(cookie, riskContext, kitTask, prefix));
    return lines;
  }

  $.log(`${prefix}: 开始执行签到 => ${formatKitTask(kitTask)}`);
  const signResponse = await doKitSign(cookie, riskContext, kitTask);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 签到原始返回 => ${stringifySnippet(signResponse)}`);
  }

  await sleep(800);
  const afterKitResponse = await queryKitTask(cookie, riskContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 签到后锦囊原始返回 => ${stringifySnippet(afterKitResponse)}`);
  }
  const afterKitTask = getKitTask(afterKitResponse);
  if (afterKitTask) {
    $.log(`${prefix}: 签到后锦囊 => ${formatKitTask(afterKitTask)}`);
  }

  if (isKitSignSuccess(signResponse)) {
    const prize = extractPrizeMoney(signResponse);
    pushAndLog(lines, `${prefix}: 签到成功${prize ? `，获得 ${prize} 京豆/健康币` : ''}`);
    return lines;
  }

  if (Number(afterKitTask?.status) === TASK_STATUS.CAN_REWARD) {
    lines.push(...await handleKitClaim(cookie, riskContext, afterKitTask, prefix));
    return lines;
  }

  pushAndLog(lines, `${prefix}: 签到失败，${extractMessage(signResponse)}`);
  return lines;
}

async function handleKitClaim(cookie, riskContext, kitTask, prefix) {
  const lines = [];
  $.log(`${prefix}: 开始领取签到奖励 => ${formatKitTask(kitTask)}`);
  const claimResponse = await claimKitReward(cookie, riskContext, kitTask);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 签到领奖原始返回 => ${stringifySnippet(claimResponse)}`);
  }

  if (isRewardSuccess(claimResponse)) {
    const prize = extractPrizeMoney(claimResponse);
    pushAndLog(lines, `${prefix}: 签到领奖成功${prize ? `，获得 ${prize} 京豆/健康币` : ''}`);
  } else {
    pushAndLog(lines, `${prefix}: 签到领奖失败，${extractMessage(claimResponse)}`);
  }

  return lines;
}

async function handleAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const lines = [];

  $.log(`==== ${prefix} ====`);

  const riskContext = await getRiskContext(cookie);
  if (riskContext.error) {
    $.log(`${prefix}: gias 动态 token 获取失败，降级使用 Cookie token：${riskContext.error.message}`);
  }

  await logAwardBalance(cookie, riskContext, prefix, '初始');
  lines.push(...await handleKitSign(cookie, riskContext, prefix));

  const firstResponse = await queryTaskList(cookie, riskContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: jdh_bff_queryTaskList 原始返回 => ${stringifySnippet(firstResponse)}`);
  }

  if (!isQuerySuccess(firstResponse)) {
    return [`${prefix}: 查询任务失败，${extractMessage(firstResponse)}`];
  }

  const firstTasks = flattenTasks(firstResponse);
  $.log(`${prefix}: 任务列表 => ${firstTasks.map(formatTask).join(' | ') || '空'}`);

  const firstClaimLines = await claimTasks(cookie, riskContext, firstTasks, prefix);
  lines.push(...firstClaimLines);

  const pendingTasks = firstTasks.filter(canAutoDoTask);
  if (pendingTasks.length === 0) {
    lines.push(`${prefix}: 未找到可自动上报的任务`);
    await logAwardBalance(cookie, riskContext, prefix, '最终');
    return lines;
  }

  for (const task of pendingTasks) {
    const response = await doTask(cookie, riskContext, task);
    if (isDebugEnabled()) {
      $.log(`${prefix}: 做任务原始返回 ${task.id} => ${stringifySnippet(response)}`);
    }

    const title = task.mainTitle || task.title || task.id;
    if (isDoTaskSuccess(response)) {
      $.log(`${prefix}: ${title} 上报完成`);
    } else {
      lines.push(`${prefix}: ${title} 上报失败，${extractMessage(response)}`);
    }

    await sleep(1000);
  }

  const secondResponse = await queryTaskList(cookie, riskContext);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 上报后任务列表原始返回 => ${stringifySnippet(secondResponse)}`);
  }

  if (!isQuerySuccess(secondResponse)) {
    lines.push(`${prefix}: 上报后查询任务失败，${extractMessage(secondResponse)}`);
    return lines;
  }

  const secondTasks = flattenTasks(secondResponse);
  $.log(`${prefix}: 上报后任务列表 => ${secondTasks.map(formatTask).join(' | ') || '空'}`);
  lines.push(...await claimTasks(cookie, riskContext, secondTasks, prefix));
  await logAwardBalance(cookie, riskContext, prefix, '最终');

  if (lines.length === 0) {
    lines.push(`${prefix}: 已执行任务链路，暂无可领取奖励`);
  }

  return lines;
}

async function main() {
  if (cookies.length === 0) {
    $.log('未找到 JD_COOKIE');
    return;
  }

  const messages = [];
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      const lines = await handleAccount(cookies[index], index + 1);
      messages.push(...lines);
    } catch (error) {
      const userName = getUserName(cookies[index]);
      const message = `账号${index + 1} ${userName}: 执行异常，${error.stack || error.message || error}`;
      $.log(message);
      messages.push(message);
    }
  }

  if (notify && messages.length > 0) {
    await notify.sendNotify($.name, messages.join('\n'));
  }
}

main()
  .catch((error) => {
    $.log(`脚本执行异常：${error.stack || error.message}`);
  })
  .finally(() => {
    $.done();
    process.exit(0);
  });
