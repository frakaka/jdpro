/*
cron:28 0 * * * jd_jr_saving_center_task.js

环境变量说明：
1. JDJR_SAVING_CENTER_DEBUG
   含义：是否打印关键接口原始返回片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。

2. JDJR_SAVING_CENTER_FULL_COOKIE
   含义：省钱中心活动页完整 Cookie，优先用于任务页和接任务接口，补齐 sdtoken、qid、sgm 等页面态。
   是否必须：否，默认使用 JD_COOKIE 与 gias 动态补齐后的 Cookie。

3. JDJR_SAVING_CENTER_MISSION_ID
   含义：手工指定单个任务 missionId；不配置时脚本按任务页动态扫描浏览类任务。
   是否必须：否，默认不指定。

4. JDJR_SAVING_CENTER_FP / JDJR_SAVING_CENTER_SDK_TOKEN / JDJR_SAVING_CENTER_EID / JDJR_SAVING_CENTER_JS_TOKEN
   含义：省钱中心请求里的设备风控参数。
   是否必须：否，默认优先使用 gias 动态结果，其次回退到当前 HAR 抓包值。

5. JDJR_SAVING_CENTER_TASK_LIMIT
   含义：单次最多执行多少个浏览任务。
   是否必须：否，默认不限制。
*/

'use strict';

const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_JR_USER_AGENT,
  buildHeaders,
  getGiasRiskContext,
  getUserName,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('省钱中心赚京豆');

const cookies = Object.values(jdCookieNode).filter(Boolean);

const USER_AGENT = DEFAULT_JR_USER_AGENT;
const WIDGET_USER_AGENT = 'JDJRMobile_Widget/618 CFNetwork/3860.300.31 Darwin/25.2.0';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const PUBLIC_KEY_URL = 'https://ms.jr.jd.com/gw/generic/getRSAPublicKey';
const CRYPTICO_URL = 'https://libs.jd.com/vendors/jrsecstatic.jdpay.com/jr-sec-dev-static/cryptico.min.js';

const RISK_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;
const RECEIVE_WAIT_MS = 1500;
const BROWSE_WAIT_MS = 10000;

const MEMBER_PAGE_URL = 'https://member.jr.jd.com/member/coinQuest/coin/';
const MEMBER_PAGE_ORIGIN = 'https://member.jr.jd.com';
const MEMBER_PAGE_REFERER = 'https://member.jr.jd.com/';

const TASK_PAGE_URL = 'https://ms.jr.jd.com/gw2/generic/legogw/h5/m/getPageInfoSafetyTranslate?pageType=11189';
const RECEIVE_MISSION_URL = 'https://ms.jr.jd.com/gw2/generic/mission/newh5/m/receiveMissionForNa';
const JUMP_INFO_URL = 'https://ms.jr.jd.com/gw2/generic/mission/h5/m/getJumpInfo';
const QUERY_READ_MISSION_EXT_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/queryReadMissionExtV3';
const START_READ_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/startReadMissionV3';
const FINISH_READ_AWARD_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/finishReadAndAwardV3';
const FINISH_READ_URL = 'https://ms.jr.jd.com/gw/generic/mission/h5/m/finishReadMission';
const FIND_READ_MISSION_STATUS_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/findReadMissionStatusV3';
const TEMPLATE_PAGE_URL = 'https://ms.jr.jd.com/gw2/generic/legogw/newna/m/getPageInfo?pageId=11129';
const MULTI_PAGE_URL = 'https://ms.jr.jd.com/gw2/generic/cf/newna/m/getNewPageMultiData?choiseTemplate=CREDIT1';
const RELEASE_DATA_URL = 'https://ms.jr.jd.com/gw/generic/app/newna/m/getReleaseData';

const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN = 'jdd01EYPTDC4JJOP4V6G54UFBKTIV7JHWK2GV7ILVE3BACLTOY3GJXDTR3ZWCCTQPGWW47ADZVEHYN2NGIV3TX33GDJO34RQARXG3XLG2TUQ01234567';
const TEMPLATE_CHOICES = ['YXYZ', 'QY', 'SQSP'];

let jsdomDeps = null;
let aar2ScriptPromise = null;
let crypticoApiPromise = null;
let rsaPublicKeyPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_SAVING_CENTER_DEBUG === '1';
}

