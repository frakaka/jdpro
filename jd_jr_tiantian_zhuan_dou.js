/*
cron:27 0 * * * jd_jr_tiantian_zhuan_dou.js

环境变量说明：
1. JDJR_TIANTIAN_ZHUAN_DOU_DEBUG
   含义：是否打印关键接口原始返回片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。

2. JDJR_TIANTIAN_ZHUAN_DOU_FP / JDJR_TIANTIAN_ZHUAN_DOU_SDK_TOKEN / JDJR_TIANTIAN_ZHUAN_DOU_EID / JDJR_TIANTIAN_ZHUAN_DOU_JS_TOKEN
   含义：天天赚豆请求中的设备风控参数。
   是否必须：否，默认优先使用 gias 动态结果，其次回退到当前 HAR 抓包值。

3. JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_TOKEN / JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_CHANNEL / JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_ID
   含义：里程碑领奖接口的 token、channelCode、milePostId。
   是否必须：否，默认分别为 TVBaZRYGYS / CH202501131 / 115。

4. JDJR_TIANTIAN_ZHUAN_DOU_FULL_COOKIE
   含义：天天赚豆活动页完整 Cookie，优先用于 mission 相关接口，补齐 sdtoken、qid、sgm 等页面态。
   是否必须：否，默认使用 JD_COOKIE 与 gias 动态补齐后的 Cookie。
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
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东金融天天赚豆');

const USER_AGENT = DEFAULT_JR_USER_AGENT;
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const GIAS_SCRIPT_URL = 'https://gias.jd.com/js/m-tk.js';
const RISK_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;

const DAILY_PAGE_URL = 'https://fu.jr.jd.com/fq-free-channel/redenvelope/index.html?channel=zjdtc';
const DAILY_PAGE_ORIGIN = 'https://fu.jr.jd.com';
const DAILY_REWARD_URL = 'https://ms.jr.jd.com/gw2/generic/dailyR/h5/m/fetchUserDailyRewardV2';

const SHOW_PAGE_URL = 'https://show.jd.com/m/RkO0AE9rKrYy6ZDd/?pageKey=RkO0AE9rKrYy6ZDd&channel=01172&jrcontainer=h5&jrlogin=true';
const SHOW_PAGE_ORIGIN = 'https://show.jd.com';
const SHOW_PAGE_BUILD_DATA_URL = 'https://ms.jr.jd.com/gw/generic/aladdin/h5/m/buildVisualizeData';
const SHOW_PAGE_KEY = 'RkO0AE9rKrYy6ZDd';
const MISSION_RECEIVE_URL = 'https://ms.jr.jd.com/gw/generic/mission/h5/m/receiveMission';
const MISSION_DETAIL_URL = 'https://ms.jr.jd.com/gw2/generic/mission/h5/m/queryMissionDetail';
const MISSION_EXTERNAL_CONFIG_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/externalconfig';
const MISSION_JUMP_INFO_URL = 'https://ms.jr.jd.com/gw2/generic/mission/h5/m/getJumpInfo';
const MILEPOST_QUERY_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/queryMilePost';
const MILEPOST_AWARD_URL = 'https://ms.jr.jd.com/gw2/generic/Mission/h5/m/awardMilePostNode';

const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN = 'jdd01EYPTDC4JJOP4V6G54UFBKTIV7JHWK2GV7ILVE3BACLTOY3GJXDTR3ZWCCTQPGWW47ADZVEHYN2NGIV3TX33GDJO34RQARXG3XLG2TUQ01234567';
const DEFAULT_MILEPOST_TOKEN = 'TVBaZRYGYS';
const DEFAULT_MILEPOST_CHANNEL = 'CH202501131';
const DEFAULT_MILEPOST_ID = 115;
const MISSION_WAIT_MS = 10000;
const CHANGEFLOWAPP_DETAIL_RETRY_WAIT_MS = 8000;
const CHANGEFLOWAPP_DETAIL_QUERY_COUNT = 2;
const MISSION_SGM_PID = '9HwAEg@vlKkp7SqT8dSSBaj';

const DEFAULT_DETAIL_DEVICE_INFO = {
  channelInfo: 'appstore',
  clientVersion: '8.1.70',
  terminalType: '02',
  osVersion: '26.2',
  deviceType: 'iPhone14,5',
  appId: 'com.jd.jinrong',
  startNo: 0,
  eufv: '1',
  networkType: 'WIFI',
  resolution: '1170*2532',
  osPlatform: 'iOS',
  os: 'ios',
};

const CHANNEL_CONFIG_MAP = {
  CH202501131: {
    channelCode: 'CH202501131',
    queryStyle: 'json',
    origin: SHOW_PAGE_ORIGIN,
    referer: SHOW_PAGE_URL,
    cookieEnvKey: 'JDJR_TIANTIAN_ZHUAN_DOU_SHOW_FULL_COOKIE',
    pageType: 'show',
    signMode: 'pin',
  },
};

const cookies = Object.values(jdCookieNode).filter(Boolean);
let jsdomDeps = null;
let aar2ScriptPromise = null;
let giasScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_TIANTIAN_ZHUAN_DOU_DEBUG === '1';
}

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function buildMissionCookie(cookie, config) {
  const fullCookie =
    process.env[config?.cookieEnvKey || ''] ||
    process.env.JDJR_TIANTIAN_ZHUAN_DOU_FULL_COOKIE ||
    '';

  return fullCookie ? mergeCookieString(fullCookie, cookie) : cookie;
}

function generateMissionTraceId() {
  return `${Date.now()}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
}

function buildShowMissionHeaders() {
  const traceId = generateMissionTraceId();
  return {
    'x-mlaas-at': `wl=0&id=${traceId}&src=sgm-mobile`,
    'sgm-context': `${traceId};${traceId};false;${MISSION_SGM_PID}`,
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Priority: 'u=3, i',
  };
}

function buildMissionHeaders(config) {
  return buildShowMissionHeaders();
}

function getMissionPin(cookie) {
  return (
    getCookieValue(cookie, 'pwdt_id') ||
    getCookieValue(cookie, 'pin') ||
    getCookieValue(cookie, 'pt_pin') ||
    'X2002'
  );
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

function getAar2Script() {
  if (!aar2ScriptPromise) {
    aar2ScriptPromise = got.get(AAR2_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: DAILY_PAGE_URL,
      },
      timeout: {
        request: RISK_TIMEOUT_MS,
      },
    }).text();
  }

  return aar2ScriptPromise;
}

function getGiasScript() {
  if (!giasScriptPromise) {
    giasScriptPromise = got.get(GIAS_SCRIPT_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: DAILY_PAGE_URL,
      },
      timeout: {
        request: RISK_TIMEOUT_MS,
      },
    }).text();
  }

  return giasScriptPromise;
}

async function createRiskContext(cookie) {
  const { JSDOM, VirtualConsole } = loadJsdomDependencies();
  const [aar2Script, giasScript] = await Promise.all([getAar2Script(), getGiasScript()]);
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: DAILY_PAGE_URL,
    referrer: DAILY_PAGE_URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    resources: 'usable',
    virtualConsole,
  });

  try {
    const { window } = dom;
    patchRiskWindow(window);

    const cookieMap = parseCookieString(cookie);
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

    window.eval(giasScript);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gias 获取 jsToken 超时')), RISK_TIMEOUT_MS);
      window.getJsToken(() => {
        clearTimeout(timer);
        resolve();
      }, RISK_TIMEOUT_MS);
    });

    const deviceInfo = window.getJdEid?.() || {};
    const mergedCookie = mergeCookieString(
      cookie,
      Object.fromEntries(parseCookieString(window.document.cookie)),
    );

    return {
      dom,
      window,
      cookie: mergedCookie,
      deviceInfo,
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

function buildDailyRiskMap(cookie, riskContext) {
  const deviceInfo = riskContext?.deviceInfo || {};
  return {
    jsToken: process.env.JDJR_TIANTIAN_ZHUAN_DOU_JS_TOKEN || deviceInfo.jsToken || '',
    fp: process.env.JDJR_TIANTIAN_ZHUAN_DOU_FP || deviceInfo.fp || DEFAULT_FP,
    sdkToken: process.env.JDJR_TIANTIAN_ZHUAN_DOU_SDK_TOKEN || deviceInfo.sdkToken || DEFAULT_SDK_TOKEN,
    eid:
      process.env.JDJR_TIANTIAN_ZHUAN_DOU_EID ||
      deviceInfo.eid ||
      getCookieValue(cookie, 'equipmentId') ||
      getCookieValue(cookie, '3AB9D23F7A4B3C9B') ||
      '',
  };
}

function buildMissionDeviceInfo(cookie, riskContext, extra = {}) {
  const deviceInfo = riskContext?.deviceInfo || {};
  return {
    jsToken: '',
    fp: process.env.JDJR_TIANTIAN_ZHUAN_DOU_FP || DEFAULT_FP,
    sdkToken: process.env.JDJR_TIANTIAN_ZHUAN_DOU_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    eid:
      process.env.JDJR_TIANTIAN_ZHUAN_DOU_EID ||
      getCookieValue(cookie, 'equipmentId') ||
      getCookieValue(cookie, '3AB9D23F7A4B3C9B') ||
      deviceInfo.eid ||
      '',
    ...extra,
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

async function postForm(url, cookie, options = {}) {
  const {
    form,
    origin,
    referer,
    contentType = 'application/x-www-form-urlencoded;charset=UTF-8',
    extraHeaders = {},
  } = options;

  const response = await got.post(url, {
    body: typeof form === 'string' ? form : new URLSearchParams(form).toString(),
    headers: buildHeaders(cookie, {
      origin,
      referer,
      userAgent: USER_AGENT,
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

async function postBody(url, cookie, options = {}) {
  const {
    body,
    origin,
    referer,
    contentType = 'application/json;charset=utf-8',
    extraHeaders = {},
  } = options;

  const response = await got.post(url, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: buildHeaders(cookie, {
      origin,
      referer,
      userAgent: USER_AGENT,
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

async function getJson(url, cookie, options = {}) {
  const response = await got.get(url, {
    headers: buildHeaders(cookie, {
      origin: options.origin,
      referer: options.referer,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: options.extraHeaders || {},
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

function buildRewardSummary(awards) {
  if (!Array.isArray(awards) || !awards.length) {
    return '未知奖励';
  }

  return awards
    .map((item) => `${item.awardName || item.name || '奖励'}${item.awardNewNum || item.awardRealNum || item.awardNum || ''}${item.awardUnit || ''}`)
    .join(' + ');
}

function hasBeanReward(awards) {
  return Array.isArray(awards) && awards.some((item) => String(item.awardName || item.name || '').includes('京豆'));
}

async function queryDailyRewardStatus(cookie, riskContext) {
  const riskMap = buildDailyRiskMap(cookie, riskContext);
  const signText = JSON.stringify(riskMap);
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const form = new URLSearchParams();

  form.set('reqData', JSON.stringify({
    nonce,
    signature,
    signData: signText,
    extMap: riskMap,
    undertakeUserId: '',
    mediaSource: '',
    activityUrl: encodeURIComponent(DAILY_PAGE_URL),
    jsToken: riskMap,
    channel: '',
  }));

  return postForm(DAILY_REWARD_URL, cookie, {
    form,
    origin: DAILY_PAGE_ORIGIN,
    referer: `${DAILY_PAGE_ORIGIN}/`,
  });
}

async function queryShowPageBuildData(cookie, showPageUrl) {
  return postForm(SHOW_PAGE_BUILD_DATA_URL, cookie, {
    form: {
      reqData: JSON.stringify({
        pageIdStr: SHOW_PAGE_KEY,
        buildCodes: ['common'],
        engineType: 1,
      }),
    },
    origin: SHOW_PAGE_ORIGIN,
    referer: showPageUrl,
  });
}

function collectTaskCfgList(source, result = []) {
  if (Array.isArray(source)) {
    for (const item of source) {
      collectTaskCfgList(item, result);
    }
    return result;
  }

  if (!source || typeof source !== 'object') {
    return result;
  }

  const taskCfg = source?.data?.contentModel?.taskCfg;
  if (taskCfg) {
    result.push(typeof taskCfg === 'string' ? safeJsonParse(taskCfg, {}) : taskCfg);
  }

  for (const value of Object.values(source)) {
    collectTaskCfgList(value, result);
  }

  return result;
}

async function resolveShowPageTaskConfig(cookie, prefix) {
  const response = await queryShowPageBuildData(cookie, SHOW_PAGE_URL);
  const taskCfgList = collectTaskCfgList(response?.resultData?.data || {});
  const targetTaskCfg = taskCfgList.find((item) => item?.channelCode && Array.isArray(item?.missionList))
    || taskCfgList[0]
    || null;

  if (!targetTaskCfg) {
    $.log(`${prefix}: show页 taskCfg => 未找到`);
    return null;
  }

  const unifyIds = (targetTaskCfg.missionList || [])
    .map((item) => Number(item?.unifyId || 0))
    .filter((item) => item > 0);
  $.log(`${prefix}: show页 taskCfg => channelCode=${targetTaskCfg.channelCode || '-'} unifyIds=${unifyIds.join(',') || '-'}`);

  return {
    channelCode: targetTaskCfg.channelCode || DEFAULT_MILEPOST_CHANNEL,
    unifyIds,
    raw: targetTaskCfg,
    showPageUrl: SHOW_PAGE_URL,
  };
}

function resolveChannelConfig(channelCode) {
  return CHANNEL_CONFIG_MAP[channelCode] || CHANNEL_CONFIG_MAP[DEFAULT_MILEPOST_CHANNEL];
}

function extractMissionChannelCode(mission) {
  if (!mission || typeof mission !== 'object') {
    return '';
  }

  const directChannelCode =
    mission.channelCode ||
    mission.channelPublishCode ||
    mission.taskChannelId ||
    mission.channel ||
    '';
  if (/^CH\d+$/.test(String(directChannelCode))) {
    return String(directChannelCode);
  }

  const linkList = [mission.doLink, mission.doLinkFinish, mission.h5Url];
  for (const link of linkList) {
    if (!link || typeof link !== 'string') {
      continue;
    }

    try {
      const urlObject = new URL(link);
      const channelCode = urlObject.searchParams.get('channelCode') || '';
      if (/^CH\d+$/.test(channelCode)) {
        return channelCode;
      }
    } catch (error) {
    }
  }

  return '';
}

function buildMilepostRequest(cookie, riskContext, extra = {}) {
  return {
    source: 'mdH5Pagedeploy',
    token: process.env.JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_TOKEN || DEFAULT_MILEPOST_TOKEN,
    channelCode: process.env.JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_CHANNEL || DEFAULT_MILEPOST_CHANNEL,
    deviceInfo: buildMissionDeviceInfo(cookie, riskContext),
    ...extra,
  };
}

async function queryMilePost(cookie, riskContext, milepostConfig = {}) {
  const unifyIds = Array.isArray(milepostConfig.unifyIds) && milepostConfig.unifyIds.length
    ? milepostConfig.unifyIds
    : [Number(process.env.JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_ID || DEFAULT_MILEPOST_ID)];
  return postForm(MILEPOST_QUERY_URL, cookie, {
    form: {
      reqData: JSON.stringify(
        buildMilepostRequest(cookie, riskContext, {
          channelCode: milepostConfig.channelCode || process.env.JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_CHANNEL || DEFAULT_MILEPOST_CHANNEL,
          milePostIdList: unifyIds,
          systemEnv: 'IOS',
          queryMissionFlag: 2,
          schemaList: ['dianping://', 'freereader://', 'sinaweibo://browser', 'imeituan://', 'cn.10086.app://', 'iting://', 'kwai://'],
          missionFilterFlag: 1,
          reportFlag: true,
          extMap: {
            pid: 'RkO0AE9rKrYy6ZDd|rkangztddj',
            sessionId: String(Date.now()),
          },
        }),
      ),
    },
    origin: SHOW_PAGE_ORIGIN,
    referer: milepostConfig.showPageUrl || SHOW_PAGE_URL,
  });
}

async function awardMilePostNode(cookie, riskContext, number, milepostConfig = {}) {
  return postForm(MILEPOST_AWARD_URL, cookie, {
    form: {
      reqData: JSON.stringify(
        buildMilepostRequest(cookie, riskContext, {
          channelCode: milepostConfig.channelCode || process.env.JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_CHANNEL || DEFAULT_MILEPOST_CHANNEL,
          milePostId: Number(milepostConfig.unifyIds?.[0] || process.env.JDJR_TIANTIAN_ZHUAN_DOU_MILEPOST_ID || DEFAULT_MILEPOST_ID),
          number,
        }),
      ),
    },
    origin: SHOW_PAGE_ORIGIN,
    referer: milepostConfig.showPageUrl || SHOW_PAGE_URL,
  });
}

async function receiveMission(cookie, riskContext, config, missionId) {
  const missionCookie = buildMissionCookie(cookie, config);
  const payload = {
    channelCode: config.channelCode,
    missionId,
    deviceInfo: {
      ...buildMissionDeviceInfo(cookie, riskContext),
      os: 'ios',
    },
  };
  let signText = '';
  let signature = '';
  let nonce = '';

  if (config.signMode === 'pin') {
    signText = JSON.stringify({
      channelCode: config.channelCode,
      PIN: getMissionPin(cookie),
      missionId,
    });
    ({ nonce, signature } = signWithAar2(riskContext, signText));
  } else {
    signText = JSON.stringify(payload);
    ({ nonce, signature } = signWithAar2(riskContext, signText));
  }

  return postBody(MISSION_RECEIVE_URL, missionCookie, {
    body: {
      reqData: {
        ...payload,
        nonce,
        signature,
      },
    },
    origin: config.origin,
    referer: config.referer,
    contentType: 'application/json;charset=utf-8',
    extraHeaders: buildMissionHeaders(config),
  });
}

function isJumpMissionLink(url) {
  return String(url || '').includes('jumpmission-v2');
}

function isChangeflowappLink(url) {
  return String(url || '').includes('changeflowapp');
}

function resolveNativeJumpUrl(rawJumpUrl) {
  const text = String(rawJumpUrl || '');
  if (!text.startsWith('openApp.jdMobile://')) {
    return text;
  }

  try {
    const parsed = new URL(text);
    const paramsText = parsed.searchParams.get('params') || '';
    const params = safeJsonParse(paramsText, {});
    if (params?.url) {
      return String(params.url);
    }
  } catch (error) {
  }

  return text;
}

async function openUrlWithMissionHeaders(cookie, url, referer, config) {
  if (!url) {
    return null;
  }

  let urlObject;
  try {
    urlObject = new URL(url);
  } catch (error) {
    return null;
  }

  const missionCookie = buildMissionCookie(cookie, config);
  const response = await got.get(url, {
    headers: buildHeaders(missionCookie, {
      origin: urlObject.origin,
      referer,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: '*/*',
        ...buildMissionHeaders(config),
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
    body: response.body || '',
    url,
  };
}

