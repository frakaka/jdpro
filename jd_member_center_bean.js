/*
cron:10 0 * * * jd_member_center_bean.js
*/

'use strict';

const crypto = require('crypto');
const got = require('got');
const { USER_AGENT, UARAM } = require('./USER_AGENTS');
const jdCookieNode = require('./jdCookie.js');

let notify = null;
try {
  notify = require('./sendNotify');
} catch (error) {
  notify = null;
}

const SCRIPT_NAME = '浏览会员中心领京豆';
const BASE_URL = 'https://lop-proxy.jd.com';
const TASK_ID = 'member_center';
const TASK_LIST_PATH = '/jdBeanApi/jingBeanTaskList';
const START_BROWSE_PATH = '/jdBeanApi/startBrowseTask';
const REPORT_BROWSE_PATH = '/jdBeanApi/reportBrowseTask';
const CLAIM_REWARD_PATH = '/jdBeanApi/claimRewardEncrypt';
const BEAN_COUNT_PATH = '/jdBeanApi/jdBeanAllCount';
const PKID = '7225';
const PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCnmsTd96WhnKDptTI5I1IKutFE1eNwrD9gTzeALxT0pjYjqwGmHiehYRfY0FtSzd0WxZnLduv7dBY/W+GnPsXFPNO58Nt7Xmcdi2pzVWW9KOhslSoT6WiCk+0kQtr0+gcpHId6qbYIkkpAPVcX7OURbSRwsHLjrMRCAHo3nfuNywIDAQAB',
  '-----END PUBLIC KEY-----',
].join('\n');
const RANDOM_CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BROWSE_WAIT_MS = 16 * 1000;
const TASK_STATUS = {
  UN_FINISHED: 0,
  FINISHED: 1,
  CAN_RECEIVE: 2,
};

const cookies = Object.values(jdCookieNode).filter(Boolean);

