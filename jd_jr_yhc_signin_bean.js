/*
cron:14 0 * * * jd_jr_yhc_signin_bean.js

环境变量说明：
1. JD_JR_JS_TOKEN
   含义：京东金融请求里的 jsToken。
   是否必须：否，未配置时使用脚本内 DEFAULT_JS_TOKEN。
   如何覆盖：在青龙新增同名环境变量，值写最新抓包 token。

2. JD_JR_SDK_TOKEN
   含义：京东金融请求里的 sdkToken。
   是否必须：否，未配置时使用脚本内 DEFAULT_SDK_TOKEN。
   如何覆盖：在青龙新增同名环境变量，值写最新抓包 token。

3. JD_JR_EID_TOKEN
   含义：京东金融请求里的 eidToken。
   是否必须：否，未配置时默认跟随 JD_JR_JS_TOKEN。
   如何覆盖：在青龙新增同名环境变量，值写最新抓包 token。

4. JD_JR_CHANNEL_SOURCE / JD_JR_OS / JD_JR_APP / JD_JR_LANG
   含义：构造请求体时使用的基础业务字段。
   是否必须：否，默认分别为 QBYE / iOS / jdjr / ZH。
   如何覆盖：在青龙新增同名环境变量即可，通常不建议随意改。

5. JD_JR_SIGN_AND_AWARD_REQUEST
   含义：直接覆盖 signAndAward 整个请求体。
   是否必须：否，未配置时脚本动态生成 h5st 和 bodyEncrypt。
   如何覆盖：传合法 JSON 字符串，配置后脚本不再自动生成这一包。

6. JD_JR_QUERY_CAN_TAKE_PRIZE_REQUEST
   含义：直接覆盖 queryCanTakePrize 整个请求体。
   是否必须：否，未配置时脚本按 activityId 动态生成，或直接跳过。
   如何覆盖：传合法 JSON 字符串，配置后脚本不再自动生成这一包。

7. JD_JR_QUERY_CAN_TAKE_PRIZE_ACTIVITY_ID
   含义：动态生成 queryCanTakePrize 时使用的 activityId。
   是否必须：否；未配置且也没有 JD_JR_QUERY_CAN_TAKE_PRIZE_REQUEST 时，脚本会跳过该接口。
   如何覆盖：在青龙新增同名环境变量，值写最新 activityId。

8. JD_JR_QUERY_CAN_TAKE_PRIZE_SCENE_TYPE / JD_JR_QUERY_CAN_TAKE_PRIZE_SOURCE
   含义：动态生成 queryCanTakePrize 时附带的 sceneType、source。
   是否必须：否，sceneType 默认 SIGNIN_POPUP，source 默认不传。
   如何覆盖：在青龙新增同名环境变量即可。
*/

'use strict';

const Module = require('module');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const $ = new Env('银行卡签到领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const HISTORY_URL = 'https://ms.jr.jd.com/gw2/generic/bankcard/newh5/m/signInHistoryQuery';
const SIGN_URL = 'https://ms.jr.jd.com/gw2/generic/bankcard/newh5/m/signAndAward';
const PRIZE_URL = 'https://ms.jr.jd.com/gw2/generic/bankcard/newh5/m/queryCanTakePrize';
const PUBLIC_KEY_URL = 'https://ms.jr.jd.com/gw/generic/getRSAPublicKey';
const CRYPTICO_URL = 'https://libs.jd.com/vendors/jrsecstatic.jdpay.com/jr-sec-dev-static/cryptico.min.js';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 clientVersion=8.2.20&deviceType=iPhone14,5&appBuild=1248&client=ios&partner=jdpay&supportJDSHWK/1';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHINA_LOCALE = 'zh-CN';
const CHINA_TIME_ZONE = 'Asia/Shanghai';
const H5ST_APP_ID = '6e708';
const H5ST_VERSION = '4.1';
const H5_CLIENT = 'h5';
const H5_CLIENT_VERSION = '1.0.0';
const DEFAULT_CHANNEL_SOURCE = 'QBYE';
const DEFAULT_OS = 'iOS';
const DEFAULT_APP = 'jdjr';
const DEFAULT_LANG = 'ZH';
const DEFAULT_PRIZE_SCENE_TYPE = 'SIGNIN_POPUP';
const DEFAULT_JS_TOKEN = 'jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5S4HNMHIAAAAAD2I3CYGSZ4YJAQX';
const DEFAULT_SDK_TOKEN = 'jdd01XGIGJDIABAZ2O2OHXEWFLECMXVTG3S4Q5ZNMUVE5ROKURM7WUG2VDKRRHLQG2I22XDVJ427DN6FVJV5SHMP3IIKIUK7HEU6JQYOG35A01234567';

const cookies = Object.values(jdCookieNode).filter(Boolean);
let h5stFactory = null;
let crypticoApiPromise = null;
let rsaPublicKeyPromise = null;
let h5stShimInstalled = false;

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

$.log('', `🔔${$.name}, 开始!`);

function getUserName(cookie) {
  const match = cookie.match(/pt_pin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '未知账号';
}

function getBaseHeaders(cookie) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: 'https://ipay.jd.com',
    Referer: 'https://ipay.jd.com/',
    Cookie: cookie,
    'User-Agent': USER_AGENT,
  };
}

