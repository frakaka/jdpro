/*
cron:11 0 * * * jd_jxzy_signin_bean.js

环境变量说明：
1. JD_JXZY_EID_TOKEN
   含义：可选的 x-api-eid-token。若活动接口触发风控，可从抓包提取后覆盖。
   是否必须：否。

2. JD_JXZY_DEBUG
   含义：是否打印接口原始返回片段，便于排查活动参数变化。
   是否必须：否，配置为 1 时开启。

3. JD_JXZY_DRAW_WAIT_MS
   含义：模拟从首页进入京喜自营后，等待自动发奖任务挂载的毫秒数。
   是否必须：否，默认 2600。
*/

'use strict';

const crypto = require('crypto');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  getRequestUuid,
  getUserAgent,
  getUserName,
  postFormApi,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京喜赚豆签到领京豆');

const PAGE_ID = '2iqSwv1JiDHxAkHAikfU6XAECFmo';
const PAGE_URL = `https://pro.m.jd.com/mall/active/${PAGE_ID}/index.html`;
const PAGE_REFERER = `${PAGE_URL}?babelChannel=ttt453&topNavStyle=1`;
const APPID = 'jx_h5_babel';
const H5ST_APP_ID = '832f1';
const CHANNEL = 'jxh5';
const CLIENT = 'jxh5';
const CLIENT_VERSION = '1.2.5';
const ACTIVITY_SOURCE = 'jxzy';
const CRAFT_ID = '6824629a7c46584759d39b78';
const APP_CODE = 'ms1888ebbf';
const BUID = 325;
const SCENEVAL = 2;
const POP_CONFIG_ID = '67ea9a16512557d84cdcca5e';
const POP_CONFIG_IDS = '694e9b25e854ff9b013373a3,67ea9a16512557d84cdcca5e';
const DEFAULT_TTT_ID = 'ttt453';
const DRAW_TTT_ID = 'ttt2';
const PAGE_ACT_ID = '01419519';
const PAGE_NUM_ID = '5601775';
const SITE_CLIENT = 'apple';
const SITE_BUILD = '170394';
const SITE_CLIENT_VERSION = '15.6.50';
const SITE_INFO = {
  isLikeJDMain: true,
  siteName: 'jdmall',
  siteClient: SITE_CLIENT,
  siteClientVersion: SITE_CLIENT_VERSION,
  x_app_key: 'vygmwcxg14ui3jxw',
  mcChannel: '',
};
const DEFAULT_AREA = '18_1482_3606_60000';
const DEFAULT_HOME_LNG = '113.03702';
const DEFAULT_HOME_LAT = '28.210319';
const DEFAULT_ENTRY_LNG = '113.037403';
const DEFAULT_ENTRY_LAT = '28.210382';
const DRAW_WAIT_MS = Number(process.env.JD_JXZY_DRAW_WAIT_MS || 2600);
const GUIDE_PLUS_EXPO_TIMES = [
  '1765987692521',
  '1765988533428',
  '1765988759477',
  '1765988914467',
  '1766078935515',
  '1766079176476',
  '1766079186071',
  '1766079293130',
  '1766079317222',
  '1766079380742',
];
const GUIDE_PLUS_CLICK_TIMES = ['1765368815788', '1765461615911'];
const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_JXZY_DEBUG === '1';
}

function md5(content) {
  return crypto.createHash('md5').update(String(content)).digest('hex');
}

function buildSignBody(payload) {
  const time = Date.now();
  const baseBody = {
    ...payload,
    sceneval: SCENEVAL,
    buid: BUID,
    appCode: APP_CODE,
    time,
  };

  return {
    ...baseBody,
    signStr: md5(JSON.stringify(baseBody)),
  };
}

function buildCommonForm(cookie, options = {}) {
  const { lite = false } = options;
  const baseForm = {
    t: Date.now(),
    channel: CHANNEL,
    clientVersion: CLIENT_VERSION,
    client: CLIENT,
    uuid: getRequestUuid(cookie),
    cthr: '1',
    loginType: '2',
  };

  if (lite) {
    return baseForm;
  }

  return {
    ...baseForm,
    xAPIRegion: 'CN',
    xAPIClientLanguage: 'zh_CN',
    xAPIClientMode: '0',
    xAPITz: 'Asia/Shanghai',
    xAPICurrency: 'CNY',
  };
}

