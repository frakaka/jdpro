/*
cron:35 0 * * * jd_tejia_guangyiguang_bean.js

环境变量说明：
1. JD_TEJIA_GUANGYIGUANG_FULL_COOKIE
   含义：可选，补充活动页抓包中的完整 Cookie，用于补齐 sdtoken、3AB9... 等页面态。
   默认值：空。

2. JD_TEJIA_GUANGYIGUANG_DEBUG
   含义：是否打印接口原始返回片段。
   默认值：0，配置为 1 开启。

3. CHROME_BIN / JD_TEJIA_GUANGYIGUANG_CHROME_BIN
   含义：Chrome/Chromium 可执行文件路径。
   默认值：/usr/bin/chromium。
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const got = require('got');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getRequestUuid,
  getUserName,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('特价逛一逛领京豆');

const PAGE_URL = 'https://pro.m.jd.com/mall/active/4WMAPf9VCBdEE8Rva1AVEPH7CBbj/index.html';
const PAGE_REFERER = `${PAGE_URL}?stath=47&navh=44&initiativeVisit=1&finishStatus=1&tttparams=2j0nwDzJleyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEyLjk3MDg5MiIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMDEyMDMiLCJsYnNMbmciOiIxMTIuOTcxNDM3IiwicHJzdGF0ZSI6IjAiLCJncHNfYXJlYSI6IjE4XzE0ODJfNDg5MzhfNTQ2MDIiLCJzY2FsZSI6IjMiLCJhZGRyZXNzSWQiOiIxNTE1MjIwMDk4IiwidW5fYXJlYSI6IjE4XzE0ODJfMzYwNl82MDAwMCIsIndpZHRoIjoiMTE3MCIsImxic0FyZWEiOiIxOF8xNDgyXzQ4OTM4XzU0NjAyIiwibGF0IjoiMjguMjAxNTI2IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX90%3D&isxview=1&everyVisit=1&visitScene=shouyezhudong&from=entry`;
const PAGE_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777534500%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const CHANNEL_ID = '16';
const DESKTOP_TASK_APP_ID = '1759058595200001';
const COMMON_APPID = 'newtry';
const COMMON_H5ST_APP_ID = '35fa0';
const COMMON_CLIENT = 'apple';
const COMMON_CLIENT_VERSION = '15.6.50';
const LOGIN_TYPE = '2';
const REQUEST_AREA = '18_1482_3606_60000';
const REQUEST_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const COMMON_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_lite_0.1.4.js';
const BROWSE_WAIT_MS = 5000;
const EXTRA_BROWSE_WAIT_MS = 3000;
const DEFAULT_CHROME_BIN = '/usr/bin/chromium';
const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_NAVIGATE_TIMEOUT_MS = 45000;
const CHROME_EVALUATE_TIMEOUT_MS = 900000;
const CHROME_SIGN_RUNTIME_TIMEOUT_MS = 45000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

function isDebugEnabled() {
  return process.env.JD_TEJIA_GUANGYIGUANG_DEBUG === '1';
}

function getChromeBin() {
  return String(process.env.CHROME_BIN || process.env.JD_TEJIA_GUANGYIGUANG_CHROME_BIN || DEFAULT_CHROME_BIN).trim();
}

function getMergedCookie(cookie) {
  const fullCookie = String(process.env.JD_TEJIA_GUANGYIGUANG_FULL_COOKIE || '').trim();
  return fullCookie ? mergeCookieString(fullCookie, cookie) : cookie;
}

function buildDynamicActivityCookiePatch(cookie) {
  const cookieMap = parseCookieString(cookie);
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const requestUuid = getRequestUuid(cookie);
  const randomId = crypto.randomUUID();
  const randomSeed = String(Math.floor(1000 + Math.random() * 9000));
  const ptPin = getUserName(cookie);
  const shshshfpa = cookieMap.get('shshshfpa') || `${crypto.randomUUID()}-${nowSeconds}`;

  return {
    pwdt_id: cookieMap.get('pwdt_id') || ptPin,
    mba_muid: cookieMap.get('mba_muid') || `${requestUuid}.${randomSeed}.${now}`,
    mba_sid: cookieMap.get('mba_sid') || `${randomSeed}.${Math.floor(1 + Math.random() * 9)}`,
    pre_seq: cookieMap.get('pre_seq') || '5',
    pre_session: cookieMap.get('pre_session') || `${REQUEST_UUID}|${nowSeconds}`,
    qid_evord: cookieMap.get('qid_evord') || String(Math.floor(100 + Math.random() * 900)),
    qid_fs: cookieMap.get('qid_fs') || String(now - 5000),
    qid_ls: cookieMap.get('qid_ls') || String(now - 5000),
    qid_ts: cookieMap.get('qid_ts') || String(now),
    qid_uid: cookieMap.get('qid_uid') || randomId,
    qid_vis: cookieMap.get('qid_vis') || '1',
    showedCardInfo: cookieMap.get('showedCardInfo') || '1_default',
    joyya: cookieMap.get('joyya') || `${nowSeconds}.0.30.${Math.random().toString(36).slice(2, 9)}`,
    b_dh: cookieMap.get('b_dh') || '760',
    b_avif: cookieMap.get('b_avif') || '1',
    b_dpr: cookieMap.get('b_dpr') || '3',
    b_dw: cookieMap.get('b_dw') || '390',
    b_webp: cookieMap.get('b_webp') || '1',
    webp: cookieMap.get('webp') || '1',
    wxa_level: cookieMap.get('wxa_level') || '1',
    TARGET_UNIT: cookieMap.get('TARGET_UNIT') || 'bjcenter',
    __jdc: cookieMap.get('__jdc') || '122270672',
    __jda: cookieMap.get('__jda') || `122270672.${requestUuid}.${nowSeconds}.${nowSeconds}.${nowSeconds}.1`,
    __jdb: cookieMap.get('__jdb') || `122270672.1.${requestUuid}|1.${nowSeconds}`,
    __jdv: cookieMap.get('__jdv') || `122270672|direct|-|none|-|${now}`,
    shshshfpa,
    shshshfpx: cookieMap.get('shshshfpx') || shshshfpa,
    sid: cookieMap.get('sid') || '',
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-tejia-guangyiguang-chrome-'));
  const args = [
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
  ];
  const chrome = spawn(chromeBin, args, {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  chrome.once('exit', (code, signal) => {
    if (isDebugEnabled()) {
      $.log(`Chrome 已退出 => code=${code} signal=${signal || ''}`);
    }
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

function buildChromeTaskExpression(cookie) {
  const params = {
    cookie: mergeCookieString(getMergedCookie(cookie), buildDynamicActivityCookiePatch(cookie)),
    pageReferer: PAGE_REFERER,
    appid: COMMON_APPID,
    h5stAppId: COMMON_H5ST_APP_ID,
    client: COMMON_CLIENT,
    clientVersion: COMMON_CLIENT_VERSION,
    loginType: LOGIN_TYPE,
    area: REQUEST_AREA,
    channelId: CHANNEL_ID,
    desktopTaskAppId: DESKTOP_TASK_APP_ID,
    browseWaitMs: BROWSE_WAIT_MS + EXTRA_BROWSE_WAIT_MS,
    signRuntimeTimeoutMs: CHROME_SIGN_RUNTIME_TIMEOUT_MS,
    jsSecurityScriptUrl: COMMON_JS_SECURITY_SCRIPT_URL,
    debug: isDebugEnabled(),
  };

  return `(${async function runTejiaGuangyiguangInChrome(input) {
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
        log(`Chrome 签名运行态未自动加载，注入脚本 => ${input.jsSecurityScriptUrl}`);
        await loadScript(input.jsSecurityScriptUrl, 15000);
        await waitFor(() => typeof window.ParamsSignLite === 'function', input.signRuntimeTimeoutMs, 'ParamsSignLite');
      }
      try {
        await waitFor(() => typeof window.getJsToken === 'function', 15000, 'getJsToken');
      } catch (error) {
        await loadScript(input.jsSecurityScriptUrl, 15000).catch(() => null);
        await waitFor(() => typeof window.getJsToken === 'function', input.signRuntimeTimeoutMs, 'getJsToken');
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
    const getRequestUuid = () => {
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
    const buildApiUrl = (functionId, timestamp) => {
      const url = new URL('https://api.m.jd.com/');
      url.searchParams.set('area', input.area);
      url.searchParams.set('clientVersion', input.clientVersion);
      url.searchParams.set('client', input.client);
      url.searchParams.set('loginType', input.loginType);
      url.searchParams.set('t', String(timestamp));
      url.searchParams.set('appid', input.appid);
      url.searchParams.set('xAPIClientLanguage', 'zh_CN');
      url.searchParams.set('functionId', functionId);
      url.searchParams.set('uuid', getRequestUuid());
      url.searchParams.set('d_model', 'iPhone14,5');
      url.searchParams.set('d_brand', 'iPhone');
      url.searchParams.set('model', 'iPhone14,5');
      url.searchParams.set('osVersion', '26.2');
      return url.toString();
    };
    const postNewtry = async (functionId, bodyObject) => {
      const bodyText = JSON.stringify(bodyObject);
      const timestamp = Date.now();
      const signer = new window.ParamsSignLite({ appId: input.h5stAppId, preRequest: false });
      const signResult = await signer.sign({
        functionId,
        appid: input.appid,
        client: input.client,
        t: String(timestamp),
        body: bodyText,
        clientVersion: input.clientVersion,
      });
      const eidToken = await getJsToken();
      const form = [
        `body=${encodeURIComponent(bodyText)}`,
        `h5st=${encodeURI(signResult.h5st || '')}`,
        eidToken ? `x-api-eid-token=${eidToken}` : '',
      ].filter(Boolean).join('&');
      if (input.debug) {
        log(`${functionId} h5stLen=${String(signResult.h5st || '').length} eid=${eidToken.slice(0, 16)}...`);
      }
      const response = await fetch(buildApiUrl(functionId, timestamp), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-rp-client': 'h5_1.0.0',
          'x-referer-page': input.pageReferer.split('?')[0],
        },
        body: form,
      });
      const text = await response.text();
      return safeJson(text, { code: response.status, message: text });
    };
    const queryTaskList = () => postNewtry('common_task_list', {
      ext: { queryReceiveTimes: 1 },
      extMap: {
        sceneType: 2,
        desktopTaskAppId: input.desktopTaskAppId,
      },
      channelId: input.channelId,
    });
    const doTask = (task, item, actionType, receiveRewards = false) => postNewtry('common_do_task', {
      channelId: input.channelId,
      itemId: item.itemId,
      assignmentId: task.encryptAssignmentId,
      actionType,
      ext: actionType === 1
        ? { jumpUrl: item.url }
        : { doReceiveRewards: receiveRewards ? 1 : null },
    });
    const getTasks = (response) => response?.data?.result?.taskInfo?.taskList || [];
    const hasBeanReward = (task) => (task?.rewards || []).some((reward) => (
      String(reward?.rewardType) === '3' || String(reward?.rewardName || '').includes('京豆')
    ));
    const isPendingItem = (item) => Number(item?.status) !== 2 && Boolean(item?.url);
    const getPendingActivities = (task) => {
      const activities = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
      return activities.filter(isPendingItem);
    };
    const isTargetTask = (task) => (
      Number(task?.assignmentType) === 1 &&
      [4, 6].includes(Number(task?.assignmentTimesLimit || 0)) &&
      Number(task?.ext?.waitDuration || 0) === 5 &&
      getPendingActivities(task).length > 0 &&
      hasBeanReward(task)
    );
    const summarizeTask = (task) => {
      const activities = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
      const statuses = activities.map((item) => `${item.title || item.itemId}:${item.status ?? '-'}`).join(',');
      return `${task.assignmentName} | 已完成 ${task.completionCnt}/${task.assignmentTimesLimit} | 待逛=${getPendingActivities(task).length}/${activities.length} | status=${statuses || '-'}`;
    };
    const summarizeRewardClaim = (response) => {
      const assignmentResult = response?.data?.result?.assignmentResult || {};
      const rewardsInfo = assignmentResult?.rewardsInfo || {};
      const successRewards = Object.values(rewardsInfo?.successRewards || {}).flat();
      const failRewards = Array.isArray(rewardsInfo?.failRewards) ? rewardsInfo.failRewards : [];
      const successText = successRewards
        .map((reward) => reward?.rewardName || reward?.rewardValue || reward?.amount || reward?.msg)
        .filter(Boolean)
        .join('/');
      const failText = failRewards
        .map((reward) => reward?.msg || reward?.rewardName || reward?.rewardValue)
        .filter(Boolean)
        .join('/');
      return `msg=${assignmentResult?.msg || response?.message || '-'} | subCode=${assignmentResult?.subCode ?? '-'} | success=${successText || '-'} | fail=${failText || '-'}`;
    };

    setCookie(input.cookie);
    await ensureSignRuntime();

    const taskListResponse = await queryTaskList();
    const tasks = getTasks(taskListResponse);
    const targetTasks = tasks.filter(isTargetTask);
    log(`Chrome common_task_list => code=${taskListResponse?.code ?? '-'} bizCode=${taskListResponse?.data?.bizCode ?? '-'} tasks=${tasks.length}`);
    log(`Chrome 目标任务数 => ${targetTasks.length}`);
    targetTasks.forEach((task) => log(`Chrome 任务摘要 => ${summarizeTask(task)}`));
    if (!targetTasks.length) {
      tasks.slice(0, 10).forEach((task) => log(`Chrome 非目标任务样例 => ${summarizeTask(task)}`));
    }

    for (const task of targetTasks) {
      let completed = Number(task?.completionCnt || 0);
      let lastCompletedItem = null;
      for (const item of getPendingActivities(task)) {
        if (completed >= Number(task?.assignmentTimesLimit || 0)) {
          break;
        }
        log(`Chrome 逛频道 => ${task.assignmentName} | itemId=${item.itemId}`);
        const startResult = await doTask(task, item, 1);
        log(`Chrome 开始结果 => ${startResult?.data?.result?.assignmentResult?.msg || startResult?.message || '-'} | subCode=${startResult?.data?.result?.assignmentResult?.subCode ?? '-'}`);
        const startOk = Number(startResult?.data?.bizCode ?? -1) === 0;
        if (!startOk) {
          continue;
        }
        try {
          await fetch(item.url, { credentials: 'include', mode: 'no-cors' });
        } catch (error) {
          // 部分频道跨域不可读，停留等待仍然继续。
        }
        await sleep(input.browseWaitMs);
        const finishResult = await doTask(task, item, 0);
        const finishInfo = finishResult?.data?.result?.assignmentResult || {};
        log(`Chrome 完成结果 => ${finishInfo.msg || finishResult?.message || '-'} | subCode=${finishInfo.subCode ?? '-'}`);
        if (Number(finishResult?.data?.bizCode ?? -1) === 0) {
          completed += 1;
          lastCompletedItem = item;
        }
        await sleep(1000);
      }
      if (lastCompletedItem && completed >= Number(task?.assignmentTimesLimit || 0)) {
        const receiveResult = await doTask(task, lastCompletedItem, 0, true);
        log(`Chrome 领取奖励结果 => ${summarizeRewardClaim(receiveResult)}`);
        await sleep(1000);
      }
    }

    const refreshed = await queryTaskList();
    const remainingTasks = getTasks(refreshed).filter(isTargetTask);
    log(`Chrome 刷新后剩余目标任务数 => ${remainingTasks.length}`);
    remainingTasks.forEach((task) => log(`Chrome 剩余任务 => ${summarizeTask(task)}`));
    return { ok: true, logs };
  }})(${JSON.stringify(params)})`;
}

async function runChromeAccount(cookie, index) {
  $.index = index;
  $.UserName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${$.UserName} ====`);
  $.log(`账号${index} ${$.UserName}: 使用 Chrome 模式 => ${getChromeBin()}`);

  let runtime = null;
  try {
    runtime = await launchChrome();
    const { page } = runtime;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: PAGE_USER_AGENT,
      platform: 'iPhone',
      acceptLanguage: 'zh-CN,zh-Hans;q=0.9',
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
    const loadEvent = page.waitForEvent('Page.loadEventFired', CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
    await page.send('Page.navigate', { url: PAGE_REFERER }, CHROME_NAVIGATE_TIMEOUT_MS);
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
      $.log(`账号${index} ${$.UserName}: ${logLine}`);
    }
  } finally {
    await closeChrome(runtime);
  }
}

(async () => {
  try {
    if (!cookies.length) {
      $.log('未找到有效的 JD_COOKIE');
      return;
    }

    let index = 0;
    for (const cookie of cookies) {
      index += 1;
      await runChromeAccount(cookie, index);
    }
  } catch (error) {
    $.log(`执行异常 => ${error.stack || error.message}`);
  } finally {
    $.done();
  }
})();
