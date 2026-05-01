/*
cron:35 0 * * * jdWegame_time_task.js

环境变量说明：
1. JD_WEGAME_TIME_LINK_ID
   含义：小游戏时长任务的 linkId。
   默认值：xI6b0R-KkhEsuN2Z8_R1Rw

2. JD_WEGAME_TIME_PAGE_URL
   含义：小游戏任务页 URL，用于 ext.pageUrl 和 Referer。
   默认值：https://pro.m.jd.com/mall/active/41D8A8L5aMNPg9TstWamSHnKzj1i/index.html

3. JD_WEGAME_TIME_AREA
   含义：apTaskList 请求体里的 area。
   默认值：18_1482_48938_54602

4. JD_WEGAME_TIME_CHANNEL
   含义：apTaskList / apsDoTask 请求体里的 channel。
   默认值：4

5. JD_WEGAME_TIME_EID_TOKEN
   含义：可选，覆盖 x-api-eid-token。
   默认值：脚本内置抓包值。

6. JD_WEGAME_TIME_SDK_TOKEN
   含义：可选，覆盖 wg-sdk-token。
   默认值：脚本内置抓包值。

7. JD_WEGAME_TIME_MAX_GRADES
   含义：最多尝试领奖几个阶梯档位。
   默认值：全部未领取档位。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getUserName,
  parseCookieString,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东小游戏时长任务');

const API_ENDPOINT = 'https://api.m.jd.com/api';
const APPID = 'activities_platform';
const CLIENT = 'ios';
const CLIENT_VERSION = '15.6.50';
const PLATFORM = '3';
const LOGIN_TYPE = '2';
const LOGIN_WQ_BIZ = 'wegame';

const DEFAULT_LINK_ID = 'xI6b0R-KkhEsuN2Z8_R1Rw';
const DEFAULT_PAGE_URL = 'https://pro.m.jd.com/mall/active/41D8A8L5aMNPg9TstWamSHnKzj1i/index.html';
const DEFAULT_AREA = '18_1482_48938_54602';
const DEFAULT_CHANNEL = 4;

const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM53CQIEVIAAAAAC5L5LPNHBVMEGMX';
const DEFAULT_SDK_TOKEN = 'jdd01GSHIB5ZGR7BE6BGDQQ5KYKP5FHDAO5HWCAV67QNHUH3GHBOT3VUB4MCHS3AEWOIGFXZY36Z5G7Z2PYDGNKPSBKDSLTITHDTIHHPYFXA01234567';
const ACTIVITY_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1777454809%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';

const DEFAULT_BUILD = '170394';
const DEFAULT_SCREEN = '390*844';
const DEFAULT_NETWORK_TYPE = 'wifi';
const DEFAULT_BRAND = 'iPhone';
const DEFAULT_MODEL = 'iPhone14,5';
const DEFAULT_LANG = 'zh_CN';
const DEFAULT_OS_VERSION = '26.2';
const DEFAULT_PARTNER = '-1';

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getPageUrl() {
  return process.env.JD_WEGAME_TIME_PAGE_URL || DEFAULT_PAGE_URL;
}

function getLinkId() {
  return process.env.JD_WEGAME_TIME_LINK_ID || DEFAULT_LINK_ID;
}

function getArea() {
  return process.env.JD_WEGAME_TIME_AREA || DEFAULT_AREA;
}

function getChannel() {
  const channel = Number(process.env.JD_WEGAME_TIME_CHANNEL || DEFAULT_CHANNEL);
  return Number.isFinite(channel) && channel > 0 ? channel : DEFAULT_CHANNEL;
}

function getMaxGrades() {
  const value = Number(process.env.JD_WEGAME_TIME_MAX_GRADES || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Number.POSITIVE_INFINITY;
}

function getDeviceUuid(cookie) {
  const cookieMap = parseCookieString(cookie);
  return cookieMap.get('deviceid_pdj_jd') || cookieMap.get('deviceId') || '224e6c34e7638196d45b7006b8f1713f8d4ec463';
}

function buildExtraForm(cookie) {
  const uuid = getDeviceUuid(cookie);
  const eidToken = process.env.JD_WEGAME_TIME_EID_TOKEN || DEFAULT_EID_TOKEN;
  const sdkToken = process.env.JD_WEGAME_TIME_SDK_TOKEN || DEFAULT_SDK_TOKEN;

  return {
    t: Date.now(),
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    'x-api-eid-token': eidToken,
    uuid,
    build: DEFAULT_BUILD,
    screen: DEFAULT_SCREEN,
    networkType: DEFAULT_NETWORK_TYPE,
    d_brand: DEFAULT_BRAND,
    d_model: DEFAULT_MODEL,
    lang: DEFAULT_LANG,
    osVersion: DEFAULT_OS_VERSION,
    partner: DEFAULT_PARTNER,
    'wg-sdk-token': sdkToken,
    ext: JSON.stringify({
      appType: 'jdapp',
      systemType: 'ios',
      bigScreen: false,
      'x-api-eid-token': eidToken,
      'wg-sdk-token': sdkToken,
      pageUrl: encodeURIComponent(getPageUrl()),
    }),
    imei: '',
    aid: '',
    openudid: uuid,
    adid: '',
    cthr: '1',
  };
}

async function callActivityApi(cookie, functionId, body) {
  return postFormApi(cookie, {
    endpoint: API_ENDPOINT,
    functionId,
    appid: APPID,
    body,
    client: CLIENT,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    origin: 'https://pro.m.jd.com',
    referer: `${getPageUrl()}?stath=47&navh=44&babelChannel=ttt57`,
    userAgent: ACTIVITY_USER_AGENT,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': getPageUrl(),
      'request-from': 'native',
    },
    extraForm: buildExtraForm(cookie),
  });
}

async function queryTimeTaskList(cookie) {
  return callActivityApi(cookie, 'apTaskList', {
    linkId: getLinkId(),
    queryType: 2,
    channel: getChannel(),
    area: getArea(),
  });
}

async function doStepGameTimeTask(cookie, taskId, assignmentId, itemId) {
  return callActivityApi(cookie, 'apsDoTask', {
    taskType: 'STEP_GAME_TIME',
    taskId,
    channel: getChannel(),
    checkVersion: true,
    linkId: getLinkId(),
    pipeExt: {
      taskType: 'STEP_GAME_TIME',
      assignmentId,
    },
    itemId,
  });
}

function findStepGameTimeTask(taskListResult) {
  const taskList = Array.isArray(taskListResult?.data) ? taskListResult.data : [];
  return taskList.find((task) => String(task?.taskType) === 'STEP_GAME_TIME');
}

function buildGradeAttempts(task) {
  const gradeInfoList = Array.isArray(task?.gradeInfoList) ? task.gradeInfoList : [];
  return gradeInfoList
    .map((gradeInfo, index) => ({
      itemId: index + 1,
      gradeInfo,
      hasReceived: Number(gradeInfo?.hasRecieved || 0) > 0,
      receivedStatus: Boolean(gradeInfo?.status),
      targetSeconds: Number(gradeInfo?.secondTime || 0),
      rewardText: `${gradeInfo?.awardNum || '?'}${gradeInfo?.awardName || ''}`,
      gradeName: gradeInfo?.gradeName || `第${index + 1}档`,
    }))
    .filter((grade) => !grade.hasReceived && !grade.receivedStatus);
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-';
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}分钟`;
  }
  return `${seconds}秒`;
}

function formatGradeState(gradeInfo, index) {
  const reward = `${gradeInfo?.awardNum || '?'}${gradeInfo?.awardName || ''}`;
  const target = formatSeconds(Number(gradeInfo?.secondTime || 0));
  const received = Number(gradeInfo?.hasRecieved || 0) > 0 || Boolean(gradeInfo?.status);
  return `第${index + 1}档 ${target} => ${reward} | 已领取=${received ? '是' : '否'}`;
}

function logTaskSummary(prefix, task) {
  const gradeInfoList = Array.isArray(task?.gradeInfoList) ? task.gradeInfoList : [];
  $.log(`${prefix}: 时长任务 => taskId=${task?.id} | assignmentId=${task?.pipeExt?.assignmentId || '-'} | 档位数=${gradeInfoList.length}`);
  if (gradeInfoList.length) {
    $.log(`${prefix}: 档位状态 => ${gradeInfoList.map(formatGradeState).join(' || ')}`);
  }
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);

  const taskListResult = await queryTimeTaskList(cookie);
  const task = findStepGameTimeTask(taskListResult);
  if (!task) {
    $.log(`${prefix}: 未找到 STEP_GAME_TIME 任务 => ${stringifySnippet(taskListResult, 1000)}`);
    return;
  }

  logTaskSummary(prefix, task);

  const assignmentId = task?.pipeExt?.assignmentId || '';
  if (!assignmentId) {
    $.log(`${prefix}: 时长任务缺少 assignmentId，无法领奖`);
    return;
  }

  const pendingGrades = buildGradeAttempts(task).slice(0, getMaxGrades());
  $.log(`${prefix}: 待尝试档位数 => ${pendingGrades.length}`);
  if (!pendingGrades.length) {
    $.log(`${prefix}: 所有时长档位均已领取`);
    return;
  }

  for (const grade of pendingGrades) {
    $.log(`${prefix}: 尝试领取 ${grade.gradeName} | 目标=${formatSeconds(grade.targetSeconds)} | 奖励=${grade.rewardText}`);
    const doTaskResult = await doStepGameTimeTask(cookie, task.id, assignmentId, grade.itemId);
    $.log(`${prefix}: 领取结果 => ${stringifySnippet(doTaskResult, 1000)}`);

    await sleep(1000);

    const latestTaskListResult = await queryTimeTaskList(cookie);
    const latestTask = findStepGameTimeTask(latestTaskListResult);
    if (!latestTask) {
      $.log(`${prefix}: 复查未找到 STEP_GAME_TIME => ${stringifySnippet(latestTaskListResult, 1000)}`);
      continue;
    }
    logTaskSummary(prefix, latestTask);
  }
}

async function main() {
  if (!cookies.length) {
    $.log('未找到有效的 JD Cookie');
    return;
  }

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行异常 => ${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常 => ${error.message || error}`))
  .finally(() => $.done());
