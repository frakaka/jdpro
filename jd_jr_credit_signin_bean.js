/*
cron:19 0 * * * jd_jr_credit_signin_bean.js

环境变量说明：
1. JD_JR_CREDIT_JS_TOKEN
   含义：信用卡签到领取接口里的 jsToken。
   是否必须：否，未配置时优先从 Cookie 的 3AB9D23F7A4B3CSS 取，取不到再使用脚本内默认值。
   如何覆盖：在青龙新增同名环境变量，值写京东金融 App 最新抓包 token。

2. JD_JR_CREDIT_SDK_TOKEN
   含义：信用卡签到领取接口里的 sdkToken。
   是否必须：否，未配置时使用脚本内默认值。
   如何覆盖：在青龙新增同名环境变量，值写京东金融 App 最新抓包 token。

3. JD_JR_CREDIT_EID
   含义：信用卡签到领取接口里的 eid。
   是否必须：否，未配置时默认为空，和当前 HAR 中领取包一致。
   如何覆盖：在青龙新增同名环境变量即可。

4. JD_JR_CREDIT_CHANNEL_CODE
   含义：信用卡频道来源 channelCode。
   是否必须：否，默认 jd-sc-pdyzgdrw。
   如何覆盖：在青龙新增同名环境变量即可。

5. JD_JR_CREDIT_ACTIVITY_ID / JD_JR_CREDIT_SUB_ACTIVITY_ID
   含义：查询签到活动失败时兜底使用的活动 ID。
   是否必须：否，脚本会优先动态查询；未配置时使用当前 HAR 中的兜底值。
   如何覆盖：在青龙新增同名环境变量，值写最新抓包中的 activityId、subActivityId。

6. JD_JR_CREDIT_DEBUG
   含义：是否打印接口原始返回片段，便于排查风控、活动下线、参数变化。
   是否必须：否，配置为 1 时开启。
*/

'use strict';

const crypto = require('crypto');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const $ = new Env('信用卡签到领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const CARD_LIST_URL = 'https://jccapt-sp.jr.jd.com/portal/m/cardInfo/queryHomeCardList';
const SIGN_QUERY_URL = 'https://ms.jr.jd.com/gw2/generic/JccaAct/newh5/m/signupreceiveaward-signUpActivityQuery';
const RECEIVE_AWARD_URL = 'https://jccapt-sp.jr.jd.com/portal/m/activity/query/receiveAwardTemplate';
const PAGE_URL = 'https://jccapt.jr.jd.com/home';
const ACTIVITY_TYPE = 'SIGN_UP_RECEIVE_AWARD_ACTIVITY';
const DEFAULT_CHANNEL_CODE = 'jd-sc-pdyzgdrw';
const DEFAULT_ACTIVITY_ID = '202603317444555843679502336';
const DEFAULT_SUB_ACTIVITY_ID = '202603317444555843817914368';
const DEFAULT_JS_TOKEN = 'jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5S4HNMHIAAAAAD2I3CYGSZ4YJAQX';
const DEFAULT_SDK_TOKEN = 'jdd01VO6YCD6CC2MB4ZUYBG74RFSHWK7Y53ONYJCV23SBW75VY7D3BHN6JVEVIJGGA2GBNSASEMKY2ZB3CFLFTOBACZVM7T2KZYWZVRCFZIA01234567';
const GATEWAY_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCExGwVDxiY6gdzuLwLeG8zMcXAWixb1aUoPXZE7cXIIVM65NDN7L9iRYit3hbxXv7rvCU8kOmC/8XCVNWpoAEYZMlURHePS7dgX49E3P2b6EehBAPZ+9Z4kTdWFh4MvgVdqgIQkm7Ao9XZESFeI8O96jqrBHxAUkFFeiZxESST0wIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');
const RANDOM_CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const STOCK_CARD_TYPES = new Set([7, 999]);
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/application=JDJR-App&clientType=ios&iosType=iphone&clientVersion=8.1.70&HiClVersion=8.1.70&isUpdate=0&osVersion=26.2&osName=iOS&screen=844*390&src=App Store&netWork=1&netWorkType=1&CpayJS=UnionPay/1.0 JDJR';

const cookies = Object.values(jdCookieNode).filter(Boolean);

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

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = cookie.match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
}

function getChannelCode() {
  return process.env.JD_JR_CREDIT_CHANNEL_CODE || DEFAULT_CHANNEL_CODE;
}

function isDebugEnabled() {
  return process.env.JD_JR_CREDIT_DEBUG === '1';
}

function getTokenConfig(cookie) {
  const jsToken = process.env.JD_JR_CREDIT_JS_TOKEN
    || getCookieValue(cookie, '3AB9D23F7A4B3CSS')
    || DEFAULT_JS_TOKEN;

  return {
    jsToken,
    sdkToken: process.env.JD_JR_CREDIT_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    eid: process.env.JD_JR_CREDIT_EID || '',
  };
}

