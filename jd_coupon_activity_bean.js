/*
cron:9 0 * * * jd_coupon_activity_bean.js
//TODO 领券中心， 二次从首页进入抽奖， 还未调通

环境变量说明：
1. JD_COUPON_ACTIVITY_EID_TOKEN
   含义：频道活动接口表单里的 x-api-eid-token。
   是否必须：否，默认优先使用动态 gias 风控值；只有你显式配置环境变量时，才会使用环境变量覆盖。
   如何覆盖：在青龙新增同名环境变量，值填最新抓包里的 x-api-eid-token。

2. JD_COUPON_ACTIVITY_CHANNEL_ID
   含义：活动 channelId。
   是否必须：否，默认 10。
   如何覆盖：在青龙新增同名环境变量即可。

3. JD_COUPON_ACTIVITY_ASSIGNMENT_ID
   含义：浏览领豆任务的 assignmentId。
   是否必须：否，默认使用当前 HAR 中抓到的值。
   如何覆盖：在青龙新增同名环境变量，值填最新抓包里的 assignmentId。

4. JD_COUPON_ACTIVITY_ITEM_ID
   含义：浏览任务 itemId。
   是否必须：否，默认 1。
   如何覆盖：在青龙新增同名环境变量即可。

5. JD_COUPON_ACTIVITY_START_BABEL_CHANNEL / JD_COUPON_ACTIVITY_RECEIVE_BABEL_CHANNEL
   含义：开始浏览、领取奖励时使用的 babelChannel。
   是否必须：否，默认分别为 ttt6、ttt46。
   如何覆盖：在青龙新增同名环境变量即可。

6. JD_COUPON_ACTIVITY_DEBUG
   含义：是否打印接口原始返回片段，便于排查活动变更。
   是否必须：否，配置为 1 时开启。

7. JD_COUPON_ACTIVITY_FULL_COOKIE
   含义：活动页抓包里的完整 Cookie，用于补齐 joyytokem、sdtoken、3AB9D23F7A4B3CSS 等上下文。
   是否必须：否，默认使用当前 HAR 中抓到的一组模板 Cookie。
   如何覆盖：在青龙新增同名环境变量，值填同一账号最新活动抓包 Cookie。
*/

'use strict';

const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  buildHeaders,
  createH5st,
  getGiasRiskContext,
  getRequestUuid,
  getUserName,
  mergeCookieString,
  parseApiResponse,
  sleep,
  stringifySnippet,
} = require('./function/jdHarBeanCommon.js');

