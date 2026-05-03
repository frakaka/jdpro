/*
cron:15 1 * * * jdJR_seen_livestream.js

环境变量说明：
1. JDJR_SEEN_LIVESTREAM_HAR_PATH
   含义：直播看视频抓包 HAR 路径。
   是否必须：否，默认读取 files/traffic_jdjr_seen_livestream.har。

2. JDJR_SEEN_LIVESTREAM_DEBUG
   含义：是否打印更完整的请求体，尤其是 sgm 加密报文。
   是否必须：否，值为 1 时开启。

3. JDJR_SEEN_LIVESTREAM_REPORT_BODY
   含义：覆盖 HAR 中提取出的 reportApi body。
   是否必须：否。

4. JDJR_SEEN_LIVESTREAM_REPORT_T
   含义：覆盖 HAR 中提取出的 reportApi t。
   是否必须：否。

5. JDJR_SEEN_LIVESTREAM_REPORT_SIGN
   含义：覆盖 HAR 中提取出的 reportApi sign。
   是否必须：否；如果 body/t 改了，通常也要同步改。

6. JDJR_SEEN_LIVESTREAM_BASE_PLAY_DURATION
   含义：动态生成 reportApi body 时的起始播放时长毫秒数。
   是否必须：否，默认基于 HAR 样本首条播放时长加随机扰动。

7. JDJR_SEEN_LIVESTREAM_SGM_REPLAY_COUNT
   含义：重放多少条 HAR 中离 reportApi 最近的 sgm 请求。
   是否必须：否，默认 3。

8. JDJR_SEEN_LIVESTREAM_EQUIPMENT_ID
   含义：回退用设备标识，会写入 3AB9D23F7A4B3C9B 和 equipmentId。
   是否必须：否。

9. JDJR_SEEN_LIVESTREAM_JS_TOKEN
   含义：回退用 jsToken，会写入 3AB9D23F7A4B3CSS。
   是否必须：否。

10. JDJR_SEEN_LIVESTREAM_REPORT_INDEX
   含义：指定使用 HAR 中第几条 reportApi 样本，0 基下标。
   是否必须：否，默认优先取最后一条成功样本。

11. JDJR_SEEN_LIVESTREAM_POLICY_BODY
   含义：覆盖 HAR 中提取出的 getPolicy body。
   是否必须：否。

12. JDJR_SEEN_LIVESTREAM_POLICY_T
   含义：覆盖 HAR 中提取出的 getPolicy t。
   是否必须：否。

13. JDJR_SEEN_LIVESTREAM_POLICY_SIGN
   含义：覆盖 HAR 中提取出的 getPolicy sign。
   是否必须：否。
*/

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { randomInt, randomUUID } = require('crypto');
const got = require('got');
const jdCookieNode = require('./jdCookie.js');
const {
  Env,
  DEFAULT_JR_USER_AGENT,
  buildHeaders,
  getGiasRiskContext,
  getUserName,
  mergeCookieString,
  parseCookieString,
  safeJsonParse,
  stringifySnippet,
} = require('./function/jdHarBeanCommon');

const $ = new Env('金融直播看视频进度上报');

const HAR_PATH = process.env.JDJR_SEEN_LIVESTREAM_HAR_PATH
  || path.join(__dirname, 'files', 'traffic_jdjr_seen_livestream.har');
const JRMFP_URL = 'https://jrmfp.jr.jd.com/npvuv_en';
const SGM_URL = 'https://sgm-m.jd.com/ios';
const POLICY_URL = 'https://api.m.jd.com/api?&functionId=getPolicy';
const REPORT_API_URL = 'https://api.m.jd.com/api?&functionId=reportApi';
const PAGE_ORIGIN = 'https://plantearth.m.jd.com';
const PAGE_REFERER = 'https://plantearth.m.jd.com/';
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_EQUIPMENT_ID = 'PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4';
const DEFAULT_JS_TOKEN = 'jdd03PM43NU2RCI6FPPGFHM2UNRL7V2LPAMWHYXNQWDM2KV7N254WWO7QZHYP4VZM24BOFKPW6DVUL5RNEZBFXXVPSQJNF4AAAAM5S4HNMHIAAAAAD2I3CYGSZ4YJAQX';
const COLLECT_TOKEN_URL_KEYWORD = 'collectTokenPin1';

const cookies = Object.values(jdCookieNode).filter(Boolean);

$.log('', `🔔${$.name}, 开始!`);

function isDebugEnabled() {
  return process.env.JDJR_SEEN_LIVESTREAM_DEBUG === '1';
}

