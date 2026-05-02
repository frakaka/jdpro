/*
cron:21 0,12,18 * * * jd_yangdae_goose.js

环境变量说明：
1. JD_YANGDAE_FEED_TIMES
   含义：每个账号最多喂养次数。
   是否必须：否，默认 10 次。接口单次通常消耗 10g 饲料。

2. JD_YANGDAE_EID / JD_YANGDAE_FP / JD_YANGDAE_SDK_TOKEN
   含义：养大鹅风控参数 riskDeviceParam 中的 eid / fp / sdkToken。
   是否必须：否，默认使用当前 HAR 抓包中的可用值；风控失败时建议用京东金融 App 最新抓包值覆盖。

3. JD_YANGDAE_DEBUG
   含义：是否打印关键接口原始响应片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。

4. JD_YANGDAE_FEED_INTERVAL_MS / JD_YANGDAE_FEED_BLOCK_RETRY_MS / JD_YANGDAE_FEED_BLOCK_RETRY_TIMES
   含义：喂养成功后的间隔时间、命中 AAR 风控后的等待时间、单次喂养命中风控后的重试次数。
   是否必须：否，默认分别为 5000ms / 15000ms / 3。

HAR 对应说明：
1. 来源文件：files/traffic_baitiao_sign_and_yangdae_full_filtered.har
2. 已落地链路：
   - 养大鹅登录/查询：petLogin / foodCount
   - 养大鹅签到红包：newSign
   - 领取饲料：collectTieEgg / missionList / doMission / showFeedCan / receiveFeedCan
   - 养大鹅喂养：feeding
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
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('养大鹅');

const PAGE_URL = 'https://u.jr.jd.com/uc-fe-wxgrowing/cloudgoose/index/?channelLv=btkp&jrcontainer=h5&jrlogin=true&jrcloseweb=false';
const PAGE_ORIGIN = 'https://u.jr.jd.com';
const PAGE_REFERER = 'https://u.jr.jd.com/';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2-2.1.0.min.js';
const API_BASE_URL = 'https://ms.jr.jd.com/gw2/generic/gooseTown/h5/m';
const REQUEST_TIMEOUT_MS = 15000;
const RISK_TIMEOUT_MS = 10000;
const DEFAULT_EID = 'PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4';
const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN = 'jdd01QI7EZRAXIOPWEC2HOEN3UYK5JXTMS3K4NRSL4LRCKRSM3M2NSXCRRVYC4VCZKF64Z2VSR6OF6LGOD5G7LTJ2O4PJR5PTFO7WN3OAOOI01234567';
const CHANNEL_LV = 'btkp';
const SOURCE = 2;
const EXTRA_COOKIE_ENV = 'JD_YANGDAE_EXTRA_COOKIE';

const cookies = Object.values(jdCookieNode).filter(Boolean);

let jsdomDeps = null;
let aar2ScriptPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_YANGDAE_DEBUG === '1';
}

function getFeedLimit() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_TIMES || '10', 10);
  if (Number.isNaN(value) || value < 0) {
    return 10;
  }
  return value;
}

function getFeedIntervalMs() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_INTERVAL_MS || '5000', 10);
  if (Number.isNaN(value) || value < 0) {
    return 5000;
  }
  return value;
}

function getFeedBlockRetryMs() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_BLOCK_RETRY_MS || '15000', 10);
  if (Number.isNaN(value) || value < 0) {
    return 15000;
  }
  return value;
}

function getFeedBlockRetryTimes() {
  const value = Number.parseInt(process.env.JD_YANGDAE_FEED_BLOCK_RETRY_TIMES || '3', 10);
  if (Number.isNaN(value) || value < 0) {
    return 3;
  }
  return value;
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
  Object.defineProperty(window.screen, 'width', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: 844,
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

function createRiskDeviceParam() {
  return JSON.stringify({
    macAddress: '',
    imei: '',
    eid: process.env.JD_YANGDAE_EID || DEFAULT_EID,
    openUUID: '',
    uuid: '',
    traceIp: '',
    os: 'ios',
    osVersion: '26.2',
    appId: '',
    clientVersion: '8.1.70',
    resolution: '',
    channelInfo: '',
    networkType: '',
    startNo: 42,
    openid: '',
    token: '',
    sid: '',
    terminalType: '',
    longtitude: '',
    latitude: '',
    securityData: '',
    jscContent: '',
    fnHttpHead: '',
    receiveRequestTime: '',
    port: 80,
    appType: '',
    deviceType: '',
    fp: process.env.JD_YANGDAE_FP || DEFAULT_FP,
    ip: '',
    idfa: '',
    sdkToken: process.env.JD_YANGDAE_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    osv: '26.2',
  });
}

function withCommonParams(payload) {
  return {
    ...payload,
    channelLV: CHANNEL_LV,
    source: SOURCE,
  };
}

function signPayload(aar2Context, payload) {
  const signText = JSON.stringify(payload);
  const aar2 = new aar2Context.window.AAR2();
  const nonce = aar2.nonce();

  return {
    ...payload,
    aarSignData: signText,
    aarNonce: nonce,
    aarSignature: String(aar2.sign(signText, nonce) || '').toUpperCase(),
  };
}

function createHeaders(cookie, contentType) {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: PAGE_ORIGIN,
    Referer: PAGE_REFERER,
    'User-Agent': DEFAULT_JR_USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Content-Type': contentType,
  };
}

function createCookie(cookie) {
  return mergeCookieString(cookie, process.env[EXTRA_COOKIE_ENV] || '');
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

function readInnerResult(responseData) {
  return responseData?.resultData?.resultData || responseData?.resultData || responseData;
}

async function postJsonApi(cookie, apiName, payload, options = {}) {
  const requestPayload = options.sign ? signPayload(options.aar2Context, payload) : payload;
  const response = await got.post(`${API_BASE_URL}/${apiName}`, {
    json: requestPayload,
    headers: createHeaders(createCookie(cookie), 'application/json'),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const responseData = parseJrResponse(response.body);

  if (isDebugEnabled()) {
    console.log(`${apiName} 响应: ${stringifySnippet(responseData, 1200)}`);
  }

  return readInnerResult(responseData);
}

async function postReqDataFormApi(cookie, apiName, requestData) {
  const url = `${API_BASE_URL}/${apiName}?_=${Date.now()}`;
  const response = await got.post(url, {
    body: `reqData=${encodeURIComponent(JSON.stringify(requestData))}`,
    headers: createHeaders(createCookie(cookie), 'application/x-www-form-urlencoded;charset=UTF-8'),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const responseData = parseJrResponse(response.body);

  if (isDebugEnabled()) {
    console.log(`${apiName} 响应: ${stringifySnippet(responseData, 1200)}`);
  }

  return readInnerResult(responseData);
}

function createSignedRiskPayload(extra = {}) {
  return withCommonParams({
    ...extra,
    riskDeviceParam: createRiskDeviceParam(),
  });
}

function createPagePayload(extra = {}) {
  return createSignedRiskPayload({
    ...extra,
    qdPageId: 'cloudgoose',
    pageUrl: PAGE_URL,
    urlKey: '/uc-fe-wxgrowing/cloudgoose',
  });
}

async function petLogin(cookie) {
  const payload = createPagePayload({
    shareId: '',
    helpId: '',
    signId: '',
    awaken: 0,
  });
  return postJsonApi(cookie, 'petLogin', payload);
}

async function queryFoodCount(cookie) {
  return postJsonApi(cookie, 'foodCount', createSignedRiskPayload());
}

async function signIn(cookie, aar2Context) {
  const result = await postJsonApi(
    cookie,
    'newSign',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );
  const awards = Array.isArray(result.signAwardVoList)
    ? result.signAwardVoList.map((award) => `${award.awardAmount}${award.signAwardType === 2 ? '元红包' : 'g饲料'}`)
    : [];

  return {
    success: result.opResult === 0 || result.resultCode === 721,
    message: result.resultCode === 721
      ? '今日已签到'
      : (awards.length ? awards.join(' + ') : stringifySnippet(result, 300)),
  };
}

async function queryTiePageInfo(cookie) {
  return postJsonApi(
    cookie,
    'queryTiePageInfo',
    createPagePayload({
      automaticFlag: false,
    }),
  );
}

async function collectTieEgg(cookie, aar2Context) {
  const result = await postJsonApi(
    cookie,
    'collectTieEgg',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );

  return {
    success: result.opResult === 0 || result.resultCode === 501,
    message: result.opResult === 0
      ? `收蛋 ${result.numToday || 0}，饲料 ${result.foodNum || 0}g`
      : (result.resultMsg || '当前没有可收的蛋'),
  };
}

async function showFeedCan(cookie, aar2Context) {
  return postJsonApi(
    cookie,
    'showFeedCan',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );
}

async function receiveFeedCan(cookie, aar2Context) {
  const result = await postJsonApi(
    cookie,
    'receiveFeedCan',
    createSignedRiskPayload(),
    { sign: true, aar2Context },
  );

  return {
    success: result.opResult === 0,
    message: result.opResult === 0
      ? `领取阶段饲料 ${result.receiveFeedAmount || 0}g`
      : result.resultMsg || stringifySnippet(result, 300),
  };
}

async function claimMealMission(cookie, aar2Context) {
  const missionList = await postJsonApi(
    cookie,
    'missionList',
    createPagePayload({
      mdClickId: 'cloudgoose|renwu-main',
      os: 'ios',
      awaken: 0,
      useMoodPropYn: false,
    }),
    { sign: true, aar2Context },
  );
  const missions = Array.isArray(missionList.missions) ? missionList.missions : [];
  const claimableMission = missions.find((mission) => mission.takeAward || mission.operate === 1 || mission.status === 4);
  if (!claimableMission) {
    return '暂无可领取任务饲料';
  }

  const result = await postReqDataFormApi(cookie, 'doMission', signPayload(aar2Context, createPagePayload({
    source: SOURCE,
    mid: claimableMission.mid,
    type: claimableMission.type,
    gid: claimableMission.gid,
    mdClickId: '',
    os: 'ios',
  })));
  const award = result.award || (Array.isArray(result.awardList) ? result.awardList[0] : null) || {};
  if (result.opResult !== 0) {
    return `任务 ${claimableMission.missionName || claimableMission.gid}: ${result.resultMsg || claimableMission.buttonText || stringifySnippet(result, 200)}`;
  }

  return `任务 ${claimableMission.missionName || claimableMission.gid}: ${award.count || 0}${award.name || '饲料'}`;
}

function isAarBlocked(result) {
  return result?.resultCode === 3 || String(result?.resultMsg || '').includes('AAR');
}

async function feedOnce(cookie, aar2Context) {
  return postReqDataFormApi(cookie, 'feeding', signPayload(aar2Context, createSignedRiskPayload({
    fastYn: false,
  })));
}

async function feed(cookie, limit, aar2Context, currentFoodCount) {
  const messages = [];
  const feedIntervalMs = getFeedIntervalMs();
  const feedBlockRetryMs = getFeedBlockRetryMs();
  const feedBlockRetryTimes = getFeedBlockRetryTimes();
  let remainingFood = Number(currentFoodCount);
  const maxFeedByFood = Number.isNaN(remainingFood) ? limit : Math.floor(remainingFood / 10);
  const effectiveLimit = Math.max(0, Math.min(limit, maxFeedByFood));

  if (!Number.isNaN(remainingFood)) {
    messages.push(`按当前剩余饲料 ${remainingFood}g，本轮最多喂 ${effectiveLimit} 次`);
  }

  if (effectiveLimit <= 0) {
    messages.push('饲料不足 10g，跳过喂养');
    return messages;
  }

  for (let index = 0; index < effectiveLimit; index += 1) {
    let result = null;
    let hitRiskControl = false;

    for (let retry = 0; retry <= feedBlockRetryTimes; retry += 1) {
      result = await feedOnce(cookie, aar2Context);
      if (result.opResult === 0) {
        hitRiskControl = false;
        break;
      }
      if (!isAarBlocked(result) || retry === feedBlockRetryTimes) {
        hitRiskControl = isAarBlocked(result);
        break;
      }

      messages.push(`第${index + 1}次命中 AAR 风控，等待 ${Math.floor(feedBlockRetryMs / 1000)} 秒后重试`);
      await sleep(feedBlockRetryMs);
    }

    if (!result || result.opResult !== 0) {
      messages.push(`第${index + 1}次失败：${result.resultMsg || stringifySnippet(result, 200)}`);
      if (hitRiskControl) {
        messages.push('等待后仍被金融端 AAR 风控拦截');
      }
      break;
    }

    if (!Number.isNaN(Number(result.stillCount))) {
      remainingFood = Number(result.stillCount);
    }
    messages.push(`第${index + 1}次成功，剩余 ${result.stillCount ?? '未知'}g`);
    if (result.allowFeedingYn === false || Number(result.stillCount || 0) <= 0 || remainingFood < 10) {
      break;
    }

    if (index < effectiveLimit - 1) {
      await sleep(feedIntervalMs);
    }
  }

  return messages;
}

async function runForAccount(cookie, index, aar2Context) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const messages = [];

  try {
    const loginInfo = await petLogin(cookie);
    messages.push(`初始饲料 ${loginInfo.foodCount ?? '未知'}g`);

    const tiePageInfo = await queryTiePageInfo(cookie);
    messages.push(`收蛋按钮：${tiePageInfo.btnText || '未知'}`);

    const signResult = await signIn(cookie, aar2Context);
    messages.push(`签到红包/饲料：${signResult.message}`);

    if (String(tiePageInfo.btnText || '').includes('收蛋')) {
      const eggResult = await collectTieEgg(cookie, aar2Context);
      messages.push(eggResult.message);
    } else {
      messages.push('当前没有可收的蛋');
    }

    const missionMessage = await claimMealMission(cookie, aar2Context);
    messages.push(missionMessage);

    const feedCan = await showFeedCan(cookie, aar2Context);
    if (Number(feedCan.feedAmount || 0) > 0) {
      const receiveResult = await receiveFeedCan(cookie, aar2Context);
      messages.push(receiveResult.message);
    } else {
      messages.push('暂无阶段饲料可领取');
    }

    const foodInfo = await queryFoodCount(cookie);
    messages.push(`当前饲料 ${foodInfo.count ?? '未知'}g`);

    const feedMessages = await feed(cookie, getFeedLimit(), aar2Context, foodInfo.count);
    messages.push(feedMessages.length ? feedMessages.join('；') : '已跳过喂养');

    return `${prefix}: ${messages.join('；')}`;
  } catch (error) {
    return `${prefix}: 执行异常，${error.message || error}`;
  }
}

(async () => {
  if (!cookies.length) {
    $.log('未配置 JD_COOKIE');
    return;
  }

  const aar2Context = await createAar2Context();
  try {
    for (let index = 0; index < cookies.length; index += 1) {
      const message = await runForAccount(cookies[index], index + 1, aar2Context);
      $.log(message);
    }
  } finally {
    aar2Context.dom.window.close();
  }
})()
  .catch((error) => {
    $.log(`脚本异常：${error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
