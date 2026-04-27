/*
cron:30 0 * * * jd_shouji_gujia_draw.js

环境变量说明：
1. JD_SHOUJI_GUJIA_FULL_COOKIE
   含义：可选的完整活动 Cookie，会合并到 JD_COOKIE 上。这个活动依赖 shshshfpb 等页面态 Cookie，青龙只有 pt_key/pt_pin 时建议补充。
   是否必须：否，但缺失时可能无法正常请求。

2. JD_SHOUJI_GUJIA_ADDRESS_ID
   含义：自动执行“旧品估价”时使用的地址 ID。默认优先读取 Cookie 中的 addrId_1。
   是否必须：否；若账号还未完成估价任务且 Cookie 中没有 addrId_1，则自动估价会跳过。

3. JD_SHOUJI_GUJIA_SECURITY_TOKEN
   含义：可选覆盖 securityToken。默认取 Cookie 中的 shshshfpb。
   是否必须：否。

4. JD_SHOUJI_GUJIA_AUTO_QUOTE
   含义：是否自动走一遍 HAR 里的 iPhone 13 估价流程来完成任务。
   是否必须：否，默认 1；配置为 0 时只做“查任务、领奖、抽奖”。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  buildHeaders,
  DEFAULT_JR_USER_AGENT,
  Env,
  getGiasRiskContext,
  getRequestUuid,
  getQueryApi,
  getUserName,
  mergeCookieString,
  parseApiResponse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('手机估价领京豆');

const APPID = 'huishou_h5';
const LOGIN_TYPE = '2';
const API_URL = 'https://api.m.jd.com/api';
const PAGE_URL = 'https://huishou.m.jd.com/';
const PAGE_ORIGIN = 'https://huishou.m.jd.com';
const REFERER_PAGE = 'https://huishou.m.jd.com/r/activity/info';
const CLIENT_CHANNEL = 2;
const CLIENT_PAGE_ID = 'pphuishou';
const ACTIVITY_ID = '4056813';

const H5ST_APP_ID_MAP = {
  recycle_mall_marketing_detail: '95b93',
  recycle_mall_task_obtain: 'f91fc',
  recycle_mall_quotation_quote: '0b401',
  recycle_mall_task_finish: '23613',
  recycle_mall_turntable_times: '72263',
  recycle_mall_turntable_detail: '46f23',
  recycle_mall_turntable_draw: 'db6d6',
};

const DEFAULT_VENDOR_ID = 200101;
const DEFAULT_VENDOR_SPU_ID = 43510;
const DEFAULT_TURN_TABLE_TASK_ID = 4198578;
const DEFAULT_QUICK_ATTR = 'FPV_822';
const DEFAULT_ANSWER_MAP = {
  314: ['2014'],
  315: ['3987'],
  332: ['2067'],
  350: ['2114'],
  351: ['2118'],
  352: ['2125'],
  1279: ['6982'],
  2058: ['13453'],
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = String(cookie || '').match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
}

function shouldAutoQuote() {
  return process.env.JD_SHOUJI_GUJIA_AUTO_QUOTE !== '0';
}

function buildBaseBody(securityToken) {
  return {
    clientChannel: CLIENT_CHANNEL,
    clientPageId: CLIENT_PAGE_ID,
    securityToken,
  };
}

function readAddressId(cookie) {
  return process.env.JD_SHOUJI_GUJIA_ADDRESS_ID || getCookieValue(cookie, 'addrId_1') || '';
}

function formatRewards(rewards) {
  return (Array.isArray(rewards) ? rewards : [])
    .map((reward) => reward.rewardName || reward.rewardDesc || `${reward.rewardValue || ''}`)
    .filter(Boolean)
    .join(' | ') || '-';
}

function findTaskByName(tasks, taskName) {
  return (Array.isArray(tasks) ? tasks : []).find((task) => String(task.taskName || '').includes(taskName));
}

function findEstimateTask(tasks) {
  return findTaskByName(tasks, '旧品估价');
}

function isTaskRewardReceived(task) {
  return task?.receiveAward === true;
}

async function createAccountContext(cookie) {
  const fullCookie = process.env.JD_SHOUJI_GUJIA_FULL_COOKIE || '';
  const mergedCookie = fullCookie ? mergeCookieString(cookie, fullCookie) : cookie;
  const riskContext = await getGiasRiskContext(mergedCookie, {
    pageUrl: PAGE_URL,
    bizId: 'huishou',
    userAgent: DEFAULT_JR_USER_AGENT,
  });
  const finalCookie = riskContext.cookie || mergedCookie;
  const securityToken = process.env.JD_SHOUJI_GUJIA_SECURITY_TOKEN || getCookieValue(finalCookie, 'shshshfpb') || getCookieValue(mergedCookie, 'shshshfpb');

  if (!securityToken) {
    throw new Error('缺少 securityToken，需提供包含 shshshfpb 的完整 Cookie');
  }

  return {
    cookie: finalCookie,
    jsToken: riskContext.jsToken || '',
    securityToken,
    addressId: readAddressId(finalCookie),
  };
}

async function callHuishouApi(context, functionId, body, extraOptions = {}) {
  const h5stAppId = H5ST_APP_ID_MAP[functionId] || '';
  const queryBody = {
    ...body,
    ...buildBaseBody(context.securityToken),
  };

  const extraQuery = {
    loginType: LOGIN_TYPE,
    uuid: getRequestUuid(context.cookie),
    'x-api-eid-token': context.jsToken,
  };

  if (!h5stAppId) {
    const url = new URL(API_URL);
    url.searchParams.set('appid', APPID);
    url.searchParams.set('functionId', functionId);
    url.searchParams.set('body', JSON.stringify(queryBody));
    for (const [key, value] of Object.entries(extraQuery)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await got.get(url.toString(), {
      headers: {
        ...buildHeaders(context.cookie, {
          origin: PAGE_ORIGIN,
          referer: PAGE_URL,
          userAgent: DEFAULT_JR_USER_AGENT,
          contentType: undefined,
          extraHeaders: {
            Accept: 'application/json, text/plain, */*',
            'x-rp-client': 'h5_1.0.0',
            'x-referer-page': REFERER_PAGE,
          },
        }),
      },
      throwHttpErrors: false,
      timeout: { request: 15000 },
    });
    return parseApiResponse(response);
  }

  return getQueryApi(context.cookie, {
    endpoint: API_URL,
    functionId,
    appid: APPID,
    body: queryBody,
    h5stAppId: h5stAppId,
    h5stVersion: '5.3',
    userAgent: DEFAULT_JR_USER_AGENT,
    origin: PAGE_ORIGIN,
    referer: PAGE_URL,
    extraQuery,
    ...extraOptions,
  });
}

