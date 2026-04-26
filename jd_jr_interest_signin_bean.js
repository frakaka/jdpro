/*
cron:13 0 * * * jd_jr_interest_signin_bean.js

环境变量说明：
1. JD_JR_INTEREST_DEBUG
   含义：是否输出接口原始响应片段，便于排查风控或字段变化。
   是否必须：否，默认不输出。
   如何覆盖：在青龙新增同名环境变量，值设为 1 / true / yes 即可开启。

HAR 对应说明：
1. 当前脚本对应页面：
   https://iu.jr.jd.com/insurance/channel/interest?showTab=1
2. 当前 HAR 中已验证可稳定闭环的奖励 POST 只有签到链：
   - queryActivity
   - signUpAndTake
3. 当前 HAR 未出现另一条已验证成功的“红包/超市卡领奖” POST 闭环，
   buildVisualizeData / batchGetTransLink 主要用于下发页面配置和跳转链接。
*/

'use strict';

const Module = require('module');
const got = require('got');
const FormData = require('form-data');
const jdCookieNode = require('./jdCookie.js');
const $ = new Env('天天领权益');

let notify = null;
let sharedUa = '';

try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

try {
  ({ USER_AGENT: sharedUa } = require('./USER_AGENTS'));
} catch (error) {
  sharedUa = '';
}

const PAGE_URL = 'https://iu.jr.jd.com/insurance/channel/interest?showTab=1';
const PAGE_ORIGIN = 'https://iu.jr.jd.com';
const BUILD_URL = 'https://ms.jr.jd.com/gw/generic/aladdin/h5/m/buildVisualizeData';
const QUERY_URL = 'https://ms.jr.jd.com/gw2/generic/jractivity/h5/m/queryActivity';
const EXECUTE_URL = 'https://ms.jr.jd.com/gw2/generic/jractivity/h5/m/rule/execute';
const AAR2_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/aar2.min.js';
const GIAS_SCRIPT_URL = 'https://gias.jd.com/js/m-tk.js';
const PAGE_KEY = 'M2Wq';
const BUILD_EXT_JSON = '{"riskInfo":{"appType":6}}';
const RISK_TIMEOUT_MS = 10000;
const CHINA_TIME_ZONE = 'Asia/Shanghai';
const USER_AGENT =
  sharedUa ||
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const cookies = Object.values(jdCookieNode).filter(Boolean);
const debugEnabled = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.JD_JR_INTEREST_DEBUG || '').trim().toLowerCase(),
);

let jsdomDeps = null;
let aar2ScriptPromise = null;
let giasScriptPromise = null;

function Env(name) {
  return {
    name,
    startTime: Date.now(),
    log(...messages) {
      console.log(messages.join('\n'));
    },
    done() {
      const seconds = ((Date.now() - this.startTime) / 1000).toFixed(3);
      this.log('', `🔔${this.name}, 结束! 🕛 ${seconds} 秒`, '');
    },
  };
}

$.log('', `🔔${$.name}, 开始!`);

