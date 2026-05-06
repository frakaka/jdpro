/*
cron:46 0 * * * jd_qixian_bean.js

七鲜签到领京豆：签到、查询抽奖机、浏览任务、抽奖。

基于 files/traffic_jd_七鲜领京豆_filtered.har 分析得到的主流程：
1. bean_deliverySign_home 查询签到状态。
2. bean_deliverySign_sign 执行签到领京豆。
3. lotteryMachineHome 查询抽奖机首页和剩余抽奖次数。
4. apTaskList 查询抽奖任务。
5. 浏览任务页后调用 apsDoTask 完成浏览任务，计时任务再尝试 apStartTaskTime / apDoLimitTimeTask。
6. 有抽奖次数时调用 lotteryMachineDraw。

环境变量：
1. JD_QIXIAN_DEBUG
   配置为 1 时打印更长 request/response。
2. JD_QIXIAN_WAIT_MS
   浏览任务等待毫秒数，默认 6000。
3. JD_QIXIAN_MAX_DRAW
   最多抽奖次数，默认 5。
4. JD_QIXIAN_SKIP_SIGN / JD_QIXIAN_SKIP_TASK / JD_QIXIAN_SKIP_DRAW
   分别跳过签到、做任务、抽奖。
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

const $ = new Env('七鲜签到领京豆');

const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = '4CoVvhc2SwoEtR4uHCjsEn2fKr96';
const PAGE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt1`;
const API_ENDPOINT = 'https://api.m.jd.com/';
const API_ENDPOINT_WITH_PATH = 'https://api.m.jd.com/api';

const SIGN_ACTIVITY_ID = '6358';
const LOTTERY_LINK_ID = 'jv2FVT0mA5FZ24MhKfZxbQ';
const SIGN_STATIC_LINK_ID = 'Tn-gdh8ujarRMziovP-ihg';
const AREA = process.env.JD_QIXIAN_AREA || '18_1482_3606_60000';

const CLIENT = 'ios';
const CLIENT_VERSION = '15.7.20';
const BUILD = '170437';
const DEFAULT_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const DEFAULT_EID = 'HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM57VWJU4IAAAAAD6NYLK464YMT64X';
const DEFAULT_WG_TOKEN = 'jdd01BK3PM24CE65CGS4UXMQY4KEQN3X7UIZ2K7C3VC755RNIT434L4U6MLBTKHBSGTAVFZC5TRBXSLZEWWHKNXEAN3U52IX7XSSYPXC3ARY01234567';
const DEFAULT_WAIT_MS = 6000;
const DEFAULT_MAX_DRAW = 5;
const REQUEST_TIMEOUT_MS = 15000;

const USER_AGENT = process.env.JD_QIXIAN_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

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
  return process.env.JD_QIXIAN_DEBUG === '1';
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
  return process.env[`JD_QIXIAN_SKIP_${name}`] === '1';
}

function getCookieValue(cookie, key) {
  return parseCookieString(cookie).get(key) || '';
}

function getUuid(cookie) {
  if (process.env.JD_QIXIAN_UUID) {
    return process.env.JD_QIXIAN_UUID;
  }

  const preSession = getCookieValue(cookie, 'pre_session');
  if (preSession) {
    return decodeURIComponent(preSession).split('|')[0] || DEFAULT_UUID;
  }

  return getCookieValue(cookie, '__jdu') || DEFAULT_UUID;
}

function getEid(cookie) {
  return process.env.JD_QIXIAN_EID || getCookieValue(cookie, '3AB9D23F7A4B3C9B') || DEFAULT_EID;
}

function getEidToken(cookie) {
  return process.env.JD_QIXIAN_EID_TOKEN || getCookieValue(cookie, '3AB9D23F7A4B3CSS') || DEFAULT_EID_TOKEN;
}

function getWgToken() {
  return process.env.JD_QIXIAN_WG_TOKEN || DEFAULT_WG_TOKEN;
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
    Referer: ORIGIN + '/',
    'User-Agent': USER_AGENT,
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
    d_model: process.env.JD_QIXIAN_MODEL || 'iPhone14,5',
    lang: 'zh_CN',
    osVersion: process.env.JD_QIXIAN_OS_VERSION || '26.2',
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
    appid,
    body,
    h5stAppId = '',
    h5stMode = 'h5st41',
    includeActivityMeta = false,
    includeSignMeta = false,
    extraForm = {},
    client = CLIENT,
  } = options;

  const form = new URLSearchParams();
  appendFormValue(form, 'functionId', functionId);
  appendFormValue(form, 'body', JSON.stringify(body));
  appendFormValue(form, 't', includeActivityMeta ? Date.now() : '');
  appendFormValue(form, 'appid', appid);
  appendFormValue(form, 'client', client);
  appendFormValue(form, 'clientVersion', CLIENT_VERSION);

  if (includeActivityMeta) {
    appendFormValue(form, 'platform', '3');
  }
  for (const [key, value] of Object.entries(extraForm)) {
    appendFormValue(form, key, value);
  }
  if (includeSignMeta) {
    appendFormValue(form, 'rfs', '0000');
    appendFormValue(form, 'uuid', getUuid(cookie));
    appendFormValue(form, 'build', BUILD);
    appendFormValue(form, 'd_model', '');
    appendFormValue(form, 'osVersion', process.env.JD_QIXIAN_OS_VERSION || '26.2');
    appendFormValue(form, 'eid', getEid(cookie));
    appendFormValue(form, 'screen', '844*390');
    appendFormValue(form, 'appBuild', BUILD);
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
  } else if (includeActivityMeta) {
    appendFormValue(form, 'h5st', 'null');
  }

  if (includeSignMeta && !form.has('x-api-eid-token')) {
    appendFormValue(form, 'x-api-eid-token', getEidToken(cookie));
  }

  return form;
}

async function postApi(cookie, userName, options) {
  const {
    endpoint = API_ENDPOINT,
    functionId,
    extraHeaders = {},
  } = options;
  const form = await buildSignedForm(cookie, options);
  const url = new URL(endpoint);
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

async function querySignHome(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'bean_deliverySign_home',
    appid: 'signed_wh5_ihub',
    body: {
      iHubType: 'simple',
      activityId: SIGN_ACTIVITY_ID,
    },
    h5stAppId: 'c1e85',
    includeSignMeta: true,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
}

async function signBean(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'bean_deliverySign_sign',
    appid: 'signed_wh5_ihub',
    body: {
      activityId: SIGN_ACTIVITY_ID,
    },
    h5stAppId: '987dd',
    includeSignMeta: true,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
  });
}

async function getSignStaticResource(cookie, userName) {
  return postApi(cookie, userName, {
    functionId: 'getStaticResource',
    appid: 'activities_platform',
    body: {
      linkId: SIGN_STATIC_LINK_ID,
      activityId: SIGN_ACTIVITY_ID,
    },
    extraForm: {
      rfs: '0000',
    },
  });
}

async function getLotteryStaticResource(cookie, userName) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'getStaticResource',
    appid: 'activities_platform',
    body: {
      linkId: LOTTERY_LINK_ID,
    },
    includeActivityMeta: true,
  });
}

async function queryLotteryHome(cookie, userName) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'lotteryMachineHome',
    appid: 'activities_platform',
    body: {
      linkId: LOTTERY_LINK_ID,
      taskId: '',
      inviter: '',
    },
    h5stAppId: 'd7439',
    includeActivityMeta: true,
  });
}

async function drawLottery(cookie, userName) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'lotteryMachineDraw',
    appid: 'activities_platform',
    body: {
      linkId: LOTTERY_LINK_ID,
    },
    h5stAppId: 'd7439',
    includeActivityMeta: true,
  });
}

async function queryTaskList(cookie, userName) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'apTaskList',
    appid: 'activities_platform',
    body: {
      linkId: LOTTERY_LINK_ID,
      queryType: 0,
      channel: 4,
      area: AREA,
    },
    includeActivityMeta: true,
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

function buildTaskBaseBody(task, pipeExt = task.pipeExt) {
  return {
    taskType: task.taskType,
    taskId: task.id,
    channel: 4,
    checkVersion: true,
    linkId: LOTTERY_LINK_ID,
    pipeExt,
  };
}

async function queryTaskDetail(cookie, userName, task) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'apTaskDetail',
    appid: 'activities_platform',
    body: buildTaskBaseBody(task),
    includeActivityMeta: true,
    extraForm: {
      loginType: '2',
      loginWQBiz: 'wegame',
      imei: '',
      aid: '',
      openudid: '',
      adid: '',
    },
  });
}

async function startTaskTime(cookie, userName, task) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'apStartTaskTime',
    appid: 'activity_platform_se',
    body: {
      linkId: LOTTERY_LINK_ID,
      taskType: task.taskType,
      taskId: task.id,
      assignmentId: task.pipeExt?.assignmentId,
    },
    h5stAppId: 'acb1e',
    includeActivityMeta: true,
    extraForm: {
      loginType: '2',
      loginWQBiz: 'wegame',
    },
  });
}

function selectTaskItem(taskDetailResponse, task) {
  const detailItems = taskDetailResponse?.data?.taskItemList;
  if (Array.isArray(detailItems) && detailItems.length) {
    return detailItems.find((item) => item && item.subscribed !== true) || detailItems[0];
  }

  const taskItems = task?.taskItemList;
  if (Array.isArray(taskItems) && taskItems.length) {
    return taskItems[0];
  }

  return null;
}

function buildTaskPipeExt(task, taskItem) {
  return {
    ...(task.pipeExt || {}),
    ...(taskItem?.pipeExt || {}),
    taskType: task.taskType,
    timeLimitSwitch: taskItem?.pipeExt?.timeLimitSwitch ?? task.pipeExt?.timeLimitSwitch ?? task.timeLimitSwitch ?? 0,
  };
}

function getTaskVisitUrl(task, taskItem) {
  return taskItem?.itemId
    || taskItem?.clickUrl
    || taskItem?.itemUrl
    || task.backupSourceUrl
    || task.taskSourceUrl
    || '';
}

async function doTask(cookie, userName, task, taskItem) {
  const visitUrl = getTaskVisitUrl(task, taskItem);
  const body = {
    ...buildTaskBaseBody(task, buildTaskPipeExt(task, taskItem)),
    taskInsert: taskItem?.taskInsert === true,
  };
  if (visitUrl) {
    body.itemId = encodeURIComponent(visitUrl);
  }

  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'apsDoTask',
    appid: 'activities_platform',
    body,
    h5stAppId: '54ed7',
    h5stMode: 'js_security',
    includeActivityMeta: true,
    extraForm: {
      appId: '54ed7',
      loginType: '2',
      loginWQBiz: 'wegame',
    },
  });
}

async function doLimitTimeTask(cookie, userName) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'apDoLimitTimeTask',
    appid: 'activities_platform',
    body: {
      linkId: LOTTERY_LINK_ID,
    },
    h5stAppId: 'ebecc',
    includeActivityMeta: true,
    extraForm: {
      loginType: '2',
      loginWQBiz: 'wegame',
    },
  });
}

async function drawTaskAward(cookie, userName, task) {
  return postApi(cookie, userName, {
    endpoint: API_ENDPOINT_WITH_PATH,
    functionId: 'apTaskDrawAward',
    appid: 'activities_platform',
    body: {
      linkId: LOTTERY_LINK_ID,
      taskType: task.taskType,
      taskId: task.id,
      channel: 4,
      checkVersion: true,
      assignmentId: task.pipeExt?.assignmentId,
      rewardId: task.configBaseList?.[0]?.rewardId,
    },
    h5stAppId: 'f0f3f',
    h5stMode: 'js_security',
    includeActivityMeta: true,
    extraForm: {
      appId: 'f0f3f',
      loginType: '2',
      loginWQBiz: 'wegame',
    },
  });
}

function getTasks(taskListResponse) {
  return Array.isArray(taskListResponse?.data) ? taskListResponse.data : [];
}

function isTaskFinished(task) {
  return task?.taskFinished === true
    || Number(task?.taskDoTimes || 0) >= Number(task?.taskLimitTimes || 1)
    || task?.isReceived === true;
}

function summarizeTask(task) {
  return [
    task?.taskTitle || '(未命名任务)',
    `id=${task?.id || '-'}`,
    `type=${task?.taskType || '-'}`,
    `done=${task?.taskDoTimes || 0}/${task?.taskLimitTimes || 0}`,
    `finished=${task?.taskFinished}`,
    `assignment=${task?.pipeExt?.assignmentId || '-'}`,
    `reward=${task?.configBaseList?.[0]?.awardName || '-'}`,
  ].join(' | ');
}

function shouldTryTimerFallback(task) {
  return process.env.JD_QIXIAN_TRY_TIMER === '1'
    || Number(task?.timeLimitSwitch || 0) === 1
    || Number(task?.timeLimitSwitch || 0) === 2;
}

async function runSignFlow(cookie, userName) {
  if (shouldSkip('SIGN')) {
    $.log(`账号 ${userName}: 已跳过签到`);
    return;
  }

  await getSignStaticResource(cookie, userName);
  const home = await querySignHome(cookie, userName);
  const signButton = home?.data?.result?.signButton || {};
  $.log(`账号 ${userName}: 签到状态 => status=${signButton.status || '-'} beans=${home?.data?.result?.jdBeanCount || '-'}`);
  if (Number(signButton.status) === 2) {
    $.log(`账号 ${userName}: 今日已签到`);
    return;
  }

  const signResponse = await signBean(cookie, userName);
  const signResult = signResponse?.data?.result || {};
  $.log(`账号 ${userName}: 签到结果 => rewardSuccess=${signResult.rewardSuccess} value=${signResult.value || '-'}`);
  await sleep(1000);
  await querySignHome(cookie, userName);
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

  const pendingTasks = tasks.filter((task) => !isTaskFinished(task));
  for (const task of pendingTasks) {
    $.log(`账号 ${userName}: 执行任务 => ${summarizeTask(task)}`);
    const taskDetailResponse = await queryTaskDetail(cookie, userName, task);
    const taskItem = selectTaskItem(taskDetailResponse, task);
    const visitUrl = getTaskVisitUrl(task, taskItem);
    if (visitUrl) {
      await getPage(cookie, userName, visitUrl);
    }
    const taskResponse = await doTask(cookie, userName, task, taskItem);
    await sleep(1000);

    if (Number(taskResponse?.code) !== 0 && shouldTryTimerFallback(task)) {
      await startTaskTime(cookie, userName, task);
      await sleep(readPositiveInt(process.env.JD_QIXIAN_WAIT_MS, DEFAULT_WAIT_MS));
      await doLimitTimeTask(cookie, userName);
      await sleep(1000);
    }

    await drawTaskAward(cookie, userName, task);
    await sleep(1000);
  }

  if (pendingTasks.length) {
    await queryTaskList(cookie, userName);
  }
}

async function runDrawFlow(cookie, userName) {
  if (shouldSkip('DRAW')) {
    $.log(`账号 ${userName}: 已跳过抽奖`);
    return;
  }

  await getLotteryStaticResource(cookie, userName);
  let home = await queryLotteryHome(cookie, userName);
  let remainTimes = Number(home?.data?.remainTimes || 0);
  $.log(`账号 ${userName}: 抽奖次数 => ${remainTimes}`);

  const maxDraw = Math.min(remainTimes, readPositiveInt(process.env.JD_QIXIAN_MAX_DRAW, DEFAULT_MAX_DRAW));
  for (let index = 0; index < maxDraw; index += 1) {
    $.log(`账号 ${userName}: 第 ${index + 1} 次抽奖`);
    await drawLottery(cookie, userName);
    await sleep(1500);
  }

  if (maxDraw > 0) {
    home = await queryLotteryHome(cookie, userName);
    remainTimes = Number(home?.data?.remainTimes || 0);
    $.log(`账号 ${userName}: 抽奖后剩余次数 => ${remainTimes}`);
  }
}

async function runAccount(rawCookie, index) {
  const userName = getUserName(rawCookie);
  const cookie = buildActivityCookie(rawCookie);
  $.log(`\n账号${index} ${userName}: 开始`);
  await runSignFlow(cookie, userName);
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
