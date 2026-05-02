/*
cron:32 0 * * * jd_jr_rmzhishu_growth.js

环境变量说明：
1. JDJR_RMZHISHU_GROWTH_SDK_TOKEN
   含义：prReceiveAwardBatch 风控参数中的 sdkToken。
   是否必须：否，默认使用当前 HAR 抓包值。

2. JDJR_RMZHISHU_GROWTH_EID
   含义：prReceiveAwardBatch 风控参数中的 eid。
   是否必须：否，默认优先使用 gias 动态生成的 equipmentId。

3. JDJR_RMZHISHU_GROWTH_EQUIPMENT_ID
   含义：热门指数页风控设备标识，会同时写入 3AB9D23F7A4B3C9B 和 equipmentId。
   是否必须：仅当 gias 动态生成失败且 JD_COOKIE 中缺少设备标识时必须。

4. JDJR_RMZHISHU_GROWTH_JS_TOKEN
   含义：热门指数页风控 jsToken，会写入 3AB9D23F7A4B3CSS。
   是否必须：否，默认优先使用 gias 动态生成或 JD_COOKIE 现有值。

5. JDJR_RMZHISHU_GROWTH_GIA_D
   含义：热门指数页风控 _gia_d。
   是否必须：否，默认值为 1。

6. JDJR_RMZHISHU_GROWTH_DEBUG
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

const $ = new Env('热门指数成长值领奖');

const PAGE_URL = 'https://channel.jr.jd.com/pd/index-channel/home/?&fundUtmSource=1297&fundUtmParam=icon';
const PAGE_ORIGIN = 'https://channel.jr.jd.com';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const COMPONENT_LOAD_URL = 'https://ms.jr.jd.com/gw2/generic/fcc/h5/m/prComponentLoad';
const RECEIVE_AWARD_URL = 'https://ms.jr.jd.com/gw2/generic/fcc/h5/m/prReceiveAwardBatch';
const QUERY_STALL_URL = 'https://ms.jr.jd.com/gw/generic/jrm/h5/m/queryStallNew';
const QUERY_SUBSCRIBE_URL = 'https://ms.jr.jd.com/gw/generic/mkt/h5/m/getPinSubscribes';

const PR_CHANNEL_CODE = 'indexFund';
const SOURCE = 'cf-fund-comp-learn';
const URL_KEY = '/learn-earn-credits';
const QD_PAGE_NAME = 'Index';
const ACTIVITY_NAME = '成长值组件_indexFund_Index';
const MD_CLICK_ID = 'Index|creditButtonAll';
const DEFAULT_SDK_TOKEN = 'jdd01LNCWNYFRC2DPW3EE4TNVBO5OY47SOYKXLAU3EZ67A3WJLD6B2VI44OUHX6VUK6B4U63N6BMJTEVPXS4WKRF2CSMCRL5GXLFLASHG77I01234567';
const DEFAULT_EQUIPMENT_ID = 'PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4';
const DEFAULT_JS_TOKEN = 'jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5S4HNMHIAAAAAD2I3CYGSZ4YJAQX';
const RECEIVE_GROWTH_STALL_NO = '59260209210626001344';
const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_RMZHISHU_GROWTH_DEBUG === '1';
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = String(cookie || '').match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
}

function getConfiguredRiskSeed(cookie) {
  return {
    jsToken:
      process.env.JDJR_RMZHISHU_GROWTH_JS_TOKEN ||
      getCookieValue(cookie, '3AB9D23F7A4B3CSS') ||
      DEFAULT_JS_TOKEN,
    equipmentId:
      process.env.JDJR_RMZHISHU_GROWTH_EQUIPMENT_ID ||
      getCookieValue(cookie, '3AB9D23F7A4B3C9B') ||
      getCookieValue(cookie, 'equipmentId') ||
      DEFAULT_EQUIPMENT_ID,
    giaD: process.env.JDJR_RMZHISHU_GROWTH_GIA_D || getCookieValue(cookie, '_gia_d') || '1',
  };
}

function buildRiskCookie(cookie, riskSeed) {
  return mergeCookieString(cookie, {
    '3AB9D23F7A4B3CSS': riskSeed.jsToken || '',
    '3AB9D23F7A4B3C9B': riskSeed.equipmentId || '',
    equipmentId: riskSeed.equipmentId || '',
    _gia_d: riskSeed.giaD || '1',
  });
}

function ensureRiskSeed(riskSeed) {
  if (!riskSeed.equipmentId) {
    throw new Error('缺少设备标识：请补 JDJR_RMZHISHU_GROWTH_EQUIPMENT_ID，或在 JD_COOKIE 中提供 3AB9D23F7A4B3C9B/equipmentId');
  }

  if (!riskSeed.jsToken) {
    throw new Error('缺少 jsToken：请补 JDJR_RMZHISHU_GROWTH_JS_TOKEN，或在 JD_COOKIE 中提供 3AB9D23F7A4B3CSS');
  }
}

function extractRiskContext(cookie) {
  const riskSeed = getConfiguredRiskSeed(cookie);
  ensureRiskSeed(riskSeed);
  return {
    jsToken: riskSeed.jsToken,
    equipmentId: riskSeed.equipmentId,
    giaD: riskSeed.giaD,
    cookie: buildRiskCookie(cookie, riskSeed),
  };
}

function mergeRiskContext(cookie, baseContext = {}) {
  const configuredRiskSeed = getConfiguredRiskSeed(cookie);
  const riskSeed = {
    jsToken: configuredRiskSeed.jsToken || baseContext.jsToken || '',
    equipmentId: configuredRiskSeed.equipmentId || baseContext.equipmentId || '',
    giaD: configuredRiskSeed.giaD || baseContext.giaD || '1',
  };
  ensureRiskSeed(riskSeed);
  return {
    jsToken: riskSeed.jsToken,
    equipmentId: riskSeed.equipmentId,
    giaD: riskSeed.giaD,
    cookie: buildRiskCookie(cookie, riskSeed),
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
    signature: aar2.sign(signText, nonce),
  };
}

function buildActivityHeaders(cookie, jsToken) {
  return buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: `${PAGE_ORIGIN}/`,
    userAgent: DEFAULT_JR_USER_AGENT,
    extraHeaders: {
      Accept: 'application/json, text/plain, */*',
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
}

