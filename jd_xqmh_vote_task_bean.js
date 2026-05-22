/*
cron:44 0 * * * jd_xqmh_vote_task_bean.js

新奇盲盒：商品投票、拆盲盒、做任务、领奖。

基于 files/traffic_jd_新奇盲盒_投票+完成任务+领取奖励_filtered.har 分析得到的主流程：
1. newunique_popup 查询商品投票弹窗与剩余票数。
2. newunique_vote 给商品投票。
3. common_task_list 查询新奇盲盒任务列表。
4. common_do_task 完成签到、浏览、拆盒等任务。
5. common_do_task + ext.doReceiveRewards=1 领取手动任务奖励。

环境变量：
1. JD_XQMH_SKU_ID
   投票商品 skuId，默认使用抓包里的 10111303784719。
2. JD_XQMH_ROUND_ID
   投票轮次 roundId，默认使用抓包里的 NUE_e2ea162b。
3. JD_XQMH_MAX_TASKS
   最多执行多少个未完成任务，默认 8。
4. JD_XQMH_WAIT_MS
   浏览任务兜底等待毫秒数，默认 6000。
5. JD_XQMH_DEBUG
   配置为 1 时打印更长 request/response。
6. JD_XQMH_SKIP_VOTE / JD_XQMH_SKIP_TASKS / JD_XQMH_SKIP_REWARD
   分别跳过投票、做任务、领奖。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  createH5st,
  getUserName,
  mergeCookieString,
  parseApiResponse,
  parseCookieString,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('新奇盲盒投票任务领京豆');

const ORIGIN = 'https://pro.m.jd.com';
const PAGE_ID = '4Va8jNzzHPqgTUhxwiTn9PHyVZCB';
const PAGE_URL = `${ORIGIN}/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt17&topOfHomePage=1`;

const VOTE_ENDPOINT = 'https://api.m.jd.com/client.action';
const TASK_ENDPOINT = 'https://api.m.jd.com/';

const VOTE_APPID = 'signed_wh5';
const VOTE_H5ST_APP_ID = 'ba62b';
const VOTE_CHANNEL_ID = '3';

const TASK_APPID = 'newtry';
const TASK_H5ST_APP_ID = '35fa0';
const TASK_CHANNEL_ID = '8';

const CLIENT_IOS = 'ios';
const CLIENT_APPLE = 'apple';
const CLIENT_VERSION = '15.7.20';
const DEFAULT_SKU_ID = '10111303784719';
const DEFAULT_ROUND_ID = 'NUE_e2ea162b';
const DEFAULT_UUID = '224e6c34e7638196d45b7006b8f1713f8d4ec463';
const DEFAULT_MAX_TASKS = 8;
const DEFAULT_WAIT_MS = 6000;
const REQUEST_TIMEOUT_MS = 15000;

const USER_AGENT = process.env.JD_XQMH_USER_AGENT || 'jdapp;iPhone;15.7.20;;;M/5.0;appBuild/170437;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1778070300%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const DEFAULT_EID = 'HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA';
const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM57VFULRAAAAAACMXWGVOVDITCFAX';
const DEFAULT_ACTIVITY_COOKIE = [
  '__jd_ref_cls=Babel_dev_other_hdenter',
  'shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  'shshshfpb=BApXWeKtD_vhAHG66jpkKj0ZbcwofbpzLBgPXF0wo9xJ1ONBSe4PYlUOz1Xq4nSx7E9Y25vKCisdhJOsy7qQH49imRDm6',
  `3AB9D23F7A4B3C9B=${DEFAULT_EID}`,
  `3AB9D23F7A4B3CSS=${DEFAULT_EID_TOKEN}`,
  '_gia_d=1',
  'sdtoken=AAbEsBpEIOVjqTAKCQtvQu17aT0g4vJ56UlpsyzbnsJqy4bGgLPw5BbSBUGTbmlD6blESIgq90KNtmVwmHi42L9RiH_KBpKQ8aNcB7ydIihmjihrqD9jjjMdI5VwkHjs-GeiRUv2QgZT7J4ltnxq2RMz2EPzecwfY0M5ZQHJtKsN9BuUAQs31vc',
  'mba_muid=17779071289331759247216.7651.1778071059316',
  'mba_sid=7651.21',
  'unionwsws=%7B%22devicefinger%22%3A%22eidI1b48812339seYMyi%2BxceSWi9B1BquhXOpmDMpHufNfBzKBTXpbftpBC99S3bp%2FiNdUQ1bciMGfQ8NmK0u2XbCkQVMWnsFVrkAH3Pc1awkgIzpohR%22%7D',
  '__jda=122270672.1777997475028347787637.1777997475.1778064802.1778071058.9',
  '__jdb=122270672.1.1777997475028347787637|9.1778071058',
  '__jdv=122270672%7Clianmeng__8__kong__kong%7Ct_1000441370_%7Ctuiguang%7C101907450801344891778071056469%7C1778071056000',
  '__jdc=122270672',
  '__jdu=1777997475028347787637',
  'unpl=JF8EAJJnNSttWEpUDRoEHhYRQlxUXFgNQh8DaWEMVVtYSlACHgUTIhNKXlNCXAxXFgR-ZARfX15AVgIrMhsTEUpYUV5fDkonM2hnDBkcCgZkBhsyGiIQTFpdXl4MSB4Bb2QFUV5QTlwCHQErEyBMXV1ubThKJwJfZjUfM1kGVAIcCxsRFEhUVl5eCE4UC2pvAlJeaEpkBg%7CJF8EANRnNSttXh5XBB4HT0IZTA5QWwldGx9WamICUQ9RH1FQTwoYERd7XlVdWhRKFB9ubxRXXVNOVQ4eAisiEEpcVF',
  'TARGET_UNIT=bjcenter',
  'pwdt_id=lifeng9891',
  'joyya=1778061528.1778067905.47.1clf60h',
  'shshshfpv=JD0211d47d2mqYJQhxC317780613947710704RLy3nNHXAdJ0CIDtTeP75ChnBcDHk7ecYMYVHZAI3lNFYPHfiBLgLQE1sfJv2jq2caQG0R-GlzgQZcoVgUncrIraVKGutROMwu8Q-RFdFd0pHRe0-qRBNL6OhykjMk118n3bo~BApXWSFW___hD1OB8xqCNNSQdMge9fkCrLs8Pw0xX9xJ1ONBSe4PYlUOz1Xr7I5ZME9Y2tKfQipYzc74z460Isd7rdR3e',
  'warehistory=100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C',
  'x-rp-evtoken=mGW9U4qbzsaBdCMe70m9pP1k255ziE_jiSkj4jZm99U1BN8agvIUfm1rvcuQeRIFrkwN67y366HHU6qDDRotdg%3D%3D',
  'jcap_dvzw_fp=CKctVFkfav2PbBUsUSBCg4n8oPGDAlIutEMyTngbZZrWGAooZURFJ_qxxPG1-K7iB2AGWQ1FeHDGNrjENmfqQdCIE9M=',
  'shshshfpx=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063',
  'cid=8',
  'jxsid=17780033923479797969',
  'visitkey=7425235251882737841',
  'sid=',
  'SameSite=Strict',
  'pre_session=224e6c34e7638196d45b7006b8f1713f8d4ec463|20560',
  'pre_seq=0',
  'wxa_level=1',
  'webp=1',
  'b_avif=1',
  'b_dpr=3',
  'b_dw=390',
  'b_webp=1',
  'qid_evord=1613',
  'qid_ls=1778050908160',
  'qid_ts=1778055797179',
  'qid_vis=6',
  'qid_fs=1777998244219',
  'qid_uid=600e8dca-282d-45a3-ae63-5a148fc08173',
].join('; ');

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_XQMH_DEBUG === '1';
}

function shouldSkipVote() {
  return process.env.JD_XQMH_SKIP_VOTE === '1';
}

function shouldSkipTasks() {
  return process.env.JD_XQMH_SKIP_TASKS === '1';
}

function shouldSkipReward() {
  return process.env.JD_XQMH_SKIP_REWARD === '1';
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallback;
}

function getMaxTasks() {
  return readPositiveInt(process.env.JD_XQMH_MAX_TASKS, DEFAULT_MAX_TASKS);
}

function getDefaultWaitMs() {
  return readPositiveInt(process.env.JD_XQMH_WAIT_MS, DEFAULT_WAIT_MS);
}

function getSkuId() {
  return String(process.env.JD_XQMH_SKU_ID || DEFAULT_SKU_ID).trim();
}

function getRoundId() {
  return String(process.env.JD_XQMH_ROUND_ID || DEFAULT_ROUND_ID).trim();
}

function stringifyForLog(value, maxLength = 1200) {
  const length = isDebugEnabled() ? Math.max(maxLength, 5000) : maxLength;
  return stringifySnippet(value, length);
}

function getCookieValue(cookie, key) {
  return parseCookieString(cookie).get(key) || '';
}

function getEidToken(cookie) {
  return process.env.JD_XQMH_EID_TOKEN || getCookieValue(cookie, '3AB9D23F7A4B3CSS') || DEFAULT_EID_TOKEN;
}

function getTaskUuid(cookie) {
  if (process.env.JD_XQMH_UUID) {
    return process.env.JD_XQMH_UUID;
  }

  const preSession = getCookieValue(cookie, 'pre_session');
  if (preSession) {
    return decodeURIComponent(preSession).split('|')[0] || DEFAULT_UUID;
  }

  return DEFAULT_UUID;
}

function buildActivityCookie(cookie) {
  const mergedCookie = mergeCookieString(DEFAULT_ACTIVITY_COOKIE, cookie);
  return mergeCookieString(mergedCookie, {
    '3AB9D23F7A4B3C9B': process.env.JD_XQMH_EID || getCookieValue(mergedCookie, '3AB9D23F7A4B3C9B') || DEFAULT_EID,
    '3AB9D23F7A4B3CSS': getEidToken(mergedCookie),
    _gia_d: '1',
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

function logRequest(userName, functionId, url, body) {
  $.log(`账号 ${userName}: ${functionId} request => ${stringifyForLog({
    url,
    body,
    headers: {
      Cookie: '已隐藏',
      Origin: ORIGIN,
      Referer: PAGE_REFERER,
      'User-Agent': USER_AGENT,
    },
  })}`);
}

function logResponse(userName, functionId, response) {
  $.log(`账号 ${userName}: ${functionId} response => ${stringifyForLog(response, 1600)}`);
}

async function postSignedForm(cookie, options) {
  const {
    endpoint,
    functionId,
    appid,
    body,
    h5stAppId,
    signClient,
    signClientVersion = CLIENT_VERSION,
    formClient = '',
    extraForm = {},
    extraQuery = {},
    userName,
  } = options;

  const h5st = await createH5st({
    functionId,
    body,
    h5stAppId,
    requestAppid: appid,
    cookie,
    userAgent: USER_AGENT,
    client: signClient,
    clientVersion: signClientVersion,
    version: '5.3',
  });

  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(extraQuery)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('functionId', functionId);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(extraForm)) {
    if (value !== undefined && value !== null && value !== '') {
      form.set(key, String(value));
    }
  }
  if (endpoint === VOTE_ENDPOINT && appid && !form.has('appid')) {
    form.set('appid', appid);
  }
  if (!form.has('functionId') && endpoint === VOTE_ENDPOINT) {
    form.set('functionId', functionId);
  }
  form.set('body', JSON.stringify(body));
  if (formClient) {
    form.set('client', formClient);
  }
  form.set('h5st', h5st);
  form.set('x-api-eid-token', getEidToken(cookie));

  const requestUrl = url.toString();
  logRequest(userName, functionId, requestUrl, body);

  const response = await got.post(requestUrl, {
    body: form.toString(),
    headers: buildHeaders(cookie),
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  const data = parseApiResponse(response);
  logResponse(userName, functionId, data);
  return data;
}

async function callVoteApi(cookie, userName, functionId, body) {
  return postSignedForm(cookie, {
    endpoint: VOTE_ENDPOINT,
    functionId,
    appid: VOTE_APPID,
    body,
    h5stAppId: VOTE_H5ST_APP_ID,
    signClient: CLIENT_IOS,
    formClient: CLIENT_IOS,
    extraForm: {
      functionId,
      appid: VOTE_APPID,
      clientVersion: CLIENT_VERSION,
    },
    userName,
  });
}

function buildTaskQuery(cookie, functionId) {
  return {
    area: process.env.JD_XQMH_AREA || '18_1482_3606_60000',
    clientVersion: CLIENT_VERSION,
    client: CLIENT_APPLE,
    loginType: '2',
    t: Date.now(),
    appid: TASK_APPID,
    xAPIClientLanguage: 'zh_CN',
    functionId,
    uuid: getTaskUuid(cookie),
    d_model: process.env.JD_XQMH_MODEL || 'iPhone14,5',
    d_brand: 'iPhone',
    model: process.env.JD_XQMH_MODEL || 'iPhone14,5',
    osVersion: process.env.JD_XQMH_OS_VERSION || '26.2',
  };
}

async function callTaskApi(cookie, userName, functionId, body) {
  return postSignedForm(cookie, {
    endpoint: TASK_ENDPOINT,
    functionId,
    appid: TASK_APPID,
    body,
    h5stAppId: TASK_H5ST_APP_ID,
    signClient: CLIENT_APPLE,
    extraQuery: buildTaskQuery(cookie, functionId),
    extraForm: {},
    userName,
  });
}

async function queryVotePopup(cookie, userName) {
  return callVoteApi(cookie, userName, 'newunique_popup', {
    channelId: VOTE_CHANNEL_ID,
    skuId: getSkuId(),
    roundId: getRoundId(),
  });
}

async function voteProduct(cookie, userName) {
  return callVoteApi(cookie, userName, 'newunique_vote', {
    channelId: VOTE_CHANNEL_ID,
    roundId: getRoundId(),
    skuId: getSkuId(),
  });
}

async function queryTaskList(cookie, userName) {
  const response = await callTaskApi(cookie, userName, 'common_task_list', {
    ext: { queryReceiveTimes: 1 },
    extMap: { sceneType: 2 },
    channelId: TASK_CHANNEL_ID,
  });
  return response?.data?.result?.taskInfo?.taskList || [];
}

function getTaskMaterial(task) {
  const ext = task?.ext || {};
  const materialGroups = [
    ext.shoppingActivity,
    ext.followChannel,
    ext.browseShop,
    ext.simpleRecordInfo,
    ext.productInfo,
  ];

  for (const group of materialGroups) {
    if (Array.isArray(group) && group[0]) {
      return group[0];
    }
  }
  return {};
}

function getTaskItemId(task) {
  const material = getTaskMaterial(task);
  return material.itemId || task?.ext?.sign?.itemId || task?.ext?.sign1?.itemId || '1';
}

function getTaskUrl(task) {
  return getTaskMaterial(task).url || '';
}

function getTaskWaitMs(task) {
  const waitDuration = Number(task?.ext?.waitDuration || 0);
  return waitDuration > 0 ? waitDuration * 1000 + 1000 : getDefaultWaitMs();
}

function isTaskCompleted(task) {
  return task?.completionFlag === true || Number(task?.completionCnt || 0) >= Number(task?.assignmentTimesLimit || 1);
}

function canClaimManualReward(task) {
  return Number(task?.canReceiveTimes || 0) > 0;
}

function hasBeanLikeReward(task) {
  return (task?.rewards || []).some((reward) => {
    const rewardType = String(reward?.rewardType || '');
    const rewardName = String(reward?.rewardName || '');
    return rewardType === '3' || rewardType === '41' || rewardName.includes('京豆') || rewardName.includes('盲盒');
  });
}

function shouldRunTask(task) {
  return task?.canParticipation !== false
    && !isTaskCompleted(task)
    && hasBeanLikeReward(task);
}

function summarizeTask(task) {
  return [
    task?.assignmentName || '(未命名任务)',
    `id=${task?.encryptAssignmentId || '-'}`,
    `type=${task?.assignmentType ?? '-'}`,
    `done=${task?.completionFlag}`,
    `cnt=${task?.completionCnt || 0}/${task?.assignmentTimesLimit || 0}`,
    `item=${getTaskItemId(task)}`,
    `receive=${task?.canReceiveTimes || 0}`,
  ].join(' | ');
}

async function openTaskUrl(cookie, userName, task) {
  const url = getTaskUrl(task);
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
  $.log(`账号 ${userName}: 任务页响应 => HTTP ${response.statusCode}`);
}

async function doTask(cookie, userName, task, doReceiveRewards) {
  return callTaskApi(cookie, userName, 'common_do_task', {
    channelId: TASK_CHANNEL_ID,
    itemId: getTaskItemId(task),
    assignmentId: task.encryptAssignmentId,
    actionType: 0,
    ext: {
      doReceiveRewards: doReceiveRewards ? 1 : null,
    },
  });
}

async function runVoteFlow(cookie, userName) {
  if (shouldSkipVote()) {
    $.log(`账号 ${userName}: 已跳过投票`);
    return;
  }

  const popup = await queryVotePopup(cookie, userName);
  const result = popup?.data?.result || {};
  if (Number(result.myVotes || 0) <= 0) {
    $.log(`账号 ${userName}: 无可用投票次数`);
    return;
  }
  if (Number(result.voteStatus || 0) === 1) {
    $.log(`账号 ${userName}: 当前商品今日已投票`);
    return;
  }

  await voteProduct(cookie, userName);
  await sleep(1000);
}

async function runTaskFlow(cookie, userName) {
  if (shouldSkipTasks()) {
    $.log(`账号 ${userName}: 已跳过任务`);
    return;
  }

  let tasks = await queryTaskList(cookie, userName);
  $.log(`账号 ${userName}: 任务列表 ${tasks.length} 个`);
  for (const task of tasks) {
    $.log(`账号 ${userName}: - ${summarizeTask(task)}`);
  }

  const pendingTasks = tasks.filter(shouldRunTask).slice(0, getMaxTasks());
  for (const task of pendingTasks) {
    $.log(`账号 ${userName}: 执行任务 => ${summarizeTask(task)}`);
    await openTaskUrl(cookie, userName, task);
    await sleep(getTaskWaitMs(task));
    await doTask(cookie, userName, task, false);
    await sleep(1200);

    tasks = await queryTaskList(cookie, userName);
    const refreshedTask = tasks.find((item) => item.encryptAssignmentId === task.encryptAssignmentId) || task;
    if (!shouldSkipReward() && canClaimManualReward(refreshedTask)) {
      $.log(`账号 ${userName}: 领取任务奖励 => ${summarizeTask(refreshedTask)}`);
      await doTask(cookie, userName, refreshedTask, true);
      await sleep(1200);
    }
  }

  if (!shouldSkipReward()) {
    const finalTasks = await queryTaskList(cookie, userName);
    const rewardTasks = finalTasks
      .filter((task) => isTaskCompleted(task) && canClaimManualReward(task))
      .slice(0, getMaxTasks());
    for (const task of rewardTasks) {
      $.log(`账号 ${userName}: 补领任务奖励 => ${summarizeTask(task)}`);
      await doTask(cookie, userName, task, true);
      await sleep(1200);
    }
  }
}

async function runAccount(rawCookie, index) {
  const userName = getUserName(rawCookie);
  const cookie = buildActivityCookie(rawCookie);
  $.log(`\n账号${index} ${userName}: 开始`);
  await runVoteFlow(cookie, userName);
  await runTaskFlow(cookie, userName);
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
      $.log(`账号${index + 1}: 执行失败 => ${error.message || error}`);
    }
    await sleep(1500);
  }
})()
  .catch((error) => {
    $.log(`脚本异常 => ${error.stack || error.message || error}`);
  })
  .finally(() => {
    $.done();
  });
