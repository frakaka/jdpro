/*
cron:23 0 * * * jd_miaosha_sign_bean.js

京东秒杀签到领京豆。

流程来自 files/jd_miaosha_sign_filtered.har：
1. headless Chrome 打开秒杀签到页并注入账号 Cookie。
2. 页面原生逻辑生成风控参数和 h5st。
3. 点击签到/领取按钮。
4. 通过 CDP 打印关键 request/response，方便分析实际签到接口。

环境变量：
1. JD_MIAOSHA_SIGN_DEBUG=1 打印更长 request/response。
2. JD_MIAOSHA_SIGN_CHROME_BIN 可选，指定 Chrome/Chromium 可执行文件。
*/

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const got = require('got');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
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

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MIAOSHA_SIGN_DEBUG === '1';
}

function stringifyForLog(value, maxLength = 1600) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 6000) : maxLength);
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

function createRuntime(cookie, index) {
  const userName = getUserName(cookie);
  const userAgent = getUserAgent(userName);
  return {
    index,
    cookie,
    userName,
    userAgent,
  };
}

function redactTextForLog(value) {
  return String(value || '')
    .replace(/pt_key=[^;&\s]+/g, 'pt_key=已隐藏')
    .replace(/pt_pin=[^;&\s]+/g, 'pt_pin=已隐藏')
    .replace(/(x-api-eid-token=)[^&\s]+/ig, '$1已隐藏')
    .replace(/(h5st=)[^&\s]+/ig, '$1已隐藏')
    .replace(/("x-api-eid-token"\s*:\s*")[^"]+/ig, '$1已隐藏')
    .replace(/("h5st"\s*:\s*")[^"]+/ig, '$1已隐藏');
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
    this.logger(`Chrome 请求 => ${request.method} ${redactTextForLog(request.url)}`);
    if (request.postData) {
      this.logger(`Chrome 请求体 => ${stringifyForLog(redactTextForLog(request.postData), 1800)}`);
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
    this.logger(`Chrome 响应头 => HTTP ${response.status} ${meta.method} ${redactTextForLog(meta.url)}`);
  }

  handleLoadingFinished(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }

    this.send('Network.getResponseBody', { requestId: params.requestId }, 5000)
      .then((result) => {
        const body = decodeChromeBody(result.body || '', Boolean(result.base64Encoded));
        this.logger(`Chrome 响应体 => ${stringifyForLog(redactTextForLog(body), 2200)}`);
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

    this.logger(`Chrome 请求失败 => ${params.errorText || '-'} ${meta.method} ${redactTextForLog(meta.url)}`);
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
    const elements = Array.from(document.querySelectorAll('button, a, div, span, p'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
        return { element, rect, text };
      })
      .filter((item) => item.text && item.rect.width > 0 && item.rect.height > 0)
      .filter((item) => item.rect.bottom >= 0 && item.rect.top <= window.innerHeight)
      .filter((item) => keywords.some((keyword) => item.text.includes(keyword)))
      .sort((a, b) => {
        const aScore = (a.text.includes('签到') ? 0 : 10) + (a.text.includes('京豆') ? 0 : 5) + a.text.length / 1000;
        const bScore = (b.text.includes('签到') ? 0 : 10) + (b.text.includes('京豆') ? 0 : 5) + b.text.length / 1000;
        return aScore - bScore;
      });
    const target = elements[0];
    if (!target) {
      return { clicked: false, reason: '未找到签到/领京豆元素' };
    }
    target.element.scrollIntoView({ block: 'center', inline: 'center' });
    target.element.click();
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

async function runChromeSign(runtime) {
  $.log(`账号${runtime.index} ${runtime.userName}: 使用 headless Chrome 执行秒杀签到`);
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

async function handleAccount(cookie, index) {
  const runtime = createRuntime(cookie, index);
  $.log(`\n==== 账号${index} ${runtime.userName} ====`);
  $.log(`账号${index} ${runtime.userName}: UA => ${runtime.userAgent}`);
  const chromeResult = await runChromeSign(runtime);
  $.log(`账号${index} ${runtime.userName}: Chrome 签到结果 => ${stringifyForLog({
    clickedCount: chromeResult.clickedCount,
    ...chromeResult.summary,
  })}`);
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
