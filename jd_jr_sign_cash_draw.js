/*
cron:2 0 * * * jd_jr_sign_cash_draw.js

环境变量说明：
1. JDJR_SIGN_CASH_DRAW_FULL_COOKIE
   含义：签到领现金活动页完整 Cookie，会与 JD_COOKIE 合并，补齐 qid_uid 等页面态 Cookie。
   是否必须：否。

2. JDJR_SIGN_CASH_DRAW_DEBUG
   含义：是否打印更完整的请求与响应详情。
   是否必须：否，值为 1 时开启。

3. JDJR_SIGN_CASH_DRAW_DIRECT_TASK_ID
   含义：首页直接可领取的任务 taskId。
   是否必须：否，默认使用 HAR 样本值 38886。

4. JDJR_SIGN_CASH_DRAW_READ_TASK_ID
   含义：阅读任务 taskId。
   是否必须：否，默认使用 HAR 样本值 42098。

5. JDJR_SIGN_CASH_DRAW_RISK_FP / JDJR_SIGN_CASH_DRAW_RISK_SDK_TOKEN / JDJR_SIGN_CASH_DRAW_RISK_EID
   含义：receiveTask / queryMakeTandemTask 使用的 riskDeviceParam。
   是否必须：否，默认回退到当前 HAR 样本。

6. JDJR_SIGN_CASH_DRAW_READ_TOKEN / JDJR_SIGN_CASH_DRAW_READ_QUERY_NONCE / JDJR_SIGN_CASH_DRAW_READ_QUERY_SIGNATURE
   含义：queryReadMissionExtV3 使用的 token / nonce / signature。
   是否必须：否，默认使用当前 HAR 样本；接口若失效，请从新 HAR 覆盖。

7. JDJR_SIGN_CASH_DRAW_FINISH_NONCE / JDJR_SIGN_CASH_DRAW_FINISH_SIGNATURE
   含义：finishReadMission 使用的 nonce / signature。
   是否必须：否，默认使用当前 HAR 样本；接口若失效，请从新 HAR 覆盖。

8. JDJR_SIGN_CASH_DRAW_MAX_DRAW
   含义：最多执行几次签到抽奖。
   是否必须：否，默认按当前剩余抽奖次数执行。

9. JDJR_SIGN_CASH_DRAW_DRAW_PID / JDJR_SIGN_CASH_DRAW_DRAW_SESSION_ID
   含义：dailyDrawResult 请求里的 pid / sessionid。
   是否必须：否，未配置时分别使用 HAR 样本值和脚本自动生成的 sessionid。

10. JDJR_SIGN_CASH_DRAW_TASK_LIMIT / JDJR_SIGN_CASH_DRAW_TASK_WAIT_MS
   含义：最多尝试几个可浏览任务 / 每个任务浏览停留毫秒数。
   是否必须：否，默认 3 个任务、停留 12000ms。

11. JDJR_SIGN_CASH_DRAW_TASK_MISSION_TYPES
   含义：仅执行指定 missionType 的任务，多个值用逗号分隔。
   是否必须：否，默认不过滤。

HAR 结论：
1. 本脚本依据 files/traffic_jdjr_签到领现金_draw.chlz_filtered.har 和 files/traffic_jdjr_签到领现金_draw_new.har 分析而来。
2. 当前 HAR 明确包含“做任务拿抽奖次数”的闭环：
   - queryWeekSignMain / queryCashSignSub / queryMakeTandemTask 查询首页状态
   - receiveTask 领取任务奖励
   - queryReadMissionExtV3 / finishReadMission 完成阅读任务
   - 再次 queryWeekSignMain 回查抽奖次数
3. 新 HAR 额外补全了抽奖接口：
   - dailyDrawResult
   脚本现在会在任务完成后按剩余次数执行抽奖，并打印抽奖结果。
*/

'use strict';