function buildActivityReferer(tttId, options = {}) {
  const searchParams = new URLSearchParams();
  searchParams.set('babelChannel', tttId);
  searchParams.set('topNavStyle', '1');

  if (options.area) {
    searchParams.set('un_area', options.area);
  }
  if (options.hideAnchorBottomTab) {
    searchParams.set('hideAnchorBottomTab', '1');
  }
  if (options.innerIndex) {
    searchParams.set('innerIndex', '1');
  }
  if (options.lng) {
    searchParams.set('lng', options.lng);
  }
  if (options.lat) {
    searchParams.set('lat', options.lat);
  }

  return `${PAGE_URL}?${searchParams.toString()}`;
}

function getEntryLocation() {
  return {
    area: process.env.JD_JXZY_AREA || DEFAULT_AREA,
    homeLng: process.env.JD_JXZY_HOME_LNG || DEFAULT_HOME_LNG,
    homeLat: process.env.JD_JXZY_HOME_LAT || DEFAULT_HOME_LAT,
    lng: process.env.JD_JXZY_ENTRY_LNG || DEFAULT_ENTRY_LNG,
    lat: process.env.JD_JXZY_ENTRY_LAT || DEFAULT_ENTRY_LAT,
  };
}

function buildPageActionBody(tttId, location, referer) {
  return {
    stayWindow: '1',
    activityId: PAGE_ID,
    transParam: JSON.stringify({
      bsessionId: crypto.randomUUID(),
      babelChannel: tttId,
      actId: PAGE_ACT_ID,
      enActId: PAGE_ID,
      pageId: PAGE_NUM_ID,
      encryptCouponFlag: '1',
      sc: SITE_CLIENT,
      scv: SITE_CLIENT_VERSION,
      requestChannel: 'h5',
      jdAtHomePage: '0',
      utmFlag: '0',
      locType: '1',
      screenMode: '0',
      globalTouchstoneResult: {
        touchstoneResult: {
          feed_sku_return: false,
          after_click_purchase: false,
          sku_top_just_visited: true,
          sell_point_style: false,
        },
        extParams: {},
        labels: {},
        labelParams: {},
      },
    }),
    siteClient: SITE_CLIENT,
    siteBuild: SITE_BUILD,
    mitemAddrId: '',
    geo: {
      lng: location.lng,
      lat: location.lat,
    },
    addressId: '',
    posLng: location.homeLng,
    posLat: location.homeLat,
    un_area: location.area,
    gps_area: location.area,
    homeLng: location.homeLng,
    homeLat: location.homeLat,
    areaCode: '0',
    focus: '',
    innerAnchor: '',
    cv: '2.0',
    gLng1: '',
    gLat1: '',
    head_area: '',
    receiverLng: '',
    receiverLat: '',
    fullUrl: referer,
    siteInfo: SITE_INFO,
  };
}

function buildGuideTipsBody(location, referer) {
  return {
    tipsBusinessId: '0',
    activityId: PAGE_ID,
    plusExpoTimes: GUIDE_PLUS_EXPO_TIMES,
    plusClickTimes: GUIDE_PLUS_CLICK_TIMES,
    plusCloseTimes: [],
    channel: '2',
    siteClient: SITE_CLIENT,
    siteBuild: SITE_BUILD,
    mitemAddrId: '',
    geo: {
      lng: location.lng,
      lat: location.lat,
    },
    addressId: '',
    posLng: location.homeLng,
    posLat: location.homeLat,
    un_area: location.area,
    gps_area: location.area,
    homeLng: location.homeLng,
    homeLat: location.homeLat,
    areaCode: '0',
    focus: '',
    innerAnchor: '',
    cv: '2.0',
    gLng1: '',
    gLat1: '',
    head_area: '',
    receiverLng: '',
    receiverLat: '',
    fullUrl: referer,
    siteInfo: SITE_INFO,
  };
}

async function requestJxzyApi(cookie, functionId, body, options = {}) {
  const extraForm = {
    ...buildCommonForm(cookie, { lite: options.liteForm }),
    ...(options.extraForm || {}),
  };

  if (options.includeEidToken && process.env.JD_JXZY_EID_TOKEN) {
    extraForm['x-api-eid-token'] = process.env.JD_JXZY_EID_TOKEN;
  }

  return postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/api',
    functionId,
    appid: APPID,
    body,
    client: CLIENT,
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: options.referer || PAGE_REFERER,
    extraForm,
    extraHeaders: {
      'x-rp-client': 'h5_1.0.0',
      'x-referer-page': PAGE_URL,
    },
    h5stAppId: options.requireH5st ? H5ST_APP_ID : '',
    h5stVersion: '5.3',
  });
}

