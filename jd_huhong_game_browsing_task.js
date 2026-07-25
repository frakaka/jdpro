/*
cron:18 0 * * * jd_huhong_game_browsing_task.js

互动游戏浏览任务。
仅保留 headless Chrome 路线。
*/

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const jdCookieNode = require('./jdCookie.js');

const SCRIPT_NAME = '京东互动游戏任务';
const START_TIME = Date.now();
const DEBUG_HOST = '127.0.0.1';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3fcyrvLZALNPWCEDRvaZJVrzek8v/index.html?babelChannel=ttt106&hybrid_err_view=1&commontitle=no&iconKey=dandanfan';
const USER_AGENT = 'jdapp;android;15.9.0;;;M/5.0;appBuild/102473;ef/1;ep/%7B%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22ts%22%3A1784886146757%2C%22ridx%22%3A-1%2C%22cipher%22%3A%7B%22sv%22%3A%22EG%3D%3D%22%2C%22ad%22%3A%22CWYyCNZsEJVwYwHvDwTuCK%3D%3D%22%2C%22od%22%3A%22YwDvEWTvCzUjZtc1ZI1wDJu2BJu3ZwGjYWG1YtdwZwU1CwYy%22%2C%22ov%22%3A%22Ctq%3D%22%2C%22ud%22%3A%22CWYyCNZsEJVwYwHvDwTuCK%3D%3D%22%7D%2C%22ciphertype%22%3A5%2C%22version%22%3A%221.2.1%22%2C%22appname%22%3A%22com.jingdong.app.mall%22%7D;jdSupportDarkMode/0;lang/zh_CN;site/CN;elder/2;ccy/CNY;tz/;Mozilla/5.0 (Linux; Android 9; JSN-AL00a Build/HONORJSN-AL00a; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.136 Mobile Safari/537.36';
const API_HOST = 'api.m.jd.com';
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
const DEFAULT_LOAD_WAIT_MS = 15000;
const DEFAULT_AFTER_CLICK_WAIT_MS = 8000;
const DEFAULT_BROWSE_SETTLE_WAIT_MS = 12000;
const DEFAULT_FINAL_WAIT_MS = 25000;
const DEFAULT_SWEEP_ROUNDS = 6;
const HEADFUL = process.env.JD_HUHONG_CHROME_HEADFUL === '1';
const LOAD_WAIT_MS = Number(process.env.JD_HUHONG_CHROME_LOAD_MS || DEFAULT_LOAD_WAIT_MS);
const AFTER_CLICK_WAIT_MS = Number(process.env.JD_HUHONG_CHROME_AFTER_CLICK_MS || DEFAULT_AFTER_CLICK_WAIT_MS);
const BROWSE_SETTLE_WAIT_MS = Number(process.env.JD_HUHONG_CHROME_BROWSE_SETTLE_MS || DEFAULT_BROWSE_SETTLE_WAIT_MS);
const FINAL_WAIT_MS = Number(process.env.JD_HUHONG_CHROME_FINAL_WAIT_MS || DEFAULT_FINAL_WAIT_MS);
const SWEEP_ROUNDS = Number(process.env.JD_HUHONG_CHROME_SWEEP_ROUNDS || DEFAULT_SWEEP_ROUNDS);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...messages) {
  console.log(messages.join('\n'));
}

function done() {
  const seconds = ((Date.now() - START_TIME) / 1000).toFixed(3);
  log('', `🔔${SCRIPT_NAME}, 结束! 🕛 ${seconds} 秒`, '');
}

function parseCookies(cookieText) {
  return String(cookieText || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf('=');
      return {
        name: item.slice(0, index),
        value: item.slice(index + 1),
      };
    })
    .filter((item) => item.name && item.value);
}

function getCookies() {
  return Object.values(jdCookieNode).filter(Boolean);
}

function short(value, maxLength = 1600) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function parseFunctionId(url) {
  try {
    return new URL(url).searchParams.get('functionId') || '';
  } catch (error) {
    return '';
  }
}