function getReplaySgmCount() {
  const raw = process.env.JDJR_SEEN_LIVESTREAM_SGM_REPLAY_COUNT;
  const parsed = Number(raw || 3);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function getRequestedReportIndex() {
  const raw = process.env.JDJR_SEEN_LIVESTREAM_REPORT_INDEX;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function decodeBase64JsonIfPossible(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return {
      raw: '',
      parsed: null,
      decodedText: '',
      decodedParsed: null,
    };
  }

  const parsed = safeJsonParse(text, null);
  if (parsed) {
    return {
      raw: text,
      parsed,
      decodedText: text,
      decodedParsed: parsed,
    };
  }

  try {
    const decodedText = Buffer.from(text, 'base64').toString('utf8').trim();
    const decodedParsed = safeJsonParse(decodedText, null);
    return {
      raw: text,
      parsed: null,
      decodedText,
      decodedParsed,
    };
  } catch (error) {
    return {
      raw: text,
      parsed: null,
      decodedText: '',
      decodedParsed: null,
    };
  }
}

function parseBase64Packet(packetText) {
  const packet = String(packetText || '').trim();
  if (!packet) {
    return null;
  }

  try {
    const buffer = Buffer.from(packet, 'base64');
    if (buffer.length < 36) {
      return {
        raw: packet,
        byteLength: buffer.length,
        hexPrefix: buffer.toString('hex').slice(0, 64),
      };
    }

    return {
      raw: packet,
      byteLength: buffer.length,
      version: buffer.readUInt32LE(0),
      opcode: buffer.readUInt32LE(4),
      declaredLength: buffer.readUInt32LE(8),
      keyId: buffer.subarray(12, 20).toString('latin1'),
      seedHex: buffer.subarray(20, 36).toString('hex'),
      payloadHexPrefix: buffer.subarray(36, 68).toString('hex'),
      payloadByteLength: Math.max(0, buffer.length - 36),
      tailBlockByteLength: Math.max(0, buffer.length - 36) % 16 === 0 ? Math.max(0, buffer.length - 36) : null,
    };
  } catch (error) {
    return {
      raw: packet,
      error: error.message,
    };
  }
}

function buildCollectTokenSignAnalysis(collectTokenSamples, reportSamples, policySample) {
  if (!collectTokenSamples.length) {
    return null;
  }

  const responseSeeds = Array.from(
    new Set(
      collectTokenSamples
        .map((sample) => sample.responsePacket?.seedHex || '')
        .filter(Boolean),
    ),
  );
  const responseLengths = Array.from(
    new Set(
      collectTokenSamples
        .map((sample) => sample.responsePacket?.declaredLength)
        .filter((value) => Number.isFinite(value)),
    ),
  );

  const candidateSecrets = [];
  for (const sample of collectTokenSamples) {
    if (sample.responseRaw) {
      candidateSecrets.push(sample.responseRaw);
    }
    if (sample.responsePacket?.seedHex) {
      candidateSecrets.push(sample.responsePacket.seedHex);
    }
    if (sample.responsePacket?.payloadHexPrefix) {
      candidateSecrets.push(sample.responsePacket.payloadHexPrefix);
    }
  }

  const filteredSecrets = Array.from(new Set(candidateSecrets.filter(Boolean)));
  const signatureSamples = [
    ...(policySample ? [policySample] : []),
    ...reportSamples.filter((sample) => sample.success),
  ]
    .map((sample) => ({
      name: sample.appid,
      sign: sample.sign,
      textCandidates: [
        `${sample.appid}${sample.body}${sample.t}`,
        `${sample.body}${sample.t}`,
        `appid=${sample.appid}&body=${sample.body}&t=${sample.t}`,
        `appid=${sample.appid}&body=${encodeURIComponent(sample.body)}&t=${sample.t}`,
      ],
    }));

  let matchedFormula = false;
  for (const secret of filteredSecrets) {
    for (const sample of signatureSamples) {
      for (const text of sample.textCandidates) {
        const sha256 = crypto.createHash('sha256').update(text).digest('hex');
        const hmac = crypto.createHmac('sha256', secret).update(text).digest('hex');
        if (sha256 === sample.sign || hmac === sample.sign) {
          matchedFormula = true;
          break;
        }
      }
      if (matchedFormula) {
        break;
      }
    }
    if (matchedFormula) {
      break;
    }
  }

  return {
    responseSeeds,
    responseLengths,
    matchedFormula,
    likelySecretLength:
      responseLengths.length === 1 && responseLengths[0] === 32 ? 32 : null,
  };
}

function getHarHeaderValues(entry, headerName) {
  const target = String(headerName || '').toLowerCase();
  return (entry?.request?.headers || [])
    .filter((header) => String(header?.name || '').toLowerCase() === target)
    .map((header) => String(header?.value || ''))
    .filter(Boolean);
}

function getHarHeaderValue(entry, headerName) {
  const values = getHarHeaderValues(entry, headerName);
  return values.length ? values[0] : '';
}

function parseHarForm(entry) {
  const postData = entry?.request?.postData || {};
  if (Array.isArray(postData.params) && postData.params.length) {
    return Object.fromEntries(
      postData.params.map((item) => [String(item.name || ''), String(item.value || '')]),
    );
  }

  if (postData.text) {
    return Object.fromEntries(new URLSearchParams(String(postData.text)).entries());
  }

  return {};
}

function isReportSuccess(responseText) {
  const decoded = decodeBase64JsonIfPossible(responseText);
  const payload = decoded.decodedParsed || decoded.parsed;
  return Number(payload?.code) === 200 || String(payload?.desc || '') === '操作成功';
}

function buildHarCookie(entry) {
  const cookieValues = getHarHeaderValues(entry, 'cookie');
  if (!cookieValues.length) {
    return '';
  }

  const joined = cookieValues
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('; ');
  return mergeCookieString('', joined);
}

function normalizeHarRequestEntry(entry) {
  return {
    startedDateTime: entry.startedDateTime,
    url: String(entry?.request?.url || ''),
    method: String(entry?.request?.method || 'GET').toUpperCase(),
    requestHeaders: entry?.request?.headers || [],
    requestBody: String(entry?.request?.postData?.text || ''),
    responseStatus: entry?.response?.status || 0,
    responseBody: String(entry?.response?.content?.text || ''),
  };
}

function isSgmRequest(url) {
  return String(url || '').startsWith('https://sgm-m.jd.com/ios');
}

function extractHarProfile(harPath) {
  if (!fs.existsSync(harPath)) {
    throw new Error(`HAR 文件不存在：${harPath}`);
  }

  const harContent = fs.readFileSync(harPath, 'utf8');
  const har = JSON.parse(harContent);
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];

  const policyEntries = entries.filter((entry) => String(entry?.request?.url || '').includes('functionId=getPolicy'));
  const reportEntries = entries.filter((entry) => String(entry?.request?.url || '').includes('functionId=reportApi'));
  if (!reportEntries.length) {
    throw new Error('HAR 中未找到 reportApi 请求');
  }

  const sgmEntries = entries.filter((entry) => isSgmRequest(entry?.request?.url || ''));
  const jrmfpEntries = entries.filter((entry) => String(entry?.request?.url || '') === JRMFP_URL);
  const collectTokenEntries = entries.filter((entry) => String(entry?.request?.url || '').includes(COLLECT_TOKEN_URL_KEYWORD));

  const reportSamples = reportEntries.map((entry, index) => {
    const reportForm = parseHarForm(entry);
    return {
      index,
      startedDateTime: entry.startedDateTime,
      success: isReportSuccess(entry?.response?.content?.text),
      appid: reportForm.appid || 'JDLiveCast',
      body: reportForm.body || '',
      t: reportForm.t || '',
      sign: reportForm.sign || '',
      xMlaasAt: getHarHeaderValue(entry, 'x-mlaas-at'),
      sgmContext: getHarHeaderValue(entry, 'sgm-context'),
      response: decodeBase64JsonIfPossible(entry?.response?.content?.text || ''),
      harCookie: buildHarCookie(entry),
    };
  });

  const requestedReportIndex = getRequestedReportIndex();
  const reportEntry = requestedReportIndex !== null && reportEntries[requestedReportIndex]
    ? reportEntries[requestedReportIndex]
    : ([...reportEntries].reverse().find((entry) => isReportSuccess(entry?.response?.content?.text))
      || reportEntries[reportEntries.length - 1]);
  const reportForm = parseHarForm(reportEntry);
  const reportResponse = decodeBase64JsonIfPossible(reportEntry?.response?.content?.text || '');
  const harCookie = buildHarCookie(reportEntry);
  const harCookieMap = parseCookieString(harCookie);
  const policyEntry = policyEntries[policyEntries.length - 1] || null;
  const policyForm = policyEntry ? parseHarForm(policyEntry) : {};
  const policyResponse = policyEntry
    ? decodeBase64JsonIfPossible(policyEntry?.response?.content?.text || '')
    : null;
  const reportEntryIndex = entries.indexOf(reportEntry);
  const warmupEntries = entries
    .slice(0, reportEntryIndex)
    .filter((entry) => {
      const url = String(entry?.request?.url || '');
      return url === JRMFP_URL || isSgmRequest(url);
    })
    .map(normalizeHarRequestEntry);
  const lastJrmfp = [...warmupEntries].reverse().find((entry) => entry.url === JRMFP_URL);
  const nearestSgmEntries = warmupEntries
    .filter((entry) => isSgmRequest(entry.url))
    .slice(-getReplaySgmCount());
  const replaySequence = [...(lastJrmfp ? [lastJrmfp] : []), ...nearestSgmEntries];
  const collectTokenSamples = collectTokenEntries.map((entry, index) => {
    const requestBody = safeJsonParse(String(entry?.request?.postData?.text || ''), {});
    const responseBody = decodeBase64JsonIfPossible(entry?.response?.content?.text || '');
    const responseParsed = responseBody.decodedParsed || responseBody.parsed || {};
    const liveTokenTypeMatch = String(entry?.request?.url || '').match(/liveTokenType=([^&]*)/);

    return {
      index,
      url: String(entry?.request?.url || ''),
      liveTokenType: liveTokenTypeMatch ? decodeURIComponent(liveTokenTypeMatch[1] || '') : '',
      requestPacket: parseBase64Packet(requestBody?.bodyEncrypt || ''),
      responsePacket: parseBase64Packet(responseParsed?.resultData || ''),
      responseRaw: String(responseParsed?.resultData || ''),
    };
  });
  const signSourceAnalysis = buildCollectTokenSignAnalysis(
    collectTokenSamples,
    reportSamples,
    policyEntry
      ? {
          appid: policyForm.appid || 'JDLiveCast',
          body: policyForm.body || '',
          t: policyForm.t || '',
          sign: policyForm.sign || '',
        }
      : null,
  );

  return {
    totalEntries: entries.length,
    policyEntries: policyEntries.length,
    reportEntries: reportEntries.length,
    sgmEntries: sgmEntries.length,
    jrmfpEntries: jrmfpEntries.length,
    collectTokenEntries: collectTokenEntries.length,
    collectTokenSamples,
    signSourceAnalysis,
    reportSamples,
    replaySequence,
    sgmPayloads: sgmEntries
      .map((entry) => String(entry?.request?.postData?.text || '').trim())
      .filter(Boolean),
    report: {
      appid: reportForm.appid || 'JDLiveCast',
      body: reportForm.body || '',
      t: reportForm.t || '',
      sign: reportForm.sign || '',
      xMlaasAt: getHarHeaderValue(reportEntry, 'x-mlaas-at'),
      sgmContext: getHarHeaderValue(reportEntry, 'sgm-context'),
      response: reportResponse,
    },
    policy: policyEntry
      ? {
          appid: policyForm.appid || 'JDLiveCast',
          body: policyForm.body || '',
          t: policyForm.t || '',
          sign: policyForm.sign || '',
          xMlaasAt: getHarHeaderValue(policyEntry, 'x-mlaas-at'),
          sgmContext: getHarHeaderValue(policyEntry, 'sgm-context'),
          response: policyResponse,
        }
      : null,
    harCookie: {
      equipmentId:
        harCookieMap.get('3AB9D23F7A4B3C9B')
        || harCookieMap.get('equipmentId')
        || '',
      jsToken: harCookieMap.get('3AB9D23F7A4B3CSS') || '',
    },
  };
}

