/*
cron:18 0 * * * jd_huhong_game_browsing_task.js

互动游戏浏览任务。
流程来自 files/traffic_jd_huhong_game_browsing_task_filtered.har：
1. headless Chrome 打开活动页，注入账号 Cookie 并补齐浏览器会话 Cookie。
2. weGameHome / weGameLottery 执行每日签到。
3. interactGameRewardJudge / interactGameReward 领取页面即时奖励。
4. interact_act_invoke(actLoad / recevieAward) 领取经验档位奖励。
5. apTaskList / apTaskDetail / apStartTaskTime / 浏览落地页 / apDoLimitTimeTask 完成浏览任务。
6. 浏览后再次领取可领取的经验档位奖励。
*/

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getUserName,
  mergeCookieString,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东互动游戏任务');

const DEBUG_HOST = '127.0.0.1';
const API_ENDPOINT = 'https://api.m.jd.com/api';
const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = '3fcyrvLZALNPWCEDRvaZJVrzek8v';
const PAGE_BASE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_URL = `${PAGE_BASE_URL}?babelChannel=ttt106&hybrid_err_view=1&commontitle=no&iconKey=dandanfan`;

const HOME_LINK_ID = 'MWC_-5cWq-JH1wrPPteH4w';
const TASK_LINK_ID = '6ylwhxlv346dqlaytc911';
const INSTANT_REWARD_LINK_ID = 'QKltPCgCHnIo52E2yaoM5w';
const TASK_AREA = process.env.JD_HUHONG_TASK_AREA || '0_0_0_0';

const CLIENT = 'android';
const CLIENT_VERSION = '15.9.0';
const PLATFORM = '3';
const LOGIN_TYPE = '2';
const LOGIN_WQ_BIZ = 'wegame';
const BUILD = '102473';
const SCREEN = '360*780';
const NETWORK_TYPE = 'wifi';
const D_BRAND = 'HONOR';
const D_MODEL = 'JSN-AL00a';
const OS_VERSION = '9';
const PARTNER = 'jingdong';
const DEFAULT_EID_TOKEN = 'jdd03GYYLHBRIXA53QDDYQZJL373EWRY67WTBMBTUGWQZFOKI2HUROR67PJAVQPH4RQ5UVKGLTDXNOCYMIOIKPLBZ25ITS4AAAAM7SN77BJAAAAAACJQYZ2VBUFQ4EYX';
const DEFAULT_WG_TOKEN = 'jdd01Y2EXM4ANWNS3YW3MGL7HCHLNONWW26JKDF5EBQIMQOUK63QRH3O7R7NQOGACOC4AFGB7DETKWOXDVOL5K7ZGX7HVVMSBWI4Y6HFMKOA01234567';
const DEFAULT_JS_SECURITY_SCRIPT_URL = 'https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.5.js?v=2406';

const USER_AGENT = process.env.JD_HUHONG_USER_AGENT || 'jdapp;android;15.9.0;;;M/5.0;appBuild/102473;ef/1;ep/%7B%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22ts%22%3A1784886146757%2C%22ridx%22%3A-1%2C%22cipher%22%3A%7B%22sv%22%3A%22EG%3D%3D%22%2C%22ad%22%3A%22CWYyCNZsEJVwYwHvDwTuCK%3D%3D%22%2C%22od%22%3A%22YwDvEWTvCzUjZtc1ZI1wDJu2BJu3ZwGjYWG1YtdwZwU1CwYy%22%2C%22ov%22%3A%22Ctq%3D%22%2C%22ud%22%3A%22CWYyCNZsEJVwYwHvDwTuCK%3D%3D%22%7D%2C%22ciphertype%22%3A5%2C%22version%22%3A%221.2.1%22%2C%22appname%22%3A%22com.jingdong.app.mall%22%7D;jdSupportDarkMode/0;lang/zh_CN;site/CN;elder/2;ccy/CNY;tz/;Mozilla/5.0 (Linux; Android 9; JSN-AL00a Build/HONORJSN-AL00a; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.136 Mobile Safari/537.36';

const DEFAULT_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/opt/homebrew/bin/chromium',
  '/usr/local/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const HEADFUL = process.env.JD_HUHONG_CHROME_HEADFUL === '1';
const BOOTSTRAP_WAIT_MS = readPositiveInt(process.env.JD_HUHONG_CHROME_LOAD_MS, 15000);
const CHROME_EVALUATE_TIMEOUT_MS = readPositiveInt(process.env.JD_HUHONG_CHROME_EVALUATE_TIMEOUT_MS, 45000);
const TASK_WAIT_BUFFER_MS = readPositiveInt(process.env.JD_HUHONG_TASK_WAIT_BUFFER_MS, 8000);
const COMPLETE_RETRY_TIMES = readPositiveInt(process.env.JD_HUHONG_COMPLETE_RETRY_TIMES, 5);
const STAGE_CLAIM_ROUNDS = readPositiveInt(process.env.JD_HUHONG_STAGE_CLAIM_ROUNDS, 4);
const MAX_TASKS = readMaxTasks();