function debugLog(accountLabel, title, value) {
  if (!isDebugEnabled()) {
    return;
  }
  console.log(`${accountLabel}: ${title} => ${stringifySnippet(value, 1200)}`);
}

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
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
    value() {
      return {
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
        getParameter() {
          return 1;
        },
        getExtension() {
          return null;
        },
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
}

function patchLandingPageWindow(window, context) {
  const { requestLog, cookie, userAgent } = context;

  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
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

  window.scrollTo = () => {};
  window.scrollBy = () => {};
  window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 16);
  window.cancelAnimationFrame = (timerId) => clearTimeout(timerId);
  window.alert = () => {};
  window.confirm = () => true;
  window.Headers = global.Headers;
  window.Request = global.Request;
  window.Response = global.Response;

  if (window.performance) {
    window.performance.mark = () => {};
    window.performance.measure = () => {};
    window.performance.getEntriesByType = () => [];
  }

  Object.defineProperty(window.HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value() {
      return 'data:image/png;base64,AA==';
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value() {
      return {
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
        getParameter() {
          return 1;
        },
        getExtension() {
          return null;
        },
      };
    },
  });

  const originalOpen = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__method = method;
    this.__url = url;
    requestLog.push({
      type: 'xhr_open',
      method,
      url: String(url || ''),
    });
    return originalOpen.apply(this, arguments);
  };
  window.XMLHttpRequest.prototype.send = function patchedSend(body) {
    requestLog.push({
      type: 'xhr_send',
      method: this.__method || '',
      url: String(this.__url || ''),
      bodyLength: typeof body === 'string' ? body.length : 0,
    });
    return originalSend.apply(this, arguments);
  };

  window.navigator.sendBeacon = (targetUrl, data) => {
    const body = typeof data === 'string' ? data : '';
    requestLog.push({
      type: 'beacon',
      method: 'POST',
      url: String(targetUrl || ''),
      bodyLength: body.length,
    });

    got
      .post(String(targetUrl || ''), {
        body,
        headers: buildHeaders(cookie, {
          origin: window.location.origin,
          referer: window.location.href,
          userAgent,
          contentType: 'text/plain;charset=UTF-8',
        }),
        throwHttpErrors: false,
        timeout: {
          request: REQUEST_TIMEOUT_MS,
        },
      })
      .catch(() => {});
    return true;
  };

  if (typeof global.fetch === 'function') {
    window.fetch = (input, init = {}) => {
      const requestUrl = typeof input === 'string' ? input : input?.url || '';
      const requestMethod =
        init.method
        || (typeof input !== 'string' && input?.method)
        || 'GET';
      requestLog.push({
        type: 'fetch',
        method: requestMethod,
        url: String(requestUrl || ''),
      });

      const headers = new global.Headers(init.headers || (typeof input !== 'string' && input?.headers) || {});
      if (!headers.has('user-agent')) {
        headers.set('user-agent', userAgent);
      }
      if (!headers.has('cookie')) {
        headers.set('cookie', cookie);
      }
      if (!headers.has('referer')) {
        headers.set('referer', window.location.href);
      }
      if (!headers.has('origin')) {
        headers.set('origin', window.location.origin);
      }

      return global.fetch(input, {
        ...init,
        headers,
      });
    };
  }

  const captureRedirect = (targetUrl) => {
    try {
      const resolvedUrl = new URL(String(targetUrl || ''), window.location.href).toString();
      context.redirectUrl = resolvedUrl;
      requestLog.push({
        type: 'redirect',
        method: 'NAVIGATE',
        url: resolvedUrl,
      });
    } catch (error) {
    }
  };

  try {
    window.location.replace = (targetUrl) => captureRedirect(targetUrl);
    window.location.assign = (targetUrl) => captureRedirect(targetUrl);
  } catch (error) {
  }
}

function createLandingPageCookieJar(cookie, pageUrl) {
  const { CookieJar } = loadJsdomDependencies();
  const jar = new CookieJar();
  const cookieMap = parseCookieString(cookie);
  const targetUrls = [
    pageUrl,
    'https://api.m.jd.com/',
    'https://cactus.jd.com/',
    'https://jdqd.jd.com/',
    'https://jra.jd.com/',
    'https://sgm-himalayas.jd.com/',
    'https://uranus.jd.com/',
    'https://ms.jr.jd.com/',
    'https://member.jr.jd.com/',
  ];

  for (const [key, value] of cookieMap.entries()) {
    for (const targetUrl of targetUrls) {
      try {
        jar.setCookieSync(`${key}=${value}; Path=/`, targetUrl);
      } catch (error) {
      }
    }
  }

  return jar;
}

function getFullCookie(cookie) {
  const fullCookie = process.env.JDJR_SAVING_CENTER_FULL_COOKIE || '';
  return fullCookie ? mergeCookieString(fullCookie, cookie) : cookie;
}

async function getAar2Script() {
  if (!aar2ScriptPromise) {
    aar2ScriptPromise = got.get(AAR2_URL, {
      headers: {
        Referer: MEMBER_PAGE_URL,
        'User-Agent': USER_AGENT,
      },
      timeout: {
        request: RISK_TIMEOUT_MS,
      },
    }).text();
  }
  return aar2ScriptPromise;
}

async function createRiskContext(cookie) {
  const { JSDOM, VirtualConsole } = loadJsdomDependencies();
  const mergedCookie = getFullCookie(cookie);
  const aar2Script = await getAar2Script();
  let giasContext = null;

  try {
    giasContext = await getGiasRiskContext(mergedCookie, {
      pageUrl: MEMBER_PAGE_URL,
      bizId: 'member',
      userAgent: USER_AGENT,
    });
  } catch (error) {
    giasContext = {
      jsToken: getCookieValue(mergedCookie, '3AB9D23F7A4B3CSS') || '',
      equipmentId: getCookieValue(mergedCookie, '3AB9D23F7A4B3C9B') || getCookieValue(mergedCookie, 'equipmentId') || '',
      cookie: mergedCookie,
    };
  }

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: MEMBER_PAGE_URL,
    referrer: MEMBER_PAGE_URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    resources: 'usable',
    virtualConsole,
  });

  try {
    const { window } = dom;
    patchRiskWindow(window);

    const cookieMap = parseCookieString(giasContext.cookie);
    for (const [key, value] of cookieMap.entries()) {
      window.document.cookie = `${key}=${value}; path=/`;
    }

    window.eval(aar2Script);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AAR2 初始化超时')), RISK_TIMEOUT_MS);
      window.AAR2.init({
        callback() {
          clearTimeout(timer);
          resolve();
        },
      });
    });

    return {
      dom,
      window,
      cookie: giasContext.cookie,
      jsToken: giasContext.jsToken,
      equipmentId: giasContext.equipmentId,
    };
  } catch (error) {
    dom.window.close();
    throw error;
  }
}

function closeRiskContext(riskContext) {
  try {
    riskContext?.dom?.window?.close();
  } catch (error) {
  }
}