function guessSha256Signs(appid, body, t) {
  const candidates = [
    ['appid+body+t', `${appid}${body}${t}`],
    ['body+t', `${body}${t}`],
    ['t+body', `${t}${body}`],
    ['appid+t+body', `${appid}${t}${body}`],
    ['query-raw', `appid=${appid}&body=${body}&t=${t}`],
    ['query-encoded', `appid=${appid}&body=${encodeURIComponent(body)}&t=${t}`],
  ];

  return candidates.map(([label, text]) => ({
    label,
    sign: crypto.createHash('sha256').update(text).digest('hex'),
  }));
}

function getNumberEnvValue(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBasePlayDuration(sampleEvents) {
  const configured = getNumberEnvValue('JDJR_SEEN_LIVESTREAM_BASE_PLAY_DURATION');
  if (configured !== null) {
    return Math.max(0, Math.floor(configured));
  }

  const firstPlayDuration = sampleEvents.find((item) => Number.isFinite(Number(item?.play_duration)));
  const base = firstPlayDuration ? Number(firstPlayDuration.play_duration) : 300000;
  return Math.max(0, Math.floor(base + randomInt(800, 2800)));
}

function remapGroupIds(sampleEvents) {
  const groupMap = new Map();
  for (const item of sampleEvents) {
    const group = String(item?.group || '');
    if (group && !groupMap.has(group)) {
      groupMap.set(group, randomUUID().toUpperCase());
    }
  }
  return groupMap;
}

function buildDynamicReportBody(sampleBody) {
  const samplePayload = safeJsonParse(sampleBody, null);
  const sampleEvents = Array.isArray(samplePayload?.body) ? samplePayload.body : null;
  if (!sampleEvents || !sampleEvents.length) {
    throw new Error('HAR reportApi body 不是有效的事件数组');
  }

  const timestamps = sampleEvents
    .map((item) => Number(item?.ts))
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) {
    throw new Error('HAR reportApi body 缺少 ts 字段');
  }

  const firstTs = Math.min(...timestamps);
  const lastTs = Math.max(...timestamps);
  const sampleSpan = Math.max(0, lastTs - firstTs);
  const now = Date.now();
  const generatedStartTs = now - sampleSpan - randomInt(900, 2100);
  const basePlayDuration = getBasePlayDuration(sampleEvents);
  const groupMap = remapGroupIds(sampleEvents);

  const generatedEvents = sampleEvents.map((event) => {
    const cloned = JSON.parse(JSON.stringify(event));
    const originalTs = Number(event?.ts);
    const relativeTs = Number.isFinite(originalTs) ? originalTs - firstTs : 0;
    const generatedTs = generatedStartTs + relativeTs;

    if (Number.isFinite(originalTs)) {
      cloned.ts = generatedTs;
    }

    if (Number.isFinite(Number(event?.prepared_t))) {
      cloned.prepared_t = generatedTs;
    }

    if (Number.isFinite(Number(event?.prepared_resume_t))) {
      cloned.prepared_resume_t = generatedTs;
    }

    if (Number.isFinite(Number(event?.play_duration))) {
      const firstPlayDuration = Number(sampleEvents[0]?.play_duration || 0);
      const relativePlayDuration = Number(event.play_duration) - firstPlayDuration;
      cloned.play_duration = Math.max(0, basePlayDuration + relativePlayDuration);
    }

    if (cloned.group && groupMap.has(String(cloned.group))) {
      cloned.group = groupMap.get(String(cloned.group));
    }

    return cloned;
  });

  const generatedT = String(lastTs - firstTs + generatedStartTs + randomInt(600, 1800));
  const generatedBody = JSON.stringify({ body: generatedEvents });
  const playDurations = generatedEvents
    .map((item) => Number(item?.play_duration))
    .filter((value) => Number.isFinite(value));

  return {
    body: generatedBody,
    t: generatedT,
    meta: {
      eventCount: generatedEvents.length,
      firstTs: generatedEvents[0]?.ts || '',
      lastTs: generatedEvents[generatedEvents.length - 1]?.ts || '',
      firstPlayDuration: playDurations.length ? playDurations[0] : '',
      lastPlayDuration: playDurations.length ? playDurations[playDurations.length - 1] : '',
      groups: Array.from(new Set(generatedEvents.map((item) => item.group).filter(Boolean))),
    },
  };
}