const $ = new Env('领券中心首页浏览');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const API_ENDPOINT = 'https://api.m.jd.com/';
const REQUEST_APP_ID = 'coupon-activity';
const H5ST_APP_ID = '8ba11';
const COMPONENT_ENDPOINT = 'https://api.m.jd.com/client.action';
const COMPONENT_REQUEST_APP_ID = 'day_day_reward';
const COMPONENT_LOAD_H5ST_APP_ID = 'ec373';
const COMPONENT_INTERACT_H5ST_APP_ID = '93453';
const COMPONENT_LOGIN_WQ_BIZ = 'tttwxapp';
const DEFAULT_AREA = '18_1482_3606_60000';
const DEFAULT_CLIENT = 'apple';
const DEFAULT_CLIENT_VERSION = '15.6.50';
const DEFAULT_OS_VERSION = '26.2';
const DEFAULT_MODEL = 'iPhone14,5';
const DEFAULT_CHANNEL_ID = '10';
const DEFAULT_ASSIGNMENT_ID = 'AadYw85UDqzo8LFd9CnrQ5x5zqG';
const DEFAULT_ITEM_ID = '1';
const DEFAULT_START_BABEL_CHANNEL = 'ttt6';
const DEFAULT_RECEIVE_BABEL_CHANNEL = 'ttt46';
const DEFAULT_COMPONENT_SDK_TOKEN = 'jdd01E5LP2BTVI3IU24JLRJXLJW3BIEAIJOPDDYW7XGBGACTBETRPIL246GVV3HP6HUQZATORZTFNCNEZLIMUYIACXLAQTAJ22GJ34G5OJTI01234567';
const DEFAULT_COMPONENT_REWARD_RECEIVE_KEY = 'eaaa902242512058a8053f5e9c1952f3c27f5d4668f7f2ab795cd905cfd3e9a715aa7a1f66b87af538160a33ce7fe30945d3fe6f81100110ef331be3b8e84ab178cc57e5caee6b5e9d3a1dba885c88a349504f6b2fdcdb2c';
const DEFAULT_COMPONENT_TOKEN = 'pVQSJCqPp3oXPfH9Y28Tv';
const DEFAULT_COMPONENT_ACT_KEY = 'pik0m7v23wrm42xzgzekz';
const DEFAULT_COMPONENT_OPEN_CHANNEL = 'jdAppHome';
const DEFAULT_COMPONENT_SUB_LABEL = '';
const DEFAULT_COMPONENT_UBB_LOC = 'ttf.lqzx';
const START_REFERER_URL = 'https://prodev.m.jd.com/mall/active/VAjs3vpayA513UwxL5XC4eGBXqY/index.html?stath=47&navh=44&uAdSrc=1&utm_source=lianmeng__8__kong__kong&babelChannel=ttt6&utm_term=ea800ab7b9e7b5eea2f24b9d62508181&utm_medium=jingfen&uabt=817_10903_1_0&utm_campaign=t_1000441370_&ufc=0_0_1-14-273-2937_1776869348433_0-0__078uICX9AetWr3XDAyKM5IB&cu=true&tttparams=JY96wTiVeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZF9icmFuZCI6ImFwcGxlIiwiZ0xuZyI6IjExMy4wMzcwMiIsInVlbXBzIjoiMC0yLTAiLCJnTGF0IjoiMjguMjEwMzE5IiwibG5nIjoiMTEzLjAzNzQ0OSIsIm9yaWVudCI6InAiLCJvcyI6IjI2LjIiLCJsYnNMYXQiOiIyOC4yMTAzMTkiLCJsYnNMbmciOiIxMTMuMDM3MDIiLCJwcnN0YXRlIjoiMCIsImdwc19hcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwic2NhbGUiOiIzIiwiYWRkcmVzc0lkIjoiMTUxNTIyMDA5OCIsInVuX2FyZWEiOiIxOF8xNDgyXzM2MDZfNjAwMDAiLCJ3aWR0aCI6IjExNzAiLCJsYnNBcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwibGF0IjoiMjguMjEwNDI4IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwiY29ybmVyIjoxLCJhcmVhQ29kZSI6IjAiLCJwb3NMYXQiOiIyOC4yMTAzMTkiLCJkbCI6MX80=&forceCurrentView=1';
const RECEIVE_REFERER_URL = 'https://pro.m.jd.com/mall/active/VAjs3vpayA513UwxL5XC4eGBXqY/index.html?stath=47&navh=44&mTabId=2LcucMHYX7aXz92Qh7JBHBo6DACH&topOfHomePage=1&babelChannel=ttt46&embedMTab=1&visitScene=shouyezhudong&tttparams=JiOjNm5MeyJyZnMiOiIwMDAwIiwicG9zTG5nIjoiMTEzLjAzNzAyIiwiZGwiOjEsImRfYnJhbmQiOiJhcHBsZSIsImdMbmciOiIxMTMuMDM3MDIiLCJ1ZW1wcyI6IjAtMi0wIiwiZ0xhdCI6IjI4LjIxMDMxOSIsImxuZyI6IjExMy4wMzc0NDkiLCJvcmllbnQiOiJwIiwib3MiOiIyNi4yIiwibGJzTGF0IjoiMjguMjEwMzE5IiwibGJzTG5nIjoiMTEzLjAzNzAyIiwicHJzdGF0ZSI6IjAiLCJncHNfYXJlYSI6IjE4XzE0ODJfMzYwNl82MDAwMCIsInNjYWxlIjoiMyIsImFkZHJlc3NJZCI6IjE1MTUyMjAwOTgiLCJ1bl9hcmVhIjoiMThfMTQ4Ml8zNjA2XzYwMDAwIiwickxuZyI6IjExMy4wMzcwMiIsIndpZHRoIjoiMTE3MCIsImxic0FyZWEiOiIxOF8xNDgyXzM2MDZfNjAwMDAiLCJyTGF0IjoiMjguMjEwMzE5IiwibGF0IjoiMjguMjEwNDI4IiwibW9kZWwiOiJpUGhvbmUxNCw1IiwicG9zTGF0IjoiMjguMjEwMzE5IiwiYXJlYUNvZGUiOiIwIiwiY29ybmVyIjoxfQ8%3D%3D&linkTabId=ed6ac10204357d124ab6d1daa2cdd5a3';
const START_PAGE_URL = 'https://prodev.m.jd.com/mall/active/VAjs3vpayA513UwxL5XC4eGBXqY/index.html';
const RECEIVE_PAGE_URL = 'https://pro.m.jd.com/mall/active/VAjs3vpayA513UwxL5XC4eGBXqY/index.html';
const ACTIVITY_USER_AGENT = 'jdapp;iPhone;15.6.50;;;M/5.0;appBuild/170394;jdSupportDarkMode/0;lang/zh_CN;ctype/0;site/CN;ccy/CNY;elder/0;ef/1;ep/%7B%22ciphertype%22%3A5%2C%22cipher%22%3A%7B%22ud%22%3A%22CtS0ZJZtCzHvDzYzENO5DwG0DWS3CNK2YtrwCJcnC2Y4ZNHvYzG2Cm%3D%3D%22%2C%22sv%22%3A%22CtYkCq%3D%3D%22%2C%22iad%22%3A%22%22%7D%2C%22ts%22%3A1776869353%2C%22hdid%22%3A%22JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw%3D%22%2C%22version%22%3A%221.0.3%22%2C%22appname%22%3A%22com.360buy.jdmobile%22%2C%22ridx%22%3A-1%7D;Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1;';
const START_STAGE_COOKIE_PATCH = {
  '__jd_ref_cls': 'Babel_dev_other_lqzx_task',
  pre_seq: '0',
  joyytokem: 'babel_VAjs3vpayA513UwxL5XC4eGBXqYMDFpTmt4RDk5MQ==.WHlcTnxfd1hNfF1/XQZ9AipYHHYhf1w0OlhiXVR1RX8VSjpYMCk5NDEZBQEDADodEAUhCV1OLhklIBJ0MywIDysPLBsCCCspOyACWTkEQTwjfyQ2BjorXygdBRskAnUxP18WFxF5LkEdW3sdMwcAPQ8QDiY9Ek81',
};
const RECEIVE_STAGE_COOKIE_PATCH = {
  '__jd_ref_cls': 'Babel_H5FirstClick',
  pre_seq: '7',
  joyytokem: 'babel_VAjs3vpayA513UwxL5XC4eGBXqYMDFua090TDk5MQ==.X1x4QnRYUnxCdFZbeQp9Ggl/OC85XyklMl9HeVh9QloxRjJfFQ01PDY8FR1+Bx85HA0mLHlCJh4ABB58NAksAyMICT8OACwMHywKXhwgTTQkWgA6Dj0OeyQVAj4ADn02GnsaHxZcCk0VXF45Pw8HGCscBiEYNkM9',
};
const DEFAULT_FULL_ACTIVITY_COOKIE = '__jd_ref_cls=Babel_dev_homeBanner; joyytokem=babel_VAjs3vpayA513UwxL5XC4eGBXqYMDFHUGZ2eDk5MQ==.dmdRQE9/ZFFHSnFnUghNDGglPQAiKQUfBnZ8UFpJa2EYRAZ2LiQ3CB8HHCE3ECM5HjkPF1BAEjc7LRxIHTIFARchMhYMNAU3Ni4+dycJTwANYSk4OhQ1UiYhKwUpDEkfIVIYKz9nI08hdWUQPTsuIwIeMggjH0EJFhhSTxAUCAQDGjku.03524a92; sdtoken=AAbEsBpEIOVjqTAKCQtvQu17chzBc7iLJ3UmNt2zzAES02CQFhf2gTtqRHmfS32H80vEG72wnY3FWRbKR2d3Qmd_7PQiZ_seB3XnQCXgjI_gAhJxJzTzqavRjlKiFGmAD-RmYrp-ah6QOkH1n6_CWhF0w6dG_k5ROJoa9DBUNECQZQ; shshshfpa=59eac0aa-7cde-e43b-f492-1a7da4a82d11-1741961063; shshshfpb=BApXWWprQwfhAkxxEcgVU0XrJxXLtCuvfBjckFqkD9xJ1ONBSe4PYlUOz1XroGjB6E9Y24fDS05Nifuk14vkN7diGAlwi; shshshfpv=JD0211d47dXRPBE3RgYr177686906644007z_IASOaI627HTnhsqnd_30vcXX6l0wc7eTFelMX8DPlA05IL3b6TQdeLrzX57Li0L2jID0F51LYC4Tuwe8xN4L6c-_jritTithx13VfRDh1t7kI1CjMvRBitKF_mn4Y10kfk15q~BApXWWprQwfhD1OB8xqCNNSQdMge9fkCrLs8Pw0xX9xJ1ONBSe4PYlUOz1Xr7I5ZME9Y2tKfQipYzc74z460Isd6g-7S; unionwsws=%7B%22devicefinger%22%3A%22eidI1b48812339seYMyi%2BxceSWi9B1BquhXOpmDMpHufNfBzKBTXpbftpBC99S3bp%2FiNdUQ1bciMGfQ8NmK0u2XbCkQVMWnsFVrkAH3Pc1awkgIzpohR%22%7D; unpl=JF8EAJtnNSttWUMGDB0LE0cUH1lUWQoNG0UHPzMGAVoNTFAGTFBOGhV7XlVdWhRKEh9sYhRXX1NJUg4YBysSEHtdVV9cDU4XAWlmNWRVUCVUSBtsGHwQBhAZbl4IexYzb2EDUFpZQl0NHwsfEBNNWlFcVQhMJwJfZwNkbWhKZAQrSXUTXUtaU1ddC08UCm1nBlRYW0NRDRwEGCIRe14%7CJF8EANRnNSttXh5XBB4HT0IZTA5QWwldGx9WamICUQ9RH1FQTwoYERd7XlVdWhRKFB9ubxRXXVNOVQ4eAisiEEpcVF9ZC04fA19jBlBaXXtSax4AEhcZS1xcMF4JSnl-NyBRFhxES1drG2wfERRMWDpuXgh7FjM7NVIGCgxJXARMAxwQRxtaUA5eWBkSCmtmBlBZDEpVUSsDKxsRe11VX1wKSxYHb2IAVW1oSmQEKwMrWX5KEAAMClocQwFnZlJVWlocBAIfUhhCQk5UUF9eDE9DAm4zNVVtWA; __jda=95931165.177560889585327643916.1775608895.1777044668.1777044987.135; __jdb=95931165.2.177560889585327643916|135.1777044987; __jdc=95931165; __jdv=95931165%7Clianmeng__11__kong__kong%7Ct_1000441370_%7Cjingfen%7C09c8789d5e516f4ac5ae2d6d652fcd94%7C1777045044663; mba_muid=177560889585327643916; mba_sid=17770894198131834365756.2; 3AB9D23F7A4B3C9B=PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4; 3AB9D23F7A4B3CSS=jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5YLL6KGAAAAAACDNRXLGYH5LVU4X; _gia_d=1; b_dh=753; pre_seq=2; pre_session=224e6c34e7638196d45b7006b8f1713f8d4ec463|20019; wxa_level=1; warehistory=100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C100017420991%2C; qid_evord=30619; qid_ls=1776876669203; qid_ts=1776882472399; qid_vis=80; UUID=76C0B11A-9A15-423F-AD24-788ADF0C9AA6; deviceId=224e6c34e7638196d45b7006b8f1713f8d4ec463; deviceType=iPhone14,5; jdpay_appId=com.360buy.jdmobile; jdpay_appVersion=170394; jdpay_browserId=pay; jdpay_sdkVersion=4.01.99.00; moduleBuildVersion=17; moduleName=JDPaySDK; moduleVersion=4.01.99.00; osPlatform=iOS; showedCardInfo=2_default; sid=; cid=8; cartNum=8; jsavif=1; webp=1; jkcsjdv=17756061592412010351409; deviceid_pdj_jd=224e6c34e7638196d45b7006b8f1713f8d4ec463; visitkey=9064630564580568512; SameSite=Strict; qid_fs=1775610598323; qid_uid=771fdd32-da27-4fe2-88d3-4feb39c7bf59; b_avif=1; b_dpr=3; b_dw=390; b_webp=1';
const RETRY_WAIT_MS = 2500;
const MAX_RETRY_TIMES = 6;
const RECEIVE_WAIT_MS = 10000;
const RECEIVE_RETRY_WAIT_MS = 8000;
const MAX_RECEIVE_RETRY_TIMES = 10;
const riskContextCache = new Map();

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JD_COUPON_ACTIVITY_DEBUG === '1';
}