const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  getUserName,
  mergeCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东金融签到领现金任务分析');

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.90&HiClVersion=8.1.90&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR&stockSDK=stocksdk-iphone_6.0.0&sPoint=&jdPay=(*#@jdPaySDK*#@jdPayChannel=jdfinance&jdPayChannelVersion=8.1.90&jdPaySdkVersion=4.02.00.00&jdPayClientName=iOS*#@jdPaySDK*#@)';
const PAGE_URL = 'https://member.jr.jd.com/activity/new-sign-in/home/?channelLv=shouyedou&jrtransparentbar=true&jrcontainer=h5&jrlogin=true';
const PAGE_REFERER_PAGE = 'https://member.jr.jd.com/activity/new-sign-in/home/';
const PAGE_ORIGIN = 'https://member.jr.jd.com';
const MISSION_PAGE_ORIGIN = 'https://jccapt.jr.jd.com';
const MISSION_PAGE_REFERER = 'https://jccapt.jr.jd.com/';

const QUERY_WEEK_SIGN_MAIN_URL = 'https://ms.jr.jd.com/gw2/generic/jrSign/h5/m/queryWeekSignMain';
const QUERY_CASH_SIGN_SUB_URL = 'https://ms.jr.jd.com/gw2/generic/jrSign/h5/m/queryCashSignSub';
const QUERY_MAKE_TANDEM_TASK_URL = 'https://ms.jr.jd.com/gw2/generic/jrSign/h5/m/queryMakeTandemTask';
const RECEIVE_TASK_URL = 'https://ms.jr.jd.com/gw2/generic/jrSign/h5/m/receiveTask';
const QUERY_READ_MISSION_EXT_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/queryReadMissionExtV3';
const QUERY_MISSION_RECEIVE_AFTER_STATUS_URL = 'https://ms.jr.jd.com/gw/generic/mission/h5/m/queryMissionReceiveAfterStatus';
const FINISH_READ_MISSION_URL = 'https://ms.jr.jd.com/gw/generic/mission/h5/m/finishReadMission';
const DAILY_DRAW_RESULT_URL = 'https://ms.jr.jd.com/gw2/generic/jrSign/h5/m/dailyDrawResult';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';

const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;
const SIGN_VERSION = 12;
const CHANNEL_LV = 'shouyedou';
const DRAW_CHANNEL_SOURCE = 'JRAPP6.0';
const MISSION_CHANNEL_CODE = 'jd-jr-pdyzcsrw';
const MISSION_APP_ID = 'jrmission';
const MISSION_VERSION = '2.2.4';
const DEFAULT_DIRECT_TASK_ID = 38886;
const DEFAULT_READ_TASK_ID = 42098;
const DEFAULT_RISK_FP = '93dd1f5969a1761c8e9402e5dec9f75f';
const DEFAULT_RISK_SDK_TOKEN = 'jdd01GHHVWPW7T2WWXVIOLB23G2UTG76AQ3A3XWHYLABPZAYAJYA3WMB26CWP6KAGETHLR2VFPMZCPIC26OBFPPEFUOFZ6KJTSOQ54E33KWI01234567';
const DEFAULT_RISK_EID = 'PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4';
const DEFAULT_READ_QUERY_TOKEN = 'qHGBfJAypy';
const DEFAULT_READ_QUERY_NONCE = '02593292381777811234';
const DEFAULT_READ_QUERY_SIGNATURE = '906b19933b7904df3f72ec39b8838c52efdb70c036742e7c3bf5a22f7deef0a701';
const DEFAULT_READ_FINISH_NONCE = '11465693351777811246';
const DEFAULT_READ_FINISH_SIGNATURE = 'ea58589a51a89ee291b2cf52a620ae1a717e13b34d7f36a685052fd65b5b4e2701';
const DEFAULT_DRAW_PID = 'X70O|XJQD_6';
const DEFAULT_HOME_PID = 'X70O|dxm';
const DEFAULT_HOME_SESSION_ID = '02e76de891840f75';
const DEFAULT_DRAW_INTERVAL_MS = 3000;
const DEFAULT_TASK_LIMIT = 3;
const DEFAULT_TASK_WAIT_MS = 12000;

const cookies = Object.values(jdCookieNode).filter(Boolean);
const client = got.extend({
  throwHttpErrors: false,
  timeout: {
    request: REQUEST_TIMEOUT_MS,
  },
});

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_SIGN_CASH_DRAW_DEBUG === '1';
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallback;
}

function getMaxDraws(leftTimes) {
  const configuredValue = String(process.env.JDJR_SIGN_CASH_DRAW_MAX_DRAW || '').trim();
  const availableTimes = Math.max(0, Number(leftTimes || 0));
  if (!configuredValue) {
    return availableTimes;
  }
  return Math.min(availableTimes, readPositiveInt(configuredValue, availableTimes));
}

function getDrawIntervalMs() {
  return readPositiveInt(process.env.JDJR_SIGN_CASH_DRAW_DRAW_INTERVAL_MS, DEFAULT_DRAW_INTERVAL_MS);
}

