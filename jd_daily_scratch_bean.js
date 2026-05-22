/*
cron:10 0 * * * jd_daily_scratch_bean.js
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const got = require('got');
const dylans = require('./function/dylans.js');
const dylib = require('./function/dylib.js');
const {
  Env,
  getUserName,
  hasJingBeanReward,
  safeJsonParse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon.js');

const $ = new Env('天天刮豆领京豆');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const cookies = Object.values(jdCookieNode).filter(Boolean);
const CLIENT = 'apple';
const APP_ID = 'b63ff';
const APPID = 'plus_business';
const VERSION = '4.1';
const CODE = 1;
const WAIT_MS = 6000;
const ERROR_RETRY_MS = 2000;
const MAX_TASKS = 10;
const REQUEST_REFERER = 'https://pro.m.jd.com/';
const QUERY_ENDPOINT = 'https://api.m.jd.com/api?scene=jdInteractTask';
const INTERACTION_ENDPOINT = 'https://api.m.jd.com/api?scene=commonDoInteractiveAssignment';
const REPORT_ENDPOINT = 'https://api.m.jd.com/api';
const TASK_TYPE = 'beanDailySign_beanDailyPlus_newBeanTask';
const REFRESH_TASK_TYPE = 'newBeanTask';
const ACTIVITY_CODE = 'newBeanTask';
const BUSINESS_SCENARIO = 'jingDouCenter';
const SCENE = 'commonDoInteractiveAssignment';
const requestContextCache = new Map();

$.log('', `🔔${$.name}, 开始!`);

function getCookiePin(cookie) {
  const match = String(cookie || '').match(/pt_pin=([^;]+)/);
  return decodeURIComponent(match?.[1] || '');
}

function getClientVersion(userAgent) {
  const parts = String(userAgent || '').split(';');
  return parts[2] || '13.5.0';
}

function isSuccessResponse(response) {
  const code = String(response?.code ?? response?.errCode ?? '');
  const text = JSON.stringify(response || {});
  return [
    response?.success === true,
    code === '0',
    code === '200',
    code === '1711000',
    /成功|完成|已完成|任务领取成功|领取成功|获得/.test(text),
  ].some(Boolean);
}

async function createRuntimeContext(cookie) {
  const username = getCookiePin(cookie) || getUserName(cookie);
  if (requestContextCache.has(username)) {
    return requestContextCache.get(username);
  }

  const runtimePromise = (async () => {
    const userAgent = dylib.getUA(username);
    const clientVersion = getClientVersion(userAgent);
    const tokenInfo = await dylib.jddToken(userAgent);
    return {
      username,
      cookie,
      userAgent,
      clientVersion,
      apiToken: tokenInfo?.token || '',
      eid: tokenInfo?.eid || '',
      tokenInfo,
    };
  })();

  requestContextCache.set(username, runtimePromise);
  return runtimePromise;
}

function buildHeaders(runtime) {
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://pro.m.jd.com',
    Referer: REQUEST_REFERER,
    'User-Agent': runtime.userAgent,
    Cookie: runtime.cookie,
    'content-type': 'application/x-www-form-urlencoded',
    'x-babel-ihub': '00041290',
    swimlane: 'undefined',
    mark: 'true',
  };
}

function appendExtraForm(formBody, runtime, extraForm = {}) {
  const search = new URLSearchParams(formBody);
  const defaultExtras = {
    loginType: '2',
    loginWQBiz: '',
    scval: 'test01',
    xAPIClientLanguage: 'zh_CN',
    'x-api-eid-token': runtime.apiToken,
    ...extraForm,
  };

  for (const [key, value] of Object.entries(defaultExtras)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (!search.has(key)) {
      search.append(key, String(value));
    }
  }

  return search.toString();
}

function postRequest(url, body, headers) {
  return got
    .post(url, {
      headers,
      body,
      followRedirect: false,
      throwHttpErrors: false,
      timeout: { request: 30000 },
    })
    .then((response) => ({
      statusCode: response.statusCode,
      headers: response.headers || {},
      body: safeJsonParse(response.body, response.body),
      rawBody: response.body,
    }));
}

function getRequestUrl(item) {
  return item?.jumpUrl
    || item?.exposalUrl
    || item?.clickUrl
    || item?.url
    || item?.landPageUrl
    || item?.taskUrl
    || item?.ext?.jumpUrl
    || '';
}

function getTaskName(task) {
  return task?.assignmentName || task?.taskName || task?.name || '未知任务';
}

function getAssignmentId(task, item) {
  return item?.encryptAssignmentId
    || item?.assignmentId
    || task?.encryptAssignmentId
    || task?.assignmentId
    || task?.id
    || '';
}

function getItemId(task, item) {
  return item?.itemId
    || item?.id
    || task?.itemId
    || task?.assignmentItemId
    || '';
}

function getItemExt(task, item) {
  const jumpUrl = getRequestUrl(item) || getRequestUrl(task);
  if (!jumpUrl) {
    return null;
  }
  return { jumpUrl };
}

function summarizeTask(task) {
  return `${getTaskName(task)} | type=${task?.assignmentType || task?.taskType || '-'} | done=${isTaskDone(task)} | cnt=${task?.completionCnt || 0}/${task?.assignmentTimesLimit || 0}`;
}

function extractTaskList(response) {
  const candidates = [
    response?.rs?.beanTask?.taskList,
    response?.rs?.taskList,
    response?.data?.beanTask?.taskList,
    response?.data?.taskInfoList,
    response?.data?.taskList,
    response?.data?.taskInfos,
    response?.result?.taskInfoList,
    response?.result?.taskList,
    response?.resultData?.taskInfoList,
    response?.resultData?.taskList,
    response?.taskInfoList,
    response?.taskList,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      return list;
    }
  }
  return [];
}

function getTaskStatus(task) {
  return Number(
    task?.status
    ?? task?.taskStatus
    ?? task?.assignmentStatus
    ?? task?.completionFlag
    ?? 0,
  );
}

function isTaskDone(task) {
  return Boolean(
    task?.finished
    || task?.done
    || task?.taskDone
    || task?.completionFlag
    || getTaskStatus(task) === 2,
  );
}

function getTaskItems(task) {
  const candidates = [
    task?.assignmentItemList?.list,
    task?.assignmentItemList?.items,
    task?.assignmentItemList,
    task?.itemList?.list,
    task?.itemList?.items,
    task?.itemInfoList,
    task?.itemList,
    task?.ext?.shoppingActivity,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length) {
      return list;
    }
  }

  return [task];
}

function pickExecutableTasks(taskList) {
  return taskList
    .filter((task) => hasJingBeanReward(task))
    .filter((task) => !isTaskDone(task))
    .filter((task) => !/邀请|助力|组队/.test(getTaskName(task)))
    .filter((task) => getTaskItems(task).some((item) => getItemId(task, item) || getRequestUrl(item) || getRequestUrl(task)))
    .slice(0, MAX_TASKS);
}

async function buildSignedBody(runtime, functionId, body) {
  const payload = await dylans.getbody({
    functionId,
    body,
    client: CLIENT,
    clientVersion: runtime.clientVersion,
    t: Date.now(),
    appid: APPID,
    appId: APP_ID,
    version: VERSION,
    code: CODE,
    user: runtime.username,
    ua: runtime.userAgent,
    apitoken: runtime.apiToken,
  });
  return appendExtraForm(payload, runtime);
}

async function callSignedApi(runtime, url, functionId, body, extraForm = {}) {
  const formBody = await buildSignedBody(runtime, functionId, body);
  const finalBody = appendExtraForm(formBody, runtime, extraForm);
  const response = await postRequest(url, finalBody, buildHeaders(runtime));
  return response.body;
}

async function reportInvokeLog(runtime) {
  return callSignedApi(runtime, REPORT_ENDPOINT, 'reportInvokeLog', {
    sdkClient: 'handler',
    sdkVersion: '1.1.0',
    url: 'https://pro.m.jd.com/mall/active/4E1fFrgX1eGtWTc5KBNFzXMrh6xn/index.html',
    timestamp: Date.now(),
  });
}

async function queryTaskList(runtime, taskType) {
  return callSignedApi(runtime, QUERY_ENDPOINT, 'bff_rightsCenter_jdInteractTask', {
    taskType,
    scene: 'jdInteractTask',
    otherApis: [
      {
        api: 'bff_exec_func',
        businessParam: {
          firstDomain: 'rightsCenter',
          secondDomain: 'userInfo',
          contentType: '27',
          scene: 'userInfo',
        },
      },
    ],
  });
}

async function doInteractiveAssignment(runtime, task, item, actionType) {
  const body = {
    scene: SCENE,
    activityCode: ACTIVITY_CODE,
    businessScenario: BUSINESS_SCENARIO,
    assignmentId: String(getAssignmentId(task, item)),
    actionType: String(actionType),
    itemId: String(getItemId(task, item)),
  };

  const ext = getItemExt(task, item);
  if (ext) {
    body.ext = JSON.stringify(ext);
  }

  return callSignedApi(runtime, INTERACTION_ENDPOINT, 'bff_rightsCenter_interaction', body);
}

async function openTaskMaterial(runtime, task, item) {
  const targetUrl = getRequestUrl(item) || getRequestUrl(task);
  if (!targetUrl) {
    return;
  }

  await got.get(targetUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: REQUEST_REFERER,
      'User-Agent': runtime.userAgent,
      Cookie: runtime.cookie,
    },
    followRedirect: true,
    throwHttpErrors: false,
    timeout: { request: 30000 },
  });
}

async function runSingleItem(runtime, task, item) {
  const username = runtime.username;
  $.log(`账号 ${username}: 开始任务 => ${getTaskName(task)} | assignmentId=${getAssignmentId(task, item)} | itemId=${getItemId(task, item)}`);

  try {
    await openTaskMaterial(runtime, task, item);
  } catch (error) {
    $.log(`账号 ${username}: 打开任务落地页异常 => ${error.message}`);
  }

  try {
    const startResult = await doInteractiveAssignment(runtime, task, item, 1);
    $.log(`账号 ${username}: action=1 => ${stringifySnippet(startResult)}`);
    if (!isSuccessResponse(startResult)) {
      await sleep(ERROR_RETRY_MS);
      return false;
    }

    await sleep(WAIT_MS);

    const finishResult = await doInteractiveAssignment(runtime, task, item, 0);
    $.log(`账号 ${username}: action=0 => ${stringifySnippet(finishResult)}`);
    if (!isSuccessResponse(finishResult)) {
      await sleep(ERROR_RETRY_MS);
      return false;
    }

    await sleep(ERROR_RETRY_MS);

    const claimResult = await doInteractiveAssignment(runtime, task, item, 100);
    $.log(`账号 ${username}: action=100 => ${stringifySnippet(claimResult)}`);
    if (!isSuccessResponse(claimResult)) {
      await sleep(ERROR_RETRY_MS);
      return false;
    }

    return true;
  } catch (error) {
    $.log(`账号 ${username}: 任务执行异常 => ${error.message}`);
    await sleep(ERROR_RETRY_MS);
    return false;
  }
}

async function handleAccount(cookie, index) {
  const runtime = await createRuntimeContext(cookie);
  $.log(`\n==== 账号${index} ${runtime.username} ====`);
  $.log(`账号 ${runtime.username}: UA => ${runtime.userAgent}`);
  $.log(`账号 ${runtime.username}: x-api-eid-token => ${runtime.apiToken ? `${runtime.apiToken.slice(0, 18)}...` : '空'}`);

  const reportResult = await reportInvokeLog(runtime);
  $.log(`账号 ${runtime.username}: reportInvokeLog => ${stringifySnippet(reportResult)}`);

  const taskResponse = await queryTaskList(runtime, TASK_TYPE);
  const taskList = extractTaskList(taskResponse);
  if (!taskList.length) {
    $.log(`账号 ${runtime.username}: 未拿到任务列表 => ${stringifySnippet(taskResponse)}`);
    return;
  }

  $.log(`账号 ${runtime.username}: 任务列表 => ${taskList.map(summarizeTask).join(' || ')}`);
  const executableTasks = pickExecutableTasks(taskList);
  $.log(`账号 ${runtime.username}: 待执行任务数 => ${executableTasks.length}`);

  for (const task of executableTasks) {
    const items = getTaskItems(task);
    for (const item of items) {
      const success = await runSingleItem(runtime, task, item);
      if (success) {
        break;
      }
    }
  }

  const refreshResponse = await queryTaskList(runtime, REFRESH_TASK_TYPE);
  const refreshTaskList = extractTaskList(refreshResponse);
  if (!refreshTaskList.length) {
    $.log(`账号 ${runtime.username}: 刷新结果 => ${stringifySnippet(refreshResponse)}`);
    return;
  }

  $.log(`账号 ${runtime.username}: 刷新后任务列表 => ${refreshTaskList.map(summarizeTask).join(' || ')}`);
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
      $.log(`账号${index + 1}: 执行异常 => ${error.stack || error.message}`);
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
        await notify.sendNotify($.name, '');
      } catch (error) {
        $.log(`通知发送失败 => ${error.message}`);
      }
    }
    $.done();
  });