async function requestClientAction(cookie, functionId, body, options = {}) {
  return postFormApi(cookie, {
    endpoint: 'https://api.m.jd.com/client.action',
    functionId,
    appid: options.appid,
    body,
    client: 'wh5',
    userAgent: getUserAgent(),
    origin: 'https://pro.m.jd.com',
    referer: options.referer,
    extraForm: {
      t: Date.now(),
      clientVersion: '1.0.0',
      client: 'wh5',
      area: options.area,
    },
  });
}

async function querySign(cookie) {
  return requestJxzyApi(
    cookie,
    'jxzy_active_querySign',
    buildSignBody({
      source: ACTIVITY_SOURCE,
      craftId: CRAFT_ID,
    }),
  );
}

async function drawSign(cookie, itemId) {
  return requestJxzyApi(
    cookie,
    'jxzy_active_drawSign',
    buildSignBody({
      itemId: String(itemId || '1'),
      craftId: CRAFT_ID,
      source: ACTIVITY_SOURCE,
    }),
    {
      requireH5st: true,
      includeEidToken: true,
    },
  );
}

async function getPopWindowInfo(cookie) {
  return requestJxzyApi(
    cookie,
    'jxzy_active_getPopWindowInfo',
    buildSignBody({
      activeVersion: 2,
      configId: POP_CONFIG_ID,
      pageId: PAGE_ID,
      tttId: DEFAULT_TTT_ID,
      edit: 0,
      callType: 0,
      taskNext: 0,
    }),
    {
      requireH5st: true,
      includeEidToken: true,
    },
  );
}

async function drawBeanPopWindow(cookie) {
  const location = getEntryLocation();
  return requestJxzyApi(
    cookie,
    'jxzy_active_drawBeanPopWindow',
    buildSignBody({
      pageId: PAGE_ID,
      configId: '',
      configIds: POP_CONFIG_IDS,
      tttId: DRAW_TTT_ID,
      taskId: '',
    }),
    {
      requireH5st: true,
      includeEidToken: true,
      referer: buildActivityReferer(DRAW_TTT_ID, {
        area: location.area,
        hideAnchorBottomTab: true,
        innerIndex: true,
        lng: location.lng,
        lat: location.lat,
      }),
      liteForm: true,
    },
  );
}

async function selectActivity(cookie, tttId, options = {}) {
  return requestJxzyApi(
    cookie,
    'jxzy_active_select',
    buildSignBody({
      activeVersion: 2,
      configIds: POP_CONFIG_IDS,
      pageId: PAGE_ID,
      tttId,
      edit: 0,
    }),
    {
      requireH5st: true,
      includeEidToken: true,
      referer: options.referer || buildActivityReferer(tttId),
      liteForm: Boolean(options.liteForm),
    },
  );
}

async function queryPagePopWindow(cookie, tttId) {
  const location = getEntryLocation();
  const referer = buildActivityReferer(tttId, {
    area: location.area,
    hideAnchorBottomTab: true,
    innerIndex: tttId === DRAW_TTT_ID,
    lng: tttId === DRAW_TTT_ID ? location.lng : '',
    lat: tttId === DRAW_TTT_ID ? location.lat : '',
  });
  return requestClientAction(
    cookie,
    'queryPagePopWindow',
    buildPageActionBody(tttId, location, referer),
    {
      appid: 'babelh5',
      referer,
      area: location.area,
    },
  );
}

async function babelGetGuideTips(cookie, tttId) {
  const location = getEntryLocation();
  const referer = buildActivityReferer(tttId, {
    area: location.area,
    hideAnchorBottomTab: true,
    innerIndex: tttId === DRAW_TTT_ID,
    lng: tttId === DRAW_TTT_ID ? location.lng : '',
    lat: tttId === DRAW_TTT_ID ? location.lat : '',
  });
  return requestClientAction(
    cookie,
    'babelGetGuideTips',
    buildGuideTipsBody(location, referer),
    {
      appid: 'wh5',
      referer,
      area: location.area,
    },
  );
}

function readSignStatus(response) {
  return Number(response?.data?.status ?? -1);
}

function readItemId(response) {
  return response?.data?.itemId || '1';
}

function readPopTask(response) {
  return response?.data?.taskInfo || null;
}

function hasSuccessfulDraw(response) {
  return Number(response?.code ?? -1) === 0 && Number(response?.data?.taskInfo?.taskStatus ?? -1) === 25;
}