function buildRuntimeCookie(cookie, harProfile, giasContext) {
  const cookieMap = parseCookieString(cookie);
  const equipmentId = process.env.JDJR_SEEN_LIVESTREAM_EQUIPMENT_ID
    || cookieMap.get('3AB9D23F7A4B3C9B')
    || cookieMap.get('equipmentId')
    || harProfile.harCookie.equipmentId
    || giasContext?.equipmentId
    || DEFAULT_EQUIPMENT_ID;
  const jsToken = process.env.JDJR_SEEN_LIVESTREAM_JS_TOKEN
    || cookieMap.get('3AB9D23F7A4B3CSS')
    || harProfile.harCookie.jsToken
    || giasContext?.jsToken
    || DEFAULT_JS_TOKEN;

  return mergeCookieString(giasContext?.cookie || cookie, {
    '3AB9D23F7A4B3C9B': equipmentId,
    equipmentId,
    '3AB9D23F7A4B3CSS': jsToken,
  });
}

function formatResponseForLog(response) {
  const decoded = decodeBase64JsonIfPossible(response?.body || '');
  if (decoded.decodedParsed) {
    return JSON.stringify(decoded.decodedParsed);
  }
  if (decoded.decodedText) {
    return decoded.decodedText;
  }
  return String(response?.body || '');
}