async function queryMarketingDetail(context) {
  return callHuishouApi(context, 'recycle_mall_marketing_detail', {
    activityId: ACTIVITY_ID,
    scene: 1,
  });
}

async function obtainTask(context, taskId) {
  return callHuishouApi(context, 'recycle_mall_task_obtain', {
    activityId: ACTIVITY_ID,
    taskId: Number(taskId),
  });
}

async function createQuotation(context) {
  return callHuishouApi(context, 'recycle_mall_quotation_create', {
    quotation: {
      questionnaireType: 'standard',
      businessType: 'normal',
    },
    vendor: {
      vendorId: DEFAULT_VENDOR_ID,
    },
    product: {
      productMode: 'spu',
      vendorSpuId: DEFAULT_VENDOR_SPU_ID,
      hasLocalProduct: false,
      localInfo: {
        items: null,
      },
      hasPurchaseProduct: false,
    },
  });
}

async function quoteProduct(context, quotationId) {
  if (!context.addressId) {
    throw new Error('缺少地址 ID，无法自动执行旧品估价');
  }

  return callHuishouApi(context, 'recycle_mall_quotation_quote', {
    quotationId,
    answers: DEFAULT_ANSWER_MAP,
    extensions: {
      quick_attribute: [DEFAULT_QUICK_ATTR],
    },
    addressInfo: {
      addressId: String(context.addressId),
    },
  });
}

async function finishTask(context, taskValue) {
  return callHuishouApi(context, 'recycle_mall_task_finish', {
    taskValue: String(taskValue),
    taskType: 2,
  });
}

async function claimEstimateReward(context) {
  return callHuishouApi(context, 'recycle_mall_task_success', {
    activityId: ACTIVITY_ID,
  });
}

async function queryTurntableTimes(context) {
  return callHuishouApi(context, 'recycle_mall_turntable_times', {
    activityId: ACTIVITY_ID,
  });
}

async function queryTurntableDetail(context) {
  return callHuishouApi(context, 'recycle_mall_turntable_detail', {
    activityId: ACTIVITY_ID,
  });
}

async function drawTurntable(context, taskId) {
  return callHuishouApi(context, 'recycle_mall_turntable_draw', {
    activityId: ACTIVITY_ID,
    taskId: Number(taskId),
  });
}

