/*
cron:37 0 * * * jd_service_daily_draw_bean.js

京东服务天天抽奖：完成浏览任务，抽奖领京豆/优惠券。

基于 files/traffic_jd_服务天天抽奖_filtered.har 分析得到的主流程：
1. getStaticResource 查询活动配置。
2. superLeagueHome 查询抽奖首页和剩余抽奖次数。
3. apTaskList 查询任务列表。
4. apStartTaskTime 启动浏览计时任务。
5. apDoLimitTimeTask 领取计时任务奖励，获取抽奖机会。
6. superLeagueLottery 消耗抽奖机会抽奖。

环境变量：
1. JD_SERVICE_DRAW_DEBUG
   配置为 1 时打印更长 request/response。
2. JD_SERVICE_DRAW_WAIT_MS
   浏览任务等待毫秒数，默认按任务 timeLimitPeriod 加 1200ms。
3. JD_SERVICE_DRAW_MAX_TASKS
   最多执行多少个浏览任务，默认 8。
4. JD_SERVICE_DRAW_MAX_DRAW
   最多抽奖次数，默认 5。
5. JD_SERVICE_DRAW_SKIP_TASK / JD_SERVICE_DRAW_SKIP_DRAW
   分别跳过做任务、抽奖。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  createH5st,
  createJsSecurityH5st,
  getUserName,
  mergeCookieString,
  parseApiResponse,
  parseCookieString,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('服务天天抽奖领京豆');

const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = '4GEuU7ELthnEvAe99cYraziXuCsa';
const PAGE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?uAdSrc=1&llsource=jdservice`;
const API_ENDPOINT = 'https://api.m.jd.com/api';

const LINK_ID = 'VBhsn4WJZ3JeIOdB4nYvwg';
const AREA = process.env.JD_SERVICE_DRAW_AREA || '18_1482_3606_60000';

const CLIENT = 'ios';
const CLIENT_VERSION = '15.7.20';
const BUILD = '170437';
const DEFAULT_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const DEFAULT_EID = 'HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM57XE6EQQAAAAADGLVMNFRVTV7PUX';
const DEFAULT_WG_TOKEN = 'jdd01ROH5D72VYEXNCUFGWWJKVEN4C2STN5EMZQZS44H6EVR32J37BAKCXXMN56XNXMIT67W35ETJD3UAABI53QTTSCBRRUH4GGI7SWW6A5Y01234567';
const DEFAULT_MAX_TASKS = 8;
const DEFAULT_MAX_DRAW = 5;
const REQUEST_TIMEOUT_MS = 15000;

const USER_AGENT = process.env.JD_SERVICE_DRAW_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778079361%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const DEFAULT_ACTIVITY_COOKIE = [
  'b_webp=1',
  'webp=1',
  'b_avif=1',
  'b_dpr=3',
  'b_dw=390',
  'cid=8',
  'visitkey=7425235251882737841',
  `3AB9D23F7A4B3C9B=${DEFAULT_EID}`,
  `3AB9D23F7A4B3CSS=${DEFAULT_EID_TOKEN}`,
].join('; ');

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_SERVICE_DRAW_DEBUG === '1';
}

function stringifyForLog(value, maxLength = 1200) {
  const length = isDebugEnabled() ? Math.max(maxLength, 5000) : maxLength;
  return stringifySnippet(value, length);
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number.parseInt(value || '', 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function shouldSkip(name) {
  return process.env[`JD_SERVICE_DRAW_SKIP_${name}`] === '1';
}

function getCookieValue(cookie, key) {
  return parseCookieString(cookie).get(key) || '';
}

function getUuid(cookie) {
  if (process.env.JD_SERVICE_DRAW_UUID) {
    return process.env.JD_SERVICE_DRAW_UUID;
  }

  const preSession = getCookieValue(cookie, 'pre_session');
  if (preSession) {
    return decodeURIComponent(preSession).split('|')[0] || DEFAULT_UUID;
  }

  return getCookieValue(cookie, '__jdu') || DEFAULT_UUID;
}

function getEid(cookie) {
  return process.env.JD_SERVICE_DRAW_EID || getCookieValue(cookie, '3AB9D23F7A4B3C9B') || DEFAULT_EID;
}

function getEidToken(cookie) {
  return process.env.JD_SERVICE_DRAW_EID_TOKEN || getCookieValue(cookie, '3AB9D23F7A4B3CSS') || DEFAULT_EID_TOKEN;
}

function getWgToken() {
  return process.env.JD_SERVICE_DRAW_WG_TOKEN || DEFAULT_WG_TOKEN;
}

function buildActivityCookie(rawCookie) {
  const mergedCookie = mergeCookieString(DEFAULT_ACTIVITY_COOKIE, rawCookie);
  return mergeCookieString(mergedCookie, {
    '3AB9D23F7A4B3C9B': getEid(mergedCookie),
    '3AB9D23F7A4B3CSS': getEidToken(mergedCookie),
  });
}

function buildHeaders(cookie, extraHeaders = {}) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookie,
    Origin: ORIGIN,
    Referer: PAGE_REFERER,
    'User-Agent': USER_AGENT,
    'x-rp-client': 'h5_1.0.0',
    'x-referer-page': PAGE_URL,
    ...extraHeaders,
  };
}

function redactFormForLog(form) {
  const result = Object.fromEntries(form.entries());
  if (result['x-api-eid-token']) {
    result['x-api-eid-token'] = '已隐藏';
  }
  if (result['wg-sdk-token']) {
    result['wg-sdk-token'] = '已隐藏';
  }
  if (result.ext) {
    try {
      const ext = JSON.parse(result.ext);
      if (ext['x-api-eid-token']) {
        ext['x-api-eid-token'] = '已隐藏';
      }
      if (ext['wg-sdk-token']) {
        ext['wg-sdk-token'] = '已隐藏';
      }
      result.ext = ext;
    } catch (error) {
      result.ext = stringifySnippet(result.ext, 300);
    }
  }
  return result;
}

function logRequest(userName, functionId, url, form, headers) {
  $.log(`账号 ${userName}: ${functionId} request => ${stringifyForLog({
    url,
    form: redactFormForLog(form),
    headers: {
      ...headers,
      Cookie: '已隐藏',
    },
  })}`);
}

function logResponse(userName, functionId, response) {
  $.log(`账号 ${userName}: ${functionId} response => ${stringifyForLog(response, 1800)}`);
}

function appendFormValue(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.set(key, String(value));
  }
}

function buildBaseMeta(cookie) {
  const eidToken = getEidToken(cookie);
  const wgToken = getWgToken();
  return {
    'x-api-eid-token': eidToken,
    uuid: getUuid(cookie),
    build: BUILD,
    screen: '390*844',
    networkType: 'wifi',
    d_brand: 'iPhone',
    d_model: process.env.JD_SERVICE_DRAW_MODEL || 'iPhone14,5',
    lang: 'zh_CN',
    osVersion: process.env.JD_SERVICE_DRAW_OS_VERSION || '26.2',
    partner: '-1',
    'wg-sdk-token': wgToken,
    ext: JSON.stringify({
      appType: 'jdapp',
      systemType: 'ios',
      bigScreen: false,
      'x-api-eid-token': eidToken,
      'wg-sdk-token': wgToken,
      pageUrl: PAGE_URL,
    }),
    cthr: '1',
  };
}

async function buildSignedForm(cookie, options) {
  const {
    functionId,
    appid = 'activities_platform',
    body,
    h5stAppId = '',
    h5stMode = 'h5st41',
    extraForm = {},
    includeActivityMeta = true,
    client = CLIENT,
  } = options;

  const form = new URLSearchParams();
  appendFormValue(form, 'functionId', functionId);
  appendFormValue(form, 'body', JSON.stringify(body));
  appendFormValue(form, 't', Date.now());
  appendFormValue(form, 'appid', appid);
  appendFormValue(form, 'client', client);
  appendFormValue(form, 'clientVersion', CLIENT_VERSION);
  appendFormValue(form, 'platform', '3');

  for (const [key, value] of Object.entries(extraForm)) {
    appendFormValue(form, key, value);
  }
  if (includeActivityMeta) {
    for (const [key, value] of Object.entries(buildBaseMeta(cookie))) {
      appendFormValue(form, key, value);
    }
  }

  if (h5stAppId) {
    const h5st = h5stMode === 'js_security'
      ? await createJsSecurityH5st({
        h5stAppId,
        formFields: Object.fromEntries(form.entries()),
        cookie,
        userAgent: USER_AGENT,
        pageUrl: PAGE_URL,
        bizId: 'pro',
      })
      : await createH5st({
        functionId,
        body,
        h5stAppId,
        requestAppid: appid,
        cookie,
        userAgent: USER_AGENT,
        client,
        clientVersion: CLIENT_VERSION,
        version: '5.3',
      });
    appendFormValue(form, 'h5st', h5st);
  } else {
    appendFormValue(form, 'h5st', 'null');
  }

  return form;
}

async function postApi(cookie, userName, options) {
  const { functionId, extraHeaders = {} } = options;
  const form = await buildSignedForm(cookie, options);
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('functionId', functionId);
  const headers = buildHeaders(cookie, extraHeaders);

  logRequest(userName, functionId, url.toString(), form, headers);
  const response = await got.post(url.toString(), {
    body: form.toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const data = parseApiResponse(response);
  logResponse(userName, functionId, data);
  return data;
}

async function getPage(cookie, userName, url) {
  if (!url || !/^https?:\/\//.test(url)) {
    return;
  }

  $.log(`账号 ${userName}: 打开任务页 => ${url}`);
  const response = await got.get(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: cookie,
      Referer: PAGE_REFERER,
      'User-Agent': USER_AGENT,
    },
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  $.log(`账号 ${userName}: 任务页响应 => HTTP ${response.statusCode} ${stringifySnippet(response.body || '', 300)}`);
}

function buildTaskBody(task) {
  return {
    linkId: LINK_ID,
    taskId: task.id,
    itemId: getTaskUrl(task),
    channel: 4,
    pipeExt: task.pipeExt,
  };
}

function getTaskUrl(task) {
  return task?.taskSourceUrl || task?.backupSourceUrl || task?.forwardUrl || '';
}

function getTasks(taskListResponse) {
  return Array.isArray(taskListResponse?.data) ? taskListResponse.data : [];
}

function isTaskFinished(task) {
  return task?.taskFinished === true
    || Number(task?.taskDoTimes || 0) >= Number(task?.taskLimitTimes || 1)
    || task?.isReceived === true;
}

function isRunnableBrowseTask(task) {
  return task?.taskType === 'BROWSE_CHANNEL' && Boolean(getTaskUrl(task));
}

function summarizeTask(task) {
  return [
    task?.taskShowTitle || task?.taskTitle || '(未命名任务)',
    `id=${task?.id || '-'}`,
    `type=${task?.taskType || '-'}`,
    `done=${task?.taskDoTimes || 0}/${task?.taskLimitTimes || 0}`,
    `finished=${task?.taskFinished}`,
    `period=${task?.timeLimitPeriod || '-'}`,
    `assignment=${task?.pipeExt?.assignmentId || '-'}`,
    `reward=${task?.configBaseList?.[0]?.awardName || '-'}`,
  ].join(' | ');
}

async function getStaticResource(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'getStaticResource',
    body: {
      linkId: LINK_ID,
    },
  });
}

async function getStationMarquees(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'getStationMarquees',
    body: {
      linkId: LINK_ID,
      businessId: LINK_ID,
      size: '30',
    },
  });
}

async function queryHome(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'superLeagueHome',
    body: {
      linkId: LINK_ID,
      taskId: '',
      inviter: '',
      inJdApp: true,
    },
    h5stAppId: 'b7d17',
    h5stMode: 'js_security',
  });
}

async function drawLottery(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'superLeagueLottery',
    body: {
      linkId: LINK_ID,
    },
    h5stAppId: '60dc4',
    h5stMode: 'js_security',
  });
}

async function queryTaskList(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'apTaskList',
    body: {
      linkId: LINK_ID,
      queryType: 0,
      channel: 4,
      area: AREA,
    },
    extraForm: {
      loginType: '2',
      loginWQBiz: 'wegame',
      imei: '',
      aid: '',
      openudid: getUuid(cookie),
      adid: '',
    },
  });
}

async function startTaskTime(cookie, userName, task) {
  return postApi(cookie, userName, {
    functionId: 'apStartTaskTime',
    appid: 'activity_platform_se',
    body: buildTaskBody(task),
    h5stAppId: 'acb1e',
    h5stMode: 'js_security',
    extraForm: {
      loginType: '2',
      loginWQBiz: 'wegame',
    },
  });
}

async function doLimitTimeTask(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'apDoLimitTimeTask',
    body: {
      linkId: LINK_ID,
    },
    h5stAppId: 'ebecc',
    h5stMode: 'js_security',
    extraForm: {
      loginType: '2',
      loginWQBiz: 'wegame',
    },
  });
}

function getTaskWaitMs(task) {
  const configuredMs = readPositiveInt(process.env.JD_SERVICE_DRAW_WAIT_MS, 0);
  if (configuredMs > 0) {
    return configuredMs;
  }
  return (Number(task?.timeLimitPeriod || 5) * 1000) + 1200;
}

async function runDrawFlow(cookie, userName) {
  if (shouldSkip('DRAW')) {
    $.log(`账号 ${userName}: 已跳过抽奖`);
    return;
  }

  const home = await queryHome(cookie, userName);
  const remainTimes = Number(home?.data?.remainTimes || 0);
  $.log(`账号 ${userName}: 抽奖次数 => ${remainTimes}`);

  const maxDraw = Math.min(remainTimes, readPositiveInt(process.env.JD_SERVICE_DRAW_MAX_DRAW, DEFAULT_MAX_DRAW));
  for (let index = 0; index < maxDraw; index += 1) {
    $.log(`账号 ${userName}: 第 ${index + 1} 次抽奖`);
    await drawLottery(cookie, userName);
    await sleep(1500);
  }
}

async function runTaskFlow(cookie, userName) {
  if (shouldSkip('TASK')) {
    $.log(`账号 ${userName}: 已跳过任务`);
    return;
  }

  const taskListResponse = await queryTaskList(cookie, userName);
  const tasks = getTasks(taskListResponse);
  $.log(`账号 ${userName}: 任务列表 ${tasks.length} 个`);
  for (const task of tasks) {
    $.log(`账号 ${userName}: - ${summarizeTask(task)}`);
  }

  const maxTasks = readPositiveInt(process.env.JD_SERVICE_DRAW_MAX_TASKS, DEFAULT_MAX_TASKS);
  const pendingTasks = tasks
    .filter((task) => !isTaskFinished(task))
    .filter(isRunnableBrowseTask)
    .slice(0, maxTasks);

  for (const task of pendingTasks) {
    $.log(`账号 ${userName}: 执行任务 => ${summarizeTask(task)}`);
    await getPage(cookie, userName, getTaskUrl(task));
    await startTaskTime(cookie, userName, task);
    await sleep(getTaskWaitMs(task));
    await doLimitTimeTask(cookie, userName);
    await sleep(1000);
  }

  if (pendingTasks.length) {
    await queryTaskList(cookie, userName);
  }
}

async function runAccount(rawCookie, index) {
  const userName = getUserName(rawCookie);
  const cookie = buildActivityCookie(rawCookie);
  $.log(`\n账号${index} ${userName}: 开始`);
  await getStaticResource(cookie, userName);
  await getStationMarquees(cookie, userName);
  await runDrawFlow(cookie, userName);
  await runTaskFlow(cookie, userName);
  await runDrawFlow(cookie, userName);
}

(async () => {
  if (!cookies.length) {
    $.log('未找到京东 cookie，请先配置 jdCookie.js');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行失败 => ${error.stack || error.message || error}`);
    }
    await sleep(1500);
  }
})()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message || error}`);
  })
  .finally(() => {
    $.done();
    setTimeout(() => process.exit(0), 0);
  });