function getUserName(cookie) {
  const match = cookie.match(/pt_pin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '未知账号';
}

function parseCookieString(cookie) {
  const cookieMap = new Map();
  const items = String(cookie || '').split(';');

  for (const item of items) {
    const pair = item.trim();
    if (!pair) {
      continue;
    }

    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    cookieMap.set(key, value);
  }

  return cookieMap;
}

function stringifyCookieMap(cookieMap) {
  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function mergeCookieString(baseCookie, extraCookieValues) {
  const cookieMap = parseCookieString(baseCookie);
  for (const [key, value] of Object.entries(extraCookieValues || {})) {
    if (value) {
      cookieMap.set(key, value);
    }
  }
  return stringifyCookieMap(cookieMap);
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function stringifyForLog(data) {
  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch (error) {
    return String(data);
  }
}

function loadJsdomDependencies() {
  if (jsdomDeps) {
    return jsdomDeps;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'canvas') {
      return {};
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    jsdomDeps = require('jsdom');
    return jsdomDeps;
  } finally {
    Module._load = originalLoad;
  }
}

function patchRiskWindow(window) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: USER_AGENT,
  });
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'iPhone',
  });
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: 'zh-CN',
  });
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: ['zh-CN', 'zh'],
  });
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(window.navigator, 'plugins', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(window.navigator, 'mimeTypes', {
    configurable: true,
    value: [],
  });
  Object.defineProperty(window.screen, 'width', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'height', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.screen, 'availWidth', {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.screen, 'availHeight', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window.screen, 'colorDepth', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value() {
      return 'data:image/png;base64,AA==';
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value() {
      return {
        fillRect() {},
        fillText() {},
        beginPath() {},
        arc() {},
        closePath() {},
        fill() {},
        stroke() {},
        measureText() {
          return { width: 10 };
        },
        getImageData() {
          return { data: new Uint8ClampedArray(16) };
        },
        getParameter() {
          return 1;
        },
        getExtension() {
          return null;
        },
        createBuffer() {
          return {};
        },
        bindBuffer() {},
        bufferData() {},
        createProgram() {
          return {};
        },
        createShader() {
          return {};
        },
        shaderSource() {},
        compileShader() {},
        attachShader() {},
        linkProgram() {},
        useProgram() {},
        getAttribLocation() {
          return 0;
        },
        getUniformLocation() {
          return {};
        },
        enableVertexAttribArray() {},
        vertexAttribPointer() {},
        uniform2f() {},
        drawArrays() {},
        canvas: {
          toDataURL() {
            return 'data:image/png;base64,AA==';
          },
        },
      };
    },
  });
  window.console = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  window.bp_bizid = 'jdbxqypd';
}

function getAar2Script() {
  if (!aar2ScriptPromise) {
    aar2ScriptPromise = got
      .get(AAR2_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: PAGE_URL,
        },
        timeout: {
          request: 10000,
        },
      })
      .text();
  }

  return aar2ScriptPromise;
}

function getGiasScript() {
  if (!giasScriptPromise) {
    giasScriptPromise = got
      .get(GIAS_SCRIPT_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: PAGE_URL,
        },
        timeout: {
          request: 10000,
        },
      })
      .text();
  }

  return giasScriptPromise;
}

async function createRiskContext(cookie) {
  const { JSDOM, VirtualConsole } = loadJsdomDependencies();
  const [aar2Script, giasScript] = await Promise.all([getAar2Script(), getGiasScript()]);
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: PAGE_URL,
    referrer: PAGE_URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    resources: 'usable',
    virtualConsole,
  });

  try {
    const { window } = dom;
    patchRiskWindow(window);

    const sourceCookieMap = parseCookieString(cookie);
    for (const [key, value] of sourceCookieMap.entries()) {
      window.document.cookie = `${key}=${value}; path=/`;
    }

    window.eval(aar2Script);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AAR2 初始化超时')), RISK_TIMEOUT_MS);
      window.AAR2.init({
        callback() {
          clearTimeout(timer);
          resolve();
        },
      });
    });

    window.eval(giasScript);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gias 获取 jsToken 超时')), RISK_TIMEOUT_MS);
      window.getJsToken(() => {
        clearTimeout(timer);
        resolve();
      }, RISK_TIMEOUT_MS);
    });

    const deviceInfo = window.getJdEid();
    if (!deviceInfo?.fp) {
      throw new Error(`getJdEid 结果异常: ${stringifyForLog(deviceInfo).slice(0, 300)}`);
    }

    const mergedCookie = mergeCookieString(
      cookie,
      Object.fromEntries(parseCookieString(window.document.cookie)),
    );

    return {
      dom,
      window,
      deviceInfo,
      cookie: mergedCookie,
    };
  } catch (error) {
    dom.window.close();
    throw error;
  }
}

function buildCommonHeaders(cookie) {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: PAGE_ORIGIN,
    Referer: PAGE_URL,
    'User-Agent': USER_AGENT,
  };
}

async function fetchSignFloorConfig(cookie) {
  const response = await got
    .post(BUILD_URL, {
      json: {
        buildCodes: ['common'],
        engineType: 1,
        pageIdStr: PAGE_KEY,
        extJson: BUILD_EXT_JSON,
      },
      headers: {
        ...buildCommonHeaders(cookie),
        'Content-Type': 'application/json',
      },
      timeout: {
        request: 15000,
      },
    })
    .json();

  const pageData = response?.resultData?.data;
  const signFloor = (pageData?.children || []).find((item) => item?.sceneType === 'sign');
  const contentModel = signFloor?.data?.comModel?.contentModel;

  if (!pageData || !signFloor || !contentModel?.trackCfg?.trackDataSign) {
    throw new Error(`未获取到天天领权益签到楼层: ${stringifyForLog(response).slice(0, 600)}`);
  }

  return {
    pageId: String(safeJsonParse(contentModel.trackCfg.trackDataSign.paramJson)?.ogel?.extend?.pageId || ''),
    floorId: signFloor.id,
    contentModel,
    trackDataSign: contentModel.trackCfg.trackDataSign,
    trackDataPatch: contentModel.trackCfg.trackDataPatch,
  };
}

