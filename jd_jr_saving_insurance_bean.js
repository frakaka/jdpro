/*
cron:40 0 * * * jd_jr_saving_insurance_bean.js

环境变量说明：
1. JDJR_SAVING_INSURANCE_FULL_COOKIE
   含义：可选的储蓄保险活动完整 Cookie，会合并到 JD_COOKIE 上。
   是否必须：否，但只有 pt_key/pt_pin 时建议补充。

2. JDJR_SAVING_INSURANCE_SDK_TOKEN
   含义：collectPrizeFromHold 请求中的 riskDeviceInfo.sdkToken。
   是否必须：否，默认使用当前 HAR 抓包值。

3. JDJR_SAVING_INSURANCE_JS_TOKEN
   含义：collectPrizeFromHold 请求中的 riskDeviceInfo.jsToken。
   是否必须：否，默认优先使用 Cookie / gias 动态结果。

4. JDJR_SAVING_INSURANCE_DEBUG
   含义：是否打印关键接口原始返回片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。
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
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('储蓄保险持仓领京豆');

const PAGE_URL = 'https://fc.jr.jd.com/fc/insurance/home/';
const PAGE_ORIGIN = 'https://fc.jr.jd.com';
const PAGE_REFERER = 'https://fc.jr.jd.com/';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const QUERY_PRIZE_URL = 'https://ms.jr.jd.com/gw2/generic/insgwplus2/h5/m/queryHoldenPagePrizeEntranceV2';
const COLLECT_PRIZE_URL = 'https://ms.jr.jd.com/gw2/generic/insgwplus2/h5/m/collectPrizeFromHold';
const QUERY_CARD_URL = 'https://ms.jr.jd.com/gw2/generic/insgwplus2/h5/m/queryInsHomeCard';
const QUERY_SUBSCRIBE_URL = 'https://ms.jr.jd.com/gw/generic/mkt/h5/m/getPinSubscribes';
const QUERY_STALL_URL = 'https://ms.jr.jd.com/gw/generic/jrm/h5/m/queryStallNew';

const DEFAULT_SDK_TOKEN = 'jdd01LNCWNYFRC2DPW3EE4TNVBO5OY47SOYKXLAU3EZ67A3WJLD6B2VI44OUHX6VUK6B4U63N6BMJTEVPXS4WKRF2CSMCRL5GXLFLASHG77I01234567';
const DEFAULT_SUBSCRIBE_ID = '37498';
const HOLD_BEAN_STALL_NO = '08241127133704001219';
const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_SAVING_INSURANCE_DEBUG === '1';
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = String(cookie || '').match(pattern);
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
        'User-Agent': DEFAULT_JR_USER_AGENT,
        Referer: PAGE_URL,
      },
      timeout: {
        request: REQUEST_TIMEOUT_MS,
      },
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

  return {
    dom,
    window,
  };
}

function signWithAar2(aar2Context, signText) {
  const aar2 = new aar2Context.window.AAR2();
  const nonce = aar2.nonce();
  return {
    nonce,
    signature: String(aar2.sign(signText, nonce) || '').toUpperCase(),
  };
}

function extractRiskContextFromCookie(cookie) {
  return {
    jsToken:
      process.env.JDJR_SAVING_INSURANCE_JS_TOKEN ||
      getCookieValue(cookie, '3AB9D23F7A4B3CSS') ||
      '',
    cookie,
  };
}

async function createRiskContext(cookie) {
  try {
    const giasContext = await getGiasRiskContext(cookie, {
      pageUrl: PAGE_URL,
      bizId: 'fc',
      userAgent: DEFAULT_JR_USER_AGENT,
    });
    return {
      jsToken: process.env.JDJR_SAVING_INSURANCE_JS_TOKEN || giasContext.jsToken || getCookieValue(giasContext.cookie, '3AB9D23F7A4B3CSS') || '',
      cookie: giasContext.cookie || cookie,
    };
  } catch (error) {
    return {
      ...extractRiskContextFromCookie(cookie),
      giasError: error.message,
    };
  }
}

function buildHeadersForGet(cookie) {
  return buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: DEFAULT_JR_USER_AGENT,
    contentType: undefined,
    extraHeaders: {
      Accept: 'application/json, text/plain, */*',
    },
  });
}