function installDateFnsShim() {
  if (h5stShimInstalled) {
    return;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'date-fns') {
      return { format: formatH5stDate };
    }
    return originalLoad.apply(this, arguments);
  };
  h5stShimInstalled = true;
}

function padNumber(value, length = 2) {
  return String(value).padStart(length, '0');
}

function formatH5stDate(date, pattern) {
  const current = new Date(date);
  return pattern
    .replace('yyyy', String(current.getFullYear()))
    .replace('MM', padNumber(current.getMonth() + 1))
    .replace('dd', padNumber(current.getDate()))
    .replace('HH', padNumber(current.getHours()))
    .replace('mm', padNumber(current.getMinutes()))
    .replace('ss', padNumber(current.getSeconds()))
    .replace('SSS', padNumber(current.getMilliseconds(), 3));
}

function getH5stFactory() {
  if (h5stFactory) {
    return h5stFactory;
  }

  installDateFnsShim();
  h5stFactory = require('./function/h5st41.js');
  return h5stFactory;
}

function getTokenConfig() {
  const jsToken = process.env.JD_JR_JS_TOKEN || DEFAULT_JS_TOKEN;
  const sdkToken = process.env.JD_JR_SDK_TOKEN || DEFAULT_SDK_TOKEN;
  const eidToken = process.env.JD_JR_EID_TOKEN || jsToken;

  return {
    jsToken,
    sdkToken,
    eidToken,
  };
}

function createBaseBusinessData() {
  const tokenConfig = getTokenConfig();
  return {
    channelSource: process.env.JD_JR_CHANNEL_SOURCE || DEFAULT_CHANNEL_SOURCE,
    os: process.env.JD_JR_OS || DEFAULT_OS,
    app: process.env.JD_JR_APP || DEFAULT_APP,
    lang: process.env.JD_JR_LANG || DEFAULT_LANG,
    jsToken: tokenConfig.jsToken,
    sdkToken: tokenConfig.sdkToken,
  };
}

async function getH5stSigner() {
  const H5ST = getH5stFactory();
  const signer = new H5ST({
    appId: H5ST_APP_ID,
    appid: H5ST_APP_ID,
    pin: '',
    ua: USER_AGENT,
    version: H5ST_VERSION,
  });

  await signer.genAlgo();
  return signer;
}