function logRequest(prefix, requestMeta) {
  console.log(`${prefix}: REQUEST ${requestMeta.method} ${requestMeta.url}`);
  console.log(`${prefix}: REQUEST HEADERS => ${stringifySnippet(requestMeta.headers, 1600)}`);
  if (requestMeta.body !== undefined) {
    console.log(`${prefix}: REQUEST BODY => ${requestMeta.body}`);
  }
}

function logResponse(prefix, response) {
  console.log(`${prefix}: RESPONSE STATUS => ${response.statusCode}`);
  console.log(`${prefix}: RESPONSE BODY => ${formatResponseForLog(response)}`);
}

function buildReplayHeadersFromHar(entry, cookie) {
  const allowedHeaders = new Set([
    'accept',
    'accept-language',
    'content-type',
    'content-encoding',
    'sgm-app-id',
    'sgm-sdk-version',
    'sgm-token',
    'x-mlaas-at',
    'sgm-context',
  ]);

  const headers = {
    Cookie: cookie,
    'User-Agent': DEFAULT_JR_USER_AGENT,
  };

  for (const header of entry.requestHeaders || []) {
    const name = String(header?.name || '');
    const lowerName = name.toLowerCase();
    if (name.startsWith(':') || lowerName === 'cookie' || lowerName === 'content-length') {
      continue;
    }
    if (allowedHeaders.has(lowerName)) {
      headers[name] = String(header.value || '');
    }
  }

  if (!headers.Accept) {
    headers.Accept = '*/*';
  }

  return headers;
}

function buildReportPayload(harProfile) {
  const appid = 'JDLiveCast';
  const generated = process.env.JDJR_SEEN_LIVESTREAM_REPORT_BODY
    ? null
    : buildDynamicReportBody(harProfile.report.body);
  const body = process.env.JDJR_SEEN_LIVESTREAM_REPORT_BODY || generated.body;
  const t = process.env.JDJR_SEEN_LIVESTREAM_REPORT_T || generated.t;
  const sign = process.env.JDJR_SEEN_LIVESTREAM_REPORT_SIGN || harProfile.report.sign;

  if (!body || !t || !sign) {
    throw new Error('reportApi 缺少 body/t/sign，无法发起上报');
  }

  return {
    appid,
    body,
    t,
    sign,
    generatedMeta: generated ? generated.meta : null,
    dynamicBodyEnabled: !process.env.JDJR_SEEN_LIVESTREAM_REPORT_BODY,
  };
}