function getUserName(cookie) {
  const match = cookie.match(/pt_pin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '未知账号';
}

function getUserAgent() {
  try {
    return UARAM();
  } catch (error) {
    return USER_AGENT;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomString(length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * RANDOM_CHARSET.length);
    result += RANDOM_CHARSET[randomIndex];
  }
  return result;
}

function createTraceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function buildCipherContext() {
  const keyText = randomString(16);
  const ivText = randomString(16);
  const ciphertext = crypto.publicEncrypt(
    {
      key: PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(`${keyText}${ivText}`, 'utf8'),
  ).toString('base64');

  return {
    key: Buffer.from(keyText, 'utf8'),
    iv: Buffer.from(ivText, 'utf8'),
    ciphertext,
  };
}

function encryptPayload(payload, cipherContext) {
  const cipher = crypto.createCipheriv('aes-128-cbc', cipherContext.key, cipherContext.iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return encrypted.toString('base64');
}

function decryptPayload(payload, cipherContext) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', cipherContext.key, cipherContext.iv);
  const decrypted = Buffer.concat([
    decipher.update(payload, 'base64'),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function looksLikeJson(content) {
  return content.startsWith('{') || content.startsWith('[');
}

function buildHeaders(cookie, cipherContext) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    Cookie: cookie,
    Origin: 'https://jingcai-h5.jd.com',
    Referer: 'https://jingcai-h5.jd.com/',
    'User-Agent': getUserAgent(),
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'app-key': 'jexpress',
    'biz-type': 'service-monitor',
    'source-client': '2',
    access: 'H5',
    'jexpress-report-time': String(Date.now()),
    version: 'e1abc22',
    'jfe-cgi-flow': 'EXP_JCH5_e1abc22',
    forcebot: '0',
    sdkversion: '1.0.7',
    screen: '393*852',
    'jexpress-trace-id': createTraceId(),
    'event-id': createTraceId(),
  };

  if (cipherContext) {
    headers.ciphertext = cipherContext.ciphertext;
    headers.pkid = PKID;
  }

  return headers;
}

async function postJson(path, cookie, payload, options = {}) {
  const { encryptRequest = false, decryptResponse = false } = options;
  const cipherContext = encryptRequest || decryptResponse ? buildCipherContext() : null;
  const requestBody = encryptRequest
    ? encryptPayload(payload, cipherContext)
    : JSON.stringify(payload);

  const responseText = await got.post(`${BASE_URL}${path}`, {
    body: requestBody,
    headers: buildHeaders(cookie, cipherContext),
    throwHttpErrors: false,
    timeout: {
      request: 15000,
    },
  }).text();

  const trimmedText = responseText.trim();
  let parsedText = trimmedText;
  if (decryptResponse && trimmedText && !looksLikeJson(trimmedText)) {
    parsedText = decryptPayload(trimmedText, cipherContext).trim();
  }

  return safeJsonParse(parsedText) ?? parsedText;
}

function walkData(node, visitor, seen = new WeakSet()) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (seen.has(node)) {
    return;
  }
  seen.add(node);
  visitor(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkData(item, visitor, seen);
    }
    return;
  }

  for (const value of Object.values(node)) {
    walkData(value, visitor, seen);
  }
}

function findTask(data, taskId) {
  let result = null;
  walkData(data, (node) => {
    if (!result && node.taskId === taskId) {
      result = node;
    }
  });
  return result;
}

function collectTasks(data) {
  const tasks = [];
  walkData(data, (node) => {
    if (typeof node.taskId === 'string' && node.taskId) {
      tasks.push({
        taskId: node.taskId,
        taskName: typeof node.taskName === 'string' ? node.taskName : '',
        taskDesc: typeof node.taskDesc === 'string' ? node.taskDesc : '',
        taskStatus: node.taskStatus,
        claimCode: typeof node.claimCode === 'string' ? node.claimCode : '',
      });
    }
  });
  return tasks;
}

function formatTaskSummary(data) {
  const tasks = collectTasks(data);
  if (!tasks.length) {
    const preview = typeof data === 'string' ? data : JSON.stringify(data);
    return `接口未返回可识别任务，原始响应片段：${preview.slice(0, 300)}`;
  }

  const uniqueTasks = [];
  const seen = new Set();
  for (const task of tasks) {
    const key = `${task.taskId}|${task.taskStatus}|${task.claimCode}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueTasks.push(task);
  }

  return uniqueTasks
    .slice(0, 12)
    .map((task) => {
      const label = task.taskName || task.taskDesc || '无名称';
      return `${task.taskId}[${task.taskStatus}] ${label}${task.claimCode ? ` claim=${task.claimCode}` : ''}`;
    })
    .join(' | ');
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

function findValueByKey(data, key) {
  let result;
  walkData(data, (node) => {
    if (result === undefined && Object.prototype.hasOwnProperty.call(node, key)) {
      result = node[key];
    }
  });
  return result;
}

function extractToken(data) {
  const tokenValue = findValueByKey(data, 'token');
  if (typeof tokenValue === 'string' && tokenValue) {
    return tokenValue;
  }

  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  return serialized.match(/[0-9a-f]{32}/i)?.[0] ?? '';
}

function extractBeanCount(data) {
  const candidateKeys = ['beanNum', 'jdBeanNum', 'beanCount', 'count', 'beans'];
  for (const key of candidateKeys) {
    const value = findValueByKey(data, key);
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return null;
}

function extractMessage(data) {
  if (typeof data === 'string') {
    return data;
  }

  const candidateKeys = ['content', 'msg', 'message', 'subCodeMsg', 'errMsg'];
  for (const key of candidateKeys) {
    const value = findValueByKey(data, key);
    if (typeof value === 'string' && value) {
      return value;
    }
  }

  return JSON.stringify(data);
}

function isClaimSuccess(data) {
  const message = extractMessage(data);
  if (typeof data === 'object' && data && data.code === 1 && /成功|已领取/.test(message)) {
    return true;
  }
  return /领取成功|已领取/.test(message);
}

function buildClaimPayloads(taskId, claimCode) {
  return [
    [{ pin: '', taskId, claimCode }],
    [{ taskId, claimCode }],
    [{ pin: '', claimCode }],
  ];
}

async function queryTaskList(cookie) {
  return postJson(TASK_LIST_PATH, cookie, [{ pin: '', position: 1 }]);
}

async function queryBeanCount(cookie) {
  const response = await postJson(BEAN_COUNT_PATH, cookie, [{ pin: '' }]);
  return extractBeanCount(response);
}

async function startBrowseTask(cookie, taskId) {
  return postJson(
    START_BROWSE_PATH,
    cookie,
    [{ pin: '', taskId }],
    { decryptResponse: true },
  );
}

async function reportBrowseTask(cookie, token) {
  return postJson(
    REPORT_BROWSE_PATH,
    cookie,
    [{ pin: '', token }],
    { decryptResponse: true },
  );
}

async function claimReward(cookie, taskId, claimCode) {
  const payloads = buildClaimPayloads(taskId, claimCode);
  let lastResponse = null;

  for (const payload of payloads) {
    const response = await postJson(
      CLAIM_REWARD_PATH,
      cookie,
      payload,
      { encryptRequest: true },
    );
    lastResponse = response;
    if (isClaimSuccess(response)) {
      return {
        success: true,
        response,
      };
    }
  }

  return {
    success: false,
    response: lastResponse,
  };
}

async function processAccount(cookie, index) {
  const userName = getUserName(cookie);
  const prefix = `账号${index} ${userName}`;
  console.log(`\n==== ${prefix} ====`);

  const beforeBeanCount = await queryBeanCount(cookie).catch(() => null);
  const initialTaskResponse = await queryTaskList(cookie);
  let task = findTask(initialTaskResponse, TASK_ID);

  if (!task) {
    console.log(`${prefix}: jingBeanTaskList 原始返回 => ${stringifyForLog(initialTaskResponse)}`);
    return `${prefix}: 未找到 ${TASK_ID} 任务。任务摘要：${formatTaskSummary(initialTaskResponse)}`;
  }

  console.log(`${prefix}: 初始状态 ${task.taskStatus}`);

  if (task.taskStatus === TASK_STATUS.UN_FINISHED) {
    const startResponse = await startBrowseTask(cookie, TASK_ID);
    const startMessage = extractMessage(startResponse);
    const startCode = typeof startResponse === 'object' && startResponse ? startResponse.code : 0;
    if (startCode !== 1 && !/成功/.test(startMessage)) {
      return `${prefix}: 启动浏览失败，${startMessage}`;
    }

    const token = extractToken(startResponse);
    if (!token) {
      return `${prefix}: 启动浏览成功，但未拿到 token`;
    }

    console.log(`${prefix}: 已拿到 token，等待 ${Math.floor(BROWSE_WAIT_MS / 1000)} 秒后上报`);
    await sleep(BROWSE_WAIT_MS);

    const reportResponse = await reportBrowseTask(cookie, token);
    console.log(`${prefix}: 上报结果 ${extractMessage(reportResponse)}`);

    const refreshedTaskResponse = await queryTaskList(cookie);
    task = findTask(refreshedTaskResponse, TASK_ID);
    if (!task) {
      console.log(`${prefix}: 上报后 jingBeanTaskList 原始返回 => ${stringifyForLog(refreshedTaskResponse)}`);
      return `${prefix}: 上报后未找到 ${TASK_ID} 任务。任务摘要：${formatTaskSummary(refreshedTaskResponse)}`;
    }
  }

  if (task.taskStatus === TASK_STATUS.FINISHED) {
    const currentBeanCount = await queryBeanCount(cookie).catch(() => null);
    return `${prefix}: 任务已完成${currentBeanCount !== null ? `，当前京豆 ${currentBeanCount}` : ''}`;
  }

  if (task.taskStatus !== TASK_STATUS.CAN_RECEIVE || !task.claimCode) {
    return `${prefix}: 上报后状态异常，taskStatus=${task.taskStatus}，claimCode=${task.claimCode || '空'}`;
  }

  console.log(`${prefix}: 准备领取，claimCode=${task.claimCode}`);
  const claimResult = await claimReward(cookie, TASK_ID, task.claimCode);
  const afterBeanCount = await queryBeanCount(cookie).catch(() => null);

  if (!claimResult.success) {
    return `${prefix}: 领取失败，${extractMessage(claimResult.response)}`;
  }

  let beanMessage = '';
  if (beforeBeanCount !== null && afterBeanCount !== null) {
    beanMessage = `，京豆 ${beforeBeanCount} -> ${afterBeanCount}`;
  } else if (afterBeanCount !== null) {
    beanMessage = `，当前京豆 ${afterBeanCount}`;
  }

  return `${prefix}: 领取成功${beanMessage}`;
}

async function main() {
  if (!cookies.length) {
    console.log(`${SCRIPT_NAME}: 未找到可用 Cookie`);
    return;
  }

  const summary = [];
  for (let index = 0; index < cookies.length; index += 1) {
    try {
      const result = await processAccount(cookies[index], index + 1);
      console.log(result);
      summary.push(result);
    } catch (error) {
      const userName = getUserName(cookies[index]);
      const message = `账号${index + 1} ${userName}: 执行异常，${error.message}`;
      console.log(message);
      summary.push(message);
    }
    await sleep(1000);
  }

  const notifyText = summary.join('\n');
  if (notify && typeof notify.sendNotify === 'function' && notifyText) {
    await notify.sendNotify(SCRIPT_NAME, notifyText);
  }
}

main().catch((error) => {
  console.log(`${SCRIPT_NAME}: ${error.message}`);
});
