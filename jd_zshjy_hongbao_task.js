/*
cron:24 0 * * * jd_zshjy_hongbao_task.js

环境变量说明：
1. JD_ZSHJY_HONGBAO_EID_TOKEN
   含义：可选，覆盖请求头里的 x-api-eid-token。
   默认值：脚本内置抓包默认值。

2. JD_ZSHJY_HONGBAO_SDK_TOKEN
   含义：可选，覆盖表单里的 wg-sdk-token。
   默认值：脚本内置抓包默认值。

3. JD_ZSHJY_HONGBAO_UUID
   含义：可选，覆盖 uuid/openudid。
   默认值：优先取 Cookie 里的 deviceid_pdj_jd，其次回退到通用请求 uuid。

4. JD_ZSHJY_HONGBAO_FULL_COOKIE
   含义：可选，补充活动页抓包里的完整 Cookie，用于补齐 sdtoken、3AB9D23F7A4B3CSS 等风控/会话字段。
   默认值：空。
   注意：必须和当前 JD_COOKIE 是同一账号。

5. JD_ZSHJY_HONGBAO_AREA
   含义：可选，覆盖 apTaskList 请求体里的 area。
   默认值：18_1482_48938_54602。

6. JD_ZSHJY_HONGBAO_MAX_TASKS
   含义：最多尝试多少个未完成浏览任务。
   默认值：不限制，按任务列表顺序逐个尝试。配置为正整数时限制尝试数量。

7. JD_ZSHJY_HONGBAO_MAX_DRAWS
   含义：最多执行多少次抽奖。
   默认值：10。

8. JD_ZSHJY_HONGBAO_DEBUG
   含义：是否打印接口原始返回片段。
   默认值：0，配置为 1 开启。
*/

'use strict';

const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getUserName,
  mergeCookieString,
  parseCookieString,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东指数交易红包任务');

const API_ENDPOINT = 'https://api.m.jd.com/api';
const APPID = 'activities_platform';
const START_TASK_APPID = 'activity_platform_se';
const CLIENT = 'ios';
const CLIENT_VERSION = '15.6.50';
const PLATFORM = '3';
const LOGIN_TYPE = '2';
const LOGIN_WQ_BIZ = 'wegame';

const PAGE_ID = '4S4c9chmJgpdbyygi37uwys9j16M';
const PAGE_URL = `https://pro.m.jd.com/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?stath=47&navh=44&babelChannel=ttt1&tttparams=iI6UIMCMXeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEyLjk3MDg4OSIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMDEyMDMiLCJsYnNMbmciOiIxMTIuOTcxNDM3IiwicHJzdGF0ZSI6IjAiLCJncHNfYXJlYSI6IjE4XzE0ODJfNDg5MzhfNTQ2MDIiLCJzY2FsZSI6IjMiLCJhZGRyZXNzSWQiOiIxNTE1MjIwMDk4IiwidW5fYXJlYSI6IjE4XzE0ODJfMzYwNl82MDAwMCIsIndpZHRoIjoiMTE3MCIsImxic0FyZWEiOiIxOF8xNDgyXzQ4OTM4XzU0NjAyIiwibGF0IjoiMjguMjAxNDIyIiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX90%3D&clickIndex=0&hybrid_err_view=1&innerIndex=1&jumpFrom=1&jwebprog=0`;
const LINK_ID = '1sPvvx2KAcIQ8otdQ_3pvQ';

const BEFORE_HOME_H5ST_APP_ID = '02f8d';
const HOME_H5ST_APP_ID = 'eb67b';
const START_TASK_H5ST_APP_ID = 'acb1e';
const DO_TASK_H5ST_APP_ID = '54ed7';
const DRAW_TASK_AWARD_H5ST_APP_ID = 'f0f3f';
const LIMIT_TASK_H5ST_APP_ID = 'ebecc';
const POLL_H5ST_APP_ID = 'b3f11';
const DRAW_PRIZE_H5ST_APP_ID = 'c02c6';

