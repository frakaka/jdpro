'use strict';

const Module = require('module');
const got = require('got');

let userAgents = {};
try {
  userAgents = require('../USER_AGENTS');
} catch (error) {
  userAgents = {};
}

let h5stFactory = null;
let h5stShimInstalled = false;

const DEFAULT_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const DEFAULT_JR_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.70&HiClVersion=8.1.70&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR&stockSDK=stocksdk-iphone_6.0.0&sPoint=&jdPay=(*#@jdPaySDK*#@jdPayChannel=jdfinance&jdPayChannelVersion=8.1.70&jdPaySdkVersion=4.01.96.00&jdPayClientName=iOS*#@jdPaySDK*#@)';
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_GIAS_SCRIPT_URL = 'https://gias.jd.com/js/m-tk.js';
const DEFAULT_GIAS_PAGE_URL = 'https://pro.m.jd.com/';
const GIAS_TIMEOUT_MS = 10000;
const DEFAULT_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.5.js?v=2406';
const DEFAULT_BABEL_SECURITY_SCRIPT_URL = 'https://storage11.360buyimg.com/tower/babelnode/js/security.5e3cd16f.js';

const riskContextCache = new Map();
const giasScriptCache = new Map();
const jsSecurityScriptCache = new Map();
const jsSecuritySignerCache = new Map();
const babelSecurityRuntimeCache = new Map();
let jsdomDeps = null;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUserName(cookie) {
  const cookieMap = parseCookieString(cookie);
  for (const key of ['pt_pin', 'pin', '_pst']) {
    const value = cookieMap.get(key);
    if (value) {
      return decodeURIComponent(value);
    }
  }
  return '未知账号';
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = String(cookie || '').match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
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
  const extraCookieMap = typeof extraCookieValues === 'string'
    ? parseCookieString(extraCookieValues)
    : new Map(Object.entries(extraCookieValues || {}));

  for (const [key, value] of extraCookieMap.entries()) {
    if (!key || !value) {
      continue;
    }
    cookieMap.set(key, value);
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

  for (const key of ['mba_muid', '__jdu', 'pt_pin']) {
    const value = getCookieValue(cookie, key);
    if (value) {
      return value;
    }
  }

  return String(Date.now());
}

function getUserAgent(fallback = DEFAULT_USER_AGENT) {
  try {
    if (typeof userAgents.UARAM === 'function') {
      return userAgents.UARAM();
    }
    if (userAgents.USER_AGENT) {
      return userAgents.USER_AGENT;
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function safeJsonParse(content, fallback = null) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function stringifySnippet(value, maxLength = 800) {
  let content;
  try {
    content = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    content = String(value);
  }
  return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
}

function appendFormValue(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.set(key, String(value));
  }
}

function parseApiResponse(response) {
  const responseText = (response.body || '').trim();
  const httpStatus = response.statusCode;

  if (!responseText) {
    return {
      success: false,
      httpStatus,
      message: httpStatus >= 400 ? `HTTP ${httpStatus}` : '空响应',
    };
  }

  if (httpStatus >= 400) {
    return {
      success: false,
      httpStatus,
      message: `HTTP ${httpStatus}`,
      responseSnippet: stringifySnippet(responseText),
    };
  }

  return safeJsonParse(responseText, responseText);
}

function formatDate(date, pattern) {
  const current = date instanceof Date ? date : new Date(date);
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return String(pattern)
    .replace('yyyy', String(current.getFullYear()))
    .replace('MM', pad(current.getMonth() + 1))
    .replace('dd', pad(current.getDate()))
    .replace('HH', pad(current.getHours()))
    .replace('mm', pad(current.getMinutes()))
    .replace('ss', pad(current.getSeconds()))
    .replace('SSS', pad(current.getMilliseconds(), 3));
}

function installDateFnsShim() {
  if (h5stShimInstalled) {
    return;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'date-fns') {
      return { format: formatDate };
    }
    return originalLoad.apply(this, arguments);
  };
  h5stShimInstalled = true;
}

function getH5stFactory() {
  if (h5stFactory) {
    return h5stFactory;
  }

  installDateFnsShim();
  h5stFactory = require('./h5st41.js');
  return h5stFactory;
}

async function createH5st(options) {
  const {
    functionId,
    body,
    h5stAppId,
    requestAppid,
    cookie,
    userAgent = DEFAULT_USER_AGENT,
    client = 'wh5',
    clientVersion = '1.0.0',
    version = '5.3',
  } = options;

  const H5ST = getH5stFactory();
  const signer = new H5ST({
    appId: h5stAppId,
    appid: requestAppid,
    client,
    clientVersion,
    pin: getUserName(cookie),
    ua: userAgent,
    version,
  });

  await signer.genAlgo();
  const query = await signer.genUrlParams(functionId, body || {}, true);
  return new URLSearchParams(query).get('h5st') || '';
}

async function getJsSecurityScript(scriptUrl, options = {}) {
  const {
    referer = 'https://laputa.jd.com/',
    userAgent = DEFAULT_JR_USER_AGENT,
  } = options;

  if (jsSecurityScriptCache.has(scriptUrl)) {
    return jsSecurityScriptCache.get(scriptUrl);
  }

  const response = await got.get(scriptUrl, {
    headers: {
      Referer: referer,
      'User-Agent': userAgent,
    },
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const scriptSource = response.body || '';
  if (!scriptSource || response.statusCode >= 400) {
    throw new Error(`js_security 脚本加载失败：HTTP ${response.statusCode}`);
  }

  jsSecurityScriptCache.set(scriptUrl, scriptSource);
  return scriptSource;
}

function createNodeXmlHttpRequest(window, options = {}) {
  const {
    cookie = '',
    userAgent = DEFAULT_JR_USER_AGENT,
  } = options;

  return class NodeXmlHttpRequest {
    constructor() {
      this.headers = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.response = '';
    }

    open(method, url) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }

    setRequestHeader(key, value) {
      this.headers[key] = value;
    }

    getAllResponseHeaders() {
      return '';
    }

    getResponseHeader() {
      return null;
    }

    async send(body) {
      try {
        const requestMethod = String(this.method || 'GET').toUpperCase();
        const requestUrl = new URL(this.url, window.location.href).toString();
        const requestOptions = {
          method: requestMethod,
          headers: {
            ...this.headers,
            Cookie: cookie,
            Origin: window.location.origin,
            Referer: window.location.href,
            'User-Agent': userAgent,
          },
          throwHttpErrors: false,
          timeout: { request: REQUEST_TIMEOUT_MS },
        };
        if (!['GET', 'HEAD'].includes(requestMethod) && body) {
          requestOptions.body = body;
        }
        const response = await got(requestUrl, {
          ...requestOptions,
        });
        this.status = response.statusCode;
        this.responseText = response.body || '';
        this.response = this.responseText;
      } catch (error) {
        this.status = 0;
        this.responseText = '';
        this.response = '';
        if (typeof this.onerror === 'function') {
          this.onerror(error);
        }
      } finally {
        this.readyState = 4;
        if (typeof this.onreadystatechange === 'function') {
          this.onreadystatechange();
        }
        if (typeof this.onload === 'function') {
          this.onload();
        }
      }
    }

    abort() {}
  };
}

function createNodeFetch(window, options = {}) {
  const {
    cookie = '',
    userAgent = DEFAULT_JR_USER_AGENT,
  } = options;

  return async function nodeFetch(input, init = {}) {
    const requestUrl = new URL(
      typeof input === 'string' ? input : input?.url || '',
      window.location.href,
    ).toString();
    const requestMethod = String(init.method || 'GET').toUpperCase();
    const headers = {
      Cookie: cookie,
      Origin: window.location.origin,
      Referer: window.location.href,
      'User-Agent': userAgent,
      ...(init.headers || {}),
    };
    const response = await got(requestUrl, {
      method: requestMethod,
      headers,
      body: init.body,
      throwHttpErrors: false,
      timeout: { request: REQUEST_TIMEOUT_MS },
      responseType: 'buffer',
    });
    const responseBuffer = response.body || Buffer.alloc(0);
    const responseText = responseBuffer.toString('utf8');

    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: String(response.statusCode),
      url: requestUrl,
      headers: {
        get(name) {
          return response.headers[String(name || '').toLowerCase()] || null;
        },
      },
      text: async () => responseText,
      json: async () => JSON.parse(responseText || '{}'),
      arrayBuffer: async () => responseBuffer.buffer.slice(
        responseBuffer.byteOffset,
        responseBuffer.byteOffset + responseBuffer.byteLength,
      ),
    };
  };
}

async function getJsSecuritySigner(options = {}) {
  const {
    h5stAppId,
    cookie = '',
    pageUrl = 'https://laputa.jd.com/',
    scriptUrl = DEFAULT_JS_SECURITY_SCRIPT_URL,
    bizId = 'laputa',
    userAgent = DEFAULT_JR_USER_AGENT,
    signerOptions = {},
    localStorageSeed = {},
  } = options;
  const cacheKey = `${h5stAppId}:${pageUrl}:${scriptUrl}:${bizId}:${userAgent}:${getUserName(cookie)}:${JSON.stringify(signerOptions)}:${JSON.stringify(localStorageSeed)}`;

  if (jsSecuritySignerCache.has(cacheKey)) {
    return jsSecuritySignerCache.get(cacheKey);
  }

  const signerPromise = (async () => {
    const { JSDOM, VirtualConsole } = loadJsdomDependencies();
    const virtualConsole = new VirtualConsole();
    const scriptSource = await getJsSecurityScript(scriptUrl, { referer: pageUrl, userAgent });
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: pageUrl,
      referrer: pageUrl,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      resources: 'usable',
      virtualConsole,
    });

    const { window } = dom;
    patchRiskWindow(window, { bizId, userAgent, cookie });
    for (const [key, value] of Object.entries(localStorageSeed || {})) {
      try {
        window.localStorage.setItem(key, String(value));
      } catch (error) {
        // localStorage 预置失败时退回 js_security 自己生成，不阻断其他脚本。
      }
    }
    window.eval(scriptSource);

    const ParamsSignCtor = typeof window.ParamsSign === 'function'
      ? window.ParamsSign
      : (typeof window.ParamsSignLite === 'function' ? window.ParamsSignLite : null);

    if (!ParamsSignCtor) {
      dom.window.close();
      throw new Error('js_security 未暴露 ParamsSign/ParamsSignLite');
    }

    const {
      skipManualPrepare = false,
      ...paramsSignOptions
    } = signerOptions || {};
    const signer = new ParamsSignCtor({
      appId: h5stAppId,
      ...paramsSignOptions,
    });

    if (!skipManualPrepare) {
      if (typeof signer._$rds === 'function') {
        signer._$rds();
      }
      if (typeof signer._$rgo === 'function') {
        await signer._$rgo();
      }
    }

    return {
      dom,
      signer,
    };
  })();

  jsSecuritySignerCache.set(cacheKey, signerPromise);
  return signerPromise;
}

async function createJsSecurityH5st(options = {}) {
  const {
    h5stAppId,
    formFields,
    signerOptions = {},
  } = options;
  const signerContext = await getJsSecuritySigner({ ...options, signerOptions });
  const signResult = await signerContext.signer.sign({ ...formFields });
  const h5st = signResult?.h5st || '';

  if (!h5st) {
    throw new Error(`js_security 未生成 h5st: ${stringifySnippet(signResult, 300)}`);
  }

  return h5st;
}

async function getBabelSecurityRuntime(options = {}) {
  const {
    cookie = '',
    pageUrl = 'https://pro.m.jd.com/',
    scriptUrl = DEFAULT_BABEL_SECURITY_SCRIPT_URL,
    bizId = 'pro',
    userAgent = DEFAULT_JR_USER_AGENT,
  } = options;
  const cacheKey = `${pageUrl}:${scriptUrl}:${bizId}:${userAgent}:${getUserName(cookie)}`;

  if (babelSecurityRuntimeCache.has(cacheKey)) {
    return babelSecurityRuntimeCache.get(cacheKey);
  }

  const runtimePromise = (async () => {
    const { JSDOM, VirtualConsole } = loadJsdomDependencies();
    const virtualConsole = new VirtualConsole();
    const scriptSource = await getJsSecurityScript(scriptUrl, { referer: pageUrl, userAgent });
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: pageUrl,
      referrer: pageUrl,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      resources: 'usable',
      virtualConsole,
    });

    const { window } = dom;
    patchRiskWindow(window, { bizId, userAgent, cookie });
    window.eval(scriptSource);

    const babelSecurity = await Promise.race([
      window.babelSecurity,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('babelSecurity 初始化超时')), REQUEST_TIMEOUT_MS);
      }),
    ]);

    if (!babelSecurity || typeof babelSecurity.mergeSecurityParams !== 'function') {
      dom.window.close();
      throw new Error('babelSecurity 未暴露 mergeSecurityParams');
    }

    try {
      await babelSecurity.mergeSecurityParams({}, {});
    } catch (error) {
      // 预热失败不阻断真实流程
    }

    return {
      dom,
      babelSecurity,
    };
  })();

  babelSecurityRuntimeCache.set(cacheKey, runtimePromise);
  return runtimePromise;
}

