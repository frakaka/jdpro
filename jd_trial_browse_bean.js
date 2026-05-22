/*
cron:41 0 * * * jd_trial_browse_bean.js

环境变量说明：
1. JD_TRIAL_CHROME_BIN
   含义：可选的 Chrome/Chromium 可执行文件路径，青龙环境可配置为 /usr/bin/chromium 或 /usr/bin/chromium-browser。
   是否必须：否。
2. JD_TRIAL_BROWSE_WAIT_MS
   含义：浏览京东试用页面的等待时长。
   默认值：12000。
3. JD_TRIAL_ACTIVITY_URL
   含义：京东试用浏览页 URL。
   是否必须：否。
*/

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const got = require('got');
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

const $ = new Env('京东试用浏览领京豆');

const CHROME_DEBUG_HOST = '127.0.0.1';
const CHROME_START_TIMEOUT_MS = 15000;
const CHROME_COMMAND_TIMEOUT_MS = 20000;
const CHROME_NAVIGATE_TIMEOUT_MS = 30000;
const DEFAULT_BROWSE_WAIT_MS = 12000;
const DEFAULT_ACTIVITY_URL = 'https://pro.m.jd.com/mall/active/2E9J9XBgeS485AUqQQ8KYQVkvWiM/index.html?babelChannel=ttt1&indexBabelChannel=ttt62';
const TASK_CHANNEL_ID = '22';
const NEWTRY_APPID = 'newtry';
const NEWTRY_CLIENT = 'apple';
const NEWTRY_CLIENT_VERSION = '15.7.20';
const NEWTRY_H5ST_APP_ID = '35fa0';
const DEFAULT_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_lite_0.1.5.js';
const DEFAULT_USER_AGENT = 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1';
const DEFAULT_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
];

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getBrowseWaitMs() {
  const value = Number.parseInt(process.env.JD_TRIAL_BROWSE_WAIT_MS || String(DEFAULT_BROWSE_WAIT_MS), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BROWSE_WAIT_MS;
}

function getActivityUrl() {
  return String(process.env.JD_TRIAL_ACTIVITY_URL || DEFAULT_ACTIVITY_URL).trim() || DEFAULT_ACTIVITY_URL;
}

function getJsSecurityScriptUrl() {
  return String(process.env.JD_TRIAL_JS_SECURITY_SCRIPT_URL || DEFAULT_JS_SECURITY_SCRIPT_URL).trim()
    || DEFAULT_JS_SECURITY_SCRIPT_URL;
}

function getChromeBin() {
  const configured = String(process.env.JD_TRIAL_CHROME_BIN || process.env.CHROME_BIN || '').trim();
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

function isImportantRequest(url) {
  return [
    'api.m.jd.com',
    'ms.jr.jd.com/gw2/generic',
    'pro.m.jd.com/mall/active/2E9J9XBgeS485AUqQQ8KYQVkvWiM',
    'storage.360buyimg.com/webcontainer',
    'storage11.360buyimg.com/webcontainer',
  ].some((keyword) => String(url || '').includes(keyword));
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

class ChromeCdpPage {
  constructor(wsUrl, logger) {
    this.wsUrl = wsUrl;
    this.logger = logger;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
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

    if (message.method) {
      this.handleEvent(message.method, message.params || {});
    }
  }

  handleEvent(method, params) {
    if (method === 'Network.requestWillBeSent') {
      this.handleRequest(params);
    }
    if (method === 'Network.responseReceived') {
      this.handleResponse(params);
    }
    if (method === 'Network.loadingFinished') {
      this.handleLoadingFinished(params);
    }
    if (method === 'Network.loadingFailed') {
      this.handleLoadingFailed(params);
    }

    const waiters = this.eventWaiters.get(method);
    if (!waiters?.length) {
      return;
    }

    const waiter = waiters.shift();
    clearTimeout(waiter.timer);
    waiter.resolve(params);
  }

  handleRequest(params) {
    const request = params.request || {};
    if (!isImportantRequest(request.url)) {
      return;
    }

    this.requestMap.set(params.requestId, {
      url: request.url,
      method: request.method,
      postData: request.postData || '',
    });
    this.logger(`REQUEST ${request.method} ${request.url}`);
    if (request.postData) {
      this.logger(`REQUEST_BODY ${stringifySnippet(request.postData, 1200)}`);
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
    this.logger(`RESPONSE_META HTTP ${response.status} ${meta.method} ${meta.url}`);
  }

  handleLoadingFinished(params) {
    const meta = this.requestMap.get(params.requestId);
    if (!meta) {
      return;
    }

    this.send('Network.getResponseBody', { requestId: params.requestId }, 5000)
      .then((result) => {
        const body = decodeBody(result.body || '', Boolean(result.base64Encoded));
        this.logger(`RESPONSE_BODY ${stringifySnippet(body, 1600)}`);
      })
      .catch((error) => {
        this.logger(`RESPONSE_BODY 获取失败：${error.message || error}`);
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

    this.logger(`RESPONSE_FAILED ${params.errorText || '-'} ${meta.method} ${meta.url}`);
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

  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise !== false,
      returnByValue: options.returnByValue !== false,
    }, options.timeoutMs || CHROME_COMMAND_TIMEOUT_MS);
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || '页面脚本执行异常';
      throw new Error(text);
    }
    return result.result?.value;
  }

  waitForEvent(method, timeoutMs = CHROME_NAVIGATE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, waiters.filter((item) => item.timer !== timer));
        reject(new Error(`等待 Chrome 事件超时：${method}`));
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

async function launchChrome(logger) {
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_TRIAL_CHROME_BIN 或 CHROME_BIN');
  }

  const port = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-trial-chrome-'));
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

    const page = new ChromeCdpPage(pageInfo.webSocketDebuggerUrl, logger);
    await page.connect();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: DEFAULT_USER_AGENT,
      platform: 'iPhone',
      acceptLanguage: 'zh-CN,zh-Hans;q=0.9',
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
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
    await sleep(500);
  }
  if (runtime.userDataDir) {
    try {
      fs.rmSync(runtime.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) {
      // Chrome 退出时临时目录偶尔仍被系统占用，清理失败不影响业务结果。
    }
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

function getTrialRuntimeScript(activityUrl) {
  return `
    (async () => {
      const ACTIVITY_URL = ${JSON.stringify(activityUrl)};
      const API_ENDPOINT = 'https://api.m.jd.com/';
      const APPID = ${JSON.stringify(NEWTRY_APPID)};
      const CLIENT = ${JSON.stringify(NEWTRY_CLIENT)};
      const CLIENT_VERSION = ${JSON.stringify(NEWTRY_CLIENT_VERSION)};
      const H5ST_APP_ID = ${JSON.stringify(NEWTRY_H5ST_APP_ID)};
      const TASK_CHANNEL_ID = ${JSON.stringify(TASK_CHANNEL_ID)};
      const JS_SECURITY_SCRIPT_URL = ${JSON.stringify(getJsSecurityScriptUrl())};

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

      async function ensureSigner() {
        if (window.ParamsSignLite || window.ParamsSign) {
          return;
        }
        await loadScript(JS_SECURITY_SCRIPT_URL);
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!window.ParamsSignLite && !window.ParamsSign) {
          throw new Error('Chrome 页面未暴露 ParamsSign/ParamsSignLite');
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

      function requestUuid() {
        const cookies = cookieMap();
        const jda = cookies.get('__jda') || '';
        const parts = jda.split('.');
        if (parts[1]) {
          return parts[1];
        }
        return cookies.get('mba_muid') || cookies.get('__jdu') || cookies.get('pt_pin') || String(Date.now());
      }

      function getJsToken(fallbackToken) {
        return new Promise((resolve) => {
          const cookies = cookieMap();
          const cookieToken = cookies.get('3AB9D23F7A4B3CSS') || '';
          try {
            if (typeof window.getJsToken !== 'function') {
              resolve(cookieToken || fallbackToken || '');
              return;
            }
            window.getJsToken((result) => {
              const latestCookies = cookieMap();
              resolve((result && result.jsToken) || latestCookies.get('3AB9D23F7A4B3CSS') || cookieToken || fallbackToken || '');
            }, 15000);
          } catch (error) {
            resolve(cookieToken || fallbackToken || '');
          }
        });
      }

      function buildApiUrl(functionId, timestamp) {
        const url = new URL(API_ENDPOINT);
        url.searchParams.set('area', '18_1482_3606_60000');
        url.searchParams.set('clientVersion', CLIENT_VERSION);
        url.searchParams.set('client', CLIENT);
        url.searchParams.set('loginType', '2');
        url.searchParams.set('t', String(timestamp));
        url.searchParams.set('appid', APPID);
        url.searchParams.set('xAPIClientLanguage', 'zh_CN');
        url.searchParams.set('functionId', functionId);
        url.searchParams.set('uuid', requestUuid());
        url.searchParams.set('d_model', 'iPhone14,5');
        url.searchParams.set('d_brand', 'iPhone');
        url.searchParams.set('model', 'iPhone14,5');
        url.searchParams.set('osVersion', '26.2');
        return url.toString();
      }

      async function createH5st(functionId, bodyText, timestamp) {
        await ensureSigner();
        const ParamsSignCtor = window.ParamsSignLite || window.ParamsSign;
        const signer = new ParamsSignCtor({ appId: H5ST_APP_ID });
        const signResult = await signer.sign({
          appid: APPID,
          body: bodyText,
          client: CLIENT,
          clientVersion: CLIENT_VERSION,
          functionId,
          t: String(timestamp),
        });
        return signResult && signResult.h5st ? signResult.h5st : '';
      }

      async function postNewtryApi(functionId, body) {
        const timestamp = Date.now();
        const bodyText = JSON.stringify(body || {});
        const h5st = await createH5st(functionId, bodyText, timestamp);
        const eidToken = await getJsToken();
        const form = new URLSearchParams();
        form.set('body', bodyText);
        form.set('h5st', h5st);
        if (eidToken) {
          form.set('x-api-eid-token', eidToken);
        }

        const response = await fetch(buildApiUrl(functionId, timestamp), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        });
        const rawText = await response.text();
        let data = rawText;
        try {
          data = JSON.parse(rawText);
        } catch (error) {
          data = { code: -1, message: 'JSON 解析失败', rawText };
        }

        return {
          ok: response.ok,
          statusCode: response.status,
          request: {
            functionId,
            body,
            h5stLength: h5st.length,
            h5stSegments: h5st.split(';').map((item) => item.length),
            hasEidToken: Boolean(eidToken),
          },
          data,
          rawText,
        };
      }

      window.__jdTrialRuntime = {
        postNewtryApi,
        queryTaskList() {
          return postNewtryApi('common_task_list', {
            ext: { queryReceiveTimes: 0 },
            extMap: { sceneType: 2 },
            channelId: TASK_CHANNEL_ID,
          });
        },
        doTask(task, activity, actionType) {
          const body = {
            channelId: TASK_CHANNEL_ID,
            itemId: activity && activity.itemId ? String(activity.itemId) : '',
            assignmentId: String(task.encryptAssignmentId || task.assignmentId || ''),
            actionType,
          };
          if (actionType === 1) {
            body.ext = {
              jumpUrl: activity && activity.url ? String(activity.url) : ACTIVITY_URL,
            };
          } else {
            body.ext = {
              doReceiveRewards: null,
            };
          }
          return postNewtryApi('common_do_task', body);
        },
      };

      return {
        ready: true,
        href: location.href,
        hasParamsSign: Boolean(window.ParamsSign || window.ParamsSignLite),
      };
    })()
  `;
}

function getTaskListFromResult(result) {
  return result?.data?.data?.result?.taskInfo?.taskList || [];
}

function getAssignmentResult(result) {
  return result?.data?.data?.result?.assignmentResult || {};
}

function summarizeReward(result) {
  const successRewards = getAssignmentResult(result)?.rewardsInfo?.successRewards || {};
  return Object.values(successRewards)
    .flat()
    .map((reward) => `${reward.quantity || reward.rewardValue || ''}${reward.rewardName || reward.prizeName || ''}`)
    .filter(Boolean)
    .join(',');
}

function taskRewardText(task) {
  return (task.rewards || [])
    .map((reward) => `${reward.rewardValue || reward.quantity || ''}${reward.rewardName || reward.prizeName || ''}`)
    .filter(Boolean)
    .join(',');
}

function isTaskFinished(task) {
  const limit = Number(task.assignmentTimesLimit || 0);
  const completed = Number(task.completionCnt || 0);
  return Boolean(task.completionFlag) || (limit > 0 && completed >= limit);
}

function getTaskActivities(task) {
  const activities = task?.ext?.shoppingActivity;
  return Array.isArray(activities) ? activities : [];
}

function pickTaskActivity(task) {
  const activities = getTaskActivities(task);
  return activities.find((item) => String(item.status || '') !== '2') || activities[0] || {};
}

function getTaskWaitMs(task) {
  const waitSeconds = Number(task?.ext?.waitDuration || 5);
  const waitMs = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : 5000;
  return Math.max(waitMs + 1500, 6500);
}

function extractTaskUrl(result, fallbackUrl) {
  const toUrl = result?.data?.data?.result?.toUrl || getAssignmentResult(result)?.assignmentInfo?.toUrl || '';
  const match = String(toUrl).match(/taskUrl=([^"&}]+)/);
  if (!match) {
    return fallbackUrl || '';
  }
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return match[1];
  }
}

async function navigateChrome(page, url) {
  if (!/^https?:\/\//.test(String(url || ''))) {
    return false;
  }

  const loadEvent = page.waitForEvent('Page.loadEventFired', CHROME_NAVIGATE_TIMEOUT_MS).catch(() => null);
  await page.send('Page.navigate', { url }, CHROME_NAVIGATE_TIMEOUT_MS);
  await loadEvent;
  return true;
}

async function callTrialRuntime(page, expression, timeoutMs = CHROME_COMMAND_TIMEOUT_MS) {
  return page.evaluate(`(async () => ${expression})()`, { timeoutMs });
}

async function ensureTrialRuntime(page, activityUrl, logger) {
  const runtimeExpression = `
    window.__jdTrialRuntime
      ? { ready: true, reused: true, href: location.href }
      : ${getTrialRuntimeScript(activityUrl)}
  `;
  const result = await page.evaluate(runtimeExpression, { timeoutMs: 30000 });
  logger(`Chrome runtime 就绪 => ${stringifySnippet(result, 500)}`);
}

async function queryTrialTasks(page, activityUrl, logger) {
  await ensureTrialRuntime(page, activityUrl, logger);
  const result = await callTrialRuntime(page, 'window.__jdTrialRuntime.queryTaskList()', 30000);
  logger(`REQUEST common_task_list => ${stringifySnippet(result.request, 900)}`);
  logger(`RESPONSE common_task_list => ${stringifySnippet(result.data, 1600)}`);

  const tasks = getTaskListFromResult(result);
  if (!tasks.length) {
    logger('任务列表为空');
    return [];
  }

  logger('任务列表：');
  tasks.forEach((task, index) => {
    const activity = pickTaskActivity(task);
    logger(`  ${index + 1}. ${task.assignmentName || '-'} | ${task.completionCnt || 0}/${task.assignmentTimesLimit || 0} | done=${isTaskFinished(task)} | item=${activity.itemId || '-'} | reward=${taskRewardText(task) || '-'}`);
  });
  return tasks;
}

async function doTrialTaskAction(page, activityUrl, task, activity, actionType, logger) {
  await ensureTrialRuntime(page, activityUrl, logger);
  const escapedTask = JSON.stringify(task);
  const escapedActivity = JSON.stringify(activity || {});
  const result = await callTrialRuntime(
    page,
    `window.__jdTrialRuntime.doTask(${escapedTask}, ${escapedActivity}, ${Number(actionType)})`,
    30000,
  );
  logger(`REQUEST common_do_task actionType=${actionType} => ${stringifySnippet(result.request, 900)}`);
  logger(`RESPONSE common_do_task actionType=${actionType} => ${stringifySnippet(result.data, 1600)}`);
  return result;
}

async function completeTrialBrowseTasks(page, activityUrl, logger) {
  let tasks = await queryTrialTasks(page, activityUrl, logger);
  for (let round = 0; round < 8; round += 1) {
    const task = tasks.find((item) => !isTaskFinished(item) && getTaskActivities(item).length > 0);
    if (!task) {
      logger('没有待执行的浏览任务');
      return;
    }

    const activity = pickTaskActivity(task);
    logger(`开始浏览任务 => ${task.assignmentName || '-'}，url=${activity.url || '-'}`);
    const receiveResult = await doTrialTaskAction(page, activityUrl, task, activity, 1, logger);
    const browseUrl = extractTaskUrl(receiveResult, activity.url);
    const browsed = await navigateChrome(page, browseUrl);
    if (browsed) {
      logger(`已打开浏览页，等待 ${(getTaskWaitMs(task) / 1000).toFixed(1)} 秒 => ${browseUrl}`);
    } else {
      logger(`浏览页不是 H5 URL，直接计时等待 ${(getTaskWaitMs(task) / 1000).toFixed(1)} 秒`);
    }

    await sleep(getTaskWaitMs(task));
    await navigateChrome(page, activityUrl);
    await sleep(800);

    let completeResult = await doTrialTaskAction(page, activityUrl, task, activity, 0, logger);
    const assignmentResult = getAssignmentResult(completeResult);
    if (String(assignmentResult.subCode || '') === '110') {
      logger('浏览时间不足，追加等待 3 秒后重试完成');
      await sleep(3000);
      completeResult = await doTrialTaskAction(page, activityUrl, task, activity, 0, logger);
    }

    const rewardText = summarizeReward(completeResult);
    const completeMessage = getAssignmentResult(completeResult).msg || completeResult?.data?.message || '-';
    logger(`任务完成结果 => ${completeMessage}${rewardText ? `，奖励=${rewardText}` : ''}`);
    await sleep(1000);
    tasks = await queryTrialTasks(page, activityUrl, logger);
  }

  logger('浏览任务轮次达到上限，停止继续执行');
}

async function browseTrialPage(cookie, userName) {
  const requestLogs = [];
  const logger = (message) => {
    const line = `账号 ${userName}: ${message}`;
    requestLogs.push(line);
    $.log(line);
  };
  const runtime = await launchChrome(logger);

  try {
    await setChromeCookies(runtime.page, cookie);

    const activityUrl = getActivityUrl();
    logger(`打开京东试用浏览页 => ${activityUrl}`);
    await navigateChrome(runtime.page, activityUrl);
    await sleep(2500);
    await completeTrialBrowseTasks(runtime.page, activityUrl, logger);

    const browseWaitMs = getBrowseWaitMs();
    logger(`浏览等待 ${(browseWaitMs / 1000).toFixed(1)} 秒`);
    await sleep(browseWaitMs);

    await runtime.page.send('Runtime.evaluate', {
      expression: `
        window.scrollTo(0, document.body.scrollHeight || 1200);
        setTimeout(() => window.dispatchEvent(new Event('pagehide')), 200);
        setTimeout(() => window.dispatchEvent(new Event('visibilitychange')), 400);
        true;
      `,
      awaitPromise: false,
    }).catch((error) => logger(`模拟浏览事件失败：${error.message || error}`));

    await sleep(1500);
    logger('模拟返回活动页/离开浏览页');
    await runtime.page.send('Page.navigate', { url: 'about:blank' }, CHROME_NAVIGATE_TIMEOUT_MS).catch((error) => {
      logger(`模拟返回失败：${error.message || error}`);
    });
    await sleep(1500);
  } finally {
    await closeChrome(runtime);
  }
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);
  await browseTrialPage(cookie, userName);
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
      $.log(`账号${index + 1}: 执行失败：${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常：${error.message || error}`))
  .finally(() => $.done());
