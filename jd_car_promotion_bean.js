/*
cron:24 0 * * * jd_car_promotion_bean.js

环境变量说明：
1. JD_CAR_PROMOTION_EID_TOKEN
   含义：可选的 x-api-eid-token，汽车签到领豆接口遇到风控时可从抓包提取后覆盖。
   是否必须：否。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getQueryApi,
  getUserAgent,
  getUserName,
  hasJingBeanReward,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('汽车签到领京豆');

const APPID = 'JDAUTO-TOWER';
const H5ST_APP_ID = 'aa200';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3dnvQFJ8j68mUEy8wjsFU7VSfZTV/index.html';
const FEATURED_CHANNEL_TASK_NAME = '浏览特色频道';
const DEFAULT_BROWSE_WAIT_MS = 7000;
const REQUEST_GAP_MS = 1000;
const LOCATION_BODY = {
  lat: '28.210289',
  lng: '113.036879',
  provinceId: '18',
  cityId: '1482',
  countryId: '3606',
  townId: '60000',
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

async function queryHome(cookie) {
  return getQueryApi(cookie, {
    endpoint: 'https://api.m.jd.com/carPromotion_signInHonePage',
    functionId: 'carPromotion_signInHonePage',
    appid: APPID,
    body: LOCATION_BODY,
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: PAGE_URL,
    extraQuery: {
      _t: Date.now(),
    },
  });
}

async function doSign(cookie, task) {
  return getQueryApi(cookie, {
    endpoint: 'https://api.m.jd.com/carPromotion_doSign',
    functionId: 'carPromotion_doSign',
    appid: APPID,
    h5stAppId: H5ST_APP_ID,
    h5stVersion: '5.3',
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: PAGE_URL,
    body: {
      obtainOrUseScore: 1,
      encryptAssignmentId: task.taskId,
    },
    extraQuery: {
      _t: Date.now(),
      'x-api-eid-token': process.env.JD_CAR_PROMOTION_EID_TOKEN || '',
    },
  });
}

async function doAssignment(cookie, task, itemId, actionType) {
  return postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/carPromotion_doAssignment',
    functionId: 'carPromotion_doAssignment',
    appid: APPID,
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: PAGE_URL,
    body: {
      otherSourceCode: 1,
      encryptAssignmentId: task.taskId,
      itemId,
      actionType,
    },
  });
}

function readSignTask(homeData) {
  const tasks = homeData?.data?.allTask || [];
  return tasks.find((task) => {
    const taskName = String(task.taskName || '');
    return taskName.includes('签到') && !task.completeTaskFlag && hasJingBeanReward(task);
  });
}

function readFeaturedChannelTask(homeData) {
  const tasks = homeData?.data?.allTask || [];
  return tasks.find((task) => {
    const taskName = String(task.taskName || '');
    return taskName.includes(FEATURED_CHANNEL_TASK_NAME) && hasJingBeanReward(task);
  });
}

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getCompleteTaskNum(task) {
  return toNumber(task?.completeTaskNum, 0);
}

function getAssignmentTimesLimit(task) {
  return toNumber(task?.assignmentTimesLimit, 1);
}

function getBrowseWaitMs(task) {
  const waitDurationMs = toNumber(task?.ext?.waitDuration, 0) * 1000;
  return Math.max(waitDurationMs + REQUEST_GAP_MS, DEFAULT_BROWSE_WAIT_MS);
}

function isTaskCompleted(task) {
  if (!task) {
    return true;
  }
  return Boolean(task.completeTaskFlag) || getCompleteTaskNum(task) >= getAssignmentTimesLimit(task);
}

function getTaskActivities(task) {
  const activities = Array.isArray(task?.ext?.shoppingActivity) ? task.ext.shoppingActivity : [];
  if (activities.length) {
    return activities
      .filter((activity) => activity?.itemId)
      .map((activity) => ({
        itemId: activity.itemId,
        title: activity.title || task.taskName,
        url: activity.url || task.linkUrl || '',
        status: activity.status,
      }));
  }

  if (task?.itemId) {
    return [{
      itemId: task.itemId,
      title: task.taskName,
      url: task.linkUrl || '',
      status: '',
    }];
  }

  return [];
}

function pickNextActivity(task, attemptedItemIds) {
  const activities = getTaskActivities(task);
  return activities.find((activity) => {
    const status = String(activity.status ?? '');
    return !attemptedItemIds.has(activity.itemId) && !['2', '3'].includes(status);
  }) || activities.find((activity) => !attemptedItemIds.has(activity.itemId));
}

function summarizeTask(task) {
  const rewardText = (task?.rewards || [])
    .map((reward) => `${reward.rewardValue || ''}${reward.rewardName || ''}`)
    .filter(Boolean)
    .join(',');
  return `${task?.taskName || '-'} | ${getCompleteTaskNum(task)}/${getAssignmentTimesLimit(task)} | done=${Boolean(task?.completeTaskFlag)} | reward=${rewardText || '-'}`;
}

function readAssignmentMessage(result) {
  return result?.data?.subMsg || result?.data?.errMsg || result?.errMsg || result?.message || stringifySnippet(result, 300);
}

async function refreshFeaturedChannelTask(cookie) {
  const homeData = await queryHome(cookie);
  return readFeaturedChannelTask(homeData);
}

async function completeFeaturedChannelTask(cookie, userName, task) {
  if (!task) {
    $.log(`账号 ${userName}: 未找到 ${FEATURED_CHANNEL_TASK_NAME} 任务`);
    return;
  }

  if (isTaskCompleted(task)) {
    $.log(`账号 ${userName}: ${FEATURED_CHANNEL_TASK_NAME} 已完成，${summarizeTask(task)}`);
    return;
  }

  let currentTask = task;
  const attemptedItemIds = new Set();
  const maxRounds = Math.max(getAssignmentTimesLimit(task) - getCompleteTaskNum(task), 0);

  for (let round = 1; round <= maxRounds; round += 1) {
    if (isTaskCompleted(currentTask)) {
      break;
    }

    const activity = pickNextActivity(currentTask, attemptedItemIds);
    if (!activity) {
      $.log(`账号 ${userName}: ${FEATURED_CHANNEL_TASK_NAME} 没有可浏览频道，当前任务 => ${summarizeTask(currentTask)}`);
      break;
    }

    attemptedItemIds.add(activity.itemId);
    $.log(`账号 ${userName}: 浏览特色频道 ${round}/${maxRounds} => ${activity.title}，itemId=${activity.itemId}`);
    if (activity.url) {
      $.log(`账号 ${userName}: 浏览 URL => ${activity.url}`);
    }

    const startResult = await doAssignment(cookie, currentTask, activity.itemId, 1);
    $.log(`账号 ${userName}: 领取浏览任务结果 => ${stringifySnippet(startResult, 600)}`);

    const waitMs = getBrowseWaitMs(currentTask);
    $.log(`账号 ${userName}: 等待浏览 ${(waitMs / 1000).toFixed(1)} 秒`);
    await sleep(waitMs);

    let finishResult = await doAssignment(cookie, currentTask, activity.itemId, 0);
    $.log(`账号 ${userName}: 完成浏览任务结果 => ${stringifySnippet(finishResult, 800)}`);

    if (String(finishResult?.data?.subCode || '') === '110') {
      $.log(`账号 ${userName}: 浏览时间不足，补等 3 秒后重试完成上报`);
      await sleep(3000);
      finishResult = await doAssignment(cookie, currentTask, activity.itemId, 0);
      $.log(`账号 ${userName}: 重试完成浏览结果 => ${stringifySnippet(finishResult, 800)}`);
    }

    await sleep(REQUEST_GAP_MS);
    currentTask = await refreshFeaturedChannelTask(cookie);
    if (!currentTask) {
      $.log(`账号 ${userName}: 刷新后未找到 ${FEATURED_CHANNEL_TASK_NAME}，可能已经完成并领奖`);
      break;
    }

    $.log(`账号 ${userName}: 刷新任务状态 => ${summarizeTask(currentTask)}，最近结果=${readAssignmentMessage(finishResult)}`);
  }

  const finalTask = await refreshFeaturedChannelTask(cookie);
  if (finalTask) {
    $.log(`账号 ${userName}: ${FEATURED_CHANNEL_TASK_NAME} 最终状态 => ${summarizeTask(finalTask)}`);
  } else {
    $.log(`账号 ${userName}: ${FEATURED_CHANNEL_TASK_NAME} 最终状态 => 任务列表中未返回`);
  }
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const homeData = await queryHome(cookie);
  const signTask = readSignTask(homeData);
  const featuredChannelTask = readFeaturedChannelTask(homeData);

  if (!signTask) {
    $.log(`账号${index} ${userName}: 未找到可执行的汽车签到京豆任务`);
  } else {
    $.log(`账号${index} ${userName}: 执行 ${signTask.taskName}，taskId=${signTask.taskId}`);
    const signResult = await doSign(cookie, signTask);
    $.log(`账号${index} ${userName}: 签到结果 => ${stringifySnippet(signResult, 800)}`);
  }

  if (!featuredChannelTask) {
    $.log(`账号${index} ${userName}: 未找到 ${FEATURED_CHANNEL_TASK_NAME} 任务`);
    $.log(`账号${index} ${userName}: 首页片段 => ${stringifySnippet(homeData)}`);
    return;
  }

  $.log(`账号${index} ${userName}: 识别到任务 => ${summarizeTask(featuredChannelTask)}`);
  await completeFeaturedChannelTask(cookie, userName, featuredChannelTask);
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