const DEFAULT_EID_TOKEN = 'jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM5XA5246QAAAAACEOAN5BEGXJN6QX';
const DEFAULT_SDK_TOKEN = 'jdd01M3LGKJLG66XESDFMM25XEN5WN3H2L2WXLOTSWOS2QHWTMK36ZPWWCCONBNFTIWDRBVTY6PDUY7AS2IEYMSX6H4VUTAVLP22B7VDXTEI01234567';
const ACTIVITY_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1776910072%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const DEFAULT_FULL_ACTIVITY_COOKIE = 'sdtoken=AAbEsBpEIOVjqTAKCQtvQu17vnP98yMFM1Z7wZgJIcA_l1ckcd6VYIgJ5FTx5uUnwBg2d-MXh6z-sANZGxXX3afY4X72SaQDuudv0Qky9vMi1NdEAeZNAEivx9S-n0ZpRLI_Tf-o1nE9mGNj_EJ4NmNwB4SffW0_9xrjK84r1nFX1qedHTq77fk; __jd_ref_cls=Babel_dev_other_PopularLottery_Draw; shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063; shshshfpb=BApXWTuIPu_hAHG66jpkKj0ZbcwofbpzLBgPXF0wo9xJ1ONBSe4PYlUOz1Xq4nSx7E9Y25vKCisdhJOsy7qQH49hxZlOl; mba_muid=1776773704574581962055.7254.1776912409195; mba_sid=7254.9; __jda=122270672.1776773704574581962055.1776773704.1776881879.1776906750.89; __jdb=122270672.10.1776773704574581962055|89.1776906750; __jdv=122270672%7Clianmeng__8__kong__kong%7Ct_1000441370_%7Cjingfen%7C3aa763a7847d85fb2a7b0af77a38b484%7C1776876607000; unionwsws=%7B%22devicefinger%22%3A%22eidI1b48812339seYMyi%2BxceSWi9B1BquhXOpmDMpHufNfBzKBTXpbftpBC99S3bp%2FiNdUQ1bciMGfQ8NmK0u2XbCkQVMWnsFVrkAH3Pc1awkgIzpohR%22%7D; unpl=JF8EAJpnNSttWhsEAxwASxQZTlsBV1lfGBRTaTQEBApeTQQHElEeGxV7XlVdWhRKEh9sZRRVXFNPVQ4aBCsiEEpcVVtYCEkRAl9XDVwzWAZUaxhsG19dBm1XXm0ISicDaWEBU1xRQlwBEgYZERZMWFZWXQ97FjNvYTVkbVl7VTUaMlB8EQZdUlhZD0oeCmdjDFBfW01TABkKGxUgSm1X%7CJF8EANRnNSttXh5XBB4HT0IZTA5QWwldGx9WamICUQ9RH1FQTwoYERd7XlVdWhRKFB9ubxRXXVNOVQ4eAisiEEpcVF9ZC04fA19jBlBaXXtSax4AEhcZS1xcMF4JSnl-NyBRFhxES1drG2wfERRMWDpuXgh7FjM7NVIGCgxJXARMAxwQRxtaUA5eWBkSCmtmBlBZDEpVUSsDKxsRe11VX1wKSxYHb2IAVW1oSmQEKwMrWX5KEAAMClocQwFnZlJVWlocBAIfUhhCQk5UUF9eDE9DAm4zNVVtWA; b_dh=753; 3AB9D23F7A4B3C9B=HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPA; 3AB9D23F7A4B3CSS=jdd03HSYEEPKHTG76ATT3YFGAOCCDJCVIBKLSLTHDL6LJUAYZ33I4RMZY7PWTMLWZXJEXEY6SVG3RS3UDIR3577QI35YTPAAAAAM5XA5246QAAAAACEOAN5BEGXJN6QX; _gia_d=1; pre_seq=2; pre_session=224e6c34e7638196d45b7006b8f1713f8d4ec463|20019; __jdc=122270672; pt_key=app_openAAJp6RMoADAY0VqOGxN9tWniDZQR39t-UKNQqQaXeFPIvW3tA6u6RphJu73EDBnaFfTjxvQ2Vd8; pt_pin=lifeng9891; pwdt_id=lifeng9891; warehistory=100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C; wxa_level=1; joyya=1776882513.1776882636.69.1xtcejf; shshshfpv=JD0211d47dXRPBE3RgYr177688234935107z_IASOaI627HTnhsqnd_30vcXX6l0wc7eTFelMX8DPlA05IL3b6TQdeLrzX57Li0L2jID0F51LYC4Tuwe8xN4L6c-_jritTithx13VfRDh1t7kI1CjMvRBitKF_mn4Y10kfk15q~BApXWXmF4tfhD1OB8xqCNNSQdMge9fkCrLs8Pw0xX9xJ1ONBSe4PYlUOz1Xr7I5ZME9Y2tKfQipYzc74z460Isd5hSRB7; qid_evord=30619; qid_ls=1776876669203; qid_ts=1776882472399; qid_vis=80; showedCardInfo=2_default; sid=; cid=8; jxsid=17768740161496914023; jd_bean_anim__2026-04-23=2; PPRD_P=LOGID.1776873437640.516697803; x-rp-evtoken=mGW9U4qbzsaBdCMe70m9pCkQCXoOESuHd4Gn4iXzr5M1TcnpFBzJmm12Bfr6UIS3NrQxGalT4yJNDSB-xMRwtQ%3D%3D; jcap_dvzw_fp=S8ZOO2ljg6kjD692Jqmy7RRxDntWOSOI1eJIyp2c64b9CnoWIKivgd5dURXlAft7w6-A-Da1RIhR9kOK0EyWXg==; shshshfpx=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063; UUID=76C0B11A-9A15-423F-AD24-788ADF0C9AA6; deviceId=224e6c34e7638196d45b7006b8f1713f8d4ec463; deviceType=iPhone14,5; jdpay_appId=com.360buy.jdmobile; jdpay_appVersion=170394; jdpay_browserId=pay; jdpay_sdkVersion=4.01.99.00; moduleBuildVersion=17; moduleName=JDPaySDK; moduleVersion=4.01.99.00; osPlatform=iOS; __jdu=1776773704574581962055; cartNum=8; jsavif=1; webp=1; jkcsjdv=17756061592412010351409; deviceid_pdj_jd=224e6c34e7638196d45b7006b8f1713f8d4ec463; visitkey=9064630564580568512; SameSite=Strict; qid_fs=1775610598323; qid_uid=771fdd32-da27-4fe2-88d3-4feb39c7bf59; b_avif=1; b_dpr=3; b_dw=390; b_webp=1';

