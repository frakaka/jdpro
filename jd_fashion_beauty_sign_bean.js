/*
cron:13 0 * * * jd_fashion_beauty_sign_bean.js
服装美饰签到领京豆。

环境变量说明：
1. JD_FASHION_BEAUTY_SIGN_DEBUG
   含义：是否打印更完整的接口 request/response。
   是否必须：否，值为 1 时开启。

2. JD_FASHION_BEAUTY_SIGN_EID_TOKEN
   含义：可选的 x-api-eid-token。若签到接口触发风控，可从抓包提取后覆盖。
   是否必须：否，默认使用本次抓包里的值。
*/

'use strict';

const crypto = require('crypto');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getRequestUuid,
  getUserAgent,
  getUserName,
  postFormApi,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('服装美饰签到领京豆');
const cookies = Object.values(jdCookieNode).filter(Boolean);

const PAGE_ID = 'jgwurvXVswT7VFuX4S5DG2aaK1T';
const PAGE_URL = `https://pro.m.jd.com/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt1&collectionId=842`;
const APPID = 'jx_h5_babel';
const H5ST_APP_ID = 'c50cc';
const CHANNEL = 'jxh5';
const CLIENT = 'jxh5';
const CLIENT_VERSION = '1.2.5';
const ACTIVITY_SOURCE = 'jxzy';
const CRAFT_ID = '69266d9f129fbf6b80a8b1cd';
const APP_CODE = 'ms1888ebbf';
const BUID = 325;
const SCENEVAL = 2;
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM57R5VSKQAAAAACDGN6WZVNPYBZUX';

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_FASHION_BEAUTY_SIGN_DEBUG === '1';
}

function md5(content) {
  return crypto.createHash('md5').update(String(content)).digest('hex');
}

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function getEidToken(cookie) {
  return process.env.JD_FASHION_BEAUTY_SIGN_EID_TOKEN
    || getCookieValue(cookie, '3AB9D23F7A4B3CSS')
    || DEFAULT_EID_TOKEN;
}

function buildSignBody(payload, time) {
  const baseBody = {
    ...payload,
    sceneval: SCENEVAL,
    buid: BUID,
    appCode: APP_CODE,
    time,
  };

  return {
    ...baseBody,
    signStr: md5(JSON.stringify(baseBody)),
  };
}

function buildCommonForm(cookie, time, options = {}) {
  const form = {
    t: time,
    channel: CHANNEL,
    clientVersion: CLIENT_VERSION,
    client: CLIENT,
    uuid: getRequestUuid(cookie),
    cthr: '1',
    loginType: '2',
  };

  if (options.includeEidToken) {
    form['x-api-eid-token'] = getEidToken(cookie);
  }

  return form;
}

function sanitizeRequestLog(requestLog) {
  const sanitized = JSON.parse(JSON.stringify(requestLog));
  if (sanitized.extraForm?.['x-api-eid-token']) {
    sanitized.extraForm['x-api-eid-token'] = `${sanitized.extraForm['x-api-eid-token'].slice(0, 18)}...`;
  }
  return sanitized;
}

function logRequest(prefix, functionId, body, extraForm, options = {}) {
  const requestLog = {
    endpoint: 'https://api.m.jd.com/api',
    functionId,
    appid: APPID,
    client: CLIENT,
    referer: PAGE_REFERER,
    h5stAppId: options.requireH5st ? H5ST_APP_ID : '',
    body,
    extraForm,
  };
  $.log(`${prefix}: 请求 ${functionId} => ${stringifySnippet(sanitizeRequestLog(requestLog), isDebugEnabled() ? 3000 : 1200)}`);
}

function logResponse(prefix, functionId, meta) {
  const responseLog = {
    httpStatus: meta?.statusCode,
    response: meta?.data,
  };
  $.log(`${prefix}: 响应 ${functionId} => ${stringifySnippet(responseLog, isDebugEnabled() ? 4000 : 1200)}`);
}

async function requestActivityApi(cookie, functionId, bodyPayload, prefix, options = {}) {
  const time = Date.now();
  const body = buildSignBody(bodyPayload, time);
  const extraForm = buildCommonForm(cookie, time, {
    includeEidToken: options.includeEidToken,
  });

  logRequest(prefix, functionId, body, extraForm, options);

  const meta = await postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/api',
    functionId,
    appid: APPID,
    body,
    client: CLIENT,
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: PAGE_REFERER,
    extraForm,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
    h5stAppId: options.requireH5st ? H5ST_APP_ID : '',
    h5stVersion: '5.3',
    includeMeta: true,
  });

  logResponse(prefix, functionId, meta);
  return meta.data;
}

async function querySign(cookie, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_querySign',
    {
      source: ACTIVITY_SOURCE,
      craftId: CRAFT_ID,
    },
    prefix,
  );
}

async function drawSign(cookie, itemId, prefix) {
  return requestActivityApi(
    cookie,
    'jxzy_active_drawSign',
    {
      itemId: String(itemId || '1'),
      craftId: CRAFT_ID,
      source: ACTIVITY_SOURCE,
    },
    prefix,
    {
      requireH5st: true,
      includeEidToken: true,
    },
  );
}

function summarizePrizeInfos(response) {
  const prizeInfos = Array.isArray(response?.data?.prizeInfos) ? response.data.prizeInfos : [];
  return prizeInfos.map((item) => {
    if (Number(item.prizeType) === 2) {
      return `${item.discount || 0}京豆`;
    }
    return `prizeType=${item.prizeType}`;
  }).join('，') || '无奖励明细';
}

function readSignStatus(response) {
  return Number(response?.data?.status ?? -1);
}

function readItemId(response) {
  return response?.data?.itemId || '1';
}

async function runAccount(cookie, index) {
  const prefix = `账号${index} ${getUserName(cookie)}`;
  $.log(`\n==== ${prefix} ====`);

  const firstQuery = await querySign(cookie, prefix);
  const signStatus = readSignStatus(firstQuery);
  $.log(
    `${prefix}: 初始签到状态 => status=${signStatus}, already=${firstQuery?.data?.alreadySignDays ?? '-'}`
      + `/${firstQuery?.data?.totalSignDays ?? '-'}, canClaim=${firstQuery?.data?.canClaimAmount ?? '-'}`,
  );

  if (signStatus === 1) {
    const signResult = await drawSign(cookie, readItemId(firstQuery), prefix);
    $.log(`${prefix}: 签到结果 => code=${signResult?.code ?? '-'} msg=${signResult?.msg || '-'} | ${summarizePrizeInfos(signResult)}`);

    const secondQuery = await querySign(cookie, prefix);
    $.log(
      `${prefix}: 复查签到状态 => status=${readSignStatus(secondQuery)}, already=${secondQuery?.data?.alreadySignDays ?? '-'}`
        + `/${secondQuery?.data?.totalSignDays ?? '-'}, canClaim=${secondQuery?.data?.canClaimAmount ?? '-'}`,
    );
    return;
  }

  if (signStatus === 2) {
    $.log(`${prefix}: 今日已签到 => ${summarizePrizeInfos(firstQuery)}`);
    return;
  }

  $.log(`${prefix}: 未识别签到状态 => ${stringifySnippet(firstQuery, 1000)}`);
}

(async () => {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  $.log(`共${cookies.length}个京东账号Cookie`);
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1} 执行异常 => ${error.message || error}`);
    }
  }
})()
  .catch((error) => {
    $.log(`脚本执行异常 => ${error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
