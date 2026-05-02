/*
cron:21 0,12,18 * * * jd_yangdae_goose.js

环境变量说明：
1. JD_YANGDAE_FEED_TIMES
   含义：每个账号最多喂养次数。
   是否必须：否，默认吃完当前剩余饲料；支持传正整数限制次数，传 0 / all 表示吃完为止。接口单次通常消耗 10g 饲料。

2. JD_YANGDAE_EID / JD_YANGDAE_FP / JD_YANGDAE_SDK_TOKEN
   含义：养大鹅风控参数 riskDeviceParam 中的 eid / fp / sdkToken。
   是否必须：否，默认使用当前 HAR 抓包中的可用值；风控失败时建议用京东金融 App 最新抓包值覆盖。

3. JD_YANGDAE_DEBUG
   含义：是否打印关键接口原始响应片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。

4. JD_YANGDAE_TASK_LIMIT
   含义：单次最多尝试多少个浏览任务。
   是否必须：否，默认尝试全部；支持传正整数限制数量，传 0 / all 表示全部。

5. JD_YANGDAE_TASK_WAIT_MS
   含义：浏览任务落地页最少停留时间。
   是否必须：否，默认 10000ms。若任务 URL 自带 readTime，则取二者较大值。

6. JD_YANGDAE_CHROME_BIN / CHROME_BIN
   含义：浏览任务使用的 Chrome/Chromium 可执行文件路径。
   是否必须：否，不配置时按脚本内常见路径自动探测。

7. JD_YANGDAE_FEED_INTERVAL_MS / JD_YANGDAE_FEED_BLOCK_RETRY_MS / JD_YANGDAE_FEED_BLOCK_RETRY_TIMES
   含义：喂养成功后的间隔时间、命中 AAR 风控后的等待时间、单次喂养命中风控后的重试次数。
   是否必须：否，默认分别为 2000ms / 15000ms / 3。

HAR 对应说明：
1. 来源文件：files/traffic_baitiao_sign_and_yangdae_full_filtered.har
2. 已落地链路：
   - 养大鹅登录/查询：petLogin / foodCount
   - 养大鹅签到红包：newSign
   - 领取饲料：collectTieEgg / missionList / doMission / showFeedCan / receiveFeedCan
   - 养大鹅喂养：feeding
*/

'use strict';

const fs = require('fs');
const Module = require('module');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const got = require('got');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  DEFAULT_JR_USER_AGENT,
  Env,
  getUserName,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('养大鹅');

const PAGE_URL = 'https://u.jr.jd.com/uc-fe-wxgrowing/cloudgoose/index/?channelLv=btkp&jrcontainer=h5&jrlogin=true&jrcloseweb=false';
const PAGE_ORIGIN = 'https://u.jr.jd.com';
const PAGE_REFERER = 'https://u.jr.jd.com/';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const API_BASE_URL = 'https://ms.jr.jd.com/gw2/generic/gooseTown/h5/m';
const MISSION_JUMP_INFO_URL = 'https://ms.jr.jd.com/gw2/generic/mission/h5/m/getJumpInfo';
const INSURANCE_SUB_PAGES_URL = 'https://qdserver.jd.com/api/page/insurance-sub-pages';
const INSURANCE_CHANNEL_H5_URL = 'https://fc.jr.jd.com/fc/insurance/home/';
const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_NAVIGATE_TIMEOUT_MS = 45000;
const DEFAULT_EID = 'PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4';
const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN = 'jdd01QI7EZRAXIOPWEC2HOEN3UYK5JXTMS3K4NRSL4LRCKRSM3M2NSXCRRVYC4VCZKF64Z2VSR6OF6LGOD5G7LTJ2O4PJR5PTFO7WN3OAOOI01234567';
const CHANNEL_LV = 'btkp';
const SOURCE = 2;
const EXTRA_COOKIE_ENV = 'JD_YANGDAE_EXTRA_COOKIE';
const TASK_INTERVAL_MS = 3000;
const DEFAULT_SGM_PID = '9HwAEg@vlKkp7SqT8dSSBaj';
const INSURANCE_CHANNEL_REPLAY_BODY = 'ClL0xgU/qnJc9T+6xCaURocHwhY4EErvW7Uvt3T8w5kA1g7tpBaoKUMIsmYWH2mIc/6KguABM01xOSWIgNuxSjs+g85FaF4kIMbLrZXwRvMA4gSHlaH3VUdQ6S+J/DKxp2YNHQ2t1Sp2RQG/WpOOQGkczunXjaVWH6AiT4G6UmQ=';
const DEFAULT_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const cookies = Object.values(jdCookieNode).filter(Boolean);

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_YANGDAE_DEBUG === '1';
}

function getFeedLimit() {
  const rawValue = String(process.env.JD_YANGDAE_FEED_TIMES || 'all').trim().toLowerCase();
  if (!rawValue || rawValue === 'all' || rawValue === '0') {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value < 0) {
    return Number.POSITIVE_INFINITY;
  }

  return value;
}