function parseFormBody(postData) {
  const form = {};
  const params = new URLSearchParams(postData || '');
  for (const [key, value] of params.entries()) {
    if (key === 'h5st') {
      form[key] = value ? `${value.split(';').slice(0, 4).join(';')};...` : '';
      continue;
    }
    if (/token|cookie|eid/i.test(key)) {
      form[key] = value ? `${value.slice(0, 12)}...${value.slice(-8)}` : '';
      continue;
    }
    form[key] = key === 'body' ? safeJson(value) : value;
  }
  return form;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(message.error.message));
        } else {
          entry.resolve(message.result);
        }
        return;
      }

      const handlers = this.handlers.get(message.method) || [];
      for (const handler of handlers) {
        handler(message.params || {});
      }
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timeout`));
        }
      }, 20000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function fetchJson(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw lastError || new Error(`fetch timeout: ${url}`);
}

async function getResponseBody(cdp, requestId) {
  try {
    const result = await cdp.send('Network.getResponseBody', { requestId });
    const text = result.base64Encoded
      ? Buffer.from(result.body || '', 'base64').toString('utf8')
      : result.body || '';
    return short(safeJson(text));
  } catch (error) {
    return `<<body unavailable: ${error.message || error}>>`;
  }
}

async function collectPageState(cdp) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: '({href: location.href, readyState: document.readyState, text: document.body ? document.body.innerText.slice(0, 3000) : ""})',
    returnByValue: true,
  });
  return result.result?.value || {};
}

async function clickText(cdp, text) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const targetText = ${JSON.stringify(text)};
        const nodes = Array.from(document.querySelectorAll('body *'))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && node.innerText && node.innerText.includes(targetText);
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (ar.width * ar.height) - (br.width * br.height);
          });
        const node = nodes[0];
        if (!node) {
          return { clicked: false, text: targetText };
        }
        node.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = node.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        return {
          clicked: true,
          text: targetText,
          nodeText: node.innerText.slice(0, 120),
          tagName: node.tagName,
          rect: { x, y, width: rect.width, height: rect.height },
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value || {};
}

async function clickTextSeries(cdp, texts, maxClicks = 20) {
  let clickCount = 0;
  for (let index = 0; index < maxClicks; index += 1) {
    let clicked = false;
    for (const text of texts) {
      const result = await clickText(cdp, text);
      if (result.clicked) {
        clickCount += 1;
        clicked = true;
        await sleep(AFTER_CLICK_WAIT_MS);
        break;
      }
    }
    if (!clicked) {
      break;
    }
  }
  return clickCount;
}

async function getScrollMetrics(cdp) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: '({innerHeight: window.innerHeight, scrollHeight: document.scrollingElement ? document.scrollingElement.scrollHeight : document.body.scrollHeight})',
    returnByValue: true,
  });
  return result.result?.value || { innerHeight: 0, scrollHeight: 0 };
}

async function scrollToPosition(cdp, y) {
  await cdp.send('Runtime.evaluate', {
    expression: `window.scrollTo(0, ${Math.max(0, Math.floor(y))})`,
    returnByValue: true,
  });
  await sleep(1200);
}

function getChromeBin() {
  const configured = String(process.env.JD_HUHONG_CHROME_BIN || '').trim();
  const candidates = configured ? [configured, ...DEFAULT_CHROME_CANDIDATES] : DEFAULT_CHROME_CANDIDATES;
  return candidates.find((item) => item && fs.existsSync(item)) || '';
}

async function harvestCurrentViewport(cdp) {
  let claimClicks = 0;
  let taskClicks = 0;

  claimClicks += await clickTextSeries(cdp, ['领取', '去领取'], 8);
  taskClicks += await clickTextSeries(cdp, ['去完成', '去浏览', '完成'], 12);
  claimClicks += await clickTextSeries(cdp, ['领取', '去领取'], 8);

  return {
    claimClicks,
    taskClicks,
    totalClicks: claimClicks + taskClicks,
  };
}

async function sweepActivityPage(cdp) {
  let totalClicks = 0;
  await clickTextSeries(cdp, ['立即签到'], 2);
  await clickTextSeries(cdp, ['签到'], 2);
  await clickTextSeries(cdp, ['攒经验'], 2);

  let idleRounds = 0;
  for (let round = 0; round < SWEEP_ROUNDS; round += 1) {
    const metrics = await getScrollMetrics(cdp);
    const step = Math.max(Math.floor((metrics.innerHeight || 780) * 0.8), 420);
    let roundClicks = 0;
    let roundTaskClicks = 0;
    let roundClaimClicks = 0;

    for (let y = 0; y <= metrics.scrollHeight; y += step) {
      await scrollToPosition(cdp, y);
      const viewportResult = await harvestCurrentViewport(cdp);
      roundClicks += viewportResult.totalClicks;
      roundTaskClicks += viewportResult.taskClicks;
      roundClaimClicks += viewportResult.claimClicks;
    }

    await scrollToPosition(cdp, 0);
    {
      const viewportResult = await harvestCurrentViewport(cdp);
      roundClicks += viewportResult.totalClicks;
      roundTaskClicks += viewportResult.taskClicks;
      roundClaimClicks += viewportResult.claimClicks;
    }

    if (roundTaskClicks > 0) {
      await sleep(BROWSE_SETTLE_WAIT_MS);
      const settleResult = await harvestCurrentViewport(cdp);
      roundClicks += settleResult.totalClicks;
      roundTaskClicks += settleResult.taskClicks;
      roundClaimClicks += settleResult.claimClicks;
    }

    totalClicks += roundClicks;
    if (roundClicks === 0) {
      idleRounds += 1;
    } else {
      idleRounds = 0;
    }

    console.log(JSON.stringify({
      sweepRound: round + 1,
      roundClicks,
      roundTaskClicks,
      roundClaimClicks,
      idleRounds,
    }));

    if (idleRounds >= 2) {
      break;
    }
  }

  return totalClicks;
}

function getChromeArgs(port, userDataDir) {
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-address=${DEBUG_HOST}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  if (!HEADFUL) {
    args.unshift('--headless=new');
  }
  return args;
}

async function runAccount(cookieText, index) {
  const cookieLabel = parseCookies(cookieText).find((item) => item.name === 'pt_pin')?.value || `账号${index}`;
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请配置 JD_HUHONG_CHROME_BIN');
  }
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, DEBUG_HOST, () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
    server.once('error', reject);
  });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-huhong-chrome-'));
  const chrome = spawn(chromeBin, getChromeArgs(port, userDataDir), { stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    const pages = await fetchJson(`http://${DEBUG_HOST}:${port}/json/list`);
    const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && !String(item.url || '').startsWith('chrome-extension://'))
      || pages.find((item) => item.webSocketDebuggerUrl)
      || pages[0];
    if (!page?.webSocketDebuggerUrl) {
      throw new Error('未找到可连接的 Chrome 页面');
    }

    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: USER_AGENT,
      platform: 'Android',
      acceptLanguage: 'zh-CN,zh;q=0.9',
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 780,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      configuration: 'mobile',
    });

    for (const cookie of parseCookies(cookieText)) {
      await cdp.send('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: '.jd.com',
        path: '/',
        secure: true,
        httpOnly: false,
      });
    }

    const responseMap = new Map();
    cdp.on('Network.requestWillBeSent', (params) => {
      const url = params.request?.url || '';
      if (!url.includes(API_HOST)) {
        return;
      }
      const functionId = parseFunctionId(url);
      if (!functionId) {
        return;
      }
      const record = responseMap.get(params.requestId) || {};
      record.type = 'request';
      record.functionId = functionId;
      record.method = params.request.method;
      record.url = url.slice(0, 260);
      record.form = parseFormBody(params.request.postData || '');
      responseMap.set(params.requestId, record);
    });

    cdp.on('Network.responseReceived', (params) => {
      const url = params.response?.url || '';
      if (!url.includes(API_HOST)) {
        return;
      }
      const functionId = parseFunctionId(url);
      if (!functionId) {
        return;
      }
      const record = responseMap.get(params.requestId) || {};
      record.type = 'response';
      record.functionId = functionId;
      record.status = params.response.status;
      record.url = url.slice(0, 260);
      responseMap.set(params.requestId, record);
    });

    cdp.on('Network.loadingFinished', async (params) => {
      const record = responseMap.get(params.requestId);
      if (!record || record.body) {
        return;
      }
      record.body = await getResponseBody(cdp, params.requestId);
      responseMap.set(params.requestId, record);
    });

    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(LOAD_WAIT_MS);

    const beforeClick = await collectPageState(cdp);
    const sweepClicks = await sweepActivityPage(cdp);

    await sleep(FINAL_WAIT_MS);

    const afterClick = await collectPageState(cdp);
    const requests = Array.from(responseMap.values());

    console.log(JSON.stringify({
      account: cookieLabel,
      beforeClick,
      sweepClicks,
      afterClick,
      requests,
    }, null, 2));

    cdp.close();
  } finally {
    chrome.kill('SIGTERM');
    await sleep(1000);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  log('', `🔔${SCRIPT_NAME}, 开始!`);
  const cookies = getCookies();
  if (!cookies.length) {
    log('未找到有效账号 Cookie');
    return;
  }

  log(`====================共${cookies.length}个京东账号Cookie=================`);
  log(`===========脚本执行时间：${new Date().toISOString()}============`);

  for (let index = 0; index < cookies.length; index += 1) {
    const cookieText = cookies[index];
    const userName = parseCookies(cookieText).find((item) => item.name === 'pt_pin')?.value || `账号${index + 1}`;
    log(`\n==== 账号${index + 1} ${decodeURIComponent(userName)} ====`);
    try {
      await runAccount(cookieText, index + 1);
    } catch (error) {
      log(`账号${index + 1}: 执行失败：${error.message || error}`);
    }
    await sleep(1000);
  }
}

main().catch((error) => {
  log(`脚本异常：${error.stack || error.message || error}`);
  process.exitCode = 1;
}).finally(() => {
  done();
});
