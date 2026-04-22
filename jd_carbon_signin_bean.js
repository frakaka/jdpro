/*
cron:12 0 * * * jd_carbon_signin_bean.js

环境变量说明：
1. 本脚本当前没有额外的专属环境变量。
   说明：签到接口、加密公钥、请求头和任务流程都按当前前端逻辑固定实现。
   如果后续京东调整参数，需要更新脚本本身，而不是新增环境变量覆盖。
*/

'use strict';

const crypto = require('crypto');
const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const $ = new Env('包裹签到领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const BASE_URL = 'https://lop-proxy.jd.com';
const SIGN_HISTORY_PATH = '/UserSignInApi/signHistory';
const SIGN_NOW_PATH = '/UserSignInApi/signNowEnhance';
const PKID = '11470';
const PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCCcxl3qbmy25mQa2sPt2AxkRsuUA8UiXMyg7/P6oWhHdf1y5oARnmdpH7h24EDK2WPanC10hBTgR/FC+QkHBl8ENdEJ5AnJ3PsfIXMQjNryi+37wGNDylB9qTUXKufa428vMYTgoxp95+qv6AuX55JDBsbGlivJCiR3mtDKFisnQIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');
const RANDOM_CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.70&HiClVersion=8.1.70&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR&stockSDK=stocksdk-iphone_6.0.0&sPoint=&jdPay=(*#@jdPaySDK*#@jdPayChannel=jdfinance&jdPayChannelVersion=8.1.70&jdPaySdkVersion=4.01.96.00&jdPayClientName=iOS*#@jdPaySDK*#@)';
const CLIENT_HEADER = 'isIphoneX,isIOS,isJDJRAPP';
const SCREEN_HEADER = '390*844';
const APP_PARAMS = '{"appid":158,"ticket_type":"mix","biz":"jdl-carbon"}';
const CLIENT_INFO = '{"appName":"marketing","client":"m"}';
const SIGN_BODY = [{ pin: '', clientIp: '$cooMrdGatewayIp$' }];
const GIAS_PAGE_URL = 'https://jchd.jd.com/';
const GIAS_SCRIPT_URL = 'https://gias.jd.com/js/m-tk.js';
const DEFAULT_GIAS_BIZ_ID = 'jdl-sc-market-bg';
const RISK_TIMEOUT_MS = 10000;

const cookies = Object.values(jdCookieNode).filter(Boolean);
const riskContextCache = new Map();
let jsdomDeps = null;
let cachedGiasBizId = '';
let cachedGiasScript = '';

function Env(name) {
  return {
    name,
    startTime: Date.now(),
    log(...messages) {
      console.log(messages.join('\n'));
    },
    done() {
      const seconds = ((Date.now() - this.startTime) / 1000).toFixed(3);
      this.log('', `🔔${this.name}, 结束! 🕛 ${seconds} 秒`, '');
    },
  };
}

$.log('', `🔔${$.name}, 开始!`);

function getUserName(cookie) {
  const match = cookie.match(/pt_pin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '未知账号';
}

function randomString(length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * RANDOM_CHARSET.length);
    result += RANDOM_CHARSET[randomIndex];
  }
  return result;
}

function createTraceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = cookie.match(pattern);
  return match ? match[1] : '';
}

function parseCookieString(cookie) {
  const cookieMap = new Map();
  const items = String(cookie || '').split(';');

  for (const item of items) {
    const pair = item.trim();
    if (!pair) {
      continue;
    }

    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key) {
      cookieMap.set(key, value);
    }
  }

  return cookieMap;
}