function buildRiskMap(cookie, riskContext) {
  return {
    jsToken: process.env.JDJR_SAVING_CENTER_JS_TOKEN || riskContext.jsToken || '',
    fp: process.env.JDJR_SAVING_CENTER_FP || getCookieValue(cookie, 'fingerprint') || DEFAULT_FP,
    sdkToken:
      process.env.JDJR_SAVING_CENTER_SDK_TOKEN ||
      getCookieValue(cookie, 'token') ||
      DEFAULT_SDK_TOKEN,
    eid:
      process.env.JDJR_SAVING_CENTER_EID ||
      getCookieValue(cookie, 'equipmentId') ||
      riskContext.equipmentId ||
      getCookieValue(cookie, '3AB9D23F7A4B3C9B') ||
      '',
  };
}

function signWithAar2(riskContext, signText) {
  const aar2 = new riskContext.window.AAR2();
  const nonce = aar2.nonce();
  return {
    nonce,
    signature: aar2.sign(signText, nonce),
  };
}

async function getCrypticoApi() {
  if (!crypticoApiPromise) {
    crypticoApiPromise = got
      .get(CRYPTICO_URL, {
        timeout: {
          request: REQUEST_TIMEOUT_MS,
        },
      })
      .text()
      .then((scriptContent) => {
        const localStorageStore = new Map();
        const documentObject = {};
        Object.defineProperty(documentObject, 'cookie', {
          get() {
            return '';
          },
          set() {
            return true;
          },
        });

        const loadCryptico = new Function(
          'localStorageStore',
          'documentObject',
          `var window=this;var self=window;var globalThis=window;var global=window;var navigator={userAgent:${JSON.stringify(USER_AGENT)},appName:"Netscape",appVersion:"5"};var localStorage={getItem:function(key){return localStorageStore.has(key)?localStorageStore.get(key):null;},setItem:function(key,value){localStorageStore.set(key,String(value));},removeItem:function(key){localStorageStore.delete(key);}};var document=documentObject;var aesjs=null;${scriptContent};aesjs=window.aesjs||globalThis.aesjs||aesjs;return cryptico;`,
        );
        return loadCryptico.call({}, localStorageStore, documentObject);
      });
  }

  return crypticoApiPromise;
}

async function getRsaPublicKey() {
  if (!rsaPublicKeyPromise) {
    rsaPublicKeyPromise = got
      .get(PUBLIC_KEY_URL, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: MEMBER_PAGE_REFERER,
          'User-Agent': USER_AGENT,
        },
        timeout: {
          request: REQUEST_TIMEOUT_MS,
        },
      })
      .json()
      .then((response) => {
        const rawPublicKey = response?.resultData?.publicKey;
        if (!rawPublicKey) {
          throw new Error('未获取到京东金融公钥');
        }
        return JSON.parse(rawPublicKey);
      });
  }

  return rsaPublicKeyPromise;
}

async function encryptBusinessData(data) {
  const [cryptico, publicKey] = await Promise.all([getCrypticoApi(), getRsaPublicKey()]);
  cryptico.setPublicKeyString(JSON.stringify(publicKey));
  const encrypted = cryptico.encryptData(JSON.stringify(data));
  if (!encrypted?.status || !encrypted.ciphertext) {
    throw new Error(`京东金融 bodyEncrypt 生成失败: ${JSON.stringify(encrypted)}`);
  }
  return encrypted.ciphertext;
}