function getTaskLimit() {
  return readPositiveInt(process.env.JDJR_SIGN_CASH_DRAW_TASK_LIMIT, DEFAULT_TASK_LIMIT);
}

function getTaskWaitMs() {
  return readPositiveInt(process.env.JDJR_SIGN_CASH_DRAW_TASK_WAIT_MS, DEFAULT_TASK_WAIT_MS);
}

function getAllowedMissionTypes() {
  const value = String(process.env.JDJR_SIGN_CASH_DRAW_TASK_MISSION_TYPES || '').trim();
  if (!value) {
    return null;
  }
  const values = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  return values.length ? new Set(values) : null;
}

function shouldSkipDraws() {
  return process.env.JDJR_SIGN_CASH_DRAW_SKIP_DRAW === '1';
}

function envInt(name, fallback) {
  const value = Number(process.env[name] || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function maskCookie(cookie) {
  return String(cookie || '')
    .replace(/pt_key=([^;]+)/i, 'pt_key=***')
    .replace(/wskey=([^;]+)/i, 'wskey=***');
}

function decodeHarStyleResponse(body) {
  const text = String(body || '').trim();
  if (!text) {
    return '';
  }

  const direct = safeJsonParse(text, null);
  if (direct !== null) {
    return direct;
  }

  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    return safeJsonParse(decoded, decoded);
  } catch (error) {
    return text;
  }
}

function buildDeviceInfo() {
  return JSON.stringify({
    deviceId: '',
    clientType: '',
    user_agent: USER_AGENT,
    iosType: '',
    osv: '',
    brand: '',
    hwv: '',
    network: 0,
    mac: '',
    androidId: '',
    oaid: '',
  });
}

function buildRiskDeviceParam() {
  return JSON.stringify({
    undefined: '',
    fp: process.env.JDJR_SIGN_CASH_DRAW_RISK_FP || DEFAULT_RISK_FP,
    sdkToken: process.env.JDJR_SIGN_CASH_DRAW_RISK_SDK_TOKEN || DEFAULT_RISK_SDK_TOKEN,
    eid: process.env.JDJR_SIGN_CASH_DRAW_RISK_EID || DEFAULT_RISK_EID,
  });
}

function buildAdInfo() {
  return buildDeviceInfo();
}

function getHomeSessionId() {
  return String(process.env.JDJR_SIGN_CASH_DRAW_HOME_SESSION_ID || DEFAULT_HOME_SESSION_ID).trim();
}

function getHomePid() {
  return String(process.env.JDJR_SIGN_CASH_DRAW_HOME_PID || DEFAULT_HOME_PID).trim();
}

function formatUserDay(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function buildSessionId() {
  const configured = String(process.env.JDJR_SIGN_CASH_DRAW_DRAW_SESSION_ID || '').trim();
  if (configured) {
    return configured;
  }
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
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
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 3,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
  });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
  });
  window.indexedDB = {
    open() {
      return {
        result: null,
        onsuccess: null,
        onerror: null,
      };
    },
  };
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addListener() {},
    removeListener() {},
  }));
  window.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    clearRect() {},
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
    putImageData() {},
    createImageData() {
      return [];
    },
    setTransform() {},
    drawImage() {},
    save() {},
    fillText() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    translate() {},
    scale() {},
    rotate() {},
    arc() {},
    fill() {},
    measureText() {
      return { width: 0 };
    },
    transform() {},
    rect() {},
    clip() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    getParameter() {
      return '';
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
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    uniform2f() {},
    drawArrays() {},
    canvas: {
      toDataURL() {
        return 'data:image/png;base64,AA==';
      },
    },
  });
  window.console = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function getAar2Script() {
  if (!aar2ScriptPromise) {
    aar2ScriptPromise = got.get(AAR2_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: PAGE_URL,
      },
      timeout: {
        request: 10000,
      },
    }).text();
  }

  return aar2ScriptPromise;
}

async function createRiskContext() {
  const { JSDOM, VirtualConsole } = loadJsdomDependencies();
  const aar2Script = await getAar2Script();
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: PAGE_URL,
    referrer: PAGE_URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    resources: 'usable',
    virtualConsole,
  });

  const { window } = dom;
  patchRiskWindow(window);
  window.eval(aar2Script);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AAR2 初始化超时')), RISK_TIMEOUT_MS);
    window.AAR2.init({
      callback(ok, payload) {
        clearTimeout(timer);
        if (ok === false) {
          reject(new Error(`AAR2 初始化失败：${stringifySnippet(payload, 300)}`));
          return;
        }
        resolve();
      },
    });
  });

  return {
    dom,
    window,
  };
}

