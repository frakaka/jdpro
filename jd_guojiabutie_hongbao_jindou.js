/*
cron:28 0 * * * jd_guojiabutie_hongbao_jindou.js

国家补贴二楼红包/京豆入口巡检。

流程来自 files/jd_guojiabutie_hongbao_jindou_sign_filtered.har：
1. headless Chrome 打开国家补贴页并注入账号 Cookie。
2. 页面原生逻辑生成风控参数和 h5st，并请求 secondFloor / SecFloorBrowseHistory。
3. 从 CDP 捕获的 secondFloor 响应或 DOM 链接提取京豆、红包、试用、抽奖、权益中心等入口。
4. 已知入口交给现有脚本执行；未知入口继续走 headless Chrome，打印关键 request/response。

环境变量：
1. JD_GUOJIA_BUTIE_RUN_MAPPED=0 跳过已知入口脚本分流。
2. JD_GUOJIA_BUTIE_USE_CHROME=0 跳过 Chrome 页面巡检，使用 HAR 静态入口兜底。
3. JD_GUOJIA_BUTIE_DEBUG=1 打印更长 request/response。
4. JD_GUOJIA_BUTIE_CHROME_BIN 可选，指定 Chrome/Chromium 可执行文件。
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
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('国家补贴红包京豆入口');

const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = '3b86xJ8EVja357au9NNG6ZSeV3Fw';
const PAGE_BASE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_BASE_URL}?hybrid_err_view=1&has_native=0&babelChannel=ttt58`;
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_COMMAND_TIMEOUT_MS = 20000;
const CHROME_NAVIGATE_TIMEOUT_MS = 45000;
const CHROME_LOAD_WAIT_MS = readPositiveInt(process.env.JD_GUOJIA_BUTIE_CHROME_LOAD_MS, 15000);
const CHROME_CLICK_ROUNDS = readPositiveInt(process.env.JD_GUOJIA_BUTIE_CHROME_CLICK_ROUNDS, 3);
const DEFAULT_USER_AGENT = 'jdapp;iPhone;15.9.30;;;M/5.0;appBuild/170613;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

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
  '/opt/google/chrome/chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const KNOWN_ENTRY_SCRIPTS = [
  {
    label: '赚红包',
    pageId: 'B2Y13x641hwWfpsoRenCzfbz4jR',
    script: 'jd_zhuanhongbao_task.js',
  },
  {
    label: '天天刮豆',
    pageId: '4E1fFrgX1eGtWTc5KBNFzXMrh6xn',
    script: 'jd_daily_scratch_bean.js',
  },
  {
    label: '新品红包',
    pageId: '3ejBfFZtaQMQ4RYpBxHekmm9vyrs',
    script: 'jd_xinpin_hongbao_bean.js',
  },
  {
    label: '京东试用',
    pageId: 'G7sQ92vWSBsTHzk4e953qUGWQJ4',
    script: 'jd_trial_browse_bean.js',
  },
];

const FALLBACK_REWARD_ENTRIES = [
  {
    name: '赚红包1.8',
    title: '赚红包',
    url: 'https://pro.m.jd.com/mall/active/B2Y13x641hwWfpsoRenCzfbz4jR/index.html?babelChannel=ttt156',
  },
  {
    name: '京豆1215',
    title: '天天刮豆',
    url: 'https://pro.m.jd.com/mall/active/4E1fFrgX1eGtWTc5KBNFzXMrh6xn/index.html?babelChannel=ttt64',
  },
  {
    name: '逛新品赢红包',
    title: '新品红包',
    url: 'https://pro.m.jd.com/mall/active/3ejBfFZtaQMQ4RYpBxHekmm9vyrs/index.html?mTabId=3ejBfFZtaQMQ4RYpBxHekmm9vyrs&hybrid_err_view=1&jwebprog=0&showTask=1&babelChannel=ttt203',
  },
  {
    name: '试用领取1.8',
    title: '京东试用',
    url: 'https://pro.m.jd.com/mall/active/G7sQ92vWSBsTHzk4e953qUGWQJ4/index.html?babelChannel=ttt321&aTrial=fee__503565572&sendChannel=99&has_native=0&father=tj&mTabId=2LcucMHYX7aXz92Qh7JBHBo6DACH&linkTabId=ddf8145746688c1c184e84718d8a65de&useFoldTab=1',
  },
  {
    name: '权益中心卡片',
    title: '最高88京豆',
    url: 'https://pro.m.jd.com/mall/active/34bpxyqcsNkowPnSfyhS1c11qwga/index.html?has_native=0&tab=recommendTab&equity=TTLD&rights_source=syxlel&finger=1&babelChannel=ttt58',
  },
];

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function readPositiveInt(value, fallback) {
  const parsedValue = Number.parseInt(value || '', 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function isDebugEnabled() {
  return process.env.JD_GUOJIA_BUTIE_DEBUG === '1';
}

function shouldRunMappedScripts() {
  return process.env.JD_GUOJIA_BUTIE_RUN_MAPPED !== '0';
}

function shouldUseChrome() {
  return process.env.JD_GUOJIA_BUTIE_USE_CHROME !== '0';
}

function stringifyForLog(value, maxLength = 1600) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 6000) : maxLength);
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

function createRuntime(cookie, index) {
  return {
    index,
    cookie,
    userName: getUserName(cookie),
    userAgent: process.env.JD_GUOJIA_BUTIE_USER_AGENT || DEFAULT_USER_AGENT,
  };
}

function parseResponseBody(body) {
  const text = String(body || '').trim();
  if (!text) {
    return {};
  }
  const parsed = safeJsonParse(text, null);
  if (parsed) {
    return parsed;
  }
  try {
    return safeJsonParse(Buffer.from(text, 'base64').toString('utf8'), text);
  } catch (error) {
    return text;
  }
}

function normalizeOpenUrl(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (!text.startsWith('openapp.jdmobile://')) {
    return text;
  }

  try {
    const parsedUrl = new URL(text);
    const paramsText = parsedUrl.searchParams.get('params');
    const params = safeJsonParse(paramsText, {});
    return params?.url || '';
  } catch (error) {
    return '';
  }
}

function getEntryTitle(item, fallback) {
  return item?.title || item?.mainTitle || item?.buttonText || item?.name || fallback || '';
}

function extractRewardEntries(secondFloorResponse) {
  const results = secondFloorResponse?.data?.remindFloor?.result || [];
  const entries = [];

  for (const item of results) {
    collectEntry(entries, {
      name: item?.name,
      title: getEntryTitle(item),
      url: normalizeOpenUrl(item?.openAppUrl || item?.openAppUrlBg || item?.jump),
      srvJson: item?.srvJson,
    });

    for (const rightInfo of item?.rightInfos || []) {
      collectEntry(entries, {
        name: item?.name,
        title: getEntryTitle(rightInfo, item?.name),
        url: normalizeOpenUrl(rightInfo?.openAppUrl || rightInfo?.openAppUrlBg),
        srvJson: item?.srvJson,
      });
    }
  }

  return dedupeEntries(entries);
}

function collectEntry(entries, entry) {
  const content = JSON.stringify(entry || {});
  if (!entry?.url || !/京豆|红包|超市卡|领取|补贴|试用|抽奖|权益|bean|reward|award|coupon/i.test(content)) {
    return;
  }
  entries.push(entry);
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.title}|${entry.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function matchKnownScript(entry) {
  return KNOWN_ENTRY_SCRIPTS.find((item) => entry.url.includes(item.pageId));
}

function summarizeEntry(entry) {
  const script = matchKnownScript(entry);
  return `${entry.title || entry.name} => ${entry.url}${script ? ` | 已映射 ${script.script}` : ' | 需 Chrome 调试'}`;
}

function runMappedScripts(entries) {
  if (!shouldRunMappedScripts()) {
    $.log('已跳过已知入口脚本分流：JD_GUOJIA_BUTIE_RUN_MAPPED=0');
    return;
  }

  const scripts = new Map();
  for (const entry of entries) {
    const matched = matchKnownScript(entry);
    if (matched) {
      scripts.set(matched.script, matched.label);
    }
  }

  for (const [script, label] of scripts.entries()) {
    const scriptPath = path.join(__dirname, script);
    if (!fs.existsSync(scriptPath)) {
      $.log(`分流脚本不存在，跳过 ${label} => ${script}`);
      continue;
    }

    $.log(`\n==== 分流执行 ${label}: ${script} ====`);
    const result = childProcess.spawnSync(process.execPath, [scriptPath], {
      cwd: __dirname,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) {
      $.log(`分流脚本启动失败 ${script} => ${result.error.message}`);
    } else if (result.status !== 0) {
      $.log(`分流脚本退出码 ${script} => ${result.status}`);
    }
  }
}

function getChromeBin() {
  const configured = String(process.env.JD_GUOJIA_BUTIE_CHROME_BIN || '').trim();
  const candidates = configured ? [configured, ...DEFAULT_CHROME_CANDIDATES] : DEFAULT_CHROME_CANDIDATES;
  return candidates.find((item) => item && fs.existsSync(item)) || '';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, CHROME_DEBUG_HOST, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
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

function parseCookies(cookieText) {
  return String(cookieText || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex <= 0) {
        return null;
      }
      return {
        name: item.slice(0, separatorIndex),
        value: item.slice(separatorIndex + 1),
      };
    })
    .filter((item) => item?.name && item.value);
}

function isImportantChromeRequest(url) {
  return [
    'api.m.jd.com',
    'pro.m.jd.com/mall/active',
    'storage.360buyimg.com/webcontainer',
    'storage.360buyimg.com/jsresource',
    'storage11.360buyimg.com',
  ].some((keyword) => String(url || '').includes(keyword));
}

function shouldLogChromeResponseBody(url) {
  const text = String(url || '');
  if (text.includes('api.m.jd.com')) {
    return true;
  }
  if (isDebugEnabled()) {
    return true;
  }
  return text.includes(PAGE_BASE_URL);
}

function decodeBody(body, base64Encoded) {
  if (!body) {
    return '';
  }
  if (!base64Encoded) {
    return body;
  }

  const buffer = Buffer.from(body, 'base64');
  const text = buffer.toString('utf8');
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 80))) {
    return `[base64 ${buffer.length} bytes] ${body.slice(0, 300)}`;
  }
  return text;
}

function getApiFunctionId(url, postData = '') {
  try {
    const parsedUrl = new URL(String(url || ''));
    const functionId = parsedUrl.searchParams.get('functionId');
    if (functionId) {
      return functionId;
    }
  } catch (error) {
    // ignore
  }

  try {
    return new URLSearchParams(String(postData || '')).get('functionId') || '';
  } catch (error) {
    return '';
  }
}

class ChromeCdpPage {
  constructor(wsUrl, logger) {
    this.wsUrl = wsUrl;
    this.logger = logger;
    this.nextId = 1;
    this.pending = new Map();
    this.requestMap = new Map();
    this.apiResponses = [];
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
      functionId: getApiFunctionId(request.url, request.postData || ''),
    });
    this.logger(`request => ${request.method} ${redactTextForLog(request.url)}`);
    if (request.postData) {
      this.logger(`request body => ${stringifyForLog(redactTextForLog(request.postData), 1200)}`);
    }
  }

  handleResponse(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }
    meta.status = params.response?.status;
    this.logger(`response header => ${meta.status} ${redactTextForLog(meta.url)}`);
  }

  handleLoadingFinished(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }

    if (!shouldLogChromeResponseBody(meta.url)) {
      this.requestMap.delete(params.requestId);
      return;
    }

    this.send('Network.getResponseBody', { requestId: params.requestId }, 5000)
      .then((result) => {
        const body = decodeBody(result.body || '', result.base64Encoded);
        if (meta.functionId) {
          this.apiResponses.push({
            functionId: meta.functionId,
            status: meta.status,
            url: meta.url,
            body: parseResponseBody(body),
            rawBody: body,
          });
        }
        this.logger(`response body => ${meta.status || ''} ${redactTextForLog(meta.url)} | ${stringifyForLog(redactTextForLog(body), 1600)}`);
      })
      .catch((error) => {
        this.logger(`response body unavailable => ${redactTextForLog(meta.url)} | ${error.message}`);
      })
      .finally(() => {
        this.requestMap.delete(params.requestId);
      });
  }

  handleLoadingFailed(params) {
    const meta = this.requestMap.get(params.requestId);
    if (meta) {
      this.logger(`request failed => ${redactTextForLog(meta.url)} | ${params.errorText || ''}`);
      this.requestMap.delete(params.requestId);
    }
  }

  getApiResponses(functionId) {
    if (!functionId) {
      return [...this.apiResponses];
    }
    return this.apiResponses.filter((response) => response.functionId === functionId);
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
        reject(new Error(`CDP 调用超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
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

async function launchChrome(logger) {
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_GUOJIA_BUTIE_CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-guojia-butie-chrome-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--window-size=390,844',
    'about:blank',
  ];
  const child = childProcess.spawn(chromeBin, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    if (isDebugEnabled()) {
      logger(`chrome stderr => ${String(chunk).trim()}`);
    }
  });

  const pages = await waitForChromeJson(port, '/json');
  const pageTarget = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || pages[0];
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('未获取到 Chrome 页面调试地址');
  }

  const page = new ChromeCdpPage(pageTarget.webSocketDebuggerUrl, logger);
  await page.connect();
  return {
    child,
    page,
    port,
    userDataDir,
    chromeBin,
  };
}

async function closeChrome(runtime) {
  try {
    await runtime?.page?.close();
  } catch (error) {
    // ignore
  }
  if (runtime?.child && !runtime.child.killed) {
    runtime.child.kill('SIGTERM');
  }
  if (runtime?.userDataDir) {
    fs.rmSync(runtime.userDataDir, { recursive: true, force: true });
  }
}

async function prepareChromePage(chromeRuntime, runtime) {
  const { page } = chromeRuntime;
  await page.send('Network.enable');
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await page.send('Network.setUserAgentOverride', {
    userAgent: runtime.userAgent,
    platform: 'iPhone',
  });

  const cookiesToInject = parseCookies(runtime.cookie);
  const targetUrls = [
    'https://pro.m.jd.com/',
    'https://api.m.jd.com/',
    'https://plogin.m.jd.com/',
    'https://m.jd.com/',
  ];

  for (const cookie of cookiesToInject) {
    await page.send('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      domain: '.jd.com',
      path: '/',
      secure: true,
      httpOnly: false,
    });
    for (const url of targetUrls) {
      await page.send('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        url,
        path: '/',
        secure: true,
        httpOnly: false,
      });
    }
  }

  const browserCookies = await page.send('Network.getAllCookies');
  const browserCookieNames = (browserCookies.cookies || [])
    .filter((item) => String(item.domain || '').includes('jd.com'))
    .map((item) => item.name);
  return {
    injectedNames: cookiesToInject.map((item) => item.name),
    browserCookieNames: Array.from(new Set(browserCookieNames)),
  };
}

async function evaluatePage(page, expression, timeoutMs = CHROME_COMMAND_TIMEOUT_MS) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Chrome Runtime.evaluate 执行异常');
  }
  return result.result?.value;
}

async function clickRewardButtons(page, logger) {
  const expression = `(() => {
    const keywords = ['签到', '领取', '领京豆', '领红包', '立即领取', '去完成', '去浏览', '浏览', '抽奖', '开红包'];
    const nodes = Array.from(document.querySelectorAll('button, a, div, span'));
    const target = nodes.find((node) => {
      const text = (node.innerText || node.textContent || '').replace(/\\s+/g, '');
      if (!text || text.length > 30) return false;
      return keywords.some((keyword) => text.includes(keyword));
    });
    if (!target) {
      return { clicked: false, text: '', href: location.href };
    }
    target.click();
    return {
      clicked: true,
      text: (target.innerText || target.textContent || '').trim(),
      href: location.href,
    };
  })()`;

  for (let round = 1; round <= CHROME_CLICK_ROUNDS; round += 1) {
    const result = await evaluatePage(page, expression);
    logger(`Chrome 点击轮次 ${round} => ${stringifyForLog(result, 500)}`);
    if (!result?.clicked) {
      break;
    }
    await sleep(5000);
  }
}

async function collectDomRewardEntries(page) {
  const domEntries = await evaluatePage(page, `(() => {
    const attributes = ['href', 'data-url', 'data-href', 'data-link', 'data-jump', 'data-openapp', 'data-open-app-url'];
    const nodes = Array.from(document.querySelectorAll('a, button, div, span'));
    return nodes.map((node) => {
      const title = (node.innerText || node.textContent || node.getAttribute('aria-label') || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 80);
      const urls = attributes
        .map((name) => node.getAttribute(name))
        .filter(Boolean);
      for (const value of Object.values(node.dataset || {})) {
        if (value) {
          urls.push(value);
        }
      }
      return urls.map((url) => ({ title, url }));
    }).flat();
  })()`);
  const entries = [];
  for (const entry of domEntries || []) {
    collectEntry(entries, {
      title: entry.title,
      url: normalizeOpenUrl(entry.url),
    });
  }
  return dedupeEntries(entries);
}

function extractEntriesFromChromeApi(page) {
  const secondFloorResponses = page.getApiResponses('secondFloor');
  const latestResponse = secondFloorResponses[secondFloorResponses.length - 1];
  if (!latestResponse) {
    return [];
  }
  return extractRewardEntries(latestResponse.body);
}

async function waitForChromeEntries(page, logger) {
  const startedAt = Date.now();
  let apiEntries = [];
  let domEntries = [];

  while (Date.now() - startedAt < 10000) {
    apiEntries = extractEntriesFromChromeApi(page);
    if (apiEntries.length) {
      break;
    }
    await sleep(500);
  }

  try {
    domEntries = await collectDomRewardEntries(page);
  } catch (error) {
    logger(`DOM 入口提取失败 => ${error.message || error}`);
  }

  return dedupeEntries([...apiEntries, ...domEntries]);
}

async function exploreEntryInChrome(chromeRuntime, runtime, entry) {
  const logger = (message) => $.log(`账号${runtime.index} ${runtime.userName}: ${entry.title || entry.name}: ${message}`);
  logger(`导航 => ${entry.url}`);
  await chromeRuntime.page.send('Page.navigate', { url: entry.url }, CHROME_NAVIGATE_TIMEOUT_MS);
  await sleep(CHROME_LOAD_WAIT_MS);
  await clickRewardButtons(chromeRuntime.page, logger);
  const state = await evaluatePage(chromeRuntime.page, `(() => ({
    href: location.href,
    readyState: document.readyState,
    text: document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 1200) : ''
  }))()`);
  logger(`页面状态 => ${stringifyForLog(state, 1600)}`);
}

async function collectEntriesWithChrome(runtime) {
  const logger = (message) => $.log(`账号${runtime.index} ${runtime.userName}: ${message}`);
  const chromeRuntime = await launchChrome(logger);
  try {
    logger(`Chrome => ${chromeRuntime.chromeBin}`);
    logger(`CDP 端口 => ${chromeRuntime.port}`);
    const cookieState = await prepareChromePage(chromeRuntime, runtime);
    logger(`Cookie 已注入 => ${cookieState.injectedNames.join(', ')}`);
    logger(`浏览器 Cookie => ${cookieState.browserCookieNames.join(', ')}`);
    logger(`导航国家补贴页 => ${PAGE_REFERER}`);
    await chromeRuntime.page.send('Page.navigate', { url: PAGE_REFERER }, CHROME_NAVIGATE_TIMEOUT_MS);
    await sleep(CHROME_LOAD_WAIT_MS);

    let entries = await waitForChromeEntries(chromeRuntime.page, logger);
    if (!entries.length) {
      logger('Chrome 未提取到奖励入口，使用 HAR 静态入口兜底');
      entries = FALLBACK_REWARD_ENTRIES;
    }

    logger(`奖励入口 =>\n${entries.map(summarizeEntry).join('\n')}`);
    for (const entry of entries) {
      if (matchKnownScript(entry)) {
        continue;
      }
      try {
        await exploreEntryInChrome(chromeRuntime, runtime, entry);
      } catch (error) {
        logger(`Chrome 调试失败 ${entry.title || entry.name} => ${error.stack || error.message}`);
      }
    }

    return entries;
  } finally {
    await closeChrome(chromeRuntime);
  }
}

async function handleAccount(cookie, index) {
  const runtime = createRuntime(cookie, index);
  $.log(`\n==== 账号${index} ${runtime.userName} ====`);

  if (!shouldUseChrome()) {
    $.log(`账号${index} ${runtime.userName}: 已跳过 Chrome，使用 HAR 静态入口兜底`);
    return FALLBACK_REWARD_ENTRIES;
  }

  return collectEntriesWithChrome(runtime);
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  const allEntries = [];
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      const entries = await handleAccount(cookies[index], index + 1);
      allEntries.push(...entries);
    } catch (error) {
      $.log(`账号${index + 1}: 执行异常 => ${error.stack || error.message}`);
    }
  }

  runMappedScripts(dedupeEntries(allEntries));
}

main()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message}`);
  })
  .finally(() => {
    $.done();
  });