async function simulatePageEntry(cookie, prefix, tttId, options = {}) {
  const location = getEntryLocation();
  const referer = buildActivityReferer(tttId, {
    area: location.area,
    hideAnchorBottomTab: true,
    innerIndex: tttId === DRAW_TTT_ID,
    lng: tttId === DRAW_TTT_ID ? location.lng : '',
    lat: tttId === DRAW_TTT_ID ? location.lat : '',
  });

  const [pagePopResult, guideTipsResult, selectResult] = await Promise.all([
    queryPagePopWindow(cookie, tttId),
    babelGetGuideTips(cookie, tttId),
    selectActivity(cookie, tttId, {
      referer,
      liteForm: Boolean(options.liteForm),
    }),
  ]);

  if (isDebugEnabled()) {
    $.log(`${prefix}: queryPagePopWindow(${tttId}) => ${stringifySnippet(pagePopResult, 800)}`);
    $.log(`${prefix}: babelGetGuideTips(${tttId}) => ${stringifySnippet(guideTipsResult, 800)}`);
    $.log(`${prefix}: jxzy_active_select(${tttId}) => ${stringifySnippet(selectResult, 800)}`);
  }
}

async function runAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;

  $.log(`\n==== ${prefix} ====`);

  const initialDrawResult = await drawBeanPopWindow(cookie);
  $.log(`${prefix}: 预检领取弹窗京豆 => ${stringifySnippet(initialDrawResult, 800)}`);
  if (hasSuccessfulDraw(initialDrawResult)) {
    return;
  }

  const firstQuery = await querySign(cookie);
  if (isDebugEnabled()) {
    $.log(`${prefix}: querySign(首次) => ${stringifySnippet(firstQuery, 1000)}`);
  }

  let signStatus = readSignStatus(firstQuery);
  await simulatePageEntry(cookie, prefix, DEFAULT_TTT_ID, { liteForm: false });

  if (signStatus === 1) {
    const signResult = await drawSign(cookie, readItemId(firstQuery));
    $.log(`${prefix}: 执行签到 => ${stringifySnippet(signResult, 800)}`);

    const secondQuery = await querySign(cookie);
    if (isDebugEnabled()) {
      $.log(`${prefix}: querySign(签到后) => ${stringifySnippet(secondQuery, 1000)}`);
    }
    signStatus = readSignStatus(secondQuery);
  } else if (signStatus === 2) {
    $.log(`${prefix}: 今日签到状态已完成，继续检查弹窗京豆奖励`);
  } else {
    $.log(`${prefix}: querySign 未识别签到状态 => ${stringifySnippet(firstQuery, 800)}`);
  }

  const popInfo = await getPopWindowInfo(cookie);
  if (isDebugEnabled()) {
    $.log(`${prefix}: getPopWindowInfo => ${stringifySnippet(popInfo, 1000)}`);
  }

  const taskInfo = readPopTask(popInfo);
  if (!taskInfo) {
    $.log(`${prefix}: 未从 getPopWindowInfo 拿到弹窗任务，尝试模拟首页进入后直接领取`);
  } else {
    const taskStatus = Number(taskInfo.taskStatus ?? -1);
    const beanCount = taskInfo.awardBeanNum || '';
    $.log(`${prefix}: 弹窗任务状态=${taskStatus} 奖励=${beanCount || '未知'}京豆`);

    if (taskStatus !== 10) {
      $.log(`${prefix}: 当前无需领取弹窗京豆`);
      return;
    }
  }

  await simulatePageEntry(cookie, prefix, DRAW_TTT_ID, { liteForm: true });
  await sleep(DRAW_WAIT_MS);

  let drawResult = await drawBeanPopWindow(cookie);
  $.log(`${prefix}: 领取弹窗京豆(首页重进后) => ${stringifySnippet(drawResult, 800)}`);

  if (hasSuccessfulDraw(drawResult)) {
    return;
  }

  if (Number(drawResult?.code ?? -1) === 1102 || String(drawResult?.msg || '').includes('无发奖任务')) {
    $.log(`${prefix}: 发奖任务还未挂载，补一次重进链路后重试`);
    await simulatePageEntry(cookie, prefix, DRAW_TTT_ID, { liteForm: true });
    await sleep(DRAW_WAIT_MS);
    drawResult = await drawBeanPopWindow(cookie);
    $.log(`${prefix}: 二次领取弹窗京豆 => ${stringifySnippet(drawResult, 800)}`);
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