const DEFAULT_BUILD = '170394';
const DEFAULT_SCREEN = '390*844';
const DEFAULT_NETWORK_TYPE = 'wifi';
const DEFAULT_BRAND = 'iPhone';
const DEFAULT_MODEL = 'iPhone14,5';
const DEFAULT_LANG = 'zh_CN';
const DEFAULT_OS_VERSION = '26.2';
const DEFAULT_PARTNER = '-1';
const DEFAULT_AREA = '18_1482_48938_54602';
const DEFAULT_BROWSE_WAIT_MS = 10 * 1000;
const DEFAULT_MAX_DRAWS = 10;

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_ZSHJY_HONGBAO_DEBUG === '1';
}

function readPositiveInt(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallback;
}

function getMaxTasks() {
  const configuredValue = process.env.JD_ZSHJY_HONGBAO_MAX_TASKS;
  if (!configuredValue) {
    return Number.POSITIVE_INFINITY;
  }
  return readPositiveInt(configuredValue, Number.POSITIVE_INFINITY);
}

function getMaxDraws() {
  return readPositiveInt(process.env.JD_ZSHJY_HONGBAO_MAX_DRAWS, DEFAULT_MAX_DRAWS);
}

function formatTaskLimit(taskLimit) {
  return Number.isFinite(taskLimit) ? String(taskLimit) : '不限制';
}

function getTaskArea() {
  return process.env.JD_ZSHJY_HONGBAO_AREA || DEFAULT_AREA;
}

function getBrowseWaitMs(task) {
  const taskWaitMs = Number(task?.timeLimitPeriod || 0) * 1000;
  return Math.max(DEFAULT_BROWSE_WAIT_MS, taskWaitMs);
}