function buildPolicyPayload(harProfile) {
  if (!harProfile.policy) {
    return null;
  }

  const appid = harProfile.policy.appid || 'JDLiveCast';
  const body = process.env.JDJR_SEEN_LIVESTREAM_POLICY_BODY || harProfile.policy.body;
  const t = process.env.JDJR_SEEN_LIVESTREAM_POLICY_T || harProfile.policy.t;
  const sign = process.env.JDJR_SEEN_LIVESTREAM_POLICY_SIGN || harProfile.policy.sign;

  if (!body || !t || !sign) {
    throw new Error('getPolicy 缺少 body/t/sign，无法发起请求');
  }

  return {
    appid,
    body,
    t,
    sign,
  };
}

async function postJrmfp(prefix, cookie) {
  const headers = buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: DEFAULT_JR_USER_AGENT,
    contentType: 'application/x-www-form-urlencoded;charset=utf-8',
    extraHeaders: {
      Accept: '*/*',
    },
  });

  logRequest(prefix, {
    method: 'POST',
    url: JRMFP_URL,
    headers,
    body: '',
  });

  const response = await got.post(JRMFP_URL, {
    body: '',
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  logResponse(prefix, response);
  return response;
}

async function replayHarRequest(prefix, cookie, harRequest) {
  const headers = buildReplayHeadersFromHar(harRequest, cookie);
  const body = harRequest.requestBody || '';
  logRequest(prefix, {
    method: harRequest.method,
    url: harRequest.url,
    headers,
    body: isDebugEnabled() ? body : `${body.slice(0, 1200)}${body.length > 1200 ? `... [len=${body.length}]` : ''}`,
  });

  const response = await got(harRequest.url, {
    method: harRequest.method,
    body,
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  logResponse(prefix, response);
  return response;
}

async function postSgm(prefix, cookie, harProfile, payload) {
  const traceId = String(Date.now()) + Math.floor(Math.random() * 1000);
  const headers = buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: DEFAULT_JR_USER_AGENT,
    contentType: 'text/plain;charset=UTF-8',
    extraHeaders: {
      Accept: '*/*',
      'x-mlaas-at': `wl=0&id=${traceId}&src=sgm-mobile`,
      'sgm-context': harProfile.report.sgmContext
        ? harProfile.report.sgmContext.replace(/^\d+;\d+;/, `${traceId};${traceId};`)
        : `${traceId};${traceId};false;9HwAEg@vlKkp7SqT8dSSBaj`,
    },
  });

  logRequest(prefix, {
    method: 'POST',
    url: SGM_URL,
    headers,
    body: isDebugEnabled() ? payload : `${payload.slice(0, 1200)}... [len=${payload.length}]`,
  });

  const response = await got.post(SGM_URL, {
    body: payload,
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  logResponse(prefix, response);
  return response;
}

async function postPolicy(prefix, cookie, harProfile) {
  const policyPayload = buildPolicyPayload(harProfile);
  if (!policyPayload) {
    return null;
  }

  const traceId = String(Date.now()) + Math.floor(Math.random() * 1000);
  const form = new URLSearchParams(policyPayload);
  const headers = buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: 'JDJRMobile/619 CFNetwork/3860.300.31 Darwin/25.2.0',
    contentType: 'application/x-www-form-urlencoded;charset=utf-8',
    extraHeaders: {
      Accept: '*/*',
      'x-mlaas-at': harProfile.policy?.xMlaasAt || `wl=0&id=${traceId}&src=sgm-mobile`,
      'sgm-context': harProfile.policy?.sgmContext
        ? harProfile.policy.sgmContext.replace(/^\d+;\d+;/, `${traceId};${traceId};`)
        : `${traceId};${traceId};false;9HwAEg@vlKkp7SqT8dSSBaj`,
      priority: 'u=3',
    },
  });

  logRequest(prefix, {
    method: 'POST',
    url: POLICY_URL,
    headers,
    body: form.toString(),
  });

  const response = await got.post(POLICY_URL, {
    body: form.toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  logResponse(prefix, response);
  return response;
}

async function postReport(prefix, cookie, harProfile) {
  const reportPayload = buildReportPayload(harProfile);
  const traceId = String(Date.now()) + Math.floor(Math.random() * 1000);
  const form = new URLSearchParams({
    appid: reportPayload.appid,
    body: reportPayload.body,
    t: reportPayload.t,
    sign: reportPayload.sign,
  });
  const headers = buildHeaders(cookie, {
    origin: PAGE_ORIGIN,
    referer: PAGE_REFERER,
    userAgent: DEFAULT_JR_USER_AGENT,
    contentType: 'application/x-www-form-urlencoded;charset=utf-8',
    extraHeaders: {
      Accept: '*/*',
      'x-mlaas-at': `wl=0&id=${traceId}&src=sgm-mobile`,
      'sgm-context': harProfile.report.sgmContext
        ? harProfile.report.sgmContext.replace(/^\d+;\d+;/, `${traceId};${traceId};`)
        : `${traceId};${traceId};false;9HwAEg@vlKkp7SqT8dSSBaj`,
    },
  });

  logRequest(prefix, {
    method: 'POST',
    url: REPORT_API_URL,
    headers,
    body: form.toString(),
  });

  const response = await got.post(REPORT_API_URL, {
    body: form.toString(),
    headers,
    throwHttpErrors: false,
    timeout: { request: REQUEST_TIMEOUT_MS },
  });
  logResponse(prefix, response);
  return response;
}

async function tryGetGiasContext(cookie, prefix) {
  try {
    return await getGiasRiskContext(cookie, {
      pageUrl: PAGE_REFERER,
      origin: PAGE_ORIGIN,
      referer: PAGE_REFERER,
      userAgent: DEFAULT_JR_USER_AGENT,
    });
  } catch (error) {
    console.log(`${prefix}: gias 获取失败，继续使用 HAR/默认设备态 => ${error.message}`);
    return null;
  }
}

function logFlowSummary(harProfile) {
  console.log(`HAR 摘要: 总请求 ${harProfile.totalEntries}，collectTokenPin1 ${harProfile.collectTokenEntries}，getPolicy ${harProfile.policyEntries}，jrmfp ${harProfile.jrmfpEntries}，sgm ${harProfile.sgmEntries}，reportApi ${harProfile.reportEntries}`);
  console.log(`HAR 流程: 1) collectTokenPin1 拉取直播签名密钥材料 -> 2) getPolicy 拉取直播策略 -> 3) jrmfp/sgm 设备预热保活 -> 4) reportApi 批量上报 4006 观看进度`);
  if (harProfile.collectTokenSamples.length) {
    const collectSummary = harProfile.collectTokenSamples
      .map((sample) => {
        const requestInfo = sample.requestPacket || {};
        const responseInfo = sample.responsePacket || {};
        return [
          `${sample.index}:${sample.liveTokenType || 'default'}`,
          `reqOp=${requestInfo.opcode ?? '-'}`,
          `reqDeclared=${requestInfo.declaredLength ?? '-'}`,
          `respDeclared=${responseInfo.declaredLength ?? '-'}`,
          `seed=${stringifySnippet(responseInfo.seedHex || '', 40)}`,
        ].join(',');
      })
      .join(' | ');
    console.log(`HAR collectTokenPin1 样本: ${collectSummary}`);
  }
  if (harProfile.signSourceAnalysis) {
    const analysis = harProfile.signSourceAnalysis;
    const responseLengthText = analysis.responseLengths.length
      ? analysis.responseLengths.join(',')
      : '-';
    console.log(`签名分析: collectTokenPin1 响应声明长度=${responseLengthText}，seed=${analysis.responseSeeds.join(' | ') || '-'}，常见 sha256/hmac 拼接=${analysis.matchedFormula ? '命中' : '未命中'}`);
    if (analysis.likelySecretLength) {
      console.log(`签名分析: collectTokenPin1 更像是在返回 ${analysis.likelySecretLength} 字节密钥材料，reportApi/getPolicy 的 sign 不是简单重放值。`);
    }
  }
  if (harProfile.policy) {
    console.log(`HAR getPolicy 样本: body长度=${harProfile.policy.body.length}，t=${harProfile.policy.t}，sign=${harProfile.policy.sign}`);
    console.log(`HAR getPolicy 响应: ${stringifySnippet(harProfile.policy.response?.decodedParsed || harProfile.policy.response?.decodedText || harProfile.policy.response?.raw, 800)}`);
  }
  console.log(`HAR reportApi 样本: appid=${harProfile.report.appid}，body长度=${harProfile.report.body.length}，t=${harProfile.report.t}，sign=${harProfile.report.sign}`);
  console.log(`HAR reportApi 响应: ${stringifySnippet(harProfile.report.response.decodedParsed || harProfile.report.response.decodedText || harProfile.report.response.raw, 800)}`);
  const sampleSummary = harProfile.reportSamples
    .map((sample) => `${sample.index}:${sample.success ? 'success' : 'fail'}@${sample.startedDateTime} body=${sample.body.length}`)
    .join(' | ');
  console.log(`HAR reportApi 全样本: ${sampleSummary}`);
  if (harProfile.replaySequence.length) {
    console.log(`HAR 预热回放序列: ${harProfile.replaySequence.map((item) => item.url.replace('https://', '')).join(' -> ')}`);
  }
}

async function runForAccount(cookie, index, harProfile) {
  const userName = getUserName(cookie);
  const prefix = `账号${index + 1} ${userName}`;
  console.log(`\n==== ${prefix} ====`);

  const reportBodyOverridden = Boolean(process.env.JDJR_SEEN_LIVESTREAM_REPORT_BODY);
  const reportTOverridden = Boolean(process.env.JDJR_SEEN_LIVESTREAM_REPORT_T);
  const reportSignOverridden = Boolean(process.env.JDJR_SEEN_LIVESTREAM_REPORT_SIGN);
  const policyBodyOverridden = Boolean(process.env.JDJR_SEEN_LIVESTREAM_POLICY_BODY);
  const policyTOverridden = Boolean(process.env.JDJR_SEEN_LIVESTREAM_POLICY_T);
  const policySignOverridden = Boolean(process.env.JDJR_SEEN_LIVESTREAM_POLICY_SIGN);
  const reportPayload = buildReportPayload(harProfile);
  if (reportPayload.dynamicBodyEnabled && reportPayload.generatedMeta) {
    console.log(`${prefix}: 动态 body => events=${reportPayload.generatedMeta.eventCount}, ts=${reportPayload.generatedMeta.firstTs}~${reportPayload.generatedMeta.lastTs}, play_duration=${reportPayload.generatedMeta.firstPlayDuration}~${reportPayload.generatedMeta.lastPlayDuration}, groups=${reportPayload.generatedMeta.groups.join(',')}`);
  }
  if ((reportBodyOverridden || reportTOverridden) && !reportSignOverridden) {
    const candidates = guessSha256Signs(reportPayload.appid, reportPayload.body, reportPayload.t);
    console.log(`${prefix}: 你覆盖了 body/t，但没有同步覆盖 sign。当前脚本未反推出真实签名算法，以下是常见 sha256 猜测值，仅供比对：`);
    for (const candidate of candidates) {
      console.log(`${prefix}: sign猜测 ${candidate.label} => ${candidate.sign}`);
    }
  }
  if (harProfile.policy && (policyBodyOverridden || policyTOverridden) && !policySignOverridden) {
    const candidates = guessSha256Signs(harProfile.policy.appid, buildPolicyPayload(harProfile).body, buildPolicyPayload(harProfile).t);
    console.log(`${prefix}: 你覆盖了 getPolicy 的 body/t，但没有同步覆盖 sign。以下是常见 sha256 猜测值，仅供比对：`);
    for (const candidate of candidates) {
      console.log(`${prefix}: getPolicy sign猜测 ${candidate.label} => ${candidate.sign}`);
    }
  }

  const giasContext = await tryGetGiasContext(cookie, prefix);
  const runtimeCookie = buildRuntimeCookie(cookie, harProfile, giasContext);
  const runtimeCookieMap = parseCookieString(runtimeCookie);
  console.log(`${prefix}: 运行时设备态 => equipmentId=${stringifySnippet(runtimeCookieMap.get('equipmentId') || '', 80)} | jsToken=${stringifySnippet(runtimeCookieMap.get('3AB9D23F7A4B3CSS') || '', 120)}`);

  if (harProfile.replaySequence.length) {
    for (let i = 0; i < harProfile.replaySequence.length; i += 1) {
      await replayHarRequest(`${prefix}:warmup#${i + 1}`, runtimeCookie, harProfile.replaySequence[i]);
    }
  } else {
    await postJrmfp(prefix, runtimeCookie);
    const sgmPayloads = harProfile.sgmPayloads.slice(-getReplaySgmCount());
    for (let i = 0; i < sgmPayloads.length; i += 1) {
      await postSgm(`${prefix}:sgm#${i + 1}`, runtimeCookie, harProfile, sgmPayloads[i]);
    }
  }

  if (harProfile.policy) {
    const policyResponse = await postPolicy(`${prefix}:policy`, runtimeCookie, harProfile);
    const policyDecoded = decodeBase64JsonIfPossible(policyResponse?.body || '');
    const policyResult = policyDecoded.decodedParsed || policyDecoded.parsed;
    if (policyResult) {
      console.log(`${prefix}: getPolicy 解析结果 => ${JSON.stringify(policyResult)}`);
    }
  }

  const reportResponse = await postReport(prefix, runtimeCookie, {
    ...harProfile,
    report: {
      ...harProfile.report,
      body: reportPayload.body,
      t: reportPayload.t,
      sign: reportPayload.sign,
    },
  });
  const decoded = decodeBase64JsonIfPossible(reportResponse.body || '');
  const result = decoded.decodedParsed || decoded.parsed;
  if (result) {
    console.log(`${prefix}: reportApi 解析结果 => ${JSON.stringify(result)}`);
  } else {
    console.log(`${prefix}: reportApi 原始返回片段 => ${stringifySnippet(reportResponse.body || '', 800)}`);
  }
}

async function main() {
  const harProfile = extractHarProfile(HAR_PATH);
  logFlowSummary(harProfile);

  if (!cookies.length) {
    console.log('未提供 JD_COOKIE，仅完成 HAR 流程分析，不执行线上请求。');
    return;
  }

  for (let i = 0; i < cookies.length; i += 1) {
    try {
      await runForAccount(cookies[i], i, harProfile);
    } catch (error) {
      console.log(`账号${i + 1} ${getUserName(cookies[i])}: 执行失败 => ${error.message}`);
    }
  }
}

main()
  .catch((error) => {
    console.log(`脚本异常 => ${error.stack || error.message}`);
  })
  .finally(() => {
    $.done();
  });
