/*
cron:26 0 * * * jd_medicine_task_bean.js

环境变量说明：
1. JD_MEDICINE_EID / JD_MEDICINE_EID_TOKEN
   含义：买药每日任务接口使用的 eid 与 x-api-eid-token。
   是否必须：否，默认使用当前抓包中已验证值；活动风控变更后可用最新抓包覆盖。

2. JD_MEDICINE_DO_ALL_TASKS
   含义：是否额外尝试非京豆、加购等任务。
   是否必须：否，默认只跑签到、首页点击和京豆浏览任务；配置为 1 时扩大尝试范围。

3. JD_MEDICINE_TASK_WAIT_MS / JD_MEDICINE_MAX_TASKS
   含义：浏览任务等待时长兜底值、单账号最多执行任务数。
   是否必须：否，默认按任务文案中的浏览秒数等待，最多执行 12 个任务。

4. JD_MEDICINE_DEBUG
   含义：是否打印更长接口原始返回片段。
   是否必须：否，配置为 1 时开启。

5. JD_MEDICINE_CHROME_DEBUG_PORT / JD_MEDICINE_CHROME_BIN
   含义：脚本固定走 Chrome/CDP 浏览器态；JD_MEDICINE_CHROME_DEBUG_PORT 可连接已有 9222；
        未配置端口时自动启动可用 Chrome。
   是否必须：否。
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getGiasRiskContext,
  getUserName,
  hasJingBeanReward,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon.js');

const $ = new Env('买药签到做任务领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const API_ENDPOINT = 'https://api.m.jd.com/api';
const APPID = 'jdh-middle';
const H5ST_APP_ID = '4b818';
const DEFAULT_GIAS_BIZ_ID = 'JDR_shields';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/2k1pupFzSALNodSGK3hZ4Bu5D5sx/index.html';
const PAGE_REFERER = `${PAGE_URL}?sourceType=JDAPP_Kingkong_KBGY`;
const DEFAULT_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const DEFAULT_EID = 'HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM57R7YQAYAAAAACG66HQIZDCY7HAX';
const DEFAULT_ACTIVITY_COOKIE = [
  '__jd_ref_cls=Babel_H5FirstClick',
  'shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  'shshshfpb=BApXWc4mL__hAHG66jpkKj0ZbcwofbpzLBgPXF0wo9xJ1ONBSe4PYlUOz1Xq4nSx7E9Y25vKCisdhJOsy7qQH49ga27Px',
  `3AB9D23F7A4B3C9B=${DEFAULT_EID}`,
  `3AB9D23F7A4B3CSS=${DEFAULT_EID_TOKEN}`,
  '_gia_d=1',
  '__jda=122270672.1777997475028347787637.1777997475.1778050811.1778054962.7',
  '__jdb=122270672.24.1777997475028347787637|7.1778054962',
  '__jdc=122270672',
  '__jdu=1777997475028347787637',
  'mba_muid=17779071289331759247216.7650.1778057944663',
  'mba_sid=7650.5',
  'pre_seq=3',
  `pre_session=${DEFAULT_UUID}|20555`,
  'b_dh=844',
  'b_dw=390',
  'b_dpr=3',
  'b_webp=1',
  'b_avif=1',
  'wxa_level=1',
  'webp=1',
  'qid_evord=1613',
  'qid_ls=1778050908160',
  'qid_ts=1778055797179',
  'qid_vis=6',
  'qid_fs=1777998244219',
  'qid_uid=600e8dca-282d-45a3-ae63-5a148fc08173',
  'x-rp-evtoken=mGW9U4qbzsaBdCMe70m9pP1k255ziE_jiSkj4jZm99U1BN8agvIUfm1rvcuQeRIFrkwN67y366HHU6qDDRotdg%3D%3D',
  'jcap_dvzw_fp=CKctVFkfav2PbBUsUSBCg4n8oPGDAlIutEMyTngbZZrWGAooZURFJ_qxxPG1-K7iB2AGWQ1FeHDGNrjENmfqQdCIE9M=',
  'deviceId=224e6c34e7638196d45b7006b8f1713f8d4ec463',
  'deviceType=iPhone14,5',
  'deviceid_pdj_jd=224e6c34e7638196d45b7006b8f1713f8d4ec463',
].join('; ');
const JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/main/js_security_v3_main.js?v=20260506';
const USER_AGENT = process.env.JD_MEDICINE_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778057436%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const DEFAULT_MAX_TASKS = 12;
const MIN_BROWSE_WAIT_MS = 5000;
const CHROME_PAGE_WARMUP_MS = 5000;
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_EVALUATE_TIMEOUT_MS = 30000;
const CHROME_NAVIGATE_TIMEOUT_MS = 30000;
const DEFAULT_CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  process.env.JD_MEDICINE_CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MEDICINE_DEBUG === '1';
}

function isDoAllTasksEnabled() {
  return process.env.JD_MEDICINE_DO_ALL_TASKS === '1';
}

function getMaxTasks() {
  const value = Number(process.env.JD_MEDICINE_MAX_TASKS || DEFAULT_MAX_TASKS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_TASKS;
}

function readPositiveInt(value, fallbackValue) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallbackValue;
}

function getChromeBin() {
  const configured = String(process.env.JD_MEDICINE_CHROME_BIN || process.env.CHROME_BIN || '').trim();
  const candidates = configured ? [configured, ...DEFAULT_CHROME_CANDIDATES] : DEFAULT_CHROME_CANDIDATES;
  return candidates.find((item) => item && fs.existsSync(item)) || '';
}

function getChromeDebugPort() {
  const configuredPort = String(process.env.JD_MEDICINE_CHROME_DEBUG_PORT || process.env.CHROME_DEBUG_PORT || '').trim();
  return configuredPort ? readPositiveInt(configuredPort, 0) : 0;
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

function getEid(cookie) {
  const cookieMap = parseCookieString(cookie);
  return process.env.JD_MEDICINE_EID || cookieMap.get('3AB9D23F7A4B3C9B') || DEFAULT_EID;
}

function getEidToken(cookie) {
  const cookieMap = parseCookieString(cookie);
  return process.env.JD_MEDICINE_EID_TOKEN || cookieMap.get('3AB9D23F7A4B3CSS') || DEFAULT_EID_TOKEN;
}

function buildBaseActivityCookie(cookie) {
  const mergedCookie = mergeCookieString(DEFAULT_ACTIVITY_COOKIE, cookie);
  return mergeCookieString(mergedCookie, {
    '3AB9D23F7A4B3C9B': getEid(cookie),
    '3AB9D23F7A4B3CSS': getEidToken(cookie),
    _gia_d: '1',
  });
}

function stripRiskCookie(cookie) {
  const cookieMap = parseCookieString(cookie);
  for (const key of ['3AB9D23F7A4B3C9B', '3AB9D23F7A4B3CSS', 'equipmentId', '_gia_d']) {
    cookieMap.delete(key);
  }
  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function getActivityCookie(cookie, username) {
  const cleanCookie = stripRiskCookie(mergeCookieString(DEFAULT_ACTIVITY_COOKIE, cookie));
  const giasBizId = String(process.env.JD_MEDICINE_GIAS_BIZ_ID || DEFAULT_GIAS_BIZ_ID).trim();
  try {
    const risk = await getGiasRiskContext(cleanCookie, {
      pageUrl: PAGE_REFERER,
      userAgent: USER_AGENT,
      bizId: giasBizId,
    });
    if (!risk?.jsToken) {
      throw new Error(`GIAS 未生成 jsToken: ${stringifyForLog(risk, 500)}`);
    }
    const activityCookie = risk.cookie ? mergeCookieString(cleanCookie, risk.cookie) : cleanCookie;
    $.log(`账号 ${username}: 风控上下文 => eid=${risk.equipmentId ? `${risk.equipmentId.slice(0, 8)}...` : '空'}, jsToken=${risk.jsToken ? `${risk.jsToken.slice(0, 12)}...` : '空'}`);
    return activityCookie;
  } catch (error) {
    $.log(`账号 ${username}: GIAS 风控预热失败，使用默认 eid/jsToken 继续 => ${error.message || error}`);
    return buildBaseActivityCookie(cookie);
  }
}

function getBodyUuid(cookie) {
  if (process.env.JD_MEDICINE_UUID) {
    return process.env.JD_MEDICINE_UUID;
  }

  const cookieMap = parseCookieString(cookie);
  const preSession = cookieMap.get('pre_session');
  if (preSession) {
    return decodeURIComponent(preSession).split('|')[0] || preSession;
  }

  for (const key of ['mba_muid', '__jdu']) {
    const value = cookieMap.get(key);
    if (value) {
      return value;
    }
  }

  const jda = cookieMap.get('__jda');
  if (jda) {
    const parts = jda.split('.');
    if (parts[1]) {
      return parts[1];
    }
  }

  return DEFAULT_UUID;
}

function buildDeviceBody(cookie) {
  return {
    platform: 1,
    osVersion: process.env.JD_MEDICINE_OS_VERSION || '26.2',
    screen: process.env.JD_MEDICINE_SCREEN || '390*844',
    eid: getEid(cookie),
    client: 'iOS',
    clientVersion: process.env.JD_MEDICINE_CLIENT_VERSION || '15.7.20',
    model: process.env.JD_MEDICINE_MODEL || 'iPhone14,5',
    brand: process.env.JD_MEDICINE_BRAND || 'iPhone',
    uuid: getBodyUuid(cookie),
    networkType: process.env.JD_MEDICINE_NETWORK_TYPE || 'wifi',
  };
}

function maskSensitiveText(text) {
  return String(text || '')
    .replace(/pt_key=[^;"\s]+/g, 'pt_key=***')
    .replace(/pt_pin=[^;"\s]+/g, 'pt_pin=***')
    .replace(/3AB9D23F7A4B3CSS=([^;"\s]+)/g, '3AB9D23F7A4B3CSS=***')
    .replace(/("x-api-eid-token"\s*:\s*")([^"]+)(")/g, '$1***$3')
    .replace(/("h5st"\s*:\s*")([^"]+)(")/g, '$1***$3')
    .replace(/x-api-eid-token=([^&\s]+)/g, 'x-api-eid-token=***')
    .replace(/h5st=([^&\s]+)/g, 'h5st=***');
}

function stringifyForLog(value, maxLength = 1200) {
  return maskSensitiveText(stringifySnippet(value, maxLength));
}

async function waitForChromeJson(port, pathname, timeoutMs = CHROME_START_TIMEOUT_MS) {
  const startedAt = Date.now();
  const url = `http://${CHROME_DEBUG_HOST}:${port}${pathname}`;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
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
    if (!waiters) {
      return;
    }
    this.eventWaiters.delete(message.method);
    waiters.forEach(({ resolve, timer }) => {
      clearTimeout(timer);
      resolve(message.params || {});
    });
  }

  send(method, params = {}, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools 未连接'));
    }

    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome DevTools 调用超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  waitForEvent(method, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, waiters.filter((item) => item.resolve !== resolve));
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

async function connectChromePage(pageInfo) {
  if (!pageInfo?.webSocketDebuggerUrl) {
    throw new Error('Chrome 未返回可调试页面');
  }

  const page = new ChromeCdpPage(pageInfo.webSocketDebuggerUrl);
  await page.connect();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setUserAgentOverride', {
    userAgent: USER_AGENT,
    platform: 'iPhone',
    acceptLanguage: 'zh-CN,zh;q=0.9',
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
  return page;
}

async function launchChrome() {
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_MEDICINE_CHROME_BIN 或 CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-medicine-chrome-'));
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
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--disable-features=Translate,AutomationControlled',
    '--window-size=390,844',
    'about:blank',
  ], {
    stdio: 'ignore',
  });

  try {
    await waitForChromeJson(port, '/json/version');
    const pages = await waitForChromeJson(port, '/json/list');
    const pageInfo = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || pages[0];
    const page = await connectChromePage(pageInfo);
    return { attached: false, chrome, page, userDataDir };
  } catch (error) {
    chrome.kill('SIGTERM');
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function attachChrome(port) {
  await waitForChromeJson(port, '/json/version', 3000);
  const pages = await waitForChromeJson(port, '/json/list', 3000);
  const activePage = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && /pro\.m\.jd\.com|m\.jd\.com/.test(item.url || ''));
  const pageInfo = activePage || pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || pages[0];
  const page = await connectChromePage(pageInfo);
  return { attached: true, page };
}

async function getChromeRuntime() {
  const configuredPort = getChromeDebugPort();
  if (configuredPort) {
    return attachChrome(configuredPort);
  }
  return launchChrome();
}

async function closeChromeRuntime(runtime) {
  if (!runtime) {
    return;
  }

  await runtime.page?.close?.();
  if (!runtime.attached && runtime.chrome) {
    runtime.chrome.kill('SIGTERM');
    await sleep(500);
  }
  if (!runtime.attached && runtime.userDataDir) {
    try {
      fs.rmSync(runtime.userDataDir, { recursive: true, force: true });
    } catch (error) {
      await sleep(1000);
      fs.rmSync(runtime.userDataDir, { recursive: true, force: true });
    }
  }
}

async function setChromeCookies(runtime, cookie) {
  const cookieMap = parseCookieString(cookie);
  cookieMap.set('3AB9D23F7A4B3C9B', getEid(cookie));
  cookieMap.set('3AB9D23F7A4B3CSS', getEidToken(cookie));
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const cookiesToSet = [];

  for (const [name, value] of cookieMap.entries()) {
    if (!name || !value) {
      continue;
    }
    cookiesToSet.push({
      name,
      value,
      domain: '.jd.com',
      path: '/',
      secure: true,
      expires,
    });
  }

  await runtime.page.send('Network.setCookies', { cookies: cookiesToSet });
}

async function navigateChrome(runtime, url) {
  const loaded = runtime.page.waitForEvent('Page.loadEventFired').catch(() => null);
  await runtime.page.send('Page.navigate', { url }, CHROME_NAVIGATE_TIMEOUT_MS);
  await loaded;
}

function getChromeRuntimeScript() {
  return `
    (async () => {
      const API_ENDPOINT = ${JSON.stringify(API_ENDPOINT)};
      const APPID = ${JSON.stringify(APPID)};
      const H5ST_APP_ID = ${JSON.stringify(H5ST_APP_ID)};
      const PAGE_URL = ${JSON.stringify(PAGE_URL)};
      const JS_SECURITY_SCRIPT_URL = ${JSON.stringify(JS_SECURITY_SCRIPT_URL)};
      let signRuntimeReady = false;

      function loadScript(src) {
        return new Promise((resolve, reject) => {
          const existed = Array.from(document.scripts).find((script) => script.src === src);
          if (existed) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          script.src = src;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('js_security 脚本加载失败'));
          document.head.appendChild(script);
        });
      }

      function getParamsSignCtor() {
        return window.ParamsSign || window.ParamsSignLite || window.ParamsSignMain;
      }

      async function ensureSignRuntime() {
        if (signRuntimeReady && getParamsSignCtor()) {
          return;
        }
        await loadScript(JS_SECURITY_SCRIPT_URL);
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!getParamsSignCtor()) {
          throw new Error('Chrome 页面未暴露 ParamsSign/ParamsSignLite/ParamsSignMain');
        }
        signRuntimeReady = true;
      }

      function appendForm(form, key, value) {
        if (value !== undefined && value !== null && value !== '') {
          form.set(key, String(value));
        }
      }

      function cookieMap() {
        return new Map(document.cookie.split(';').map((item) => {
          const pair = item.trim();
          const index = pair.indexOf('=');
          if (index <= 0) {
            return ['', ''];
          }
          return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
        }).filter(([key]) => key));
      }

      function getJsToken(fallbackToken) {
        return new Promise((resolve) => {
          try {
            if (typeof window.getJsToken !== 'function') {
              resolve(cookieMap().get('3AB9D23F7A4B3CSS') || fallbackToken || '');
              return;
            }
            window.getJsToken((result) => {
              resolve((result && result.jsToken) || cookieMap().get('3AB9D23F7A4B3CSS') || fallbackToken || '');
            }, 15000);
          } catch (error) {
            resolve(cookieMap().get('3AB9D23F7A4B3CSS') || fallbackToken || '');
          }
        });
      }

      async function createH5st(functionId, bodyText) {
        await ensureSignRuntime();
        const ParamsSignCtor = getParamsSignCtor();
        const signer = new ParamsSignCtor({ appId: H5ST_APP_ID });
        const signFields = {
          appid: APPID,
          functionId,
          body: bodyText,
        };
        const signResult = await signer.sign(signFields);
        return signResult && signResult.h5st ? signResult.h5st : '';
      }

      window.__jdMedicineRuntime = {
        async postApi(payload) {
          const functionId = payload.functionId;
          const eidToken = await getJsToken(payload.eidToken || '');
          const latestCookieMap = cookieMap();
          const body = { ...(payload.body || {}) };
          if (body.eid && latestCookieMap.get('3AB9D23F7A4B3C9B')) {
            body.eid = latestCookieMap.get('3AB9D23F7A4B3C9B');
          }
          const bodyText = JSON.stringify(body);
          const h5st = await createH5st(functionId, bodyText);
          const form = new URLSearchParams();
          appendForm(form, 'appid', APPID);
          appendForm(form, 'functionId', functionId);
          appendForm(form, 'body', bodyText);
          appendForm(form, 'h5st', h5st);
          appendForm(form, 'x-api-eid-token', eidToken);

          const response = await fetch(API_ENDPOINT + '?functionId=' + encodeURIComponent(functionId), {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              'x-rp-client': 'h5_1.0.0',
              'x-referer-page': PAGE_URL,
            },
            body: form.toString(),
          });
          const rawText = await response.text();
          let data = rawText;
          try {
            data = JSON.parse(rawText);
          } catch (error) {
            data = { success: false, message: 'JSON 解析失败', rawText };
          }
          return {
            statusCode: response.status,
            ok: response.ok,
            request: {
              functionId,
              h5stLength: String(h5st || '').length,
              h5stSegments: String(h5st || '').split(';').map((item) => item.length),
              signer: {
                hasParamsSign: typeof window.ParamsSign === 'function',
                hasParamsSignLite: typeof window.ParamsSignLite === 'function',
                hasParamsSignMain: typeof window.ParamsSignMain === 'function',
              },
              formKeys: Array.from(form.keys()),
            },
            data,
            body: rawText,
          };
        },
      };

      return {
    href: location.href,
        hasParamsSign: Boolean(getParamsSignCtor()),
        hasParamsSignFull: typeof window.ParamsSign === 'function',
        hasParamsSignLite: typeof window.ParamsSignLite === 'function',
        hasParamsSignMain: typeof window.ParamsSignMain === 'function',
      };
    })()
  `;
}

async function injectChromeRuntime(runtime, errorPrefix) {
  const result = await runtime.page.send('Runtime.evaluate', {
    expression: getChromeRuntimeScript(),
    awaitPromise: true,
    returnByValue: true,
  }, CHROME_EVALUATE_TIMEOUT_MS);
  if (result.exceptionDetails) {
    throw new Error(`${errorPrefix}: ${stringifySnippet(result.exceptionDetails, 800)}`);
  }
  return result.result?.value || {};
}

async function ensureChromeRuntimeInjected(runtime) {
  const result = await runtime.page.send('Runtime.evaluate', {
    expression: `Boolean(window.__jdMedicineRuntime && typeof window.__jdMedicineRuntime.postApi === 'function')`,
    returnByValue: true,
  }, CHROME_EVALUATE_TIMEOUT_MS);
  if (result.exceptionDetails || !result.result?.value) {
    await injectChromeRuntime(runtime, 'Chrome 运行时重注入异常');
  }
}

async function prepareChromeRuntime(runtime, cookie) {
  await setChromeCookies(runtime, cookie);
  await navigateChrome(runtime, PAGE_REFERER);
  const warmupMs = readPositiveInt(process.env.JD_MEDICINE_CHROME_WARMUP_MS || CHROME_PAGE_WARMUP_MS, CHROME_PAGE_WARMUP_MS);
  await sleep(warmupMs);
  const initInfo = await injectChromeRuntime(runtime, 'Chrome 初始化异常');
  const cookieResult = await runtime.page.send('Runtime.evaluate', {
    expression: `(() => {
      const keys = document.cookie.split(';').map((item) => item.trim().split('=')[0]).filter(Boolean);
      return {
        cookieCount: keys.length,
        hasSdtoken: keys.includes('sdtoken'),
        hasRpEvtoken: keys.includes('x-rp-evtoken'),
        hasPreSession: keys.includes('pre_session'),
        hasQidUid: keys.includes('qid_uid'),
      };
    })()`,
    returnByValue: true,
  }, CHROME_EVALUATE_TIMEOUT_MS);
  return {
    ...initInfo,
    warmupMs,
    cookieSnapshot: cookieResult.result?.value || {},
  };
}

async function chromePostMarketApi(runtime, cookie, username, functionId, body = {}) {
  logImportantRequest(username, `chrome:${functionId}`, body);
  await ensureChromeRuntimeInjected(runtime);
  const payload = {
    functionId,
    body,
    eidToken: process.env.JD_MEDICINE_CHROME_EID_TOKEN || '',
  };
  const result = await runtime.page.send('Runtime.evaluate', {
    expression: `window.__jdMedicineRuntime.postApi(${JSON.stringify(payload)})`,
    awaitPromise: true,
    returnByValue: true,
  }, CHROME_EVALUATE_TIMEOUT_MS);
  if (result.exceptionDetails) {
    throw new Error(`Chrome 请求异常: ${stringifySnippet(result.exceptionDetails, 800)}`);
  }
  const response = result.result?.value || { success: false, message: 'Chrome 无返回' };
  logImportantResponse(username, `chrome:${functionId}`, response);
  if (response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
    return {
      ...response.data,
      httpStatus: response.statusCode,
    };
  }
  return {
    ...response,
    httpStatus: response.statusCode,
  };
}

function logImportantRequest(username, functionId, body) {
  $.log(`账号 ${username}: ${functionId} request => ${stringifyForLog({
    endpoint: API_ENDPOINT,
    appid: APPID,
    h5stAppId: H5ST_APP_ID,
    body,
    extraForm: {
      'x-api-eid-token': '***',
    },
  }, isDebugEnabled() ? 4000 : 1200)}`);
}

function logImportantResponse(username, functionId, response) {
  $.log(`账号 ${username}: ${functionId} response => ${stringifyForLog(response, isDebugEnabled() ? 5000 : 1500)}`);
}

function getTaskList(pageResponse) {
  const list = pageResponse?.data?.assignmentList;
  return Array.isArray(list) ? list : [];
}

function formatRewards(task) {
  return (task?.rewardsList || [])
    .map((reward) => `${reward.rewardName || reward.name || reward.rewardType}:${reward.rewardValue || reward.quantity || ''}`)
    .join(',');
}

function summarizeTask(task) {
  return [
    task.encryptAssignmentId || '-',
    `type=${task.assignmentType}`,
    task.assignmentName || '未知任务',
    `cnt=${task.completionCnt || 0}/${task.assignmentTimesLimit || 0}`,
    `done=${Boolean(task.completionFlag)}`,
    `item=${task.itemId || '-'}`,
    `reward=${formatRewards(task) || '-'}`,
    task.assignmentDesc || '-',
    task.url || '-',
  ].join(' | ');
}

function logTaskList(username, taskList) {
  $.log(`账号 ${username}: 任务列表(${taskList.length})`);
  for (const task of taskList) {
    $.log(`账号 ${username}: - ${summarizeTask(task)}`);
  }
}

function isTaskCompleted(task) {
  const completionCnt = Number(task?.completionCnt || 0);
  const assignmentTimesLimit = Number(task?.assignmentTimesLimit || 0);
  return Boolean(task?.completionFlag) || (assignmentTimesLimit > 0 && completionCnt >= assignmentTimesLimit);
}

function shouldRunTask(task) {
  if (!task?.encryptAssignmentId || isTaskCompleted(task)) {
    return false;
  }

  if (isDoAllTasksEnabled()) {
    return true;
  }

  if (Number(task.assignmentType) === 5) {
    return hasJingBeanReward(task);
  }

  if (Number(task.assignmentType) === 0) {
    return hasJingBeanReward(task) && !String(task.url || '').includes('bankcard');
  }

  if (Number(task.assignmentType) === 1) {
    return hasJingBeanReward(task) && Boolean(task.url);
  }

  return false;
}

function extractBrowseWaitMs(task) {
  const desc = String(task?.assignmentDesc || '');
  const matched = desc.match(/浏览\s*(\d+)\s*s/i);
  const descWaitMs = matched ? Number(matched[1]) * 1000 : 0;
  const envWaitMs = Number(process.env.JD_MEDICINE_TASK_WAIT_MS || 0);
  const waitMs = Math.max(descWaitMs, envWaitMs || 0, MIN_BROWSE_WAIT_MS);
  return Number.isFinite(waitMs) ? waitMs : MIN_BROWSE_WAIT_MS;
}

function buildCompleteBody(cookie, task) {
  const assignmentType = Number(task.assignmentType);
  const body = {
    assignmentType,
    encryptAssignmentId: task.encryptAssignmentId,
    actionType: assignmentType === 1 ? 1 : 0,
  };

  if (task.itemId) {
    body.itemId = String(task.itemId);
  }

  if (assignmentType !== 5) {
    Object.assign(body, buildDeviceBody(cookie));
  }

  return body;
}

async function visitTaskUrlChrome(runtime, username, task) {
  if (!task?.url) {
    return;
  }

  $.log(`账号 ${username}: Chrome 浏览任务页 => ${task.assignmentName} | ${task.url}`);
  await navigateChrome(runtime, task.url);
  const waitMs = extractBrowseWaitMs(task);
  $.log(`账号 ${username}: Chrome 等待浏览完成 => ${waitMs}ms`);
  await sleep(waitMs);
  await navigateChrome(runtime, PAGE_REFERER);
}

async function completeTaskChrome(runtime, cookie, username, task) {
  if (Number(task.assignmentType) === 1) {
    await visitTaskUrlChrome(runtime, username, task);
  }

  const body = buildCompleteBody(cookie, task);
  return chromePostMarketApi(runtime, cookie, username, 'market_daily_doCompleteTask', body);
}

function logToast(username, response) {
  const toast = response?.data?.activityToast;
  if (!toast) {
    return;
  }
  $.log(`账号 ${username}: 页面 toast => ${toast.toastMsg || '-'} | type=${toast.assignmentType} | id=${toast.encryptAssignmentId || '-'}`);
}

function logRewards(username, response) {
  const rewards = response?.data?.successRewards;
  if (!Array.isArray(rewards) || !rewards.length) {
    return;
  }

  const text = rewards
    .map((reward) => `${reward.rewardName || reward.rewardType}x${reward.quantity || reward.rewardValue || 1}`)
    .join(',');
  $.log(`账号 ${username}: 奖励 => ${text}`);
}

async function handleAccount(cookie, index) {
  const username = getUserName(cookie);
  $.log(`\n==== 账号${index} ${username} ====`);
  let runtime = null;
  try {
    const activityCookie = await getActivityCookie(cookie, username);
    runtime = await getChromeRuntime();
    const initInfo = await prepareChromeRuntime(runtime, activityCookie);
    $.log(`账号 ${username}: Chrome 初始化 => ${stringifyForLog(initInfo)}`);

    let page = await chromePostMarketApi(runtime, activityCookie, username, 'market_daily_pageIndex', {});
    if (page?.code !== '0000') {
      $.log(`账号 ${username}: Chrome 获取任务列表失败 => ${stringifyForLog(page)}`);
      return;
    }

    logToast(username, page);
    let taskList = getTaskList(page);
    logTaskList(username, taskList);

    const balance = await chromePostMarketApi(runtime, activityCookie, username, 'jdh_bm_balanceBeans', {});
    if (balance?.success || balance?.code === 0) {
      $.log(`账号 ${username}: 当前京豆余额 => ${balance.data}`);
    }

    let executedCount = 0;
    const maxTasks = getMaxTasks();
    while (executedCount < maxTasks) {
      const nextTask = taskList.find(shouldRunTask);
      if (!nextTask) {
        $.log(`账号 ${username}: 没有可继续执行的任务`);
        break;
      }

      $.log(`账号 ${username}: Chrome 执行任务 => ${summarizeTask(nextTask)}`);
      const completeResult = await completeTaskChrome(runtime, activityCookie, username, nextTask);
      logRewards(username, completeResult);
      executedCount += 1;

      await sleep(1000);
      page = await chromePostMarketApi(runtime, activityCookie, username, 'market_daily_pageIndex', {});
      logToast(username, page);
      taskList = getTaskList(page);
      logTaskList(username, taskList);

      if (page?.code !== '0000') {
        $.log(`账号 ${username}: Chrome 刷新任务列表失败，停止当前账号 => ${stringifyForLog(page)}`);
        break;
      }
    }

    $.log(`账号 ${username}: Chrome 本轮执行任务数 => ${executedCount}`);
  } finally {
    await closeChromeRuntime(runtime);
  }
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await handleAccount(cookies[index], index + 1);
    } catch (error) {
      const username = getUserName(cookies[index]);
      $.log(`账号 ${username}: 执行异常 => ${error.stack || error.message}`);
    }
  }
}

main()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message}`);
  })
  .finally(async () => {
    if (notify && typeof notify.sendNotify === 'function') {
      try {
        await notify.sendNotify($.name, '执行完成');
      } catch (error) {
        // ignore
      }
    }
    $.done();
  });
