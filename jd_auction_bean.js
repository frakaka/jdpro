/*
cron:2 0 * * * jd_auction_bean.js

环境变量说明：
1. JD_AUCTION_EID_TOKEN
   含义：拍卖接口表单里的 x-api-eid-token。
   是否必须：否，默认优先使用 gias 动态生成，失败时再回退到抓包值。
   如何覆盖：在青龙新增同名环境变量，值填最新抓包里的 x-api-eid-token。

2. JD_AUCTION_CHANNEL_ID
   含义：拍卖首页互动接口 channelId。
   是否必须：否，默认 12。
   如何覆盖：在青龙新增同名环境变量即可。

3. JD_AUCTION_FULL_COOKIE
   含义：拍卖活动页抓包里的完整 Cookie，用于补齐 sdtoken、3AB9D23F7A4B3CSS 等上下文。
   是否必须：否，默认使用最新 HAR 中抓到的一组模板 Cookie。
   如何覆盖：在青龙新增同名环境变量，值填同一账号最新拍卖活动抓包 Cookie。

4. JD_AUCTION_GOODS_GROUP_IDS
   含义：首页互动接口的 goodsGroupIds，多个值用英文逗号分隔。
   是否必须：否，默认 24465961。
   如何覆盖：例如 24465961,24465962。

5. JD_AUCTION_GUESS_SEQUENCE
   含义：手动覆盖竞猜序列，格式为 JSON 数组：
         [{"consecutiveTimes":1,"guessAuctionId":10001436511,"optionId":"100014365111"}]
   是否必须：否，默认根据 interactive.home 返回动态生成。
   如何覆盖：在青龙新增同名环境变量即可。

6. JD_AUCTION_DEBUG
   含义：是否打印关键接口原始返回片段，便于排查活动变更。
   是否必须：否，配置为 1 时开启。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  createH5st,
  getGiasRiskContext,
  getUserName,
  mergeCookieString,
  parseApiResponse,
  parseCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon.js');

const $ = new Env('京东拍卖领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const API_ENDPOINT = 'https://api.m.jd.com/api';
const REQUEST_ORIGIN = 'https://h5static.m.jd.com';
const REFERER_URL = 'https://h5static.m.jd.com/mall/active/3xVB23LvQ7W5hEQVeMKbuu53wLn/index.html?redirectCode=111';
const REQUEST_APP_ID = 'auctionChannel';
const H5ST_APP_ID = 'd8c25';
const CLIENT = 'm';
const CLIENT_VERSION = '1.1.0';
const PAGE_SOURCE = '111';
const QUERY_RECEIVE_TIMES = 1;
const DEFAULT_CHANNEL_ID = '12';
const DEFAULT_GOODS_GROUP_IDS = ['24465961'];
const DEFAULT_EID_TOKEN = 'jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5YLL6KGAAAAAACDNRXLGYH5LVU4X';
const DEFAULT_FULL_ACTIVITY_COOKIE = '__jd_ref_cls=Babel_H5FirstClick; sdtoken=AAbEsBpEIOVjqTAKCQtvQu17chzBc7iLJ3UmNt2zzAES02CQFhf2gTtqRHmfS32H80vEG72wnY3FWRbKR2d3Qmd_7PQiZ_seB3XnQCXgjI_gAhJxJzTzqavRjlKiFGmAD-RmYrp-ah6QOkH1n6_CWhF0w6dG_k5ROJoa9DBUNECQZQ; shshshfpb=BApXWWprQwfhAkxxEcgVU0XrJxXLtCuvfBjckFqkD9xJ1ONBSe4PYlUOz1XroGjB6E9Y24fDS05Nifuk14vkN7diGAlwi; __jda=95931165.177560889585327643916.1775608895.1777044668.1777044987.135; __jdb=95931165.2.177560889585327643916|135.1777044987; __jdc=95931165; mba_muid=177560889585327643916; mba_sid=17770894198131834365756.2; shshshfpa=3a65b254-8042-ba65-c800-ac0556cc5a05-1775651186; qid_sid=15e447b6-ee84-4ca3-bda7-c75470b84f67-3; 3AB9D23F7A4B3C9B=PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4; 3AB9D23F7A4B3CSS=jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5YLL6KGAAAAAACDNRXLGYH5LVU4X; _gia_d=1; qid_evord=2597; pt_key=app_openAAJp7DuHADDDNDfd8nYJQQiSRYQyLgppQuDUhlgte8lfGLNGujV9Bti1qp6Rqs44UUOUiyFJJrU; pt_pin=lifeng9891; pwdt_id=lifeng9891; sid=1588bde97f351131171a0144e4090a3w; qid_ls=1777032157500; qid_ts=1777087324380; qid_vis=3; __jdv=95931165%7Clianmeng__11__kong__kong%7Ct_1000441370_%7Cjingfen%7C09c8789d5e516f4ac5ae2d6d652fcd94%7C1777045044663; unpl=JF8EAJtnNSttWUMGDB0LE0cUH1lUWQoNG0UHPzMGAVoNTFAGTFBOGhV7XlVdWhRKEh9sYhRXX1NJUg4YBysSEHtdVV9cDU4XAWlmNWRVUCVUSBtsGHwQBhAZbl4IexYzb2EDUFpZQl0NHwsfEBNNWlFcVQhMJwJfZwNkbWhKZAQrAytZfkoQVFhbDEwWCmZvAV1ZWkhSAh4AExIXe1xkXQ; b_dh=753; qid_fs=1777025930620; qid_uid=15e447b6-ee84-4ca3-bda7-c75470b84f67; e_wq_addr=CMU3GzPpDzTpDJU2DzHpCMU3GyV1DJCnDyV1DOVLG18vdJY3CUGvdJu2CzCvdJUzC0PpTXU5HUO2TXU1GtUmTXU1HJu3TXU4ENU3TXU5CNUzXyU3GyV1DJCnDyV1DOVLGyV1DUUmCsV1DtcnHMV1EJYzCyV1DJCzGIV1EUVLDsV1DUS1CMV1DUU5DyV1ENq1DyV1EJK1CyV1DtcnHMV1EJYzCyV1DJO2GyV1DJZPHMU3GzOnDs40ENSyDzYvCuCzEI45DNGmEJC=; jdAddrId=1_72_55674_0; jdAddrName=%u5317%u4EAC_%u671D%u9633%u533A_%u9EA6%u5B50%u5E97%u8857%u9053_; mitemAddrId=1_72_55674_0; mitemAddrName=%u5317%u4EAC%u5E02%u671D%u9633%u533A%u9EA6%u5B50%u5E97%u8857%u9053%u671D%u9633%u516C%u56ED; wq_addr=0%7C1_72_55674_0%7C%u5317%u4EAC_%u671D%u9633%u533A_%u9EA6%u5B50%u5E97%u8857%u9053_%7C%u5317%u4EAC%u5E02%u671D%u9633%u533A%u9EA6%u5B50%u5E97%u8857%u9053%u671D%u9633%u516C%u56ED%7C116.482276%2C39.944093; commonAddress=0';
const ACTIVITY_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.70&HiClVersion=8.1.70&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR&stockSDK=stocksdk-iphone_6.0.0&sPoint=&jdPay=(*#@jdPaySDK*#@jdPayChannel=jdfinance&jdPayChannelVersion=8.1.70&jdPaySdkVersion=4.01.96.00&jdPayClientName=iOS*#@jdPaySDK*#@)';
const WAIT_MS = 1200;
const RETRY_WAIT_MS = 2500;
const MAX_RETRY_TIMES = 3;
const MAX_GUESS_TASKS_PER_ROUND = 3;
const riskContextCache = new Map();
const REQUEST_REF_CLS = {
  'auction.soa.do.task': 'Babel_H5FirstClick',
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_AUCTION_DEBUG === '1';
}

function getInteractiveChannelId() {
  return process.env.JD_AUCTION_CHANNEL_ID || DEFAULT_CHANNEL_ID;
}

function getGoodsGroupIds() {
  const value = process.env.JD_AUCTION_GOODS_GROUP_IDS;
  if (!value) {
    return DEFAULT_GOODS_GROUP_IDS;
  }

  const ids = value
    .split(',')
    .map((item) => String(item).trim())
    .filter(Boolean);

  return ids.length ? ids : DEFAULT_GOODS_GROUP_IDS;
}

function getEidToken() {
  return process.env.JD_AUCTION_EID_TOKEN || DEFAULT_EID_TOKEN;
}

function getGuessSequence() {
  const value = process.env.JD_AUCTION_GUESS_SEQUENCE;
  if (!value) {
    return [];
  }

  const sequence = safeJsonParse(value, []);
  if (!Array.isArray(sequence)) {
    return [];
  }

  return sequence
    .map((item) => ({
      consecutiveTimes: Number(item?.consecutiveTimes || 0),
      guessAuctionId: Number(item?.guessAuctionId || 0),
      optionId: item?.optionId ? String(item.optionId) : '',
      title: item?.title ? String(item.title) : '',
    }))
    .filter((item) => item.consecutiveTimes > 0 && item.guessAuctionId > 0 && item.optionId);
}

function createSession(cookie) {
  return {
    cookie,
  };
}

function parseSdTokenHeader(value) {
  if (!value) {
    return '';
  }

  const text = Array.isArray(value) ? value[0] : String(value);
  const parts = text.split(';');
  if (parts.length >= 3 && parts[0] === 'set') {
    return parts[2];
  }
  return '';
}

function mergeResponseState(session, responseHeaders) {
  const sdToken = parseSdTokenHeader(responseHeaders?.['x-rp-sdtoken']);
  if (sdToken) {
    session.cookie = mergeCookieString(session.cookie, { sdtoken: sdToken });
  }

  const setCookieList = responseHeaders?.['set-cookie'];
  if (!setCookieList) {
    return;
  }

  const items = Array.isArray(setCookieList) ? setCookieList : [setCookieList];
  const cookiePatch = {};
  for (const item of items) {
    const firstPart = String(item).split(';')[0];
    const separatorIndex = firstPart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = firstPart.slice(0, separatorIndex).trim();
    const value = firstPart.slice(separatorIndex + 1).trim();
    if (key) {
      cookiePatch[key] = value;
    }
  }

  if (Object.keys(cookiePatch).length) {
    session.cookie = mergeCookieString(session.cookie, cookiePatch);
  }
}

function buildActivityCookie(cookie, functionId) {
  const fullCookie = String(process.env.JD_AUCTION_FULL_COOKIE || DEFAULT_FULL_ACTIVITY_COOKIE).trim();
  if (!fullCookie) {
    return cookie;
  }

  const baseCookieMap = parseCookieString(cookie);
  const overrideValues = {};
  for (const [key, value] of baseCookieMap.entries()) {
    overrideValues[key] = value;
  }
  let mergedCookie = mergeCookieString(fullCookie, overrideValues);
  const referClass = REQUEST_REF_CLS[functionId];
  if (referClass) {
    mergedCookie = mergeCookieString(mergedCookie, { __jd_ref_cls: referClass });
  }
  return mergedCookie;
}

function shouldRetry(result) {
  const code = result?.code ?? result?.data?.bizCode;
  const message = String(result?.message || result?.msg || result?.data?.bizMsg || '');
  return code === 405 || message.includes('活动火爆') || message.includes('稍后再试');
}

async function retryRequest(requestFn, username, actionName) {
  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_RETRY_TIMES; attempt += 1) {
    lastResult = await requestFn();
    if (!shouldRetry(lastResult) || attempt === MAX_RETRY_TIMES) {
      return lastResult;
    }

    $.log(`账号 ${username}: ${actionName} 第 ${attempt} 次触发限流，${RETRY_WAIT_MS / 1000} 秒后重试`);
    await sleep(RETRY_WAIT_MS);
  }

  return lastResult;
}

async function resolveRiskContext(cookie) {
  const cacheKey = getUserName(cookie);
  if (riskContextCache.has(cacheKey)) {
    return riskContextCache.get(cacheKey);
  }

  const contextPromise = (async () => {
    try {
      const riskContext = await getGiasRiskContext(cookie, {
        pageUrl: REFERER_URL,
        bizId: 'JDR_shields',
        userAgent: ACTIVITY_USER_AGENT,
      });

      return {
        cookie: riskContext?.cookie || cookie,
        jsToken: riskContext?.jsToken || '',
        userAgent: ACTIVITY_USER_AGENT,
      };
    } catch (error) {
      return {
        cookie,
        jsToken: '',
        userAgent: ACTIVITY_USER_AGENT,
        riskError: error.message,
      };
    }
  })();

  riskContextCache.set(cacheKey, contextPromise);
  return contextPromise;
}

async function callAuctionApi(session, functionId, body) {
  const riskContext = await resolveRiskContext(session.cookie);
  const requestCookie = buildActivityCookie(riskContext.cookie || session.cookie, functionId);
  const requestUserAgent = riskContext.userAgent || ACTIVITY_USER_AGENT;
  const eidToken = riskContext.jsToken || getEidToken();

  const query = new URLSearchParams({
    appid: REQUEST_APP_ID,
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    area: '1_72_55674_0',
    gps_area: '',
    t: String(Date.now()),
    uemps: '',
    loginType: '2',
    loginWQBiz: '',
    functionId,
  });

  const form = new URLSearchParams();
  form.set('body', JSON.stringify(body));
  form.set(
    'h5st',
    await createH5st({
      functionId,
      body,
      h5stAppId: H5ST_APP_ID,
      requestAppid: REQUEST_APP_ID,
      cookie: requestCookie,
      userAgent: requestUserAgent,
      client: CLIENT,
      clientVersion: CLIENT_VERSION,
    }),
  );
  if (eidToken) {
    form.set('x-api-eid-token', eidToken);
  }

  const response = await got.post(`${API_ENDPOINT}?${query.toString()}`, {
    body: form.toString(),
    headers: buildHeaders(requestCookie, {
      origin: REQUEST_ORIGIN,
      referer: REFERER_URL,
      userAgent: requestUserAgent,
      extraHeaders: {
        Accept: 'application/json, text/plain, */*',
        priority: 'u=3, i',
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });

  mergeResponseState(session, response.headers || {});
  return parseApiResponse(response);
}