function signWithAar2(riskContext, signText) {
  const aar2 = new riskContext.window.AAR2();
  const nonce = aar2.nonce();
  return {
    nonce,
    signature: String(aar2.sign(signText, nonce) || '').toUpperCase(),
  };
}

function logHttpTrace(accountLabel, name, requestMeta, responseMeta) {
  const requestPayload = {
    ...requestMeta,
    headers: {
      ...(requestMeta.headers || {}),
      Cookie: maskCookie(requestMeta.headers?.Cookie || ''),
    },
  };
  const responsePayload = {
    statusCode: responseMeta.statusCode,
    body: responseMeta.body,
  };

  $.log(
    `${accountLabel}: ${name} REQUEST => ${stringifySnippet(requestPayload, isDebugEnabled() ? 4000 : 1500)}`,
  );
  $.log(
    `${accountLabel}: ${name} RESPONSE => ${stringifySnippet(responsePayload, isDebugEnabled() ? 4000 : 1500)}`,
  );
}

async function postFormApi(accountLabel, name, url, cookie, reqData, options = {}) {
  const {
    origin = PAGE_ORIGIN,
    referer = PAGE_URL,
    extraHeaders = {},
  } = options;

  const form = new URLSearchParams();
  if (reqData !== undefined && reqData !== '') {
    form.set('reqData', typeof reqData === 'string' ? reqData : JSON.stringify(reqData));
  }

  const headers = buildHeaders(cookie, {
    origin,
    referer,
    userAgent: USER_AGENT,
    extraHeaders,
  });

  const response = await client.post(url, {
    body: form.toString(),
    headers,
  });
  const decoded = decodeHarStyleResponse(response.body);

  logHttpTrace(accountLabel, name, {
    method: 'POST',
    url,
    headers,
    body: form.toString(),
  }, {
    statusCode: response.statusCode,
    body: decoded,
  });

  return decoded;
}

async function postPlainJsonApi(accountLabel, name, url, cookie, body, options = {}) {
  const {
    origin = MISSION_PAGE_ORIGIN,
    referer = MISSION_PAGE_REFERER,
  } = options;
  const requestBody = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = buildHeaders(cookie, {
    origin,
    referer,
    userAgent: USER_AGENT,
    contentType: 'text/plain;charset=UTF-8',
  });

  const response = await client.post(url, {
    body: requestBody,
    headers,
  });
  const decoded = decodeHarStyleResponse(response.body);

  logHttpTrace(accountLabel, name, {
    method: 'POST',
    url,
    headers,
    body: requestBody,
  }, {
    statusCode: response.statusCode,
    body: decoded,
  });

  return decoded;
}

async function getJsonApi(accountLabel, name, url, cookie, options = {}) {
  const {
    origin = MISSION_PAGE_ORIGIN,
    referer = MISSION_PAGE_REFERER,
    extraHeaders = {},
  } = options;
  const headers = buildHeaders(cookie, {
    origin,
    referer,
    userAgent: USER_AGENT,
    contentType: null,
    extraHeaders,
  });

  const response = await client.get(url, {
    headers,
  });
  const decoded = decodeHarStyleResponse(response.body);

  logHttpTrace(accountLabel, name, {
    method: 'GET',
    url,
    headers,
  }, {
    statusCode: response.statusCode,
    body: decoded,
  });

  return decoded;
}

function buildHomeRequestData(extra = {}) {
  return {
    site: 'JD_JR_APP',
    deviceInfo: buildDeviceInfo(),
    channelLv: CHANNEL_LV,
    clientType: 'ios',
    signVersion: SIGN_VERSION,
    riskDeviceParam: buildRiskDeviceParam(),
    ...extra,
  };
}

function buildWeekSignMainRequestData() {
  return {
    channelSource: DRAW_CHANNEL_SOURCE,
    site: 'JD_JR_APP',
    channelLv: CHANNEL_LV,
    signVersion: SIGN_VERSION,
  };
}

function buildCashSignSubRequestData() {
  return {
    sessionid: getHomeSessionId(),
    channelSource: DRAW_CHANNEL_SOURCE,
    site: 'JD_JR_APP',
    pageUrl: PAGE_URL,
    urlKey: 'new-sign-in',
    channelLv: CHANNEL_LV,
    pid: getHomePid(),
    visitHomeFlag: 'noSend',
    visitPageFlag: 'currentPage',
    signVersion: SIGN_VERSION,
    riskDeviceParam: buildRiskDeviceParam(),
  };
}