async function createBabelSecurityParams(options = {}) {
  const {
    formFields = {},
    headers = {},
    signSourceFields = null,
    signerOptions = {},
  } = options;
  const runtime = await getBabelSecurityRuntime(options);
  const result = await runtime.babelSecurity.mergeSecurityParams(
    { ...formFields },
    { ...headers },
  );
  const [mergedFieldsRaw, mergedHeaders] = Array.isArray(result)
    ? result
    : [formFields, headers];
  const mergedFields = mergedFieldsRaw || formFields;

  if (!mergedFields.h5st && typeof runtime.babelSecurity.signParams === 'function' && signSourceFields) {
    try {
      const signResult = await runtime.babelSecurity.signParams(
        { ...signSourceFields },
        signerOptions,
      );
      if (signResult?.h5st) {
        mergedFields.h5st = signResult.h5st;
      }
    } catch (error) {
      // 忽略 signParams 回退异常，保持 mergeSecurityParams 原结果
    }
  }

  if (!mergedFields.h5st && typeof runtime.babelSecurity.PramsSignLib === 'function' && signSourceFields) {
    try {
      const signer = new runtime.babelSecurity.PramsSignLib({ ...signerOptions });
      if (typeof signer._$rds === 'function') {
        signer._$rds();
      }
      if (typeof signer._$rgo === 'function') {
        await signer._$rgo();
      }
      const signResult = await signer.sign({ ...signSourceFields });
      if (signResult?.h5st) {
        mergedFields.h5st = signResult.h5st;
      }
    } catch (error) {
      // 忽略 PramsSignLib 回退异常，保持当前结果
    }
  }

  return {
    formFields: mergedFields,
    headers: mergedHeaders || headers,
  };
}

