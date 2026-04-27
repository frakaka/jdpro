/*
cron:46 0 * * * jd_jr_fishing_sign_full.js

环境变量说明：
1. JDJR_FISHING_FULL_COOKIE
   含义：可选的捕鱼活动完整 Cookie，会合并到 JD_COOKIE 上。
   是否必须：否，但只有 pt_key/pt_pin 时建议补充。

2. JDJR_FISHING_SDK_TOKEN
   含义：捕鱼活动 reqData.deviceInfo.sdkToken。
   是否必须：否，默认使用当前 HAR 样本值。

3. JDJR_FISHING_FP
   含义：捕鱼活动 reqData.deviceInfo.fp。
   是否必须：否，默认使用当前 HAR 样本值。

4. JDJR_FISHING_TOKEN
   含义：loading/viewTask/calendar/queryEnduranceChance 请求里的 deviceInfo.token。
   是否必须：否，默认使用当前 HAR 样本值。

5. JDJR_FISHING_JSTUB
   含义：loading/viewTask/calendar/queryEnduranceChance 请求里的 deviceInfo.jstub。
   是否必须：否，默认使用当前 HAR 样本值。

6. JDJR_FISHING_DEBUG
   含义：是否打印关键接口原始响应片段，便于排查字段变化。
   是否必须：否，值为 1 时开启。

HAR 结论：
1. 当前 filtered HAR 里，能直接领京豆的 POST 主链是：
   - mkWeapons/loading
   - mkWeapons/calendar
   - mkWeapons/sign
2. calendar.current.awardList 会返回当天签到奖励，本包样本为 2 个京豆。
3. viewTask 里还能看到成长阶段京豆奖励和捕鱼任务，但当前 HAR 未出现对应领奖接口闭环。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_JR_USER_AGENT,
  buildHeaders,
  getGiasRiskContext,
  getUserName,
  mergeCookieString,
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('京东金融捕鱼签到领京豆');

const PAGE_URL =
  'https://u.jr.jd.com/uc-fe-wxgrowing/catch-fish/index/?jdjrOrientation=landscape&jrcontainer=h5&jrlogin=true&channel=syjingang';
const PAGE_ENTRY_URL = 'https://u.jr.jd.com/uc-fe-wxgrowing/catch-fish/index/';
const PAGE_ORIGIN = 'https://u.jr.jd.com';
const PAGE_REFERER = PAGE_URL;
const LOADING_URL = 'https://ms.jr.jd.com/gw2/generic/mkWeapons/h5/m/loading';
const CALENDAR_URL = 'https://ms.jr.jd.com/gw2/generic/mkWeapons/h5/m/calendar';
const VIEW_TASK_URL = 'https://ms.jr.jd.com/gw2/generic/mkWeapons/h5/m/viewTask';
const SIGN_URL = 'https://ms.jr.jd.com/gw2/generic/mkWeapons/h5/m/sign';
const ENDURANCE_URL = 'https://ms.jr.jd.com/gw2/generic/mkWeapons/h5/m/queryEnduranceChance';

const DEFAULT_FP = '7c797211f76355031663f6372ab27c12';
const DEFAULT_SDK_TOKEN =
  'jdd01QI7EZRAXIOPWEC2HOEN3UYK5JXTMS3K4NRSL4LRCKRSM3M2NSXCRRVYC4VCZKF64Z2VSR6OF6LGOD5G7LTJ2O4PJR5PTFO7WN3OAOOI01234567';
const DEFAULT_TOKEN = 'IQUMWSIRPEGS2FK3JVZLUD5AGOECKVMWLPGPN4XY576TXZDZJVRNYCJJ34YTTD4AWBEHE34KLQHDE';
const DEFAULT_JSTUB = 'LBSLVRUFRYNOQALR4OMLF5DVCAAWLKCV47B2QMCZ7LPLE7ODQE6ZI7HGSIGRK4AAXEU5ZKNKFYH3LZVNJJ3MEQFIQJZAHIEEUDVA65Y';
const CLIENT_VERSION = '8.1.70';
const CHANNEL = 'syjingang';
const QD_PAGE_ID = '8MQB';
const MD_CLICK_ID = '8MQB|137268';
const REQUEST_TIMEOUT_MS = 15000;

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_FISHING_DEBUG === '1';
}

function getCookieValue(cookie, key) {
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]*)`);
  const match = String(cookie || '').match(pattern);
  return match ? decodeURIComponent(match[1]) : '';
}

function buildPostHeaders(cookie) {
  return buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: DEFAULT_JR_USER_AGENT,
    extraHeaders: {
      Accept: 'application/json, text/plain, */*',
    },
  });
}

function stringifyDeviceInfo(deviceInfo) {
  return JSON.stringify(deviceInfo);
}