function getChannelId() {
  return process.env.JD_COUPON_ACTIVITY_CHANNEL_ID || DEFAULT_CHANNEL_ID;
}

function getAssignmentId() {
  return process.env.JD_COUPON_ACTIVITY_ASSIGNMENT_ID || DEFAULT_ASSIGNMENT_ID;
}

function getItemId() {
  return process.env.JD_COUPON_ACTIVITY_ITEM_ID || DEFAULT_ITEM_ID;
}

function getStartBabelChannel() {
  return process.env.JD_COUPON_ACTIVITY_START_BABEL_CHANNEL || DEFAULT_START_BABEL_CHANNEL;
}

function getReceiveBabelChannel() {
  return process.env.JD_COUPON_ACTIVITY_RECEIVE_BABEL_CHANNEL || DEFAULT_RECEIVE_BABEL_CHANNEL;
}

function getEidToken() {
  return process.env.JD_COUPON_ACTIVITY_EID_TOKEN || '';
}

function getFullActivityCookie() {
  return process.env.JD_COUPON_ACTIVITY_FULL_COOKIE || DEFAULT_FULL_ACTIVITY_COOKIE;
}

function getActivityCookie(cookie) {
  return mergeCookieString(getFullActivityCookie(), cookie);
}

function getStageCookiePatch(stage) {
  if (stage === 'receive') {
    return RECEIVE_STAGE_COOKIE_PATCH;
  }
  if (stage === 'start') {
    return START_STAGE_COOKIE_PATCH;
  }
  return {};
}

