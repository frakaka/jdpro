/*
cron:29 0 * * * jd_jr_zhongcai_sign.js

环境变量说明：
1. JDJR_ZHONGCAI_FULL_COOKIE
   含义：可选的种菜活动完整 Cookie，会合并到 JD_COOKIE 上。
   是否必须：否，但只有 pt_key/pt_pin 时建议补充。

2. JDJR_ZHONGCAI_SDK_TOKEN
   含义：种菜接口 reqData.deviceInfo.sdkToken。
   是否必须：否，默认使用当前 HAR 样本值。

3. JDJR_ZHONGCAI_FP
   含义：种菜接口 reqData.deviceInfo.fp。
   是否必须：否，默认使用当前 HAR 样本值。

4. JDJR_ZHONGCAI_DEBUG
   含义：是否打印关键接口原始返回片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。

HAR 结论：
1. 当前 filtered HAR 里，能直接领京豆的 POST 闭环是：
   - manor/h5/m/sign
2. sign 返回 signAwardInfoVoList，样本为 1 个京豆。
3. manor/h5/m/queryLotteryMission 里还能看到 awardType=6 的京豆任务，但当前 HAR 未出现这些任务的完成领奖闭环。
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

const $ = new Env('种菜签到领京豆');

const PAGE_URL = 'https://u.jr.jd.com/uc-fe-wxgrowing/rich-farm/index.html?channel=table&jrtransparentbar=true&jrcontainer=h5&jrlogin=true';
const PAGE_ENTRY_URL = 'https://u.jr.jd.com/uc-fe-wxgrowing/rich-farm/index.html';
const PAGE_ORIGIN = 'https://u.jr.jd.com';
const PAGE_REFERER = 'https://u.jr.jd.com/';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';

const HOME_URL = 'https://ms.jr.jd.com/gw2/generic/manor/h5/m/home';
const QUERY_MISSION_URL = 'https://ms.jr.jd.com/gw2/generic/manor/h5/m/queryMission';
const QUERY_LOTTERY_MISSION_URL = 'https://ms.jr.jd.com/gw2/generic/manor/h5/m/queryLotteryMission';
const QUERY_RED_POINT_URL = 'https://ms.jr.jd.com/gw2/generic/manor/h5/m/queryRedPoint';
const QUERY_GAME_BLIND_BOX_REFRESH_URL = 'https://ms.jr.jd.com/gw2/generic/gamecenter/h5/m/queryGameBlindBoxRefresh';
const RANK_AWARD_PUSH_URL = 'https://ms.jr.jd.com/gw2/generic/gamecenter/h5/m/rankAwardPush';
const SIGN_URL = 'https://ms.jr.jd.com/gw2/generic/manor/h5/m/sign';

const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN = 'jdd01LNCWNYFRC2DPW3EE4TNVBO5OY47SOYKXLAU3EZ67A3WJLD6B2VI44OUHX6VUK6B4U63N6BMJTEVPXS4WKRF2CSMCRL5GXLFLASHG77I01234567';
const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;
const SOURCE_TYPE = '2';
const QD_PAGE_ID = 'WM';
const QD_PAGE_NAME = '种菜领现金';
const CHANNEL_CODE = 'table';

const cookies = Object.values(jdCookieNode).filter(Boolean);

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_ZHONGCAI_DEBUG === '1';
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

async function createRiskContext(cookie) {
  const cookieToken = getCookieValue(cookie, '3AB9D23F7A4B3CSS');
  const cookieFp = getCookieValue(cookie, 'fp') || getCookieValue(cookie, 'jrmfp');
  const cookieSdkToken = getCookieValue(cookie, 'sdkToken') || getCookieValue(cookie, 'jrmfs');

  try {
    const giasContext = await getGiasRiskContext(cookie, {
      pageUrl: PAGE_URL,
      bizId: 'u',
      userAgent: DEFAULT_JR_USER_AGENT,
    });
    return {
      cookie: giasContext.cookie || cookie,
      jsToken: giasContext.jsToken || getCookieValue(giasContext.cookie, '3AB9D23F7A4B3CSS') || cookieToken || '',
      fp: cookieFp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: cookieSdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    };
  } catch (error) {
    return {
      cookie,
      jsToken: cookieToken || '',
      fp: cookieFp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: cookieSdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
      giasError: error.message,
    };
  }
}

function buildPostHeaders(cookie) {
  return buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: DEFAULT_JR_USER_AGENT,
    extraHeaders: {
      Accept: 'application/json, text/plain, */*',
    },
  });
}