async function postForm(url, cookie, form, jsToken) {
  const response = await got.post(url, {
    body: form.toString(),
    headers: buildActivityHeaders(cookie, jsToken),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const text = response.body || '';
  return text ? safeJsonParse(text, text) : {};
}

function buildRiskMap(riskContext) {
  return {
    sdkToken: process.env.JDJR_RMZHISHU_GROWTH_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    eid: process.env.JDJR_RMZHISHU_GROWTH_EID || riskContext.equipmentId || '',
    jsToken: process.env.JDJR_RMZHISHU_GROWTH_JS_TOKEN || '',
    pageUrl: PAGE_URL,
    urlKey: URL_KEY,
    qdPageName: QD_PAGE_NAME,
    activityName: ACTIVITY_NAME,
    mdClickId: MD_CLICK_ID,
  };
}

function buildLoadReqData() {
  return {
    prChannelCode: PR_CHANNEL_CODE,
    channelV: '',
    source: SOURCE,
  };
}

async function queryComponentLoad(cookie, riskContext) {
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify(buildLoadReqData()));
  return postForm(COMPONENT_LOAD_URL, cookie, form, riskContext.jsToken);
}

async function receiveGrowthAward(cookie, riskContext, aar2Context) {
  const riskMap = buildRiskMap(riskContext);
  const reqData = {
    prChannelCode: PR_CHANNEL_CODE,
    riskMap,
    source: SOURCE,
  };
  const signText = JSON.stringify(reqData);
  const { nonce, signature } = signWithAar2(aar2Context, signText);
  const form = new URLSearchParams();
  form.set('aar', JSON.stringify({ nonce, signature }));
  form.set('reqData', JSON.stringify(reqData));
  return postForm(RECEIVE_AWARD_URL, cookie, form, riskContext.jsToken);
}

async function queryStallInfo(cookie, riskContext) {
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify({
    systemCode: 'cf-component',
    stallNo: RECEIVE_GROWTH_STALL_NO,
  }));
  return postForm(QUERY_STALL_URL, cookie, form, riskContext.jsToken);
}

async function querySubscribeInfo(cookie, riskContext, templateId) {
  if (!templateId) {
    return null;
  }
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify({
    templateId: String(templateId),
    sendChannel: 1,
  }));
  return postForm(QUERY_SUBSCRIBE_URL, cookie, form, riskContext.jsToken);
}

function isApiSuccess(response, code = '0000') {
  return String(response?.resultData?.code || response?.resultCode || '') === code;
}

