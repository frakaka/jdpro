/*
cron:12 0 * * * jd_bom_signin_bean.js

环境变量说明：
1. JD_BOM_ACTIVITY_ID / JD_BOM_SCENE_ID / JD_BOM_TEMPLATE_ID / JD_BOM_FLOOR_ID / JD_BOM_ENC
   含义：五金城签到任务执行时使用的活动参数，默认取当前 HAR 中已验证值。
   是否必须：否，活动换版后可在青龙覆盖。

2. JD_BOM_DEBUG
   含义：是否打印接口原始返回片段，便于排查 h5st 或活动参数变化。
   是否必须：否，配置为 1 时开启。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_JR_USER_AGENT,
  buildHeaders,
  createH5st,
  getUserName,
  hasJingBeanReward,
  postFormApi,
  safeJsonParse,
  stringifySnippet,
} = require('./function/jd_har_bean_common');

const $ = new Env('五金城签到领京豆');

const QUERY_ENDPOINT = 'https://api.m.jd.com/client.action';
const EXECUTE_ENDPOINT = 'https://api.m.jd.com/api';
const PAGE_URL = 'https://prodev.m.jd.com/mall/active/BVKjg6PB1tkMvcm5wyjA4E3SCXM/index.html?mTabId=bbbb&cu=true';
const APPID = 'i-home_fe';
const H5ST_APP_ID = '3c653';
const USER_AGENT = DEFAULT_JR_USER_AGENT;
const QUERY_BODY = {
  client: 'wh5',
  clientVersion: '1.0.0',
};
const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_BOM_DEBUG === '1';
}

function getActivityConfig() {
  const activityId = process.env.JD_BOM_ACTIVITY_ID || 'BVKjg6PB1tkMvcm5wyjA4E3SCXM';
  return {
    activityId,
    sceneId: process.env.JD_BOM_SCENE_ID || `babel_${activityId}`,
    templateId: process.env.JD_BOM_TEMPLATE_ID || '00040380',
    floorId: process.env.JD_BOM_FLOOR_ID || '122343257',
    enc: process.env.JD_BOM_ENC || 'A2BE60A7CBCD989138227288D93A5B2A95298B5A49BD8844E56163B00CA55691F2AD6C53CAA2C9F3F9DE8FA7D715E3EDDB2ECCBD15B40A699283FBFF64AADADE',
  };
}

async function queryInteractiveInfo(cookie) {
  return postFormApi(cookie, {
    endpoint: QUERY_ENDPOINT,
    functionId: 'bom_queryInteractiveInfo',
    appid: APPID,
    body: QUERY_BODY,
    userAgent: USER_AGENT,
    origin: 'https://prodev.m.jd.com',
    referer: PAGE_URL,
    extraForm: {
      sign: '11',
      t: Date.now(),
    },
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
}

function readSignAssignment(response) {
  const assignments = response?.data?.assignmentList || [];
  return assignments.find((task) => {
    const name = String(task.assignmentName || '');
    return name.includes('签到') && hasJingBeanReward(task);
  }) || null;
}

async function executeAssignment(cookie, assignment) {
  const activityConfig = getActivityConfig();
  const innerBody = {
    encryptAssignmentId: assignment.encryptAssignmentId,
    taskType: 0,
    client: 'wh5',
    clientVersion: '1.0.0',
    extParam: {
      forceBot: '1',
      businessData: {},
      signStr: '-1',
      sceneid: activityConfig.sceneId,
    },
    activity_id: activityConfig.activityId,
    template_id: activityConfig.templateId,
    floor_id: activityConfig.floorId,
    enc: activityConfig.enc,
  };
  const outerBody = {
    appid: APPID,
    body: JSON.stringify(innerBody),
    sign: 11,
    t: Date.now(),
  };
  const h5st = await createH5st({
    functionId: 'bom_doInteractiveAssignment',
    body: outerBody,
    h5stAppId: H5ST_APP_ID,
    requestAppid: APPID,
    cookie,
    userAgent: USER_AGENT,
    client: 'pc',
    clientVersion: '1.0.0',
    version: '5.3',
  });
  const url = new URL(EXECUTE_ENDPOINT);

  url.searchParams.set('functionId', 'bom_doInteractiveAssignment');
  url.searchParams.set('client', 'pc');
  url.searchParams.set('clientVersion', '1.0.0');
  url.searchParams.set('appid', APPID);
  url.searchParams.set('h5st', h5st);
  url.searchParams.set('body', JSON.stringify(outerBody));

  const response = await got.get(url.toString(), {
    headers: buildHeaders(cookie, {
      origin: 'https://prodev.m.jd.com',
      referer: PAGE_URL,
      userAgent: USER_AGENT,
      contentType: undefined,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
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

  const queryResult = await queryInteractiveInfo(cookie);
  if (isDebugEnabled()) {
    $.log(`${prefix}: queryInteractiveInfo => ${stringifySnippet(queryResult, 1200)}`);
  }

  const signAssignment = readSignAssignment(queryResult);
  if (!signAssignment) {
    $.log(`${prefix}: 未找到签到领京豆任务`);
    $.log(`${prefix}: 返回片段 => ${stringifySnippet(queryResult, 800)}`);
    return;
  }

  $.log(
    `${prefix}: 任务=${signAssignment.assignmentName || '签到领京豆'} status=${signAssignment.status} upperLimit=${signAssignment.reachUpperLimit ? 1 : 0}`,
  );

  if (signAssignment.reachUpperLimit) {
    $.log(`${prefix}: 当前奖励已达上限，无需继续请求`);
    return;
  }

  const executeResult = await executeAssignment(cookie, signAssignment);
  $.log(`${prefix}: 执行签到 => ${stringifySnippet(executeResult, 1000)}`);
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