async function postReqData(url, cookie, payload) {
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify(payload));

  const response = await got.post(url, {
    body: form.toString(),
    headers: buildPostHeaders(cookie),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const text = response.body || '';
  return text ? safeJsonParse(text, text) : {};
}

function createBasePayload(riskContext) {
  return {
    sourceType: SOURCE_TYPE,
    qdPageId: QD_PAGE_ID,
    qdPageName: QD_PAGE_NAME,
    pageUrl: PAGE_ENTRY_URL,
    urlKey: PAGE_ENTRY_URL,
    deviceInfo: JSON.stringify({
      jsToken: riskContext.jsToken || '',
      fp: riskContext.fp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: riskContext.sdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    }),
  };
}

function createSignedPayload(aar2Context, payload) {
  const signText = JSON.stringify(payload);
  const { nonce, signature } = signWithAar2(aar2Context, signText);
  return {
    ...payload,
    nonce,
    signature,
    errorCode: '00000',
    type: '100',
    signData: signText,
  };
}

async function queryHome(cookie, riskContext, aar2Context) {
  const payload = createSignedPayload(aar2Context, {
    ...createBasePayload(riskContext),
    generalUserToken: '',
    shareType: '1',
    channelCode: CHANNEL_CODE,
  });
  return postReqData(HOME_URL, cookie, payload);
}

async function queryMission(cookie, riskContext) {
  return postReqData(QUERY_MISSION_URL, cookie, {
    ...createBasePayload(riskContext),
    mdClickId: 'tab_earn',
    channelCode: CHANNEL_CODE,
  });
}

async function queryLotteryMission(cookie, riskContext) {
  return postReqData(QUERY_LOTTERY_MISSION_URL, cookie, createBasePayload(riskContext));
}

async function queryRedPoint(cookie, aar2Context) {
  const basePayload = {
    sourceType: SOURCE_TYPE,
    qdPageId: QD_PAGE_ID,
    qdPageName: QD_PAGE_NAME,
    pageUrl: PAGE_ENTRY_URL,
    urlKey: PAGE_ENTRY_URL,
  };
  const payload = createSignedPayload(aar2Context, basePayload);
  return postReqData(QUERY_RED_POINT_URL, cookie, payload);
}

async function queryGameBlindBoxRefresh(cookie, riskContext) {
  return postReqData(QUERY_GAME_BLIND_BOX_REFRESH_URL, cookie, {
    rankAwardYn: false,
    uri: '/uc-fe-wxgrowing/rich-farm/index.html',
    channelLv: CHANNEL_CODE,
    queryRank: false,
    parameters: {
      urlKey: '/uc-fe-wxgrowing/rich-farm/index.html',
      qdPageId: 'BWBZ',
      qdPageName: '边玩边赚-新版',
    },
    deviceInfo: {
      jsToken: riskContext.jsToken || '',
      fp: riskContext.fp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: riskContext.sdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    },
    device: {
      jsToken: riskContext.jsToken || '',
      fp: riskContext.fp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: riskContext.sdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    },
  });
}

async function rankAwardPush(cookie, riskContext) {
  return postReqData(RANK_AWARD_PUSH_URL, cookie, {
    pin: '',
    deviceInfo: {
      jsToken: riskContext.jsToken || '',
      fp: riskContext.fp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: riskContext.sdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    },
    device: {
      jsToken: riskContext.jsToken || '',
      fp: riskContext.fp || process.env.JDJR_ZHONGCAI_FP || DEFAULT_FP,
      sdkToken: riskContext.sdkToken || process.env.JDJR_ZHONGCAI_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    },
  });
}

async function doSign(cookie, riskContext, aar2Context) {
  const payload = createSignedPayload(aar2Context, {
    ...createBasePayload(riskContext),
    mdClickId: 'VM|bonus_btn',
  });
  return postReqData(SIGN_URL, cookie, payload);
}

function isApiSuccess(response) {
  return Number(response?.resultCode) === 0 && String(response?.resultData?.code || '') === '0000';
}

function formatBeanAwards(awardList) {
  if (!Array.isArray(awardList) || !awardList.length) {
    return '-';
  }
  return awardList
    .map((item) => `${item?.num ?? item?.awardNum ?? '-'}${item?.awardName || '奖励'}`)
    .join(' + ');
}

function formatMissionRewards(missionAwardList) {
  if (!Array.isArray(missionAwardList) || !missionAwardList.length) {
    return '-';
  }
  return missionAwardList
    .map((item) => {
      const name = item?.awardName || (Number(item?.awardType) === 6 ? '京豆' : `awardType=${item?.awardType}`);
      return `${item?.awardNum ?? item?.num ?? '-'}${name}`;
    })
    .join(' + ');
}

function summarizeMissionInfoList(list) {
  if (!Array.isArray(list) || !list.length) {
    return '无任务';
  }
  return list
    .slice(0, 10)
    .map((item) => `${item?.name || '任务'} ${item?.currentProgress ?? 0}/${item?.targetProgress ?? '-'} reward=${formatMissionRewards(item?.missionAwardList)} status=${item?.status ?? '-'}`)
    .join(' | ');
}

function filterBeanLotteryMissions(response) {
  const list = response?.resultData?.data?.missionInfoVoList;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((item) =>
    Array.isArray(item?.missionAwardList) &&
    item.missionAwardList.some((award) => Number(award?.awardType) === 6)
  );
}

function summarizeLotteryKeys(response) {
  const pushList = response?.resultData?.data?.pushUserDataVoList;
  if (!Array.isArray(pushList) || !pushList.length) {
    return '无抽奖钥匙信息';
  }
  return pushList
    .map((item) => `${item?.sceneCode || 'scene'}=${item?.remainKeys ?? 0}`)
    .join(' | ');
}

function summarizeBlindBoxState(response) {
  const data = response?.resultData?.data || {};
  const boxList = Array.isArray(data.boxDetailList) ? data.boxDetailList : [];
  const rewardSummary = boxList
    .map((item) => `${item?.gameTime ?? '-'}s:${item?.boxAwardVO?.name || '未知奖励'}${item?.boxAwardVO?.takenYn ? '(已领)' : ''}`)
    .join(' | ');
  return `gameCode=${data.gameCode || '-'} | alsoObtain=${data.alsoObtain ?? '-'} | obtained=${data.obtained ?? '-'} | waitOpen=${data.waitOpen ?? '-'} | 盲盒=${rewardSummary || '-'}`;
}

async function runAccount(index, cookie) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const fullCookie = process.env.JDJR_ZHONGCAI_FULL_COOKIE || '';
  const mergedCookie = fullCookie ? mergeCookieString(cookie, fullCookie) : cookie;
  let aar2Context = null;

  try {
    console.log(`\n==== ${prefix} ====`);
    const riskContext = await createRiskContext(mergedCookie);
    if (riskContext.giasError) {
      console.log(`${prefix}: gias 获取失败，回退 Cookie 风控态 => ${riskContext.giasError}`);
    }

    aar2Context = await createAar2Context();

    const homeResult = await queryHome(riskContext.cookie, riskContext, aar2Context);
    if (isDebugEnabled()) {
      console.log(`${prefix}: home 原始返回 => ${stringifySnippet(homeResult, 1200)}`);
    }
    if (!isApiSuccess(homeResult)) {
      console.log(`${prefix}: home 失败 => ${stringifySnippet(homeResult, 800)}`);
      return;
    }

    const orderInfo = homeResult?.resultData?.data?.orderInfo || {};
    console.log(
      `${prefix}: 当前种植订单 => orderNo=${orderInfo.orderNo || '-'} | 目标元宝=${orderInfo.targetYbAmount ?? '-'} | 额外元宝=${orderInfo.additionalYbAmount ?? '-'}`
    );

    const missionResult = await queryMission(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryMission 原始返回 => ${stringifySnippet(missionResult, 1200)}`);
    }
    if (isApiSuccess(missionResult)) {
      const normalList = missionResult?.resultData?.data?.missionInfoVoList || [];
      console.log(`${prefix}: 普通任务数 => ${normalList.length}`);
      console.log(`${prefix}: 普通任务摘要 => ${summarizeMissionInfoList(normalList)}`);
    } else {
      console.log(`${prefix}: queryMission 失败 => ${stringifySnippet(missionResult, 800)}`);
    }

    const lotteryMissionResult = await queryLotteryMission(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryLotteryMission 原始返回 => ${stringifySnippet(lotteryMissionResult, 1200)}`);
    }
    if (isApiSuccess(lotteryMissionResult)) {
      const beanLotteryMissions = filterBeanLotteryMissions(lotteryMissionResult);
      console.log(`${prefix}: 抽奖京豆任务数 => ${beanLotteryMissions.length}`);
      console.log(`${prefix}: 抽奖京豆任务摘要 => ${summarizeMissionInfoList(beanLotteryMissions)}`);

      const redPointResult = await queryRedPoint(riskContext.cookie, aar2Context);
      if (isDebugEnabled()) {
        console.log(`${prefix}: queryRedPoint 原始返回 => ${stringifySnippet(redPointResult, 1200)}`);
      }
      if (isApiSuccess(redPointResult)) {
        console.log(`${prefix}: 抽奖钥匙状态 => ${summarizeLotteryKeys(redPointResult)}`);
      } else {
        console.log(`${prefix}: queryRedPoint 失败 => ${stringifySnippet(redPointResult, 800)}`);
      }

      const blindBoxResult = await queryGameBlindBoxRefresh(riskContext.cookie, riskContext);
      if (isDebugEnabled()) {
        console.log(`${prefix}: queryGameBlindBoxRefresh 原始返回 => ${stringifySnippet(blindBoxResult, 1200)}`);
      }
      if (isApiSuccess(blindBoxResult)) {
        console.log(`${prefix}: 抽奖盲盒状态 => ${summarizeBlindBoxState(blindBoxResult)}`);
      } else {
        console.log(`${prefix}: queryGameBlindBoxRefresh 失败 => ${stringifySnippet(blindBoxResult, 800)}`);
      }

      const rankAwardResult = await rankAwardPush(riskContext.cookie, riskContext);
      if (isDebugEnabled()) {
        console.log(`${prefix}: rankAwardPush 原始返回 => ${stringifySnippet(rankAwardResult, 1200)}`);
      }
      if (isApiSuccess(rankAwardResult)) {
        console.log(`${prefix}: 抽奖阶段推送上报 => 成功`);
      } else {
        console.log(`${prefix}: rankAwardPush 失败 => ${stringifySnippet(rankAwardResult, 800)}`);
      }
    } else {
      console.log(`${prefix}: queryLotteryMission 失败 => ${stringifySnippet(lotteryMissionResult, 800)}`);
    }

    const signResult = await doSign(riskContext.cookie, riskContext, aar2Context);
    if (isDebugEnabled()) {
      console.log(`${prefix}: sign 原始返回 => ${stringifySnippet(signResult, 1200)}`);
    }
    if (isApiSuccess(signResult)) {
      const awardList = signResult?.resultData?.data?.signAwardInfoVoList || [];
      const day = signResult?.resultData?.data?.day ?? '-';
      console.log(`${prefix}: 签到成功 => 第${day}天 | 奖励=${formatBeanAwards(awardList)}`);
    } else {
      console.log(`${prefix}: 签到失败/可能已签到 => ${stringifySnippet(signResult, 800)}`);
    }
  } catch (error) {
    console.log(`${prefix}: 执行异常 => ${error.message}`);
  } finally {
    if (aar2Context?.window?.close) {
      aar2Context.window.close();
    }
  }
}

(async () => {
  if (!cookies.length) {
    console.log('未找到有效的 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index];
    if (!cookie) {
      continue;
    }
    await runAccount(index + 1, cookie);
  }
})()
  .catch((error) => {
    console.log(`脚本异常 => ${error.message}`);
  })
  .finally(() => {
    $.done();
  });