function stringifyCookieMap(cookieMap) {
  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function mergeCookieString(baseCookie, extraCookieValues) {
  const cookieMap = parseCookieString(baseCookie);
  for (const [key, value] of Object.entries(extraCookieValues || {})) {
    if (value) {
      cookieMap.set(key, value);
    }
  }
  return stringifyCookieMap(cookieMap);
}

function getRequestUuid(cookie) {
  const jda = getCookieValue(cookie, '__jda');
  if (jda) {
    const parts = jda.split('.');
    if (parts.length >= 2 && parts[1]) {
      return parts[1];
    }
  }

  const fallbackKeys = ['mba_muid', '__jdu', 'pt_pin'];
  for (const key of fallbackKeys) {
    const value = getCookieValue(cookie, key);
    if (value) {
      return decodeURIComponent(value);
    }
  }

  return String(Date.now());
}

function getRequestEid(cookie) {
  const candidateKeys = ['3AB9D23F7A4B3CSS', 'x-rp-evtoken', '3AB9D23F7A4B3C9B', 'equipmentId'];
  for (const key of candidateKeys) {
    const value = getCookieValue(cookie, key);
    if (value) {
      return decodeURIComponent(value);
    }
  }
  return '';
}

function buildCipherContext() {
  const keyText = randomString(16);
  const ivText = randomString(16);
  const ciphertext = crypto.publicEncrypt(
    {
      key: PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(`${keyText}${ivText}`, 'utf8'),
  ).toString('base64');

  return {
    key: Buffer.from(keyText, 'utf8'),
    iv: Buffer.from(ivText, 'utf8'),
    ciphertext,
  };
}

function encryptPayload(payload, cipherContext) {
  const cipher = crypto.createCipheriv('aes-128-cbc', cipherContext.key, cipherContext.iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function stringifyForLog(data) {
  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch (error) {
    return String(data);
  }
}

function loadJsdomDependencies() {
  if (jsdomDeps) {
    return jsdomDeps;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'canvas') {
      return {};
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    jsdomDeps = require('./node_modules/jsdom');
    return jsdomDeps;
  } finally {
    Module._load = originalLoad;
  }
}

function patchRiskWindow(window, bizId) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: USER_AGENT,
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: 'zh-CN',
  });
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: ['zh-CN', 'zh'],
  });
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(window.navigator, 'plugins', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(window.navigator, 'mimeTypes', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(window.screen, 'width', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.screen, 'availWidth', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'availHeight', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.screen, 'colorDepth', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value() {
      return 'data:image/png;base64,AA==';
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(type) {
      if (type === '2d') {
        return {
          textBaseline: 'top',
          font: '14px Arial',
          fillStyle: '#f60',
          fillRect() {},
          fillText() {},
          beginPath() {},
          arc() {},
          closePath() {},
          fill() {},
          stroke() {},
          measureText() {
            return { width: 10 };
          },
          getImageData() {
            return { data: new Uint8ClampedArray(16) };
          },
        };
      }

      return {
        getParameter() {
          return 1;
        },
        getExtension() {
          return null;
        },
        createBuffer() {
          return {};
        },
        bindBuffer() {},
        bufferData() {},
        createProgram() {
          return {};
        },
        createShader() {
          return {};
        },
        shaderSource() {},
        compileShader() {},
        attachShader() {},
        linkProgram() {},
        useProgram() {},
        getAttribLocation() {
          return 0;
        },
        getUniformLocation() {
          return {};
        },
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        uniform2f() {},
        drawArrays() {},
        canvas: {
          toDataURL() {
            return 'data:image/png;base64,AA==';
          },
        },
      };
    },
  });

  window.console = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  window.bp_bizid = bizId;
}

async function getGiasBizId() {
  if (cachedGiasBizId) {
    return cachedGiasBizId;
  }

  try {
    const html = await got(GIAS_PAGE_URL, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: {
        request: 10000,
      },
    }).text();
    const match = html.match(/window\.bp_bizid\s*=\s*['"]([^'"]+)['"]/);
    cachedGiasBizId = match?.[1] || DEFAULT_GIAS_BIZ_ID;
  } catch (error) {
    cachedGiasBizId = DEFAULT_GIAS_BIZ_ID;
  }

  return cachedGiasBizId;
}

