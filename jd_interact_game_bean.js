/*
cron:18 0 * * * jd_interact_game_bean.js

环境变量说明：
1. JD_INTERACT_GAME_MAX_TASKS
   含义：最多执行几个“浏览领京豆”任务。
   是否必须：否，默认 3。

2. JD_INTERACT_GAME_WAIT_MS
   含义：开始浏览任务后的等待毫秒数。
   是否必须：否，默认 31000。

3. JD_INTERACT_GAME_EID_TOKEN
   含义：可选的 x-api-eid-token，遇到风控参数错误时可从抓包里提取后覆盖。
   是否必须：否。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getUserName,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jd_har_bean_common');

const $ = new Env('互动游戏浏览领京豆');

const APPID = 'activities_platform';
const LOGIN_TYPE = '2';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3fcyrvLZALNPWCEDRvaZJVrzek8v/index.html?babelChannel=ttt127';
const BABEL_CHANNEL = 'ttt127';
const DEFAULT_MAX_TASKS = 3;
const DEFAULT_WAIT_MS = 31 * 1000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getMaxTasks() {
  return Number(process.env.JD_INTERACT_GAME_MAX_TASKS || DEFAULT_MAX_TASKS);
}

function getWaitMs() {
  return Number(process.env.JD_INTERACT_GAME_WAIT_MS || DEFAULT_WAIT_MS);
}

function createExtraForm() {
  return {
    'x-api-eid-token': process.env.JD_INTERACT_GAME_EID_TOKEN || '',
  };
}

async function callApi(cookie, functionId, body) {
  return postFormApi(cookie, {
    functionId,
    appid: APPID,
    loginType: LOGIN_TYPE,
    body,
    origin: 'https://pro.m.jd.com',
    referer: PAGE_URL,
    extraForm: createExtraForm(),
  });
}

async function queryHome(cookie, body) {
  return callApi(cookie, 'interact_game_home', body);
}

async function startTask(cookie, task, actionType) {
  return callApi(cookie, 'interact_game_start_task', {
    encryptAssignmentId: task.assignmentIdForJingDou || task.assignmentId,
    actionType,
    itemId: task.itemId || '',
    version: '2.0',
    jumpUrl: actionType === 1 ? task.jumpInfo?.jumpUrl || '' : '',
  });
}

async function receiveReward(cookie, task) {
  return callApi(cookie, 'interact_game_receive_reward', {
    encryptAssignmentId: task.assignmentIdForJingDou || task.assignmentId,
    type: 2,
    version: '2.0',
  });
}

function readRewardTasks(homeData) {
  const recommendTasks = homeData?.data?.recommendInfos?.recommendInfos || [];
  return recommendTasks.filter((task) => {
    const title = task.title?.value || task.titleText || '';
    const subtitle = task.subTitle?.value || task.subTitleName || '';
    const hasBeanText = `${title}${subtitle}`.includes('京豆');
    return task.assignmentId && (task.assignmentIdForJingDou || hasBeanText) && Number(task.prizeNum || 0) > 0;
  });
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const home = await queryHome(cookie, {
    functionId: '',
    babelChannel: BABEL_CHANNEL,
    version: '2.0',
    channel: BABEL_CHANNEL,
  });
  const tasks = readRewardTasks(home).slice(0, getMaxTasks());

  $.log(`账号${index} ${userName}: 识别到 ${tasks.length} 个可尝试浏览领豆任务`);
  if (!tasks.length) {
    $.log(`账号${index} ${userName}: 首页返回片段 => ${stringifySnippet(home)}`);
    return;
  }

  for (const task of tasks) {
    const taskName = task.title?.value || task.taskName || task.subTitle?.value || task.assignmentId;
    $.log(`账号${index} ${userName}: 开始任务 ${taskName}`);

    const startResult = await startTask(cookie, task, 1);
    $.log(`账号${index} ${userName}: 开始浏览 => ${stringifySnippet(startResult, 500)}`);

    await sleep(getWaitMs());

    const finishResult = await startTask(cookie, task, 0);
    $.log(`账号${index} ${userName}: 上报浏览 => ${stringifySnippet(finishResult, 500)}`);

    await queryHome(cookie, {
      actionSign: 'gameBack',
      version: '2.0',
      channel: '',
    });

    const rewardResult = await receiveReward(cookie, task);
    $.log(`账号${index} ${userName}: 领取奖励 => ${stringifySnippet(rewardResult, 500)}`);
    await sleep(1000);
  }
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