async function queryBeanInfo(session) {
  return callAuctionApi(session, 'common_bean_info', {
    channelId: getInteractiveChannelId(),
  });
}

async function queryInteractiveHome(session) {
  return callAuctionApi(session, 'auction.soa.interactive.home', {
    goodsGroupIds: getGoodsGroupIds(),
    pageSource: PAGE_SOURCE,
    channelId: getInteractiveChannelId(),
    queryReceiveTimes: QUERY_RECEIVE_TIMES,
  });
}

async function doGuessTask(session, guessTask) {
  return callAuctionApi(session, 'auction.soa.do.task', {
    channelId: getInteractiveChannelId(),
    consecutiveTimes: guessTask.consecutiveTimes,
    guessAuctionId: guessTask.guessAuctionId,
    optionId: guessTask.optionId,
  });
}

function extractBeanNumber(beanInfo) {
  return beanInfo?.data?.result?.beanNum ?? beanInfo?.data?.beanNum ?? '-';
}

function extractInteractiveData(result) {
  return result?.data || {};
}

function buildDynamicGuessSequence(result) {
  const interactiveData = extractInteractiveData(result);
  const guessedNum = Number(interactiveData?.guessedNum || 0);
  const guessList = Array.isArray(interactiveData?.guessPriceVoList) ? interactiveData.guessPriceVoList : [];

  if (!guessList.length) {
    return [];
  }

  return guessList
    .slice(0, MAX_GUESS_TASKS_PER_ROUND)
    .map((item, index) => ({
      consecutiveTimes: Number(item?.consecutiveTimes || guessedNum + index + 1),
      guessAuctionId: Number(item?.auctionId || 0),
      optionId: String(item?.largeOption?.optionId || item?.smallOption?.optionId || ''),
      title: String(item?.name || `auction-${item?.auctionId || index + 1}`),
    }))
    .filter((item) => item.consecutiveTimes > 0 && item.guessAuctionId > 0 && item.optionId);
}