function buildActivityCookie(cookie) {
  const fullCookie = String(process.env.JD_ZSHJY_HONGBAO_FULL_COOKIE || DEFAULT_FULL_ACTIVITY_COOKIE).trim();
  if (!fullCookie) {
    return cookie;
  }

  const baseCookieMap = parseCookieString(cookie);
  const overrideValues = {};
  for (const [key, value] of baseCookieMap.entries()) {
    overrideValues[key] = value;
  }
  return mergeCookieString(fullCookie, overrideValues);
}

function getDeviceUuid(cookie) {
  const cookieMap = parseCookieString(cookie);
  return process.env.JD_ZSHJY_HONGBAO_UUID || cookieMap.get('deviceid_pdj_jd') || cookieMap.get('deviceId') || '224e6c34e7638196d45b7006b8f1713f8d4ec463';
}

function getTaskItemUrl(task, item) {
  return item?.itemId || item?.itemUrl || item?.clickUrl || task?.taskSourceUrl || '';
}

function buildTaskApiItemId(task, item) {
  return getTaskItemUrl(task, item);
}

function getTaskItems(task) {
  const itemList = Array.isArray(task?.taskItemList) ? task.taskItemList : [];
  if (itemList.length) {
    return itemList;
  }

  const sourceUrl = task?.taskSourceUrl || '';
  return sourceUrl ? [{ itemId: sourceUrl, taskInsert: false, pipeExt: {} }] : [];
}

function isBrowseTask(task) {
  return ['BROWSE_CHANNEL', 'BROWSE_PRODUCT'].includes(String(task?.taskType || ''));
}

function isTaskCompleted(task) {
  return Boolean(
    task?.taskFinished ||
      task?.status?.finished ||
      task?.status?.alreadyGranted ||
      task?.finished ||
      task?.alreadyGranted,
  );
}

function isTaskItemCompleted(item) {
  return Boolean(item?.isReceived || item?.taskFinished || item?.finished || item?.alreadyGranted || item?.status?.finished || item?.status?.alreadyGranted);
}

function getTaskAssignmentId(task) {
  return task?.pipeExt?.assignmentId || task?.assignmentId || '';
}

function getTaskTimeLimitSwitch(task, item) {
  return Number(task?.pipeExt?.timeLimitSwitch ?? task?.timeLimitSwitch ?? item?.pipeExt?.timeLimitSwitch ?? 0);
}

function getTaskPipeExt(task, item) {
  return {
    ...(task?.pipeExt || {}),
    taskType: task?.pipeExt?.taskType || task?.taskType || '',
    timeLimitSwitch: getTaskTimeLimitSwitch(task, item),
    assignmentId: getTaskAssignmentId(task),
  };
}

function isTimerTask(task, item) {
  return getTaskTimeLimitSwitch(task, item) >= 1;
}

function buildExt(extraFields = {}) {
  return JSON.stringify({
    appType: 'jdapp',
    systemType: 'ios',
    bigScreen: false,
    'x-api-eid-token': process.env.JD_ZSHJY_HONGBAO_EID_TOKEN || DEFAULT_EID_TOKEN,
    'wg-sdk-token': process.env.JD_ZSHJY_HONGBAO_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    pageUrl: encodeURIComponent(PAGE_URL),
    ...extraFields,
  });
}

function buildCommonForm(cookie, options = {}) {
  const uuid = getDeviceUuid(cookie);
  return {
    t: Date.now(),
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
    'x-api-eid-token': process.env.JD_ZSHJY_HONGBAO_EID_TOKEN || DEFAULT_EID_TOKEN,
    uuid,
    build: DEFAULT_BUILD,
    screen: DEFAULT_SCREEN,
    networkType: DEFAULT_NETWORK_TYPE,
    d_brand: DEFAULT_BRAND,
    d_model: DEFAULT_MODEL,
    lang: DEFAULT_LANG,
    osVersion: DEFAULT_OS_VERSION,
    partner: DEFAULT_PARTNER,
    'wg-sdk-token': process.env.JD_ZSHJY_HONGBAO_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    ext: buildExt(options.extFields || {}),
    imei: '',
    aid: '',
    openudid: uuid,
    adid: '',
    cthr: '1',
  };
}