function buildRiskMap(trackData) {
  return {
    pageUrl: PAGE_URL,
    qdPageId: trackData?.paid,
    mdClickId: trackData?.cls,
  };
}

function createReqForm(payload) {
  const form = new FormData();
  form.append('reqData', JSON.stringify(payload));
  return form;
}

async function postActivityForm(url, cookie, form) {
  return got
    .post(url, {
      body: form,
      headers: {
        ...buildCommonHeaders(cookie),
        ...form.getHeaders(),
      },
      timeout: {
        request: 15000,
      },
    })
    .json();
}

function isTransportSuccess(response) {
  return Number(response?.resultCode) === 0 && response?.resultData?.code === '00000';
}

function getBusinessNode(response) {
  return response?.resultData?.data || {};
}

function getCurrentDayInfo(activityData) {
  const dayBuckets = [];
  const currentDayDate = Number(activityData?.currentDayDate) || getChinaMidnightTs();

  if (Array.isArray(activityData?.weekActivityInfoList)) {
    for (const weekInfo of activityData.weekActivityInfoList) {
      if (Array.isArray(weekInfo?.dayActivityInfoList)) {
        dayBuckets.push(...weekInfo.dayActivityInfoList);
      }
    }
  }

  if (Array.isArray(activityData?.periodActivityInfo?.dayActivityInfoList)) {
    dayBuckets.push(...activityData.periodActivityInfo.dayActivityInfoList);
  }

  if (!dayBuckets.length) {
    return null;
  }

  return (
    dayBuckets.find((item) => Number(item?.dayDate) === currentDayDate) ||
    dayBuckets.find((item) => Number(item?.dayDate) === getChinaMidnightTs()) ||
    dayBuckets[0]
  );
}

