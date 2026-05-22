/*
cron:30 0 * * * jd_jr_zsj_draw_bean.js

环境变量说明：
1. JD_JR_ZSJ_FP / JD_JR_ZSJ_SDK_TOKEN / JD_JR_ZSJ_EID / JD_JR_ZSJ_JS_TOKEN
   含义：超级指数节抽奖请求里的 riskMap 设备参数。
   是否必须：否，未配置时使用当前 HAR 默认值，EID 优先从 Cookie 中读取。

2. JD_JR_ZSJ_MAX_DRAW
   含义：最多执行几次抽奖。
   是否必须：否，默认按首页返回的 drawAvailableTimes 执行。

3. JD_JR_ZSJ_DEBUG
   含义：是否打印接口原始返回片段，便于排查 AAR2 或活动字段变化。
   是否必须：否，配置为 1 时开启。
*/

'use strict';

const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_JR_USER_AGENT,
  buildHeaders,
  getUserName,
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('超级指数节抽京豆');

const PAGE_URL = 'https://lca.jd.com/yx/index-channel/#/home';
const PAGE_ORIGIN = 'https://lca.jd.com';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const HOME_API = 'https://ms.jr.jd.com/gw2/generic/fcc/h5/m/zsjActivityHome';
const DRAW_API = 'https://ms.jr.jd.com/gw2/generic/fcc/h5/m/zsjDrawPrize';
const USER_AGENT = DEFAULT_JR_USER_AGENT;
const DEFAULT_FP = 'F2Eq43RDVOqks1qdWODFOsE8PlXFmgZ6';
const DEFAULT_SDK_TOKEN = 'jdd01Q6TSW6FHF32OY5YAC2EFQHFVX636KZC4OKZJXZ7JCY2XYFP5LYYV2BKD4U725MRE7IHFF5XQKQGXPEEMVYM5G432QDZOLW7M74ZEVHA01234567';
const RISK_TIMEOUT_MS = 10000;
const cookies = Object.values(jdCookieNode).filter(Boolean);

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_JR_ZSJ_DEBUG === '1';
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
}

function getAar2Script() {
  if (!aar2ScriptPromise) {
    aar2ScriptPromise = got.get(AAR2_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: PAGE_URL,
      },
      timeout: {
        request: 10000,
      },
    }).text();
  }

  return aar2ScriptPromise;
}

async function createRiskContext() {
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

  return {
    dom,
    window,
  };
}

function buildRiskMap(cookie) {
  return {
    jsToken: process.env.JD_JR_ZSJ_JS_TOKEN || '',
    fp: process.env.JD_JR_ZSJ_FP || DEFAULT_FP,
    sdkToken: process.env.JD_JR_ZSJ_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    eid: process.env.JD_JR_ZSJ_EID || getCookieValue(cookie, 'equipmentId') || getCookieValue(cookie, '3AB9D23F7A4B3C9B') || '',
  };
}

function buildFormData(riskContext, payload) {
  const signText = JSON.stringify(payload);
  const aar2 = new riskContext.window.AAR2();
  const nonce = aar2.nonce();
  const signature = aar2.sign(signText, nonce);
  const form = new URLSearchParams();

  form.set('reqData', signText);
  form.set('aar', JSON.stringify({
    nonce,
    signature,
  }));

  return form.toString();
}

async function postSignedApi(cookie, riskContext, url, payload) {
  const response = await got.post(url, {
    body: buildFormData(riskContext, payload),
    headers: buildHeaders(cookie, {
      origin: PAGE_ORIGIN,
      referer: PAGE_URL,
      userAgent: USER_AGENT,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: 15000,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function queryHome(cookie, riskContext) {
  return postSignedApi(cookie, riskContext, HOME_API, {
    source: 'zsj',
  });
}

async function drawPrize(cookie, riskContext) {
  return postSignedApi(cookie, riskContext, DRAW_API, {
    riskMap: buildRiskMap(cookie),
  });
}

function getMaxDraw(homeData) {
  const available = Number(homeData?.resultData?.data?.drawAvailableTimes ?? 0);
  const override = Number(process.env.JD_JR_ZSJ_MAX_DRAW || '');
  return Number.isFinite(override) && override > 0 ? Math.min(available, override) : available;
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  let riskContext = null;

  $.log(`\n==== ${prefix} ====`);

  try {
    riskContext = await createRiskContext();
    const homeData = await queryHome(cookie, riskContext);

    if (isDebugEnabled()) {
      $.log(`${prefix}: zsjActivityHome => ${stringifySnippet(homeData, 1200)}`);
    }

    const drawCount = getMaxDraw(homeData);
    $.log(`${prefix}: 可抽奖次数=${drawCount}`);

    if (drawCount < 1) {
      return;
    }

    for (let attempt = 1; attempt <= drawCount; attempt += 1) {
      const drawResult = await drawPrize(cookie, riskContext);
      const prizeInfo = drawResult?.resultData?.data?.zsjPrizeInfo || {};
      const prizeText = `${prizeInfo.prizeNum || ''}${prizeInfo.prizeUnits || ''}${prizeInfo.prizeName || ''}`.trim();

      $.log(`${prefix}: 第${attempt}次抽奖 => ${prizeText || stringifySnippet(drawResult, 500)}`);

      if (isDebugEnabled()) {
        $.log(`${prefix}: drawResult => ${stringifySnippet(drawResult, 1000)}`);
      }
    }
  } finally {
    if (riskContext?.dom?.window) {
      riskContext.dom.window.close();
    }
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
      $.log(`账号${index + 1}: 执行失败：${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常：${error.message || error}`))
  .finally(() => $.done());