async function callActivityApi(cookie, functionId, body, options = {}) {
  return postFormApi(cookie, {
    endpoint: API_ENDPOINT,
    functionId,
    appid: options.appid || APPID,
    body,
    client: CLIENT,
    loginType: LOGIN_TYPE,
    loginWQBiz: LOGIN_WQ_BIZ,
    origin: 'https://pro.m.jd.com',
    referer: options.referer || PAGE_REFERER,
    userAgent: ACTIVITY_USER_AGENT,
    extraForm: {
      ...buildCommonForm(cookie, { extFields: options.extFields }),
      ...(options.extraForm || {}),
    },
    extraHeaders: {
      ...(options.extraHeaders || {}),
    },
    h5stAppId: options.h5stAppId || '',
    h5stMode: options.h5stMode || 'h5st41',
    h5stPageUrl: options.h5stPageUrl || PAGE_URL,
    h5stSignKeys: options.h5stSignKeys || [],
    h5stVersion: '5.3',
  });
}

async function getStaticResource(cookie) {
  return callActivityApi(cookie, 'getStaticResource', {
    linkId: LINK_ID,
  });
}

async function inviteFissionBeforeHome(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionBeforeHome',
    {
      linkId: LINK_ID,
      isJdApp: true,
      inviter: '',
    },
    {
      h5stAppId: BEFORE_HOME_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function inviteFissionHome(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionHome',
    {
      linkId: LINK_ID,
      inviter: '',
    },
    {
      h5stAppId: HOME_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function queryTaskList(cookie) {
  return callActivityApi(cookie, 'apTaskList', {
    linkId: LINK_ID,
    queryType: 0,
    channel: 4,
    area: getTaskArea(),
  });
}

async function queryTaskDetail(cookie, task) {
  return callActivityApi(cookie, 'apTaskDetail', {
    linkId: LINK_ID,
    taskType: task?.taskType || '',
    taskId: task?.id,
    channel: 4,
    checkVersion: true,
    cityId: 0,
    provinceId: 0,
    countyId: 0,
  });
}

async function startTaskTime(cookie, task, item) {
  const body = {
    linkId: LINK_ID,
    taskId: task?.id,
    itemId: buildTaskApiItemId(task, item),
    channel: 4,
    pipeExt: getTaskPipeExt(task, item),
  };
  if (item && Object.prototype.hasOwnProperty.call(item, 'taskInsert')) {
    body.taskInsert = item.taskInsert;
  }

  return callActivityApi(
    cookie,
    'apStartTaskTime',
    body,
    {
      appid: START_TASK_APPID,
      h5stAppId: START_TASK_H5ST_APP_ID,
    },
  );
}

async function doLimitTimeTask(cookie) {
  return callActivityApi(
    cookie,
    'apDoLimitTimeTask',
    {
      linkId: LINK_ID,
    },
    {
      h5stAppId: LIMIT_TASK_H5ST_APP_ID,
    },
  );
}

async function doTask(cookie, task, item) {
  return callActivityApi(
    cookie,
    'apsDoTask',
    {
      linkId: LINK_ID,
      taskType: task?.taskType || task?.pipeExt?.taskType || '',
      taskId: task?.id,
      channel: 4,
      checkVersion: true,
      pipeExt: getTaskPipeExt(task, item),
      taskInsert: item?.taskInsert ?? false,
      itemId: buildTaskApiItemId(task, item),
    },
    {
      h5stAppId: DO_TASK_H5ST_APP_ID,
      extraForm: {
        appId: DO_TASK_H5ST_APP_ID,
      },
    },
  );
}

async function drawTaskAward(cookie, task) {
  return callActivityApi(
    cookie,
    'apTaskDrawAward',
    {
      linkId: LINK_ID,
      taskType: task?.taskType || task?.pipeExt?.taskType || '',
      taskId: task?.id,
      channel: 4,
      checkVersion: true,
    },
    {
      h5stAppId: DRAW_TASK_AWARD_H5ST_APP_ID,
      extraForm: {
        appId: DRAW_TASK_AWARD_H5ST_APP_ID,
      },
    },
  );
}

async function inviteFissionPoll(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionPoll',
    {
      linkId: LINK_ID,
      type: 2,
    },
    {
      h5stAppId: POLL_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
    },
  );
}

async function inviteFissionDrawPrize(cookie) {
  return callActivityApi(
    cookie,
    'inviteFissionDrawPrize',
    {
      linkId: LINK_ID,
      area: getTaskArea(),
    },
    {
      h5stAppId: DRAW_PRIZE_H5ST_APP_ID,
      extraHeaders: {
        'x-rp-client': 'h5_1.0.0',
        'x-referer-page': PAGE_URL,
      },
      extFields: {
        qdPageId: 'MO-J2011-1',
        mdClickId: 'Babel_dev_other_FissionRed_ClickDraw',
      },
    },
  );
}

function summarizeTask(task, item = null) {
  const reward = (task?.configBaseList || [])
    .map((item) => `${item.awardGivenNumber || '?'}x${item.awardTitle || item.awardName || '奖励'}`)
    .join(',');
  const assignmentId = getTaskAssignmentId(task) || '-';
  const waitSeconds = Number(task?.timeLimitPeriod || 0);
  const itemUrl = getTaskItemUrl(task, item);
  const itemTitle = item?.itemName ? ` | item=${item.itemName}` : '';
  return `${task.taskShowTitle || task.taskTitle || assignmentId}${itemTitle} | id=${task?.id || '-'} | type=${task.taskType || '-'} | timer=${getTaskTimeLimitSwitch(task, item)} | wait=${waitSeconds}s | done=${Boolean(task.taskFinished)} | reward=${reward || '-'} | assignmentId=${assignmentId} | itemUrl=${itemUrl || '-'}`;
}

async function buildPendingTasks(cookie, taskListResult, prefix) {
  const tasks = Array.isArray(taskListResult?.data) ? taskListResult.data : [];
  const pendingTasks = [];
  const stats = {
    completedTasks: 0,
    detailCompletedTasks: 0,
    completedItems: 0,
    noItemTasks: 0,
  };

  for (const task of tasks) {
    const assignmentId = getTaskAssignmentId(task);
    if (!isBrowseTask(task) || !assignmentId || !task?.id) {
      continue;
    }
    if (isTaskCompleted(task)) {
      stats.completedTasks += 1;
      continue;
    }

    let taskWithItems = task;
    let items = getTaskItems(taskWithItems).filter((item) => getTaskItemUrl(taskWithItems, item) && !isTaskItemCompleted(item));
    if (!items.length) {
      const detailResult = await queryTaskDetail(cookie, task);
      if (isDebugEnabled()) {
        $.log(`${prefix}: apTaskDetail ${task.id} => ${stringifySnippet(detailResult, 1000)}`);
      }
      if (Number(detailResult?.code ?? -1) === 0 && detailResult?.data) {
        if (isTaskCompleted(detailResult.data)) {
          stats.detailCompletedTasks += 1;
          continue;
        }
        taskWithItems = {
          ...task,
          ...detailResult.data,
          pipeExt: {
            ...(task.pipeExt || {}),
            ...(detailResult.data.pipeExt || {}),
          },
        };
        const detailItems = getTaskItems(taskWithItems).filter((item) => getTaskItemUrl(taskWithItems, item));
        items = detailItems.filter((item) => !isTaskItemCompleted(item));
        stats.completedItems += detailItems.length - items.length;
      }
    }

    if (!items.length) {
      stats.noItemTasks += 1;
      continue;
    }

    for (const item of items) {
      pendingTasks.push({ task: taskWithItems, item });
    }
  }

  $.log(
    `${prefix}: 任务过滤 => 顶层已完成${stats.completedTasks}个，明细已完成${stats.detailCompletedTasks}个，已完成item${stats.completedItems}个，无可执行item${stats.noItemTasks}个`,
  );

  return pendingTasks.sort((leftEntry, rightEntry) => getPendingTaskPriority(rightEntry) - getPendingTaskPriority(leftEntry));
}

function getPendingTaskPriority(entry) {
  const { task, item } = entry;
  const itemUrl = getTaskItemUrl(task, item);
  const taskType = String(task?.taskType || '');
  let score = 0;

  if (taskType === 'BROWSE_PRODUCT') {
    score += 100;
  }
  if (/^\d+$/.test(itemUrl)) {
    score += 80;
  }
  if (isTimerTask(task, item)) {
    score += 20;
  }
  if (itemUrl.includes('pro.m.jd.com/mall/active/')) {
    score += 10;
  }
  if (itemUrl.includes('showTask=1')) {
    score += 5;
  }
  if (itemUrl.includes('floating=true')) {
    score -= 10;
  }

  return score;
}

function readDrawTimes(homeResult) {
  return Number(homeResult?.data?.drawPrizeNum || 0);
}

async function performDraws(cookie, prefix, drawTimes) {
  const requestedTimes = Number(drawTimes || 0);
  const totalTimes = Math.min(Math.max(requestedTimes, 0), getMaxDraws());
  if (!totalTimes) {
    $.log(`${prefix}: 当前没有可执行抽奖次数`);
    return;
  }

  $.log(`${prefix}: 开始抽奖，共尝试 ${totalTimes} 次`);
  for (let index = 0; index < totalTimes; index += 1) {
    const drawResult = await inviteFissionDrawPrize(cookie);
    $.log(`${prefix}: 第 ${index + 1} 次抽奖出奖 => ${stringifySnippet(drawResult, 1200)}`);

    if (Number(drawResult?.code ?? -1) !== 0) {
      break;
    }
  }
}

async function runAccount(cookie, index) {
  const activityCookie = buildActivityCookie(cookie);
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  $.log(`\n==== ${prefix} ====`);

  const staticResource = await getStaticResource(activityCookie);
  if (isDebugEnabled()) {
    $.log(`${prefix}: getStaticResource => ${stringifySnippet(staticResource, 1000)}`);
  }

  const beforeHomeResult = await inviteFissionBeforeHome(activityCookie);
  if (isDebugEnabled() || Number(beforeHomeResult?.code ?? -1) !== 0) {
    $.log(`${prefix}: inviteFissionBeforeHome => ${stringifySnippet(beforeHomeResult, 1000)}`);
  }

  const homeResult = await inviteFissionHome(activityCookie);
  if (Number(homeResult?.code ?? -1) === 0) {
    $.log(
      `${prefix}: 首页状态 => 当前抽奖次数=${homeResult?.data?.drawPrizeNum ?? 0}，已中奖次数=${homeResult?.data?.prizeNum ?? 0}，inviteCode=${homeResult?.data?.inviteCode || '-'}`,
    );
  } else {
    $.log(`${prefix}: inviteFissionHome 返回 => ${stringifySnippet(homeResult, 800)}`);
    if (isDebugEnabled()) {
      $.log(`${prefix}: getStaticResource => ${stringifySnippet(staticResource, 1000)}`);
    }
  }

  const taskListResult = await queryTaskList(activityCookie);
  const taskList = Array.isArray(taskListResult?.data) ? taskListResult.data : [];
  if (!taskList.length) {
    $.log(`${prefix}: apTaskList 未返回任务 => ${stringifySnippet(taskListResult, 1000)}`);
    return;
  }

  const activeTaskList = taskList.filter((task) => isBrowseTask(task) && !isTaskCompleted(task));
  $.log(`${prefix}: 未完成浏览任务列表 => ${activeTaskList.map((task) => summarizeTask(task)).join(' || ') || '空'}`);

  const allPendingTasks = await buildPendingTasks(activityCookie, taskListResult, prefix);
  const maxTasks = getMaxTasks();
  const pendingTasks = Number.isFinite(maxTasks) ? allPendingTasks.slice(0, maxTasks) : allPendingTasks;
  $.log(`${prefix}: 待执行浏览任务数 => ${pendingTasks.length}，任务上限=${formatTaskLimit(maxTasks)}`);
  if (!pendingTasks.length) {
    $.log(`${prefix}: 没有可尝试的未完成浏览任务，继续尝试抽奖`);
  }

  const completedTaskIds = new Set();
  for (const { task, item } of pendingTasks) {
    if (completedTaskIds.has(task.id)) {
      continue;
    }

    let waitedForTask = false;
    try {
      $.log(`${prefix}: 尝试任务 => ${summarizeTask(task, item)}`);
      const itemUrl = getTaskItemUrl(task, item);
      if (itemUrl) {
        $.log(`${prefix}: 对应会场 => ${itemUrl}`);
      }

      if (!isTimerTask(task, item)) {
        const doTaskResult = await doTask(activityCookie, task, item);
        $.log(`${prefix}: apsDoTask 执行任务 => ${stringifySnippet(doTaskResult, 800)}`);
        if (Number(doTaskResult?.code ?? -1) === 0) {
          completedTaskIds.add(task.id);
          if (doTaskResult?.data?.alreadyGranted || doTaskResult?.data?.finished) {
            $.log(`${prefix}: apsDoTask 已完成并发放奖励`);
            continue;
          }
          const waitMs = getBrowseWaitMs(task);
          $.log(`${prefix}: apsDoTask 成功，等待 ${Math.ceil(waitMs / 1000)} 秒后领取任务奖励`);
          await sleep(waitMs);
          waitedForTask = true;
          const drawAwardResult = await drawTaskAward(activityCookie, task);
          $.log(`${prefix}: apTaskDrawAward 领取任务奖励 => ${stringifySnippet(drawAwardResult, 800)}`);
        } else if (Number(doTaskResult?.code ?? -1) === 2005) {
          completedTaskIds.add(task.id);
        }
        continue;
      }

      const startResult = await startTaskTime(activityCookie, task, item);
      $.log(`${prefix}: apStartTaskTime 启动计时 => ${stringifySnippet(startResult, 800)}`);

      if (Number(startResult?.code ?? -1) === 0) {
        const waitMs = getBrowseWaitMs(task);
        $.log(`${prefix}: 启动计时成功，等待 ${Math.ceil(waitMs / 1000)} 秒后完成限时任务`);
        await sleep(waitMs);
        waitedForTask = true;
        const pollResult = await inviteFissionPoll(activityCookie);
        $.log(`${prefix}: inviteFissionPoll 单次刷新 => ${stringifySnippet(pollResult, 800)}`);
        const limitResult = await doLimitTimeTask(activityCookie);
        $.log(`${prefix}: apDoLimitTimeTask 完成限时任务 => ${stringifySnippet(limitResult, 800)}`);
        completedTaskIds.add(task.id);
        continue;
      }

      const doTaskResult = await doTask(activityCookie, task, item);
      $.log(`${prefix}: apStartTaskTime 未成功，apsDoTask 备用执行 => ${stringifySnippet(doTaskResult, 800)}`);
      if (Number(doTaskResult?.code ?? -1) === 0) {
        completedTaskIds.add(task.id);
        if (doTaskResult?.data?.alreadyGranted || doTaskResult?.data?.finished) {
          $.log(`${prefix}: apsDoTask 备用执行已完成并发放奖励`);
          continue;
        }
        const drawAwardResult = await drawTaskAward(activityCookie, task);
        $.log(`${prefix}: apTaskDrawAward 领取任务奖励 => ${stringifySnippet(drawAwardResult, 800)}`);
      } else if (Number(doTaskResult?.code ?? -1) === 2005) {
        completedTaskIds.add(task.id);
      }
    } catch (error) {
      $.log(`${prefix}: 当前任务异常，跳过继续下一个 => ${summarizeTask(task, item)}，错误=${error.message || error}`);
    } finally {
      if (!waitedForTask) {
        const waitMs = getBrowseWaitMs(task);
        $.log(`${prefix}: 当前任务未进入成功计时等待，补充等待 ${Math.ceil(waitMs / 1000)} 秒后继续下一个`);
        await sleep(waitMs);
      }
    }
  }

  const refreshedHomeResult = await inviteFissionHome(activityCookie);
  if (Number(refreshedHomeResult?.code ?? -1) === 0) {
    $.log(
      `${prefix}: 刷新后首页状态 => 当前抽奖次数=${refreshedHomeResult?.data?.drawPrizeNum ?? 0}，已中奖次数=${refreshedHomeResult?.data?.prizeNum ?? 0}`,
    );
    await performDraws(activityCookie, prefix, readDrawTimes(refreshedHomeResult));
  } else {
    $.log(`${prefix}: 刷新首页失败 => ${stringifySnippet(refreshedHomeResult, 800)}`);
  }

  if (isDebugEnabled()) {
    const finalPollResult = await inviteFissionPoll(activityCookie);
    $.log(`${prefix}: 最终 inviteFissionPoll => ${stringifySnippet(finalPollResult, 800)}`);
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