function getStageActivityCookie(cookie, stage) {
  return mergeCookieString(getActivityCookie(cookie), getStageCookiePatch(stage));
}

function getComponentSdkToken() {
  return process.env.JD_COUPON_ACTIVITY_SDK_TOKEN || DEFAULT_COMPONENT_SDK_TOKEN;
}

function getRewardReceiveKey() {
  return process.env.JD_COUPON_ACTIVITY_REWARD_RECEIVE_KEY || DEFAULT_COMPONENT_REWARD_RECEIVE_KEY;
}

function getComponentToken() {
  return process.env.JD_COUPON_ACTIVITY_COMPONENT_TOKEN || DEFAULT_COMPONENT_TOKEN;
}

function getComponentActKey() {
  return process.env.JD_COUPON_ACTIVITY_COMPONENT_ACT_KEY || DEFAULT_COMPONENT_ACT_KEY;
}

async function resolveRiskContext(cookie, pageUrl, stage = '') {
  const cacheKey = `${getUserName(cookie)}:${pageUrl}:${stage}`;
  if (riskContextCache.has(cacheKey)) {
    return riskContextCache.get(cacheKey);
  }

  const contextPromise = (async () => {
    try {
      return await getGiasRiskContext(getStageActivityCookie(cookie, stage), {
        pageUrl,
        bizId: 'JDR_shields',
        userAgent: ACTIVITY_USER_AGENT,
      });
    } catch (error) {
      return {
        jsToken: '',
        cookie: getStageActivityCookie(cookie, stage),
        riskError: error.message,
      };
    }
  })();

  riskContextCache.set(cacheKey, contextPromise);
  return contextPromise;
}