function isDebugEnabled() {
  return process.env.JD_HUHONG_DEBUG === '1';
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number.parseInt(value || '', 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function readMaxTasks() {
  const configuredValue = process.env.JD_HUHONG_MAX_TASKS;
  if (!configuredValue) {
    return Number.POSITIVE_INFINITY;
  }
  return readPositiveInt(configuredValue, Number.POSITIVE_INFINITY);
}

function formatTaskLimit(value) {
  return Number.isFinite(value) ? String(value) : '不限制';
}

function getCookies() {
  return Object.values(jdCookieNode).filter(Boolean);
}

function parseCookies(cookieText) {
  return String(cookieText || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex <= 0) {
        return null;
      }
      return {
        name: item.slice(0, separatorIndex),
        value: item.slice(separatorIndex + 1),
      };
    })
    .filter((item) => item?.name && item.value);
}

function getChromeBin() {
  return DEFAULT_CHROME_CANDIDATES.find((item) => item && fs.existsSync(item)) || '';
}

function redactValue(key, value) {
  if (/cookie|token|pt_key|pt_pin/i.test(key)) {
    return value ? '已隐藏' : value;
  }
  if (key === 'h5st' && typeof value === 'string') {
    return value === 'null' ? value : `${value.split(';').slice(0, 4).join(';')};...`;
  }
  return value;
}

function redactObjectForLog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'ext' && typeof item === 'string') {
      const parsedExt = safeJsonParse(item, item);
      result[key] = redactObjectForLog(parsedExt);
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      result[key] = redactObjectForLog(item);
      continue;
    }
    result[key] = redactValue(key, item);
  }
  return result;
}

function stringifyForLog(value, maxLength = 1400) {
  return stringifySnippet(value, isDebugEnabled() ? Math.max(maxLength, 5000) : maxLength);
}

function createDeviceProfile(cookie) {
  const seed = crypto
    .createHash('sha256')
    .update(`${getUserName(cookie)}:${cookie}:jd-huhong-game`)
    .digest();
  const digits = Array.from(seed)
    .map((byte) => String(byte % 10))
    .join('')
    .padEnd(32, '0');
  const eu = digits.slice(0, 16);
  const fv = digits.slice(16, 32);
  const aid = crypto
    .createHash('md5')
    .update(`${eu}:${fv}:jd-huhong-game`)
    .digest('hex')
    .slice(0, 16);

  return {
    uuid: `${eu}-${fv}`,
    eu,
    fv,
    imei: eu,
    aid,
  };
}

function buildExt(cookie) {
  const eidToken = process.env.JD_HUHONG_EID_TOKEN || DEFAULT_EID_TOKEN;
  const wgToken = process.env.JD_HUHONG_WG_TOKEN || DEFAULT_WG_TOKEN;
  return JSON.stringify({
    appType: 'jdapp',
    systemType: 'android',
    bigScreen: false,
    'x-api-eid-token': eidToken,
    'wg-sdk-token': wgToken,
    pageUrl: PAGE_BASE_URL,
  });
}

function buildBaseMeta(cookie, options = {}) {
  const device = createDeviceProfile(cookie);
  const meta = {
    'x-api-eid-token': process.env.JD_HUHONG_EID_TOKEN || DEFAULT_EID_TOKEN,
    uuid: device.uuid,
    build: BUILD,
    screen: SCREEN,
    networkType: NETWORK_TYPE,
    d_brand: D_BRAND,
    d_model: D_MODEL,
    lang: 'zh_CN',
    osVersion: OS_VERSION,
    partner: PARTNER,
    'wg-sdk-token': process.env.JD_HUHONG_WG_TOKEN || DEFAULT_WG_TOKEN,
    ext: buildExt(cookie),
    eufv: '1',
    eu: device.eu,
    fv: device.fv,
    cthr: '1',
  };

  if (options.includeTaskDeviceFields) {
    meta.imei = device.imei;
    meta.aid = device.aid;
    meta.openudid = '';
    meta.adid = '';
  }

  return meta;
}

function buildExtraHeaders() {
  return {
    'x-requested-with': 'com.jingdong.app.mall',
    'x-referer-page': PAGE_BASE_URL,
  };
}

async function callActivityApi(cdp, cookie, prefix, functionId, body, options = {}) {
  const extraForm = {
    t: Date.now(),
    appid: options.appid || 'activities_platform',
    functionId,
    body,
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    ...buildBaseMeta(cookie, { includeTaskDeviceFields: options.includeTaskDeviceFields }),
    ...(options.includeXApiScval2 ? { xAPIScval2: 'lx' } : {}),
    ...(options.forceNullH5st ? { h5st: 'null' } : {}),
    ...(options.extraForm || {}),
  };
  const endpoint = options.endpoint || API_ENDPOINT;
  const payload = {
    endpoint,
    functionId,
    body,
    appid: options.appid || 'activities_platform',
    h5stAppId: options.h5stAppId || '',
    nullH5st: Boolean(options.forceNullH5st),
    extraForm,
    extraHeaders: {
      ...buildExtraHeaders(),
      ...(options.extraHeaders || {}),
    },
  };
  const requestLog = {
    url: `${endpoint}?functionId=${functionId}`,
    functionId,
    appid: payload.appid,
    h5stAppId: options.h5stAppId || '',
    body,
    form: redactObjectForLog(extraForm),
  };
  $.log(`${prefix}: 请求 => ${functionId} ${stringifyForLog(requestLog, 1800)}`);

  const response = await chromePostApi(cdp, payload, prefix);
  $.log(`${prefix}: Chrome请求 => ${functionId} ${stringifyForLog(redactObjectForLog(response.request || {}), 1800)}`);
  $.log(`${prefix}: 响应头 => ${functionId} HTTP ${response.status}`);
  $.log(`${prefix}: 响应体 => ${functionId} ${stringifyForLog(response.response?.parsed, 2200)}`);
  if (isDebugEnabled()) {
    $.log(`${prefix}: 原始响应 => ${functionId} ${stringifyForLog(response.response?.raw || '', 3000)}`);
  }

  return response.response?.parsed;
}