function summarizeInteractiveHome(result) {
  const interactiveData = extractInteractiveData(result);
  const taskList = interactiveData?.interactiveInfo?.taskList || [];
  return `首页互动任务=${taskList.length} | 剩余竞猜=${interactiveData?.remainGuessNum ?? '-'} | 已竞猜=${interactiveData?.guessedNum ?? '-'}`;
}

function summarizeGuessResult(result) {
  const data = result?.data?.result || {};
  return `${data.popMessage || result?.msg || result?.message || '无提示'} | remain=${data.remainGuessNum ?? '-'} | guessState=${data.guessState ?? '-'}`;
}

async function runGuessTasks(session, interactiveHomeResult, username) {
  const manualSequence = getGuessSequence();
  const guessSequence = manualSequence.length ? manualSequence : buildDynamicGuessSequence(interactiveHomeResult);

  if (!guessSequence.length) {
    $.log(`账号 ${username}: 当前无可执行竞猜任务`);
    return;
  }

  $.log(`账号 ${username}: 本轮按查询列表执行竞猜 ${guessSequence.length} 次`);

  for (const guessTask of guessSequence) {
    const result = await retryRequest(
      () => doGuessTask(session, guessTask),
      username,
      `竞猜 ${guessTask.consecutiveTimes}`,
    );
    $.log(`账号 ${username}: 竞猜 ${guessTask.consecutiveTimes} ${guessTask.title || ''} => ${summarizeGuessResult(result)}`);
    if (isDebugEnabled()) {
      $.log(`账号 ${username}: 竞猜原始返回 => ${stringifySnippet(result, 1200)}`);
    }
    await sleep(WAIT_MS);
  }
}