function getFeedIntervalMs() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_INTERVAL_MS || '2000', 10);
  if (Number.isNaN(value) || value < 0) {
    return 2000;
  }
  return value;
}

function getFeedBlockRetryMs() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_BLOCK_RETRY_MS || '15000', 10);
  if (Number.isNaN(value) || value < 0) {
    return 15000;
  }
  return value;
}

function getFeedBlockRetryTimes() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_BLOCK_RETRY_TIMES || '3', 10);
  if (Number.isNaN(value) || value < 0) {
    return 3;
  }
  return value;
}

function getTaskLimit() {
  const rawValue = String(process.env.JD_YANGDAE_TASK_LIMIT || 'all').trim().toLowerCase();
  if (!rawValue || rawValue === 'all' || rawValue === '0') {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return value;
}

function getTaskWaitMs() {
  const value = Number.parseInt(process.env.JD_YANGDAE_TASK_WAIT_MS || '10000', 10);
  if (Number.isNaN(value) || value < 0) {
    return 10000;
  }
  return value;
}

function getChromeBin() {
  const configured = String(process.env.JD_YANGDAE_CHROME_BIN || process.env.CHROME_BIN || '').trim();
  const candidates = configured ? [configured, ...DEFAULT_CHROME_CANDIDATES] : DEFAULT_CHROME_CANDIDATES;
  return candidates.find((item) => item && fs.existsSync(item)) || '';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, CHROME_DEBUG_HOST, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
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
    await sleep(300);
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

  send(method, params = {}, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
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
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_YANGDAE_CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-yangdae-chrome-'));
  const chrome = spawn(chromeBin, [
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
  ], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    await waitForChromeJson(port, '/json/version');
    const pages = await waitForChromeJson(port, '/json/list');
    const pageInfo = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || pages[0];
    if (!pageInfo?.webSocketDebuggerUrl) {
      throw new Error('Chrome 未返回可调试页面');
    }

    const page = new ChromeCdpPage(pageInfo.webSocketDebuggerUrl);
    await page.connect();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: DEFAULT_JR_USER_AGENT,
      platform: 'iPhone',
      acceptLanguage: 'zh-CN,zh;q=0.9',
    });

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

  await runtime.page?.close().catch(() => null);
  if (runtime.chrome && !runtime.chrome.killed) {
    runtime.chrome.kill('SIGTERM');
  }
  if (runtime.userDataDir) {
    try {
      fs.rmSync(runtime.userDataDir, { recursive: true, force: true });
    } catch (error) {
    }
  }
}

async function setChromeCookies(page, cookie) {
  const entries = Array.from(parseCookieString(createCookie(cookie)).entries());
  for (const [name, value] of entries) {
    await page.send('Network.setCookie', {
      name,
      value,
      domain: '.jd.com',
      path: '/',
      secure: true,
      url: PAGE_URL,
    }, CHROME_START_TIMEOUT_MS).catch(() => null);
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
    value: DEFAULT_JR_USER_AGENT,
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
  Object.defineProperty(window.screen, 'width', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: 844,
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
        Referer: PAGE_URL,
        'User-Agent': DEFAULT_JR_USER_AGENT,
      },
      timeout: { request: REQUEST_TIMEOUT_MS },
    }).text();
  }

  return aar2ScriptPromise;
}

async function createAar2Context() {
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

  return { dom, window };
}

function createRiskDeviceParam() {
  return JSON.stringify({
    macAddress: '',
    imei: '',
    eid: process.env.JD_YANGDAE_EID || DEFAULT_EID,
    openUUID: '',
    uuid: '',
    traceIp: '',
    os: 'ios',
    osVersion: '26.2',
    appId: '',
    clientVersion: '8.1.70',
    resolution: '',
    channelInfo: '',
    networkType: '',
    startNo: 42,
    openid: '',
    token: '',
    sid: '',
    terminalType: '',
    longtitude: '',
    latitude: '',
    securityData: '',
    jscContent: '',
    fnHttpHead: '',
    receiveRequestTime: '',
    port: 80,
    appType: '',
    deviceType: '',
    fp: process.env.JD_YANGDAE_FP || DEFAULT_FP,
    ip: '',
    idfa: '',
    sdkToken: process.env.JD_YANGDAE_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    osv: '26.2',
  });
}

function withCommonParams(payload) {
  return {
    ...payload,
    channelLV: CHANNEL_LV,
    source: SOURCE,
  };
}

function signPayload(aar2Context, payload) {
  const aar2 = new aar2Context.window.AAR2();
  return signTextWithAar2(aar2, JSON.stringify(payload), payload);
}

function signTextWithAar2(aar2, signText, extra = {}) {
  const nonce = aar2.nonce();
  return {
    ...extra,
    aarNonce: nonce,
    aarSignData: signText,
    aarSignature: String(aar2.sign(signText, nonce) || '').toUpperCase(),
  };
}