function getRefererPage(requestReferer) {
  const refererUrl = new URL(requestReferer);
  return `${refererUrl.origin}${refererUrl.pathname}`;
}

function extractSdToken(response) {
  const rawHeader = response?.headers?.['x-rp-sdtoken'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!headerValue) {
    return '';
  }

  const parts = String(headerValue).split(';');
  return parts.length >= 3 ? parts[2].trim() : '';
}

function attachUpdatedCookie(result, cookie) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    result._cookie = cookie;
    return result;
  }

  return {
    success: false,
    message: '接口返回非对象结果',
    raw: result,
    _cookie: cookie,
  };
}

function decodeComponentInfo(loadResult) {
  const encoded = loadResult?.compExposureInfo?.mkt_comp_un?.compInfo;
  if (!encoded) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    return {};
  }
}

function buildComponentContext(loadResult) {
  const compInfo = decodeComponentInfo(loadResult);
  return {
    token: loadResult?.token || compInfo.module_token || getComponentToken(),
    actKey: loadResult?.data?.actBasicInfo?.actEncKey || compInfo.act_key || getComponentActKey(),
    sdkToken: getComponentSdkToken(),
    rewardReceiveKey: getRewardReceiveKey(),
    ubbLoc: DEFAULT_COMPONENT_UBB_LOC,
    lid: DEFAULT_AREA,
    openChannel: DEFAULT_COMPONENT_OPEN_CHANNEL,
    subLabel: DEFAULT_COMPONENT_SUB_LABEL,
  };
}