async function createRiskContext(cookie) {
  const cookieToken = getCookieValue(cookie, '3AB9D23F7A4B3CSS');
  const cookieEid = getCookieValue(cookie, '3AB9D23F7A4B3C9B');
  const cookieFp = getCookieValue(cookie, 'jrmfp') || getCookieValue(cookie, 'fp');
  const cookieSdkToken = getCookieValue(cookie, 'jrmfs') || getCookieValue(cookie, 'sdkToken');

  try {
    const risk = await getGiasRiskContext(cookie, {
      pageUrl: PAGE_URL,
      bizId: 'u',
      userAgent: DEFAULT_JR_USER_AGENT,
    });

    return {
      cookie: risk.cookie || cookie,
      jsToken: risk.jsToken || cookieToken,
      eid: risk.equipmentId || cookieEid,
      fp: cookieFp || process.env.JDJR_FISHING_FP || DEFAULT_FP,
      sdkToken: cookieSdkToken || process.env.JDJR_FISHING_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    };
  } catch (error) {
    return {
      cookie,
      jsToken: cookieToken || '',
      eid: cookieEid || '',
      fp: cookieFp || process.env.JDJR_FISHING_FP || DEFAULT_FP,
      sdkToken: cookieSdkToken || process.env.JDJR_FISHING_SDK_TOKEN || DEFAULT_SDK_TOKEN,
      giasError: error.message,
    };
  }
}

function createFullDeviceInfo(riskContext) {
  return {
    eid: riskContext.eid || '',
    fp: riskContext.fp || process.env.JDJR_FISHING_FP || DEFAULT_FP,
    sdkToken: riskContext.sdkToken || process.env.JDJR_FISHING_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    token: process.env.JDJR_FISHING_TOKEN || DEFAULT_TOKEN,
    jstub: process.env.JDJR_FISHING_JSTUB || DEFAULT_JSTUB,
    os: 'ios',
    osv: '26.2',
  };
}

function createSignDeviceInfo(riskContext) {
  return {
    undefined: '',
    fp: riskContext.fp || process.env.JDJR_FISHING_FP || DEFAULT_FP,
    sdkToken: riskContext.sdkToken || process.env.JDJR_FISHING_SDK_TOKEN || DEFAULT_SDK_TOKEN,
    eid: riskContext.eid || '',
    os: 'ios',
    osv: '26.2',
  };
}

async function postReqData(url, cookie, payload) {
  const form = new URLSearchParams();
  form.set('reqData', JSON.stringify(payload));

  const response = await got.post(url, {
    body: form.toString(),
    headers: buildPostHeaders(cookie),
    throwHttpErrors: false,
    timeout: {
      request: REQUEST_TIMEOUT_MS,
    },
  });

  const text = response.body || '';
  return text ? safeJsonParse(text, text) : {};
}

async function queryLoading(cookie, riskContext) {
  return postReqData(LOADING_URL, cookie, {
    clientType: 'jdjr',
    clientVersion: CLIENT_VERSION,
    station: 1,
    deviceInfo: stringifyDeviceInfo(createFullDeviceInfo(riskContext)),
    parameters: {
      pageUrl: PAGE_ENTRY_URL,
      urlKey: PAGE_ENTRY_URL,
      qdPageId: QD_PAGE_ID,
      mdClickId: MD_CLICK_ID,
    },
    channel: CHANNEL,
  });
}

async function queryCalendar(cookie, riskContext) {
  return postReqData(CALENDAR_URL, cookie, {
    clientType: 'jdjr',
    clientVersion: CLIENT_VERSION,
    deviceInfo: stringifyDeviceInfo(createFullDeviceInfo(riskContext)),
  });
}

async function queryViewTask(cookie, riskContext) {
  return postReqData(VIEW_TASK_URL, cookie, {
    clientType: 'jdjr',
    clientVersion: CLIENT_VERSION,
    deviceInfo: stringifyDeviceInfo(createFullDeviceInfo(riskContext)),
  });
}

async function queryEnduranceChance(cookie, riskContext) {
  return postReqData(ENDURANCE_URL, cookie, {
    clientType: 'jdjr',
    clientVersion: CLIENT_VERSION,
    deviceInfo: stringifyDeviceInfo(createFullDeviceInfo(riskContext)),
  });
}

async function doSign(cookie, riskContext) {
  return postReqData(SIGN_URL, cookie, {
    clientType: 'jdjr',
    clientVersion: CLIENT_VERSION,
    deviceInfo: stringifyDeviceInfo(createSignDeviceInfo(riskContext)),
  });
}

function isMkWeaponsSuccess(response) {
  return (
    Number(response?.resultCode) === 0 &&
    String(response?.resultData?.code || '') === '0000'
  );
}

function formatAwardList(awardList) {
  if (!Array.isArray(awardList) || !awardList.length) {
    return '-';
  }

  return awardList
    .map((item) => {
      const name = item?.name || item?.awardName || item?.type || '奖励';
      const amount = item?.amount ?? item?.num ?? '';
      return `${amount}${name}`;
    })
    .join(' + ');
}

function formatCalendarState(calendarData) {
  const current = calendarData?.current || {};
  return `signNo=${current.signNo ?? '-'} | signed=${current.signYn ? 1 : 0} | reward=${formatAwardList(
    current.awardList
  )}`;
}