function getInnerCode(result) {
  return Number(result?.data?.code ?? result?.code ?? -1);
}

function getInnerMessage(result) {
  return result?.data?.errMsg || result?.errMsg || result?.message || result?.msg || '';
}

function getInnerData(result) {
  return result?.data?.data;
}

async function queryHome(cdp, cookie, prefix) {
  return callActivityApi(cdp, cookie, prefix, 'weGameHome', {
    envType: 1,
    linkId: HOME_LINK_ID,
    babelChannel: 'ttt106',
  }, {
    appid: 'wegame-hub',
    h5stAppId: '101aa',
  });
}

async function signDaily(cdp, cookie, prefix) {
  const homeResult = await queryHome(cdp, cookie, prefix);
  const signMain = homeResult?.data?.signMainVo || {};
  $.log(`${prefix}: 签到状态 => currentStatus=${signMain.currentStatus ?? '-'}，button=${signMain.buttonText || '-'}`);

  if (Number(signMain.currentStatus) !== 1 && !String(signMain.buttonText || '').includes('立即签到')) {
    $.log(`${prefix}: 今日签到不可执行或已完成`);
    return;
  }

  const markStr = signMain.markStr || '';
  $.log(`${prefix}: 签到 markStr => ${markStr ? '已获取' : '空'}`);

  const lotteryResult = await callActivityApi(cdp, cookie, prefix, 'weGameLottery', {
    envType: 1,
    linkId: HOME_LINK_ID,
    status: 1,
    markStr,
  }, {
    appid: 'wegame-hub',
    h5stAppId: '730a6',
  });
  $.log(`${prefix}: 每日签到领取 => ${summarizeAwardResult(lotteryResult)}`);

  const refreshedHome = await queryHome(cdp, cookie, prefix);
  const refreshedSignMain = refreshedHome?.data?.signMainVo || {};
  $.log(`${prefix}: 签到后状态 => currentStatus=${refreshedSignMain.currentStatus ?? '-'}，button=${refreshedSignMain.buttonText || '-'}`);
}

async function claimInstantReward(cdp, cookie, prefix) {
  const body = {
    envType: 1,
    linkId: INSTANT_REWARD_LINK_ID,
    babelChannel: 'ttt106',
  };
  const judgeResult = await callActivityApi(cdp, cookie, prefix, 'interactGameRewardJudge', body, {
    h5stAppId: 'd41f2',
  });
  const judgeData = judgeResult?.data;
  $.log(`${prefix}: 即时奖励判断 => data=${judgeData ?? '-'}，code=${judgeResult?.code ?? '-'}`);

  if (Number(judgeData) !== 1) {
    return;
  }

  const rewardResult = await callActivityApi(cdp, cookie, prefix, 'interactGameReward', body, {
    h5stAppId: 'd41f2',
  });
  $.log(`${prefix}: 即时奖励领取 => ${stringifyForLog(rewardResult, 1200)}`);
}

async function loadStageProgress(cdp, cookie, prefix) {
  return callActivityApi(cdp, cookie, prefix, 'interact_act_invoke', {
    envType: 1,
    linkId: TASK_LINK_ID,
    actFlowCode: 'actLoad',
  }, {
    h5stAppId: 'a2b4f',
    includeXApiScval2: true,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
    },
  });
}

async function claimStageAward(cdp, cookie, prefix, stage) {
  return callActivityApi(cdp, cookie, prefix, 'interact_act_invoke', {
    envType: 1,
    linkId: TASK_LINK_ID,
    actFlowCode: 'recevieAward',
    stage,
  }, {
    h5stAppId: 'a2b4f',
    includeXApiScval2: true,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
    },
  });
}

async function claimReadyStageAwards(cdp, cookie, prefix, scene) {
  $.log(`${prefix}: 开始检查经验档位奖励 => ${scene}`);
  const claimedStages = new Set();

  for (let round = 1; round <= STAGE_CLAIM_ROUNDS; round += 1) {
    const progressResult = await loadStageProgress(cdp, cookie, prefix);
    const progressData = getInnerData(progressResult) || {};
    const progressList = Array.isArray(progressData.progressList) ? progressData.progressList : [];
    $.log(`${prefix}: 档位进度 => ${progressList.map(formatProgressItem).join(' || ') || '空'}`);

    const claimableItems = progressList
      .filter((item) => Number(item.status) === 1 && item.stage !== undefined && !claimedStages.has(String(item.stage)));
    if (!claimableItems.length) {
      return;
    }

    for (const item of claimableItems) {
      const stage = item.stage;
      const claimResult = await claimStageAward(cdp, cookie, prefix, stage);
      claimedStages.add(String(stage));
      $.log(`${prefix}: 档位${stage}领取 => ${summarizeAwardResult(claimResult)}`);
      await sleep(1000);
    }
  }
}