function shouldRetry(response) {
  const code = response?.code;
  const bizCode = response?.data?.bizCode;
  const messageList = [
    response?.message,
    response?.msg,
    response?.data?.bizMsg,
  ].filter(Boolean);
  const message = messageList.join(' | ');
  return code === 405
    || bizCode === -202
    || bizCode === -102
    || message.includes('活动火爆')
    || message.includes('稍后再试')
    || message.includes('参与人数较多');
}

async function retryRequest(requestFn, username, actionName, context = {}) {
  const maxRetryTimes = context.maxRetryTimes || MAX_RETRY_TIMES;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxRetryTimes; attempt += 1) {
    lastResponse = await requestFn(context.cookie);
    if (lastResponse?._cookie) {
      context.cookie = lastResponse._cookie;
    }
    if (!shouldRetry(lastResponse) || attempt === maxRetryTimes) {
      return lastResponse;
    }

    let waitMs = context.retryWaitMs || RETRY_WAIT_MS;
    if (lastResponse?.data?.bizCode === -205) {
      waitMs = context.receiveRetryWaitMs || RECEIVE_RETRY_WAIT_MS;
    }

    $.log(`账号 ${username}: ${actionName} 第 ${attempt} 次触发限流，${waitMs / 1000} 秒后重试`);
    await sleep(waitMs);
  }

  return lastResponse;
}