function getChinaMidnightTs() {
  const now = new Date();
  const chinaDateText = now.toLocaleString('en-CA', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return new Date(`${chinaDateText}T00:00:00+08:00`).getTime();
}

function formatDay(dayDate) {
  if (!dayDate) {
    return '未知日期';
  }

  return new Date(dayDate).toLocaleDateString('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getAwardSummary(dayInfo, fallbackAwardName) {
  const award = Array.isArray(dayInfo?.signAwardInfoList) ? dayInfo.signAwardInfoList[0] : null;
  const count = award?.awardNum ?? dayInfo?.awardCount ?? '';
  const unit = award?.awardUnit || '';
  const name = award?.awardName || dayInfo?.awardName || fallbackAwardName || '';
  return {
    count,
    name,
    unit,
    text: `${count !== '' ? count : ''}${unit}${name}`.trim(),
  };
}

function stringifyDebugSnippet(data) {
  return stringifyForLog(data).slice(0, 800);
}

async function querySignInfo(floorConfig, riskContext) {
  const form = createReqForm({
    relationId: floorConfig.floorId,
    relationType: 3,
    ruleAliasCode: 'queryActivity',
    contextParams: {
      request: {
        riskMap: buildRiskMap(floorConfig.trackDataSign),
        deviceInfo: riskContext.deviceInfo,
      },
    },
  });

  return postActivityForm(QUERY_URL, riskContext.cookie, form);
}

async function doSign(floorConfig, riskContext) {
  const aar2 = new riskContext.window.AAR2();
  const nonce = aar2.nonce();
  const activityId = safeJsonParse(floorConfig.trackDataSign?.paramJson)?.ogel?.appSourceId || '';
  const signPayload = {
    relationId: floorConfig.floorId,
    relationType: 3,
    ruleAliasCode: 'signUpAndTake',
    contextParams: {
      request: {
        extMap: {
          actReport: JSON.stringify({
            activityId,
            pageId: floorConfig.pageId,
            relationId: floorConfig.floorId,
          }),
        },
        riskMap: buildRiskMap(floorConfig.trackDataSign),
        deviceInfo: riskContext.deviceInfo,
      },
    },
  };

  const form = createReqForm({
    antiRushFlag: '1',
    domain: 'iu.jr.jd.com',
    uri: '/insurance/channel/interest?showTab=1',
    nonce,
    signature: aar2.sign(JSON.stringify(signPayload), nonce),
    signData: JSON.stringify(signPayload),
  });

  return postActivityForm(EXECUTE_URL, riskContext.cookie, form);
}

async function runAccount(index, cookie) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  let riskContext = null;

  try {
    console.log(`\n==== ${prefix} ====`);
    riskContext = await createRiskContext(cookie);
    const floorConfig = await fetchSignFloorConfig(riskContext.cookie);
    const queryResponse = await querySignInfo(floorConfig, riskContext);

    if (debugEnabled) {
      console.log(`${prefix}: queryActivity 原始返回 => ${stringifyDebugSnippet(queryResponse)}`);
    }

    if (!isTransportSuccess(queryResponse)) {
      throw new Error(`queryActivity 失败: ${stringifyDebugSnippet(queryResponse)}`);
    }

    const queryNode = getBusinessNode(queryResponse);
    if (queryNode.code === '0006') {
      console.log(`${prefix}: Cookie 已失效或未登录`);
      return `${prefix}: Cookie 已失效`;
    }

    if (queryNode.code !== '0000') {
      throw new Error(`queryActivity 业务异常: ${queryNode.code || 'unknown'} ${queryNode.desc || ''}`.trim());
    }

    const currentDay = getCurrentDayInfo(queryNode.data);
    if (!currentDay) {
      throw new Error(`未找到今日签到信息: ${stringifyDebugSnippet(queryResponse)}`);
    }

    const plannedAward = getAwardSummary(currentDay, queryNode.data?.awardName);
    console.log(
      `${prefix}: 今日状态 => ${formatDay(currentDay.dayDate)} signed=${currentDay.signed ? 1 : 0} reward=${plannedAward.text || '未知奖励'}`,
    );

    if (currentDay.signed) {
      console.log(`${prefix}: 今日已签到`);
      return `${prefix}: 今日已签到，奖励 ${plannedAward.text || '已发放'}`;
    }

    const signResponse = await doSign(floorConfig, riskContext);
    if (debugEnabled) {
      console.log(`${prefix}: signUpAndTake 原始返回 => ${stringifyDebugSnippet(signResponse)}`);
    }

    if (!isTransportSuccess(signResponse)) {
      throw new Error(`signUpAndTake 失败: ${stringifyDebugSnippet(signResponse)}`);
    }

    const signNode = getBusinessNode(signResponse);
    if (signNode.code !== '0000') {
      if (signNode.code === '0006') {
        console.log(`${prefix}: 执行签到时 Cookie 已失效`);
        return `${prefix}: 执行签到时 Cookie 已失效`;
      }
      throw new Error(`signUpAndTake 业务异常: ${signNode.code || 'unknown'} ${signNode.desc || ''}`.trim());
    }

    const signAward = getAwardSummary(signNode.data, queryNode.data?.awardName);
    console.log(`${prefix}: 签到成功，获得 ${signAward.text || '奖励'}`);

    const verifyResponse = await querySignInfo(floorConfig, riskContext);
    if (debugEnabled) {
      console.log(`${prefix}: 复查 queryActivity 原始返回 => ${stringifyDebugSnippet(verifyResponse)}`);
    }

    if (!isTransportSuccess(verifyResponse)) {
      throw new Error(`复查 queryActivity 失败: ${stringifyDebugSnippet(verifyResponse)}`);
    }

    const verifyNode = getBusinessNode(verifyResponse);
    const verifyDay = getCurrentDayInfo(verifyNode.data);
    console.log(
      `${prefix}: 复查状态 => signed=${verifyDay?.signed ? 1 : 0} reward=${
        getAwardSummary(verifyDay, verifyNode.data?.awardName).text || signAward.text || '未知奖励'
      }`,
    );

    return `${prefix}: 签到成功，获得 ${signAward.text || '奖励'}`;
  } catch (error) {
    console.log(`${prefix}: ${error.message}`);
    return `${prefix}: ${error.message}`;
  } finally {
    if (riskContext?.dom) {
      riskContext.dom.window.close();
    }
  }
}

async function main() {
  if (!cookies.length) {
    console.log('未获取到有效 JD Cookie');
    return;
  }

  const messages = [];
  for (let index = 0; index < cookies.length; index += 1) {
    const result = await runAccount(index + 1, cookies[index]);
    messages.push(result);
  }

  if (notify) {
    await notify.sendNotify($.name, messages.join('\n'));
  }
}

main()
  .catch((error) => {
    console.log(`${$.name}: ${error.stack || error.message}`);
  })
  .finally(() => {
    $.done();
  });