async function handleAccount(cookie, index) {
  const username = getUserName(cookie);
  const session = createSession(cookie);
  $.log(`\n==== 账号${index} ${username} ====`);

  const beanBefore = await queryBeanInfo(session);
  $.log(`账号 ${username}: 当前豆数 => ${extractBeanNumber(beanBefore)}`);

  const interactiveHomeResult = await queryInteractiveHome(session);
  $.log(`账号 ${username}: 首页互动 => ${summarizeInteractiveHome(interactiveHomeResult)}`);
  if (isDebugEnabled()) {
    $.log(`账号 ${username}: auction.soa.interactive.home 原始返回 => ${stringifySnippet(interactiveHomeResult, 1600)}`);
  }

  await runGuessTasks(session, interactiveHomeResult, username);

  const beanFinal = await queryBeanInfo(session);
  $.log(`账号 ${username}: 最终豆数 => ${extractBeanNumber(beanFinal)}`);
  if (isDebugEnabled()) {
    $.log(`账号 ${username}: common_bean_info 原始返回 => ${stringifySnippet(beanFinal, 1200)}`);
  }
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await handleAccount(cookies[index], index + 1);
    } catch (error) {
      const username = getUserName(cookies[index]);
      $.log(`账号 ${username}: 执行异常 => ${error.stack || error.message}`);
    }
  }
}

main()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message}`);
  })
  .finally(async () => {
    if (notify && typeof notify.sendNotify === 'function') {
      try {
        await notify.sendNotify($.name, '执行完成');
      } catch (error) {
        // ignore
      }
    }
    $.done();
  });