async function getCrypticoApi() {
  if (!crypticoApiPromise) {
    crypticoApiPromise = got
      .get(CRYPTICO_URL, {
        timeout: {
          request: 15000,
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
        const cryptico = loadCryptico.call({}, localStorageStore, documentObject);
        return cryptico;
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
          Referer: 'https://ipay.jd.com/',
          'User-Agent': USER_AGENT,
        },
        timeout: {
          request: 15000,
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
  if (!encrypted?.status || !encrypted.cipher) {
    throw new Error(`京东金融 bodyEncrypt 生成失败: ${JSON.stringify(encrypted)}`);
  }
  return encrypted.cipher;
}

async function buildCco(url, data) {
  const signer = await getH5stSigner();
  const query = await signer.genUrlParams(url, data, true);
  const queryParams = new URLSearchParams(query);
  const h5st = queryParams.get('h5st');
  const t = Number(queryParams.get('t')) || Date.now();
  if (!h5st) {
    throw new Error('h5st 生成失败');
  }

  return {
    clientVersion: H5_CLIENT_VERSION,
    client: H5_CLIENT,
    t,
    h5st,
    _stk: Object.keys(data).join(','),
  };
}

function buildHistoryRequest() {
  const baseBusinessData = createBaseBusinessData();
  const { eidToken } = getTokenConfig();
  const now = Date.now();

  return {
    reqData: JSON.stringify(baseBusinessData),
    cco: JSON.stringify({
      clientVersion: H5_CLIENT_VERSION,
      client: H5_CLIENT,
      t: now,
      h5st: null,
      _stk: null,
    }),
    eidToken,
  };
}

function readJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} 不是合法 JSON`);
  }
}

async function buildEncryptedGatewayRequest(url, extraData = {}) {
  const reqDataPlain = {
    ...createBaseBusinessData(),
    ...extraData,
  };
  const { eidToken } = getTokenConfig();
  const [bodyEncrypt, cco] = await Promise.all([
    encryptBusinessData(reqDataPlain),
    buildCco(url, reqDataPlain),
  ]);

  return {
    reqData: JSON.stringify({
      channelEncrypt: 1,
      bodyEncrypt,
    }),
    cco: JSON.stringify(cco),
    eidToken,
  };
}

async function buildSignRequest() {
  const customRequest = readJsonEnv('JD_JR_SIGN_AND_AWARD_REQUEST');
  if (customRequest) {
    return customRequest;
  }
  return buildEncryptedGatewayRequest(SIGN_URL);
}

async function buildPrizeRequest() {
  const customRequest = readJsonEnv('JD_JR_QUERY_CAN_TAKE_PRIZE_REQUEST');
  if (customRequest) {
    return customRequest;
  }

  const activityId = process.env.JD_JR_QUERY_CAN_TAKE_PRIZE_ACTIVITY_ID;
  if (!activityId) {
    return null;
  }

  const extraData = {
    sceneType: process.env.JD_JR_QUERY_CAN_TAKE_PRIZE_SCENE_TYPE || DEFAULT_PRIZE_SCENE_TYPE,
    activityId,
  };

  const source = process.env.JD_JR_QUERY_CAN_TAKE_PRIZE_SOURCE;
  if (source) {
    extraData.source = source;
  }

  return buildEncryptedGatewayRequest(PRIZE_URL, extraData);
}

async function postJson(url, cookie, body) {
  const response = await got.post(url, {
    headers: getBaseHeaders(cookie),
    json: body,
    timeout: {
      request: 15000,
    },
    throwHttpErrors: false,
  });

  return JSON.parse(response.body);
}

function extractHistoryData(response) {
  return response?.resultData?.data?.signInHistoryData?.planSignDayStateList || [];
}

function extractServerTime(response) {
  return response?.resultData?.data?.serverTimeMills || Date.now();
}

function findCurrentDay(days, serverTime) {
  const current = days
    .filter((item) => typeof item.signDate === 'number' && item.signDate <= serverTime)
    .sort((left, right) => right.signDate - left.signDate)[0];

  if (current) {
    return current;
  }

  return days[0] || null;
}

function formatRewardList(awardInfoList = []) {
  return awardInfoList
    .map((item) => {
      const count = item.awardNewNum ? `${item.awardNewNum}x` : '';
      return `${count}${item.awardName}`;
    })
    .join('，') || '无奖励信息';
}

function formatChinaDate(timestamp) {
  return new Intl.DateTimeFormat(CHINA_LOCALE, {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

function formatChinaDateTime(timestamp) {
  return new Intl.DateTimeFormat(CHINA_LOCALE, {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function formatHistorySummary(days, serverTime) {
  return days
    .map((item) => {
      const currentMarker = serverTime >= item.signDate && serverTime < item.signDate + DAY_MS ? '*' : ' ';
      const dayText = formatChinaDate(item.signDate);
      return `${currentMarker}${dayText} sign=${item.isSign ? 1 : 0} award=${item.isAward ? 1 : 0} reward=${formatRewardList(item.awardInfoList)}`;
    })
    .join(' | ');
}

function getCurrentStatusText(day) {
  if (!day) {
    return '未识别到当天签到项';
  }

  return [
    `signDate=${formatChinaDateTime(day.signDate)}`,
    `isSign=${day.isSign ? 1 : 0}`,
    `isAward=${day.isAward ? 1 : 0}`,
    `reward=${formatRewardList(day.awardInfoList)}`,
  ].join('，');
}

async function handleAccount(cookie, index) {
  const userName = getUserName(cookie);
  const lines = [];
  const prefix = `账号${index} ${userName}`;

  $.log(`==== ${prefix} ====`);

  const firstHistory = await postJson(HISTORY_URL, cookie, buildHistoryRequest());
  const firstDays = extractHistoryData(firstHistory);
  const firstServerTime = extractServerTime(firstHistory);
  const currentDay = findCurrentDay(firstDays, firstServerTime);

  $.log(`${prefix}: 任务列表 => ${formatHistorySummary(firstDays, firstServerTime)}`);
  $.log(`${prefix}: 当前签到项 => ${getCurrentStatusText(currentDay)}`);

  if (!currentDay) {
    lines.push(`${prefix}: 未找到当天签到项`);
    return lines;
  }

  if (currentDay.isSign && currentDay.isAward) {
    $.log(`${prefix}: 今日已签到且已发奖`);
    lines.push(`${prefix}: 今日已签到，奖励 ${formatRewardList(currentDay.awardInfoList)}`);
    return lines;
  }

  if (!currentDay.isSign) {
    const signRequest = await buildSignRequest();
    const signResponse = await postJson(SIGN_URL, cookie, signRequest);
    $.log(`${prefix}: signAndAward => code=${signResponse.resultCode}, success=${signResponse.success}`);
  }

  const prizeRequest = await buildPrizeRequest();
  if (prizeRequest) {
    const prizeResponse = await postJson(PRIZE_URL, cookie, prizeRequest);
    $.log(`${prefix}: queryCanTakePrize => code=${prizeResponse.resultCode}, success=${prizeResponse.success}`);
  } else {
    $.log(`${prefix}: 未配置 activityId，跳过 queryCanTakePrize`);
  }

  const secondHistory = await postJson(HISTORY_URL, cookie, buildHistoryRequest());
  const secondDays = extractHistoryData(secondHistory);
  const secondServerTime = extractServerTime(secondHistory);
  const secondCurrentDay = findCurrentDay(secondDays, secondServerTime);

  $.log(`${prefix}: 复查签到项 => ${getCurrentStatusText(secondCurrentDay)}`);

  if (secondCurrentDay?.isSign && secondCurrentDay?.isAward) {
    lines.push(`${prefix}: 今日签到成功，奖励 ${formatRewardList(secondCurrentDay.awardInfoList)}`);
  } else {
    lines.push(`${prefix}: 已执行签到链路，但复查仍未显示已发奖`);
  }

  return lines;
}

async function main() {
  if (cookies.length === 0) {
    $.log('未找到 JD_COOKIE');
    return;
  }

  const messages = [];
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      const lines = await handleAccount(cookies[index], index + 1);
      messages.push(...lines);
    } catch (error) {
      const userName = getUserName(cookies[index]);
      messages.push(`账号${index + 1} ${userName}: ${error.message}`);
      $.log(`账号${index + 1} ${userName}: ${error.stack || error.message}`);
    }
  }

  if (messages.length > 0) {
    const summary = messages.join('\n');
    $.log('\n' + summary);
    if (notify?.sendNotify) {
      await notify.sendNotify($.name, summary);
    }
  }
}

main()
  .catch((error) => {
    $.log(error.stack || error.message);
  })
  .finally(() => {
    $.done();
  });
