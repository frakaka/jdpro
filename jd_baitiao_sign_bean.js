/*
cron:16 0 * * * jd_baitiao_sign_bean.js

环境变量说明：
1. JD_BAITIAO_SIGN_DEBUG
   含义：是否打印白条签到接口原始响应片段，便于排查风控或字段变化。
   是否必须：否，值为 1 时开启。

HAR 对应说明：
1. 来源文件：files/traffic_baitiao_sign_and_yangdae_full_filtered.har
2. 白条签到接口：ms.jr.jd.com/gw2/generic/btsrp/h5/m/signIn
*/

'use strict';

const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  DEFAULT_JR_USER_AGENT,
  Env,
  getUserName,
  mergeCookieString,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('白条签到');

const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const SIGN_URL = 'https://ms.jr.jd.com/gw2/generic/btsrp/h5/m/signIn';
const PAGE_URL = 'https://mcr.jd.com/credit_home/pages/index2.html?btPageType=BT&channelName=001&jrtransparentbar=true&jrcontainer=h5&jrlogin=true';
const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;
const DEFAULT_JS_TOKEN = 'jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5YA2EGKAAAAAACEMWWMY7KIEV3MX';
const DEFAULT_FP = '7ab493a801b59f8a78da75409526800f';
const DEFAULT_SDK_TOKEN = 'jdd01QI7EZRAXIOPWEC2HOEN3UYK5JXTMS3K4NRSL4LRCKRSM3M2NSXCRRVYC4VCZKF64Z2VSR6OF6LGOD5G7LTJ2O4PJR5PTFO7WN3OAOOI01234567';
const DEFAULT_ACTIVITY_ID = 'ACT411162285';
const DEFAULT_X_MLAAS_AT = 'wl=0&id=1994060743652770583&src=sgm-mobile';
const DEFAULT_SGM_CONTEXT = '1994060743652770583;1994060743652770583;false;9HwAEg@vlKkp7SqT8dSSBaj';

const cookies = Object.values(jdCookieNode).filter(Boolean);
let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_BAITIAO_SIGN_DEBUG === '1';
}

function safeJsonParse(content, fallback = null) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function parseJrResponse(content) {
  const text = String(content || '').trim();
  if (!text) {
    return {};
  }

  const directData = safeJsonParse(text);
  if (directData) {
    return directData;
  }

  const decodedText = Buffer.from(text, 'base64').toString('utf8');
  return safeJsonParse(decodedText, { raw: text, decodedText });
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
    jsdomDeps = require('jsdom');
    return jsdomDeps;
  } finally {
    Module._load = originalLoad;
  }
}

function patchRiskWindow(window) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: DEFAULT_JR_USER_AGENT,
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
  window.console = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function getAar2Script() {
  if (!aar2ScriptPromise) {
    aar2ScriptPromise = got.get(AAR2_URL, {
      headers: {
        Referer: PAGE_URL,
        'User-Agent': DEFAULT_JR_USER_AGENT,
      },
      timeout: { request: REQUEST_TIMEOUT_MS },
    }).text();
  }

  return aar2ScriptPromise;
}

async function createAar2Context() {
  const { JSDOM, VirtualConsole } = loadJsdomDependencies();
  const aar2Script = await getAar2Script();
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: PAGE_URL,
    referrer: PAGE_URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    resources: 'usable',
    virtualConsole,
  });

  const { window } = dom;
  patchRiskWindow(window);
  window.eval(aar2Script);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AAR2 初始化超时')), RISK_TIMEOUT_MS);
    window.AAR2.init({
      callback(ok, payload) {
        clearTimeout(timer);
        if (ok === false) {
          reject(new Error(`AAR2 初始化失败：${stringifySnippet(payload, 300)}`));
          return;
        }
        resolve();
      },
    });
  });

  return { dom, window };
}

function createCookie(cookie) {
  return mergeCookieString(cookie, process.env.JD_BAITIAO_EXTRA_COOKIE || '');
}

function createHeaders(cookie) {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: 'https://mcr.jd.com',
    Referer: PAGE_URL,
    'User-Agent': DEFAULT_JR_USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-mlaas-at': process.env.JD_BAITIAO_X_MLAAS_AT || DEFAULT_X_MLAAS_AT,
    'sgm-context': process.env.JD_BAITIAO_SGM_CONTEXT || DEFAULT_SGM_CONTEXT,
  };
}

function buildRequestData(aar2Context) {
  const signPayload = {
    activityId: process.env.JD_BAITIAO_ACTIVITY_ID || DEFAULT_ACTIVITY_ID,
    channelCode: 0,
    domain: 'mcr.jd.com',
    source: '',
    appType: '2',
    reportflag: true,
  };
  const signData = JSON.stringify(signPayload);
  const aar2 = new aar2Context.window.AAR2();
  const nonce = aar2.nonce();
  const signature = String(aar2.sign(signData, nonce) || '').toUpperCase();

  return {
    environment: '2',
    riskInfo: {
      appType: 1,
      jsToken: process.env.JD_BAITIAO_JS_TOKEN || DEFAULT_JS_TOKEN,
      fp: process.env.JD_BAITIAO_FP || DEFAULT_FP,
      sdkToken: process.env.JD_BAITIAO_SDK_TOKEN || DEFAULT_SDK_TOKEN,
      qdPageId: 'X636',
      mdClickId: 'sy-an',
      pageUrl: PAGE_URL,
      urlKey: PAGE_URL,
    },
    signData,
    ...signPayload,
    nonce,
    signature,
    version: 'B',
    flowSouce: '001',
  };
}

function readSignResult(responseData) {
  const data = responseData?.resultData?.data || {};
  const award = data.awardInfoRes || {};

  return {
    success: Boolean(data.signSuccess || data.awardSuccess),
    message: responseData?.resultData?.message || responseData?.resultMsg || '未知结果',
    awardName: award.awardName || '',
    awardAmount: award.awardAmount || '',
    awardDesc: award.awardDesc || '',
  };
}

async function sign(cookie, aar2Context) {
  const requestData = buildRequestData(aar2Context);
  const response = await got.post(SIGN_URL, {
    body: `reqData=${encodeURIComponent(JSON.stringify(requestData))}`,
    headers: createHeaders(createCookie(cookie)),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  const responseData = parseJrResponse(response.body);
  if (isDebugEnabled()) {
    console.log(`白条签到原始响应: ${stringifySnippet(responseData, 1200)}`);
  }

  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}: ${stringifySnippet(response.body, 300)}`);
  }

  return readSignResult(responseData);
}

async function runForAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  let aar2Context = null;

  try {
    aar2Context = await createAar2Context();
    const result = await sign(cookie, aar2Context);
    if (result.success) {
      const awardText = result.awardName
        ? `${result.awardName}${result.awardAmount ? ` ${result.awardAmount}` : ''}`
        : result.message;
      return `${prefix}: 签到成功，${awardText}`;
    }

    return `${prefix}: 签到失败，${result.message}`;
  } catch (error) {
    return `${prefix}: 执行异常，${error.message || error}`;
  } finally {
    if (aar2Context?.dom?.window) {
      aar2Context.dom.window.close();
    }
  }
}

(async () => {
  if (!cookies.length) {
    $.log('未配置 JD_COOKIE');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    const message = await runForAccount(cookies[index], index + 1);
    $.log(message);
  }
})()
  .catch((error) => {
    $.log(`脚本异常：${error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