function buildHeaders(cookie, options = {}) {
  const {
    origin = 'https://pro.m.jd.com',
    referer = 'https://pro.m.jd.com/',
    userAgent = getUserAgent(),
    contentType = 'application/x-www-form-urlencoded',
    extraHeaders = {},
  } = options;

  const headers = {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: origin,
    Referer: referer,
    'User-Agent': userAgent,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return {
    ...headers,
    ...extraHeaders,
  };
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

function patchRiskWindow(window, options = {}) {
  const {
    bizId = 'laputa',
    userAgent = DEFAULT_JR_USER_AGENT,
    screenWidth = 390,
    screenHeight = 844,
    cookie = '',
  } = options;

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
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(window.navigator, 'vendor', {
    configurable: true,
    value: 'Apple Computer, Inc.',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 5,
  });
  Object.defineProperty(window.navigator, 'webdriver', {
    configurable: true,
    value: false,
  });
  Object.defineProperty(window.navigator, 'cookieEnabled', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window.navigator, 'deviceMemory', {
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
    value: screenWidth,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: screenHeight,
  });
  Object.defineProperty(window.screen, 'availWidth', {
    configurable: true,
    value: screenWidth,
  });
  Object.defineProperty(window.screen, 'availHeight', {
    configurable: true,
    value: screenHeight,
  });
  Object.defineProperty(window.screen, 'colorDepth', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(window.screen, 'pixelDepth', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: 3,
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: screenWidth,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: screenHeight,
  });
  Object.defineProperty(window, 'outerWidth', {
    configurable: true,
    value: screenWidth,
  });
  Object.defineProperty(window, 'outerHeight', {
    configurable: true,
    value: screenHeight,
  });
  Object.defineProperty(window, 'screenX', {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(window, 'screenY', {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(window, 'screenLeft', {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(window, 'screenTop', {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(window.document, 'hidden', {
    configurable: true,
    value: false,
  });
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      width: screenWidth,
      height: screenHeight,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  window.orientation = 0;
  window.Touch = window.Touch || function Touch() {};
  window.TouchEvent = window.TouchEvent || function TouchEvent() {};
  if (globalThis.crypto?.webcrypto) {
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: globalThis.crypto.webcrypto,
    });
  }
  if (window.Element?.prototype && typeof window.Element.prototype.scrollIntoView !== 'function') {
    Object.defineProperty(window.Element.prototype, 'scrollIntoView', {
      configurable: true,
      value() {},
    });
  }
  window.scrollTo = window.scrollTo || function scrollTo() {};
  window.scrollBy = window.scrollBy || function scrollBy() {};
  window.requestAnimationFrame = window.requestAnimationFrame || function requestAnimationFrame(callback) {
    return setTimeout(() => callback(Date.now()), 16);
  };
  window.cancelAnimationFrame = window.cancelAnimationFrame || function cancelAnimationFrame(timer) {
    clearTimeout(timer);
  };
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value() {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z1xQAAAAASUVORK5CYII=';
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
          clearRect() {},
          beginPath() {},
          arc() {},
          closePath() {},
          fill() {},
          stroke() {},
          save() {},
          restore() {},
          moveTo() {},
          lineTo() {},
          translate() {},
          scale() {},
          rotate() {},
          rect() {},
          clip() {},
          drawImage() {},
          putImageData() {},
          createImageData() {
            return [];
          },
          setTransform() {},
          measureText() {
            return { width: 10 };
          },
          getImageData() {
            return { data: new Uint8ClampedArray(16) };
          },
        };
      }

      return {
        getParameter(parameter) {
          if (parameter === 37445) {
            return 'Apple Inc.';
          }
          if (parameter === 37446) {
            return 'Apple GPU';
          }
          if (parameter === 7936) {
            return 'WebKit';
          }
          if (parameter === 7937) {
            return 'WebKit WebGL';
          }
          if (parameter === 7938) {
            return 'WebGL 1.0';
          }
          if (parameter === 3379) {
            return 4096;
          }
          return 1;
        },
        getExtension(name) {
          if (name === 'WEBGL_debug_renderer_info') {
            return {
              UNMASKED_VENDOR_WEBGL: 37445,
              UNMASKED_RENDERER_WEBGL: 37446,
            };
          }
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
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z1xQAAAAASUVORK5CYII=';
          },
        },
      };
    },
  });
  window.fetch = createNodeFetch(window, { cookie, userAgent });
  window.XMLHttpRequest = createNodeXmlHttpRequest(window, { cookie, userAgent });
  const loadedScriptMap = new Map();
  const loadExternalScript = async (node) => {
    const rawSrc = node?.src || (typeof node?.getAttribute === 'function' ? node.getAttribute('src') : '');
    if (!rawSrc) {
      return;
    }

    const scriptUrl = new URL(rawSrc, window.location.href).toString();
    if (!loadedScriptMap.has(scriptUrl)) {
      loadedScriptMap.set(scriptUrl, (async () => {
        const response = await got.get(scriptUrl, {
          headers: {
            Referer: window.location.href,
            Origin: window.location.origin,
            'User-Agent': userAgent,
            Cookie: cookie,
          },
          throwHttpErrors: false,
          timeout: { request: REQUEST_TIMEOUT_MS },
        });

        if (response.statusCode >= 400 || !response.body) {
          throw new Error(`动态脚本加载失败：HTTP ${response.statusCode} ${scriptUrl}`);
        }

        window.eval(response.body);
      })());
    }

    try {
      await loadedScriptMap.get(scriptUrl);
      if (typeof node.onload === 'function') {
        node.onload();
      }
      if (typeof node.onreadystatechange === 'function') {
        node.readyState = 'complete';
        node.onreadystatechange();
      }
      if (typeof node.dispatchEvent === 'function') {
        node.dispatchEvent(new window.Event('load'));
      }
    } catch (error) {
      if (typeof node.onerror === 'function') {
        node.onerror(error);
      }
      if (typeof node.dispatchEvent === 'function') {
        node.dispatchEvent(new window.Event('error'));
      }
    }
  };
  const patchScriptInsertion = (prototype, methodName) => {
    if (!prototype || typeof prototype[methodName] !== 'function') {
      return;
    }

    const originalMethod = prototype[methodName];
    Object.defineProperty(prototype, methodName, {
      configurable: true,
      writable: true,
      value(node, ...args) {
        const result = originalMethod.call(this, node, ...args);
        if (node?.tagName === 'SCRIPT' && (node.src || (typeof node.getAttribute === 'function' && node.getAttribute('src')))) {
          Promise.resolve().then(() => loadExternalScript(node));
        }
        return result;
      },
    });
  };
  patchScriptInsertion(window.Node?.prototype, 'appendChild');
  patchScriptInsertion(window.Node?.prototype, 'insertBefore');
  window.XWebView = window.XWebView || {};
  window.XWebView.callNative = window.XWebView.callNative || function callNative() {};
  window.XWebView._callNative = window.XWebView._callNative || function _callNative() {};
  window.webkit = window.webkit || { messageHandlers: {} };
  window.getJdEid = window.getJdEid || function getJdEid(callback) {
    if (typeof callback === 'function') {
      callback({ eid: '', fp: '' }, '');
    }
  };
  window.PerformanceObserver = window.PerformanceObserver || class PerformanceObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  let performanceObject;
  try {
    performanceObject = window.performance;
  } catch (error) {
    performanceObject = undefined;
  }
  if (!performanceObject) {
    performanceObject = {};
    try {
      Object.defineProperty(window, 'performance', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: performanceObject,
      });
    } catch (error) {
      performanceObject = {};
    }
  }
  performanceObject.mark = performanceObject.mark || function mark() {};
  performanceObject.measure = performanceObject.measure || function measure() {};

  window.console = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  window.bp_bizid = bizId;
}

async function getGiasScript(scriptUrl, options = {}) {
  const {
    referer = DEFAULT_GIAS_PAGE_URL,
    userAgent = DEFAULT_JR_USER_AGENT,
  } = options;

  if (giasScriptCache.has(scriptUrl)) {
    return giasScriptCache.get(scriptUrl);
  }

  const response = await got.get(scriptUrl, {
    headers: {
      Referer: referer,
      'User-Agent': userAgent,
    },
    throwHttpErrors: false,
    timeout: { request: GIAS_TIMEOUT_MS },
  });
  const scriptSource = response.body || '';
  if (!scriptSource || response.statusCode >= 400) {
    throw new Error(`gias 脚本加载失败：HTTP ${response.statusCode}`);
  }

  giasScriptCache.set(scriptUrl, scriptSource);
  return scriptSource;
}

async function getGiasRiskContext(cookie, options = {}) {
  const {
    pageUrl = DEFAULT_GIAS_PAGE_URL,
    scriptUrl = DEFAULT_GIAS_SCRIPT_URL,
    bizId = 'laputa',
    userAgent = DEFAULT_JR_USER_AGENT,
    timeoutMs = GIAS_TIMEOUT_MS,
  } = options;
  const cacheKey = `${getUserName(cookie)}:${bizId}:${userAgent}`;

  if (riskContextCache.has(cacheKey)) {
    return riskContextCache.get(cacheKey);
  }

  const riskContextPromise = (async () => {
    const { JSDOM, VirtualConsole } = loadJsdomDependencies();
    const virtualConsole = new VirtualConsole();
    const scriptSource = await getGiasScript(scriptUrl, { referer: pageUrl, userAgent });
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: pageUrl,
      referrer: pageUrl,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      resources: 'usable',
      virtualConsole,
    });

    try {
      const { window } = dom;
      patchRiskWindow(window, { bizId, userAgent, cookie });

      const sourceCookieMap = parseCookieString(cookie);
      for (const [key, value] of sourceCookieMap.entries()) {
        window.document.cookie = `${key}=${value}; path=/`;
      }

      window.eval(scriptSource);

      const tokenResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('gias 获取 jsToken 超时'));
        }, timeoutMs);

        window.getJsToken((result) => {
          clearTimeout(timer);
          resolve(result || {});
        }, timeoutMs);
      });

      const riskCookieMap = parseCookieString(window.document.cookie);
      const jsToken = riskCookieMap.get('3AB9D23F7A4B3CSS') || tokenResult.jsToken || '';
      const equipmentId = riskCookieMap.get('3AB9D23F7A4B3C9B') || tokenResult.eid || '';
      const giaD = riskCookieMap.get('_gia_d') || '1';

      if (!jsToken) {
        throw new Error(`gias 未返回有效 jsToken: ${stringifySnippet(tokenResult, 300)}`);
      }

      return {
        jsToken,
        equipmentId,
        giaD,
        cookie: mergeCookieString(cookie, {
          '3AB9D23F7A4B3CSS': jsToken,
          '3AB9D23F7A4B3C9B': equipmentId,
          _gia_d: giaD,
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

async function postFormApi(cookie, options) {
  const {
    endpoint = 'https://api.m.jd.com/',
    functionId,
    appid,
    body = {},
    client = '',
    loginType = '',
    loginWQBiz = '',
    h5stAppId = '',
    h5stMode = 'h5st41',
    h5stVersion = '5.3',
    h5stScriptUrl = DEFAULT_JS_SECURITY_SCRIPT_URL,
    h5stBizId = 'laputa',
    h5stSignKeys = [],
    userAgent = getUserAgent(),
    origin,
    referer,
    h5stPageUrl = referer || origin || 'https://pro.m.jd.com/',
    extraForm = {},
    extraHeaders = {},
    includeUuid = false,
    includeMeta = false,
  } = options;

  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  const form = new URLSearchParams();
  appendFormValue(form, 'appid', appid);
  appendFormValue(form, 'loginType', loginType);
  appendFormValue(form, 'loginWQBiz', loginWQBiz);
  appendFormValue(form, 'functionId', functionId);
  appendFormValue(form, 'body', bodyText);
  appendFormValue(form, 'client', client);
  if (includeUuid) {
    appendFormValue(form, 'uuid', getRequestUuid(cookie));
  }

  for (const [key, value] of Object.entries(extraForm)) {
    appendFormValue(form, key, value);
  }

  if (h5stAppId) {
    const allFormFields = Object.fromEntries(form.entries());
    const formFields = h5stSignKeys.length
      ? h5stSignKeys.reduce((fields, key) => {
        if (allFormFields[key]) {
          fields[key] = allFormFields[key];
        }
        return fields;
      }, {})
      : allFormFields;
    const h5st = h5stMode === 'js_security'
      ? await createJsSecurityH5st({
        h5stAppId,
        formFields,
        cookie,
        userAgent,
        pageUrl: h5stPageUrl,
        scriptUrl: h5stScriptUrl,
        bizId: h5stBizId,
      })
      : await createH5st({
        functionId,
        body,
        h5stAppId,
        requestAppid: appid,
        cookie,
        userAgent,
        client: client || 'wh5',
        version: h5stVersion,
      });
    appendFormValue(form, 'h5st', h5st);
  }

  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set('functionId', functionId);

  const response = await got.post(requestUrl.toString(), {
    body: form.toString(),
    headers: buildHeaders(cookie, { origin, referer, userAgent, extraHeaders }),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  const data = parseApiResponse(response);
  if (includeMeta) {
    return {
      data,
      headers: response.headers,
      statusCode: response.statusCode,
      body: response.body || '',
    };
  }

  return data;
}

async function getQueryApi(cookie, options) {
  const {
    endpoint,
    functionId,
    appid,
    body = {},
    h5stAppId = '',
    h5stVersion = '5.3',
    userAgent = getUserAgent(),
    origin,
    referer,
    extraQuery = {},
  } = options;

  const url = new URL(endpoint);
  url.searchParams.set('functionId', functionId);
  url.searchParams.set('body', JSON.stringify(body));
  url.searchParams.set('appid', appid);

  if (h5stAppId) {
    const h5st = await createH5st({
      functionId,
      body,
      h5stAppId,
      requestAppid: appid,
      cookie,
      userAgent,
      version: h5stVersion,
    });
    url.searchParams.set('h5st', h5st);
  }

  for (const [key, value] of Object.entries(extraQuery)) {
    appendFormValue(url.searchParams, key, value);
  }

  const response = await got.get(url.toString(), {
    headers: buildHeaders(cookie, {
      origin,
      referer,
      userAgent,
      contentType: undefined,
    }),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });

  return parseApiResponse(response);
}

function hasJingBeanReward(task) {
  const reward = task?.reward || {};
  const rewards = [
    reward,
    ...(Array.isArray(task?.rewards) ? task.rewards : []),
    ...(Array.isArray(task?.rewardsList) ? task.rewardsList : []),
  ];

  return rewards.some((item) => {
    const rewardType = String(item?.rewardType || '');
    const rewardName = String(item?.rewardName || item?.name || '');
    return rewardType === '3' || rewardName.includes('京豆');
  });
}

module.exports = {
  buildHeaders,
  createBabelSecurityParams,
  createH5st,
  createJsSecurityH5st,
  DEFAULT_JR_USER_AGENT,
  DEFAULT_USER_AGENT,
  Env,
  getBabelSecurityRuntime,
  getQueryApi,
  getGiasRiskContext,
  getRequestUuid,
  getUserAgent,
  getUserName,
  hasJingBeanReward,
  mergeCookieString,
  parseCookieString,
  postFormApi,
  parseApiResponse,
  safeJsonParse,
  sleep,
  stringifySnippet,
};