async function callCouponActivityApi(cookie, body, options = {}) {
  const requestReferer = options.referer || RECEIVE_REFERER_URL;
  const requestOrigin = options.origin || new URL(requestReferer).origin;
  const stage = options.stage || '';
  const riskContext = await resolveRiskContext(cookie, requestReferer, stage);
  const requestCookie = mergeCookieString(
    riskContext?.cookie || getStageActivityCookie(cookie, stage),
    getStageCookiePatch(stage),
  );
  const uuid = getRequestUuid(requestCookie);
  const query = new URLSearchParams({
    area: DEFAULT_AREA,
    clientVersion: DEFAULT_CLIENT_VERSION,
    client: DEFAULT_CLIENT,
    loginType: '2',
    t: String(Date.now()),
    appid: REQUEST_APP_ID,
    xAPIClientLanguage: 'zh_CN',
    functionId: 'common_do_task',
    uuid,
    d_model: DEFAULT_MODEL,
    model: DEFAULT_MODEL,
    osVersion: DEFAULT_OS_VERSION,
  });

  const form = new URLSearchParams();
  form.set('body', JSON.stringify(body));
  form.set(
    'h5st',
    await createH5st({
      functionId: 'common_do_task',
      body,
      h5stAppId: H5ST_APP_ID,
      requestAppid: REQUEST_APP_ID,
      cookie: requestCookie,
      userAgent: ACTIVITY_USER_AGENT,
      client: DEFAULT_CLIENT,
      clientVersion: DEFAULT_CLIENT_VERSION,
    }),
  );
  const eidToken = riskContext?.jsToken || getEidToken();
  if (eidToken) {
    form.set('x-api-eid-token', eidToken);
  }

  const response = await got.post(`${API_ENDPOINT}?${query.toString()}`, {
    body: form.toString(),
    headers: buildHeaders(requestCookie, {
      origin: requestOrigin,
      referer: requestReferer,
      userAgent: ACTIVITY_USER_AGENT,
      extraHeaders: {
        'x-referer-page': getRefererPage(requestReferer),
        'x-rp-client': 'h5_1.0.0',
        priority: 'u=3, i',
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });

  const mergedCookie = extractSdToken(response)
    ? mergeCookieString(requestCookie, { sdtoken: extractSdToken(response) })
    : requestCookie;
  return attachUpdatedCookie(parseApiResponse(response), mergedCookie);
}

async function callComponentApi(cookie, functionId, body, options = {}) {
  const requestReferer = options.referer || START_REFERER_URL;
  const requestOrigin = options.origin || new URL(requestReferer).origin;
  const requestPageUrl = options.pageUrl || getRefererPage(requestReferer);
  const h5stAppId = options.h5stAppId || COMPONENT_LOAD_H5ST_APP_ID;
  const riskContext = await resolveRiskContext(cookie, requestReferer);
  const requestCookie = riskContext?.cookie || getActivityCookie(cookie);

  const form = new URLSearchParams();
  form.set('appid', COMPONENT_REQUEST_APP_ID);
  form.set('functionId', functionId);
  form.set('loginType', '2');
  form.set('loginWQBiz', COMPONENT_LOGIN_WQ_BIZ);
  form.set('body', JSON.stringify(body));
  form.set(
    'h5st',
    await createH5st({
      functionId,
      body,
      h5stAppId,
      requestAppid: COMPONENT_REQUEST_APP_ID,
      cookie: requestCookie,
      userAgent: ACTIVITY_USER_AGENT,
      client: DEFAULT_CLIENT,
      clientVersion: DEFAULT_CLIENT_VERSION,
    }),
  );
  const eidToken = riskContext?.jsToken || getEidToken();
  if (eidToken) {
    form.set('x-api-eid-token', eidToken);
  }

  const response = await got.post(`${COMPONENT_ENDPOINT}?functionId=${functionId}`, {
    body: form.toString(),
    headers: buildHeaders(requestCookie, {
      origin: requestOrigin,
      referer: requestReferer,
      userAgent: ACTIVITY_USER_AGENT,
      extraHeaders: {
        'x-referer-page': requestPageUrl,
        'x-rp-client': 'h5_1.0.0',
        priority: 'u=3, i',
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
    }),
    throwHttpErrors: false,
    timeout: { request: 15000 },
  });

  const mergedCookie = extractSdToken(response)
    ? mergeCookieString(requestCookie, { sdtoken: extractSdToken(response) })
    : requestCookie;
  return attachUpdatedCookie(parseApiResponse(response), mergedCookie);
}

async function loadComponentData(cookie) {
  return callComponentApi(cookie, 'comp_data_load', {
    token: getComponentToken(),
    commParams: {
      ubbLoc: DEFAULT_COMPONENT_UBB_LOC,
      lid: DEFAULT_AREA,
      client: 0,
      sdkToken: getComponentSdkToken(),
    },
    bizParams: {
      openChannel: DEFAULT_COMPONENT_OPEN_CHANNEL,
      actKey: getComponentActKey(),
      subLabel: DEFAULT_COMPONENT_SUB_LABEL,
    },
  }, {
    referer: START_REFERER_URL,
    origin: 'https://prodev.m.jd.com',
    pageUrl: START_PAGE_URL,
    h5stAppId: COMPONENT_LOAD_H5ST_APP_ID,
  });
}

async function invokeComponentReward(cookie, activityContext) {
  return callComponentApi(cookie, 'comp_data_interact', {
    token: activityContext.token,
    fnCode: 'invoke',
    commParams: {
      longitude: '113.03702',
      latitude: '28.210319',
      ubbLoc: activityContext.ubbLoc,
      lid: activityContext.lid,
      client: 0,
      sdkToken: activityContext.sdkToken,
    },
    bizParams: {
      openChannel: activityContext.openChannel,
      actFlowCode: 'receiveReward',
      actKey: activityContext.actKey,
      subLabel: activityContext.subLabel,
      lbsState: 1,
      rewardReceiveKey: activityContext.rewardReceiveKey,
    },
  }, {
    referer: START_REFERER_URL,
    origin: 'https://prodev.m.jd.com',
    pageUrl: START_PAGE_URL,
    h5stAppId: COMPONENT_INTERACT_H5ST_APP_ID,
  });
}

async function startBrowseTask(cookie) {
  return callCouponActivityApi(cookie, {
    channelId: getChannelId(),
    itemId: getItemId(),
    assignmentId: getAssignmentId(),
    actionType: 0,
    ext: {
      doReceiveRewards: null,
    },
    extMap: {
      babelChannel: getStartBabelChannel(),
    },
  }, {
    referer: START_REFERER_URL,
    origin: 'https://prodev.m.jd.com',
    stage: 'start',
  });
}

async function receiveReward(cookie) {
  return callCouponActivityApi(cookie, {
    channelId: getChannelId(),
    assignmentId: getAssignmentId(),
    actionType: 0,
    ext: {
      doReceiveRewards: 1,
    },
    extMap: {
      babelChannel: getReceiveBabelChannel(),
    },
  }, {
    referer: RECEIVE_REFERER_URL,
    origin: 'https://pro.m.jd.com',
    stage: 'receive',
  });
}

function summarizeRewards(response) {
  const rewardList = response?.data?.result?.assignmentResult?.rewardsInfo?.successRewards?.['3'] || [];
  return rewardList
    .map((item) => `${item.quantity || 0}${item.rewardName || item.prizeName || ''}`)
    .join(',');
}

async function handleAccount(cookie, index) {
  const username = getUserName(cookie);
  $.log(`\n==== 账号${index} ${username} ====`);

  let runtimeCookie = getActivityCookie(cookie);
  const loadResult = await loadComponentData(runtimeCookie);
  runtimeCookie = loadResult?._cookie || runtimeCookie;
  $.log(`账号 ${username}: comp_data_load => ${stringifySnippet(loadResult)}`);

  const activityContext = buildComponentContext(loadResult);
  if (loadResult?.httpStatus === 403) {
    $.log(`账号 ${username}: comp_data_load 403，回退到 HAR 已知 token/actKey 继续尝试`);
  } else if (!activityContext.token || !activityContext.actKey) {
    $.log(`账号 ${username}: comp_data_load 未提取到 token/actKey，跳过后续任务`);
    return;
  }

  const invokeResult = await invokeComponentReward(runtimeCookie, activityContext);
  runtimeCookie = invokeResult?._cookie || runtimeCookie;
  $.log(`账号 ${username}: comp_data_interact => ${stringifySnippet(invokeResult)}`);

  const startContext = { cookie: runtimeCookie };
  const startResult = await retryRequest((currentCookie) => startBrowseTask(currentCookie), username, '浏览任务', startContext);
  runtimeCookie = startContext.cookie || runtimeCookie;
  $.log(`账号 ${username}: 浏览任务结果 => ${stringifySnippet(startResult)}`);

  const startBizCode = startResult?.data?.bizCode;
  if (startBizCode && startBizCode !== 0 && startBizCode !== 103) {
    $.log(`账号 ${username}: 浏览任务未成功，跳过领奖`);
    return;
  }

  $.log(`账号 ${username}: 浏览任务已开始，等待 ${RECEIVE_WAIT_MS / 1000} 秒后领奖`);
  await sleep(RECEIVE_WAIT_MS);

  const receiveContext = {
    cookie: runtimeCookie,
    maxRetryTimes: MAX_RECEIVE_RETRY_TIMES,
    receiveRetryWaitMs: RECEIVE_RETRY_WAIT_MS,
  };
  const receiveResult = await retryRequest((currentCookie) => receiveReward(currentCookie), username, '领奖任务', receiveContext);
  const rewardSummary = summarizeRewards(receiveResult);
  $.log(`账号 ${username}: 领奖结果 => ${rewardSummary || stringifySnippet(receiveResult)}`);

  if (isDebugEnabled()) {
    $.log(`账号 ${username}: receiveReward 原始返回 => ${stringifySnippet(receiveResult, 1500)}`);
  }
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
      const username = getUserName(cookies[index]);
      $.log(`账号 ${username}: 执行异常 => ${error.stack || error.message}`);
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
        await notify.sendNotify($.name, '执行完成');
      } catch (error) {
        // ignore
      }
    }
    $.done();
  });
