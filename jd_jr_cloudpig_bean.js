/*
cron:18 0 * * * jd_jr_cloudpig_bean.js

环境变量说明：
1. JD_JR_CLOUDPIG_FP / JD_JR_CLOUDPIG_SDK_TOKEN / JD_JR_CLOUDPIG_EID
   含义：桌面组件领京豆请求里的风控设备参数。
   是否必须：否，未配置时优先取 Cookie 中 equipmentId，其余字段使用当前 HAR 默认值。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_JR_USER_AGENT,
  buildHeaders,
  getUserName,
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('养猪桌面组件领京豆');

const API_URL = 'https://ms.jr.jd.com/gw2/generic/cloudpig/h5/m/showDeskCompIcon';
const PAGE_URL = 'https://u.jr.jd.com/';
const USER_AGENT = DEFAULT_JR_USER_AGENT;
const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN = 'jdd01Q6TSW6FHF32OY5YAC2EFQHFVX636KZC4OKZJXZ7JCY2XYFP5LYYV2BKD4U725MRE7IHFF5XQKQGXPEEMVYM5G432QDZOLW7M74ZEVHA01234567';
const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getCookieValue(cookie, key) {
  const match = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function buildRiskDeviceParam(cookie) {
  return {
    macAddress: '',
    imei: '',
    eid: process.env.JD_JR_CLOUDPIG_EID || getCookieValue(cookie, 'equipmentId') || getCookieValue(cookie, '3AB9D23F7A4B3C9B') || '',
    openUUID: '',
    uuid: '',
    traceIp: '',
    os: 'ios',
    osVersion: '',
    appId: '',
    clientVersion: '',
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
    fp: process.env.JD_JR_CLOUDPIG_FP || DEFAULT_FP,
    ip: '',
    idfa: '',
    sdkToken: process.env.JD_JR_CLOUDPIG_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    osv: '26.2',
  };
}

async function claimBean(cookie) {
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify({
    channelLV: 'xjf',
    source: 2,
    riskDeviceParam: JSON.stringify(buildRiskDeviceParam(cookie)),
  }));

  const response = await got.post(`${API_URL}?_=${Date.now()}`, {
    body: form.toString(),
    headers: buildHeaders(cookie, {
      origin: 'https://u.jr.jd.com',
      referer: PAGE_URL,
      userAgent: USER_AGENT,
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
      extraHeaders: {
        Accept: 'application/json',
      },
    }),
    throwHttpErrors: false,
    timeout: {
      request: 15000,
    },
  });

  return response.body ? safeJsonParse(response.body, response.body) : {};
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;

  $.log(`\n==== ${prefix} ====`);
  const result = await claimBean(cookie);
  const award = result?.resultData?.resultData?.award || {};

  if (award?.name || award?.content) {
    $.log(`${prefix}: 领取结果 => ${award.name || award.content}`);
    $.log(`${prefix}: 返回片段 => ${stringifySnippet(result, 800)}`);
    return;
  }

  $.log(`${prefix}: 未识别到京豆奖励 => ${stringifySnippet(result, 800)}`);
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效账号 Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行失败：${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常：${error.message || error}`))
  .finally(() => $.done());