function extractDrawInfo(weekSignMain) {
  return weekSignMain?.resultData?.resBusiData?.dailyDrawInfo?.drawTimes || {};
}

function extractTaskPreview(queryMakeTandemTask) {
  const tasks = queryMakeTandemTask?.resultData?.resBusiData?.timeTaskList || [];
  return tasks.slice(0, 8).map((task) => ({
    taskId: task.taskId,
    taskName: task.taskName,
    state: task.state,
    awardNum: task.awards?.[0]?.awardNum,
    awardUnit: task.awards?.[0]?.awardUnit,
  }));
}

function getTaskList(homeState) {
  return homeState?.tandemTask?.resultData?.resBusiData?.timeTaskList || [];
}

function hasTaskUrl(task) {
  return Boolean(task?.h5Url || task?.doLink);
}

function getTaskText(task) {
  return `${task?.taskName || ''} ${task?.desc || ''}`.trim();
}

function isRunnableBrowseState(task) {
  const state = Number(task?.state);
  return state === -1 || state === 0;
}

function isBrowseLikeTask(task) {
  const text = getTaskText(task);
  if (!text) {
    return false;
  }
  return /(浏览|逛|看|听|领权益|会员)/.test(text);
}

function isBrowsableTask(task) {
  if (!task || !isRunnableBrowseState(task)) {
    return false;
  }
  const missionType = Number(task.missionType);
  const allowedMissionTypes = getAllowedMissionTypes();
  if (allowedMissionTypes && !allowedMissionTypes.has(missionType)) {
    return false;
  }
  if (!hasTaskUrl(task)) {
    return false;
  }
  if (Number(task.taskType) === 2) {
    return true;
  }
  return isBrowseLikeTask(task);
}

function pickBrowsableTasks(homeState) {
  return getTaskList(homeState).filter(isBrowsableTask);
}

function resolveTaskWaitMs(task) {
  const baseWaitMs = getTaskWaitMs();
  if (/(10秒|10s|10S)/.test(getTaskText(task))) {
    return Math.max(baseWaitMs, 10000);
  }
  if (isBrowseLikeTask(task)) {
    return Math.max(baseWaitMs, 10000);
  }
  return baseWaitMs;
}

async function queryHomeState(accountLabel, cookie, stage, visitPageFlag = '') {
  $.log(`${accountLabel}: ===== ${stage} =====`);

  const weekSignMain = await postFormApi(
    accountLabel,
    'queryWeekSignMain',
    QUERY_WEEK_SIGN_MAIN_URL,
    cookie,
    buildWeekSignMainRequestData(),
    {
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_REFERER_PAGE,
      },
    },
  );
  const cashSignSub = await postFormApi(
    accountLabel,
    'queryCashSignSub',
    QUERY_CASH_SIGN_SUB_URL,
    cookie,
    buildCashSignSubRequestData(),
    {
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_REFERER_PAGE,
      },
    },
  );
  const queryPayload = buildHomeRequestData(visitPageFlag ? { visitPageFlag } : {});
  const tandemTask = await postFormApi(
    accountLabel,
    `queryMakeTandemTask${visitPageFlag ? '(back)' : ''}`,
    QUERY_MAKE_TANDEM_TASK_URL,
    cookie,
    queryPayload,
  );

  const drawInfo = extractDrawInfo(weekSignMain);
  $.log(
    `${accountLabel}: 抽奖次数 current=${drawInfo.currentTimes ?? '未知'}, `
    + `left=${drawInfo.leftAvailableTimes ?? '未知'}, used=${drawInfo.usedTimes ?? '未知'}`,
  );
  $.log(
    `${accountLabel}: 任务预览 => ${stringifySnippet(extractTaskPreview(tandemTask), 1200)}`,
  );
  $.log(
    `${accountLabel}: drawGuideTipVo => ${stringifySnippet(
      cashSignSub?.resultData?.resBusiData?.drawGuideTipVo || {},
      400,
    )}`,
  );

  return {
    weekSignMain,
    cashSignSub,
    tandemTask,
  };
}