function createReferer(channelCode) {
  return `${PAGE_URL}?channelCode=${encodeURIComponent(channelCode)}&jrcontainer=h5&jrlogin=true`;
}

function createHeaders(cookie, channelCode, contentType) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: 'https://jccapt.jr.jd.com',
    Referer: createReferer(channelCode),
    'User-Agent': USER_AGENT,
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

function randomString(length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * RANDOM_CHARSET.length);
    result += RANDOM_CHARSET[randomIndex];
  }
  return result;
}

function aesEncrypt(content, aesKey) {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(aesKey, 'utf8'), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(content, aesKey) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(aesKey, 'utf8'), null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(content, 'base64'), decipher.final()]).toString('utf8');
}

function rsaEncrypt(content) {
  return crypto.publicEncrypt(
    {
      key: GATEWAY_PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(content, 'utf8'),
  ).toString('base64');
}

function createGatewayPayload(payload) {
  const aesKey = randomString(16);
  return {
    aesKey,
    reqData: {
      enAesKey: rsaEncrypt(aesKey),
      req: aesEncrypt(JSON.stringify(payload), aesKey),
    },
  };
}

function safeJsonParse(content, fallback = null) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function stringifySnippet(value, maxLength = 600) {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
}

function assertSuccessStatus(response, interfaceName) {
  if (!response || response.status !== 200) {
    throw new Error(`${interfaceName} 返回异常：${stringifySnippet(response)}`);
  }
}

function extractCards(response) {
  const data = response && response.data;
  const candidates = [
    data && data.homeCardList,
    data && data.cardList,
    data && data.cardInfoList,
    data && data.list,
    data && data.cards,
    response && response.homeCardList,
    response && response.cardList,
  ];
  const cardList = candidates.find((item) => Array.isArray(item)) || [];

  return cardList.filter((card) => card && card.applyId && card.cardId && card.passNo);
}

function createSignQueryPayload(card, channelCode) {
  return {
    applyId: card.applyId,
    passNo: card.passNo,
    cardId: card.cardId,
    bankNo: getCardBankNo(card),
    cardType: card.cardType,
    channelCode,
  };
}

function getCardBankNo(card) {
  if (STOCK_CARD_TYPES.has(Number(card.cardType)) && card.bankCode) {
    return card.bankCode;
  }
  return card.bankNo || card.bankCode || '';
}

function normalizeGatewayResponse(response, aesKey) {
  if (response && response.resultCode === 0 && response.resultData) {
    const resultData = response.resultData;
    if (resultData.resultCode !== 0) {
      throw new Error(`加密查询业务失败：${stringifySnippet(resultData)}`);
    }

    if (!resultData.resultData) {
      return resultData;
    }

    const decryptedText = aesDecrypt(resultData.resultData, aesKey);
    return safeJsonParse(decryptedText, { raw: decryptedText });
  }

  return response;
}

function extractActivityData(response) {
  if (!response) {
    return null;
  }

  if (response.data && response.data.activityId) {
    return response.data;
  }

  if (response.activityId) {
    return response;
  }

  if (response.resultData && response.resultData.data) {
    return response.resultData.data;
  }

  if (response.data && response.data.data) {
    return response.data.data;
  }

  return null;
}

function getFallbackActivityData() {
  return {
    activityId: process.env.JD_JR_CREDIT_ACTIVITY_ID || DEFAULT_ACTIVITY_ID,
    subActivityId: process.env.JD_JR_CREDIT_SUB_ACTIVITY_ID || DEFAULT_SUB_ACTIVITY_ID,
    dtoList: [],
  };
}

function findCurrentSignItem(dtoList) {
  if (!Array.isArray(dtoList) || dtoList.length === 0) {
    return null;
  }

  return dtoList.find((item) => item && item.isCurrent)
    || dtoList.find((item) => item && Number(item.status) === 0)
    || dtoList[dtoList.length - 1];
}

function formatSignItem(item) {
  if (!item) {
    return '无';
  }

  const date = item.signDate || item.date || item.showDate || '未知日期';
  const status = item.status === undefined ? '未知状态' : `状态${item.status}`;
  const award = item.goldSendNum || (item.awardInfoDto && item.awardInfoDto.goldSendNum) || '';
  return award ? `${date} ${status} ${award}京豆` : `${date} ${status}`;
}

function createReceivePayload(card, activityData, currentSignItem, channelCode, tokenConfig) {
  const payload = {
    activityType: ACTIVITY_TYPE,
    activityId: activityData.activityId,
    subActivityId: activityData.subActivityId,
    applyId: card.applyId,
    cardId: card.cardId,
    passNo: card.passNo,
    bankNo: getCardBankNo(card),
    channelCode,
    sdkToken: tokenConfig.sdkToken,
    jsToken: tokenConfig.jsToken,
    eid: tokenConfig.eid,
  };

  if (currentSignItem && Number(currentSignItem.status) === 2) {
    payload.extraParams = JSON.stringify({
      signDate: currentSignItem.signDate || '',
    });
  }

  return payload;
}

async function queryCardList(cookie, channelCode) {
  return got
    .get(CARD_LIST_URL, {
      searchParams: {
        fromPage: 'PINDAOYE',
        channelCode,
        timestamp: Date.now(),
      },
      headers: createHeaders(cookie, channelCode),
      timeout: {
        request: 15000,
      },
      throwHttpErrors: false,
    })
    .json();
}

async function querySignActivity(cookie, card, channelCode) {
  const requestPayload = createSignQueryPayload(card, channelCode);
  const gatewayPayload = createGatewayPayload(requestPayload);
  const response = await got
    .post(SIGN_QUERY_URL, {
      headers: createHeaders(cookie, channelCode, 'application/x-www-form-urlencoded'),
      form: {
        reqData: JSON.stringify(gatewayPayload.reqData),
      },
      timeout: {
        request: 15000,
      },
      throwHttpErrors: false,
    })
    .json();

  return normalizeGatewayResponse(response, gatewayPayload.aesKey);
}

async function receiveAward(cookie, payload, channelCode) {
  return got
    .post(RECEIVE_AWARD_URL, {
      searchParams: {
        channelCode,
      },
      headers: createHeaders(cookie, channelCode, 'application/json;charset=UTF-8'),
      json: payload,
      timeout: {
        request: 15000,
      },
      throwHttpErrors: false,
    })
    .json();
}

async function handleCard(cookie, card, channelCode, tokenConfig) {
  const cardName = card.cardName || card.bankName || card.bankNo || card.cardId;
  $.log(`信用卡：${cardName}，cardId=${card.cardId}`);

  let activityData = null;
  try {
    const queryResponse = await querySignActivity(cookie, card, channelCode);
    if (isDebugEnabled()) {
      $.log(`签到活动查询原始返回 => ${stringifySnippet(queryResponse)}`);
    }
    activityData = extractActivityData(queryResponse);
  } catch (error) {
    $.log(`签到活动查询失败，使用兜底活动 ID：${error.message}`);
  }

  if (!activityData || !activityData.activityId || !activityData.subActivityId) {
    activityData = getFallbackActivityData();
  }

  const currentSignItem = findCurrentSignItem(activityData.dtoList);
  $.log(`当前签到项：${formatSignItem(currentSignItem)}`);

  if (currentSignItem && Number(currentSignItem.status) > 0 && Number(currentSignItem.status) !== 2) {
    return '今日已签到';
  }

  const receivePayload = createReceivePayload(
    card,
    activityData,
    currentSignItem,
    channelCode,
    tokenConfig,
  );
  const receiveResponse = await receiveAward(cookie, receivePayload, channelCode);
  if (isDebugEnabled()) {
    $.log(`领取接口原始返回 => ${stringifySnippet(receiveResponse)}`);
  }
  assertSuccessStatus(receiveResponse, 'receiveAwardTemplate');

  const beanCount = receiveResponse.data && receiveResponse.data.goldSendNum;
  return beanCount ? `领取成功，获得 ${beanCount} 京豆` : receiveResponse.message || '领取成功';
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const channelCode = getChannelCode();
  const tokenConfig = getTokenConfig(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const cardListResponse = await queryCardList(cookie, channelCode);
  if (isDebugEnabled()) {
    $.log(`信用卡列表原始返回 => ${stringifySnippet(cardListResponse)}`);
  }
  assertSuccessStatus(cardListResponse, 'queryHomeCardList');

  const cards = extractCards(cardListResponse);
  if (cards.length === 0) {
    $.log(`账号${index} ${userName}: 未查询到可签到信用卡`);
    return;
  }

  const selectedCard = cards[0];
  $.log(`账号${index} ${userName}: 查询到 ${cards.length} 张信用卡，只使用第一张执行一次签到领取`);
  if (cards.length > 1) {
    const skippedCards = cards
      .slice(1)
      .map((card) => card.cardName || card.cardId)
      .join('、');
    $.log(`跳过后续信用卡：${skippedCards}`);
  }

  try {
    const result = await handleCard(cookie, selectedCard, channelCode, tokenConfig);
    $.log(`${selectedCard.cardName || selectedCard.cardId}: ${result}`);
  } catch (error) {
    $.log(`${selectedCard.cardName || selectedCard.cardId}: 处理失败，${error.message}`);
  }
}

async function main() {
  if (cookies.length === 0) {
    $.log('未找到 Cookie，请先配置。');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1} 执行失败：${error.message}`);
    }
  }
}

main()
  .catch((error) => {
    $.log(`执行异常：${error.message}`);
  })
  .finally(async () => {
    if (notify && $.notifyMessage) {
      await notify.sendNotify($.name, $.notifyMessage);
    }
    $.done();
  });
