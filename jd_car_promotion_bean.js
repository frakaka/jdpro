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
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('汽车签到领京豆');

const APPID = 'JDAUTO-TOWER';
const H5ST_APP_ID = 'aa200';
const PAGE_URL = 'https://pro.m.jd.com/mall/active/3dnvQFJ8j68mUEy8wjsFU7VSfZTV/index.html';
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

function readSignTask(homeData) {
  const tasks = homeData?.data?.allTask || [];
  return tasks.find((task) => {
    const taskName = String(task.taskName || '');
    return taskName.includes('签到') && !task.completeTaskFlag && hasJingBeanReward(task);
  });
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const homeData = await queryHome(cookie);
  const signTask = readSignTask(homeData);

  if (!signTask) {
    $.log(`账号${index} ${userName}: 未找到可执行的汽车签到京豆任务`);
    $.log(`账号${index} ${userName}: 首页片段 => ${stringifySnippet(homeData)}`);
    return;
  }

  $.log(`账号${index} ${userName}: 执行 ${signTask.taskName}，taskId=${signTask.taskId}`);
  const signResult = await doSign(cookie, signTask);
  $.log(`账号${index} ${userName}: 签到结果 => ${stringifySnippet(signResult, 800)}`);
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