async function receiveTask(accountLabel, cookie, taskId, options = {}) {
  const {
    channelType = 3,
    missionType = 'ordinaryTask',
  } = options;
  const payload = {
    missionType,
    deviceInfo: buildDeviceInfo(),
    channelType,
    taskId,
    signVersion: SIGN_VERSION,
    channelLv: CHANNEL_LV,
    riskDeviceParam: buildRiskDeviceParam(),
  };

  return postFormApi(
    accountLabel,
    `receiveTask(taskId=${taskId})`,
    RECEIVE_TASK_URL,
    cookie,
    payload,
    {
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_REFERER_PAGE,
      },
    },
  );
}

async function visitTaskUrl(accountLabel, cookie, url, name, waitMs) {
  if (!url) {
    return null;
  }

  const headers = buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_URL,
    userAgent: USER_AGENT,
    contentType: null,
  });
  const response = await client.get(url, {
    headers,
    followRedirect: true,
  });

  logHttpTrace(accountLabel, name, {
    method: 'GET',
    url,
    headers,
  }, {
    statusCode: response.statusCode,
    body: {
      finalUrl: response.url,
      bodySnippet: stringifySnippet(decodeHarStyleResponse(response.body), 800),
    },
  });

  $.log(`${accountLabel}: ${name} 停留 ${waitMs}ms`);
  await sleep(waitMs);
  return response.url;
}

async function browseTask(accountLabel, cookie, task, waitMs) {
  const visitName = `浏览任务 taskId=${task.taskId} ${task.taskName}`;
  if (task.doLink) {
    await visitTaskUrl(accountLabel, cookie, task.doLink, `${visitName} doLink`, waitMs);
  }
  if (task.h5Url) {
    await visitTaskUrl(accountLabel, cookie, task.h5Url, `${visitName} h5Url`, waitMs);
  }
}

async function tryBrowsableTasks(accountLabel, cookie, homeState) {
  const tasks = pickBrowsableTasks(homeState).slice(0, getTaskLimit());
  if (!tasks.length) {
    $.log(`${accountLabel}: 当前任务列表里没有可尝试的浏览任务`);
    return homeState;
  }

  $.log(
    `${accountLabel}: 本轮尝试浏览任务 => ${stringifySnippet(
      tasks.map((task) => ({
        taskId: task.taskId,
        taskName: task.taskName,
        missionType: task.missionType,
        state: task.state,
      })),
      1200,
    )}`,
  );

  let latestState = homeState;
  for (const task of tasks) {
    const waitMs = resolveTaskWaitMs(task);
    $.log(
      `${accountLabel}: 准备浏览任务 taskId=${task.taskId} ${task.taskName}`
      + ` missionType=${task.missionType} taskType=${task.taskType} 停留=${waitMs}ms`,
    );
    await browseTask(accountLabel, cookie, task, waitMs);
    const receiveResult = await receiveTask(accountLabel, cookie, task.taskId, {
      channelType: 1,
      missionType: 'ordinaryTask',
    });
    $.log(
      `${accountLabel}: 浏览任务领奖 taskId=${task.taskId} ${task.taskName} => ${stringifySnippet(receiveResult, 800)}`,
    );
    const nextState = await queryHomeState(accountLabel, cookie, `浏览任务 ${task.taskId} 后状态`, 'back');
    $.log(
      `${accountLabel}: 任务 ${task.taskId} 后抽奖次数变化 => ${computeDrawDiff(latestState, nextState)}`,
    );
    latestState = nextState;
  }

  return latestState;
}

async function queryReadMissionExt(accountLabel, cookie, taskId) {
  const payload = {
    missionId: String(taskId),
    channelCode: MISSION_CHANNEL_CODE,
    nonce: process.env.JDJR_SIGN_CASH_DRAW_READ_QUERY_NONCE || DEFAULT_READ_QUERY_NONCE,
    signData: JSON.stringify({
      missionId: String(taskId),
      PIN: getUserName(cookie),
    }),
    signature: process.env.JDJR_SIGN_CASH_DRAW_READ_QUERY_SIGNATURE || DEFAULT_READ_QUERY_SIGNATURE,
    version: MISSION_VERSION,
    token: process.env.JDJR_SIGN_CASH_DRAW_READ_TOKEN || DEFAULT_READ_QUERY_TOKEN,
    appId: MISSION_APP_ID,
  };

  return postPlainJsonApi(
    accountLabel,
    'queryReadMissionExtV3',
    QUERY_READ_MISSION_EXT_URL,
    cookie,
    payload,
  );
}

