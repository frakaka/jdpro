/*
cron:9 0 * * * jd_miao_song_bean.js

环境变量说明：
1. JD_MIAO_SONG_FULL_COOKIE
   含义：秒送/笔笔返页面完整 Cookie，优先用于活动接口，补齐 sdtoken、qid、joyytokem 等页面态。
   是否必须：否，默认使用 JD_COOKIE。

2. JD_MIAO_SONG_TASK_LIMIT
   含义：单次最多执行多少个京豆任务。
   是否必须：否，默认不限制。

3. JD_MIAO_SONG_BROWSE_WAIT_MS
   含义：任务页停留时长，单位毫秒。
   是否必须：否，默认 10000。

4. JD_MIAO_SONG_DEBUG
   含义：是否打印原始请求和响应片段。
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
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('秒送做任务领京豆');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const USER_AGENT = DEFAULT_JR_USER_AGENT;
const REQUEST_TIMEOUT_MS = 15000;
const PUBLIC_KEY_URL = 'https://ms.jr.jd.com/gw/generic/getRSAPublicKey';
const CRYPTICO_URL = 'https://libs.jd.com/vendors/jrsecstatic.jdpay.com/jr-sec-dev-static/cryptico.min.js';
const PAGE_URL = 'https://ipay.jd.com/';
const PAGE_ORIGIN = 'https://ipay.jd.com';

const QUERY_BUBBLE_URL = 'https://ms.jr.jd.com/gw2/generic/activFront/newh5/m/queryBubbleRebateZone';
const RECEIVE_PRIZE_URL = 'https://ms.jr.jd.com/gw2/generic/activFront/newh5/m/receiveOrderRebateZoneTakePrize';
const QUERY_MISSION_URL = 'https://ms.jr.jd.com/gw2/generic/activFront/newh5/m/queryOrderRebateZoneMissionList';
const TAKE_MISSION_URL = 'https://ms.jr.jd.com/gw2/generic/activFront/newh5/m/takeOrderRebateZoneMission';
const QUERY_POP_URL = 'https://ms.jr.jd.com/gw2/generic/activFront/newh5/m/queryPop';

let crypticoApiPromise = null;
let rsaPublicKeyPromise = null;

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_MIAO_SONG_DEBUG === '1';
}

function debugLog(accountLabel, title, value) {
  if (!isDebugEnabled()) {
    return;
  }
  console.log(`${accountLabel}: ${title} => ${stringifySnippet(value, 2000)}`);
}

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getBrowseWaitMs() {
  const raw = Number(process.env.JD_MIAO_SONG_BROWSE_WAIT_MS || 10000);
  return Number.isFinite(raw) && raw > 0 ? raw : 10000;
}

function getTaskLimit() {
  const raw = process.env.JD_MIAO_SONG_TASK_LIMIT;
  if (!raw) {
    return Number.POSITIVE_INFINITY;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function buildActivityCookie(baseCookie) {
  const fullCookie = process.env.JD_MIAO_SONG_FULL_COOKIE || '';
  if (fullCookie) {
    return mergeCookieString(baseCookie, fullCookie);
  }
  return baseCookie;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getRewardText(item) {
  const rewardFields = [
    item?.rewardDesc,
    item?.rewardName,
    item?.awardName,
    item?.showRewardDesc,
    item?.desc,
  ].filter(Boolean);

  if (rewardFields.length) {
    return rewardFields.join(' | ');
  }

  const rewardList = [
    ...normalizeArray(item?.rewardList),
    ...normalizeArray(item?.awardList),
    ...normalizeArray(item?.benefitList),
  ];

  const parts = rewardList
    .map((reward) => reward?.name || reward?.awardName || reward?.rewardName || reward?.desc || '')
    .filter(Boolean);

  return parts.join(' | ');
}

function isJingdouMission(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const text = [
    item?.name,
    item?.title,
    item?.detail,
    item?.subTitle,
    item?.desc,
    getRewardText(item),
  ]
    .filter(Boolean)
    .join(' | ');

  if (String(item.taskType || '') === 'JINGDOU') {
    return true;
  }

  return text.includes('京豆');
}

function isMissionPending(item) {
  const status = Number(item?.status);
  return status === -1 || status === 0;
}

function buildMissionSummary(item) {
  return [
    item?.name || item?.title || '未知任务',
    `missionId=${item?.missionId || '-'}`,
    `status=${item?.status ?? '-'}`,
    `reward=${getRewardText(item) || '-'}`,
  ].join(' | ');
}

function buildBubbleSummary(item) {
  return [
    `bubbleType=${item?.bubbleType || '-'}`,
    `todayCanTake=${item?.todayCanTake ? 1 : 0}`,
    `reward=${getRewardText(item) || '-'}`,
  ].join(' | ');
}

function parseMaybeJson(content) {
  const parsed = safeJsonParse(content, content);
  if (typeof parsed === 'string') {
    return safeJsonParse(parsed, parsed);
  }
  return parsed;
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
          Referer: PAGE_URL,
          Origin: PAGE_ORIGIN,
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
          throw new Error(`未获取到秒送活动公钥: ${stringifySnippet(response, 300)}`);
        }
        return JSON.parse(rawPublicKey);
      });
  }

  return rsaPublicKeyPromise;
}

async function createRequestCryptico() {
  const [cryptico, publicKey] = await Promise.all([getCrypticoApi(), getRsaPublicKey()]);
  cryptico.setPublicKeyString(JSON.stringify(publicKey));
  return cryptico;
}

async function createRiskContext(cookie, accountLabel) {
  try {
    const riskContext = await getGiasRiskContext(cookie, {
      pageUrl: PAGE_URL,
      bizId: 'activFront',
      userAgent: USER_AGENT,
    });
    return {
      jsToken: riskContext.jsToken || '',
      equipmentId: riskContext.equipmentId || '',
      cookie: riskContext.cookie || cookie,
      source: 'gias',
    };
  } catch (error) {
    console.log(`${accountLabel}: gias 获取失败，回退 Cookie 风控态 => ${error.message}`);
    const jsToken = getCookieValue(cookie, '3AB9D23F7A4B3CSS') || '';
    const equipmentId = getCookieValue(cookie, '3AB9D23F7A4B3C9B') || '';
    return {
      jsToken,
      equipmentId,
      cookie,
      source: 'cookie',
    };
  }
}

function buildDeviceInfoVo(riskContext) {
  return {
    appType: 6,
    jsToken: riskContext.jsToken || '',
    eid: riskContext.jsToken || '',
    eidToken: riskContext.jsToken || '',
    equipmentId: riskContext.equipmentId || '',
  };
}

async function callActivFrontApi(url, cookie, riskContext, plainParams, accountLabel) {
  const cryptico = await createRequestCryptico();
  const params = {
    ...plainParams,
    deviceInfoVo: buildDeviceInfoVo(riskContext),
  };

  const encrypted = cryptico.encryptData(JSON.stringify(params));
  const cipherText = encrypted?.cipher || encrypted?.ciphertext || '';
  if (!encrypted?.status || !cipherText) {
    throw new Error(`bodyEncrypt 生成失败: ${JSON.stringify(encrypted)}`);
  }

  const requestBody = {
    channelEncrypt: 1,
    bodyEncrypt: cipherText,
    cco: JSON.stringify({
      clientVersion: '1.0.0',
      client: 'h5',
      t: Date.now(),
      h5st: null,
      _stk: null,
    }),
    eidToken: riskContext.jsToken || '',
  };

  debugLog(accountLabel, `请求 ${url}`, requestBody);

  const response = await got.post(url, {
    body: JSON.stringify(requestBody),
    headers: buildHeaders(cookie, {
      origin: PAGE_ORIGIN,
      referer: PAGE_URL,
      userAgent: USER_AGENT,
      contentType: 'application/json;charset=UTF-8',
    }),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const parsed = safeJsonParse(response.body, {});
  debugLog(accountLabel, `响应 ${url}`, parsed);

  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}: ${stringifySnippet(parsed, 300)}`);
  }

  if (!parsed || parsed.success === false || (parsed.resultCode !== undefined && Number(parsed.resultCode) !== 0)) {
    const message = parsed?.resultMsg || parsed?.message || '接口返回失败';
    throw new Error(`${message}: ${stringifySnippet(parsed, 300)}`);
  }

  let data = parsed.resultData;
  if (parsed.channelEncrypt && typeof data === 'string') {
    const decrypted = cryptico.decryptData(data);
    if (!decrypted?.status || !decrypted?.plaintext) {
      throw new Error(`响应解密失败: ${stringifySnippet(decrypted, 300)}`);
    }
    data = parseMaybeJson(decrypted.plaintext);
  }

  if (typeof data === 'string') {
    data = parseMaybeJson(data);
  }

  return {
    raw: parsed,
    data,
  };
}

async function queryBubbleList(cookie, riskContext, accountLabel) {
  const response = await callActivFrontApi(QUERY_BUBBLE_URL, cookie, riskContext, {}, accountLabel);
  return normalizeArray(response?.data?.data || response?.data);
}

async function receiveBubblePrize(cookie, riskContext, bubble, accountLabel) {
  const params = {
    bubbleShow: {
      bubbleType: bubble?.bubbleType || '',
      bubbleDtoList: normalizeArray(bubble?.bubbleDtoList),
    },
  };
  return callActivFrontApi(RECEIVE_PRIZE_URL, cookie, riskContext, params, accountLabel);
}

async function queryMissionList(cookie, riskContext, taskType, accountLabel) {
  const response = await callActivFrontApi(
    QUERY_MISSION_URL,
    cookie,
    riskContext,
    { taskType: taskType || 'ALL' },
    accountLabel,
  );
  const payload = response?.data?.data || response?.data || {};
  return {
    missionList: normalizeArray(payload?.missionList),
    defaultMission: payload?.defaultMission || null,
    raw: payload,
  };
}

async function takeMission(cookie, riskContext, mission, accountLabel) {
  const params = {
    type: 'RECEIVE_MISSION',
    takeParam: {
      ...(mission?.takeParam || {}),
      taskSource: mission?.taskSource || 'taskFloor',
    },
  };
  return callActivFrontApi(TAKE_MISSION_URL, cookie, riskContext, params, accountLabel);
}

async function queryPop(cookie, riskContext, accountLabel) {
  try {
    const response = await callActivFrontApi(QUERY_POP_URL, cookie, riskContext, {}, accountLabel);
    return response?.data || {};
  } catch (error) {
    debugLog(accountLabel, 'queryPop 失败', error.message);
    return {};
  }
}

async function openTaskPage(mission, accountLabel) {
  const doLink = mission?.doLink || mission?.jumpUrl || '';
  if (!/^https?:\/\//i.test(doLink)) {
    console.log(`${accountLabel}: 任务跳转非 H5，跳过实际浏览 => ${doLink || '-'}`);
    return false;
  }

  const response = await got.get(doLink, {
    headers: {
      Referer: PAGE_URL,
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    },
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  console.log(`${accountLabel}: 打开任务页 => ${doLink} | status=${response.statusCode}`);
  return response.statusCode < 400;
}

async function handleBubbles(cookie, riskContext, accountLabel) {
  const bubbleList = await queryBubbleList(cookie, riskContext, accountLabel);
  const jingdouBubbles = bubbleList.filter((item) => item?.todayCanTake && getRewardText(item).includes('京豆'));

  if (!jingdouBubbles.length) {
    console.log(`${accountLabel}: 可领奖励气泡 => 0`);
    return;
  }

  console.log(`${accountLabel}: 可领奖励气泡 => ${jingdouBubbles.length}`);
  for (const bubble of jingdouBubbles) {
    console.log(`${accountLabel}: 尝试领奖气泡 => ${buildBubbleSummary(bubble)}`);
    try {
      const result = await receiveBubblePrize(cookie, riskContext, bubble, accountLabel);
      console.log(`${accountLabel}: 气泡领奖结果 => ${stringifySnippet(result?.data || result?.raw || {}, 500)}`);
    } catch (error) {
      console.log(`${accountLabel}: 气泡领奖失败 => ${error.message}`);
    }
  }
}

async function handleMissions(cookie, riskContext, accountLabel) {
  const taskLimit = getTaskLimit();
  const missionState = await queryMissionList(cookie, riskContext, 'ALL', accountLabel);
  const jingdouMissionList = missionState.missionList.filter(isJingdouMission);
  const pendingMissionList = jingdouMissionList.filter(isMissionPending).slice(0, taskLimit);

  const rewardSummary = jingdouMissionList.length
    ? jingdouMissionList.map(buildMissionSummary).join(' || ')
    : '未识别到京豆任务';
  console.log(`${accountLabel}: 京豆任务摘要 => ${rewardSummary}`);
  console.log(`${accountLabel}: 待执行京豆任务数 => ${pendingMissionList.length}`);

  let completedCount = 0;
  for (const mission of pendingMissionList) {
    console.log(`${accountLabel}: 尝试任务 => ${buildMissionSummary(mission)}`);
    try {
      if (mission?.takeParam) {
        const takeResult = await takeMission(cookie, riskContext, mission, accountLabel);
        console.log(`${accountLabel}: 接任务结果 => ${stringifySnippet(takeResult?.data || takeResult?.raw || {}, 500)}`);
      }

      await openTaskPage(mission, accountLabel);
      await sleep(getBrowseWaitMs());

      const refreshed = await queryMissionList(cookie, riskContext, 'ALL', accountLabel);
      const refreshedMission = refreshed.missionList.find((item) => String(item?.missionId) === String(mission?.missionId));
      console.log(
        `${accountLabel}: 任务复查 => ${refreshedMission ? buildMissionSummary(refreshedMission) : `${mission?.name || mission?.title || '未知任务'} 已从任务列表消失`}`,
      );
      if (!refreshedMission || Number(refreshedMission?.status) >= 1) {
        completedCount += 1;
      }
    } catch (error) {
      console.log(`${accountLabel}: 任务执行失败 => ${error.message}`);
    }
  }

  console.log(`${accountLabel}: 已完成京豆任务数 => ${completedCount}`);
}

async function handleAccount(cookie, index) {
  const accountLabel = `账号${index + 1} ${getUserName(cookie)}`;
  const activityCookie = buildActivityCookie(cookie);
  const riskContext = await createRiskContext(activityCookie, accountLabel);
  const requestCookie = riskContext.cookie || activityCookie;

  console.log(`\n==== ${accountLabel} ====`);
  console.log(`${accountLabel}: 风控态来源 => ${riskContext.source}`);

  await queryPop(requestCookie, riskContext, accountLabel);
  await handleBubbles(requestCookie, riskContext, accountLabel);
  await handleMissions(requestCookie, riskContext, accountLabel);
}

(async () => {
  if (!cookies.length) {
    console.log('未找到有效的 JD Cookie');
    return;
  }

  console.log(`共${cookies.length}个京东账号Cookie`);
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await handleAccount(cookies[index], index);
    } catch (error) {
      console.log(`账号${index + 1} 执行异常 => ${error.message}`);
    }
  }
})()
  .catch((error) => {
    console.log(`脚本执行异常 => ${error.message}`);
  })
  .finally(() => {
    $.done();
  });