function formatCreditInfo(info) {
  return `成长值=${info?.totalCredit ?? '-'} | 可兑京豆=${info?.canExchangeBeanCount ?? '-'} | 可用成长值=${info?.availCredit ?? '-'} | 待领奖实例=${Array.isArray(info?.prizeInstanceIdList) ? info.prizeInstanceIdList.join(',') : '-'}`;
}

function getTakePrizeResult(response) {
  return response?.resultData?.data || {};
}

async function runAccount(index, cookie) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  let aar2Context = null;

  try {
    console.log(`\n==== ${prefix} ====`);
    let riskContext;
    try {
      const giasRiskContext = await getGiasRiskContext(cookie, {
        pageUrl: PAGE_URL,
        bizId: 'channel',
        userAgent: DEFAULT_JR_USER_AGENT,
      });
      riskContext = mergeRiskContext(cookie, giasRiskContext);
    } catch (error) {
      riskContext = extractRiskContext(cookie);
      console.log(`${prefix}: gias 获取失败，回退 Cookie 风控态 => ${error.message}`);
    }
    if (isDebugEnabled()) {
      console.log(
        `${prefix}: 风控上下文 => equipmentId=${riskContext.equipmentId.slice(0, 16)}... | jsToken=${riskContext.jsToken.slice(0, 20)}...`,
      );
    }
    aar2Context = await createAar2Context();

    const stallInfo = await queryStallInfo(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryStallNew 原始返回 => ${stringifySnippet(stallInfo, 600)}`);
    }
    if (isApiSuccess(stallInfo, '00000')) {
      console.log(`${prefix}: 组件信息 => ${stallInfo?.resultData?.data?.stallName || '未知组件'}`);
    }

    const before = await queryComponentLoad(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: prComponentLoad 原始返回 => ${stringifySnippet(before, 800)}`);
    }
    if (!isApiSuccess(before)) {
      throw new Error(`prComponentLoad 失败: ${stringifySnippet(before, 600)}`);
    }

    const beforeInfo = before?.resultData?.data?.userCreditInfo || {};
    console.log(`${prefix}: 领奖前状态 => ${formatCreditInfo(beforeInfo)}`);

    const subscribeTid = beforeInfo.receiveGrowthValuePushTid;
    if (subscribeTid) {
      const subscribeInfo = await querySubscribeInfo(riskContext.cookie, riskContext, subscribeTid);
      if (isDebugEnabled()) {
        console.log(`${prefix}: getPinSubscribes 原始返回 => ${stringifySnippet(subscribeInfo, 600)}`);
      }
      if (subscribeInfo?.resultData?.data?.switchFlag !== undefined) {
        console.log(`${prefix}: 指数到账提醒 => ${subscribeInfo.resultData.data.switchFlag ? '已开启' : '未开启'}`);
      }
    }

    if (!Array.isArray(beforeInfo.prizeInstanceIdList) || !beforeInfo.prizeInstanceIdList.length) {
      console.log(`${prefix}: 当前没有待领取成长值奖励`);
      return;
    }

    const receiveResult = await receiveGrowthAward(riskContext.cookie, riskContext, aar2Context);
    if (isDebugEnabled()) {
      console.log(`${prefix}: prReceiveAwardBatch 原始返回 => ${stringifySnippet(receiveResult, 800)}`);
    }
    const prizeResult = getTakePrizeResult(receiveResult);
    if (!prizeResult.takePrizeSuccessful) {
      throw new Error(`领奖失败: ${stringifySnippet(receiveResult, 600)}`);
    }

    const popInfo = prizeResult.takePrizePopInfo || {};
    console.log(`${prefix}: 领奖成功 => ${popInfo.prizeAmount || ''}${popInfo.prizeDesc || prizeResult.resultMsg || '成长值奖励'}`);

    const after = await queryComponentLoad(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: 领奖后 prComponentLoad 原始返回 => ${stringifySnippet(after, 800)}`);
    }
    if (!isApiSuccess(after)) {
      throw new Error(`领奖后 prComponentLoad 失败: ${stringifySnippet(after, 600)}`);
    }

    const afterInfo = after?.resultData?.data?.userCreditInfo || {};
    console.log(`${prefix}: 领奖后状态 => ${formatCreditInfo(afterInfo)}`);
    console.log(
      `${prefix}: 成长值变化 => ${beforeInfo.totalCredit ?? '-'} -> ${afterInfo.totalCredit ?? '-'} | 可兑京豆变化 => ${beforeInfo.canExchangeBeanCount ?? '-'} -> ${afterInfo.canExchangeBeanCount ?? '-'}`,
    );
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
