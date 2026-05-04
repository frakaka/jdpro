/*
cron:36 0 * * * jd_web_sign_bean.js

JD Web 入口签到、任务、抽奖。

环境变量：
1. JD_FLASH
   必填，浏览器打开 interact.jd.com 后，Network 里 api.m.jd.com 请求 Cookie 中的 flash 字段。
   可填写 flash=xxx，也可只填写 xxx。多账号可使用换行或 & 分隔；只配置一个时应用到所有 JD_COOKIE 账号。
   脚本会自动使用 JD_COOKIE 中的 pt_key/pt_pin 拼接 JD_FLASH。

2. JD_WEB_SIGN_MAX_TASKS
   可选，最多执行几个任务。不配置不限制。

3. JD_WEB_SIGN_MAX_DRAWS
   可选，最多抽奖次数。不配置按接口剩余次数执行。

4. JD_WEB_SIGN_DEBUG
   可选，配置为 1 时打印接口原始片段。

5. JD_WEB_SIGN_AREA
   可选，接口 area 参数。默认不传，保持和 interact.jd.com 当前 PC 页面请求一致。

6. CHROME_BIN / JD_WEB_SIGN_CHROME_BIN
   可选，Chromium 路径。青龙环境可配置 CHROME_BIN=/usr/bin/chromium。

7. JD_WEB_SIGN_PROBE
   可选，配置为 1 时只查询签到、任务、抽奖次数，不执行任务和抽奖。
*/

'use strict';

const got = require('got');
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
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('JD Web签到任务抽奖');

const PAGE_URL = 'https://interact.jd.com/';
const APPID = 'pc_interact_center';
const CLIENT = 'pc';
const CLIENT_VERSION = '1.0.0';
const LOGIN_TYPE = '3';
const AREA = process.env.JD_WEB_SIGN_AREA || '';
const BROWSE_WAIT_MS = 6000;
const DRAW_INTERVAL_MS = 1500;
const PC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const DEFAULT_CHROME_BIN = '/usr/bin/chromium';
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_NAVIGATE_TIMEOUT_MS = 45000;
const CHROME_EVALUATE_TIMEOUT_MS = 900000;

const cookies = buildAccountCookies();

$.log('', `🔔${$.name}, 开始!`);

function buildAccountCookies() {
  const jdCookies = Object.values(jdCookieNode).filter(Boolean);
  const flashList = getFlashList();
  if (!jdCookies.length || !flashList.length) {
    return [];
  }

  return jdCookies.map((cookie, index) => {
    const flash = resolveFlashForCookie(cookie, flashList, index);
    return flash ? mergeCookieString(cookie, { flash }) : '';
  }).filter(Boolean);
}

function getFlashList() {
  const flashText = String(process.env.JD_FLASH || '').trim();
  if (!flashText) {
    return [];
  }

  return flashText
    .split(/\n|&/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const cookieMap = parseCookieString(item);
      const flash = cookieMap.get('flash') || item.replace(/^flash=/, '').trim();
      return {
        pin: cookieMap.get('pt_pin') || cookieMap.get('pin') || cookieMap.get('_pst') || '',
        flash,
      };
    })
    .filter((item) => item.flash);
}

function resolveFlashForCookie(cookie, flashList, index) {
  const userName = getUserName(cookie);
  const matched = flashList.find((item) => item.pin && item.pin === userName);
  if (matched) {
    return matched.flash;
  }
  if (flashList.length === 1) {
    return flashList[0].flash;
  }
  return flashList[index]?.flash || '';
}

function isDebugEnabled() {
  return process.env.JD_WEB_SIGN_DEBUG === '1';
}

function isProbeMode() {
  return process.env.JD_WEB_SIGN_PROBE === '1';
}

function getChromeBin() {
  return String(process.env.CHROME_BIN || process.env.JD_WEB_SIGN_CHROME_BIN || DEFAULT_CHROME_BIN).trim();
}

function getMaxTasks() {
  const value = Number(process.env.JD_WEB_SIGN_MAX_TASKS || 0);
  return Number.isFinite(value) && value > 0 ? value : Infinity;
}

function getMaxDraws() {
  const value = Number(process.env.JD_WEB_SIGN_MAX_DRAWS || 0);
  return Number.isFinite(value) && value > 0 ? value : Infinity;
}

