/*
cron:23 0 * * * jd_miaosha_sign_bean.js

京东秒杀签到领京豆。

流程来自 files/jd_miaosha_sign_filtered.har：
1. secEntryBenefitReceive 尝试领取秒杀入口权益。
2. findBeanSceneNew 查询秒杀京豆签到状态和动态任务 ID。
3. bff_rightsCenter_interaction 执行 beanDailySign 签到。
4. findBeanSceneNew 复查京豆数、连续签到天数和任务状态。

环境变量：
1. JD_MIAOSHA_SIGN_DEBUG=1 打印更长 request/response。
2. JD_MIAOSHA_SIGN_SKIP_ENTRY=1 跳过秒杀入口权益领取。
3. JD_MIAOSHA_SIGN_SKIP_PRE=1 跳过 interact_pre_executor 状态探测。
*/

'use strict';

const got = require('got');
const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  createH5st,
  getRequestUuid,
  getUserName,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

let dylib = null;
try {
  dylib = require('./function/dylib.js');
} catch (error) {
  dylib = null;
}

const $ = new Env('京东秒杀签到领京豆');

const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = 'Md9FMi1pJXg2q7qc8CmE9FNYDS4';
const PAGE_BASE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_BASE_URL}?babelChannel=ttt1&hybrid_err_view=1&has_native=0&linkTag=miaosha&actSecTraffic=1`;
const API_ENDPOINT = 'https://api.m.jd.com/client.action';

const CLIENT_VERSION = '15.9.30';
const BUILD = '170613';
const SCREEN = '390*676';
const NETWORK_TYPE = 'wifi';
const D_MODEL = 'iPhone14,5';
const OS_VERSION = '26.2';
const DEFAULT_AREA = '18_1482_3606_60000';
const DEFAULT_LNG = 113.036891;
const DEFAULT_LAT = 28.210264;
const REQUEST_TIMEOUT_MS = 20000;
const RETRY_WAIT_MS = 1500;
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_COMMAND_TIMEOUT_MS = 20000;
const CHROME_NAVIGATE_TIMEOUT_MS = 30000;
const CHROME_LOAD_WAIT_MS = 15000;
const CHROME_CLICK_WAIT_MS = 5000;

const USER_AGENT = process.env.JD_MIAOSHA_SIGN_USER_AGENT
  || 'jdapp;iPhone;15.9.30;;;M/5.0;appBuild/170613;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const DEFAULT_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/opt/homebrew/bin/chromium',
  '/usr/local/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const API_CONFIG = {
  preExecutor: {
    functionId: 'interact_pre_executor',
    appid: 'signed_wh5',
    client: 'ios',
    h5stAppId: '581c8',
    extraForm: {
      channelCode: 'wh5',
      sceneCode: 'miaosha',
    },
  },
  entryBenefit: {
    functionId: 'secEntryBenefitReceive',
    appid: 'signed_wh5',
    client: 'ios',
    h5stAppId: '8f29c',
  },
  queryScene: {
    functionId: 'findBeanSceneNew',
    appid: 'signed_wh5_ihub',
    client: 'apple',
    h5stAppId: 'ed9a2',
    extraForm: {
      build: BUILD,
      area: DEFAULT_AREA,
      uemps: '0-2-0',
    },
  },
  sign: {
    functionId: 'bff_rightsCenter_interaction',
    appid: 'signed_wh5',
    client: 'ios',
    h5stAppId: '90b26',
    extraForm: {
      sceneType: 'activity',
    },
  },
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MIAOSHA_SIGN_DEBUG === '1';
}

function stringifyForLog(value, maxLength = 1600) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 6000) : maxLength);
}

function appendFormValue(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.set(key, String(value));
  }
}

function getCookieValue(cookie, key) {
  return parseCookieString(cookie).get(key) || '';
}

function getUuid(cookie) {
  return process.env.JD_MIAOSHA_SIGN_UUID
    || getCookieValue(cookie, '__jdu')
    || getRequestUuid(cookie);
}

function getUserAgent(userName) {
  if (process.env.JD_MIAOSHA_SIGN_USER_AGENT) {
    return process.env.JD_MIAOSHA_SIGN_USER_AGENT;
  }

  try {
    if (typeof dylib?.getUA === 'function') {
      return dylib.getUA(userName);
    }
  } catch (error) {
    return USER_AGENT;
  }

  return USER_AGENT;
}

async function getTokenInfo(userAgent) {
  if (process.env.JD_MIAOSHA_SIGN_EID_TOKEN) {
    return {
      eid: process.env.JD_MIAOSHA_SIGN_EID || '',
      token: process.env.JD_MIAOSHA_SIGN_EID_TOKEN,
    };
  }

  try {
    if (typeof dylib?.jddToken === 'function') {
      const tokenInfo = await dylib.jddToken(userAgent);
      return {
        eid: tokenInfo?.eid || '',
        token: tokenInfo?.token || '',
      };
    }
  } catch (error) {
    return { eid: '', token: '' };
  }

  return { eid: '', token: '' };
}

async function createRuntime(cookie, index) {
  const userName = getUserName(cookie);
  const userAgent = getUserAgent(userName);
  const tokenInfo = await getTokenInfo(userAgent);
  return {
    index,
    cookie,
    userName,
    userAgent,
    uuid: getUuid(cookie),
    eid: process.env.JD_MIAOSHA_SIGN_EID || tokenInfo.eid || '',
    eidToken: process.env.JD_MIAOSHA_SIGN_EID_TOKEN || tokenInfo.token || '',
  };
}

function redactValue(key, value) {
  if (/cookie|token|pt_key|pt_pin/i.test(key)) {
    return value ? '已隐藏' : value;
  }
  if (key === 'h5st' && typeof value === 'string') {
    return `${value.split(';').slice(0, 4).join(';')};...`;
  }
  return value;
}

function redactObjectForLog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      result[key] = redactObjectForLog(item);
      continue;
    }
    result[key] = redactValue(key, item);
  }
  return result;
}

function buildMetaForm(runtime, apiConfig) {
  const meta = {
    screen: SCREEN,
    networkType: NETWORK_TYPE,
    openudid: runtime.uuid,
    uuid: runtime.uuid,
    clientVersion: CLIENT_VERSION,
    d_model: D_MODEL,
    osVersion: OS_VERSION,
    eid: runtime.eid,
    'x-api-eid-token': runtime.eidToken,
  };

  if (apiConfig.client === 'apple') {
    meta.build = BUILD;
    meta.area = DEFAULT_AREA;
    meta.uemps = '0-2-0';
    meta.ext = JSON.stringify({
      appType: 'jdapp',
      systemType: 'ios',
      pageUrl: PAGE_BASE_URL,
    });
  }

  return meta;
}

async function buildSignedForm(runtime, apiConfig, body) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body || {});
  const form = new URLSearchParams();

  appendFormValue(form, 'functionId', apiConfig.functionId);
  appendFormValue(form, 'body', bodyText);
  appendFormValue(form, 'appid', apiConfig.appid);
  appendFormValue(form, 'client', apiConfig.client);

  const meta = {
    ...buildMetaForm(runtime, apiConfig),
    ...(apiConfig.extraForm || {}),
  };
  for (const [key, value] of Object.entries(meta)) {
    appendFormValue(form, key, value);
  }

  const h5st = await createH5st({
    functionId: apiConfig.functionId,
    body: body || {},
    h5stAppId: apiConfig.h5stAppId,
    requestAppid: apiConfig.appid,
    cookie: runtime.cookie,
    userAgent: runtime.userAgent,
    client: apiConfig.client,
    clientVersion: CLIENT_VERSION,
    version: '5.3',
  });
  appendFormValue(form, 'h5st', h5st);

  return form;
}

function decodeMaybeBase64(content) {
  const text = String(content || '').trim();
  if (!text || /^[{\[]/.test(text)) {
    return text;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(text) || text.length % 4 !== 0) {
    return text;
  }

  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
    return /^[{\[]/.test(decoded) ? decoded : text;
  } catch (error) {
    return text;
  }
}

function parseResponseBody(rawBody) {
  const decodedBody = decodeMaybeBase64(rawBody);
  return safeJsonParse(decodedBody, decodedBody);
}

function buildRequestHeaders(runtime) {
  return buildHeaders(runtime.cookie, {
    origin: ORIGIN,
    referer: PAGE_REFERER,
    userAgent: runtime.userAgent,
    extraHeaders: {
      Accept: '*/*',
      'x-referer-page': PAGE_BASE_URL,
    },
  });
}

function logRequest(runtime, apiConfig, url, form) {
  const requestLog = {
    url,
    method: 'POST',
    form: redactObjectForLog(Object.fromEntries(form.entries())),
    headers: {
      Origin: ORIGIN,
      Referer: PAGE_REFERER,
      'User-Agent': runtime.userAgent,
      Cookie: '已隐藏',
    },
  };
  $.log(`账号${runtime.index} ${runtime.userName}: 请求 => ${apiConfig.functionId} ${stringifyForLog(requestLog)}`);
}

function logResponse(runtime, apiConfig, response, body) {
  $.log(`账号${runtime.index} ${runtime.userName}: 响应 => ${apiConfig.functionId} ${stringifyForLog({
    statusCode: response.statusCode,
    headers: {
      'content-type': response.headers['content-type'],
      'x-api-request-id': response.headers['x-api-request-id'],
      'x-api-wl-message': response.headers['x-api-wl-message'],
    },
    body,
  }, 2200)}`);
}

function getChromeBin() {
  const configured = String(process.env.JD_MIAOSHA_SIGN_CHROME_BIN || '').trim();
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

  throw new Error(`Chrome DevTools 启动超时：${lastError?.message || url}`);
}

function isImportantChromeRequest(url) {
  return [
    'findBeanSceneNew',
    'bff_rightsCenter_interaction',
    'secEntryBenefitReceive',
    'interact_pre_executor',
    'api.m.jd.com',
    PAGE_ID,
  ].some((keyword) => String(url || '').includes(keyword));
}

function decodeChromeBody(body, base64Encoded) {
  if (!body) {
    return '';
  }
  if (!base64Encoded) {
    return decodeMaybeBase64(body);
  }

  const buffer = Buffer.from(body, 'base64');
  const text = buffer.toString('utf8');
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 80))) {
    return `[base64 ${buffer.length} bytes] ${body.slice(0, 300)}`;
  }
  return decodeMaybeBase64(text);
}

class ChromeCdpPage {
  constructor(wsUrl, logger) {
    this.wsUrl = wsUrl;
    this.logger = logger;
    this.nextId = 1;
    this.pending = new Map();
    this.requestMap = new Map();
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

    if (message.method === 'Network.requestWillBeSent') {
      this.handleRequest(message.params || {});
    }
    if (message.method === 'Network.responseReceived') {
      this.handleResponse(message.params || {});
    }
    if (message.method === 'Network.loadingFinished') {
      this.handleLoadingFinished(message.params || {});
    }
    if (message.method === 'Network.loadingFailed') {
      this.handleLoadingFailed(message.params || {});
    }
  }

  handleRequest(params) {
    const request = params.request || {};
    if (!isImportantChromeRequest(request.url)) {
      return;
    }

    this.requestMap.set(params.requestId, {
      url: request.url,
      method: request.method,
      postData: request.postData || '',
    });
    this.logger(`Chrome 请求 => ${request.method} ${request.url}`);
    if (request.postData) {
      this.logger(`Chrome 请求体 => ${stringifyForLog(request.postData, 1800)}`);
    }
  }

  handleResponse(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }

    const response = params.response || {};
    meta.status = response.status;
    meta.mimeType = response.mimeType || '';
    this.logger(`Chrome 响应头 => HTTP ${response.status} ${meta.method} ${meta.url}`);
  }

  handleLoadingFinished(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }

    this.send('Network.getResponseBody', { requestId: params.requestId }, 5000)
      .then((result) => {
        const body = decodeChromeBody(result.body || '', Boolean(result.base64Encoded));
        this.logger(`Chrome 响应体 => ${stringifyForLog(body, 2200)}`);
      })
      .catch((error) => {
        this.logger(`Chrome 响应体获取失败 => ${error.message || error}`);
      })
      .finally(() => {
        this.requestMap.delete(params.requestId);
      });
  }

  handleLoadingFailed(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }

    this.logger(`Chrome 请求失败 => ${params.errorText || '-'} ${meta.method} ${meta.url}`);
    this.requestMap.delete(params.requestId);
  }

  send(method, params = {}, timeoutMs = CHROME_COMMAND_TIMEOUT_MS) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools 未连接'));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 调用超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = CHROME_COMMAND_TIMEOUT_MS) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text
        || result.exceptionDetails.exception?.description
        || '页面脚本执行异常';
      throw new Error(text);
    }
    return result.result?.value;
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

async function launchChrome(runtime) {
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_MIAOSHA_SIGN_CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-miaosha-sign-chrome-'));
  $.log(`账号${runtime.index} ${runtime.userName}: Chrome => ${chromeBin}`);
  $.log(`账号${runtime.index} ${runtime.userName}: CDP 端口 => ${port}`);

  const chrome = childProcess.spawn(chromeBin, [
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

    const page = new ChromeCdpPage(pageInfo.webSocketDebuggerUrl, (message) => {
      $.log(`账号${runtime.index} ${runtime.userName}: ${message}`);
    });
    await page.connect();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: runtime.userAgent,
      platform: 'iPhone',
      acceptLanguage: 'zh-CN,zh-Hans;q=0.9',
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 676,
      deviceScaleFactor: 3,
      mobile: true,
    });

    return {
      chrome,
      page,
      userDataDir,
    };
  } catch (error) {
    chrome.kill('SIGTERM');
    throw error;
  }
}

async function closeChrome(chromeRuntime) {
  if (!chromeRuntime) {
    return;
  }

  await chromeRuntime.page?.close().catch(() => null);
  if (chromeRuntime.chrome && !chromeRuntime.chrome.killed) {
    chromeRuntime.chrome.kill('SIGTERM');
    await sleep(500);
  }
  if (chromeRuntime.userDataDir) {
    fs.rmSync(chromeRuntime.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

async function setChromeCookies(page, cookie) {
  const cookieMap = parseCookieString(cookie);
  for (const [name, value] of cookieMap.entries()) {
    await page.send('Network.setCookie', {
      name,
      value,
      domain: '.jd.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'None',
    });
  }
}

function getPageStateExpression() {
  return `(() => {
    const text = document.body ? document.body.innerText : '';
    return {
      href: location.href,
      readyState: document.readyState,
      hasParamsSign: Boolean(window.ParamsSign || window.ParamsSignLite || window.ParamsSignMain),
      text: text.slice(0, 1400),
    };
  })()`;
}

function getClickSignExpression() {
  return `(() => {
    const keywords = ['签到', '最高得', '领京豆', '立即领取', '领取'];
    const nodes = Array.from(document.querySelectorAll('button, a, div, span, p'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        return { node, rect, text };
      })
      .filter((item) => item.text && item.rect.width > 0 && item.rect.height > 0)
      .filter((item) => item.rect.bottom >= 0 && item.rect.top <= window.innerHeight)
      .filter((item) => keywords.some((keyword) => item.text.includes(keyword)))
      .sort((a, b) => {
        const aScore = (a.text.includes('签到') ? 0 : 10) + (a.text.includes('京豆') ? 0 : 5) + a.text.length / 1000;
        const bScore = (b.text.includes('签到') ? 0 : 10) + (b.text.includes('京豆') ? 0 : 5) + b.text.length / 1000;
        return aScore - bScore;
      });
    const target = nodes[0];
    if (!target) {
      return { clicked: false, reason: '未找到签到/领京豆元素' };
    }
    target.node.scrollIntoView({ block: 'center', inline: 'center' });
    target.node.click();
    return {
      clicked: true,
      text: target.text.slice(0, 120),
      rect: {
        x: Math.round(target.rect.x),
        y: Math.round(target.rect.y),
        width: Math.round(target.rect.width),
        height: Math.round(target.rect.height),
      },
    };
  })()`;
}

async function runChromeFallback(runtime) {
  $.log(`账号${runtime.index} ${runtime.userName}: Node 未完成签到，切换 headless Chrome 调试`);
  let chromeRuntime = null;
  let clickedCount = 0;
  let finalState = null;
  try {
    chromeRuntime = await launchChrome(runtime);
    await setChromeCookies(chromeRuntime.page, runtime.cookie);
    $.log(`账号${runtime.index} ${runtime.userName}: Cookie 已注入 => pt_key, pt_pin`);

    await chromeRuntime.page.send('Page.navigate', { url: PAGE_REFERER }, CHROME_NAVIGATE_TIMEOUT_MS);
    $.log(`账号${runtime.index} ${runtime.userName}: 开始导航 => ${PAGE_REFERER}`);
    await sleep(CHROME_LOAD_WAIT_MS);

    const initialState = await chromeRuntime.page.evaluate(getPageStateExpression());
    $.log(`账号${runtime.index} ${runtime.userName}: Chrome 页面状态 => ${stringifyForLog(initialState, 2200)}`);

    for (let round = 1; round <= 4; round += 1) {
      const clickResult = await chromeRuntime.page.evaluate(getClickSignExpression());
      $.log(`账号${runtime.index} ${runtime.userName}: Chrome 点击尝试${round} => ${stringifyForLog(clickResult)}`);
      await sleep(CHROME_CLICK_WAIT_MS);
      if (!clickResult.clicked) {
        break;
      }
      clickedCount += 1;
    }

    finalState = await chromeRuntime.page.evaluate(getPageStateExpression());
    $.log(`账号${runtime.index} ${runtime.userName}: Chrome 结束状态 => ${stringifyForLog(finalState, 2200)}`);
    return {
      clickedCount,
      finalState,
      summary: summarizeChromeState(finalState),
    };
  } finally {
    await closeChrome(chromeRuntime);
  }
}

function summarizeChromeState(state) {
  const text = String(state?.text || '').replace(/\s+/g, ' ');
  const beanBalance = text.match(/京豆可抵\s*¥\s*([0-9.]+)/)?.[1] || '';
  const continuousDays = text.match(/连签\s*([0-9]+)\s*天/)?.[1] || '';
  return {
    href: state?.href,
    signedTextVisible: /连签\s*[0-9]+\s*天/.test(text),
    signButtonVisible: text.includes('签到领京豆'),
    beanBalance,
    continuousDays,
  };
}

async function callApi(runtime, apiConfig, body) {
  const url = `${API_ENDPOINT}?functionId=${apiConfig.functionId}`;
  const form = await buildSignedForm(runtime, apiConfig, body);
  const headers = buildRequestHeaders(runtime);

  logRequest(runtime, apiConfig, url, form);
  const response = await got.post(url, {
    body: form.toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const parsedBody = parseResponseBody(response.body || '');
  logResponse(runtime, apiConfig, response, parsedBody);

  return {
    statusCode: response.statusCode,
    body: parsedBody,
    rawBody: response.body || '',
  };
}

function isSuccessResponse(responseBody) {
  const code = String(responseBody?.code ?? responseBody?.errCode ?? '');
  const bizCodeValue = responseBody?.data?.bizCode ?? responseBody?.bizCode;
  const bizCode = String(bizCodeValue ?? '');
  const text = JSON.stringify(responseBody || {});
  if (bizCodeValue !== undefined && bizCode !== '0') {
    return false;
  }
  return responseBody?.success === true
    || code === '0'
    || code === '200'
    || bizCode === '0'
    || /成功|完成|已完成|领取/.test(text);
}

function getSceneData(responseBody) {
  return responseBody?.data || {};
}

function summarizeScene(responseBody) {
  const data = getSceneData(responseBody);
  return {
    status: data.status,
    totalUserBean: data.totalUserBean || data.totalBean?.beanNum,
    continuousDays: data.continuousDays,
    todayBeanNum: data.todayBeanNum,
    signType: data.signType,
    task: extractSignTask(data),
    entryBenefit: data.seckillBenefitVO
      ? {
        status: data.seckillBenefitVO.status,
        taskType: data.seckillBenefitVO.taskType,
        awards: summarizeAwards(data.seckillBenefitVO.awardList),
      }
      : null,
  };
}

function summarizeAwards(awardList) {
  if (!Array.isArray(awardList)) {
    return [];
  }
  return awardList.map((award) => ({
    type: award.type,
    status: award.status,
    beanNum: award.beanNum,
    amount: award.amount,
    prizeName: award.prizeName || award.rewardName,
  }));
}

function extractSignTask(sceneData) {
  const taskList = Array.isArray(sceneData?.signComponentInfoResult)
    ? sceneData.signComponentInfoResult
    : [];

  return taskList.find((task) => task?.encryptAssignmentId)
    || taskList.find((task) => task?.assignmentId)
    || null;
}

function isTaskCompleted(task) {
  return Boolean(
    task?.completionFlag
    || task?.completed
    || String(task?.status || '') === '2',
  );
}

function buildSceneBody() {
  return {
    requestSource: 'normal',
    babelChannel: 'ttt1',
    actSecTraffic: '1',
    lng: Number(process.env.JD_MIAOSHA_SIGN_LNG || DEFAULT_LNG),
    lat: Number(process.env.JD_MIAOSHA_SIGN_LAT || DEFAULT_LAT),
  };
}

function buildSignBody(task) {
  return {
    scene: 'commonDoInteractiveAssignment',
    activityCode: 'beanDailySign',
    businessScenario: 'jingDouCenter',
    commonScene: 'secKillChannel',
    assignmentId: String(task.encryptAssignmentId || task.assignmentId || ''),
  };
}

async function queryScene(runtime, label) {
  const response = await callApi(runtime, API_CONFIG.queryScene, buildSceneBody());
  $.log(`账号${runtime.index} ${runtime.userName}: ${label} => ${stringifyForLog(summarizeScene(response.body), 1600)}`);
  return response;
}

async function tryEntryBenefit(runtime) {
  if (process.env.JD_MIAOSHA_SIGN_SKIP_ENTRY === '1') {
    $.log(`账号${runtime.index} ${runtime.userName}: 已跳过秒杀入口权益领取`);
    return;
  }

  const response = await callApi(runtime, API_CONFIG.entryBenefit, {
    channelId: '2',
    actSecTraffic: '1',
  });
  const result = response.body?.data?.result || response.body?.result || {};
  $.log(`账号${runtime.index} ${runtime.userName}: 秒杀入口权益 => ${stringifyForLog({
    success: isSuccessResponse(response.body),
    status: result.status,
    taskType: result.taskType,
    awards: summarizeAwards(result.awardList),
    message: response.body?.message || response.body?.msg || response.body?.data?.bizMsg,
  })}`);
}

async function tryPreExecutor(runtime) {
  if (process.env.JD_MIAOSHA_SIGN_SKIP_PRE === '1') {
    return;
  }

  const response = await callApi(runtime, API_CONFIG.preExecutor, {});
  $.log(`账号${runtime.index} ${runtime.userName}: 秒杀任务预查询 => ${stringifyForLog(response.body?.data?.result || response.body, 1200)}`);
}

async function signDaily(runtime, task) {
  if (!task) {
    $.log(`账号${runtime.index} ${runtime.userName}: 未找到签到任务，跳过签到`);
    return false;
  }

  if (isTaskCompleted(task)) {
    $.log(`账号${runtime.index} ${runtime.userName}: 签到任务已完成 => ${task.assignmentName || task.encryptAssignmentId || task.assignmentId}`);
    return true;
  }

  const response = await callApi(runtime, API_CONFIG.sign, buildSignBody(task));
  const rewardsInfo = response.body?.rs?.rewardsInfo || {};
  $.log(`账号${runtime.index} ${runtime.userName}: 签到结果 => ${stringifyForLog({
    success: isSuccessResponse(response.body),
    code: response.body?.code,
    msg: response.body?.msg || response.body?.displayMsg,
    assignmentInfo: response.body?.rs?.assignmentInfo,
    rewardsInfo,
  }, 2200)}`);

  return isSuccessResponse(response.body);
}

async function handleAccount(cookie, index) {
  const runtime = await createRuntime(cookie, index);
  $.log(`\n==== 账号${index} ${runtime.userName} ====`);
  $.log(`账号${index} ${runtime.userName}: UA => ${runtime.userAgent}`);
  $.log(`账号${index} ${runtime.userName}: uuid => ${runtime.uuid}`);
  $.log(`账号${index} ${runtime.userName}: x-api-eid-token => ${runtime.eidToken ? `${runtime.eidToken.slice(0, 18)}...` : '空'}`);

  await tryPreExecutor(runtime);
  await tryEntryBenefit(runtime);
  await sleep(RETRY_WAIT_MS);

  const beforeResponse = await queryScene(runtime, '签到前状态');
  const beforeData = getSceneData(beforeResponse.body);
  const signTask = extractSignTask(beforeData);
  const nodeSignSuccess = await signDaily(runtime, signTask);
  let chromeResult = null;

  if (!nodeSignSuccess) {
    chromeResult = await runChromeFallback(runtime);
  }

  await sleep(RETRY_WAIT_MS);

  const afterResponse = await queryScene(runtime, '签到后状态');
  const beforeSummary = summarizeScene(beforeResponse.body);
  const afterSummary = summarizeScene(afterResponse.body);
  $.log(`账号${index} ${runtime.userName}: 京豆变化 => ${stringifyForLog({
    before: {
      totalUserBean: beforeSummary.totalUserBean,
      continuousDays: beforeSummary.continuousDays,
      status: beforeSummary.status,
    },
    after: {
      totalUserBean: afterSummary.totalUserBean,
      continuousDays: afterSummary.continuousDays,
      status: afterSummary.status,
    },
  })}`);

  if (chromeResult && String(afterResponse.body?.code || '') === '402') {
    $.log(`账号${index} ${runtime.userName}: Node 复查仍被限流，Chrome 兜底结果 => ${stringifyForLog({
      clickedCount: chromeResult.clickedCount,
      ...chromeResult.summary,
    })}`);
  }
}

(async () => {
  if (!cookies.length) {
    $.log('未找到有效 JD_COOKIE');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await handleAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行异常 => ${error.message}`);
    }
    await sleep(1000);
  }
})()
  .catch((error) => {
    $.log(`执行异常 => ${error.stack || error.message}`);
  })
  .finally(() => {
    $.done();
  });