async function queryMissionReceiveAfterStatus(accountLabel, cookie, taskId) {
  const reqData = encodeURIComponent(JSON.stringify({
    missionId: String(taskId),
    channelCode: MISSION_CHANNEL_CODE,
  }));
  const url = `${QUERY_MISSION_RECEIVE_AFTER_STATUS_URL}?reqData=${reqData}`;
  return getJsonApi(accountLabel, 'queryMissionReceiveAfterStatus', url, cookie);
}

async function finishReadMission(accountLabel, cookie, taskId, readTime) {
  const reqData = encodeURIComponent(JSON.stringify({
    missionId: String(taskId),
    readTime,
    nonce: process.env.JDJR_SIGN_CASH_DRAW_FINISH_NONCE || DEFAULT_READ_FINISH_NONCE,
    signature: process.env.JDJR_SIGN_CASH_DRAW_FINISH_SIGNATURE || DEFAULT_READ_FINISH_SIGNATURE,
    version: MISSION_VERSION,
    channelCode: MISSION_CHANNEL_CODE,
  }));
  const url = `${FINISH_READ_MISSION_URL}?reqData=${reqData}`;
  return getJsonApi(accountLabel, 'finishReadMission', url, cookie);
}

function buildDrawBaseData() {
  return {
    site: 'JD_JR_APP',
    channelSource: DRAW_CHANNEL_SOURCE,
    riskDeviceParam: buildRiskDeviceParam(),
    deviceInfo: buildDeviceInfo(),
    adInfo: buildAdInfo(),
    clientType: 'ios',
    iosType: 'iphone',
    userDay: formatUserDay(),
    sessionid: buildSessionId(),
    pid: process.env.JDJR_SIGN_CASH_DRAW_DRAW_PID || DEFAULT_DRAW_PID,
    channelLv: CHANNEL_LV,
    signVersion: SIGN_VERSION,
  };
}

async function dailyDrawResult(accountLabel, cookie, riskContext) {
  const signPayload = buildDrawBaseData();
  const signData = JSON.stringify(signPayload);
  const { nonce, signature } = signWithAar2(riskContext, signData);
  const reqData = {
    ...signPayload,
    signData,
    nonce,
    signature,
  };

  return postFormApi(
    accountLabel,
    'dailyDrawResult',
    DAILY_DRAW_RESULT_URL,
    cookie,
    reqData,
    {
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_REFERER_PAGE,
      },
    },
  );
}

function summarizeDrawResult(drawResult) {
  const drawInfo = drawResult?.resultData?.resBusiData?.drawResult || {};
  if (drawInfo.amount) {
    return {
      type: 'cash',
      amount: drawInfo.amount,
      nickName: drawInfo.nickName || '',
      drawKey: drawInfo.drawKey,
      index: drawInfo.index,
    };
  }

  return {
    type: 'task',
    title: drawInfo.title || '',
    button: drawInfo.button || '',
    taskId: drawInfo.taskId,
    missionType: drawInfo.missionType,
    drawKey: drawInfo.drawKey,
    index: drawInfo.index,
    state: drawInfo.state,
  };
}

async function performDraws(accountLabel, cookie, riskContext, homeState) {
  if (shouldSkipDraws()) {
    $.log(`${accountLabel}: 已配置跳过签到抽奖，仅验证任务链路`);
    return;
  }
  const leftTimes = Number(extractDrawInfo(homeState?.weekSignMain).leftAvailableTimes || 0);
  const drawTimes = getMaxDraws(leftTimes);
  if (drawTimes < 1) {
    $.log(`${accountLabel}: 当前没有可执行的签到抽奖次数`);
    return;
  }

  const intervalMs = getDrawIntervalMs();
  $.log(`${accountLabel}: 开始签到抽奖 => 可抽=${leftTimes}，实际执行=${drawTimes}，间隔=${intervalMs}ms`);

  for (let index = 0; index < drawTimes; index += 1) {
    const drawResult = await dailyDrawResult(accountLabel, cookie, riskContext);
    $.log(
      `${accountLabel}: 第${index + 1}次签到抽奖 => ${stringifySnippet(summarizeDrawResult(drawResult), 800)}`,
    );
    if (index < drawTimes - 1) {
      await sleep(intervalMs);
    }
  }
}

function resolveCookie(cookie) {
  const fullCookie = process.env.JDJR_SIGN_CASH_DRAW_FULL_COOKIE || '';
  return fullCookie ? mergeCookieString(cookie, fullCookie) : cookie;
}