function formatProgressItem(item) {
  return `stage=${item.stage},status=${item.status},score=${item.score},amount=${item.amount}`;
}

function summarizeAwardResult(result) {
  const data = getInnerData(result) || result?.data || {};
  if (data?.awardResultVO) {
    const award = data.awardResultVO;
    return `${award.prizeConfigName || award.prizeDesc || '奖励'} amount=${award.amount || data?.awardVo?.awardGivenNumber || '-'} send=${award.sendResult}`;
  }
  if (data?.awardVo) {
    return `${data.awardVo.awardTitle || data.awardVo.awardName || '奖励'} x${data.awardVo.awardGivenNumber || '-'}`;
  }
  if (data?.prizeConfigName || data?.prizeDesc || data?.amount) {
    return `${data.prizeConfigName || data.prizeDesc || '奖励'} amount=${data.amount || '-'} send=${data.sendResult}`;
  }
  return stringifyForLog(result, 1000);
}

async function queryTaskList(cdp, cookie, prefix) {
  return callActivityApi(cdp, cookie, prefix, 'apTaskList', {
    linkId: TASK_LINK_ID,
    queryType: 0,
    channel: 4,
    area: TASK_AREA,
    platform: 'lingxiao',
    actFlowCode: 'apTaskList',
  }, {
    includeTaskDeviceFields: true,
    includeXApiScval2: true,
    forceNullH5st: true,
  });
}

async function queryTaskDetail(cdp, cookie, prefix, task) {
  return callActivityApi(cdp, cookie, prefix, 'apTaskDetail', {
    taskType: task?.taskType || 'BROWSE_CHANNEL',
    taskId: task?.id,
    channel: 4,
    checkVersion: true,
    linkId: TASK_LINK_ID,
    pipeExt: buildTaskPipeExt(task),
    actFlowCode: 'apTaskDetail',
  }, {
    includeTaskDeviceFields: true,
    includeXApiScval2: true,
    forceNullH5st: true,
  });
}

async function startTaskTime(cdp, cookie, prefix, task, item) {
  return callActivityApi(cdp, cookie, prefix, 'apStartTaskTime', {
    linkId: TASK_LINK_ID,
    taskId: task?.id,
    itemId: getTaskItemUrl(item),
    pipeExt: buildTaskPipeExt(task, item),
    channel: 4,
    actFlowCode: 'apStartTaskTime',
  }, {
    appid: 'activity_platform_se',
    h5stAppId: 'acb1e',
    includeXApiScval2: true,
  });
}

async function doLimitTimeTask(cdp, cookie, prefix) {
  return callActivityApi(cdp, cookie, prefix, 'apDoLimitTimeTask', {
    linkId: TASK_LINK_ID,
    actFlowCode: 'apDoLimitTimeTask',
  }, {
    h5stAppId: 'ebecc',
    includeXApiScval2: true,
  });
}

function buildTaskPipeExt(task, item = null) {
  return {
    ...(task?.pipeExt || {}),
    ...(item?.pipeExt || {}),
    taskType: task?.pipeExt?.taskType || task?.taskType || 'BROWSE_CHANNEL',
  };
}

function getTaskItemUrl(item) {
  return String(item?.itemId || item?.itemUrl || '').trim();
}

function isBrowseTask(task) {
  const taskType = String(task?.taskType || task?.pipeExt?.taskType || '');
  return taskType === 'BROWSE_CHANNEL';
}

function isTaskFinished(task) {
  if (task?.taskFinished === true || task?.status?.finished === true) {
    return true;
  }
  const doTimes = Number(task?.taskDoTimes ?? task?.status?.userFinishedTimes ?? 0);
  const limitTimes = Number(task?.taskLimitTimes ?? task?.status?.finishNeed ?? 0);
  return limitTimes > 0 && doTimes >= limitTimes;
}

function summarizeTask(task, item = null) {
  const rewards = (task?.configBaseList || [])
    .map((reward) => `${reward.awardGivenNumber || '?'}${reward.interactiveAwardName || reward.awardName || reward.awardTitle || '奖励'}`)
    .join(',');
  return `${task?.taskShowTitle || task?.taskTitle || task?.taskType || '浏览任务'} | assignmentId=${task?.pipeExt?.assignmentId || '-'} | item=${item?.itemName || '-'} | url=${getTaskItemUrl(item) || '-'} | reward=${rewards || '-'}`;
}