async function runAutoQuoteFlow(context, index, userName, estimateTask) {
  $.log(`账号${index} ${userName}: 开始执行旧品估价任务 => ${estimateTask.taskName}`);

  const obtainResult = await obtainTask(context, estimateTask.taskId);
  $.log(`账号${index} ${userName}: 接取估价任务 => ${stringifySnippet(obtainResult, 400)}`);

  const quotationResult = await createQuotation(context);
  const quotationId = quotationResult?.data?.quotation?.quotationId || '';
  if (!quotationId) {
    throw new Error(`创建报价问卷失败：${stringifySnippet(quotationResult, 600)}`);
  }
  $.log(`账号${index} ${userName}: 创建报价问卷成功 => quotationId=${quotationId}`);

  const quoteResult = await quoteProduct(context, quotationId);
  const quotePrice = quoteResult?.data?.single?.price || '-';
  $.log(`账号${index} ${userName}: 完成报价 => 估价=${quotePrice}`);

  const finishResult = await finishTask(context, quotationId);
  $.log(`账号${index} ${userName}: 上报估价任务完成 => ${stringifySnippet(finishResult, 400)}`);

  await sleep(1000);
}

async function handleEstimateTask(context, index, userName, detailData) {
  const tasks = detailData?.data?.tasks || [];
  const estimateTask = findEstimateTask(tasks);

  if (!estimateTask) {
    $.log(`账号${index} ${userName}: 未识别到旧品估价任务`);
    return { detailData, estimateTask: null };
  }

  $.log(`账号${index} ${userName}: 当前任务 => ${estimateTask.taskName} | completeFlag=${estimateTask.completeFlag ? 1 : 0} | receiveAward=${estimateTask.receiveAward ? 1 : 0} | rewards=${formatRewards(estimateTask.rewards)}`);

  if (!estimateTask.completeFlag && shouldAutoQuote()) {
    await runAutoQuoteFlow(context, index, userName, estimateTask);
    detailData = await queryMarketingDetail(context);
  }

  return {
    detailData,
    estimateTask: findEstimateTask(detailData?.data?.tasks || []) || estimateTask,
  };
}

async function handleTaskReward(context, index, userName, estimateTask) {
  if (!estimateTask) {
    return;
  }

  if (!estimateTask.completeFlag) {
    $.log(`账号${index} ${userName}: 旧品估价任务仍未完成，跳过领奖`);
    return;
  }

  if (isTaskRewardReceived(estimateTask)) {
    $.log(`账号${index} ${userName}: 估价奖励已领取`);
    return;
  }

  const rewardResult = await claimEstimateReward(context);
  $.log(`账号${index} ${userName}: 领取估价奖励 => ${stringifySnippet(rewardResult, 800)}`);
}

async function handleTurntable(context, index, userName) {
  const turntableDetail = await queryTurntableDetail(context);
  const turntableTaskId = turntableDetail?.data?.taskId || DEFAULT_TURN_TABLE_TASK_ID;
  $.log(`账号${index} ${userName}: 大转盘任务 => taskId=${turntableTaskId} | 奖池=${formatRewards(turntableDetail?.data?.rewards)}`);

  let timesResult = await queryTurntableTimes(context);
  let lotteryTimes = Number(timesResult?.data?.lotteryTimes || 0);
  $.log(`账号${index} ${userName}: 当前抽奖次数 => ${lotteryTimes}`);

  for (let attempt = 1; attempt <= lotteryTimes; attempt += 1) {
    const drawResult = await drawTurntable(context, turntableTaskId);
    $.log(`账号${index} ${userName}: 第 ${attempt} 次抽奖 => ${stringifySnippet(drawResult, 500)}`);
    await sleep(1000);
  }

  timesResult = await queryTurntableTimes(context);
  $.log(`账号${index} ${userName}: 抽奖后剩余次数 => ${Number(timesResult?.data?.lotteryTimes || 0)}`);
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  $.log(`\n==== 账号${index} ${userName} ====`);

  const context = await createAccountContext(cookie);
  $.log(`账号${index} ${userName}: securityToken来源 => ${process.env.JD_SHOUJI_GUJIA_SECURITY_TOKEN ? '环境变量' : 'Cookie.shshshfpb'}`);

  let detailData = await queryMarketingDetail(context);
  $.log(`账号${index} ${userName}: 活动摘要 => ${detailData?.data?.activityDesc || '-'} | activityStatus=${detailData?.data?.activityStatus || '-'} | taskCount=${Array.isArray(detailData?.data?.tasks) ? detailData.data.tasks.length : 0}`);

  const estimateResult = await handleEstimateTask(context, index, userName, detailData);
  detailData = estimateResult.detailData;

  await handleTaskReward(context, index, userName, estimateResult.estimateTask);
  await handleTurntable(context, index, userName);
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
      $.log(`账号${index + 1}: 执行异常 => ${error.message || error}`);
    }
  }
}

main()
  .catch((error) => $.log(`脚本异常 => ${error.message || error}`))
  .finally(() => $.done());