async function getGiasScript() {
  if (cachedGiasScript) {
    return cachedGiasScript;
  }

  cachedGiasScript = await got(GIAS_SCRIPT_URL, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: GIAS_PAGE_URL,
    },
    timeout: {
      request: 10000,
    },
  }).text();
  return cachedGiasScript;
}

async function getRiskContext(cookie) {
  const cacheKey = getUserName(cookie);
  if (riskContextCache.has(cacheKey)) {
    return riskContextCache.get(cacheKey);
  }

  const riskContextPromise = (async () => {
    const { JSDOM, VirtualConsole } = loadJsdomDependencies();
    const virtualConsole = new VirtualConsole();
    const bizId = await getGiasBizId();
    const scriptSource = await getGiasScript();
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: GIAS_PAGE_URL,
      referrer: GIAS_PAGE_URL,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      resources: 'usable',
      virtualConsole,
    });

    try {
      const { window } = dom;
      patchRiskWindow(window, bizId);

      const sourceCookieMap = parseCookieString(cookie);
      for (const [key, value] of sourceCookieMap.entries()) {
        window.document.cookie = `${key}=${value}; path=/`;
      }

      window.eval(scriptSource);

      const tokenResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('gias 获取 jsToken 超时'));
        }, RISK_TIMEOUT_MS);

        window.getJsToken((result) => {
          clearTimeout(timer);
          resolve(result || {});
        }, RISK_TIMEOUT_MS);
      });

      const riskCookieMap = parseCookieString(window.document.cookie);
      const jsToken = riskCookieMap.get('3AB9D23F7A4B3CSS') || tokenResult.jsToken || '';
      const equipmentId = riskCookieMap.get('3AB9D23F7A4B3C9B') || tokenResult.eid || '';
      const gia_d = riskCookieMap.get('_gia_d') || '1';

      if (!jsToken) {
        throw new Error(`gias 未返回有效 jsToken: ${stringifyForLog(tokenResult).slice(0, 300)}`);
      }

      return {
        jsToken,
        equipmentId,
        gia_d,
        cookie: mergeCookieString(cookie, {
          '3AB9D23F7A4B3CSS': jsToken,
          '3AB9D23F7A4B3C9B': equipmentId,
          _gia_d: gia_d,
          equipmentId,
        }),
      };
    } finally {
      dom.window.close();
    }
  })();

  riskContextCache.set(cacheKey, riskContextPromise);
  return riskContextPromise;
}

function buildCommonHeaders(cookie) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=utf-8',
    Cookie: cookie,
    Origin: 'https://jchd.jd.com',
    Referer: 'https://jchd.jd.com/',
    'User-Agent': USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'x-requested-with': 'XMLHttpRequest',
    appparams: APP_PARAMS,
    clientinfo: CLIENT_INFO,
    'biz-type': 'service-monitor',
    'source-client': '2',
    access: 'H5',
    'LOP-DN': 'activity.jd.com',
    forcebot: '0',
    'report-time': String(Date.now()),
    'event-id': createTraceId(),
  };
}

function buildEncryptedHeaders(cookie, cipherContext, riskContext) {
  const headers = buildCommonHeaders(cookie);
  headers.uuid = getRequestUuid(cookie);
  headers.eid = riskContext?.jsToken || getRequestEid(cookie);
  headers.brand = 'Apple';
  headers.client = CLIENT_HEADER;
  headers.osversion = 'iOS 18.7';
  headers.model = 'iPhone';
  headers.networktype = 'unknown';
  headers.screen = SCREEN_HEADER;
  headers.ciphertext = cipherContext.ciphertext;
  headers.pkid = PKID;
  return headers;
}