async function buildPendingBrowseTasks(cdp, cookie, prefix) {
  const taskListResult = await queryTaskList(cdp, cookie, prefix);
  const tasks = Array.isArray(getInnerData(taskListResult)) ? getInnerData(taskListResult) : [];
  if (!tasks.length) {
    $.log(`${prefix}: apTaskList 未返回任务 => ${stringifyForLog(taskListResult, 1200)}`);
    return [];
  }

  const browseTasks = tasks.filter((task) => isBrowseTask(task));
  $.log(`${prefix}: 浏览任务总数 => ${browseTasks.length}`);

  const pendingEntries = [];
  for (const task of browseTasks) {
    if (isTaskFinished(task)) {
      $.log(`${prefix}: 浏览任务已完成，跳过 => ${summarizeTask(task)}`);
      continue;
    }

    const detailResult = await queryTaskDetail(cdp, cookie, prefix, task);
    if (getInnerCode(detailResult) !== 0) {
      $.log(`${prefix}: apTaskDetail 异常，跳过 => ${summarizeTask(task)} | ${getInnerMessage(detailResult)}`);
      continue;
    }

    const detailData = getInnerData(detailResult) || {};
    if (detailData.status?.finished) {
      $.log(`${prefix}: 浏览任务明细已完成，跳过 => ${summarizeTask(task)}`);
      continue;
    }

    const items = Array.isArray(detailData.taskItemList) ? detailData.taskItemList : [];
    const executableItems = items.filter((item) => /^https?:\/\//.test(getTaskItemUrl(item)));
    if (!executableItems.length) {
      $.log(`${prefix}: 浏览任务无可访问 item，跳过 => ${summarizeTask(task)}`);
      continue;
    }

    for (const item of executableItems) {
      pendingEntries.push({ task: { ...task, ...detailData, pipeExt: { ...(task.pipeExt || {}), ...(detailData.pipeExt || {}) } }, item });
    }
  }

  return pendingEntries;
}

function extractTimerTaskInfo(startResult, fallbackUrl, fallbackSeconds = 6) {
  const jumpUrl = getInnerData(startResult)?.jumpUrl || '';
  const paramsIndex = String(jumpUrl).indexOf('params=');
  if (paramsIndex < 0) {
    return {
      taskUrl: fallbackUrl,
      seconds: fallbackSeconds,
      jumpUrl,
    };
  }

  const rawParams = String(jumpUrl).slice(paramsIndex + 'params='.length);
  const parsedParams = safeJsonParse(rawParams, {});
  return {
    taskUrl: parsedParams.taskUrl || fallbackUrl,
    seconds: Number(parsedParams.second || fallbackSeconds),
    jumpUrl,
    timerId: parsedParams.timerId || '',
    uniqId: parsedParams.uniqId || '',
  };
}

async function completeBrowseTask(cookie, prefix, browserSession, task, item) {
  $.log(`${prefix}: 尝试浏览任务 => ${summarizeTask(task, item)}`);
  const startResult = await startTaskTime(browserSession.cdp, cookie, prefix, task, item);
  if (getInnerCode(startResult) !== 0) {
    $.log(`${prefix}: apStartTaskTime 未成功 => code=${getInnerCode(startResult)} msg=${getInnerMessage(startResult)}`);
    return false;
  }

  const timerInfo = extractTimerTaskInfo(startResult, getTaskItemUrl(item), Number(task?.timeLimitPeriod || 6));
  if (!timerInfo.taskUrl) {
    $.log(`${prefix}: apStartTaskTime 未返回可浏览 taskUrl`);
    return false;
  }

  const waitMs = Math.max((Number(timerInfo.seconds) || 6) * 1000 + TASK_WAIT_BUFFER_MS, 8000);
  $.log(`${prefix}: 浏览落地页 => ${timerInfo.taskUrl}`);
  $.log(`${prefix}: 计时信息 => timerId=${timerInfo.timerId || '-'} uniqId=${timerInfo.uniqId || '-'} wait=${waitMs}ms`);
  await visitTaskPage(browserSession.cdp, prefix, timerInfo.taskUrl, waitMs);

  for (let attempt = 1; attempt <= COMPLETE_RETRY_TIMES; attempt += 1) {
    const limitResult = await doLimitTimeTask(browserSession.cdp, cookie, prefix);
    const code = getInnerCode(limitResult);
    $.log(`${prefix}: apDoLimitTimeTask 第${attempt}次结果 => code=${code} ${summarizeAwardResult(limitResult)}`);
    if (code === 0) {
      return true;
    }
    if (attempt < COMPLETE_RETRY_TIMES) {
      await sleep(2500 * attempt);
    }
  }

  return false;
}

async function completeBrowseTasks(cookie, prefix, browserSession) {
  const allPendingTasks = await buildPendingBrowseTasks(browserSession.cdp, cookie, prefix);
  const pendingTasks = Number.isFinite(MAX_TASKS) ? allPendingTasks.slice(0, MAX_TASKS) : allPendingTasks;
  $.log(`${prefix}: 待执行浏览 item 数 => ${pendingTasks.length}，任务上限=${formatTaskLimit(MAX_TASKS)}`);

  let successCount = 0;
  for (const { task, item } of pendingTasks) {
    try {
      const completed = await completeBrowseTask(cookie, prefix, browserSession, task, item);
      if (completed) {
        successCount += 1;
      }
    } catch (error) {
      $.log(`${prefix}: 浏览任务异常，继续下一个 => ${summarizeTask(task, item)} | ${error.message || error}`);
    }
    await sleep(1000);
  }

  $.log(`${prefix}: 浏览任务完成统计 => 成功${successCount}/${pendingTasks.length}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.once('close', () => {
      this.closed = true;
      this.rejectPending(new Error('Chrome DevTools 连接已关闭'));
    });
    this.ws.once('error', (error) => {
      this.closed = true;
      this.rejectPending(error);
    });
    this.ws.on('message', (raw) => {
      const message = safeJsonParse(String(raw), null);
      if (!message) {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          entry.reject(new Error(message.error.message));
        } else {
          entry.resolve(message.result);
        }
        return;
      }

      const handlers = this.handlers.get(message.method) || [];
      for (const handler of handlers) {
        handler(message.params || {});
      }
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}, timeoutMs = 25000) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Chrome DevTools 连接不可用'));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timeout`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    this.closed = true;
    this.rejectPending(new Error('Chrome DevTools 连接已关闭'));
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  rejectPending(error) {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
}

async function fetchJson(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw lastError || new Error(`fetch timeout: ${url}`);
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, DEBUG_HOST, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

function getChromeArgs(port, userDataDir) {
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-address=${DEBUG_HOST}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  if (!HEADFUL) {
    args.unshift('--headless=new');
  }
  return args;
}

async function connectChromePage(port) {
  const pages = await fetchJson(`http://${DEBUG_HOST}:${port}/json/list`);
  const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && !String(item.url || '').startsWith('chrome-extension://'))
    || pages.find((item) => item.webSocketDebuggerUrl)
    || pages[0];
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('未找到可连接的 Chrome 页面');
  }

  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: USER_AGENT,
    platform: 'Android',
    acceptLanguage: 'zh-CN,zh;q=0.9',
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    configuration: 'mobile',
  });

  return cdp;
}

