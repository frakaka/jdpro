/*
cron:46 0 * * * jd_zhuanhongbao_task.js

赚红包任务脚本。

环境变量：
1. JD_ZHUANHONBAO_EID_TOKEN
   可选，覆盖请求头与表单里的 x-api-eid-token。

2. JD_ZHUANHONBAO_SDK_TOKEN
   可选，覆盖表单里的 wg-sdk-token。

3. JD_ZHUANHONBAO_UUID
   可选，覆盖 uuid/openudid。

4. JD_ZHUANHONBAO_AREA
   可选，覆盖 apTaskList 请求体里的 area。

5. JD_ZHUANHONBAO_MAX_TASKS
   可选，限制最多尝试多少个任务。默认不限制。

6. JD_ZHUANHONBAO_SHARE_TASK
   可选，是否执行分享任务。默认 1，配置为 0 关闭。

7. JD_ZHUANHONBAO_MAX_DRAWS
   可选，限制最多抽奖次数。默认不限制。

8. JD_ZHUANHONBAO_BROWSE_WAIT_MS
   可选，浏览任务等待毫秒数。默认 10000。

9. JD_ZHUANHONBAO_DRAW_INTERVAL_MS
   可选，抽奖间隔毫秒数。默认 3000。

10. JD_ZHUANHONBAO_DEBUG
   可选，配置为 1 时打印更多原始响应片段。

11. JD_ZHUANHONBAO_CHROME_BIN / CHROME_BIN
   必需，未显式配置时脚本会按常见 Chromium/Chrome 路径查找。
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
  mergeCookieString,
  parseCookieString,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('赚红包任务');

const API_ENDPOINT = 'https://api.m.jd.com/api';
const APPID = 'activities_platform';
const START_TASK_APPID = 'activity_platform_se';
const CLIENT = 'ios';
const CLIENT_VERSION = '15.7.20';
const PLATFORM = '3';
const LOGIN_TYPE = '2';
const LOGIN_WQ_BIZ = 'wegame';

const PAGE_ID = 'B2Y13x641hwWfpsoRenCzfbz4jR';
const PAGE_URL = `https://pro.m.jd.com/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt12&navh=44&clickIndex=0&tttparams=MhMICeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEzLjAzNjg5NSIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMTAzMTkiLCJsYnNMbmciOiIxMTMuMDM3MDIiLCJwcnN0YXRlIjoiMCIsImdwc19hcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwic2NhbGUiOiIzIiwiYWRkcmVzc0lkIjoiMTUxNTIyMDA5OCIsInVuX2FyZWEiOiIxOF8xNDgyXzM2MDZfNjAwMDAiLCJ3aWR0aCI6IjExNzAiLCJsYnNBcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwibGF0IjoiMjguMjEwMjg2IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX50%3D&stath=47&jumpFrom=1&innerIndex=1&lbzd=syic`;
const LINK_ID = 'wDNvX5t2N52cWEM8cLOa0g';
const GIFT_BOMB_LINK_ID = 'GLshzK4KWP2wQHw_zka5KQ';
const GIFT_BOMB_BABEL_ID = '01667532';
const GIFT_BOMB_CHANNEL = 'syic';

const BEFORE_HOME_H5ST_APP_ID = '02f8d';
const HOME_H5ST_APP_ID = 'eb67b';
const DO_TASK_H5ST_APP_ID = '54ed7';
const DRAW_TASK_AWARD_H5ST_APP_ID = 'f0f3f';
const GIFT_BOMB_DRAW_H5ST_APP_ID = 'a9449';
const POLL_H5ST_APP_ID = 'b3f11';
const DRAW_PRIZE_H5ST_APP_ID = 'c02c6';
const RECEIVE_H5ST_APP_ID = 'b8469';
const SHARE_H5ST_APP_ID = 'f5ec5';
const LIMIT_TASK_H5ST_APP_ID = 'ebecc';

const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM55R4JLOQAAAAACMDEQQ7D5VDL2MX';
const DEFAULT_SDK_TOKEN = 'jdd01JZXVLPLNJNSWKDXB3XVV75ZSNLO5TOT6B2MJ4FZ6HWGA7RWLBNKMPMB5NXI3OCLIS6W3SLH2N6KJOYPUAO3GF4EUCIARTYWQDAOK66I01234567';
const ACTIVITY_USER_AGENT = 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777788820%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const DEFAULT_FULL_ACTIVITY_COOKIE = '__jd_ref_cls=Fission_Lottery_Task_ReceivePrize; shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063; shshshfpb=BApXWX3aP7_hAHG66jpkKj0ZbcwofbpzLBgPXF0wo9xJ1ONBSe4PYlUOz1Xq4nSx7E9Y25vKCisdhJOsy7qQH49gJ1Mij; sdtoken=AAbEsBpEIOVjqTAKCQtvQu171i__hcCWFltztb0t3qN83bwHdGJdxsfGgDI2zHA22LeKvenHSS0J6wQafnBMcjGF0OpfoprqwV73rlMy9r2xGNUDu45fIRzFtHhqTlmVDFjAujeWMsQKO91BBXmVaC1qW4xijgU_5kkrNf0; 3AB9D23F7A4B3C9B=HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA; 3AB9D23F7A4B3CSS=jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM55SD6EAQAAAAADU7BQSEQY2ZONYX; _gia_d=1; __jda=122270672.1777716191796792564871.1777716191.1777776339.1777788674.11; __jdb=122270672.7.1777716191796792564871|11.1777788674; __jdv=122270672%7Clianmeng__8__kong__kong%7Ct_1000441370_%7Cjingfen%7C998c6d442053006c189781bb36772c7a%7C1777737435000; __jdu=1776773704574581962055; mba_muid=1777716191796792564871.7579.1777789821026; mba_sid=7579.9; unionwsws=%7B%22devicefinger%22%3A%22eidI1b48812339seYMyi%2BxceSWi9B1BquhXOpmDMpHufNfBzKBTXpbftpBC99S3bp%2FiNdUQ1bciMGfQ8NmK0u2XbCkQVMWnsFVrkAH3Pc1awkgIzpohR%22%7D; unpl=JF8EAG9nNSttUENdVxxXHhcTSllWX1wPGRcKZ2EMVA4LSVMDHQFJFEB7XlVdWhRKEx9uZBRXX1NPUg4bBisiEEpcVVtYCEkRAl9XDVwzWAZUaxhsG19dBm1XXm0JeycCX2cDZG1oSmQEKwMrWX5KEGRfbQs%7CJF8EANRnNSttXh5XBB4HT0IZTA5QWwldGx9WamICUQ9RH1FQTwoYERd7XlVdWhRKFB9ubxRXXVNOVQ4eAisiEEpcVF9ZC04fA19jBlBaXXtSax4AEhcZS1xcMF4JSnl-NyBRFhxES1drG2wfERRMWDpuXgh7FjM7NVIGCgxJXARMAxwQRxtaUA5eWBkSCmtmBlBZDEpVUSsDKxsRe11VX1wKSxYHb2IAVW1oSmQEKwMrWX5KEAAMClocQwFnZlJVWlocBAIfUhhCQk5UUF9eDE9DAm4zNVVtWA; pre_seq=3; __jdc=122270672; pre_session=224e6c34e7638196d45b7006b8f1713f8d4ec463|20446; pt_key=app_openAAJp9p2vADA-e0ALVpj4K_UIa2UwKG3DzMql_2MBNPpj4yoCQj1f1rZUq7pCQBNKEsrRnr_iXpU; pt_pin=lifeng9891; pwdt_id=lifeng9891; warehistory=100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C; qid_evord=452; b_dh=844; joyya=1777752379.0.46.0w72feu; shshshfpv=JD0211d47djNobDXHGFT177775214871507rx1jpMUiURL2J0j4_lGjGo4s94hQvAS9S3JtZBULMh0arCDUBqLvRsULbP_WTwr5MmeJ1T7lCRYkzkDr6_h6-CL53nT6HYbUbta--MCuFlyuLlUeRh2B34-jT4qLbQE-0r6d3qf~BApXWFZhB6fhD1OB8xqCNNSQdMge9fkCrLs8Pw0xX9xJ1ONBSe4PYlUOz1Xr7I5ZME9Y2tKfQipYzc74z460Isd662SRH; wxa_level=1; jd_bean_anim__2026-05-03=2; qid_ls=1777743454203; qid_ts=1777752283758; qid_vis=4; SameSite=Strict; sid=; cid=8; jxsid=17768740161496914023; x-rp-evtoken=mGW9U4qbzsaBdCMe70m9pCkQCXoOESuHd4Gn4iXzr5M1TcnpFBzJmm12Bfr6UIS3NrQxGalT4yJNDSB-xMRwtQ%3D%3D; jcap_dvzw_fp=S8ZOO2ljg6kjD692Jqmy7RRxDntWOSOI1eJIyp2c64b9CnoWIKivgd5dURXlAft7w6-A-Da1RIhR9kOK0EyWXg==; UUID=76C0B11A-9A15-423F-AD24-788ADF0C9AA6; deviceId=224e6c34e7638196d45b7006b8f1713f8d4ec463; deviceType=iPhone14,5; deviceid_pdj_jd=224e6c34e7638196d45b7006b8f1713f8d4ec463; visitkey=9064630564580568512; cartNum=8; webp=1; shshshfpx=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063; qid_fs=1777716192171; qid_uid=49995f5f-6369-4074-97c0-deed121d534f; b_avif=1; b_dpr=3; b_dw=390; b_webp=1';

const DEFAULT_BUILD = '170437';
const DEFAULT_SCREEN = '390*844';
const DEFAULT_NETWORK_TYPE = 'wifi';
const DEFAULT_BRAND = 'iPhone';
const DEFAULT_MODEL = 'iPhone14,5';
const DEFAULT_LANG = 'zh_CN';
const DEFAULT_OS_VERSION = '26.2';
const DEFAULT_PARTNER = '-1';
const DEFAULT_AREA = '18_1482_3606_60000';
const DEFAULT_REAL_AREA = '18_1482_3606_60000';
const DEFAULT_LONGITUDE = '113.03702';
const DEFAULT_LATITUDE = '28.210319';
const DEFAULT_BROWSE_WAIT_MS = 10 * 1000;
const DEFAULT_DRAW_INTERVAL_MS = 3000;
const DEFAULT_SHARE_SOURCE_CODE = 'liebianchoujiangAIJLI';
const SUBSCRIBE_ID = 'zhuanzhuanHB';
const DEFAULT_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_lite_0.1.5.js';
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

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_ZHUANHONBAO_DEBUG === '1';
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallback;
}

function getMaxTasks() {
  const configuredValue = String(process.env.JD_ZHUANHONBAO_MAX_TASKS || '').trim();
  if (!configuredValue) {
    return Number.POSITIVE_INFINITY;
  }
  return readPositiveInt(configuredValue, Number.POSITIVE_INFINITY);
}

function shouldRunShareTask() {
  return process.env.JD_ZHUANHONBAO_SHARE_TASK !== '0';
}

function getMaxDraws() {
  const configuredValue = String(process.env.JD_ZHUANHONBAO_MAX_DRAWS || '').trim();
  if (!configuredValue) {
    return Number.POSITIVE_INFINITY;
  }
  return readPositiveInt(configuredValue, Number.POSITIVE_INFINITY);
}

function getBrowseWaitMs(task) {
  const timeLimitPeriodMs = Number(task?.timeLimitPeriod || 0) * 1000;
  const configuredWaitMs = readPositiveInt(process.env.JD_ZHUANHONBAO_BROWSE_WAIT_MS, DEFAULT_BROWSE_WAIT_MS);
  return Math.max(configuredWaitMs, timeLimitPeriodMs);
}

function getDrawIntervalMs() {
  return readPositiveInt(process.env.JD_ZHUANHONBAO_DRAW_INTERVAL_MS, DEFAULT_DRAW_INTERVAL_MS);
}

function getTaskArea() {
  return process.env.JD_ZHUANHONBAO_AREA || DEFAULT_AREA;
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function getChromeBin() {
  const configured = String(process.env.JD_ZHUANHONBAO_CHROME_BIN || process.env.CHROME_BIN || '').trim();
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

  send(method, params = {}, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
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
    throw new Error('未找到 Chrome/Chromium，请配置 JD_ZHUANHONBAO_CHROME_BIN 或 CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-zhuanhongbao-chrome-'));
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
      userAgent: ACTIVITY_USER_AGENT,
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
      // 临时目录清理失败不影响任务结果。
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
      url: PAGE_URL,
    }, CHROME_START_TIMEOUT_MS).catch(() => null);
  }
}

function buildActivityCookie(cookie) {
  const fullCookie = String(DEFAULT_FULL_ACTIVITY_COOKIE).trim();
  if (!fullCookie) {
    return cookie;
  }
  const baseCookieMap = parseCookieString(cookie);
  const overrideValues = {};
  for (const [key, value] of baseCookieMap.entries()) {
    overrideValues[key] = value;
  }
  return mergeCookieString(fullCookie, overrideValues);
}

function stringifyCookieEntries(cookieMap) {
  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function buildRequestCookie(cookie, functionId) {
  const cookieMap = parseCookieString(cookie);
  if (functionId === 'inviteFissionBeforeHome' || functionId === 'giftBombCheck' || functionId === 'giftBombDrawPrize') {
    cookieMap.delete('__jd_ref_cls');
  } else if (functionId === 'inviteFissionHome') {
    cookieMap.set('__jd_ref_cls', 'CommercializedMiddlePage_pagetime');
  } else if (functionId === 'apsDoTask') {
    cookieMap.set('__jd_ref_cls', 'Fission_Lottery_CommercializeTaskClick');
  } else if (functionId === 'inviteFissionDrawPrize') {
    cookieMap.set('__jd_ref_cls', 'Babel_dev_other_FissionRed_ClickDraw');
  }
  return stringifyCookieEntries(cookieMap);
}

async function getActivityCookie(cookie) {
  const mergedCookie = buildActivityCookie(cookie);
  try {
    const risk = await getGiasRiskContext(mergedCookie, {
      pageUrl: PAGE_REFERER,
      userAgent: ACTIVITY_USER_AGENT,
      bizId: 'laputa',
    });
    return risk?.cookie ? mergeCookieString(mergedCookie, risk.cookie) : mergedCookie;
  } catch (error) {
    $.log(`${getLogPrefix()}: gias 获取失败，继续使用默认活动态 => ${error.message || error}`);
    return mergedCookie;
  }
}

function getDeviceUuid(cookie) {
  const cookieMap = parseCookieString(cookie);
  return process.env.JD_ZHUANHONBAO_UUID || cookieMap.get('deviceid_pdj_jd') || cookieMap.get('deviceId') || '224e6c34e7638196d45b7006b8f1713f8d4ec463';
}

function getEidToken(cookie) {
  const cookieMap = parseCookieString(cookie);
  return process.env.JD_ZHUANHONBAO_EID_TOKEN || cookieMap.get('3AB9D23F7A4B3CSS') || DEFAULT_EID_TOKEN;
}

function buildExt(extraFields = {}) {
  const activityCookie = $.activityCookie || '';
  return JSON.stringify({
    appType: 'jdapp',
    systemType: 'ios',
    bigScreen: false,
    'x-api-eid-token': getEidToken(activityCookie),
    'wg-sdk-token': process.env.JD_ZHUANHONBAO_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    pageUrl: encodeURIComponent(PAGE_URL),
    ...extraFields,
  });
}

function buildCommonForm(cookie, options = {}) {
  const uuid = getDeviceUuid(cookie);
  const eidToken = getEidToken($.activityCookie || cookie);
  return {
    t: Date.now(),
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    'x-api-eid-token': eidToken,
    uuid,
    build: DEFAULT_BUILD,
    screen: DEFAULT_SCREEN,
    networkType: DEFAULT_NETWORK_TYPE,
    d_brand: DEFAULT_BRAND,
    d_model: DEFAULT_MODEL,
    lang: DEFAULT_LANG,
    osVersion: DEFAULT_OS_VERSION,
    partner: DEFAULT_PARTNER,
    'wg-sdk-token': process.env.JD_ZHUANHONBAO_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    ext: buildExt(options.extFields || {}),
    imei: '',
    aid: '',
    openudid: uuid,
    adid: '',
    cthr: '1',
    ...(options.extraForm || {}),
  };
}

function getLogPrefix() {
  return `账号${$.index} ${$.UserName}`;
}

function logImportantRequest(functionId, body, options = {}) {
  const payload = {
    endpoint: API_ENDPOINT,
    functionId,
    body,
    appid: options.appid || APPID,
    h5stAppId: options.h5stAppId || 'null',
    nullH5st: Boolean(options.nullH5st),
  };
  $.log(`${getLogPrefix()}: [REQ] ${functionId} => ${stringifySnippet(payload, 1500)}`);
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
  $.log(`${getLogPrefix()}: [RESP] ${functionId} => ${stringifySnippet(payload, 2000)}`);
  if (isDebugEnabled()) {
    $.log(`${getLogPrefix()}: [RAW] ${functionId} => ${stringifySnippet(responseMeta?.body || '', 2000)}`);
  }
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

async function callActivityApi(cookie, functionId, body, options = {}) {
  const baseCookie = $.activityCookie || cookie;
  const requestCookie = buildRequestCookie(baseCookie, functionId);
  logImportantRequest(functionId, body, options);
  const responseMeta = await postFormApi(requestCookie, {
    endpoint: API_ENDPOINT,
    functionId,
    appid: options.appid || APPID,
    body,
    client: CLIENT,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    origin: 'https://pro.m.jd.com',
    referer: options.referer || PAGE_REFERER,
    userAgent: ACTIVITY_USER_AGENT,
    extraForm: buildCommonForm(cookie, {
      extFields: options.extFields || {},
      extraForm: {
        ...(options.nullH5st ? { h5st: 'null' } : {}),
        ...(options.extraForm || {}),
      },
    }),
    extraHeaders: {
      ...(options.extraHeaders || {}),
    },
    h5stAppId: options.h5stAppId || '',
    h5stMode: options.h5stMode || 'h5st41',
    h5stPageUrl: PAGE_URL,
    h5stVersion: '5.3',
    h5stScriptUrl: options.h5stScriptUrl || DEFAULT_JS_SECURITY_SCRIPT_URL,
    includeMeta: true,
  });
  logImportantResponse(functionId, responseMeta);
  const latestSdToken = extractSdToken(responseMeta);
  if (latestSdToken && requestCookie) {
    $.activityCookie = mergeCookieString(requestCookie, { sdtoken: latestSdToken });
    $.log(`${getLogPrefix()}: 更新 sdtoken => ${latestSdToken.slice(0, 18)}...`);
  }
  return responseMeta.data;
}

async function getStaticResource(cookie) {
  return callActivityApi(cookie, 'getStaticResource', { linkId: LINK_ID }, { nullH5st: true });
}

async function inviteFissionBeforeHome(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionBeforeHome',
    {
      linkId: LINK_ID,
      isJdApp: true,
      inviter: '',
    },
    {
      h5stAppId: BEFORE_HOME_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function giftBombCheck(cookie) {
  return callActivityApi(
    cookie,
    'giftBombCheck',
    {
      linkId: GIFT_BOMB_LINK_ID,
      area: getTaskArea(),
      babelId: GIFT_BOMB_BABEL_ID,
      channel: GIFT_BOMB_CHANNEL,
    },
    {
      nullH5st: true,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
      extraForm: {
        scval: '',
      },
      extFields: {
        realArea: '',
      },
    },
  );
}

async function giftBombDrawPrize(cookie) {
  return callActivityApi(
    cookie,
    'giftBombDrawPrize',
    {
      linkId: GIFT_BOMB_LINK_ID,
      area: getTaskArea(),
      babelId: GIFT_BOMB_BABEL_ID,
      channel: GIFT_BOMB_CHANNEL,
    },
    {
      h5stAppId: GIFT_BOMB_DRAW_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
      extraForm: {
        scval: '',
      },
      extFields: {
        realArea: '',
      },
    },
  );
}

async function inviteFissionHome(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionHome',
    {
      linkId: LINK_ID,
      inviter: '',
    },
    {
      h5stAppId: HOME_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function queryTaskList(cookie) {
  return callActivityApi(
    cookie,
    'apTaskList',
    {
      linkId: LINK_ID,
      queryType: 0,
      channel: 4,
      area: getTaskArea(),
      assistTaskFilter: 1,
    },
    {},
  );
}

async function queryTaskDetail(cookie, task) {
  return callActivityApi(cookie, 'apTaskDetail', {
    linkId: LINK_ID,
    taskType: task?.taskType || '',
    taskId: task?.id,
    channel: 4,
    checkVersion: true,
    cityId: 0,
    provinceId: 0,
    countyId: 0,
  });
}

function getTaskAssignmentId(task) {
  return task?.pipeExt?.assignmentId || task?.assignmentId || '';
}

function getTaskTimeLimitSwitch(task, item = null) {
  return Number(task?.pipeExt?.timeLimitSwitch ?? task?.timeLimitSwitch ?? item?.pipeExt?.timeLimitSwitch ?? 0);
}

function getTaskPipeExt(task, item = null) {
  return {
    ...(task?.pipeExt || {}),
    taskType: task?.pipeExt?.taskType || task?.taskType || '',
    timeLimitSwitch: getTaskTimeLimitSwitch(task, item),
    assignmentId: getTaskAssignmentId(task),
  };
}

function getTaskItemUrl(task, item = null) {
  return item?.itemId || item?.itemUrl || item?.clickUrl || item?.url || task?.taskSourceUrl || task?.forwardUrl || '';
}

function buildTaskApiItemId(task, item = null) {
  return item?.pipeExt?.itemId || item?.itemId || getTaskItemUrl(task, item);
}

function isTaskItemCompleted(item) {
  return Boolean(item?.isReceived || item?.taskFinished || item?.finished || item?.alreadyGranted || item?.status?.finished || item?.status?.alreadyGranted);
}

function isTimerTask(task, item = null) {
  return getTaskTimeLimitSwitch(task, item) >= 1;
}

async function startTaskTime(cookie, task, item = null) {
  const body = {
    linkId: LINK_ID,
    taskId: task?.id,
    itemId: buildTaskApiItemId(task, item),
    channel: 4,
    pipeExt: getTaskPipeExt(task, item),
  };
  if (item && Object.prototype.hasOwnProperty.call(item, 'taskInsert')) {
    body.taskInsert = item.taskInsert;
  }

  return callActivityApi(
    cookie,
    'apStartTaskTime',
    body,
    {
      appid: START_TASK_APPID,
      h5stAppId: DO_TASK_H5ST_APP_ID,
    },
  );
}

async function doTask(cookie, task, item = null) {
  return callActivityApi(
    cookie,
    'apsDoTask',
    {
      linkId: LINK_ID,
      taskType: task?.taskType || '',
      taskId: task?.id,
      channel: 4,
      checkVersion: true,
      pipeExt: getTaskPipeExt(task, item),
      taskInsert: item?.taskInsert ?? false,
      itemId: buildTaskApiItemId(task, item),
    },
    {
      h5stAppId: DO_TASK_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraForm: {
        appId: DO_TASK_H5ST_APP_ID,
      },
    },
  );
}

async function inviteFissionPoll(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionPoll',
    {
      linkId: LINK_ID,
      type: 2,
    },
    {
      h5stAppId: POLL_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function drawTaskAward(cookie, task) {
  return callActivityApi(
    cookie,
    'apTaskDrawAward',
    {
      taskType: task?.taskType || '',
      taskId: task?.id,
      channel: 4,
      checkVersion: true,
      linkId: LINK_ID,
      pipeExt: getTaskPipeExt(task),
    },
    {
      h5stAppId: DRAW_TASK_AWARD_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraForm: {
        appId: DRAW_TASK_AWARD_H5ST_APP_ID,
      },
    },
  );
}

async function inviteFissionDrawPrize(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionDrawPrize',
    {
      linkId: LINK_ID,
      area: getTaskArea(),
    },
    {
      h5stAppId: DRAW_PRIZE_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
      extFields: {
        realArea: DEFAULT_REAL_AREA,
        longitude: DEFAULT_LONGITUDE,
        latitude: DEFAULT_LATITUDE,
      },
    },
  );
}

async function inviteFissionReceive(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionReceive',
    {
      linkId: LINK_ID,
    },
    {
      h5stAppId: RECEIVE_H5ST_APP_ID,
      h5stMode: 'js_security',
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function doLimitTimeTask(cookie) {
  return callActivityApi(
    cookie,
    'apDoLimitTimeTask',
    {
      linkId: LINK_ID,
    },
    {
      h5stAppId: LIMIT_TASK_H5ST_APP_ID,
      h5stMode: 'js_security',
    },
  );
}

async function querySubStatus(cookie) {
  return callActivityApi(
    cookie,
    'querySubStatus',
    {
      subId: SUBSCRIBE_ID,
    },
    {
      nullH5st: true,
    },
  );
}

async function shareTask(cookie) {
  return callActivityApi(
    cookie,
    'weGameShare',
    {
      linkId: LINK_ID,
      sourceCode: DEFAULT_SHARE_SOURCE_CODE,
      business: 'shareCode',
    },
    {
      h5stAppId: SHARE_H5ST_APP_ID,
      h5stMode: 'js_security',
    },
  );
}

async function queryHongbaoBalance(cookie) {
  return callActivityApi(
    cookie,
    'myhongbao_getHongBaoBalance',
    {
      appToken: '4416CA79_68FC7C86',
      appId: 'activities_platform',
      platformId: 'activities_platform',
      platformToken: '4416CA79_0F96AF03',
      organization: 'JD',
      platform: '1',
      orgType: '1',
      country: 'cn',
      childActivityId: '-1',
      childActiveName: '-1',
      childActivityTime: '-1',
      childActivityUrl: '-1',
      openId: '-1',
      activityArea: '-1',
      applicantErp: '-1',
      extend: {},
      eid: '-1',
      fp: '-1',
      shshshfp: '-1',
      shshshfpa: '-1',
      shshshfpb: '-1',
      jda: '-1',
      activityType: '-1',
      isRvc: '-1',
      excludeLive: '1',
      pageClickKey: '-1',
    },
    {
      nullH5st: true,
    },
  );
}

function buildChromeRuntimeBootstrapScript(input) {
  return `(${async function bootstrapChromeRuntime(runtimeInput) {
    if (window.__jdZhuanHongbaoRuntime) {
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
    const cookieMap = () => new Map(document.cookie.split(';').map((item) => {
      const trimmed = item.trim();
      const index = trimmed.indexOf('=');
      if (index <= 0) {
        return ['', ''];
      }
      return [trimmed.slice(0, index), trimmed.slice(index + 1)];
    }));
    const setCookie = (rawCookie) => {
      String(rawCookie || '')
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => {
          const index = item.indexOf('=');
          if (index <= 0) {
            return;
          }
          const key = item.slice(0, index).trim();
          const value = item.slice(index + 1).trim();
          if (!key) {
            return;
          }
          document.cookie = `${key}=${value}; domain=.jd.com; path=/`;
        });
    };
    const waitFor = async (predicate, timeoutMs, label) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
          return;
        }
        await sleep(200);
      }
      throw new Error(`等待运行态超时: ${label}`);
    };
    const loadScript = (url, timeoutMs) => new Promise((resolve, reject) => {
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
      try {
        await waitFor(() => typeof window.ParamsSignLite === 'function', 15000, 'ParamsSignLite');
      } catch (error) {
        await loadScript(runtimeInput.jsSecurityScriptUrl, 15000);
        await waitFor(() => typeof window.ParamsSignLite === 'function', runtimeInput.signRuntimeTimeoutMs, 'ParamsSignLite');
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
    const getRequestUuid = () => {
      const map = cookieMap();
      const jda = map.get('__jda') || '';
      const jdaParts = jda.split('.');
      return jdaParts[1] || map.get('mba_muid') || map.get('__jdu') || map.get('pt_pin') || String(Date.now());
    };
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
      url.searchParams.set('uuid', payload.uuid || getRequestUuid());
      url.searchParams.set('d_model', runtimeInput.model);
      url.searchParams.set('d_brand', runtimeInput.brand);
      url.searchParams.set('osVersion', runtimeInput.osVersion);
      return url.toString();
    };
    const normalizeFormValue = (key, value) => {
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    };

    window.__jdZhuanHongbaoRuntime = {
      setCookie,
      async postApi(payload) {
        await ensureSignRuntime();
        if (payload.cookie && payload.syncCookie) {
          setCookie(payload.cookie);
        }

        const bodyText = JSON.stringify(payload.body || {});
        const timestamp = Date.now();
        let h5st = 'null';
        if (!payload.nullH5st) {
          const signer = new window.ParamsSignLite({
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
        const extValue = payload.skipExt
          ? undefined
          : {
              appType: 'jdapp',
              systemType: 'ios',
              bigScreen: false,
              'x-api-eid-token': eidToken,
              'wg-sdk-token': payload.sdkToken ?? runtimeInput.defaultSdkToken,
              pageUrl: runtimeInput.pageUrl,
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
          ...(extValue === undefined ? {} : { ext: extValue }),
          ...(payload.extraForm || {}),
        };
        const form = Object.entries(formFields)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .map(([key, value]) => {
            const normalizedValue = normalizeFormValue(key, value);
            const encodedValue = key === 'h5st' ? encodeURI(normalizedValue) : encodeURIComponent(normalizedValue);
            return `${encodeURIComponent(key)}=${encodedValue}`;
          })
          .join('&');

        const url = buildApiUrl(payload, timestamp);
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-rp-client': 'h5_1.0.0',
            'x-referer-page': runtimeInput.pageUrl,
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
            eidTokenPrefix: eidToken ? eidToken.slice(0, 16) : '',
          },
          response: {
            headers: {
              'x-rp-sdtoken': sdTokenHeader,
              'x-api-request-id': response.headers.get('x-api-request-id') || '',
              'x-mlaas-at': response.headers.get('x-mlaas-at') || '',
            },
            parsed: safeJson(rawText),
            raw: rawText,
          },
        };
      },
      async scrollAndWait(waitMs) {
        const totalMs = Math.max(1000, Number(waitMs || 0));
        const rounds = Math.max(1, Math.floor(totalMs / 2000));
        for (let index = 0; index < rounds; index += 1) {
          const root = document.scrollingElement || document.documentElement || document.body;
          const maxTop = Math.max(0, (root?.scrollHeight || 0) - window.innerHeight);
          const nextTop = maxTop > 0 ? Math.floor(maxTop * ((index + 1) / rounds)) : 0;
          window.scrollTo(0, nextTop);
          await sleep(Math.max(1000, Math.floor(totalMs / rounds)));
        }
        window.scrollTo(0, 0);
        return { href: location.href, title: document.title };
      },
      cookieSnapshot() {
        return document.cookie;
      },
    };

    return { ok: true, reused: false, href: location.href };
  }})(${JSON.stringify(input)})`;
}

async function evaluateChrome(page, expression, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  return result?.result?.value;
}

async function ensureChromeRuntime(page) {
  await evaluateChrome(page, buildChromeRuntimeBootstrapScript({
    apiEndpoint: API_ENDPOINT,
    appid: APPID,
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    pageUrl: PAGE_URL,
    build: DEFAULT_BUILD,
    screen: DEFAULT_SCREEN,
    networkType: DEFAULT_NETWORK_TYPE,
    brand: DEFAULT_BRAND,
    model: DEFAULT_MODEL,
    lang: DEFAULT_LANG,
    osVersion: DEFAULT_OS_VERSION,
    partner: DEFAULT_PARTNER,
    defaultEidToken: process.env.JD_ZHUANHONBAO_EID_TOKEN || DEFAULT_EID_TOKEN,
    defaultSdkToken: process.env.JD_ZHUANHONBAO_SDK_TOKEN || '',
    jsSecurityScriptUrl: DEFAULT_JS_SECURITY_SCRIPT_URL,
    signRuntimeTimeoutMs: CHROME_EVALUATE_TIMEOUT_MS,
  }));
}

async function navigateChromePage(page, url, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
  const loadEvent = page.waitForEvent('Page.loadEventFired', timeoutMs).catch(() => null);
  const navigateResult = await page.send('Page.navigate', { url }, timeoutMs);
  await loadEvent;
  if (navigateResult?.errorText) {
    throw new Error(`Chrome 打开失败: ${navigateResult.errorText}`);
  }
}

async function prepareChromeActivityPage(runtime, cookie, options = {}) {
  if (cookie && options.syncCookie !== false) {
    await setChromeCookies(runtime.page, cookie);
  }
  await navigateChromePage(runtime.page, PAGE_REFERER);
  await ensureChromeRuntime(runtime.page);
}

async function chromePostApi(runtime, cookie, functionId, body, options = {}) {
  const payload = {
    cookie,
    syncCookie: Boolean(options.syncCookie),
    functionId,
    body,
    h5stAppId: options.h5stAppId || '',
    nullH5st: Boolean(options.nullH5st),
    preRequest: Boolean(options.preRequest),
    extFields: options.extFields || {},
    extraForm: options.extraForm || {},
    extraHeaders: options.extraHeaders || {},
    sdkToken: options.sdkToken,
    skipExt: Boolean(options.skipExt),
  };
  const expression = `(async () => window.__jdZhuanHongbaoRuntime.postApi(${JSON.stringify(payload)}))()`;
  const result = await evaluateChrome(runtime.page, expression);
  $.log(`${getLogPrefix()}: [REQ] ${functionId} => ${stringifySnippet(result?.request || { functionId, body }, 1500)}`);
  $.log(`${getLogPrefix()}: [RESP] ${functionId} => ${stringifySnippet({ statusCode: result?.status, headers: result?.response?.headers, data: result?.response?.parsed }, 2000)}`);
  if (isDebugEnabled()) {
    $.log(`${getLogPrefix()}: [RAW] ${functionId} => ${stringifySnippet(result?.response?.raw || '', 2000)}`);
  }
  return result;
}

async function chromeScrollAndWait(runtime, waitMs) {
  const expression = `(async () => window.__jdZhuanHongbaoRuntime.scrollAndWait(${Math.max(1000, Number(waitMs || 0))}))()`;
  return evaluateChrome(runtime.page, expression, Math.max(CHROME_EVALUATE_TIMEOUT_MS, waitMs + 5000));
}

function decodeWrappedBrowseUrl(rawUrl) {
  let currentUrl = String(rawUrl || '').trim();
  for (let index = 0; index < 3; index += 1) {
    if (!/^https?:/i.test(currentUrl)) {
      break;
    }
    try {
      const parsed = new URL(currentUrl);
      if (!/\.jd\.com$/i.test(parsed.hostname) && !/\.jd\.hk$/i.test(parsed.hostname)) {
        break;
      }
      const wrapped = parsed.searchParams.get('ext');
      if (!wrapped) {
        break;
      }
      const decoded = Buffer.from(wrapped, 'base64').toString('utf8').trim();
      if (!/^https?:/i.test(decoded)) {
        break;
      }
      currentUrl = decoded;
    } catch (error) {
      break;
    }
  }
  return currentUrl;
}

function getBrowseTargetUrl(task, item = null) {
  return item?.url
    || decodeWrappedBrowseUrl(item?.clickUrl || '')
    || item?.clickUrl
    || item?.itemUrl
    || item?.forwardUrl
    || task?.taskSourceUrl
    || task?.forwardUrl
    || task?.backupSourceUrl
    || '';
}

async function visitBrowseTarget(runtime, targetUrl, waitMs) {
  if (!targetUrl || !/^https?:/i.test(targetUrl)) {
    return { success: false, message: '任务没有可访问的落地页' };
  }

  await navigateChromePage(runtime.page, targetUrl);
  const visitResult = await chromeScrollAndWait(runtime, waitMs);
  await prepareChromeActivityPage(runtime, '', { syncCookie: false });
  return { success: true, ...visitResult };
}

function isTaskCompleted(task) {
  return Boolean(task?.taskFinished || task?.finished || task?.status?.finished || task?.isReceived);
}

function isBrowseTask(task) {
  return ['BROWSE_RTB', 'BROWSE_CHANNEL'].includes(String(task?.taskType || ''));
}

function isShareTask(task) {
  return String(task?.taskType || '') === 'WECHAT_SHARE';
}

function isTaskAwardClaimable(task) {
  return Number(task?.canDrawAwardNum || 0) > 0;
}

function getTaskItems(task) {
  const itemList = Array.isArray(task?.taskItemList) ? task.taskItemList : [];
  if (itemList.length) {
    return itemList;
  }

  const sourceUrl = task?.taskSourceUrl || task?.forwardUrl || '';
  return sourceUrl ? [{ itemId: sourceUrl, taskInsert: false, pipeExt: {} }] : [];
}

function getBrowseTarget(task, item) {
  return item?.itemId || item?.itemUrl || item?.clickUrl || task?.taskSourceUrl || task?.forwardUrl || '-';
}

function summarizeTask(task, item = null) {
  return {
    id: task?.id || '-',
    title: task?.taskShowTitle || task?.taskTitle || '-',
    type: task?.taskType || '-',
    finished: Boolean(task?.taskFinished),
    waitSeconds: Number(task?.timeLimitPeriod || 0),
    assignmentId: task?.pipeExt?.assignmentId || '-',
    target: getBrowseTarget(task, item),
    itemPipeId: item?.pipeExt?.itemId || item?.itemId || '-',
  };
}

function buildRunnableTaskEntries(taskList) {
  const entries = [];
  for (const task of taskList) {
    if (isTaskCompleted(task)) {
      continue;
    }
    if (!isBrowseTask(task) && !isShareTask(task)) {
      continue;
    }
    for (const item of getTaskItems(task)) {
      entries.push({ task, item });
    }
  }
  return entries;
}

function getPendingTaskPriority(entry) {
  const { task, item } = entry;
  const itemUrl = getTaskItemUrl(task, item);
  const taskType = String(task?.taskType || '');
  let score = 0;

  if (taskType === 'BROWSE_RTB') {
    score += 100;
  }
  if (/^\d+$/.test(itemUrl)) {
    score += 80;
  }
  if (isTimerTask(task, item)) {
    score += 20;
  }
  if (itemUrl.includes('pro.m.jd.com/mall/active/')) {
    score += 10;
  }
  if (itemUrl.includes('showTask=1')) {
    score += 5;
  }
  if (itemUrl.includes('floating=true')) {
    score -= 10;
  }
  return score;
}

async function buildPendingTasks(cookie, taskListResult, prefix) {
  const tasks = Array.isArray(taskListResult?.data) ? taskListResult.data : [];
  const pendingTasks = [];
  const stats = {
    completedTasks: 0,
    detailCompletedTasks: 0,
    completedItems: 0,
    noItemTasks: 0,
  };

  for (const task of tasks) {
    const assignmentId = getTaskAssignmentId(task);
    if (!isBrowseTask(task) || !assignmentId || !task?.id) {
      continue;
    }
    if (isTaskCompleted(task)) {
      stats.completedTasks += 1;
      continue;
    }

    let taskWithItems = task;
    let items = getTaskItems(taskWithItems).filter((item) => getTaskItemUrl(taskWithItems, item) && !isTaskItemCompleted(item));
    if (!items.length) {
      const detailResult = await queryTaskDetail(cookie, task);
      if (isDebugEnabled()) {
        $.log(`${prefix}: apTaskDetail ${task.id} => ${stringifySnippet(detailResult, 1000)}`);
      }
      if (Number(detailResult?.code ?? -1) === 0 && detailResult?.data) {
        if (isTaskCompleted(detailResult.data)) {
          stats.detailCompletedTasks += 1;
          continue;
        }
        taskWithItems = {
          ...task,
          ...detailResult.data,
          pipeExt: {
            ...(task.pipeExt || {}),
            ...(detailResult.data.pipeExt || {}),
          },
        };
        const detailItems = getTaskItems(taskWithItems).filter((item) => getTaskItemUrl(taskWithItems, item));
        items = detailItems.filter((item) => !isTaskItemCompleted(item));
        stats.completedItems += detailItems.length - items.length;
      }
    }

    if (!items.length) {
      stats.noItemTasks += 1;
      continue;
    }

    for (const item of items) {
      pendingTasks.push({ task: taskWithItems, item });
    }
  }

  $.log(
    `${prefix}: 任务过滤 => 顶层已完成${stats.completedTasks}个，明细已完成${stats.detailCompletedTasks}个，已完成item${stats.completedItems}个，无可执行item${stats.noItemTasks}个`,
  );

  return pendingTasks.sort((leftEntry, rightEntry) => getPendingTaskPriority(rightEntry) - getPendingTaskPriority(leftEntry));
}

function buildClaimableTaskEntries(taskList) {
  return taskList.filter((task) => isTaskAwardClaimable(task) && task?.id && task?.taskType);
}

function printTaskList(taskList) {
  const taskText = taskList
    .map((task) => `${task.id}:${task.taskShowTitle || task.taskTitle || '-'}[${task.taskType}] finished=${Boolean(task.taskFinished)} source=${task.taskSourceUrl || task.forwardUrl || '-'}`)
    .join(' || ');
  $.log(`${getLogPrefix()}: 任务列表 => ${taskText || '空'}`);
}

async function handleBrowseTask(cookie, task, item, chromeRuntime) {
  const waitMs = getBrowseWaitMs(task);
  $.log(`${getLogPrefix()}: 浏览任务准备 => ${stringifySnippet(summarizeTask(task, item), 1200)}`);
  const targetUrl = getBrowseTargetUrl(task, item);
  $.log(`${getLogPrefix()}: 浏览任务等待 ${Math.ceil(waitMs / 1000)} 秒，目标 => ${targetUrl || getBrowseTarget(task, item)}`);
  const visitResult = await visitBrowseTarget(chromeRuntime, targetUrl, waitMs);
  if (!visitResult.success) {
    $.log(`${getLogPrefix()}: 浏览任务落地页处理失败 => ${visitResult.message || '-'}`);
  }
  const doTaskMeta = await chromePostApi(chromeRuntime, cookie, 'apsDoTask', {
    linkId: LINK_ID,
    taskType: task?.taskType || '',
    taskId: task?.id,
    channel: 4,
    checkVersion: true,
    pipeExt: {
      taskType: task?.pipeExt?.taskType || task?.taskType || '',
      timeLimitSwitch: Number(task?.pipeExt?.timeLimitSwitch ?? task?.timeLimitSwitch ?? item?.pipeExt?.timeLimitSwitch ?? 0),
      assignmentId: task?.pipeExt?.assignmentId || task?.assignmentId || '',
      ...(item?.pipeExt?.itemId || item?.itemId ? { itemId: item?.pipeExt?.itemId || item?.itemId } : {}),
    },
  }, {
    h5stAppId: DO_TASK_H5ST_APP_ID,
  });
  const doTaskResult = doTaskMeta?.response?.parsed || {};
  let drawAwardResult = null;
  if (Number(doTaskResult?.code ?? -1) === 0 && (doTaskResult?.data?.finished || doTaskResult?.data?.userFinishedTimes >= doTaskResult?.data?.finishNeed)) {
    const drawAwardMeta = await chromePostApi(chromeRuntime, cookie, 'apTaskDrawAward', {
      taskType: task?.taskType || '',
      taskId: task?.id,
      channel: 4,
      checkVersion: true,
      linkId: LINK_ID,
      pipeExt: {
        taskType: task?.pipeExt?.taskType || task?.taskType || '',
        timeLimitSwitch: Number(task?.pipeExt?.timeLimitSwitch ?? task?.timeLimitSwitch ?? 0),
        assignmentId: task?.pipeExt?.assignmentId || task?.assignmentId || '',
      },
    }, {
      h5stAppId: DRAW_TASK_AWARD_H5ST_APP_ID,
    });
    drawAwardResult = drawAwardMeta?.response?.parsed || {};
  }
  const pollMeta = await chromePostApi(chromeRuntime, cookie, 'inviteFissionPoll', {
    linkId: LINK_ID,
    type: 2,
  }, {
    h5stAppId: POLL_H5ST_APP_ID,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
  const pollResult = pollMeta?.response?.parsed || {};
  const pollTimes = pollResult?.data?.lotteryTimes;
  $.log(
    `${getLogPrefix()}: 浏览任务结果 => finished=${Boolean(doTaskResult?.data?.finished)} userFinishedTimes=${doTaskResult?.data?.userFinishedTimes ?? '-'} drawAwardCode=${drawAwardResult?.code ?? '-'} lotteryTimes=${pollTimes ?? '-'}`,
  );
}

async function handleShareTask(cookie, task, chromeRuntime) {
  $.log(`${getLogPrefix()}: 分享任务准备 => ${stringifySnippet(summarizeTask(task), 1200)}`);
  const shareMeta = await chromePostApi(chromeRuntime, cookie, 'weGameShare', {
    linkId: LINK_ID,
    sourceCode: DEFAULT_SHARE_SOURCE_CODE,
    business: 'shareCode',
  }, {
    h5stAppId: SHARE_H5ST_APP_ID,
  });
  const shareResult = shareMeta?.response?.parsed || {};
  let drawAwardResult = null;
  if (Number(shareResult?.code ?? -1) === 0) {
    const drawAwardMeta = await chromePostApi(chromeRuntime, cookie, 'apTaskDrawAward', {
      taskType: task?.taskType || '',
      taskId: task?.id,
      channel: 4,
      checkVersion: true,
      linkId: LINK_ID,
      pipeExt: {
        taskType: task?.pipeExt?.taskType || task?.taskType || '',
        timeLimitSwitch: Number(task?.pipeExt?.timeLimitSwitch ?? task?.timeLimitSwitch ?? 0),
        assignmentId: task?.pipeExt?.assignmentId || task?.assignmentId || '',
      },
    }, {
      h5stAppId: DRAW_TASK_AWARD_H5ST_APP_ID,
    });
    drawAwardResult = drawAwardMeta?.response?.parsed || {};
  }
  const pollMeta = await chromePostApi(chromeRuntime, cookie, 'inviteFissionPoll', {
    linkId: LINK_ID,
    type: 2,
  }, {
    h5stAppId: POLL_H5ST_APP_ID,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
  const pollResult = pollMeta?.response?.parsed || {};
  $.log(
    `${getLogPrefix()}: 分享任务结果 => code=${shareResult?.code ?? '-'} msg=${shareResult?.errMsg || '-'} drawAwardCode=${drawAwardResult?.code ?? '-'} lotteryTimes=${pollResult?.data?.lotteryTimes ?? '-'}`,
  );
}

async function claimTaskAwards(cookie, taskList, chromeRuntime) {
  const claimableTasks = buildClaimableTaskEntries(taskList);
  if (!claimableTasks.length) {
    $.log(`${getLogPrefix()}: 当前没有待领取任务次数奖励`);
    return [];
  }

  $.log(`${getLogPrefix()}: 待领取任务次数奖励 => ${claimableTasks.map((task) => `${task.id}:${task.taskShowTitle || task.taskTitle || '-'} x${task.canDrawAwardNum}`).join(' || ')}`);
  const results = [];
  for (const task of claimableTasks) {
    try {
      const resultMeta = await chromePostApi(chromeRuntime, cookie, 'apTaskDrawAward', {
        taskType: task?.taskType || '',
        taskId: task?.id,
        channel: 4,
        checkVersion: true,
        linkId: LINK_ID,
        pipeExt: {
          taskType: task?.pipeExt?.taskType || task?.taskType || '',
          timeLimitSwitch: Number(task?.pipeExt?.timeLimitSwitch ?? task?.timeLimitSwitch ?? 0),
          assignmentId: task?.pipeExt?.assignmentId || task?.assignmentId || '',
        },
      }, {
        h5stAppId: DRAW_TASK_AWARD_H5ST_APP_ID,
      });
      const result = resultMeta?.response?.parsed || {};
      results.push({ task, result });
      const awardSummary = Array.isArray(result?.data)
        ? result.data.map((item) => `${item.awardName || 'AWARD'}:${item.awardGivenNumber || '?'}`).join(',')
        : '-';
      $.log(`${getLogPrefix()}: 领取任务次数奖励 => ${task.taskShowTitle || task.taskTitle || task.id} | code=${result?.code ?? '-'} | awards=${awardSummary}`);
    } catch (error) {
      $.log(`${getLogPrefix()}: 领取任务次数奖励异常 => ${task.taskShowTitle || task.taskTitle || task.id} | ${error.message || error}`);
    }
  }
  return results;
}

async function performDraws(cookie, initialLotteryTimes, chromeRuntime) {
  const availableTimes = Math.max(Number(initialLotteryTimes || 0), 0);
  const maxDraws = getMaxDraws();
  const totalDraws = Number.isFinite(maxDraws) ? Math.min(availableTimes, maxDraws) : availableTimes;
  if (!totalDraws) {
    $.log(`${getLogPrefix()}: 当前没有可执行抽奖次数`);
    return [];
  }

  const intervalMs = getDrawIntervalMs();
  const results = [];
  $.log(`${getLogPrefix()}: 开始抽奖 => 可抽=${availableTimes}，实际执行=${totalDraws}，间隔=${intervalMs}ms`);
  for (let index = 0; index < totalDraws; index += 1) {
    try {
      const drawMeta = await chromePostApi(chromeRuntime, cookie, 'inviteFissionDrawPrize', {
        linkId: LINK_ID,
        area: getTaskArea(),
      }, {
        h5stAppId: DRAW_PRIZE_H5ST_APP_ID,
        extraHeaders: {
          'x-rp-client': 'h5_1.0.0',
          'x-referer-page': PAGE_URL,
        },
        extFields: {
          realArea: DEFAULT_REAL_AREA,
          longitude: DEFAULT_LONGITUDE,
          latitude: DEFAULT_LATITUDE,
        },
      });
      const drawResult = drawMeta?.response?.parsed || {};
      results.push(drawResult);
      $.log(
        `${getLogPrefix()}: 第${index + 1}次抽奖 => code=${drawResult?.code ?? '-'} prizeType=${drawResult?.data?.prizeType ?? '-'} prizeDesc=${drawResult?.data?.prizeDesc || '-'} amount=${drawResult?.data?.amount || '-'}`,
      );
    } catch (error) {
      $.log(`${getLogPrefix()}: 第${index + 1}次抽奖异常 => ${error.message || error}`);
    }

    if (index < totalDraws - 1) {
      await sleep(intervalMs);
    }
  }
  return results;
}

async function runAccount(cookie, index) {
  $.index = index;
  $.UserName = getUserName(cookie);
  const activityCookie = await getActivityCookie(cookie);
  $.activityCookie = activityCookie;
  let chromeRuntime = null;
  $.log(`\n==== ${getLogPrefix()} ====`);
  try {
    chromeRuntime = await launchChrome();
    await prepareChromeActivityPage(chromeRuntime, activityCookie);

    await chromePostApi(chromeRuntime, activityCookie, 'getStaticResource', { linkId: LINK_ID }, { nullH5st: true });

    const giftBombCheckMeta = await chromePostApi(chromeRuntime, activityCookie, 'giftBombCheck', {
      linkId: GIFT_BOMB_LINK_ID,
      area: getTaskArea(),
      babelId: GIFT_BOMB_BABEL_ID,
      channel: GIFT_BOMB_CHANNEL,
    }, {
      nullH5st: true,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
      extraForm: {
        scval: '',
      },
      extFields: {
        realArea: '',
      },
    });
    const giftBombCheckResult = giftBombCheckMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: giftBombCheck => code=${giftBombCheckResult?.code ?? '-'} msg=${giftBombCheckResult?.errMsg || giftBombCheckResult?.message || '-'}`);

    const giftBombDrawMeta = await chromePostApi(chromeRuntime, activityCookie, 'giftBombDrawPrize', {
      linkId: GIFT_BOMB_LINK_ID,
      area: getTaskArea(),
      babelId: GIFT_BOMB_BABEL_ID,
      channel: GIFT_BOMB_CHANNEL,
    }, {
      h5stAppId: GIFT_BOMB_DRAW_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
      extraForm: {
        scval: '',
      },
      extFields: {
        realArea: '',
      },
    });
    const giftBombDrawResult = giftBombDrawMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: giftBombDrawPrize => code=${giftBombDrawResult?.code ?? '-'} msg=${giftBombDrawResult?.errMsg || giftBombDrawResult?.message || '-'} traceId=${giftBombDrawResult?.traceId || '-'}`);

    const beforeHomeMeta = await chromePostApi(chromeRuntime, activityCookie, 'inviteFissionBeforeHome', {
      linkId: LINK_ID,
      isJdApp: true,
      inviter: '',
    }, {
      h5stAppId: BEFORE_HOME_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    });
    const beforeHomeResult = beforeHomeMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: inviteFissionBeforeHome => code=${beforeHomeResult?.code ?? '-'} msg=${beforeHomeResult?.errMsg || beforeHomeResult?.message || (beforeHomeMeta?.status === 403 ? 'HTTP 403/空响应' : '-')}`);

    const homeMeta = await chromePostApi(chromeRuntime, activityCookie, 'inviteFissionHome', {
      linkId: LINK_ID,
      inviter: '',
    }, {
      h5stAppId: HOME_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    });
    const homeResult = homeMeta?.response?.parsed || {};
    if (Number(homeResult?.code ?? -1) === 0) {
      $.log(`${getLogPrefix()}: 首页状态 => drawPrizeNum=${homeResult?.data?.drawPrizeNum ?? 0} prizeNum=${homeResult?.data?.prizeNum ?? 0} amount=${homeResult?.data?.cashVo?.amount || '-'} leftAmount=${homeResult?.data?.cashVo?.leftAmount || '-'} inviteCode=${homeResult?.data?.inviteCode || '-'}`);
    } else {
      $.log(`${getLogPrefix()}: inviteFissionHome => code=${homeResult?.code ?? '-'} msg=${homeResult?.errMsg || homeResult?.message || (homeMeta?.status === 403 ? 'HTTP 403/空响应' : '-')}`);
    }

    const subStatusMeta = await chromePostApi(chromeRuntime, activityCookie, 'querySubStatus', {
      subId: SUBSCRIBE_ID,
    }, {
      nullH5st: true,
    });
    const subStatusResult = subStatusMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: 订阅状态 => ${stringifySnippet(subStatusResult?.result || subStatusResult?.data || subStatusResult, 800)}`);

    const taskListMeta = await chromePostApi(chromeRuntime, activityCookie, 'apTaskList', {
      linkId: LINK_ID,
      queryType: 0,
      channel: 4,
      area: getTaskArea(),
      assistTaskFilter: 1,
    }, {
      nullH5st: true,
    });
    const taskListResult = taskListMeta?.response?.parsed || {};
    const taskList = Array.isArray(taskListResult?.data) ? taskListResult.data : [];
    printTaskList(taskList);
    await claimTaskAwards(activityCookie, taskList, chromeRuntime);

    const runnableEntries = buildRunnableTaskEntries(taskList);
    const maxTasks = getMaxTasks();
    const limitedEntries = Number.isFinite(maxTasks) ? runnableEntries.slice(0, maxTasks) : runnableEntries;
    $.log(`${getLogPrefix()}: 待执行任务数 => ${limitedEntries.length}`);

    for (const { task, item } of limitedEntries) {
      try {
        if (isBrowseTask(task)) {
          await handleBrowseTask(activityCookie, task, item, chromeRuntime);
        } else if (isShareTask(task) && shouldRunShareTask()) {
          await handleShareTask(activityCookie, task, chromeRuntime);
        } else if (isShareTask(task)) {
          $.log(`${getLogPrefix()}: 跳过分享任务 => ${task.taskShowTitle || task.taskTitle || task.id}`);
        }
      } catch (error) {
        $.log(`${getLogPrefix()}: 当前任务执行异常，继续下一个 => ${task.taskShowTitle || task.taskTitle || task.id} | ${error.message || error}`);
      }
    }

    const limitTaskMeta = await chromePostApi(chromeRuntime, activityCookie, 'apDoLimitTimeTask', {
      linkId: LINK_ID,
    }, {
      h5stAppId: LIMIT_TASK_H5ST_APP_ID,
    });
    const limitTaskResult = limitTaskMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: 限时任务检查 => code=${limitTaskResult?.code ?? '-'} msg=${limitTaskResult?.errMsg || '-'}`);

    const finalPollMeta = await chromePostApi(chromeRuntime, activityCookie, 'inviteFissionPoll', {
      linkId: LINK_ID,
      type: 2,
    }, {
      h5stAppId: POLL_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    });
    const finalPollResult = finalPollMeta?.response?.parsed || {};
    const lotteryTimes = finalPollResult?.data?.lotteryTimes ?? 0;
    $.log(`${getLogPrefix()}: 当前抽奖次数 => ${lotteryTimes}`);
    await performDraws(activityCookie, lotteryTimes, chromeRuntime);

    const receiveMeta = await chromePostApi(chromeRuntime, activityCookie, 'inviteFissionReceive', {
      linkId: LINK_ID,
    }, {
      h5stAppId: RECEIVE_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    });
    const receiveResult = receiveMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: 活动领取接口 => code=${receiveResult?.code ?? '-'} msg=${receiveResult?.errMsg || receiveResult?.message || '-'}`);

    const refreshedHomeMeta = await chromePostApi(chromeRuntime, activityCookie, 'inviteFissionHome', {
      linkId: LINK_ID,
      inviter: '',
    }, {
      h5stAppId: HOME_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    });
    const refreshedHomeResult = refreshedHomeMeta?.response?.parsed || {};
    if (Number(refreshedHomeResult?.code ?? -1) === 0) {
      $.log(`${getLogPrefix()}: 刷新首页 => drawPrizeNum=${refreshedHomeResult?.data?.drawPrizeNum ?? 0} prizeNum=${refreshedHomeResult?.data?.prizeNum ?? 0} amount=${refreshedHomeResult?.data?.cashVo?.amount || '-'} leftAmount=${refreshedHomeResult?.data?.cashVo?.leftAmount || '-'}`);
    } else {
      $.log(`${getLogPrefix()}: 刷新首页接口 => code=${refreshedHomeResult?.code ?? '-'} msg=${refreshedHomeResult?.errMsg || refreshedHomeResult?.message || (refreshedHomeMeta?.status === 403 ? 'HTTP 403/空响应' : '-')}`);
    }

    const balanceMeta = await chromePostApi(chromeRuntime, activityCookie, 'myhongbao_getHongBaoBalance', {
      appToken: '4416CA79_68FC7C86',
      appId: 'activities_platform',
      platformId: 'activities_platform',
      platformToken: '4416CA79_0F96AF03',
      organization: 'JD',
      platform: '1',
      orgType: '1',
      country: 'cn',
      childActivityId: '-1',
      childActiveName: '-1',
      childActivityTime: '-1',
      childActivityUrl: '-1',
      openId: '-1',
      activityArea: '-1',
      applicantErp: '-1',
      extend: {},
      eid: '-1',
      fp: '-1',
      shshshfp: '-1',
      shshshfpa: '-1',
      shshshfpb: '-1',
      jda: '-1',
      activityType: '-1',
      isRvc: '-1',
      excludeLive: '1',
      pageClickKey: '-1',
    }, {
      nullH5st: true,
    });
    const balanceResult = balanceMeta?.response?.parsed || {};
    $.log(`${getLogPrefix()}: 红包余额 => current=${balanceResult?.balanceMap?.currentBalance ?? balanceResult?.totalBalance ?? '-'} totalUsable=${balanceResult?.balanceMap?.totalUsableBalance ?? '-'} total=${balanceResult?.totalBalance ?? '-'}`);
  } finally {
    await closeChrome(chromeRuntime);
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
      $.log(`账号${index + 1}: 执行失败 => ${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常 => ${error.message || error}`))
  .finally(() => $.done());