async function postJson(path, cookie, payload, options = {}) {
  const {
    encryptRequest = false,
    requestCookie = cookie,
    riskContext = null,
  } = options;
  const cipherContext = encryptRequest ? buildCipherContext() : null;
  const body = encryptRequest
    ? encryptPayload(payload, cipherContext)
    : JSON.stringify(payload);
  const headers = encryptRequest
    ? buildEncryptedHeaders(requestCookie, cipherContext, riskContext)
    : buildCommonHeaders(requestCookie);

  const responseText = await got.post(`${BASE_URL}${path}`, {
    body,
    headers,
    throwHttpErrors: false,
    timeout: {
      request: 15000,
    },
  }).text();

  return safeJsonParse(responseText.trim()) ?? responseText.trim();
}

function extractMessage(data) {
  if (typeof data === 'string') {
    return data;
  }

  const candidateKeys = ['msg', 'message', 'content', 'subCodeMsg', 'errMsg'];
  for (const key of candidateKeys) {
    const value = data?.[key];
    if (typeof value === 'string' && value) {
      return value;
    }
  }

  return stringifyForLog(data);
}

function formatHistory(data) {
  const content = data?.content;
  if (!content || typeof content !== 'object') {
    return `原始返回：${stringifyForLog(data).slice(0, 300)}`;
  }

  const rewardDays = Array.isArray(content.rewardDays) ? content.rewardDays.join(',') : '';
  return `signIn=${content.signIn}, signNum=${content.signNum}${rewardDays ? `, rewardDays=${rewardDays}` : ''}`;
}

async function querySignHistory(cookie) {
  return postJson(SIGN_HISTORY_PATH, cookie, [{ pin: '' }]);
}

async function signNow(cookie) {
  const riskContext = await getRiskContext(cookie);
  return postJson(SIGN_NOW_PATH, cookie, SIGN_BODY, {
    encryptRequest: true,
    requestCookie: riskContext.cookie,
    riskContext,
  });
}

async function processAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  console.log(`\n==== ${prefix} ====`);

  const firstHistory = await querySignHistory(cookie);
  console.log(`${prefix}: 初始签到状态 => ${formatHistory(firstHistory)}`);

  if (firstHistory?.code !== 1 || !firstHistory?.content) {
    return `${prefix}: signHistory 返回异常，${stringifyForLog(firstHistory).slice(0, 300)}`;
  }

  if (Number(firstHistory.content.signIn) === 1) {
    return `${prefix}: 今日已签到，累计 ${firstHistory.content.signNum} 天`;
  }

  const signResponse = await signNow(cookie);
  console.log(`${prefix}: 签到结果 => ${stringifyForLog(signResponse)}`);

  if (signResponse?.code !== 1) {
    return `${prefix}: 签到失败，${extractMessage(signResponse)}`;
  }

  const secondHistory = await querySignHistory(cookie);
  console.log(`${prefix}: 复查签到状态 => ${formatHistory(secondHistory)}`);

  const beanCount = signResponse?.content?.jinBeanNum;
  if (secondHistory?.code === 1 && Number(secondHistory?.content?.signIn) === 1) {
    return `${prefix}: 签到成功${beanCount ? `，领取 ${beanCount} 京豆` : ''}`;
  }

  return `${prefix}: 已执行签到，但复查状态异常，${stringifyForLog(secondHistory).slice(0, 300)}`;
}

async function main() {
  if (!cookies.length) {
    const message = '未找到有效的京东 Cookie';
    $.log(message);
    if (notify?.sendNotify) {
      await notify.sendNotify($.name, message);
    }
    return;
  }

  const results = [];
  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index];
    try {
      const result = await processAccount(cookie, index + 1);
      results.push(result);
    } catch (error) {
      results.push(`账号${index + 1}: 执行异常，${error.message}`);
    }
  }

  const summary = results.join('\n');
  $.log('\n' + summary);
  if (notify?.sendNotify) {
    await notify.sendNotify($.name, summary);
  }
}

main()
  .catch((error) => {
    const message = `脚本异常：${error.stack || error.message}`;
    $.log(message);
  })
  .finally(() => {
    $.done();
  });