async function evaluateChrome(cdp, expression, timeoutMs = CHROME_EVALUATE_TIMEOUT_MS) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result?.exceptionDetails) {
    const exception = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Chrome Runtime.evaluate 执行异常';
    throw new Error(exception);
  }
  return result?.result?.value;
}

function isTransientChromeError(error) {
  return /Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id|Chrome DevTools 连接不可用|Chrome DevTools 连接已关闭|Target closed/i
    .test(String(error?.message || error || ''));
}

function buildChromeRuntimeBootstrapScript(input) {
  return `(${async function bootstrapHuhongRuntime(runtimeInput) {
    if (window.__jdHuhongRuntime) {
      return { ok: true, reused: true, href: location.href };
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const safeJson = (text) => {
      try {
        return JSON.parse(text);
      } catch (error) {
        return text ? { raw: text } : {};
      }
    };
    const cookieMap = () => new Map(document.cookie.split(';').map((item) => {
      const trimmed = item.trim();
      const index = trimmed.indexOf('=');
      if (index <= 0) {
        return ['', ''];
      }
      return [trimmed.slice(0, index), trimmed.slice(index + 1)];
    }));
    const setCookie = (rawCookie) => {
      String(rawCookie || '')
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => {
          const index = item.indexOf('=');
          if (index <= 0) {
            return;
          }
          const key = item.slice(0, index).trim();
          const value = item.slice(index + 1).trim();
          if (key) {
            document.cookie = `${key}=${value}; domain=.jd.com; path=/`;
          }
        });
    };
    const waitFor = async (predicate, timeoutMs, label) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
          return;
        }
        await sleep(200);
      }
      throw new Error(`等待运行态超时: ${label}`);
    };
    const loadScript = (url, timeoutMs) => new Promise((resolve, reject) => {
      const existingScript = Array.from(document.scripts).find((script) => script.src === url);
      if (existingScript && existingScript.dataset.loaded === '1') {
        resolve();
        return;
      }
      const script = existingScript || document.createElement('script');
      const timer = setTimeout(() => reject(new Error(`加载脚本超时: ${url}`)), timeoutMs);
      script.onload = () => {
        clearTimeout(timer);
        script.dataset.loaded = '1';
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`加载脚本失败: ${url}`));
      };
      if (!existingScript) {
        script.src = url;
        document.head.appendChild(script);
      }
    });
    const ensureSignRuntime = async () => {
      try {
        await waitFor(() => typeof window.ParamsSignLite === 'function', 8000, 'ParamsSignLite');
      } catch (error) {
        await loadScript(runtimeInput.jsSecurityScriptUrl, 15000);
        await waitFor(() => typeof window.ParamsSignLite === 'function', runtimeInput.signRuntimeTimeoutMs, 'ParamsSignLite');
      }
    };
    const getJsToken = () => new Promise((resolve) => {
      const fallbackToken = cookieMap().get('3AB9D23F7A4B3CSS') || runtimeInput.defaultEidToken || '';
      try {
        if (typeof window.getJsToken !== 'function') {
          resolve(fallbackToken);
          return;
        }
        window.getJsToken((result) => resolve(result?.jsToken || fallbackToken), 15000);
      } catch (error) {
        resolve(fallbackToken);
      }
    });
    const normalizeFormValue = (value) => {
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    };
    const buildApiUrl = (payload) => {
      const url = new URL(payload.endpoint || runtimeInput.apiEndpoint);
      url.searchParams.set('functionId', payload.functionId);
      return url.toString();
    };
    const buildForm = (formFields) => Object.entries(formFields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(normalizeFormValue(value))}`)
      .join('&');

    window.__jdHuhongRuntime = {
      setCookie,
      async postApi(payload) {
        if (payload.cookie && payload.syncCookie) {
          setCookie(payload.cookie);
        }

        const timestamp = Number(payload.extraForm?.t || 0) || Date.now();
        const bodyText = JSON.stringify(payload.body || {});
        let h5st = payload.nullH5st ? 'null' : '';
        if (!payload.nullH5st && payload.h5stAppId) {
          await ensureSignRuntime();
          const signer = new window.ParamsSignLite({ appId: payload.h5stAppId });
          const signResult = await signer.sign({
            functionId: payload.functionId,
            appid: payload.appid || runtimeInput.appid,
            client: runtimeInput.client,
            t: String(timestamp),
            body: bodyText,
            clientVersion: runtimeInput.clientVersion,
          });
          h5st = signResult?.h5st || '';
        }

        const eidToken = await getJsToken();
        const formFields = {
          ...(payload.extraForm || {}),
          t: timestamp,
          appid: payload.appid || runtimeInput.appid,
          functionId: payload.functionId,
          body: bodyText,
          client: runtimeInput.client,
          clientVersion: runtimeInput.clientVersion,
          h5st,
          'x-api-eid-token': eidToken || payload.extraForm?.['x-api-eid-token'] || '',
          ext: {
            appType: 'jdapp',
            systemType: 'android',
            bigScreen: false,
            'x-api-eid-token': eidToken || payload.extraForm?.['x-api-eid-token'] || '',
            'wg-sdk-token': payload.extraForm?.['wg-sdk-token'] || runtimeInput.defaultWgToken,
            pageUrl: runtimeInput.pageUrl,
          },
        };
        const form = buildForm(formFields);
        const url = buildApiUrl(payload);
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-requested-with': 'com.jingdong.app.mall',
            'x-referer-page': runtimeInput.pageUrl,
            ...(payload.extraHeaders || {}),
          },
          body: form,
        });
        const rawText = await response.text();
        const sdTokenHeader = response.headers.get('x-rp-sdtoken') || '';
        const sdToken = sdTokenHeader.split(';')[2] ? sdTokenHeader.split(';')[2].trim() : '';
        if (sdToken) {
          document.cookie = `sdtoken=${sdToken}; domain=.jd.com; path=/`;
        }

        return {
          status: response.status,
          request: {
            functionId: payload.functionId,
            url,
            body: payload.body || {},
            formFields,
            formLength: form.length,
            h5stLength: String(h5st || '').length,
          },
          response: {
            headers: {
              'x-rp-sdtoken': sdTokenHeader,
              'x-api-request-id': response.headers.get('x-api-request-id') || '',
              'x-mlaas-at': response.headers.get('x-mlaas-at') || '',
            },
            parsed: safeJson(rawText),
            raw: rawText,
          },
        };
      },
    };

    return { ok: true, reused: false, href: location.href };
  }})(${JSON.stringify(input)})`;
}

async function prepareActivityRuntime(cdp, prefix) {
  const state = await collectPageState(cdp);
  if (!String(state.href || '').startsWith(ORIGIN)) {
    $.log(`${prefix}: 返回活动页准备接口请求 => ${PAGE_URL}`);
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await waitForActivityPageReady(cdp, prefix);
  }

  const result = await evaluateChrome(cdp, buildChromeRuntimeBootstrapScript({
    apiEndpoint: API_ENDPOINT,
    appid: 'activities_platform',
    client: CLIENT,
    clientVersion: CLIENT_VERSION,
    pageUrl: PAGE_BASE_URL,
    defaultEidToken: process.env.JD_HUHONG_EID_TOKEN || DEFAULT_EID_TOKEN,
    defaultWgToken: process.env.JD_HUHONG_WG_TOKEN || DEFAULT_WG_TOKEN,
    jsSecurityScriptUrl: DEFAULT_JS_SECURITY_SCRIPT_URL,
    signRuntimeTimeoutMs: CHROME_EVALUATE_TIMEOUT_MS,
  }));
  $.log(`${prefix}: Chrome运行时 => reused=${result?.reused ?? '-'} href=${result?.href || '-'}`);
}

async function waitForActivityPageReady(cdp, prefix) {
  const startedAt = Date.now();
  let lastState = {};

  while (Date.now() - startedAt < BOOTSTRAP_WAIT_MS) {
    lastState = await collectPageState(cdp);
    if (String(lastState.href || '').startsWith(ORIGIN) && lastState.readyState === 'complete') {
      return;
    }
    await sleep(500);
  }

  $.log(`${prefix}: 活动页等待后状态 => ${stringifyForLog(lastState, 800)}`);
}

async function chromePostApi(cdp, payload, prefix) {
  const expression = `(async () => window.__jdHuhongRuntime.postApi(${JSON.stringify(payload)}))()`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prepareActivityRuntime(cdp, prefix);
      return await evaluateChrome(cdp, expression, CHROME_EVALUATE_TIMEOUT_MS);
    } catch (error) {
      if (!isTransientChromeError(error) || attempt >= maxAttempts) {
        throw error;
      }
      $.log(`${prefix}: Chrome上下文切换，重试接口 ${payload.functionId} 第${attempt + 1}次 => ${error.message || error}`);
      await sleep(3000);
    }
  }

  throw new Error(`${payload.functionId} Chrome请求重试失败`);
}

async function injectCookies(cdp, cookieText, prefix) {
  const cookies = parseCookies(cookieText);
  for (const cookie of cookies) {
    await cdp.send('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      domain: '.jd.com',
      path: '/',
      secure: true,
      httpOnly: false,
    });
  }
  $.log(`${prefix}: Cookie 已注入 => ${cookies.map((item) => item.name).join(', ')}`);
}

async function getBrowserCookieString(cdp) {
  const result = await cdp.send('Network.getAllCookies');
  const cookieMap = new Map();
  for (const cookie of result.cookies || []) {
    if (!String(cookie.domain || '').includes('jd.com') || !cookie.name || !cookie.value) {
      continue;
    }
    cookieMap.set(cookie.name, cookie.value);
  }
  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function bootstrapBrowserSession(cookieText, prefix) {
  const chromeBin = getChromeBin();
  if (!chromeBin) {
    throw new Error('未找到 Chrome/Chromium，请确认 DEFAULT_CHROME_CANDIDATES 覆盖当前系统路径');
  }

  const port = await getAvailablePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-huhong-chrome-'));
  const chrome = spawn(chromeBin, getChromeArgs(port, userDataDir), { stdio: ['ignore', 'ignore', 'ignore'] });
  $.log(`${prefix}: Chrome => ${chromeBin}`);
  $.log(`${prefix}: CDP 端口 => ${port}`);
  $.log(`${prefix}: Chrome 已启动，userDataDir => ${userDataDir}`);

  let cdp = null;
  try {
    cdp = await connectChromePage(port);
    await injectCookies(cdp, cookieText, prefix);
    $.log(`${prefix}: 开始导航活动页 => ${PAGE_URL}`);
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(BOOTSTRAP_WAIT_MS);
    $.log(`${prefix}: 活动页加载等待完成 => ${BOOTSTRAP_WAIT_MS}ms`);

    const browserCookieString = await getBrowserCookieString(cdp);
    const activityCookie = mergeCookieString(browserCookieString, cookieText);
    const cookieNames = parseCookies(activityCookie).map((item) => item.name);
    $.log(`${prefix}: 浏览器会话 Cookie 捕获 => ${cookieNames.join(', ')}`);

    return {
      cdp,
      chrome,
      userDataDir,
      activityCookie,
    };
  } catch (error) {
    try {
      cdp?.close();
    } catch (closeError) {
      $.log(`${prefix}: CDP 关闭异常 => ${closeError.message || closeError}`);
    }
    if (!chrome.killed) {
      chrome.kill('SIGTERM');
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function visitTaskPage(cdp, prefix, taskUrl, waitMs) {
  await cdp.send('Page.navigate', { url: taskUrl });
  await sleep(Math.min(3000, waitMs));
  const state = await collectPageState(cdp);
  $.log(`${prefix}: 浏览页状态 => ${stringifyForLog(state, 1000)}`);
  const remainingWait = Math.max(waitMs - Math.min(3000, waitMs), 0);
  if (remainingWait > 0) {
    await sleep(remainingWait);
  }
}

async function collectPageState(cdp) {
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: '({href: location.href, readyState: document.readyState, title: document.title, text: document.body ? document.body.innerText.slice(0, 500) : ""})',
      returnByValue: true,
    });
    return result.result?.value || {};
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

async function closeBrowserSession(session, prefix) {
  if (!session) {
    return;
  }

  try {
    session.cdp?.close();
  } catch (error) {
    $.log(`${prefix}: CDP 关闭异常 => ${error.message || error}`);
  }

  if (session.chrome && !session.chrome.killed) {
    session.chrome.kill('SIGTERM');
  }
  await sleep(1000);
  if (session.userDataDir) {
    fs.rmSync(session.userDataDir, { recursive: true, force: true });
  }
  $.log(`${prefix}: Chrome 已关闭`);
}

async function runAccount(cookieText, index) {
  const userName = getUserName(cookieText) || `账号${index}`;
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);

  let browserSession = null;
  try {
    browserSession = await bootstrapBrowserSession(cookieText, prefix);
    const activityCookie = browserSession.activityCookie;

    await signDaily(browserSession.cdp, activityCookie, prefix);
    await claimInstantReward(browserSession.cdp, activityCookie, prefix);
    await claimReadyStageAwards(browserSession.cdp, activityCookie, prefix, '浏览任务前');
    await completeBrowseTasks(activityCookie, prefix, browserSession);
    await claimReadyStageAwards(browserSession.cdp, activityCookie, prefix, '浏览任务后');
    await claimInstantReward(browserSession.cdp, activityCookie, prefix);
    await queryHome(browserSession.cdp, activityCookie, prefix);
  } finally {
    await closeBrowserSession(browserSession, prefix);
  }
}

async function main() {
  $.log('', `🔔${$.name}, 开始!`);
  const cookies = getCookies();
  if (!cookies.length) {
    $.log('未找到有效账号 Cookie');
    return;
  }

  $.log(`====================共${cookies.length}个京东账号Cookie=================`);
  $.log(`===========脚本执行时间：${new Date().toISOString()}============`);

  for (let index = 0; index < cookies.length; index += 1) {
    try {
      await runAccount(cookies[index], index + 1);
    } catch (error) {
      $.log(`账号${index + 1}: 执行失败：${error.stack || error.message || error}`);
    }
    await sleep(1000);
  }
}

main()
  .catch((error) => {
    $.log(`脚本异常：${error.stack || error.message || error}`);
    process.exitCode = 1;
  })
  .finally(() => $.done());