function createHeaders(cookie, contentType) {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: PAGE_ORIGIN,
    Referer: PAGE_REFERER,
    'User-Agent': DEFAULT_JR_USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Content-Type': contentType,
  };
}

function createCookie(cookie) {
  return mergeCookieString(cookie, process.env[EXTRA_COOKIE_ENV] || '');
}

function parseJrResponse(content) {
  const text = String(content || '').trim();
  if (!text) {
    return {};
  }

  const directData = safeJsonParse(text);
  if (directData) {
    return directData;
  }

  const decodedText = Buffer.from(text, 'base64').toString('utf8');
  return safeJsonParse(decodedText, { raw: text, decodedText });
}

function readInnerResult(responseData) {
  return responseData?.resultData?.resultData || responseData?.resultData || responseData;
}

async function postJsonApi(cookie, apiName, payload, options = {}) {
  const requestPayload = options.sign ? signPayload(options.aar2Context, payload) : payload;
  const response = await got.post(`${API_BASE_URL}/${apiName}`, {
    json: requestPayload,
    headers: createHeaders(createCookie(cookie), 'application/json'),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const responseData = parseJrResponse(response.body);

  if (isDebugEnabled()) {
    console.log(`${apiName} 响应: ${stringifySnippet(responseData, 1200)}`);
  }

  return readInnerResult(responseData);
}

async function postReqDataFormApi(cookie, apiName, requestData) {
  const url = `${API_BASE_URL}/${apiName}?_=${Date.now()}`;
  const response = await got.post(url, {
    body: `reqData=${encodeURIComponent(JSON.stringify(requestData))}`,
    headers: createHeaders(createCookie(cookie), 'application/x-www-form-urlencoded;charset=UTF-8'),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const responseData = parseJrResponse(response.body);

  if (isDebugEnabled()) {
    console.log(`${apiName} 响应: ${stringifySnippet(responseData, 1200)}`);
  }

  return readInnerResult(responseData);
}

async function getJson(url, cookie, options = {}) {
  const response = await got.get(url, {
    searchParams: options.searchParams,
    headers: {
      ...createHeaders(createCookie(cookie), ''),
      ...(options.headers || {}),
    },
    followRedirect: options.followRedirect !== false,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const responseData = safeJsonParse(response.body, {});

  if (isDebugEnabled()) {
    console.log(`${options.debugName || url} 响应: ${stringifySnippet(responseData, 1200)}`);
  }

  return responseData;
}

function createSignedRiskPayload(extra = {}) {
  return withCommonParams({
    ...extra,
    riskDeviceParam: createRiskDeviceParam(),
  });
}

function createPagePayload(extra = {}) {
  return createSignedRiskPayload({
    ...extra,
    qdPageId: 'cloudgoose',
    pageUrl: PAGE_URL,
    urlKey: '/uc-fe-wxgrowing/cloudgoose',
  });
}

async function petLogin(cookie) {
  const payload = createPagePayload({
    shareId: '',
    helpId: '',
    signId: '',
    awaken: 0,
  });
  return postJsonApi(cookie, 'petLogin', payload);
}

async function queryFoodCount(cookie) {
  return postJsonApi(cookie, 'foodCount', createSignedRiskPayload());
}

async function signIn(cookie, aar2Context) {
  const result = await postJsonApi(
    cookie,
    'newSign',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );
  const awards = Array.isArray(result.signAwardVoList)
    ? result.signAwardVoList.map((award) => `${award.awardAmount}${award.signAwardType === 2 ? '元红包' : 'g饲料'}`)
    : [];

  return {
    success: result.opResult === 0 || result.resultCode === 721,
    message: result.resultCode === 721
      ? '今日已签到'
      : (awards.length ? awards.join(' + ') : stringifySnippet(result, 300)),
  };
}

async function queryTiePageInfo(cookie) {
  return postJsonApi(
    cookie,
    'queryTiePageInfo',
    createPagePayload({
      automaticFlag: false,
    }),
  );
}

async function collectTieEgg(cookie, aar2Context) {
  const result = await postJsonApi(
    cookie,
    'collectTieEgg',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );

  return {
    success: result.opResult === 0 || result.resultCode === 501,
    message: result.opResult === 0
      ? `收蛋 ${result.numToday || 0}，饲料 ${result.foodNum || 0}g`
      : (result.resultMsg || '当前没有可收的蛋'),
  };
}

async function showFeedCan(cookie, aar2Context) {
  return postJsonApi(
    cookie,
    'showFeedCan',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );
}

async function receiveFeedCan(cookie, aar2Context) {
  const result = await postJsonApi(
    cookie,
    'receiveFeedCan',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );

  return {
    success: result.opResult === 0,
    message: result.opResult === 0
      ? `领取阶段饲料 ${result.receiveFeedAmount || 0}g`
      : result.resultMsg || stringifySnippet(result, 300),
  };
}

function isFeedCanClaimable(feedCan) {
  const amount = Number(feedCan?.feedAmount || 0);
  const status = Number(feedCan?.status ?? -1);
  const completedStage = Number(feedCan?.completedStage ?? -1);

  if (amount <= 0) {
    return false;
  }

  if (status === 2) {
    return true;
  }

  return completedStage >= 3 && status >= 1;
}

function formatFeedCanState(feedCan) {
  const amount = Number(feedCan?.feedAmount || 0);
  const status = Number(feedCan?.status ?? -1);
  const completedStage = Number(feedCan?.completedStage ?? -1);

  if (amount <= 0) {
    return '暂无阶段饲料可领取';
  }

  if (status === 2) {
    return `阶段饲料待领取 ${amount}g`;
  }

  if (completedStage >= 3 && status >= 1) {
    return `阶段饲料可尝试领取：当前累计 ${amount}g，status=${status}，completedStage=${completedStage}`;
  }

  return `阶段饲料暂不可领：当前累计 ${amount}g，status=${status}，completedStage=${completedStage}`;
}

function isFeedCanBusy(result) {
  return String(result?.message || '').includes('活动火爆');
}

async function receiveFeedCanWithRetry(cookie, aar2Context) {
  for (let retry = 0; retry < 3; retry += 1) {
    const result = await receiveFeedCan(cookie, aar2Context);
    if (result.success || !isFeedCanBusy(result) || retry === 2) {
      return result;
    }
    await sleep(3000);
  }

  return {
    success: false,
    message: '领取阶段饲料失败',
  };
}

function canClaimMission(mission) {
  if (!mission || typeof mission !== 'object') {
    return false;
  }

  if (mission.takeAward === true || mission.operate === 1) {
    return true;
  }

  return String(mission.buttonText || '') === '领奖';
}

function canBrowseMission(mission) {
  if (!mission || typeof mission !== 'object') {
    return false;
  }

  const missionUrl = String(mission.url || '').trim();
  if (!missionUrl.startsWith('http')) {
    return false;
  }

  if (mission.operate !== 3) {
    return false;
  }

  const missionName = String(mission.missionName || '');
  const missionContent = String(mission.missionContent || '');
  const buttonText = String(mission.buttonText || '');
  const text = `${missionName}|${missionContent}|${buttonText}`;
  const hasBrowseIntent = /逛|浏览|去逛逛|去浏览|查看/.test(text);
  const hasActionIntent = /打一笔|完成1笔|分期|借1笔|看视频|开炮|通过.*关|关注|领取|提现|额度/.test(text);
  const hasBrowseUrlHint = missionUrl.includes('jumpmission-v2')
    || missionUrl.includes('/static-page')
    || missionUrl.includes('readTime=')
    || missionUrl.includes('babelChannel=')
    || missionUrl.includes('/mall/active/')
    || missionUrl.includes('/credit_home/')
    || missionUrl.includes('/rich-farm/')
    || missionUrl.includes('/insurance/')
    || missionUrl.includes('/member/');

  if (buttonText !== '去完成' && buttonText !== '去浏览') {
    return false;
  }

  if (missionUrl.includes('/static-page')) {
    return true;
  }

  if (hasActionIntent && !hasBrowseIntent) {
    return false;
  }

  return hasBrowseIntent || hasBrowseUrlHint;
}

function getMissionReadTimeMs(mission) {
  const minimumWaitMs = getTaskWaitMs();
  const missionUrl = String(mission?.url || '').trim();
  if (!missionUrl.startsWith('http')) {
    return minimumWaitMs;
  }

  try {
    const parsedUrl = new URL(missionUrl);
    const readTime = Number(parsedUrl.searchParams.get('readTime') || 0);
    if (readTime > 0) {
      return Math.max((readTime + 1) * 1000, minimumWaitMs);
    }
  } catch (error) {
  }

  return minimumWaitMs;
}

function parseTransferMission(missionUrl) {
  try {
    const transferUrl = new URL(String(missionUrl || ''));
    if (!transferUrl.pathname.includes('/static-page/mission/transfer.html')) {
      return null;
    }

    const returnUrl = decodeURIComponent(transferUrl.searchParams.get('returnurl') || '');
    if (!returnUrl.startsWith('openjdjrapp://')) {
      return {
        transferUrl: transferUrl.toString(),
        returnUrl,
        readTimeMs: getMissionReadTimeMs({ url: transferUrl.toString() }),
      };
    }

    const schemeUrl = new URL(returnUrl);
    const rawJrParam = schemeUrl.searchParams.get('jrparam') || '';
    const decodedJrParam = safeJsonParse(rawJrParam, {});
    const rawJueData = String(decodedJrParam?.jueData || '');
    const decodedJueData = safeJsonParse(rawJueData, {});

    return {
      transferUrl: transferUrl.toString(),
      returnUrl,
      schemePath: `${schemeUrl.hostname}${schemeUrl.pathname}`,
      jueFileName: decodedJrParam?.jueFileName || '',
      jueData: decodedJueData,
      missionId: transferUrl.searchParams.get('missionId') || decodedJueData.missionId || '',
      channelCode: transferUrl.searchParams.get('channelCode') || decodedJueData.channelCode || '',
      readTimeMs: getMissionReadTimeMs({ url: transferUrl.toString() }),
    };
  } catch (error) {
    return null;
  }
}

function isJumpMissionUrl(url) {
  return String(url || '').includes('jumpmission-v2');
}

function resolveNativeJumpUrl(rawJumpUrl) {
  const text = String(rawJumpUrl || '');
  if (!text.startsWith('openApp.jdMobile://')) {
    return text;
  }

  try {
    const parsed = new URL(text);
    const params = safeJsonParse(parsed.searchParams.get('params') || '', {});
    if (params?.url) {
      return String(params.url);
    }
  } catch (error) {
  }

  return text;
}

async function getJumpMissionInfo(cookie, aar2Context, missionUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(missionUrl);
  } catch (error) {
    return null;
  }

  const juid = parsedUrl.searchParams.get('juid') || '';
  if (!juid) {
    return null;
  }

  const aar2 = new aar2Context.window.AAR2();
  const signText = JSON.stringify({
    juid,
    PIN: getUserName(cookie),
  });
  const signedParams = signTextWithAar2(aar2, signText, {
    juid,
    jrAppVersion: '8.1.70',
    systemEnv: 'IOS',
  });
  const responseData = await getJson(MISSION_JUMP_INFO_URL, cookie, {
    searchParams: {
      juid: signedParams.juid,
      nonce: signedParams.aarNonce,
      signature: signedParams.aarSignature,
      jrAppVersion: signedParams.jrAppVersion,
      systemEnv: signedParams.systemEnv,
    },
    headers: {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://show.jd.com',
      Referer: missionUrl,
    },
    debugName: 'getJumpInfo',
  });

  return responseData?.resultData?.data || responseData?.data || null;
}

function createSgmHeaders(traceId) {
  return {
    'x-mlaas-at': `wl=0&id=${traceId}&src=sgm-mobile`,
    'sgm-context': `${traceId};${traceId};false;${DEFAULT_SGM_PID}`,
  };
}

async function replayInsuranceChannelVisit(cookie) {
  const traceId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const response = await got.post(INSURANCE_SUB_PAGES_URL, {
    body: INSURANCE_CHANNEL_REPLAY_BODY,
    headers: {
      Cookie: createCookie(cookie),
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'Content-Type': 'text/plain',
      'User-Agent': 'JDJRMobile/618 CFNetwork/3860.300.31 Darwin/25.2.0',
      'qd-encrypted': 'v2',
      ...createSgmHeaders(traceId),
    },
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  return {
    success: response.statusCode >= 200 && response.statusCode < 300,
    message: `重放保险原生页初始化 ${response.statusCode}`,
  };
}

async function doMission(cookie, aar2Context, mission) {
  return postReqDataFormApi(cookie, 'doMission', signPayload(aar2Context, createPagePayload({
    source: SOURCE,
    mid: mission.mid,
    type: mission.type,
    gid: mission.gid,
    mdClickId: '',
    os: 'ios',
  })));
}

function formatMissionAward(result) {
  const award = result.award || (Array.isArray(result.awardList) ? result.awardList[0] : null) || {};
  return `${award.count || 0}${award.name || '饲料'}`;
}

function isTaskBusyResult(result) {
  return String(result?.resultMsg || result?.message || '').includes('活动火爆');
}

function formatMissionList(missions) {
  if (!Array.isArray(missions) || !missions.length) {
    return '任务列表: 空';
  }

  const items = missions.map((mission, index) => {
    const missionUrl = String(mission?.url || '').trim();
    return `${index + 1}.${mission.missionName || mission.gid || '未知任务'}`
      + `[status=${mission.status ?? '-'},operate=${mission.operate ?? '-'},button=${mission.buttonText || '-'}]`
      + (missionUrl ? ` ${missionUrl}` : '');
  });

  return `任务列表: ${items.join(' | ')}`;
}

function getMissionIdentity(mission) {
  return `${mission?.mid || ''}|${mission?.gid || ''}|${mission?.type || ''}`;
}

async function openMissionPage(cookie, mission, chromeRuntime, aar2Context) {
  const missionUrl = String(mission.url || '').trim();
  if (!missionUrl.startsWith('http')) {
    return {
      success: false,
      message: '任务链接不是可访问的网页地址',
    };
  }

  const nativeTransfer = parseTransferMission(missionUrl);
  if (nativeTransfer?.jueFileName === 'pageInsuranceChannel') {
    if (chromeRuntime?.page) {
      try {
        await setChromeCookies(chromeRuntime.page, cookie);
        const loadEvent = chromeRuntime.page.waitForEvent('Page.loadEventFired', CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
        const navigateResult = await chromeRuntime.page.send('Page.navigate', {
          url: INSURANCE_CHANNEL_H5_URL,
        }, CHROME_NAVIGATE_TIMEOUT_MS);
        await loadEvent;

        if (navigateResult?.errorText) {
          return {
            success: false,
            message: `保险频道打开失败：${navigateResult.errorText}`,
          };
        }

        await chromeRuntime.page.send('Runtime.evaluate', {
          expression: `(async () => {
            const totalMs = ${Math.max(1000, Math.floor(nativeTransfer.readTimeMs))};
            const rounds = Math.max(1, Math.floor(totalMs / 2000));
            for (let index = 0; index < rounds; index += 1) {
              const root = document.scrollingElement || document.documentElement || document.body;
              const maxTop = Math.max(0, (root?.scrollHeight || 0) - window.innerHeight);
              const nextTop = maxTop > 0 ? Math.floor(maxTop * ((index + 1) / rounds)) : 0;
              window.scrollTo(0, nextTop);
              await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.floor(totalMs / rounds))));
            }
            window.scrollTo(0, 0);
            return {
              href: location.href,
              title: document.title,
              readyState: document.readyState,
            };
          })();`,
          awaitPromise: true,
          returnByValue: true,
        }, nativeTransfer.readTimeMs + CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);

        return {
          success: true,
          message: `已打开保险频道 H5 页并停留 ${Math.floor(nativeTransfer.readTimeMs / 1000)} 秒`,
        };
      } catch (error) {
        return {
          success: false,
          message: error.message || '保险频道 H5 页打开失败',
        };
      }
    }

    const replayResult = await replayInsuranceChannelVisit(cookie).catch((error) => ({
      success: false,
      message: error.message || '重放保险原生页初始化失败',
    }));
    await sleep(nativeTransfer.readTimeMs);
    return {
      success: replayResult.success,
      message: replayResult.success
        ? `已重放保险原生页初始化并等待 ${Math.floor(nativeTransfer.readTimeMs / 1000)} 秒`
        : replayResult.message,
    };
  }

  const visitPlan = [{
    url: missionUrl,
    waitMs: isJumpMissionUrl(missionUrl) ? 2500 : getMissionReadTimeMs(mission),
    label: '任务页',
  }];

  if (isJumpMissionUrl(missionUrl)) {
    const jumpInfo = await getJumpMissionInfo(cookie, aar2Context, missionUrl).catch(() => null);
    const jumpUrl = resolveNativeJumpUrl(jumpInfo?.jumpUrl || '');
    if (/^https?:\/\//i.test(jumpUrl) && jumpUrl !== missionUrl) {
      visitPlan.push({
        url: jumpUrl,
        waitMs: getMissionReadTimeMs(mission),
        label: '跳转落地页',
      });
    }
  }

  if (chromeRuntime?.page) {
    try {
      await setChromeCookies(chromeRuntime.page, cookie);
      for (const step of visitPlan) {
        const loadEvent = chromeRuntime.page.waitForEvent('Page.loadEventFired', CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
        const navigateResult = await chromeRuntime.page.send('Page.navigate', {
          url: step.url,
        }, CHROME_NAVIGATE_TIMEOUT_MS);
        await loadEvent;

        if (navigateResult?.errorText) {
          return {
            success: false,
            message: `浏览器打开失败：${navigateResult.errorText}`,
          };
        }

        await chromeRuntime.page.send('Runtime.evaluate', {
          expression: `(async () => {
            const totalMs = ${Math.max(1000, Math.floor(step.waitMs))};
            const rounds = Math.max(1, Math.floor(totalMs / 2000));
            for (let index = 0; index < rounds; index += 1) {
              const root = document.scrollingElement || document.documentElement || document.body;
              const maxTop = Math.max(0, (root?.scrollHeight || 0) - window.innerHeight);
              const nextTop = maxTop > 0 ? Math.floor(maxTop * ((index + 1) / rounds)) : 0;
              window.scrollTo(0, nextTop);
              document.body?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.floor(totalMs / rounds))));
            }
            window.scrollTo(0, 0);
            return {
              href: location.href,
              title: document.title,
              readyState: document.readyState,
            };
          })();`,
          awaitPromise: true,
          returnByValue: true,
        }, step.waitMs + CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
      }

      return {
        success: true,
        message: visitPlan.length > 1
          ? `浏览任务页并跳转落地页，停留 ${Math.floor(getMissionReadTimeMs(mission) / 1000)} 秒`
          : `浏览器打开落地页并停留 ${Math.floor(getMissionReadTimeMs(mission) / 1000)} 秒`,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || '浏览器打开落地页失败',
      };
    }
  }

  try {
    const targetUrl = visitPlan[visitPlan.length - 1].url;
    const response = await got.get(targetUrl, {
      headers: createHeaders(createCookie(cookie), ''),
      followRedirect: true,
      throwHttpErrors: false,
      timeout: { request: REQUEST_TIMEOUT_MS },
    });

    await sleep(visitPlan[visitPlan.length - 1].waitMs);
    return {
      success: response.statusCode >= 200 && response.statusCode < 400,
      message: `打开落地页 ${response.statusCode}，等待 ${Math.floor(visitPlan[visitPlan.length - 1].waitMs / 1000)} 秒`,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || '打开落地页失败',
    };
  }
}

async function fetchMissionList(cookie, aar2Context) {
  const missionList = await postJsonApi(
    cookie,
    'missionList',
    createPagePayload({
      mdClickId: 'cloudgoose|renwu-main',
      os: 'ios',
      awaken: 0,
      useMoodPropYn: false,
    }),
    { sign: true, aar2Context },
  );
  return Array.isArray(missionList.missions) ? missionList.missions : [];
}

function findMissionByIdentity(missions, mission) {
  return missions.find((item) => (
    String(item.mid || '') === String(mission.mid || '')
    && String(item.gid || '') === String(mission.gid || '')
    && Number(item.type) === Number(mission.type)
  )) || null;
}

async function handleMissions(cookie, aar2Context, chromeRuntime) {
  let currentMissions = await fetchMissionList(cookie, aar2Context);
  const messages = [formatMissionList(currentMissions)];
  const processedClaimMissionIds = new Set();
  const processedBrowseMissionIds = new Set();

  while (true) {
    const claimableMission = currentMissions.find((mission) => (
      canClaimMission(mission) && !processedClaimMissionIds.has(getMissionIdentity(mission))
    ));
    if (!claimableMission) {
      break;
    }

    processedClaimMissionIds.add(getMissionIdentity(claimableMission));
    try {
      const result = await doMission(cookie, aar2Context, claimableMission);
      if (result.opResult !== 0) {
        const busySuffix = isTaskBusyResult(result) ? '，继续下一个任务' : '';
        messages.push(`任务 ${claimableMission.missionName || claimableMission.gid}: ${result.resultMsg || claimableMission.buttonText || stringifySnippet(result, 200)}${busySuffix}`);
        continue;
      }
      messages.push(`任务 ${claimableMission.missionName || claimableMission.gid}: ${formatMissionAward(result)}`);
    } catch (error) {
      messages.push(`任务 ${claimableMission.missionName || claimableMission.gid}: ${error.message || error}`);
    } finally {
      await sleep(TASK_INTERVAL_MS);
      currentMissions = await fetchMissionList(cookie, aar2Context).catch(() => currentMissions);
    }
  }

  while (processedBrowseMissionIds.size < getTaskLimit()) {
    const browseMission = currentMissions.find((mission) => (
      canBrowseMission(mission) && !processedBrowseMissionIds.has(getMissionIdentity(mission))
    ));
    if (!browseMission) {
      break;
    }

    processedBrowseMissionIds.add(getMissionIdentity(browseMission));
    try {
      const visitResult = await openMissionPage(cookie, browseMission, chromeRuntime, aar2Context);
      if (!visitResult.success) {
        messages.push(`任务 ${browseMission.missionName || browseMission.gid}: ${visitResult.message}`);
        continue;
      }
      messages.push(`任务 ${browseMission.missionName || browseMission.gid}: ${visitResult.message}`);

      await sleep(TASK_INTERVAL_MS);
      let result = await doMission(cookie, aar2Context, browseMission);
      if (result.opResult !== 0) {
        const busySuffix = isTaskBusyResult(result) ? '，继续下一个任务' : '';
        messages.push(`任务 ${browseMission.missionName || browseMission.gid}: ${result.resultMsg || browseMission.buttonText || stringifySnippet(result, 200)}${busySuffix}`);
        continue;
      }

      if (Number(result.status) === 3) {
        await sleep(TASK_INTERVAL_MS);
        currentMissions = await fetchMissionList(cookie, aar2Context).catch(() => currentMissions);
        const refreshedMission = findMissionByIdentity(currentMissions, browseMission);
        if (refreshedMission && canClaimMission(refreshedMission)) {
          result = await doMission(cookie, aar2Context, refreshedMission);
        }
      }

      if (result.opResult !== 0) {
        messages.push(`任务 ${browseMission.missionName || browseMission.gid}: ${result.resultMsg || browseMission.buttonText || stringifySnippet(result, 200)}`);
        continue;
      }

      if (Number(result.status) === 3) {
        messages.push(`任务 ${browseMission.missionName || browseMission.gid}: 浏览已提交，但服务端仍未判定完成`);
        continue;
      }

      messages.push(`任务 ${browseMission.missionName || browseMission.gid}: ${formatMissionAward(result)}`);
    } catch (error) {
      messages.push(`任务 ${browseMission.missionName || browseMission.gid}: ${error.message || error}`);
    } finally {
      await sleep(TASK_INTERVAL_MS);
      currentMissions = await fetchMissionList(cookie, aar2Context).catch(() => currentMissions);
    }
  }

  if (!messages.length) {
    return '暂无可执行任务饲料';
  }

  return messages.join('；');
}

function isAarBlocked(result) {
  return result?.resultCode === 3 || String(result?.resultMsg || '').includes('AAR');
}

async function feedOnce(cookie, aar2Context) {
  return postReqDataFormApi(cookie, 'feeding', signPayload(aar2Context, createSignedRiskPayload({
    fastYn: false,
  })));
}

async function feed(cookie, limit, aar2Context, currentFoodCount) {
  const messages = [];
  const feedIntervalMs = getFeedIntervalMs();
  const feedBlockRetryMs = getFeedBlockRetryMs();
  const feedBlockRetryTimes = getFeedBlockRetryTimes();
  let remainingFood = Number(currentFoodCount);
  const maxFeedByFood = Number.isNaN(remainingFood) ? 0 : Math.floor(remainingFood / 10);
  const effectiveLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(limit, maxFeedByFood))
    : Math.max(0, maxFeedByFood);

  if (!Number.isNaN(remainingFood)) {
    messages.push(`按当前剩余饲料 ${remainingFood}g，本轮最多喂 ${effectiveLimit} 次`);
  }

  if (effectiveLimit <= 0) {
    messages.push('饲料不足 10g，跳过喂养');
    return messages;
  }

  for (let index = 0; index < effectiveLimit; index += 1) {
    let result = null;
    let hitRiskControl = false;

    for (let retry = 0; retry <= feedBlockRetryTimes; retry += 1) {
      result = await feedOnce(cookie, aar2Context);
      if (result.opResult === 0) {
        hitRiskControl = false;
        break;
      }
      if (!isAarBlocked(result) || retry === feedBlockRetryTimes) {
        hitRiskControl = isAarBlocked(result);
        break;
      }

      messages.push(`第${index + 1}次命中 AAR 风控，等待 ${Math.floor(feedBlockRetryMs / 1000)} 秒后重试`);
      await sleep(feedBlockRetryMs);
    }

    if (!result || result.opResult !== 0) {
      messages.push(`第${index + 1}次失败：${result.resultMsg || stringifySnippet(result, 200)}`);
      if (hitRiskControl) {
        messages.push('等待后仍被金融端 AAR 风控拦截');
      }
      break;
    }

    if (!Number.isNaN(Number(result.stillCount))) {
      remainingFood = Number(result.stillCount);
    }
    messages.push(`第${index + 1}次成功，剩余 ${result.stillCount ?? '未知'}g`);
    if (result.allowFeedingYn === false || Number(result.stillCount || 0) <= 0 || remainingFood < 10) {
      break;
    }

    if (index < effectiveLimit - 1) {
      await sleep(feedIntervalMs);
    }
  }

  return messages;
}

async function runForAccount(cookie, index, aar2Context) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const messages = [];
  let chromeRuntime = null;

  try {
    chromeRuntime = await launchChrome().catch((error) => {
      messages.push(`任务浏览器启动失败：${error.message || error}`);
      return null;
    });

    const loginInfo = await petLogin(cookie);
    messages.push(`初始饲料 ${loginInfo.foodCount ?? '未知'}g`);

    const tiePageInfo = await queryTiePageInfo(cookie);
    messages.push(`收蛋按钮：${tiePageInfo.btnText || '未知'}`);

    const signResult = await signIn(cookie, aar2Context);
    messages.push(`签到红包/饲料：${signResult.message}`);

    if (String(tiePageInfo.btnText || '').includes('收蛋')) {
      const eggResult = await collectTieEgg(cookie, aar2Context);
      messages.push(eggResult.message);
    } else {
      messages.push('当前没有可收的蛋');
    }

    const missionMessage = await handleMissions(cookie, aar2Context, chromeRuntime);
    messages.push(missionMessage);

    const feedCan = await showFeedCan(cookie, aar2Context);
    messages.push(formatFeedCanState(feedCan));
    if (isFeedCanClaimable(feedCan)) {
      const receiveResult = await receiveFeedCanWithRetry(cookie, aar2Context);
      messages.push(receiveResult.message);
    }

    const foodInfo = await queryFoodCount(cookie);
    messages.push(`当前饲料 ${foodInfo.count ?? '未知'}g`);

    const feedMessages = await feed(cookie, getFeedLimit(), aar2Context, foodInfo.count);
    messages.push(feedMessages.length ? feedMessages.join('；') : '已跳过喂养');

    return `${prefix}: ${messages.join('；')}`;
  } catch (error) {
    return `${prefix}: 执行异常，${error.message || error}`;
  } finally {
    await closeChrome(chromeRuntime);
  }
}

(async () => {
  if (!cookies.length) {
    $.log('未配置 JD_COOKIE');
    return;
  }

  const aar2Context = await createAar2Context();
  try {
    for (let index = 0; index < cookies.length; index += 1) {
      const message = await runForAccount(cookies[index], index + 1, aar2Context);
      $.log(message);
    }
  } finally {
    aar2Context.dom.window.close();
  }
})()
  .catch((error) => {
    $.log(`脚本异常：${error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