async function getJumpMissionInfo(cookie, riskContext, mission, config) {
  let urlObject;
  try {
    urlObject = new URL(mission.doLink || '');
  } catch (error) {
    return {};
  }

  const juid = urlObject.searchParams.get('juid') || '';
  if (!juid) {
    return {};
  }

  const signText = JSON.stringify({
    juid,
    PIN: getMissionPin(cookie),
  });
  const { nonce, signature } = signWithAar2(riskContext, signText);
  const missionCookie = buildMissionCookie(cookie, config);
  const response = await got.get(MISSION_JUMP_INFO_URL, {
    searchParams: {
      juid,
      nonce,
      signature,
      jrAppVersion: '8.1.70',
      systemEnv: 'IOS',
    },
    headers: buildHeaders(missionCookie, {
      origin: 'https://show.jd.com',
      referer: mission.doLink,
      userAgent: USER_AGENT,
      contentType: '',
      extraHeaders: {
        Accept: 'application/json, text/plain, */*',
        ...buildMissionHeaders(config),
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function simulateJumpMissionVisit(cookie, riskContext, mission, config) {
  const openResult = await openUrlWithMissionHeaders(cookie, mission.doLink, config.referer, config);
  const jumpInfoResponse = await getJumpMissionInfo(cookie, riskContext, mission, config);
  const jumpData = jumpInfoResponse?.resultData?.data || {};
  const jumpUrl = resolveNativeJumpUrl(jumpData.jumpUrl);

  if (jumpUrl && /^https?:\/\//.test(jumpUrl)) {
    await openUrlWithMissionHeaders(cookie, jumpUrl, mission.doLink, config);
  }

  return {
    ...openResult,
    jumpInfoResponse,
    jumpUrl,
  };
}

async function simulateChangeflowappVisit(cookie, riskContext, mission, config) {
  const openResult = await openUrlWithMissionHeaders(cookie, mission.doLink, config.referer, config);
  const externalConfigResponse = await queryMissionExternalConfig(cookie, riskContext, mission);
  const externalData = externalConfigResponse?.resultData?.data || {};
  const targetUrl = externalData.h5Url || externalData.iosUrl || externalData.androidUrl || '';

  if (/^https?:\/\//.test(targetUrl)) {
    await openUrlWithMissionHeaders(cookie, targetUrl, mission.doLink, config);
  }

  return {
    ...openResult,
    externalConfigResponse,
    targetUrl,
  };
}

async function openMissionLink(cookie, riskContext, mission, config) {
  if (!mission?.doLink) {
    return null;
  }

  if (isJumpMissionLink(mission.doLink)) {
    return simulateJumpMissionVisit(cookie, riskContext, mission, config);
  }

  if (isChangeflowappLink(mission.doLink)) {
    return simulateChangeflowappVisit(cookie, riskContext, mission, config);
  }

  const urlObject = new URL(mission.doLink);
  const referer = urlObject.origin === DAILY_PAGE_ORIGIN ? `${DAILY_PAGE_ORIGIN}/` : SHOW_PAGE_URL;
  return openUrlWithMissionHeaders(cookie, mission.doLink, referer, config);
}

function canQueryMissionDetail(mission) {
  try {
    const urlObject = new URL(mission.doLink || '');
    return Boolean(urlObject.searchParams.get('code') && urlObject.searchParams.get('mid'));
  } catch (error) {
    return false;
  }
}

function buildMissionDetailPayload(cookie, riskContext, mission) {
  const urlObject = new URL(mission.doLink);
  const payload = {
    channelCode: mission.channelCode,
    missionId: String(mission.missionId),
    code: urlObject.searchParams.get('code'),
    deviceInfo: {
      ...DEFAULT_DETAIL_DEVICE_INFO,
      deviceId:
        process.env.JDJR_TIANTIAN_ZHUAN_DOU_DEVICE_ID ||
        getCookieValue(cookie, 'equipmentId') ||
        DEFAULT_DETAIL_DEVICE_INFO.deviceType,
    },
    timeStamp: new Date().toISOString(),
  };
  const signText = JSON.stringify(payload);
  const { nonce, signature } = signWithAar2(riskContext, signText);
  return {
    ...payload,
    nonce,
    signature,
  };
}

function buildMissionExternalConfigPayload(riskContext, mission) {
  const urlObject = new URL(mission.doLink);
  const payload = {
    channelCode: mission.channelCode,
    code: urlObject.searchParams.get('code') || '',
    mid: urlObject.searchParams.get('mid') || '',
  };
  const signText = JSON.stringify(payload);
  const { nonce, signature } = signWithAar2(riskContext, signText);
  return {
    ...payload,
    nonce,
    signature: String(signature || '').toUpperCase(),
  };
}

async function queryMissionExternalConfig(cookie, riskContext, mission) {
  const config = resolveChannelConfig(mission.channelCode);
  const missionCookie = buildMissionCookie(cookie, config);
  const payload = buildMissionExternalConfigPayload(riskContext, mission);
  const params = new URLSearchParams(payload);
  return getJson(`${MISSION_EXTERNAL_CONFIG_URL}?${params.toString()}`, missionCookie, {
    origin: new URL(mission.doLink).origin,
    referer: mission.doLink,
    extraHeaders: buildMissionHeaders(config),
  });
}

async function queryMissionDetail(cookie, riskContext, mission) {
  const payload = buildMissionDetailPayload(cookie, riskContext, mission);
  const reqData = encodeURIComponent(JSON.stringify(payload));
  const config = resolveChannelConfig(mission.channelCode);
  const missionCookie = buildMissionCookie(cookie, config);
  return getJson(`${MISSION_DETAIL_URL}?reqData=${reqData}`, missionCookie, {
    origin: new URL(mission.doLink).origin,
    referer: mission.doLink,
    extraHeaders: buildMissionHeaders(config),
  });
}

function extractMissionList(response) {
  return Array.isArray(response?.resultData?.data) ? response.resultData.data : [];
}

function findMissionById(list, missionId) {
  return list.find((item) => Number(item?.missionId) === Number(missionId)) || null;
}

async function verifyMission(cookie, riskContext, config, mission) {
  if (canQueryMissionDetail(mission)) {
    let lastResponse = null;
    await queryMissionExternalConfig(cookie, riskContext, mission);
    for (let index = 0; index < CHANGEFLOWAPP_DETAIL_QUERY_COUNT; index += 1) {
      if (index > 0) {
        await sleep(CHANGEFLOWAPP_DETAIL_RETRY_WAIT_MS);
      }
      lastResponse = await queryMissionDetail(cookie, riskContext, mission);
      if (Number(lastResponse?.resultData?.data?.status) === 2) {
        return lastResponse;
      }
    }
    return lastResponse;
  }

  if (mission?.milepostConfig) {
    const verifyResponse = await queryMilePost(cookie, riskContext, mission.milepostConfig);
    const milePostList = Array.isArray(verifyResponse?.resultData?.data) ? verifyResponse.resultData.data : [];
    const missionList = milePostList.flatMap((item) => Array.isArray(item?.missionList) ? item.missionList : []);
    const verifiedMission = findMissionById(missionList, mission.missionId) || {};
    return {
      resultData: {
        data: milePostList,
        mission: verifiedMission,
      },
    };
  }
  return {};
}

async function handleDailyReward(cookie, riskContext, prefix) {
  const response = await queryDailyRewardStatus(cookie, riskContext);
  const data = response?.resultData?.data || {};

  $.log(
    `${prefix}: 日常奖励状态 => couponAmount=${data.couponAmount || '-'} expandAmount=${data.expandAmount || '-'} rewardStatus=${data.rewardStatus ? 1 : 0} expandAble=${data.expandAble ? 1 : 0}`,
  );
  if (isDebugEnabled()) {
    $.log(`${prefix}: fetchUserDailyRewardV2 原始返回 => ${stringifySnippet(response, 1200)}`);
  }

  return data;
}

async function handleMilePost(cookie, riskContext, prefix, milepostConfig) {
  const response = await queryMilePost(cookie, riskContext, milepostConfig);
  const milePostList = Array.isArray(response?.resultData?.data) ? response.resultData.data : [];
  const progressSummary = milePostList
    .map((item) => {
      const currentFinishNum = Number(item?.currentFinishNum || 0);
      const targetFinishNum = Number(item?.targetFinishNum || 0);
      const currentNodeNum = Number(item?.currentNodeNum || 0);
      return `milePostId=${item?.milePostId || '-'} progress=${currentFinishNum}/${targetFinishNum} currentNode=${currentNodeNum}`;
    })
    .join(' | ');
  const claimableNodes = milePostList.flatMap((item) => {
    const currentFinishNum = Number(item?.currentFinishNum || 0);
    return (item?.milePostNodeList || []).filter((node) => {
      const targetFinishNum = Number(node?.targetFinishNum || 0);
      const isProgressReached = currentFinishNum >= targetFinishNum;
      const isClaimableStatus = Number(node?.nodeAwardStatus) === 2;
      return isClaimableStatus && isProgressReached && hasBeanReward(node.awards);
    });
  });

  $.log(`${prefix}: 里程碑进度 => ${progressSummary || '空'}`);
  $.log(`${prefix}: 可领奖里程碑节点数 => ${claimableNodes.length}`);
  for (const node of claimableNodes) {
    const awardResponse = await awardMilePostNode(cookie, riskContext, node.number, milepostConfig);
    const awardList = awardResponse?.resultData?.data?.nodeAwardInfoList || [];
    $.log(`${prefix}: 领取里程碑${node.number} => ${buildRewardSummary(awardList)}`);
    if (isDebugEnabled()) {
      $.log(`${prefix}: awardMilePostNode 原始返回 => ${stringifySnippet(awardResponse, 1200)}`);
    }
  }

  const missions = milePostList.flatMap((item) => {
    const missionList = Array.isArray(item?.missionList) ? item.missionList : [];
    return missionList.map((mission) => ({
      ...mission,
      channelCode: extractMissionChannelCode(mission) || mission.channelCode || milepostConfig.channelCode || DEFAULT_MILEPOST_CHANNEL,
      milepostConfig,
    }));
  });

  return missions;
}

function filterBeanMissions(list, channelCode) {
  return list
    .filter((item) => hasBeanReward(item.awards))
    .filter((item) => !isChangeflowappLink(item.doLink))
    .map((item) => ({
      ...item,
      channelCode: item.channelCode || channelCode,
    }));
}

async function handleMissionList(cookie, riskContext, missions, prefix) {
  const firstList = filterBeanMissions(missions, DEFAULT_MILEPOST_CHANNEL);
  $.log(`${prefix}: queryMilePost 京豆任务数 => ${firstList.length}`);

  for (const mission of firstList) {
    const config = resolveChannelConfig(mission.channelCode);
    if (Number(mission.status) === 2) {
      $.log(`${prefix}: 跳过已完成任务 => ${mission.name} | ${buildRewardSummary(mission.awards)}`);
      continue;
    }

    $.log(`${prefix}: 尝试任务 => ${mission.name} | missionId=${mission.missionId} | reward=${buildRewardSummary(mission.awards)}`);
    const receiveResponse = await receiveMission(cookie, riskContext, config, mission.missionId);
    const receiveCode = String(receiveResponse?.resultData?.code || receiveResponse?.resultCode || '');

    $.log(`${prefix}: 接取结果 => ${receiveResponse?.resultData?.msg || receiveResponse?.resultMsg || stringifySnippet(receiveResponse, 300)}`);
    if (receiveCode !== '0000') {
      continue;
    }

    if (mission.doLink) {
      const openResult = await openMissionLink(cookie, riskContext, mission, config);
      $.log(`${prefix}: 打开任务页 => ${mission.doLink} | status=${openResult?.statusCode || '-'}`);
    }

    await sleep(MISSION_WAIT_MS);
    const verifyResponse = await verifyMission(cookie, riskContext, config, mission);

    if (canQueryMissionDetail(mission)) {
      const detail = verifyResponse?.resultData?.data || {};
      $.log(
        `${prefix}: 任务复查 => ${mission.name} status=${detail.status ?? '-'} finishNum=${detail.finishNum ?? '-'} award=${buildRewardSummary(detail.awards)}`,
      );
    } else {
      const verifiedMission =
        verifyResponse?.resultData?.mission ||
        findMissionById(extractMissionList(verifyResponse), mission.missionId) ||
        {};
      $.log(
        `${prefix}: 任务复查 => ${mission.name} status=${verifiedMission.status ?? '-'} finishNum=${verifiedMission.finishNum ?? '-'} award=${buildRewardSummary(verifiedMission.awards || mission.awards)}`,
      );
    }

    if (isDebugEnabled()) {
      $.log(`${prefix}: 任务复查原始返回 => ${stringifySnippet(verifyResponse, 1500)}`);
    }
  }
}

async function runAccount(index, cookie) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  let riskContext = null;

  try {
    $.log(`\n==== ${prefix} ====`);
    riskContext = await createRiskContext(cookie);
    const showPageTaskConfig = await resolveShowPageTaskConfig(riskContext.cookie, prefix);
    await handleDailyReward(riskContext.cookie, riskContext, prefix);
    const milePostMissions = await handleMilePost(riskContext.cookie, riskContext, prefix, showPageTaskConfig || {});
    const missionChannels = [...new Set((milePostMissions || []).map((item) => item.channelCode).filter(Boolean))];
    if (missionChannels.length) {
      $.log(`${prefix}: queryMilePost 任务渠道 => ${missionChannels.join(',')}`);
    } else {
      $.log(`${prefix}: queryMilePost 任务渠道 => 未下发`);
    }
    await handleMissionList(riskContext.cookie, riskContext, milePostMissions || [], prefix);
  } catch (error) {
    $.log(`${prefix}: 执行异常 => ${error.message || error}`);
  } finally {
    closeRiskContext(riskContext);
  }
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效账号 Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    await runAccount(index + 1, cookies[index]);
  }
}

main()
  .catch((error) => $.log(`脚本异常：${error.message || error}`))
  .finally(() => $.done());
