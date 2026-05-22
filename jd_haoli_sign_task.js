/*
cron:12 0 * * * jd_haoli_sign_task.js

京东好礼签到、做任务、抽奖、国家补贴浏览。

基于 files/traffic_jd_京东好礼签到+做任务+抽奖+国家补贴浏览_filtered.har 分析得到的主流程：
1. interact_pre_executor(sign_floor) 查询连签任务。
2. interact_executor 执行签到领取京豆。
3. inviteFissionBeforeHome / inviteFissionHome 进入主活动页。
4. apTaskList / apTaskDetail / apStartTaskTime / apDoLimitTimeTask 执行浏览任务，换抽奖次数。
5. giftBombCheck / giftBombDrawPrize 领取“国家补贴”气泡奖励，并浏览跳转页。
6. inviteFissionPoll 查询剩余抽奖次数。
7. inviteFissionDrawPrize 执行正式抽奖。

环境变量：
1. JD_HAOLI_EID_TOKEN
   可选，覆盖 x-api-eid-token。

2. JD_HAOLI_SDK_TOKEN
   可选，覆盖 wg-sdk-token。

3. JD_HAOLI_UUID
   可选，覆盖 uuid/openudid/deviceId。

4. JD_HAOLI_AREA
   可选，覆盖活动 area。默认 18_1482_3606_60000。

5. JD_HAOLI_MAX_TASKS
   可选，最多尝试多少个浏览任务。默认不限制。

6. JD_HAOLI_MAX_DRAWS
   可选，最多执行多少次正式抽奖。默认按接口返回次数执行。

7. JD_HAOLI_BROWSE_WAIT_MS
   可选，浏览任务最少等待毫秒数。默认 10000。

8. JD_HAOLI_DRAW_INTERVAL_MS
   可选，每次抽奖间隔毫秒数。默认 3000。

9. JD_HAOLI_SKIP_TASKS
   可选，配置为 1 时跳过浏览任务，仅验证签到和抽奖链路。

10. JD_HAOLI_SKIP_DRAWS
    可选，配置为 1 时不执行正式抽奖。

11. JD_HAOLI_DEBUG
    可选，配置为 1 时打印更多原始响应片段。
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const got = require('got');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getGiasRiskContext,
  getUserName,
  mergeCookieString,
  parseCookieString,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东好礼签到任务抽奖');

const ACTIVITY_API_ENDPOINT = 'https://api.m.jd.com/api';
const INTERACT_API_ENDPOINT = 'https://api.m.jd.com/';

const ACTIVITY_APPID = 'activities_platform';
const INTERACT_APPID = 'Bigsale';
const CLIENT_IOS = 'ios';
const CLIENT_APPLE = 'apple';
const CLIENT_VERSION = '15.7.20';
const PLATFORM = '3';
const LOGIN_TYPE = '2';
const LOGIN_WQ_BIZ = 'wegame';

const MAIN_PAGE_ID = '2RJ7ot8kUkU5iciABi62Ds7TZ1Ks';
const MAIN_PAGE_URL = `https://pro.m.jd.com/mall/active/${MAIN_PAGE_ID}/index.html`;
const MAIN_PAGE_REFERER = `${MAIN_PAGE_URL}?babelChannel=ttt3&tttparams=iQDjjeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEzLjAzNjg4MSIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMTAzMTkiLCJsYnNMbmciOiIxMTMuMDM3MDIiLCJwcnN0YXRlIjoiMCIsImdwc19hcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwic2NhbGUiOiIzIiwiYWRkcmVzc0lkIjoiMTUxNTIyMDA5OCIsInVuX2FyZWEiOiIxOF8xNDgyXzM2MDZfNjAwMDAiLCJ3aWR0aCI6IjExNzAiLCJsYnNBcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwibGF0IjoiMjguMjEwMjk0IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX50%3D&stath=47&navh=44&father=ms`;

const SIGN_PAGE_ID = '3tuyrzceYdNbDk58hVat3fPRosRa';
const SIGN_PAGE_URL = `https://pro.m.jd.com/mall/active/${SIGN_PAGE_ID}/index.html`;
const SIGN_PAGE_REFERER = `${SIGN_PAGE_URL}?father=ms&babelChannel=ttt161&embedMTab=1&navh=44&stath=47`;

const GIFT_BOMB_PAGE_ID = '2tQ7qPWytjgQoMavpQfU9znh5Nqa';
const GIFT_BOMB_PAGE_URL = `https://pro.m.jd.com/mall/active/${GIFT_BOMB_PAGE_ID}/index.html`;
const GIFT_BOMB_PAGE_REFERER = `${GIFT_BOMB_PAGE_URL}?mTabId=DvFPmKRas9GYjDPZjT9NT14BAv6&babelChannel=ttt2&embedMTab=1&stath=47&tttparams=1wIMMVyNweyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEzLjAzNjg4MSIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMTAzMTkiLCJsYnNMbmciOiIxMTMuMDM3MDIiLCJwcnN0YXRlIjoiMCIsImdwc19hcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwic2NhbGUiOiIzIiwiYWRkcmVzc0lkIjoiMTUxNTIyMDA5OCIsInVuX2FyZWEiOiIxOF8xNDgyXzM2MDZfNjAwMDAiLCJ3aWR0aCI6IjExNzAiLCJsYnNBcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwibGF0IjoiMjguMjEwMjk0IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX90%3D&navh=44&linkTabId=181a5d59c518ed4c1f2982f0eb023f22&lbzd=186`;
const CHROME_BOOTSTRAP_URL = 'https://pro.m.jd.com/';

const LINK_ID = 'mDHZBRZse-oiU1PwVx-CqA';
const GIFT_BOMB_LINK_ID = '6L1M_awqJxj-nG3Gruo4HA';
const GIFT_BOMB_BABEL_ID = '01815628';
const GIFT_BOMB_CHANNEL = '186';

const SIGN_H5ST_APP_ID = '7f3ea';
const BEFORE_HOME_H5ST_APP_ID = '02f8d';
const HOME_H5ST_APP_ID = 'eb67b';
const START_TASK_H5ST_APP_ID = 'acb1e';
const LIMIT_TASK_H5ST_APP_ID = 'ebecc';
const GIFT_BOMB_DRAW_H5ST_APP_ID = 'a9449';
const DRAW_H5ST_APP_ID = 'c02c6';
const POLL_H5ST_APP_ID = 'b3f11';

const DEFAULT_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_lite_0.1.5.js';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM56PYPQEAAAAAADBV6T5HQ4H3UDMX';
const DEFAULT_SDK_TOKEN = 'jdd01P3GGKDSF3P247OO6EN36AFRGGX3KBN3FN7NX5DOVW6HCDFDQWJA6VDSGO522SB62D565UKVXTVMBEZZAQGAHRHLKWUQA5H6RQLQHW5Q01234567';
const DEFAULT_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const DEFAULT_AREA = '18_1482_3606_60000';
const DEFAULT_REAL_AREA = '18_1482_3606_60000';
const DEFAULT_LONGITUDE = '113.03702';
const DEFAULT_LATITUDE = '28.210319';
const DEFAULT_BUILD = '170437';
const DEFAULT_SCREEN = '390*844';
const DEFAULT_NETWORK_TYPE = 'wifi';
const DEFAULT_BRAND = 'iPhone';
const DEFAULT_MODEL = 'iPhone14,5';
const DEFAULT_LANG = 'zh_CN';
const DEFAULT_OS_VERSION = '26.2';
const DEFAULT_PARTNER = '-1';
const DEFAULT_BROWSE_WAIT_MS = 10 * 1000;
const DEFAULT_DRAW_INTERVAL_MS = 3000;
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 20000;
const CHROME_NAVIGATE_TIMEOUT_MS = 30000;
const CHROME_EVALUATE_TIMEOUT_MS = 45000;
const DEFAULT_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const ACTIVITY_USER_AGENT = 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777914153%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const DEFAULT_ACTIVITY_COOKIE = [
  'shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  'shshshfpb=BApXWX3aP7_hAHG66jpkKj0ZbcwofbpzLBgPXF0wo9xJ1ONBSe4PYlUOz1Xq4nSx7E9Y25vKCisdhJOsy7qQH49gJ1Mij',
  'sdtoken=AAbEsBpEIOVjqTAKCQtvQu17_7Hr-RznhHw5WA1niR0-gb62KiG3nVONOvIuhd2oskliFFAIU1yxqxe6io1c7SP7wjyhQ4eL8f8O-VYYfjWvdX_oVNmsTyTKDTrxnxUM2nQZcMGRsw',
  '3AB9D23F7A4B3C9B=HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA',
  `3AB9D23F7A4B3CSS=${DEFAULT_EID_TOKEN}`,
  '_gia_d=1',
  '__jda=122270672.17779071289331759247216.1777907128.1777911277.1777911285.25',
  '__jdb=122270672.25.17779071289331759247216|25.1777911285',
  '__jdv=122270672|lianmeng__8__kong__kong|t_1000441370_|jingfen|998c6d442053006c189781bb36772c7a|1777737435000',
  '__jdu=17779071289331759247216',
  '__jdc=122270672',
  'mba_muid=17779071289331759247216.7620.1777914178096',
  'mba_sid=7620.9',
  'unionwsws=%7B%22devicefinger%22%3A%22eidI1b48812339seYMyi%2BxceSWi9B1BquhXOpmDMpHufNfBzKBTXpbftpBC99S3bp%2FiNdUQ1bciMGfQ8NmK0u2XbCkQVMWnsFVrkAH3Pc1awkgIzpohR%22%7D',
  'unpl=JF8EAG9nNSttUENdVxxXHhcTSllWX1wPGRcKZ2EMVA4LSVMDHQFJFEB7XlVdWhRKEx9uZBRXX1NPUg4bBisiEEpcVVtYCEkRAl9XDVwzWAZUaxhsG19dBm1XXm0JeycCX2cDZG1oSmQEKwMrWX5KEGRfbQs%7CJF8EANRnNSttXh5XBB4HT0IZTA5QWwldGx9WamICUQ9RH1FQTwoYERd7XlVdWhRKFB9ubxRXXVNOVQ4eAisiEEpcVF9ZC04fA19jBlBaXXtSax4AEhcZS1xcMF4JSnl-NyBRFhxES1drG2wfERRMWDpuXgh7FjM7NVIGCgxJXARMAxwQRxtaUA5eWBkSCmtmBlBZDEpVUSsDKxsRe11VX1wKSxYHb2IAVW1oSmQEKwMrWX5KEAAMClocQwFnZlJVWlocBAIfUhhCQk5UUF9eDE9DAm4zNVVtWA',
  'pre_seq=3',
  'pre_session=224e6c34e7638196d45b7006b8f1713f8d4ec463|20446',
  'pwdt_id=lifeng9891',
  'x-rp-evtoken=mGW9U4qbzsaBdCMe70m9pCkQCXoOESuHd4Gn4iXzr5M1TcnpFBzJmm12Bfr6UIS3NrQxGalT4yJNDSB-xMRwtQ%3D%3D',
  'jcap_dvzw_fp=S8ZOO2ljg6kjD692Jqmy7RRxDntWOSOI1eJIyp2c64b9CnoWIKivgd5dURXlAft7w6-A-Da1RIhR9kOK0EyWXg==',
  'wxa_level=1',
  'joyya=1777752379.0.46.0w72feu',
  'shshshfpv=JD0211d47djNobDXHGFT177775214871507rx1jpMUiURL2J0j4_lGjGo4s94hQvAS9S3JtZBULMh0arCDUBqLvRsULbP_WTwr5MmeJ1T7lCRYkzkDr6_h6-CL53nT6HYbUbta--MCuFlyuLlUeRh2B34-jT4qLbQE-0r6d3qf~BApXWFZhB6fhD1OB8xqCNNSQdMge9fkCrLs8Pw0xX9xJ1ONBSe4PYlUOz1Xr7I5ZME9Y2tKfQipYzc74z460Isd662SRH',
  'qid_evord=452',
  'qid_ls=1777743454203',
  'qid_ts=1777752283758',
  'qid_vis=4',
  'SameSite=Strict',
  'sid=',
  'cid=8',
  'jxsid=17768740161496914023',
  'UUID=76C0B11A-9A15-423F-AD24-788ADF0C9AA6',
  `deviceId=${DEFAULT_UUID}`,
  `deviceType=${DEFAULT_MODEL}`,
  `deviceid_pdj_jd=${DEFAULT_UUID}`,
  `visitkey=9064630564580568512`,
  'cartNum=8',
  'webp=1',
  'shshshfpx=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  'qid_fs=1777716192171',
  'qid_uid=49995f5f-6369-4074-97c0-deed121d534f',
  'b_avif=1',
  'b_dpr=3',
  'b_dw=390',
  'b_webp=1',
].join('; ');

const cookies = Object.values(jdCookieNode).filter(Boolean);
let chromeJsSecurityScriptSource = '';

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_HAOLI_DEBUG === '1';
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallback;
}

function getBrowseWaitMs(task) {
  const taskLimitMs = Number(task?.timeLimitPeriod || 0) * 1000;
  const configuredMs = readPositiveInt(process.env.JD_HAOLI_BROWSE_WAIT_MS, DEFAULT_BROWSE_WAIT_MS);
  return Math.max(configuredMs, taskLimitMs);
}

function getDrawIntervalMs() {
  return readPositiveInt(process.env.JD_HAOLI_DRAW_INTERVAL_MS, DEFAULT_DRAW_INTERVAL_MS);
}

function getMaxTasks() {
  const configuredValue = String(process.env.JD_HAOLI_MAX_TASKS || '').trim();
  return configuredValue ? readPositiveInt(configuredValue, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
}

function getMaxDraws() {
  const configuredValue = String(process.env.JD_HAOLI_MAX_DRAWS || '').trim();
  return configuredValue ? readPositiveInt(configuredValue, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
}

function shouldSkipTasks() {
  return process.env.JD_HAOLI_SKIP_TASKS === '1';
}

function shouldSkipDraws() {
  return process.env.JD_HAOLI_SKIP_DRAWS === '1';
}

function getTaskArea() {
  return process.env.JD_HAOLI_AREA || DEFAULT_AREA;
}

function getChromeBin() {
  const configured = String(process.env.JD_HAOLI_CHROME_BIN || process.env.CHROME_BIN || '').trim();
  const candidates = configured ? [configured, ...DEFAULT_CHROME_CANDIDATES] : DEFAULT_CHROME_CANDIDATES;
  return candidates.find((item) => item && fs.existsSync(item)) || '';
}

function getChromeDebugPort() {
  const configuredPort = String(process.env.JD_HAOLI_CHROME_DEBUG_PORT || process.env.CHROME_DEBUG_PORT || '').trim();
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

async function getChromeJsSecurityScriptSource() {
  if (chromeJsSecurityScriptSource) {
    return chromeJsSecurityScriptSource;
  }

  const response = await got.get(DEFAULT_JS_SECURITY_SCRIPT_URL, {
    headers: {
      referer: MAIN_PAGE_URL,
      'user-agent': ACTIVITY_USER_AGENT,
    },
    throwHttpErrors: false,
    timeout: { request: 30000 },
  });
  if (response.statusCode >= 400 || !response.body) {
    throw new Error(`js_security 脚本下载失败：HTTP ${response.statusCode}`);
  }
  chromeJsSecurityScriptSource = response.body;
  return chromeJsSecurityScriptSource;
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
  await page.send('Network.setUserAgentOverride', {
    userAgent: ACTIVITY_USER_AGENT,
    platform: 'iPhone',
  });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await page.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    configuration: 'mobile',
  });
  return page;
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

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

async function launchChrome() {
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_HAOLI_CHROME_BIN 或 CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-haoli-chrome-'));
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
    detached: false,
  });

  try {
    await waitForChromeJson(port, '/json/version');
    const pages = await waitForChromeJson(port, '/json/list');
    const pageInfo = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || pages.find((item) => item.webSocketDebuggerUrl);
    const page = await connectChromePage(pageInfo);
    return { attached: false, chrome, page, userDataDir };
  } catch (error) {
    chrome.kill('SIGTERM');
    throw error;
  }
}

async function attachChrome(port) {
  await waitForChromeJson(port, '/json/version', 3000);
  const pages = await waitForChromeJson(port, '/json/list', 3000);
  const activePage = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && /pro\.m\.jd\.com|m\.jd\.com|api\.m\.jd\.com/.test(item.url || ''));
  const pageInfo = activePage || pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || pages.find((item) => item.webSocketDebuggerUrl);
  const page = await connectChromePage(pageInfo);
  return { attached: true, port, page };
}

async function getChromeRuntime() {
  const port = getChromeDebugPort();
  if (port > 0) {
    const runtime = await attachChrome(port);
    $.log(`${getLogPrefix()}: 已复用 Chrome DevTools 端口 ${port}`);
    return runtime;
  }

  const runtime = await launchChrome();
  $.log(`${getLogPrefix()}: 已启动 Chrome/Chromium DevTools 临时端口`);
  return runtime;
}

async function closeChrome(runtime) {
  if (!runtime) {
    return;
  }
  runtime.page?.close();
  if (runtime.attached) {
    return;
  }
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

async function setChromeCookies(page, cookie) {
  const cookieMap = parseCookieString(cookie);
  const cookiesToSet = Array.from(cookieMap.entries()).map(([name, value]) => ({
    name,
    value,
    domain: '.jd.com',
    path: '/',
  }));
  if (cookiesToSet.length) {
    await page.send('Network.setCookies', { cookies: cookiesToSet });
  }
}

function getLogPrefix() {
  return `账号${$.index} ${$.UserName}`;
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function buildActivityCookie(cookie) {
  const cookieMap = parseCookieString(cookie);
  const mergeValues = Object.fromEntries(cookieMap.entries());
  return mergeCookieString(DEFAULT_ACTIVITY_COOKIE, mergeValues);
}

function getDeviceUuid(cookie) {
  const cookieMap = parseCookieString($.activityCookie || cookie);
  return process.env.JD_HAOLI_UUID || cookieMap.get('deviceid_pdj_jd') || cookieMap.get('deviceId') || DEFAULT_UUID;
}

function getEidToken(cookie) {
  const cookieMap = parseCookieString($.activityCookie || cookie);
  return process.env.JD_HAOLI_EID_TOKEN || cookieMap.get('3AB9D23F7A4B3CSS') || DEFAULT_EID_TOKEN;
}

function getEid(cookie) {
  const cookieMap = parseCookieString($.activityCookie || cookie);
  return cookieMap.get('3AB9D23F7A4B3C9B') || DEFAULT_ACTIVITY_COOKIE.match(/3AB9D23F7A4B3C9B=([^;]+)/)?.[1] || '';
}

function getSdkToken() {
  return process.env.JD_HAOLI_SDK_TOKEN || DEFAULT_SDK_TOKEN;
}

function buildExt(pageUrl, extraFields = {}) {
  return JSON.stringify({
    appType: 'jdapp',
    systemType: 'ios',
    bigScreen: false,
    'x-api-eid-token': getEidToken($.activityCookie || ''),
    'wg-sdk-token': getSdkToken(),
    pageUrl,
    ...extraFields,
  });
}

function stringifyCookieEntries(cookieMap) {
  return Array.from(cookieMap.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

function buildRequestCookie(cookie, functionId) {
  const cookieMap = parseCookieString(cookie);
  cookieMap.delete('__jd_ref_cls');
  return stringifyCookieEntries(cookieMap);
}

function mergeSetCookie(cookie, setCookieHeader) {
  const values = Array.isArray(setCookieHeader) ? setCookieHeader : (setCookieHeader ? [setCookieHeader] : []);
  if (!values.length) {
    return cookie;
  }
  const nextCookie = {};
  values.forEach((item) => {
    const pair = String(item).split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) {
      nextCookie[pair.slice(0, index)] = pair.slice(index + 1);
    }
  });
  return mergeCookieString(cookie, nextCookie);
}

function extractSdToken(responseMeta) {
  const rawHeader = responseMeta?.headers?.['x-rp-sdtoken'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!headerValue) {
    return '';
  }
  const parts = String(headerValue).split(';');
  return parts.length >= 3 ? parts[2].trim() : '';
}

async function getActivityCookie(cookie) {
  const mergedCookie = buildActivityCookie(cookie);
  try {
    const risk = await getGiasRiskContext(mergedCookie, {
      pageUrl: MAIN_PAGE_REFERER,
      userAgent: ACTIVITY_USER_AGENT,
      bizId: 'laputa',
    });
    return risk?.cookie ? mergeCookieString(mergedCookie, risk.cookie) : mergedCookie;
  } catch (error) {
    $.log(`${getLogPrefix()}: gias 获取失败，继续使用默认活动态 => ${error.message || error}`);
    return mergedCookie;
  }
}

function logImportantRequest(functionId, payload) {
  $.log(`${getLogPrefix()}: [REQ] ${functionId} => ${stringifySnippet(payload, 2000)}`);
}

function logImportantResponse(functionId, responseMeta) {
  const payload = {
    statusCode: responseMeta?.statusCode,
    headers: {
      'set-cookie': responseMeta?.headers?.['set-cookie'],
      'x-rp-sdtoken': responseMeta?.headers?.['x-rp-sdtoken'],
      'x-api-request-id': responseMeta?.headers?.['x-api-request-id'],
    },
    data: responseMeta?.data,
  };
  $.log(`${getLogPrefix()}: [RESP] ${functionId} => ${stringifySnippet(payload, 2500)}`);
  if (isDebugEnabled()) {
    $.log(`${getLogPrefix()}: [RAW] ${functionId} => ${stringifySnippet(responseMeta?.body || '', 2500)}`);
  }
}

function buildCommonForm(cookie, pageUrl, options = {}) {
  const uuid = getDeviceUuid(cookie);
  const form = {
    t: Date.now(),
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    'x-api-eid-token': getEidToken(cookie),
    uuid,
    build: DEFAULT_BUILD,
    screen: DEFAULT_SCREEN,
    networkType: DEFAULT_NETWORK_TYPE,
    d_brand: DEFAULT_BRAND,
    d_model: DEFAULT_MODEL,
    lang: DEFAULT_LANG,
    osVersion: DEFAULT_OS_VERSION,
    partner: DEFAULT_PARTNER,
    'wg-sdk-token': getSdkToken(),
    ext: buildExt(pageUrl, options.extFields || {}),
    cthr: '1',
    ...(options.extraForm || {}),
  };

  if (options.includeOpenDeviceFields) {
    return {
      ...form,
      imei: '',
      aid: '',
      openudid: uuid,
      adid: '',
    };
  }

  return form;
}

async function callActivityApi(cookie, functionId, body, options = {}) {
  const baseCookie = $.activityCookie || cookie;
  const requestCookie = buildRequestCookie(baseCookie, functionId);
  const pageUrl = options.pageUrl || MAIN_PAGE_URL;
  const referer = options.referer || MAIN_PAGE_REFERER;

  if ($.chromeRuntime && options.h5stMode === 'js_security') {
    return chromePostApi($.chromeRuntime, requestCookie, functionId, body, {
      ...options,
      pageUrl,
      referer,
    });
  }

  const form = buildCommonForm(requestCookie, pageUrl, {
    extFields: options.extFields || {},
    includeOpenDeviceFields: Boolean(options.includeOpenDeviceFields),
    extraForm: {
      ...(options.nullH5st ? { h5st: 'null' } : {}),
      ...(options.extraForm || {}),
    },
  });

  logImportantRequest(functionId, {
    endpoint: ACTIVITY_API_ENDPOINT,
    body,
    referer,
    pageUrl,
    h5stAppId: options.h5stAppId || 'null',
    form,
  });

  const responseMeta = await postFormApi(requestCookie, {
    endpoint: ACTIVITY_API_ENDPOINT,
    functionId,
    appid: options.appid || ACTIVITY_APPID,
    body,
    client: CLIENT_IOS,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    origin: 'https://pro.m.jd.com',
    referer,
    userAgent: ACTIVITY_USER_AGENT,
    extraForm: form,
    extraHeaders: options.extraHeaders || {},
    h5stAppId: options.h5stAppId || '',
    h5stMode: options.h5stMode || 'h5st41',
    h5stPageUrl: pageUrl,
    h5stVersion: '5.3',
    h5stScriptUrl: options.h5stScriptUrl || DEFAULT_JS_SECURITY_SCRIPT_URL,
    includeMeta: true,
  });

  logImportantResponse(functionId, responseMeta);
  let nextCookie = requestCookie;
  const latestSdToken = extractSdToken(responseMeta);
  if (latestSdToken) {
    nextCookie = mergeCookieString(nextCookie, { sdtoken: latestSdToken });
  }
  nextCookie = mergeSetCookie(nextCookie, responseMeta?.headers?.['set-cookie']);
  $.activityCookie = nextCookie;
  return responseMeta.data;
}

async function callInteractApi(cookie, functionId, body, options = {}) {
  const baseCookie = $.activityCookie || cookie;
  const requestCookie = buildRequestCookie(baseCookie, functionId);
  const referer = options.referer || SIGN_PAGE_REFERER;
  const uuid = getDeviceUuid(requestCookie);

  const extraForm = {
    area: getTaskArea(),
    clientVersion: CLIENT_VERSION,
    xAPIClientLanguage: 'zh_CN',
    channelCode: options.channelCode || 'gift',
    sceneCode: options.sceneCode || 'sign_floor',
    screen: '390*676',
    networkType: DEFAULT_NETWORK_TYPE,
    openudid: uuid,
    uuid,
    d_model: DEFAULT_MODEL,
    osVersion: DEFAULT_OS_VERSION,
    eid: getEid(requestCookie),
    'x-api-eid-token': getEidToken(requestCookie),
  };

  logImportantRequest(functionId, {
    endpoint: INTERACT_API_ENDPOINT,
    body,
    referer,
    h5stAppId: SIGN_H5ST_APP_ID,
    form: extraForm,
  });

  const responseMeta = await postFormApi(requestCookie, {
    endpoint: INTERACT_API_ENDPOINT,
    functionId,
    appid: INTERACT_APPID,
    body,
    client: CLIENT_APPLE,
    loginType: LOGIN_TYPE,
    origin: 'https://pro.m.jd.com',
    referer,
    userAgent: ACTIVITY_USER_AGENT,
    extraForm,
    h5stAppId: SIGN_H5ST_APP_ID,
    h5stMode: 'js_security',
    h5stPageUrl: SIGN_PAGE_URL,
    includeMeta: true,
  });

  logImportantResponse(functionId, responseMeta);
  let nextCookie = requestCookie;
  const latestSdToken = extractSdToken(responseMeta);
  if (latestSdToken) {
    nextCookie = mergeCookieString(nextCookie, { sdtoken: latestSdToken });
  }
  nextCookie = mergeSetCookie(nextCookie, responseMeta?.headers?.['set-cookie']);
  $.activityCookie = nextCookie;
  return responseMeta.data;
}

function buildChromeRuntimeBootstrapScript(input) {
  return `(${async function bootstrapChromeRuntime(runtimeInput) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const safeJson = (text) => {
      try {
        return JSON.parse(text);
      } catch (error) {
        return { raw: text };
      }
    };
    const cookieMap = () => new Map(document.cookie.split(';').map((item) => {
      const pair = item.trim();
      const index = pair.indexOf('=');
      return index > 0 ? [pair.slice(0, index), pair.slice(index + 1)] : ['', ''];
    }).filter(([key]) => key));
    const setCookie = (cookie) => {
      String(cookie || '').split(';').forEach((item) => {
        const pair = item.trim();
        if (pair && pair.includes('=')) {
          document.cookie = `${pair}; domain=.jd.com; path=/`;
        }
      });
    };
    const loadScript = (url, timeoutMs) => new Promise((resolve, reject) => {
      if (window.ParamsSignLite || window.ParamsSign) {
        resolve();
        return;
      }
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
      if (window.ParamsSignLite || window.ParamsSign) {
        return;
      }
      if (runtimeInput.jsSecurityScriptSource) {
        window.eval(runtimeInput.jsSecurityScriptSource);
      } else {
        await loadScript(runtimeInput.jsSecurityScriptUrl, runtimeInput.signRuntimeTimeoutMs);
      }
      for (let index = 0; index < 80 && !(window.ParamsSignLite || window.ParamsSign); index += 1) {
        await sleep(200);
      }
      if (!(window.ParamsSignLite || window.ParamsSign)) {
        throw new Error('ParamsSignLite 未加载');
      }
    };
    const getJsToken = () => new Promise((resolve) => {
      const fallbackToken = cookieMap().get('3AB9D23F7A4B3CSS') || runtimeInput.defaultEidToken || '';
      try {
        if (typeof window.getJsToken !== 'function') {
          resolve(fallbackToken);
          return;
        }
        window.getJsToken((result) => resolve(result?.jsToken || fallbackToken), 15000);
      } catch (error) {
        resolve(fallbackToken);
      }
    });
    const buildApiUrl = (payload, timestamp) => {
      const url = new URL(runtimeInput.apiEndpoint);
      url.searchParams.set('functionId', payload.functionId);
      url.searchParams.set('appid', payload.appid || runtimeInput.appid);
      url.searchParams.set('client', payload.client || runtimeInput.client);
      url.searchParams.set('clientVersion', payload.clientVersion || runtimeInput.clientVersion);
      url.searchParams.set('platform', payload.platform || runtimeInput.platform);
      url.searchParams.set('loginType', payload.loginType || runtimeInput.loginType);
      url.searchParams.set('loginWQBiz', payload.loginWQBiz || runtimeInput.loginWQBiz);
      url.searchParams.set('t', String(timestamp));
      url.searchParams.set('uuid', payload.uuid || runtimeInput.uuid);
      url.searchParams.set('d_model', runtimeInput.model);
      url.searchParams.set('d_brand', runtimeInput.brand);
      url.searchParams.set('osVersion', runtimeInput.osVersion);
      return url.toString();
    };
    const normalizeValue = (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value));

    window.__jdHaoliRuntime = {
      setCookie,
      async postApi(payload) {
        if (payload.cookie && payload.syncCookie) {
          setCookie(payload.cookie);
        }
        await ensureSignRuntime();

        const bodyText = JSON.stringify(payload.body || {});
        const timestamp = Date.now();
        let h5st = 'null';
        if (!payload.nullH5st) {
          const ParamsSignCtor = window.ParamsSignLite || window.ParamsSign;
          const signer = new ParamsSignCtor({
            appId: payload.h5stAppId,
            preRequest: Boolean(payload.preRequest),
          });
          const signResult = await signer.sign({
            functionId: payload.functionId,
            appid: payload.appid || runtimeInput.appid,
            client: payload.client || runtimeInput.client,
            t: String(timestamp),
            body: bodyText,
            clientVersion: payload.clientVersion || runtimeInput.clientVersion,
          });
          h5st = signResult?.h5st || '';
        }

        const eidToken = payload.eidToken || await getJsToken();
        const pageUrl = payload.pageUrl || runtimeInput.pageUrl;
        const extValue = {
          appType: 'jdapp',
          systemType: 'ios',
          bigScreen: false,
          'x-api-eid-token': eidToken,
          'wg-sdk-token': payload.sdkToken ?? runtimeInput.defaultSdkToken,
          pageUrl,
          ...(payload.extFields || {}),
        };
        const formFields = {
          body: bodyText,
          h5st,
          'x-api-eid-token': eidToken,
          build: runtimeInput.build,
          screen: runtimeInput.screen,
          networkType: runtimeInput.networkType,
          d_brand: runtimeInput.brand,
          d_model: runtimeInput.model,
          lang: runtimeInput.lang,
          osVersion: runtimeInput.osVersion,
          partner: runtimeInput.partner,
          cthr: '1',
          ext: extValue,
          ...(payload.extraForm || {}),
        };
        const form = Object.entries(formFields)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => `${encodeURIComponent(key)}=${key === 'h5st' ? encodeURI(normalizeValue(value)) : encodeURIComponent(normalizeValue(value))}`)
          .join('&');

        const url = buildApiUrl(payload, timestamp);
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-rp-client': 'h5_1.0.0',
            'x-referer-page': pageUrl,
            ...(payload.extraHeaders || {}),
          },
          body: form,
        });
        const rawText = await response.text();
        const sdTokenHeader = response.headers.get('x-rp-sdtoken') || '';
        const sdToken = sdTokenHeader.split(';')[2] ? sdTokenHeader.split(';')[2].trim() : '';
        if (sdToken) {
          document.cookie = `sdtoken=${sdToken}; domain=.jd.com; path=/`;
        }

        return {
          status: response.status,
          request: {
            functionId: payload.functionId,
            body: payload.body || {},
            url,
            formLength: form.length,
            h5stLength: String(h5st || '').length,
            pageUrl,
            eidTokenPrefix: eidToken ? eidToken.slice(0, 16) : '',
          },
          cookie: document.cookie,
          response: {
            headers: {
              'x-rp-sdtoken': sdTokenHeader,
              'x-api-request-id': response.headers.get('x-api-request-id') || '',
            },
            parsed: safeJson(rawText),
            raw: rawText,
          },
        };
      },
    };

    return { ok: true, href: location.href };
  }})(${JSON.stringify(input)})`;
}

async function evaluateChrome(page, expression, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result?.exceptionDetails) {
    throw new Error(`Chrome 执行异常: ${stringifySnippet(result.exceptionDetails, 1200)}`);
  }
  return result?.result?.value;
}

async function navigateChromePage(page, url, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
  const loadEvent = page.waitForEvent('Page.loadEventFired', timeoutMs).catch(() => null);
  const navigateResult = await page.send('Page.navigate', { url }, timeoutMs);
  await loadEvent;
  if (navigateResult?.errorText && navigateResult.errorText !== 'net::ERR_ABORTED') {
    throw new Error(`Chrome 打开失败: ${navigateResult.errorText}`);
  }
}

async function ensureChromeRuntime(page) {
  const jsSecurityScriptSource = await getChromeJsSecurityScriptSource();
  await evaluateChrome(page, buildChromeRuntimeBootstrapScript({
    apiEndpoint: ACTIVITY_API_ENDPOINT,
    appid: ACTIVITY_APPID,
    client: CLIENT_IOS,
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    pageUrl: MAIN_PAGE_URL,
    uuid: DEFAULT_UUID,
    build: DEFAULT_BUILD,
    screen: DEFAULT_SCREEN,
    networkType: DEFAULT_NETWORK_TYPE,
    brand: DEFAULT_BRAND,
    model: DEFAULT_MODEL,
    lang: DEFAULT_LANG,
    osVersion: DEFAULT_OS_VERSION,
    partner: DEFAULT_PARTNER,
    defaultEidToken: process.env.JD_HAOLI_EID_TOKEN || DEFAULT_EID_TOKEN,
    defaultSdkToken: process.env.JD_HAOLI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    jsSecurityScriptUrl: DEFAULT_JS_SECURITY_SCRIPT_URL,
    jsSecurityScriptSource,
    signRuntimeTimeoutMs: CHROME_EVALUATE_TIMEOUT_MS,
  }));
}

async function prepareChromeActivityPage(runtime, cookie, pageUrl = CHROME_BOOTSTRAP_URL) {
  if (cookie) {
    await setChromeCookies(runtime.page, cookie);
  }
  await navigateChromePage(runtime.page, pageUrl);
  await ensureChromeRuntime(runtime.page);
}

async function chromePostApi(runtime, cookie, functionId, body, options = {}) {
  const payload = {
    cookie,
    syncCookie: Boolean(options.syncCookie),
    functionId,
    body,
    appid: options.appid || ACTIVITY_APPID,
    client: CLIENT_IOS,
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    uuid: getDeviceUuid(cookie),
    h5stAppId: options.h5stAppId || '',
    nullH5st: Boolean(options.nullH5st),
    extFields: options.extFields || {},
    extraForm: options.extraForm || {},
    extraHeaders: options.extraHeaders || {},
    sdkToken: getSdkToken(),
    eidToken: getEidToken(cookie),
    pageUrl: options.pageUrl || MAIN_PAGE_URL,
  };
  const expression = `(async () => window.__jdHaoliRuntime.postApi(${JSON.stringify(payload)}))()`;
  const result = await evaluateChrome(runtime.page, expression);
  $.activityCookie = mergeCookieString(cookie, result?.cookie || '');
  $.log(`${getLogPrefix()}: [REQ] ${functionId} => ${stringifySnippet(result?.request || { functionId, body }, 1500)}`);
  $.log(`${getLogPrefix()}: [RESP] ${functionId} => ${stringifySnippet({ statusCode: result?.status, headers: result?.response?.headers, data: result?.response?.parsed }, 2000)}`);
  if (isDebugEnabled()) {
    $.log(`${getLogPrefix()}: [RAW] ${functionId} => ${stringifySnippet(result?.response?.raw || '', 2000)}`);
  }
  return result?.response?.parsed;
}

function summarizeSignTask(task) {
  if (!task) {
    return '未找到连签任务';
  }
  const signStatus = task?.ext?.sign?.status ?? task?.ext?.sign1?.status ?? '-';
  const continueSignDay = task?.ext?.sign?.continueSignDay ?? task?.ext?.sign1?.continueSignDay ?? 0;
  const signList = task?.ext?.sign?.signList || task?.ext?.sign1?.signList || [];
  return `${task.assignmentName || '连签'} | status=${signStatus} | 已签${continueSignDay}天 | signList=${signList.length}`;
}

function getSignTask(preResult) {
  const tasks = preResult?.data?.result?.taskInfo?.taskList || [];
  return tasks.find((task) => String(task.assignmentName || '').includes('签'));
}

function summarizeRewards(rewardsInfo) {
  const successRewards = rewardsInfo?.successRewards || {};
  const parts = [];
  Object.values(successRewards).forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((reward) => {
      const quantity = reward?.quantity ?? reward?.rewardValue ?? 0;
      const name = reward?.rewardName || reward?.prizeName || reward?.awardName || '奖励';
      parts.push(`${name}${quantity ? ` x${quantity}` : ''}`);
    });
  });
  return parts.join(' | ') || '无奖励明细';
}

async function signIn(cookie) {
  const preResult = await callInteractApi(cookie, 'interact_pre_executor', {}, {
    sceneCode: 'sign_floor',
    channelCode: 'gift',
    referer: SIGN_PAGE_REFERER,
  });
  const signTask = getSignTask(preResult);
  $.log(`${getLogPrefix()}: 签到预查询 => ${summarizeSignTask(signTask)}`);

  if (!signTask) {
    return;
  }
  if (signTask.completionFlag) {
    $.log(`${getLogPrefix()}: 今日连签已完成`);
    return;
  }

  const executeResult = await callInteractApi(cookie, 'interact_executor', {
    assignmentId: signTask.encryptAssignmentId,
    itemId: signTask?.ext?.sign?.itemId || signTask?.ext?.sign1?.itemId || '1',
    actionType: 0,
  }, {
    sceneCode: 'sign',
    channelCode: 'gift',
    referer: SIGN_PAGE_REFERER,
  });

  const assignmentResult = executeResult?.data?.result?.assignmentResult;
  const rewardText = summarizeRewards(assignmentResult?.rewardsInfo);
  $.log(`${getLogPrefix()}: 签到执行 => ${assignmentResult?.msg || '未知'} | ${rewardText}`);
}

async function getStaticResource(cookie, linkId, referer) {
  return callActivityApi(cookie, 'getStaticResource', { linkId }, {
    nullH5st: true,
    pageUrl: referer.split('?')[0],
    referer,
  });
}

async function inviteFissionBeforeHome(cookie) {
  return callActivityApi(cookie, 'inviteFissionBeforeHome', {
    linkId: LINK_ID,
    isJdApp: true,
    inviter: '',
  }, {
    h5stAppId: BEFORE_HOME_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': MAIN_PAGE_URL,
    },
  });
}

async function inviteFissionHome(cookie) {
  return callActivityApi(cookie, 'inviteFissionHome', {
    linkId: LINK_ID,
    inviter: '',
  }, {
    h5stAppId: HOME_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': MAIN_PAGE_URL,
    },
  });
}

async function queryTaskList(cookie) {
  return callActivityApi(cookie, 'apTaskList', {
    linkId: LINK_ID,
    queryType: 0,
    channel: 4,
    area: getTaskArea(),
  }, {
    nullH5st: true,
    includeOpenDeviceFields: true,
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
  });
}

async function queryTaskDetail(cookie, task) {
  return callActivityApi(cookie, 'apTaskDetail', {
    taskType: task.taskType,
    taskId: task.id,
    channel: 4,
    checkVersion: true,
    linkId: LINK_ID,
    pipeExt: task.pipeExt || {},
    cityId: 0,
    provinceId: 0,
    countyId: 0,
  }, {
    nullH5st: true,
    includeOpenDeviceFields: true,
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
  });
}

async function startTaskTime(cookie, task, item) {
  return callActivityApi(cookie, 'apStartTaskTime', {
    linkId: LINK_ID,
    taskId: task.id,
    itemId: item.itemId,
    taskInsert: Boolean(item.taskInsert),
    pipeExt: {
      ...(task.pipeExt || {}),
      ...(item.pipeExt || {}),
      taskType: task.taskType,
    },
    channel: 4,
  }, {
    appid: 'activity_platform_se',
    h5stAppId: START_TASK_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
  });
}

async function doLimitTimeTask(cookie) {
  return callActivityApi(cookie, 'apDoLimitTimeTask', {
    linkId: LINK_ID,
  }, {
    h5stAppId: LIMIT_TASK_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
  });
}

async function giftBombCheck(cookie) {
  return callActivityApi(cookie, 'giftBombCheck', {
    linkId: GIFT_BOMB_LINK_ID,
    area: getTaskArea(),
    babelId: GIFT_BOMB_BABEL_ID,
    channel: GIFT_BOMB_CHANNEL,
  }, {
    nullH5st: true,
    pageUrl: GIFT_BOMB_PAGE_URL,
    referer: GIFT_BOMB_PAGE_REFERER,
    extraForm: {
      scval: '',
    },
    extFields: {
      realArea: DEFAULT_REAL_AREA,
      longitude: DEFAULT_LONGITUDE,
      latitude: DEFAULT_LATITUDE,
    },
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': GIFT_BOMB_PAGE_URL,
    },
  });
}

async function giftBombDrawPrize(cookie) {
  return callActivityApi(cookie, 'giftBombDrawPrize', {
    linkId: GIFT_BOMB_LINK_ID,
    area: getTaskArea(),
    babelId: GIFT_BOMB_BABEL_ID,
    channel: GIFT_BOMB_CHANNEL,
  }, {
    h5stAppId: GIFT_BOMB_DRAW_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: GIFT_BOMB_PAGE_URL,
    referer: GIFT_BOMB_PAGE_REFERER,
    extraForm: {
      scval: '',
    },
    extFields: {
      realArea: DEFAULT_REAL_AREA,
      longitude: DEFAULT_LONGITUDE,
      latitude: DEFAULT_LATITUDE,
    },
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': GIFT_BOMB_PAGE_URL,
    },
  });
}

async function inviteFissionPoll(cookie) {
  return callActivityApi(cookie, 'inviteFissionPoll', {
    linkId: LINK_ID,
    type: 2,
  }, {
    h5stAppId: POLL_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': MAIN_PAGE_URL,
    },
  });
}

async function inviteFissionDrawPrize(cookie) {
  return callActivityApi(cookie, 'inviteFissionDrawPrize', {
    linkId: LINK_ID,
    area: getTaskArea(),
  }, {
    h5stAppId: DRAW_H5ST_APP_ID,
    h5stMode: 'js_security',
    pageUrl: MAIN_PAGE_URL,
    referer: MAIN_PAGE_REFERER,
    extFields: {
      qdPageId: 'MO-J2011-1',
      mdClickId: 'Babel_dev_other_FissionRed_ClickDraw',
    },
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': MAIN_PAGE_URL,
    },
  });
}

function getBrowsableTasks(taskList) {
  return (taskList || []).filter((task) => task.taskType === 'BROWSE_CHANNEL');
}

function extractBrowseTarget(item, startResult) {
  const jumpUrl = startResult?.data?.jumpUrl || '';
  if (jumpUrl.startsWith('openapp.jdmobile://virtual?params=')) {
    const paramsText = jumpUrl.slice('openapp.jdmobile://virtual?params='.length);
    const parsedParams = safeJsonParse(decodeURIComponent(paramsText), null);
    if (parsedParams?.taskUrl) {
      return parsedParams.taskUrl;
    }
    if (parsedParams?.url) {
      return parsedParams.url;
    }
  }
  return item?.itemId || item?.itemUrl || item?.clickUrl || '';
}

function extractUrlFromOpenApp(forwardUrl) {
  if (!forwardUrl || typeof forwardUrl !== 'string') {
    return '';
  }
  if (/^https?:\/\//.test(forwardUrl)) {
    return forwardUrl;
  }
  if (!forwardUrl.startsWith('openapp.jdmobile://virtual?params=')) {
    return '';
  }
  const paramsText = forwardUrl.slice('openapp.jdmobile://virtual?params='.length);
  const parsedParams = safeJsonParse(decodeURIComponent(paramsText), null);
  return parsedParams?.taskUrl || parsedParams?.url || '';
}

async function visitPage(url, referer) {
  if (!url) {
    return null;
  }

  const requestCookie = buildRequestCookie($.activityCookie || '', 'page_visit');
  $.log(`${getLogPrefix()}: [REQ] page_visit => ${stringifySnippet({ url, referer }, 1200)}`);
  const response = await got.get(url, {
    headers: {
      cookie: requestCookie,
      referer,
      origin: 'https://pro.m.jd.com',
      'user-agent': ACTIVITY_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: 30000 },
  });

  $.activityCookie = mergeSetCookie(requestCookie, response.headers['set-cookie']);
  $.log(`${getLogPrefix()}: [RESP] page_visit => ${stringifySnippet({
    statusCode: response.statusCode,
    url,
    finalUrl: response.url,
    body: String(response.body || '').slice(0, 500),
  }, 1500)}`);
  return response;
}

function summarizeTask(task) {
  return `${task.id} ${task.taskShowTitle || task.taskTitle} | ${task.taskType} | ${task.taskDoTimes}/${task.taskLimitTimes} | wait=${task.timeLimitPeriod || 0}s`;
}

async function handleBrowseTask(cookie, task) {
  $.log(`${getLogPrefix()}: 准备浏览任务 => ${summarizeTask(task)}`);
  const detailResult = await queryTaskDetail(cookie, task);
  const item = detailResult?.data?.taskItemList?.[0];
  if (!item?.itemId) {
    $.log(`${getLogPrefix()}: 任务 ${task.id} 未返回可浏览 URL，跳过`);
    return null;
  }

  const startResult = await startTaskTime(cookie, task, item);
  const browseUrl = extractBrowseTarget(item, startResult);
  const waitMs = getBrowseWaitMs(task);
  $.log(`${getLogPrefix()}: 任务 ${task.id} 浏览地址 => ${browseUrl}`);
  await visitPage(browseUrl, MAIN_PAGE_REFERER);
  $.log(`${getLogPrefix()}: 任务 ${task.id} 等待 ${waitMs}ms`);
  await sleep(waitMs);

  const finishResult = await doLimitTimeTask(cookie);
  $.log(`${getLogPrefix()}: 任务 ${task.id} 完成结果 => ${stringifySnippet(finishResult, 1200)}`);
  const pollResult = await inviteFissionPoll(cookie);
  $.log(`${getLogPrefix()}: 任务 ${task.id} 后抽奖次数 => ${pollResult?.data?.lotteryTimes ?? '未知'}`);
  return { finishResult, pollResult };
}

function summarizePrize(prize) {
  if (!prize) {
    return '无奖励';
  }
  const amount = prize.amount ? `${prize.amount}${prize.prizeConfigName || ''}` : '';
  return [
    prize.prizeDesc || prize.prizeConfigName || '',
    amount,
    prize.forwardUrl ? `forward=${extractUrlFromOpenApp(prize.forwardUrl) || prize.forwardUrl}` : '',
  ].filter(Boolean).join(' | ');
}

async function handleGiftBomb(cookie) {
  await getStaticResource(cookie, GIFT_BOMB_LINK_ID, GIFT_BOMB_PAGE_REFERER);
  const checkResult = await giftBombCheck(cookie);
  $.log(`${getLogPrefix()}: 国家补贴气泡检查 => ${stringifySnippet(checkResult, 1000)}`);
  const drawResult = await giftBombDrawPrize(cookie);
  $.log(`${getLogPrefix()}: 国家补贴气泡奖励 => ${summarizePrize(drawResult?.data)}`);
  const subsidyUrl = extractUrlFromOpenApp(drawResult?.data?.forwardUrl || '');
  if (subsidyUrl) {
    await visitPage(subsidyUrl, GIFT_BOMB_PAGE_REFERER);
  }
  return drawResult;
}

async function performDraws(cookie, pollResult) {
  if (shouldSkipDraws()) {
    $.log(`${getLogPrefix()}: 已配置跳过正式抽奖`);
    return;
  }

  const totalTimes = Number(pollResult?.data?.lotteryTimes || 0);
  if (totalTimes <= 0) {
    $.log(`${getLogPrefix()}: 当前没有可执行的正式抽奖次数`);
    return;
  }

  const drawTimes = Math.min(totalTimes, getMaxDraws());
  const intervalMs = getDrawIntervalMs();
  $.log(`${getLogPrefix()}: 开始正式抽奖 => 可抽=${totalTimes}，实际执行=${drawTimes}`);
  for (let index = 0; index < drawTimes; index += 1) {
    const drawResult = await inviteFissionDrawPrize(cookie);
    $.log(`${getLogPrefix()}: 第${index + 1}次正式抽奖 => ${summarizePrize(drawResult?.data)}`);
    if (index + 1 < drawTimes) {
      await sleep(intervalMs);
    }
  }
}

async function runForAccount(cookie, index) {
  $.index = index;
  $.UserName = getUserName(cookie);
  $.activityCookie = await getActivityCookie(cookie);

  $.log(`${getLogPrefix()}: 开始执行`);
  try {
    $.chromeRuntime = await getChromeRuntime();
    await prepareChromeActivityPage($.chromeRuntime, $.activityCookie, CHROME_BOOTSTRAP_URL);
    $.log(`${getLogPrefix()}: Chrome 活动态已准备`);
  } catch (error) {
    await closeChrome($.chromeRuntime);
    $.chromeRuntime = null;
    $.log(`${getLogPrefix()}: Chrome 活动态准备失败，动作接口退回 Node => ${error.message || error}`);
  }

  try {
    await signIn(cookie);
    await getStaticResource(cookie, LINK_ID, MAIN_PAGE_REFERER);
    await inviteFissionBeforeHome(cookie);
    const homeResult = await inviteFissionHome(cookie);
    $.log(`${getLogPrefix()}: 首页状态 => prizeNum=${homeResult?.data?.prizeNum ?? '-'} | drawPrizeNum=${homeResult?.data?.drawPrizeNum ?? '-'} | inviteCode=${homeResult?.data?.inviteCode || '-'}`);

    const taskListResult = await queryTaskList(cookie);
    const browseTasks = getBrowsableTasks(taskListResult?.data || []);
    $.log(`${getLogPrefix()}: 浏览任务列表 => ${browseTasks.map((task) => summarizeTask(task)).join(' || ') || '无'}`);

    if (!shouldSkipTasks()) {
      const maxTasks = getMaxTasks();
      const pendingTasks = browseTasks.filter((task) => !task.taskFinished).slice(0, maxTasks);
      for (const task of pendingTasks) {
        await handleBrowseTask(cookie, task);
      }
    } else {
      $.log(`${getLogPrefix()}: 已配置跳过浏览任务`);
    }

    await handleGiftBomb(cookie);
    const pollResult = await inviteFissionPoll(cookie);
    $.log(`${getLogPrefix()}: 当前正式抽奖次数 => ${pollResult?.data?.lotteryTimes ?? 0}`);
    await performDraws(cookie, pollResult);

    const finalHomeResult = await inviteFissionHome(cookie);
    $.log(`${getLogPrefix()}: 收尾首页状态 => prizeNum=${finalHomeResult?.data?.prizeNum ?? '-'} | drawPrizeNum=${finalHomeResult?.data?.drawPrizeNum ?? '-'} | inviteCode=${finalHomeResult?.data?.inviteCode || '-'}`);
  } finally {
    await closeChrome($.chromeRuntime);
    $.chromeRuntime = null;
  }
}

(async () => {
  if (!cookies.length) {
    $.log('未找到有效 JD_COOKIE');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runForAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1} ${getUserName(cookies[index])}: 执行异常 => ${error.message || error}`);
    }
  }
})()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error}`);
  })
  .finally(() => {
    $.done();
    process.exit(0);
  });