function mergeSetCookie(cookie, setCookieHeader) {
  const values = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await wait(300);
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
  if (!fs.existsSync(chromeBin)) {
    throw new Error(`未找到 Chrome/Chromium: ${chromeBin}`);
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-web-sign-chrome-'));
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
    '--ignore-certificate-errors',
    '--disable-features=AsyncDns',
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
    const pageInfo = pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl) || pages[0];
    if (!pageInfo?.webSocketDebuggerUrl) {
      throw new Error('Chrome 未返回可调试页面');
    }
    const page = new ChromeCdpPage(pageInfo.webSocketDebuggerUrl);
    await page.connect();
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
  await runtime.page?.close();
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
  await page.send('Network.enable');
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

function getTaskItemStatus(item) {
  return String(item?.status ?? item?.taskStatus ?? '1');
}

function isPendingItem(item) {
  return getTaskItemStatus(item) !== '2';
}

function getRewardText(result) {
  const rewardInfo = result?.data?.assignmentRewardInfo || {};
  const beanText = (rewardInfo.jingDouRewards || [])
    .map((item) => `${item.rewardName || '京豆'}x${item.quantity || item.rewardValue || 1}`)
    .join(',');
  const pointText = rewardInfo.virtualPointReward
    ? `${rewardInfo.virtualPointReward.quantity || 0}次抽奖机会`
    : '';
  const couponText = (rewardInfo.couponRewards || [])
    .map((item) => item.rewardName || '优惠券/红包')
    .join(',');
  return [beanText, pointText, couponText].filter(Boolean).join(' | ') || stringifySnippet(result, 600);
}

function getItemList(task) {
  const ext = task?.extraType || '';
  if (ext === 'shoppingActivity') {
    return task.activityChannelList || [];
  }
  if (ext === 'productsInfo') {
    return task.productList || [];
  }
  if (ext === 'followShop') {
    return task.shopList || [];
  }
  if (ext === 'sign') {
    return task.signDetail ? [task.signDetail] : [];
  }
  return [];
}

function buildBrowseUrl(task, item) {
  if (item?.url) {
    return item.url;
  }
  if (task?.extraType === 'productsInfo' && (item?.skuId || item?.itemId)) {
    return `https://item.jd.com/${item.skuId || item.itemId}.html`;
  }
  if (task?.extraType === 'followShop' && (item?.shopId || item?.itemId)) {
    return `https://mall.jd.com/index-${item.shopId || item.itemId}.html`;
  }
  return PAGE_URL;
}

function isDrawableTask(task) {
  if (!task || task.completionFlag) {
    return false;
  }
  if (Number(task.timeStatus || 1) !== 1) {
    return false;
  }
  const rewards = JSON.stringify(task.rewards || []);
  return rewards.includes('抽奖次数');
}

function collectExecutableTasks(assignments) {
  const tasks = [];

  for (const task of assignments) {
    if (!isDrawableTask(task)) {
      continue;
    }

    const items = getItemList(task).filter(isPendingItem);
    if (task.extraType === 'sign') {
      if (items.length) {
        tasks.push({ task, items: items.slice(0, 1) });
      }
      continue;
    }

    const remaining = Math.max(0, Number(task.timesLimit || 1) - Number(task.completionCnt || 0));
    if (remaining <= 0 || !items.length) {
      continue;
    }
    tasks.push({ task, items: items.slice(0, remaining) });
  }

  return tasks;
}

function buildChromeTaskExpression(cookie) {
  const params = {
    cookie,
    pageUrl: PAGE_URL,
    appid: APPID,
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    loginType: LOGIN_TYPE,
    area: AREA,
    browseWaitMs: BROWSE_WAIT_MS,
    drawIntervalMs: DRAW_INTERVAL_MS,
    maxTasks: Number.isFinite(getMaxTasks()) ? getMaxTasks() : 0,
    maxDraws: Number.isFinite(getMaxDraws()) ? getMaxDraws() : 0,
    debug: isDebugEnabled(),
    probeOnly: isProbeMode(),
  };

  return `(${async function runWebSignInChrome(input) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const logs = [];
    const log = (message) => logs.push(message);
    const safeJson = (content, fallback = null) => {
      try {
        return JSON.parse(content);
      } catch (error) {
        return fallback;
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
          if (!key || !value) {
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
      throw new Error(`等待页面运行态超时: ${label}`);
    };
    const getUuid = () => {
      const map = cookieMap();
      const jda = map.get('__jda') || '';
      const jdaParts = jda.split('.');
      return jdaParts[1] || map.get('mba_muid') || map.get('__jdu') || map.get('pt_pin') || String(Date.now());
    };
    const getJsToken = () => new Promise((resolve) => {
      try {
        window.getJsToken((result) => resolve(result?.jsToken || ''), 15000);
      } catch (error) {
        resolve('');
      }
    });
    const signParams = async (functionId, bodyObject, timestamp) => {
      const bodyText = JSON.stringify(bodyObject);
      const signSource = {
        appid: input.appid,
        clientVersion: input.clientVersion,
        client: input.client,
        t: timestamp,
        body: window.SHA256 ? window.SHA256(bodyText) : '',
        functionId,
      };
      const signResult = await window.PSign.sign(signSource);
      const token = await getJsToken();
      const params = {
        functionId,
        body: bodyText,
        h5st: encodeURI(signResult?.h5st || ''),
        uuid: getUuid(),
        loginType: input.loginType,
        appid: input.appid,
        clientVersion: input.clientVersion,
        client: input.client,
        t: String(timestamp),
        'x-api-eid-token': token,
      };
      if (input.area) {
        params.area = input.area;
      } else {
        params.area = '';
      }
      return params;
    };
    const callApi = async (functionId, bodyObject, options = {}) => {
      const timestamp = Date.now();
      const params = await signParams(functionId, bodyObject, timestamp);
      const method = options.method || 'GET';
      const requestInit = {
        method,
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      };
      let url = 'https://api.m.jd.com/';
      if (method === 'POST') {
        requestInit.body = new URLSearchParams(params).toString();
      } else {
        url += `?${new URLSearchParams(params).toString()}`;
      }
      const response = await fetch(url, requestInit);
      const text = await response.text();
      const parsed = safeJson(text, { success: false, statusCode: response.status, raw: text });
      if (input.debug) {
        log(`${functionId} 返回 => ${text.slice(0, 800)}`);
      }
      return parsed;
    };
    const getItemStatus = (item) => String(item?.status ?? item?.taskStatus ?? '1');
    const getItems = (task) => {
      if (task?.extraType === 'shoppingActivity') {
        return task.activityChannelList || [];
      }
      if (task?.extraType === 'productsInfo') {
        return task.productList || [];
      }
      if (task?.extraType === 'followShop') {
        return task.shopList || [];
      }
      return [];
    };
    const isDrawableTask = (task) => {
      if (!task || task.completionFlag || Number(task.timeStatus || 1) !== 1) {
        return false;
      }
      return JSON.stringify(task.rewards || []).includes('抽奖次数');
    };
    const browseUrl = (task, item) => {
      if (item?.url) {
        return item.url;
      }
      if (task?.extraType === 'productsInfo' && (item?.skuId || item?.itemId)) {
        return `https://item.jd.com/${item.skuId || item.itemId}.html`;
      }
      if (task?.extraType === 'followShop' && (item?.shopId || item?.itemId)) {
        return `https://mall.jd.com/index-${item.shopId || item.itemId}.html`;
      }
      return input.pageUrl;
    };
    const rewardText = (result) => {
      const rewardInfo = result?.data?.assignmentRewardInfo || {};
      const beanText = (rewardInfo.jingDouRewards || [])
        .map((item) => `${item.rewardName || '京豆'}x${item.quantity || item.rewardValue || 1}`)
        .join(',');
      const pointText = rewardInfo.virtualPointReward
        ? `${rewardInfo.virtualPointReward.quantity || 0}次抽奖机会`
        : '';
      return [beanText, pointText].filter(Boolean).join(' | ') || JSON.stringify(result).slice(0, 500);
    };
    const executeAssignment = (task, item, actionType) => callApi('pc_interact_assign_execute', {
      eaId: task.id,
      type: task.type,
      itemId: String(item.itemId || '1'),
      extraType: task.extraType,
      rk: false,
      actionType,
    }, { method: 'POST' });

    setCookie(input.cookie);
    await waitFor(() => typeof window.PSign?.sign === 'function', 30000, 'PSign.sign');
    await waitFor(() => typeof window.SHA256 === 'function', 30000, 'SHA256');
    await waitFor(() => typeof window.getJsToken === 'function', 30000, 'getJsToken');

    const signResult = await callApi('pc_interact_sign_query', { type: 1 });
    const signTask = (signResult?.data?.assignmentInfoList || []).find((task) => String(task.name || '').includes('签到') && !task.completionFlag);
    if (signTask) {
      const result = await callApi('pc_interact_sign_execute', {
        type: signTask.type,
        eaId: signTask.id,
        itemId: signTask.signDetail?.itemId || '1',
        extraType: signTask.extraType || 'sign',
      }, { method: 'POST' });
      log(`Chrome 签到结果 => ${rewardText(result)}`);
    } else {
      log('Chrome 签到任务 => 未找到或已完成');
    }

    const maxTasks = input.maxTasks > 0 ? input.maxTasks : Number.POSITIVE_INFINITY;
    let taskQuery = await callApi('pc_interact_assign_query', { type: 1 });
    let tasks = (taskQuery?.data?.assignmentInfoList || [])
      .filter(isDrawableTask)
      .map((task) => {
        const remaining = Math.max(0, Number(task.timesLimit || 1) - Number(task.completionCnt || 0));
        const items = getItems(task).filter((item) => getItemStatus(item) !== '2').slice(0, remaining);
        return { task, items };
      })
      .filter((entry) => entry.items.length);
    let executedCount = 0;
    log(`Chrome 可执行抽奖任务数 => ${tasks.length}`);

    if (input.probeOnly) {
      const lotteryQuery = await callApi('pc_interact_assign_query', { type: 0 });
      const rewardQuery = await callApi('pc_interact_reward_query', { type: 0, rk: false });
      log(`Chrome 探测模式 => tasks=${tasks.length} lottery=${Boolean(lotteryQuery?.data?.lotteryDrawInfo?.eaId)} usable=${rewardQuery?.data?.usable ?? '-'}`);
      return { ok: true, logs };
    }

    for (const { task, items } of tasks) {
      if (executedCount >= maxTasks) {
        break;
      }
      log(`Chrome 开始任务 => ${task.name} | extraType=${task.extraType} | 待执行=${items.length}`);
      for (const item of items) {
        if (executedCount >= maxTasks) {
          break;
        }
        const title = item.title || item.skuId || item.itemId || 'item';
        const startResult = await executeAssignment(task, item, 1);
        log(`Chrome 启动浏览 => ${title} | ${JSON.stringify(startResult).slice(0, 500)}`);
        const startOk = startResult?.success || String(startResult?.errCode || '') === '305';
        if (!startOk) {
          await sleep(1000);
          continue;
        }
        try {
          await fetch(browseUrl(task, item), { credentials: 'include', mode: 'no-cors' });
        } catch (error) {
          // 跨域不可读不影响停留计时。
        }
        await sleep(Math.max(input.browseWaitMs, Number(task.waitDuration || 0) * 1000));
        const finishResult = await executeAssignment(task, item, 0);
        log(`Chrome 完成浏览 => ${title} | ${rewardText(finishResult)}`);
        executedCount += 1;
        await sleep(1000);
      }
    }

    const lotteryQuery = await callApi('pc_interact_assign_query', { type: 0 });
    const lotteryInfo = lotteryQuery?.data?.lotteryDrawInfo;
    if (!lotteryInfo?.eaId) {
      log('Chrome 未找到抽奖配置');
      return { ok: true, logs };
    }

    let rewardQuery = await callApi('pc_interact_reward_query', { type: 0, rk: false });
    let usable = Number(rewardQuery?.data?.usable || 0);
    const maxDraws = input.maxDraws > 0 ? input.maxDraws : Number.POSITIVE_INFINITY;
    let drawCount = 0;
    log(`Chrome 当前可抽奖次数 => ${usable}`);
    while (usable > 0 && drawCount < maxDraws) {
      drawCount += 1;
      const drawResult = await callApi('pc_interact_assign_execute', {
        rk: false,
        eaId: lotteryInfo.eaId,
        type: lotteryInfo.type || 30,
      }, { method: 'POST' });
      log(`Chrome 第${drawCount}次抽奖 => ${rewardText(drawResult)}`);
      await sleep(input.drawIntervalMs);
      rewardQuery = await callApi('pc_interact_reward_query', { type: 0, rk: false });
      usable = Number(rewardQuery?.data?.usable || 0);
    }

    return { ok: true, logs };
  }})(${JSON.stringify(params)})`;
}

async function runChromeAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);
  $.log(`${prefix}: 使用 Chrome 模式 => ${getChromeBin()}`);

  let runtime = null;
  try {
    runtime = await launchChrome();
    const { page } = runtime;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: PC_USER_AGENT,
      platform: 'macOS',
      acceptLanguage: 'en-GB,en-US;q=0.9,en;q=0.8',
    });
    await setChromeCookies(page, cookie);
    const loadEvent = page.waitForEvent('Page.loadEventFired', CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
    await page.send('Page.navigate', { url: PAGE_URL }, CHROME_NAVIGATE_TIMEOUT_MS);
    await loadEvent;
    const expression = buildChromeTaskExpression(cookie);
    const result = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: CHROME_EVALUATE_TIMEOUT_MS,
    }, CHROME_EVALUATE_TIMEOUT_MS + 5000);
    if (result.exceptionDetails) {
      throw new Error(`Chrome 执行异常: ${stringifySnippet(result.exceptionDetails, 1000)}`);
    }
    const value = result.result?.value;
    if (!value?.ok) {
      throw new Error(`Chrome 任务未成功返回: ${stringifySnippet(value, 1000)}`);
    }
    for (const logLine of value.logs || []) {
      $.log(`${prefix}: ${logLine}`);
    }
  } finally {
    await closeChrome(runtime);
  }
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效 Cookie：请配置 JD_COOKIE + JD_FLASH');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runChromeAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行失败 => ${error.stack || error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`执行异常 => ${error.stack || error.message}`))
  .finally(() => {
    $.done();
    process.exit(0);
  });
