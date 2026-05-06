/*
cron:18 0 * * * jd_circle_sign_bean.js

圈子签到领京豆。

Chrome 页面态流程：
1. 启动 Chrome/Chromium。
2. 注入 JD_COOKIE 并打开对应圈子页面。
3. 在页面上下文中复用真实 js_security/风控环境请求圈子首页。
4. 提取签到任务后调用 getTaskRewardPanel 领取奖励。

环境变量：
1. JD_CIRCLE_SIGN_DEBUG
   可选，配置为 1 时打印更长响应。

2. JD_CIRCLE_SIGN_TARGET_IDS
   可选，仅执行指定圈子，多个 circleId 用英文逗号分隔。

3. JD_CIRCLE_SIGN_DEVICE_ID / JD_CIRCLE_SIGN_UUID
   可选，覆盖查询 body.deviceId / 表单 uuid。

4. JD_CIRCLE_SIGN_CHROME_BIN 或 CHROME_BIN
   可选，指定 Chrome/Chromium 可执行文件。
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
  getUserName,
  mergeCookieString,
  parseCookieString,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('圈子签到领京豆');

const QUERY_ENDPOINT = 'https://api.m.jd.com/subject_app_bff_queryCircleHomeInfo';
const REWARD_ENDPOINT = 'https://api.m.jd.com/getTaskRewardPanel';
const PAGE_ORIGIN = 'https://comment.m.jd.com';
const PAGE_REFERER = 'https://comment.m.jd.com/';
const REFERER_PAGE = 'https://comment.m.jd.com/circle/home';

const APPID = 'circle-topic-m';
const CLIENT = 'apple';
const CLIENT_VERSION = '15.7.20';
const LOGIN_TYPE = '2';
const OS_VERSION = '26.2';
const D_MODEL = '';
const NETWORK = '';
const QUERY_H5ST_APP_ID = 'ad41d';
const REWARD_H5ST_APP_ID = 'bb1d9';
const H5ST_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.6.js?v=2024-06-20-17';

const DEFAULT_DEVICE_ID = '78a8d81f-18f9-4b1d-8961-7a5fd2f1582e';
const DEFAULT_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const DEFAULT_LONGITUDE = '113.03702';
const DEFAULT_LATITUDE = '28.210319';
const DEFAULT_REALTIME_AREA = '18-1482-3606-60000';
const DEFAULT_TIME_AREA = '18-1482-3606-60000';
const DEFAULT_TIME_LATITUDE = '28.210293';
const DEFAULT_TIME_LONGITUDE = '113.036892';

const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 20000;
const CHROME_NAVIGATE_TIMEOUT_MS = 30000;
const CHROME_EVALUATE_TIMEOUT_MS = 45000;
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
];

const USER_AGENT = 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777996678%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const DEFAULT_ACTIVITY_COOKIE = [
  'shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  'shshshfpx=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  '3AB9D23F7A4B3C9B=HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA',
  '3AB9D23F7A4B3CSS=jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM55ZQOBNAAAAAADH2ZVQEH4N3OP4X',
  '_gia_d=1',
  `deviceId=${DEFAULT_UUID}`,
  `deviceid_pdj_jd=${DEFAULT_UUID}`,
  'UUID=76C0B11A-9A15-423F-AD24-788ADF0C9AA6',
  'deviceType=iPhone14,5',
  'visitkey=9064630564580568512',
  'cid=8',
  'jxsid=17768740161496914023',
  'pwdt_id=lifeng9891',
  'sid=',
  'webp=1',
  'b_avif=1',
  'b_dpr=3',
  'b_dw=390',
  'b_webp=1',
].join('; ');

const DEFAULT_CIRCLE_CONFIGS = [
  { circleId: '14743564', title: '数码先锋', source: '29', refContentId: '1129731392', refContentType: '7', pageUrl: 'https://comment.m.jd.com/circle/home?id=14743564&source=29&contentId=1129731392&contentType=7&_ts=1772993181462&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177299318297121754_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '13063336', title: '图书圈', source: '8', pageUrl: 'https://comment.m.jd.com/circle/home?id=13063336&source=8&_ts=1775668931259&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177566893308794426_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '14743654', title: '师傅圈', source: '8', pageUrl: 'https://comment.m.jd.com/circle/home?id=14743654&source=8&_ts=1777652164270&utm_user=plusmember&gx=RnAowmFdYTPYypEQrOsqEfFwPg&gxd=RnAoyjIIazeNmZsRrIUlWi3eM4XmTBg&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid9ea33db3431b75d8177765216550394212_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '14653589', title: '赛博机友圈', source: '21', refContentId: '1158118052', refContentType: '1', pageUrl: 'https://comment.m.jd.com/circle/home?contentId=1158118052&contentType=1&id=14653589&source=21&_ts=1776841636535&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177684163737756657_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '13816580', title: 'AI影视创作圈', source: '39', pageUrl: 'https://comment.m.jd.com/circle/home?source=39&id=13816580&_ts=1770953392109&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177095339337415101_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '13453379', title: '晒单圈', source: '8', pageUrl: 'https://comment.m.jd.com/circle/home?id=13453379&source=8&_ts=1770953178030&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177095317913686618_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '14833541', title: '减重圈', source: '', pageUrl: 'https://comment.m.jd.com/circle/home?id=14833541&_ts=1775791868179&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177579186993246410_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '13513335', title: '潮玩圈', source: '29', refContentId: '914182984', refContentType: '7', pageUrl: 'https://comment.m.jd.com/circle/home?id=13513335&source=29&contentId=914182984&contentType=7&_ts=1776254239540&utm_user=plusmember&gx=RnAowmFdYTPYypEQrOsqEfFwPg&gxd=RnAoyjIIazeNmZsRrIUlWi3eM4XmTBg&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid9ea33db3431b75d8177625424101762705_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '13815500', title: '健康圈', source: '8', pageUrl: 'https://comment.m.jd.com/circle/home?id=13815500&source=8&_ts=1777378541109&utm_user=plusmember&gx=RnAoFfXPvbVih8lR5Q&gxd=RnAoxjZdbWfRzZhHp4d1X84gEyvbFWE&ad_od=share&utm_source=androidapp&utm_medium=appshare&utm_campaign=t_335139774&utm_term=CopyURL_shareid5a45c860b8322323177737854244742568_quanzi_%E5%9C%88%E5%AD%90%E4%B8%BB%E9%A1%B5%E5%8F%B3%E4%B8%8A%E8%A7%92%E5%88%86%E4%BA%AB&sid=&un_area=18_1482_3606_60000' },
  { circleId: '14593576', title: 'O粉圈', source: '29', pageUrl: 'https://comment.m.jd.com/circle/home?id=14593576&source=29&embededBizEnv=shop&pageScrollTarget=html&shopId=1000004065&channelSource=appShop&terminal=flex&venderId=1000004065' },
];
const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_CIRCLE_SIGN_DEBUG === '1';
}

function getLogPrefix() {
  return `账号${$.index} ${$.UserName}`;
}

function getCirclePrefix(config) {
  return `${getLogPrefix()} [${config.title}/${config.circleId}]`;
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function getDeviceId() {
  return process.env.JD_CIRCLE_SIGN_DEVICE_ID || DEFAULT_DEVICE_ID;
}

function getRequestUuid() {
  return process.env.JD_CIRCLE_SIGN_UUID || DEFAULT_UUID;
}

function getTargetCircleIds() {
  const raw = String(process.env.JD_CIRCLE_SIGN_TARGET_IDS || '').trim();
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function getCircleConfigs() {
  const targetIds = getTargetCircleIds();
  if (!targetIds.size) {
    return DEFAULT_CIRCLE_CONFIGS;
  }
  return DEFAULT_CIRCLE_CONFIGS.filter((item) => targetIds.has(item.circleId));
}

function buildCirclePageUrl(config) {
  if (config.pageUrl) {
    return config.pageUrl;
  }
  const url = new URL(`${PAGE_ORIGIN}/circle/home`);
  url.searchParams.set('id', config.circleId);
  if (config.source) {
    url.searchParams.set('source', config.source);
  }
  if (config.refContentId) {
    url.searchParams.set('contentId', config.refContentId);
  }
  if (config.refContentType) {
    url.searchParams.set('contentType', config.refContentType);
  }
  return url.toString();
}

function buildActivityCookie(cookie) {
  const userName = getUserName(cookie);
  return mergeCookieString(DEFAULT_ACTIVITY_COOKIE, {
    ...Object.fromEntries(parseCookieString(cookie).entries()),
    pwdt_id: userName,
    sid: '',
  });
}

function buildQueryBody(config) {
  return {
    deviceId: getDeviceId(),
    needCircleInfo: 1,
    needCircleBit: 1,
    needCircleTab: 1,
    needCircleContent: 1,
    circleId: config.circleId,
    page: 1,
    pageSize: 10,
    longitude: DEFAULT_LONGITUDE,
    latitude: DEFAULT_LATITUDE,
    realtimeArea: DEFAULT_REALTIME_AREA,
    timeArea: DEFAULT_TIME_AREA,
    timeLat: DEFAULT_TIME_LATITUDE,
    timeLng: DEFAULT_TIME_LONGITUDE,
    refCircleIds: [config.circleId],
    tabType: 0,
    refContentId: config.refContentId || '',
    refContentType: config.refContentType || '',
    source: config.source || '',
    encAssignId: '',
    shareOrderToken: '',
    refMsg: 2,
  };
}

function decodeCircleResponse(rawValue) {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue;
  }
  const text = String(rawValue || '').trim();
  if (!text) {
    return { success: false, message: '空响应' };
  }
  const directJson = safeJsonParse(text, null);
  if (directJson) {
    return directJson;
  }
  try {
    return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
  } catch (error) {
    return {
      success: false,
      message: `响应解码失败: ${error.message}`,
      raw: text,
    };
  }
}

function logRequest(prefix, label, payload) {
  $.log(`${prefix}: [REQ] ${label} => ${stringifySnippet(payload, 2500)}`);
}

function logResponse(prefix, label, meta) {
  $.log(`${prefix}: [RESP] ${label} => ${stringifySnippet({
    statusCode: meta.statusCode,
    headers: {
      'x-rp-sdtoken': meta.headers?.['x-rp-sdtoken'],
      'x-api-request-id': meta.headers?.['x-api-request-id'],
    },
    data: meta.data,
  }, isDebugEnabled() ? 5000 : 3000)}`);
  if (isDebugEnabled()) {
    $.log(`${prefix}: [RAW] ${label} => ${stringifySnippet(meta.body || '', 3000)}`);
  }
}

function getChromeBin() {
  const configured = String(process.env.JD_CIRCLE_SIGN_CHROME_BIN || process.env.CHROME_BIN || '').trim();
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
        reject(new Error(message.error.message || 'CDP 调用失败'));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    if (message.method && this.eventWaiters.has(message.method)) {
      const waiters = this.eventWaiters.get(message.method) || [];
      this.eventWaiters.delete(message.method);
      waiters.forEach(({ resolve }) => resolve(message.params || {}));
    }
  }

  send(method, params = {}, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = this.nextId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, waiters.filter((item) => item.resolve !== resolve));
        reject(new Error(`等待事件超时: ${method}`));
      }, timeoutMs);
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push({
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload);
        },
      });
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
    throw new Error('未找到 Chrome/Chromium，请配置 JD_CIRCLE_SIGN_CHROME_BIN 或 CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-circle-sign-chrome-'));
  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
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

    return { chrome, page, userDataDir };
  } catch (error) {
    chrome.kill('SIGTERM');
    fs.rmSync(userDataDir, { recursive: true, force: true });
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
      fs.rmSync(runtime.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) {
      // Chrome 退出后临时目录可能仍有句柄，清理失败不影响任务结果。
    }
  }
}

async function setChromeCookies(page, cookie) {
  const entries = Array.from(parseCookieString(cookie).entries());
  for (const [name, value] of entries) {
    await page.send('Network.setCookie', {
      name,
      value,
      domain: '.jd.com',
      path: '/',
      url: PAGE_REFERER,
    }, CHROME_START_TIMEOUT_MS).catch(() => null);
  }
}

async function evaluateChrome(page, expression, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result?.exceptionDetails) {
    throw new Error(`Chrome 执行异常: ${stringifySnippet(result.exceptionDetails, 1000)}`);
  }
  return result?.result?.value;
}

async function navigateChromePage(page, url, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
  const loadEvent = page.waitForEvent('Page.loadEventFired', timeoutMs).catch(() => null);
  let navigateResult = null;
  try {
    navigateResult = await page.send('Page.navigate', { url }, 10000);
  } catch (error) {
    await page.send('Runtime.evaluate', {
      expression: `window.location.href = ${JSON.stringify(url)}; true;`,
      awaitPromise: false,
      returnByValue: true,
    }, 10000).catch(() => null);
  }
  await loadEvent;
  if (navigateResult?.errorText) {
    throw new Error(`Chrome 打开失败: ${navigateResult.errorText}`);
  }
  const currentUrl = await evaluateChrome(page, 'location.href', 10000).catch(() => '');
  if (!String(currentUrl || '').startsWith(PAGE_ORIGIN)) {
    throw new Error(`Chrome 打开后地址异常: ${currentUrl || '-'}`);
  }
}

function buildChromeRuntimeBootstrapScript() {
  return `(${async function bootstrapCircleRuntime(input) {
    if (window.__jdCircleRuntime) {
      return { ok: true, reused: true, href: location.href };
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const safeJson = (text) => {
      try {
        return JSON.parse(text);
      } catch (error) {
        return text ? { raw: text } : {};
      }
    };
    const waitFor = async (checker, timeoutMs, label) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (checker()) {
          return;
        }
        await sleep(200);
      }
      throw new Error('等待超时: ' + label);
    };
    const loadScript = (url, timeoutMs) => new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="' + url + '"]');
      if (existing && existing.dataset.loaded === '1') {
        resolve();
        return;
      }
      const script = existing || document.createElement('script');
      const timer = setTimeout(() => reject(new Error('加载脚本超时: ' + url)), timeoutMs);
      script.onload = () => {
        clearTimeout(timer);
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('加载脚本失败: ' + url));
      };
      if (!existing) {
        script.src = url;
        document.head.appendChild(script);
      }
    });
    const normalizeFormValue = (value) => {
      if (value === undefined || value === null) {
        return '';
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    };
    const ensureSignRuntime = async () => {
      try {
        await waitFor(() => typeof window.ParamsSignLite === 'function' || typeof window.ParamsSign === 'function', 15000, 'ParamsSign');
      } catch (error) {
        await loadScript(input.jsSecurityScriptUrl, 15000);
        await waitFor(() => typeof window.ParamsSignLite === 'function' || typeof window.ParamsSign === 'function', 15000, 'ParamsSign');
      }
    };
    const decodeResponse = (rawText) => {
      const parsed = safeJson(rawText);
      if (parsed && !parsed.raw) {
        return parsed;
      }
      try {
        return JSON.parse(atob(rawText));
      } catch (error) {
        return parsed;
      }
    };
    const postApi = async (payload) => {
      await ensureSignRuntime();
      const formFields = {
        appid: input.appid,
        ...(payload.functionId === input.queryFunctionId ? { enableCookies: 'true' } : {}),
        functionId: payload.functionId,
        loginType: input.loginType,
        body: JSON.stringify(payload.body || {}),
        client: input.client,
        clientVersion: input.clientVersion,
        ...(payload.extraForm || {}),
      };
      const SignCtor = window.ParamsSignLite || window.ParamsSign;
      const signer = new SignCtor({
        appId: payload.h5stAppId,
        preRequest: true,
      });
      const signResult = await signer.sign({ ...formFields });
      formFields.h5st = signResult && signResult.h5st ? signResult.h5st : '';
      const form = Object.entries(formFields)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(normalizeFormValue(value)))
        .join('&');
      const response = await fetch(payload.endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
          'x-rp-client': 'h5_1.0.0',
          'x-referer-page': input.refererPage,
        },
        body: form,
      });
      const rawText = await response.text();
      const sdTokenHeader = response.headers.get('x-rp-sdtoken') || '';
      const sdToken = sdTokenHeader.split(';')[2] ? sdTokenHeader.split(';')[2].trim() : '';
      if (sdToken) {
        document.cookie = 'sdtoken=' + sdToken + '; domain=.jd.com; path=/';
      }
      return {
        status: response.status,
        request: {
          endpoint: payload.endpoint,
          functionId: payload.functionId,
          h5stAppId: payload.h5stAppId,
          h5stLength: String(formFields.h5st || '').length,
          body: payload.body || {},
          extraForm: payload.extraForm || {},
        },
        response: {
          headers: {
            'x-rp-sdtoken': sdTokenHeader,
          },
          raw: rawText,
          parsed: decodeResponse(rawText),
        },
      };
    };

    window.__jdCircleRuntime = { postApi };
    return { ok: true, href: location.href };
  }})(${JSON.stringify({
    appid: APPID,
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    loginType: LOGIN_TYPE,
    queryFunctionId: 'subject_app_bff_queryCircleHomeInfo',
    jsSecurityScriptUrl: H5ST_SCRIPT_URL,
    refererPage: REFERER_PAGE,
  })})`;
}

async function ensureChromeRuntime(page) {
  return evaluateChrome(page, buildChromeRuntimeBootstrapScript());
}

async function chromePostApi(runtime, functionId, endpoint, body, h5stAppId, extraForm = {}) {
  return evaluateChrome(runtime.page, `(async () => window.__jdCircleRuntime.postApi(${JSON.stringify({
    functionId,
    endpoint,
    body,
    h5stAppId,
    extraForm,
  })}))()`);
}

async function getChromeCookieSnapshot(page) {
  return String(await evaluateChrome(page, 'document.cookie')).trim();
}

async function queryCircleHomeInfoChrome(runtime, config, prefix) {
  const body = buildQueryBody(config);
  const extraForm = {
    area: DEFAULT_REALTIME_AREA,
    osVersion: OS_VERSION,
    dModel: D_MODEL,
    uuid: getRequestUuid(),
    network: NETWORK,
  };
  logRequest(prefix, 'chrome.queryCircleHomeInfo', {
    endpoint: QUERY_ENDPOINT,
    functionId: 'subject_app_bff_queryCircleHomeInfo',
    h5stAppId: QUERY_H5ST_APP_ID,
    body,
    extraForm,
  });
  const result = await chromePostApi(
    runtime,
    'subject_app_bff_queryCircleHomeInfo',
    QUERY_ENDPOINT,
    body,
    QUERY_H5ST_APP_ID,
    extraForm,
  );
  const parsed = decodeCircleResponse(result?.response?.parsed || result?.response?.raw || '');
  logResponse(prefix, 'chrome.queryCircleHomeInfo', {
    statusCode: result?.status,
    headers: result?.response?.headers || {},
    body: result?.response?.raw || '',
    data: parsed,
  });
  return parsed;
}

async function getTaskRewardPanelChrome(runtime, config, signTask, prefix) {
  const body = {
    bizId: config.circleId,
    taskId: signTask.taskId,
    ticket: '-99',
  };
  const extraForm = {
    osVersion: OS_VERSION,
    dModel: D_MODEL,
    uuid: getRequestUuid(),
    network: NETWORK,
  };
  logRequest(prefix, 'chrome.getTaskRewardPanel', {
    endpoint: REWARD_ENDPOINT,
    functionId: 'subject_app_bff_getTaskRewardPanel',
    h5stAppId: REWARD_H5ST_APP_ID,
    body,
    extraForm,
  });
  const result = await chromePostApi(
    runtime,
    'subject_app_bff_getTaskRewardPanel',
    REWARD_ENDPOINT,
    body,
    REWARD_H5ST_APP_ID,
    extraForm,
  );
  const parsed = decodeCircleResponse(result?.response?.parsed || result?.response?.raw || '');
  logResponse(prefix, 'chrome.getTaskRewardPanel', {
    statusCode: result?.status,
    headers: result?.response?.headers || {},
    body: result?.response?.raw || '',
    data: parsed,
  });
  return parsed;
}

function findCheckInTask(homeData) {
  const resourceList = homeData?.data?.topResourceList || [];
  for (const resource of resourceList) {
    const bitName = String(resource?.bitName || '');
    const checkInInfo = resource?.content?.checkInInfo;
    if (checkInInfo?.taskId && (bitName.includes('签到') || String(checkInInfo.checkName || '').includes('签到'))) {
      return {
        taskId: String(checkInInfo.taskId),
        assignId: String(checkInInfo.assignId || '').trim(),
        projectId: String(checkInInfo.projectId || '').trim(),
        checkName: String(checkInInfo.checkName || bitName || '圈子签到'),
        continueSignDay: checkInInfo.continueSignDay,
        sourceType: 'checkInInfo',
      };
    }

    const shopTaskList = Array.isArray(resource?.shopTaskList) ? resource.shopTaskList : [];
    for (const item of shopTaskList) {
      const jobTabInfo = item?.jobTabInfo;
      const taskName = String(jobTabInfo?.taskName || jobTabInfo?.taskShowName || bitName || '');
      if (jobTabInfo?.taskId && Number(jobTabInfo.taskType) === 5 && taskName.includes('签到')) {
        return {
          taskId: String(jobTabInfo.taskId),
          assignId: String(jobTabInfo.assignId || '').trim(),
          projectId: String(jobTabInfo.encProjectId || '').trim(),
          checkName: taskName || '圈子签到',
          continueSignDay: '',
          sourceType: 'jobTabInfo',
        };
      }
    }
  }
  return null;
}

function summarizeReward(result) {
  const data = result?.data || {};
  const parts = [
    data.businessMessage || result?.message,
    data.title,
    data.hintText,
  ].filter(Boolean);
  return parts.join(' | ') || stringifySnippet(result, 800);
}

function isRewardSuccess(result) {
  const data = result?.data || {};
  return String(result?.code) === '0' &&
    result?.success &&
    String(data.businessCode || '') === '0' &&
    data.winAward;
}

function isRewardAlreadyDone(result) {
  const data = result?.data || {};
  return String(data.businessCode || '') === '4001' || String(data.awardStatus || '') === '4';
}

async function runCircle(runtime, config) {
  const prefix = getCirclePrefix(config);
  $.log(`${prefix}: 开始执行圈子签到（Chrome）`);
  await navigateChromePage(runtime.page, buildCirclePageUrl(config));
  await sleep(8000);
  await ensureChromeRuntime(runtime.page);

  const browserCookie = await getChromeCookieSnapshot(runtime.page);
  $.log(`${prefix}: Chrome 页面 Cookie => ${stringifySnippet(browserCookie, 1200)}`);

  const queryData = await queryCircleHomeInfoChrome(runtime, config, prefix);
  if (String(queryData?.code) !== '0' || !queryData?.success) {
    $.log(`${prefix}: Chrome 查询圈子失败 => ${stringifySnippet(queryData, 1200)}`);
    return `${config.title}: 查询失败`;
  }

  const signTask = findCheckInTask(queryData);
  if (!signTask) {
    $.log(`${prefix}: Chrome 未找到签到任务`);
    return `${config.title}: 未找到签到任务`;
  }

  $.log(`${prefix}: Chrome 签到任务 => taskId=${signTask.taskId} assignId=${signTask.assignId || '-'} projectId=${signTask.projectId || '-'} name=${signTask.checkName} continue=${signTask.continueSignDay || '-'} source=${signTask.sourceType}`);
  $.log(`${prefix}: 不依据“已签到X天”文案跳过，直接调用领奖接口，以接口结果为准`);

  const rewardData = await getTaskRewardPanelChrome(runtime, config, signTask, prefix);
  if (isRewardSuccess(rewardData)) {
    const message = `${config.title}: 签到成功 | ${summarizeReward(rewardData)}`;
    $.log(`${prefix}: Chrome 签到领取结果 => ${summarizeReward(rewardData)}`);
    return message;
  }
  if (isRewardAlreadyDone(rewardData)) {
    const message = `${config.title}: 今日已签或奖励已领 | ${summarizeReward(rewardData)}`;
    $.log(`${prefix}: Chrome 签到已处理/重复 => ${summarizeReward(rewardData)}`);
    return message;
  }

  $.log(`${prefix}: Chrome 签到领取失败 => ${stringifySnippet(rewardData, 1200)}`);
  return `${config.title}: 领取失败 | ${summarizeReward(rewardData)}`;
}

async function runForAccount(cookie) {
  $.UserName = decodeURIComponent(getUserName(cookie));
  const prefix = getLogPrefix();
  const circleConfigs = getCircleConfigs();
  $.log(`\n==== ${prefix} ====`);
  $.log(`${prefix}: 本次计划执行 ${circleConfigs.length} 个圈子`);

  let runtime = null;
  try {
    const activityCookie = buildActivityCookie(cookie);
    runtime = await launchChrome();
    await setChromeCookies(runtime.page, activityCookie);

    const messages = [];
    for (const config of circleConfigs) {
      try {
        const result = await runCircle(runtime, config);
        messages.push(result);
      } catch (error) {
        const message = `${config.title}: 执行异常 | ${error.message || error}`;
        $.log(`${getCirclePrefix(config)}: ${message}`);
        messages.push(message);
      }
      await sleep(1500);
    }

    $.log(`${prefix}: 汇总 =>\n${messages.join('\n')}`);
  } finally {
    await closeChrome(runtime);
  }
}

(async () => {
  if (!cookies.length) {
    $.log('未配置 JD_COOKIE');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    $.index = index + 1;
    try {
      await runForAccount(cookies[index]);
    } catch (error) {
      $.log(`${getLogPrefix()}: 执行异常 => ${error.stack || error.message || error}`);
    }
    if (index < cookies.length - 1) {
      await sleep(1000);
    }
  }
})()
  .catch((error) => $.log(`执行异常 => ${error.stack || error.message || error}`))
  .finally(() => {
    $.done();
    process.exit(0);
  });