function formatActivationList(viewTaskData) {
  const activationList = Array.isArray(viewTaskData?.activationList)
    ? viewTaskData.activationList
    : [];
  if (!activationList.length) {
    return '-';
  }

  return activationList
    .map((item) => `${item.level}:${item.awardName}${item.takeYn ? '(已领)' : '(未领)'}`)
    .join(' | ');
}

function formatGameTaskList(viewTaskData) {
  const taskList = Array.isArray(viewTaskData?.taskList) ? viewTaskData.taskList : [];
  if (!taskList.length) {
    return '-';
  }

  return taskList
    .slice(0, 8)
    .map((item) => {
      const reward = Array.isArray(item.awardList)
        ? item.awardList.map((award) => `${award.amount}${award.type}`).join('+')
        : '-';
      return `${item.name} ${item.currentValue}/${item.targetValue} reward=${reward}`;
    })
    .join(' | ');
}

async function runAccount(index, cookie) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  const mergedCookie = process.env.JDJR_FISHING_FULL_COOKIE
    ? mergeCookieString(cookie, process.env.JDJR_FISHING_FULL_COOKIE)
    : cookie;

  try {
    console.log(`\n==== ${prefix} ====`);
    const riskContext = await createRiskContext(mergedCookie);
    if (riskContext.giasError) {
      console.log(`${prefix}: gias 获取失败，回退 Cookie 风控态 => ${riskContext.giasError}`);
    }

    const loading = await queryLoading(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: loading 原始返回 => ${stringifySnippet(loading, 800)}`);
    }
    if (!isMkWeaponsSuccess(loading)) {
      throw new Error(`loading 失败: ${stringifySnippet(loading, 600)}`);
    }
    const loadingData = loading?.resultData?.data || {};
    console.log(
      `${prefix}: 场景=${loadingData.sceneType || '-'} | 今日首次=${loadingData.todayFirstYn ? 1 : 0} | 兑换入口=${loadingData.exchangeFlag ? 1 : 0}`
    );

    const beforeCalendar = await queryCalendar(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: calendar(签到前) 原始返回 => ${stringifySnippet(beforeCalendar, 800)}`);
    }
    if (!isMkWeaponsSuccess(beforeCalendar)) {
      throw new Error(`calendar(签到前) 失败: ${stringifySnippet(beforeCalendar, 600)}`);
    }
    const beforeCalendarData = beforeCalendar?.resultData?.data || {};
    console.log(`${prefix}: 今日签到状态 => ${formatCalendarState(beforeCalendarData)}`);

    const viewTask = await queryViewTask(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: viewTask 原始返回 => ${stringifySnippet(viewTask, 800)}`);
    }
    if (!isMkWeaponsSuccess(viewTask)) {
      throw new Error(`viewTask 失败: ${stringifySnippet(viewTask, 600)}`);
    }
    const viewTaskData = viewTask?.resultData?.data || {};
    console.log(`${prefix}: 成长阶段京豆 => ${formatActivationList(viewTaskData)}`);
    console.log(`${prefix}: 捕鱼任务摘要 => ${formatGameTaskList(viewTaskData)}`);

    const endurance = await queryEnduranceChance(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: queryEnduranceChance 原始返回 => ${stringifySnippet(endurance, 600)}`);
    }
    if (isMkWeaponsSuccess(endurance)) {
      const enduranceData = endurance?.resultData?.data || {};
      console.log(
        `${prefix}: 续航次数 => ${enduranceData.dailyEnduranceTimes ?? '-'} / ${enduranceData.dailyEnduranceLimit ?? '-'}`
      );
    }

    if (beforeCalendarData?.current?.signYn) {
      console.log(`${prefix}: 今日已签到`);
      return;
    }

    const signResult = await doSign(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: sign 原始返回 => ${stringifySnippet(signResult, 800)}`);
    }
    if (!isMkWeaponsSuccess(signResult)) {
      throw new Error(`sign 失败: ${stringifySnippet(signResult, 600)}`);
    }
    console.log(`${prefix}: 执行签到成功`);

    const afterCalendar = await queryCalendar(riskContext.cookie, riskContext);
    if (isDebugEnabled()) {
      console.log(`${prefix}: calendar(签到后) 原始返回 => ${stringifySnippet(afterCalendar, 800)}`);
    }
    if (!isMkWeaponsSuccess(afterCalendar)) {
      throw new Error(`calendar(签到后) 失败: ${stringifySnippet(afterCalendar, 600)}`);
    }
    const afterCalendarData = afterCalendar?.resultData?.data || {};
    console.log(`${prefix}: 签到后状态 => ${formatCalendarState(afterCalendarData)}`);
  } catch (error) {
    console.log(`${prefix}: ${error.message}`);
  }
}

(async () => {
  if (!cookies.length) {
    console.log('未找到有效的 JD Cookie');
    $.done();
    return;
  }

  console.log(`共${cookies.length}个京东账号Cookie`);
  for (let index = 0; index < cookies.length; index += 1) {
    await runAccount(index + 1, cookies[index]);
  }
  $.done();
})()
  .catch((error) => {
    console.log(error.message);
  })
  .finally(() => {
    $.done();
  });