async function postForm(url, cookie, options = {}) {
  const {
    form,
    origin = MEMBER_PAGE_ORIGIN,
    referer = MEMBER_PAGE_REFERER,
    contentType = 'application/x-www-form-urlencoded;charset=UTF-8',
    userAgent = USER_AGENT,
    extraHeaders = {},
  } = options;

  const response = await got.post(url, {
    body: typeof form === 'string' ? form : new URLSearchParams(form).toString(),
    headers: buildHeaders(cookie, {
      origin,
      referer,
      userAgent,
      contentType,
      extraHeaders,
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function postJson(url, cookie, options = {}) {
  const {
    body,
    origin = MEMBER_PAGE_ORIGIN,
    referer = MEMBER_PAGE_REFERER,
    contentType = 'application/json; charset=UTF-8',
    userAgent = WIDGET_USER_AGENT,
    extraHeaders = {},
  } = options;

  const response = await got.post(url, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: buildHeaders(cookie, {
      origin,
      referer,
      userAgent,
      contentType,
      extraHeaders,
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

function buildTraceHeaders() {
  const traceId = `${Date.now()}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  return {
    'x-mlaas-at': `wl=0&id=${traceId}&src=sgm-mobile`,
    'sgm-context': `${traceId};${traceId};false;9HwAEg@vlKkp7SqT8dSSBaj`,
    'x-rp-client': 'h5_1.0.0',
    Priority: 'u=3, i',
  };
}

async function getTaskPageInfo(cookie, riskContext) {
  const riskMap = buildRiskMap(cookie, riskContext);
  const signData = {
    sdkToken: riskMap.sdkToken,
  };
  const signText = JSON.stringify(signData);
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const reqData = {
    clientVersion: '8.1.70',
    clientType: 'ios',
    pageType: 11189,
    pageId: 11189,
    ctp: 11189,
    pageNum: -1,
    buildCodes: ['common', 'topData', 'float', 'tag'],
    extParams: {
      channelCode: 'inside',
      signData,
      sdkToken: riskMap.sdkToken,
      nonce,
      signature,
      deviceInfos: JSON.stringify(signData),
      riskQdPageId: 'gainJDbean',
      riskQdPageName: '赚京豆任务列表页',
      aarVersion: '2',
      osVersion: '26.2',
      itemIds: [],
      pageName: 'pageCoinQuest',
      clientEnv: '2',
      jumpSource: '001',
      abTest: '',
      schemaList: ['didapinche://', 'yylive://', 'sjwb://browser', 'snssdk141://', 'wkbrowser://'],
      platformFlag: '2',
      sourceVersion: '62',
      reqSource: '0',
      dynamicReq: true,
      pageUrl: 'https:member.jr.jd.com/member/coinQuest/coin/',
      urlKey: '/member/coinQuest/coin/',
      clientName: 'web',
    },
  };

  return postForm(TASK_PAGE_URL, cookie, {
    form: {
      reqData: JSON.stringify(reqData),
    },
    extraHeaders: buildTraceHeaders(),
  });
}

function extractTaskItems(pageData) {
  const items = [];

  function walk(node) {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.missionId && node.title?.text) {
      items.push(node);
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(pageData);
  return items;
}

function extractBeanTasks(pageData) {
  const taskMap = new Map();
  const items = extractTaskItems(pageData);

  for (const item of items) {
    const title = item.title?.text || '';
    const subTitle = item.subTitle?.text || '';
    const awardText = item.awardNumber?.text || '';
    const channelCode = item.channelCode || '';
    const beanRelated = title.includes('京豆')
      || subTitle.includes('京豆')
      || awardText.includes('京豆')
      || awardText.includes('+1')
      || awardText.includes('+2');

    if (!beanRelated) {
      continue;
    }

    const key = `${item.missionId}_${channelCode}`;
    if (!taskMap.has(key)) {
      taskMap.set(key, {
        missionId: String(item.missionId),
        channelCode,
        title,
        subTitle,
        status: Number(item.status),
        topFlag: Boolean(item.topFlag),
        missionType: Number(item.missionType),
        receivingStatus: Number(item.receivingStatus),
        jumpUrl: item.button?.jumpData?.jumpUrl || '',
        buttonText: item.button?.text || '',
      });
    }
  }

  return Array.from(taskMap.values());
}

function isBrowseTask(task) {
  if (!task?.missionId || !task?.jumpUrl) {
    return false;
  }

  if ([2, 3].includes(Number(task.status))) {
    return false;
  }

  const title = String(task.title || '');
  const subTitle = String(task.subTitle || '');
  const jumpUrl = String(task.jumpUrl || '');
  const buttonText = String(task.buttonText || '');
  if (buttonText.includes('已完成') || buttonText.includes('已领取')) {
    return false;
  }

  return jumpUrl.includes('jumpmission-v2')
    || jumpUrl.includes('readTime=10')
    || title.includes('逛')
    || title.includes('浏览')
    || subTitle.includes('浏览')
    || subTitle.includes('完成任务');
}

function getRewardMessage(pageData) {
  const topData = pageData?.topData || {};
  for (const value of Object.values(topData)) {
    if (value && typeof value === 'object' && value.rewardMsg) {
      return String(value.rewardMsg);
    }
  }
  return '';
}

function parseReadMissionFromUrl(targetUrl) {
  try {
    const parsedUrl = new URL(String(targetUrl || ''));
    const missionId = parsedUrl.searchParams.get('missionId') || '';
    const channelCode = parsedUrl.searchParams.get('channelCode') || '';
    const readTime = Number(parsedUrl.searchParams.get('readTime') || 0);

    if (!missionId || !channelCode || readTime <= 0) {
      return null;
    }

    return {
      missionId,
      channelCode,
      readTime,
      sourceUrl: parsedUrl.toString(),
    };
  } catch (error) {
    return null;
  }
}

function resolvePageContext(pageUrl) {
  try {
    const parsedUrl = new URL(String(pageUrl || MEMBER_PAGE_REFERER));
    return {
      origin: parsedUrl.origin,
      referer: parsedUrl.toString(),
    };
  } catch (error) {
    return {
      origin: MEMBER_PAGE_ORIGIN,
      referer: MEMBER_PAGE_REFERER,
    };
  }
}

function isJumpMissionPage(url) {
  return String(url || '').includes('jumpmission-v2');
}

function resolveNativeJumpUrl(rawJumpUrl) {
  const text = String(rawJumpUrl || '');
  if (!text.startsWith('openApp.jdMobile://')) {
    return text;
  }

  try {
    const parsed = new URL(text);
    const paramsText = parsed.searchParams.get('params') || '';
    if (!paramsText) {
      return text;
    }

    const params = safeJsonParse(paramsText, {});
    if (params && typeof params === 'object' && params.url) {
      return String(params.url);
    }
  } catch (error) {
  }

  return text;
}

async function getJumpMissionInfo(cookie, riskContext, jumpMissionUrl, requestLog = []) {
  let parsedUrl;
  try {
    parsedUrl = new URL(jumpMissionUrl);
  } catch (error) {
    return null;
  }

  const juid = parsedUrl.searchParams.get('juid') || '';
  if (!juid) {
    return null;
  }

  const signText = JSON.stringify({
    juid,
    PIN: getUserName(cookie),
  });
  const { nonce, signature } = signWithAar2(riskContext, signText);
  requestLog.push({
    type: 'jump_info_request',
    method: 'GET',
    url: `${JUMP_INFO_URL}?juid=${encodeURIComponent(juid)}`,
  });

  const response = await got.get(JUMP_INFO_URL, {
    searchParams: {
      juid,
      nonce,
      signature,
      jrAppVersion: '8.1.70',
      systemEnv: 'IOS',
    },
    headers: buildHeaders(cookie, {
      origin: 'https://show.jd.com',
      referer: jumpMissionUrl,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: 'application/json, text/plain, */*',
        ...buildTraceHeaders(),
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const responseBody = response.body ? safeJsonParse(response.body, response.body) : {};
  const resultData = responseBody?.resultData || {};
  requestLog.push({
    type: 'jump_info_result',
    method: 'GET',
    url: JUMP_INFO_URL,
    code: resultData.code || '',
  });

  if (String(resultData.code || '') !== '0000') {
    return {
      code: resultData.code || '',
      message: resultData.msg || '',
      data: null,
    };
  }

  return {
    code: resultData.code || '',
    message: resultData.msg || '',
    data: resultData.data || {},
  };
}

async function requestJumpMissionTracking(cookie, refererUrl, trackingUrl, requestLog) {
  if (!trackingUrl) {
    return;
  }

  requestLog.push({
    type: 'jump_tracking_request',
    method: 'GET',
    url: trackingUrl,
  });

  try {
    const response = await got.get(trackingUrl, {
      headers: buildHeaders(cookie, {
        origin: new URL(refererUrl).origin,
        referer: refererUrl,
        userAgent: USER_AGENT,
        contentType: '',
        extraHeaders: {
          Accept: '*/*',
        },
      }),
      followRedirect: true,
      throwHttpErrors: false,
      timeout: {
        request: REQUEST_TIMEOUT_MS,
      },
    });

    requestLog.push({
      type: 'jump_tracking_result',
      method: 'GET',
      url: trackingUrl,
      statusCode: response.statusCode,
    });
  } catch (error) {
    requestLog.push({
      type: 'jump_tracking_error',
      method: 'GET',
      url: trackingUrl,
    });
  }
}

async function simulateJumpMissionVisit(cookie, riskContext, jumpUrl, waitMs, depth) {
  const requestLog = [
    {
      type: 'jumpmission_open',
      method: 'GET',
      url: jumpUrl,
    },
  ];

  const jumpInfo = await getJumpMissionInfo(cookie, riskContext, jumpUrl, requestLog);
  if (!jumpInfo?.data) {
    await sleep(waitMs);
    return {
      statusCode: 200,
      finalUrl: jumpUrl,
      requestLog,
    };
  }

  const jumpData = jumpInfo.data;
  await requestJumpMissionTracking(cookie, jumpUrl, jumpData.exposalUrl, requestLog);
  await requestJumpMissionTracking(cookie, jumpUrl, jumpData.clickUrl, requestLog);

  const resolvedJumpUrl = resolveNativeJumpUrl(jumpData.jumpUrl);
  if (!resolvedJumpUrl) {
    await sleep(waitMs);
    return {
      statusCode: 200,
      finalUrl: jumpUrl,
      requestLog,
    };
  }

  requestLog.push({
    type: 'jumpmission_target',
    method: 'NAVIGATE',
    url: resolvedJumpUrl,
  });

  const targetResult = await simulateLandingPageVisit(cookie, resolvedJumpUrl, waitMs, depth + 1, riskContext);
  return {
    statusCode: targetResult.statusCode,
    finalUrl: targetResult.finalUrl,
    requestLog: requestLog.concat(targetResult.requestLog),
  };
}

async function finishReadMissionTask(cookie, riskContext, readMission) {
  const pageContext = resolvePageContext(readMission.sourceUrl);
  const signText = JSON.stringify({
    missionId: String(readMission.missionId),
    readTime: String(readMission.readTime),
    PIN: getUserName(cookie),
  });
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const finishPayload = {
    missionId: String(readMission.missionId),
    readTime: Number(readMission.readTime),
    nonce,
    signature,
    version: '1.1.0',
    token: 'EaGIdTGDdn',
    appId: 'jrmission',
    channelCode: String(readMission.channelCode),
  };

  const finishAwardResponse = await got.post(FINISH_READ_AWARD_URL, {
    body: JSON.stringify(finishPayload),
    headers: buildHeaders(cookie, {
      origin: pageContext.origin,
      referer: pageContext.referer,
      userAgent: USER_AGENT,
      contentType: 'application/json',
      extraHeaders: buildTraceHeaders(),
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });
  const finishAwardBody = finishAwardResponse.body
    ? safeJsonParse(finishAwardResponse.body, finishAwardResponse.body)
    : {};
  const finishAwardCode = finishAwardBody?.resultData?.code || finishAwardBody?.code || '';
  if (String(finishAwardCode) === '0000') {
    return finishAwardBody;
  }

  const plainPayload = {
    missionId: String(readMission.missionId),
    readTime: Number(readMission.readTime),
    nonce,
    signature,
    version: '1.1.0',
    channelCode: String(readMission.channelCode),
  };
  const finishResponse = await got.post(FINISH_READ_URL, {
    body: JSON.stringify(plainPayload),
    headers: buildHeaders(cookie, {
      origin: pageContext.origin,
      referer: pageContext.referer,
      userAgent: USER_AGENT,
      contentType: 'application/json',
      extraHeaders: buildTraceHeaders(),
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return finishResponse.body ? safeJsonParse(finishResponse.body, finishResponse.body) : {};
}

async function startReadMissionTask(cookie, riskContext, readMission) {
  const pageContext = resolvePageContext(readMission.sourceUrl);
  const signText = JSON.stringify({
    missionId: String(readMission.missionId),
    readTime: String(readMission.readTime),
    PIN: getUserName(cookie),
  });
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const startPayload = {
    missionId: String(readMission.missionId),
    readTime: Number(readMission.readTime),
    nonce,
    channelCode: String(readMission.channelCode),
    signature,
    version: '1.1.0',
    token: 'jBJHOIrRhm',
    appId: 'jrmission',
  };

  const response = await got.post(START_READ_URL, {
    body: JSON.stringify(startPayload),
    headers: buildHeaders(cookie, {
      origin: pageContext.origin,
      referer: pageContext.referer,
      userAgent: USER_AGENT,
      contentType: 'application/json',
      extraHeaders: buildTraceHeaders(),
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function queryReadMissionExtTask(cookie, riskContext, readMission) {
  const pageContext = resolvePageContext(readMission.sourceUrl);
  const pin = getUserName(cookie);
  const signData = JSON.stringify({
    missionId: String(readMission.missionId),
    PIN: pin,
  });
  const { nonce, signature } = signWithAar2(riskContext, signData);
  const payload = {
    missionId: String(readMission.missionId),
    channelCode: String(readMission.channelCode),
    nonce,
    signData,
    signature,
    version: '1.1.0',
    token: 'qHGBfJAypy',
    appId: 'jrmission',
  };

  const response = await got.post(QUERY_READ_MISSION_EXT_URL, {
    body: JSON.stringify(payload),
    headers: buildHeaders(cookie, {
      origin: pageContext.origin,
      referer: pageContext.referer,
      userAgent: USER_AGENT,
      contentType: 'application/json',
      extraHeaders: buildTraceHeaders(),
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function findReadMissionStatusTask(cookie, riskContext, readMission) {
  const pageContext = resolvePageContext(readMission.sourceUrl);
  const pin = getUserName(cookie);
  const signText = JSON.stringify({
    missionId: String(readMission.missionId),
    PIN: pin,
  });
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const payload = {
    missionId: String(readMission.missionId),
    readTime: Number(readMission.readTime),
    nonce,
    channelCode: String(readMission.channelCode),
    signature,
    version: '1.1.0',
    token: 'fUqIzmrFhU',
    appId: 'jrmission',
  };

  const response = await got.post(FIND_READ_MISSION_STATUS_URL, {
    body: JSON.stringify(payload),
    headers: buildHeaders(cookie, {
      origin: pageContext.origin,
      referer: pageContext.referer,
      userAgent: USER_AGENT,
      contentType: 'application/json',
      extraHeaders: buildTraceHeaders(),
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function receiveMission(cookie, riskContext, missionId, channelCode) {
  const riskMap = buildRiskMap(cookie, riskContext);
  const deviceInfo1 = {
    jsToken: riskMap.jsToken,
    fp: riskMap.fp,
    sdkToken: riskMap.sdkToken,
    eid: riskMap.eid,
    token: riskMap.sdkToken,
  };
  const signText = JSON.stringify(deviceInfo1);
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const reqData = {
    environment: '2',
    missionId: String(missionId),
    channelCode: String(channelCode || 'xjfrwzx'),
    nonce,
    signature,
    deviceInfo1,
    clientType: 'h5',
    clientVersion: '8.1.70',
  };

  return postForm(RECEIVE_MISSION_URL, cookie, {
    form: {
      reqData: JSON.stringify(reqData),
    },
    extraHeaders: buildTraceHeaders(),
  });
}

async function openTaskLandingPage(cookie, jumpUrl) {
  const response = await got.get(jumpUrl, {
    headers: buildHeaders(cookie, {
      origin: MEMBER_PAGE_ORIGIN,
      referer: MEMBER_PAGE_REFERER,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
    followRedirect: true,
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return {
    statusCode: response.statusCode,
    finalUrl: response.url,
  };
}

function summarizeLandingRequests(requestLog) {
  const interestingHosts = [
    'api.m.jd.com',
    'cactus.jd.com',
    'jdqd.jd.com',
    'ms.jr.jd.com',
    'ccc-x.jd.com',
    'sgm-himalayas.jd.com',
    'uranus.jd.com',
    'jra.jd.com',
  ];
  const summaryMap = new Map();

  for (const item of requestLog) {
    const rawUrl = String(item.url || '');
    if (!rawUrl.startsWith('http')) {
      continue;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch (error) {
      continue;
    }

    if (!interestingHosts.includes(parsedUrl.host)) {
      continue;
    }

    const summaryKey = `${item.method || 'GET'} ${parsedUrl.host}${parsedUrl.pathname}`;
    summaryMap.set(summaryKey, (summaryMap.get(summaryKey) || 0) + 1);
  }

  return Array.from(summaryMap.entries())
    .map(([key, count]) => `${key} x${count}`)
    .join(' || ');
}

async function simulateLandingPageVisit(cookie, jumpUrl, waitMs, depth = 0, riskContext = null) {
  if (isJumpMissionPage(jumpUrl) && riskContext && depth < 3) {
    return simulateJumpMissionVisit(cookie, riskContext, jumpUrl, waitMs, depth);
  }

  const response = await got.get(jumpUrl, {
    headers: buildHeaders(cookie, {
      origin: MEMBER_PAGE_ORIGIN,
      referer: MEMBER_PAGE_REFERER,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
    followRedirect: true,
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const finalUrl = response.url;
  const contentType = String(response.headers['content-type'] || '');
  const requestLog = [];
  const visitContext = {
    requestLog,
    cookie,
    userAgent: USER_AGENT,
    redirectUrl: '',
  };

  if (!contentType.includes('text/html')) {
    return {
      statusCode: response.statusCode,
      finalUrl,
      requestLog,
    };
  }

  const { JSDOM, ResourceLoader, VirtualConsole } = loadJsdomDependencies();
  const cookieJar = createLandingPageCookieJar(cookie, finalUrl);
  const virtualConsole = new VirtualConsole();
  const resourceLoader = new ResourceLoader({
    userAgent: USER_AGENT,
    strictSSL: false,
  });
  const dom = new JSDOM(response.body, {
    url: finalUrl,
    referrer: `${new URL(finalUrl).origin}/`,
    runScripts: 'dangerously',
    resources: resourceLoader,
    pretendToBeVisual: true,
    virtualConsole,
    cookieJar,
    beforeParse(window) {
      patchLandingPageWindow(window, visitContext);
    },
  });

  const startedAt = Date.now();
  try {
    await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve();
      }, 3000);

      dom.window.addEventListener('load', () => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          resolve();
        }
      });
    });

    await sleep(waitMs);
  } finally {
    dom.window.close();
  }

  const redirectedUrl = visitContext.redirectUrl;
  if (redirectedUrl && redirectedUrl !== finalUrl && depth < 3) {
    const spentMs = Date.now() - startedAt;
    const remainMs = Math.max(1000, waitMs - spentMs);
    const redirectedResult = await simulateLandingPageVisit(cookie, redirectedUrl, remainMs, depth + 1, riskContext);
    return {
      statusCode: redirectedResult.statusCode,
      finalUrl: redirectedResult.finalUrl,
      requestLog: requestLog.concat(redirectedResult.requestLog),
    };
  }

  return {
    statusCode: response.statusCode,
    finalUrl,
    requestLog,
  };
}

async function getEncryptedTemplatePage(cookie, riskContext, choiceTemplate) {
  const riskMap = buildRiskMap(cookie, riskContext);
  const plainData = {
    pageId: 11129,
    ctp: 11129,
    pageNum: -1,
    channelCode: 'inside',
    sdkToken: riskMap.sdkToken,
    pageName: 'pageCoinQuest',
    clientEnv: '2',
    jumpSource: '001',
    platformFlag: '2',
    sourceVersion: '62',
    reqSource: '0',
    pageUrl: 'https:member.jr.jd.com/member/coinQuest/coin/',
    urlKey: '/member/coinQuest/coin/',
    clientName: 'web',
  };

  const bodyEncrypt = await encryptBusinessData(plainData);
  return postJson(`${TEMPLATE_PAGE_URL}&choiseTemplate=${encodeURIComponent(choiceTemplate)}`, cookie, {
    body: {
      channelEncrypt: 1,
      bodyEncrypt,
    },
  });
}

async function getEncryptedMultiData(cookie, riskContext) {
  const riskMap = buildRiskMap(cookie, riskContext);
  const plainData = {
    pageId: 11129,
    channelCode: 'inside',
    sdkToken: riskMap.sdkToken,
    pageName: 'pageCoinQuest',
  };
  const bodyEncrypt = await encryptBusinessData(plainData);
  return postJson(MULTI_PAGE_URL, cookie, {
    body: {
      channelEncrypt: 1,
      bodyEncrypt,
    },
  });
}

async function getReleaseData(cookie, riskContext) {
  const riskMap = buildRiskMap(cookie, riskContext);
  const plainData = {
    pageId: 11129,
    sdkToken: riskMap.sdkToken,
    clientType: 'ios',
    clientVersion: '8.1.70',
  };
  const bodyEncrypt = await encryptBusinessData(plainData);
  return postJson(RELEASE_DATA_URL, cookie, {
    body: {
      channelEncrypt: 1,
      bodyEncrypt,
    },
    userAgent: 'JDJRMobile/8.1.70 (iPhone; iOS 26.2; Scale/3.00)',
    contentType: 'application/json;charset=UTF-8',
  });
}

function summarizeBeanTasks(tasks) {
  if (!tasks.length) {
    return '未识别到京豆相关任务';
  }

  return tasks
    .map((task) => `${task.title} | missionId=${task.missionId} | channel=${task.channelCode || '-'} | status=${task.status} | subTitle=${task.subTitle || '-'}`)
    .join(' || ');
}

function buildTaskKey(task) {
  return `${task.missionId}_${task.channelCode || ''}`;
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const accountLabel = `账号${index + 1} ${userName}`;
  const baseCookie = getFullCookie(cookie);
  let riskContext = null;

  try {
    console.log(`\n==== ${accountLabel} ====`);
    riskContext = await createRiskContext(baseCookie);
    const requestCookie = riskContext.cookie;

    const beforePage = await getTaskPageInfo(requestCookie, riskContext);
    const beforeData = beforePage?.resultData || {};
    const beforeRewardMessage = getRewardMessage(beforeData);
    const beanTasks = extractBeanTasks(beforeData);
    const directMissionId = process.env.JDJR_SAVING_CENTER_MISSION_ID || '';
    const browseTasks = directMissionId
      ? beanTasks.filter((task) => task.missionId === String(directMissionId))
      : beanTasks.filter(isBrowseTask);
    const taskLimit = Number(process.env.JDJR_SAVING_CENTER_TASK_LIMIT || 0);
    const targetTasks = taskLimit > 0 ? browseTasks.slice(0, taskLimit) : browseTasks;

    console.log(`${accountLabel}: 京豆任务摘要 => ${summarizeBeanTasks(beanTasks)}`);
    if (beforeRewardMessage) {
      console.log(`${accountLabel}: 当前奖励文案 => ${beforeRewardMessage}`);
    }
    console.log(`${accountLabel}: 待执行浏览任务数 => ${targetTasks.length}`);

    let lastRewardMessage = beforeRewardMessage;
    let currentTasks = beanTasks;
    const executedTasks = [];
    let completedBrowseCount = 0;
    for (const task of targetTasks) {
      console.log(`${accountLabel}: 尝试任务 => ${task.title} | missionId=${task.missionId} | channel=${task.channelCode} | jumpUrl=${task.jumpUrl}`);

      const receiveResult = await receiveMission(requestCookie, riskContext, task.missionId, task.channelCode);
      console.log(`${accountLabel}: receiveMissionForNa(${task.missionId}) => ${stringifySnippet(receiveResult, 300)}`);

      const receiveCode = receiveResult?.resultData?.code || receiveResult?.code || '';
      if (String(receiveCode) !== '0000') {
        continue;
      }

      const readMissionFromTask = parseReadMissionFromUrl(task.jumpUrl);
      const taskBrowseWaitMs = readMissionFromTask
        ? Math.max(BROWSE_WAIT_MS, (Number(readMissionFromTask.readTime) + 1) * 1000 + 500)
        : BROWSE_WAIT_MS;
      if (readMissionFromTask) {
        const extResult = await queryReadMissionExtTask(requestCookie, riskContext, readMissionFromTask);
        console.log(`${accountLabel}: queryReadMissionExt(${readMissionFromTask.missionId}) => ${stringifySnippet(extResult, 400)}`);
        const startResult = await startReadMissionTask(requestCookie, riskContext, readMissionFromTask);
        console.log(`${accountLabel}: startReadMission(${readMissionFromTask.missionId}) => ${stringifySnippet(startResult, 400)}`);
      }

      await sleep(RECEIVE_WAIT_MS);
      try {
        const openResult = await simulateLandingPageVisit(requestCookie, task.jumpUrl, taskBrowseWaitMs, 0, riskContext);
        console.log(`${accountLabel}: 打开落地页 => status=${openResult.statusCode} finalUrl=${openResult.finalUrl}`);
        const requestSummary = summarizeLandingRequests(openResult.requestLog);
        console.log(`${accountLabel}: 页内上报 => ${requestSummary || '未捕获到关键上报'}`);

        const readMission = parseReadMissionFromUrl(openResult.finalUrl) || parseReadMissionFromUrl(task.jumpUrl);
        if (readMission) {
          const pageScopedReadMission = {
            ...readMission,
            sourceUrl: openResult.finalUrl || readMission.sourceUrl,
          };
          const statusBeforeFinish = await findReadMissionStatusTask(requestCookie, riskContext, pageScopedReadMission);
          console.log(`${accountLabel}: findReadMissionStatus.before(${pageScopedReadMission.missionId}) => ${stringifySnippet(statusBeforeFinish, 400)}`);
          const finishResult = await finishReadMissionTask(requestCookie, riskContext, pageScopedReadMission);
          console.log(`${accountLabel}: finishReadMission(${pageScopedReadMission.missionId}) => ${stringifySnippet(finishResult, 400)}`);
          const statusAfterFinish = await findReadMissionStatusTask(requestCookie, riskContext, pageScopedReadMission);
          console.log(`${accountLabel}: findReadMissionStatus.after(${pageScopedReadMission.missionId}) => ${stringifySnippet(statusAfterFinish, 400)}`);
        }

        executedTasks.push(task);
        completedBrowseCount += 1;
      } catch (error) {
        console.log(`${accountLabel}: 落地页执行异常 => ${error.message}`);
        continue;
      }
    }

    console.log(`${accountLabel}: 已完成浏览任务数 => ${completedBrowseCount}`);

    const afterPage = await getTaskPageInfo(requestCookie, riskContext);
    const afterData = afterPage?.resultData || {};
    currentTasks = extractBeanTasks(afterData);
    lastRewardMessage = getRewardMessage(afterData);
    console.log(`${accountLabel}: 全量浏览后刷新一次任务页 => rewardMsg=${lastRewardMessage || '-'} | 剩余任务数=${currentTasks.length}`);

    const beforeTaskMap = new Map(beanTasks.map((task) => [buildTaskKey(task), task]));
    const afterTaskMap = new Map(currentTasks.map((task) => [buildTaskKey(task), task]));
    for (const task of executedTasks) {
      const taskKey = buildTaskKey(task);
      const beforeTask = beforeTaskMap.get(taskKey);
      const afterTask = afterTaskMap.get(taskKey);
      console.log(
        `${accountLabel}: 任务状态对比 => ${task.title} | before=${beforeTask?.status ?? '-'} | after=${afterTask?.status ?? '未找到'} | afterButton=${afterTask?.buttonText || '-'}`,
      );
    }

    console.log(`${accountLabel}: 最终奖励文案 => ${lastRewardMessage || '未出现'}`);
    console.log(`${accountLabel}: 最终京豆任务数 => ${currentTasks.length}`);

    if (isDebugEnabled()) {
      const [releaseData, multiData] = await Promise.all([
        getReleaseData(requestCookie, riskContext),
        getEncryptedMultiData(requestCookie, riskContext),
      ]);
      debugLog(accountLabel, 'getReleaseData', releaseData);
      debugLog(accountLabel, 'getNewPageMultiData(CREDIT1)', multiData);

      for (const choiceTemplate of TEMPLATE_CHOICES) {
        const templateResult = await getEncryptedTemplatePage(requestCookie, riskContext, choiceTemplate);
        debugLog(accountLabel, `getPageInfo(11129,${choiceTemplate})`, templateResult);
      }
    }
  } catch (error) {
    console.log(`${accountLabel}: 执行异常 => ${error.message}`);
  } finally {
    closeRiskContext(riskContext);
  }
}

async function main() {
  console.log(`共${cookies.length}个京东账号Cookie`);
  if (!cookies.length) {
    console.log('未找到有效的 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    await runAccount(cookies[index], index);
  }
}

main()
  .catch((error) => {
    console.log(`脚本异常 => ${error.message}`);
  })
  .finally(() => {
    $.done();
  });