async function getJson(url, cookie) {
  const response = await got.get(url, {
    headers: buildHeadersForGet(cookie),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const text = response.body || '';
  return text ? safeJsonParse(text, text) : {};
}

async function postForm(url, cookie, form) {
  const response = await got.post(url, {
    body: form.toString(),
    headers: buildHeaders(cookie, {
      origin: PAGE_ORIGIN,
      referer: PAGE_REFERER,
      userAgent: DEFAULT_JR_USER_AGENT,
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const text = response.body || '';
  return text ? safeJsonParse(text, text) : {};
}

async function queryPrizeEntrance(cookie) {
  const reqData = encodeURIComponent(JSON.stringify({ channel: '' }));
  const url = `${QUERY_PRIZE_URL}?reqData=${reqData}`;
  return getJson(url, cookie);
}

async function collectPrize(cookie, riskContext, aar2Context, recordId) {
  const reqDataPayload = {
    recordId,
    riskDeviceInfo: {
      sdkToken: process.env.JDJR_SAVING_INSURANCE_SDK_TOKEN || DEFAULT_SDK_TOKEN,
      jsToken: riskContext.jsToken || '',
      appType: 1,
    },
  };
  const signText = JSON.stringify(reqDataPayload);
  const { nonce, signature } = signWithAar2(aar2Context, signText);
  const url = `${COLLECT_PRIZE_URL}?reqData=${encodeURIComponent(signText)}&aar=${encodeURIComponent(JSON.stringify({ nonce, signature }))}`;
  return getJson(url, cookie);
}

async function queryHomeCard(cookie) {
  return postForm(QUERY_CARD_URL, cookie, new URLSearchParams());
}

async function queryHoldBeanStall(cookie) {
  const reqData = encodeURIComponent(JSON.stringify({
    stallNo: HOLD_BEAN_STALL_NO,
    systemCode: 'gslcqd',
    hitValue: '',
  }));
  return getJson(`${QUERY_STALL_URL}?reqData=${reqData}`, cookie);
}

async function querySubscribeInfo(cookie, templateId = DEFAULT_SUBSCRIBE_ID) {
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify({
    templateId: String(templateId),
    sendChannel: 1,
  }));
  return postForm(QUERY_SUBSCRIBE_URL, cookie, form);
}

function isApiSuccess(response, businessCode = 0) {
  return Number(response?.resultCode) === businessCode;
}

function formatPrizeState(value) {
  const drawInfo = value?.chouJingDouData || {};
  return `状态=${drawInfo.status || '-'} | recordId=${drawInfo.businessType || '-'} | 可领豆数=${drawInfo.num ?? '-'} | 累计已领=${value?.totalReceived ?? '-'}`;
}

async function runAccount(index, cookie) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const fullCookie = process.env.JDJR_SAVING_INSURANCE_FULL_COOKIE || '';
  const mergedCookie = fullCookie ? mergeCookieString(cookie, fullCookie) : cookie;
  let aar2Context = null;

  try {
    console.log(`\n==== ${prefix} ====`);
    const riskContext = await createRiskContext(mergedCookie);
    if (riskContext.giasError) {
      console.log(`${prefix}: gias 获取失败，回退 Cookie 风控态 => ${riskContext.giasError}`);
    }

    aar2Context = await createAar2Context();

    const homeCard = await queryHomeCard(riskContext.cookie);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryInsHomeCard 原始返回 => ${stringifySnippet(homeCard, 800)}`);
    }
    const homeCards = homeCard?.resultData?.value || [];
    if (Array.isArray(homeCards) && homeCards.length) {
      console.log(`${prefix}: 首页权益卡片数 => ${homeCards.length}`);
    }

    const stallInfo = await queryHoldBeanStall(riskContext.cookie);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryStallNew 原始返回 => ${stringifySnippet(stallInfo, 800)}`);
    }
    const subscribeId = stallInfo?.resultData?.data?.stallGroupVoList?.find((item) => item?.title === 'subscribeId')?.mktText || DEFAULT_SUBSCRIBE_ID;

    const subscribeInfo = await querySubscribeInfo(riskContext.cookie, subscribeId);
    if (isDebugEnabled()) {
      console.log(`${prefix}: getPinSubscribes 原始返回 => ${stringifySnippet(subscribeInfo, 600)}`);
    }
    const templateTitle = subscribeInfo?.resultData?.data?.templateTitle || '日日正收益 京豆天天领';
    console.log(`${prefix}: 消息提醒 => ${templateTitle}`);

    const before = await queryPrizeEntrance(riskContext.cookie);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryHoldenPagePrizeEntranceV2 原始返回 => ${stringifySnippet(before, 800)}`);
    }
    if (!isApiSuccess(before)) {
      throw new Error(`queryHoldenPagePrizeEntranceV2 失败: ${stringifySnippet(before, 600)}`);
    }
    const beforeValue = before?.resultData?.value || {};
    console.log(`${prefix}: 领奖前状态 => ${formatPrizeState(beforeValue)}`);

    const drawInfo = beforeValue.chouJingDouData || {};
    if (drawInfo.status !== 'CAN_BE_DRAW') {
      console.log(`${prefix}: 当前无需领奖，状态=${drawInfo.status || '未知'}`);
      return;
    }

    const recordId = drawInfo.businessType || 'POSITION_RANDOM';
    const collectResult = await collectPrize(riskContext.cookie, riskContext, aar2Context, recordId);
    if (isDebugEnabled()) {
      console.log(`${prefix}: collectPrizeFromHold 原始返回 => ${stringifySnippet(collectResult, 800)}`);
    }
    if (!isApiSuccess(collectResult)) {
      throw new Error(`collectPrizeFromHold 失败: ${stringifySnippet(collectResult, 600)}`);
    }
    const collectValue = collectResult?.resultData?.value || {};
    console.log(`${prefix}: 领奖成功 => 京豆${collectValue.jinDouNum ?? '-'}个 | 状态=${collectValue.collectStatus || '-'}`);

    const after = await queryPrizeEntrance(riskContext.cookie);
    if (isDebugEnabled()) {
      console.log(`${prefix}: 领奖后 queryHoldenPagePrizeEntranceV2 原始返回 => ${stringifySnippet(after, 800)}`);
    }
    if (!isApiSuccess(after)) {
      throw new Error(`领奖后 queryHoldenPagePrizeEntranceV2 失败: ${stringifySnippet(after, 600)}`);
    }
    const afterValue = after?.resultData?.value || {};
    console.log(`${prefix}: 领奖后状态 => ${formatPrizeState(afterValue)}`);
  } catch (error) {
    console.log(`${prefix}: ${error.message}`);
  } finally {
    if (aar2Context?.dom?.window) {
      aar2Context.dom.window.close();
    }
  }
}

(async () => {
  if (!cookies.length) {
    console.log('未找到有效的 JD Cookie');
    $.done();
    return;
  }

  console.log(`共${cookies.length}个京东账号Cookie`);
  for (let index = 0; index < cookies.length; index += 1) {
    await runAccount(index + 1, cookies[index]);
  }
  $.done();
})().catch((error) => {
  console.log(error.message);
  $.done();
});