function computeDrawDiff(previousState, currentState) {
  const previousLeft = Number(extractDrawInfo(previousState?.weekSignMain).leftAvailableTimes ?? NaN);
  const currentLeft = Number(extractDrawInfo(currentState?.weekSignMain).leftAvailableTimes ?? NaN);
  if (!Number.isFinite(previousLeft) || !Number.isFinite(currentLeft)) {
    return '未知';
  }
  return currentLeft - previousLeft;
}

async function runAccount(rawCookie, index) {
  const cookie = resolveCookie(rawCookie);
  const accountLabel = `账号${index} ${getUserName(cookie)}`;
  const directTaskId = envInt('JDJR_SIGN_CASH_DRAW_DIRECT_TASK_ID', DEFAULT_DIRECT_TASK_ID);
  const readTaskId = envInt('JDJR_SIGN_CASH_DRAW_READ_TASK_ID', DEFAULT_READ_TASK_ID);
  const riskContext = await createRiskContext();

  try {
    $.log(`\n==== ${accountLabel} ====`);
    const initialState = await queryHomeState(accountLabel, cookie, '初始状态');

    const directReceiveResult = await receiveTask(accountLabel, cookie, directTaskId);
    $.log(
      `${accountLabel}: 首页直接领奖 taskId=${directTaskId} => ${stringifySnippet(directReceiveResult, 600)}`,
    );
    const afterDirectState = await queryHomeState(accountLabel, cookie, '首页领奖后状态', 'back');
    $.log(
      `${accountLabel}: 首页领奖后抽奖次数变化 => ${computeDrawDiff(initialState, afterDirectState)}`,
    );

    const afterBrowseTasksState = await tryBrowsableTasks(accountLabel, cookie, afterDirectState);

    const readReceiveResult = await receiveTask(accountLabel, cookie, readTaskId);
    $.log(
      `${accountLabel}: 阅读任务领奖入口 taskId=${readTaskId} => ${stringifySnippet(readReceiveResult, 600)}`,
    );

    const readMissionExt = await queryReadMissionExt(accountLabel, cookie, readTaskId);
    const readTime = Number(
      readMissionExt?.resultData?.data?.extendMap?.readTime
      || readMissionExt?.resultData?.data?.extendMap?.browseTime
      || 10,
    );
    $.log(
      `${accountLabel}: 阅读任务详情 => ${stringifySnippet(readMissionExt?.resultData?.data || {}, 1000)}`,
    );

    const missionStatus = await queryMissionReceiveAfterStatus(accountLabel, cookie, readTaskId);
    $.log(
      `${accountLabel}: 阅读任务领取后状态 => ${stringifySnippet(missionStatus, 600)}`,
    );
    $.log(
      `${accountLabel}: 阅读任务诊断 => ${stringifySnippet({
        taskId: readTaskId,
        taskName: readMissionExt?.resultData?.data?.name || '',
        missionType: readMissionExt?.resultData?.data?.missionType,
        readTime,
        receiveStatus: missionStatus?.resultData?.data,
        extendMap: readMissionExt?.resultData?.data?.extendMap || {},
        jumpUrl: readMissionExt?.resultData?.data?.h5Url
          || readMissionExt?.resultData?.data?.doLink
          || '',
        note: '当前脚本未从该任务返回中拿到可浏览落地页，只做了 receiveTask + finishReadMission 直调',
      }, 1200)}`,
    );

    const finishReadResult = await finishReadMission(accountLabel, cookie, readTaskId, readTime);
    $.log(
      `${accountLabel}: 完成阅读任务 => ${stringifySnippet(finishReadResult, 600)}`,
    );

    const finalState = await queryHomeState(accountLabel, cookie, '阅读任务后最终状态', 'back');
    $.log(
      `${accountLabel}: 阅读任务后抽奖次数变化 => ${computeDrawDiff(afterBrowseTasksState, finalState)}`,
    );
    $.log(
      `${accountLabel}: 最终抽奖次数 => ${stringifySnippet(extractDrawInfo(finalState.weekSignMain), 300)}`,
    );

    await performDraws(accountLabel, cookie, riskContext, finalState);

    const afterDrawState = await queryHomeState(accountLabel, cookie, '抽奖后最终状态', 'back');
    $.log(
      `${accountLabel}: 抽奖后次数 => ${stringifySnippet(extractDrawInfo(afterDrawState.weekSignMain), 300)}`,
    );
  } finally {
    riskContext.dom.window.close();
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
