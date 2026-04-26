/*
咸鱼金豆 HAR 提取器

用途：
1. 解析支付宝/咸鱼抓包 HAR
2. 提取金豆余额、签到状态、活动任务、直接领奖样本
3. 输出后续调试所需的请求模板

环境变量：
- ALI_GOOFISH_HAR_PATH
  自定义 HAR 文件路径。
  默认：
  /Users/lifeng/PycharmProjects/jd-http-runner/files/traffic_zhifubao_goofish_sign_and_do_task_0426_filtered.har
*/

'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPT_NAME = '咸鱼金豆 HAR 提取器';
const DEFAULT_HAR_PATH = '/Users/lifeng/PycharmProjects/jd-http-runner/files/traffic_zhifubao_goofish_sign_and_do_task_0426_filtered.har';
const BROWSE_WAIT_MS = 15000;

const API_NAME_MAP = {
  'mtop.taobao.idle.point.pointbank.accountinfo': 'accountinfo',
  'mtop.taobao.idle.play.sign.in.home': 'signInHome',
  'mtop.taobao.idle.play.sign.in': 'signIn',
  'mtop.taobao.idle.wx.alipay.task.center.user.signin': 'alipaySignin',
  'mtop.taobao.idle.oliver.show': 'oliverShow',
  'mtop.taobao.idle.cube.task.trigger': 'taskTrigger',
  'mtop.taobao.idle.joy.community.activity.task.award': 'taskAward',
  'mtop.taobao.idle.oliver.issue': 'oliverIssue'
};

function log(message) {
  console.log(`[${SCRIPT_NAME}] ${message}`);
}

function safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeFormBody(text) {
  const result = {};
  if (!text) {
    return result;
  }
  for (const pair of text.split('&')) {
    const [rawKey, rawValue = ''] = pair.split('=');
    const key = decodeURIComponent(rawKey || '');
    const value = decodeURIComponent(rawValue || '');
    result[key] = value;
  }
  return result;
}

function parseEmbeddedBrowseTarget(action) {
  if (!action || typeof action !== 'string') {
    return { kind: 'none', browseUrl: '' };
  }

  if (/^https?:\/\//i.test(action)) {
    return { kind: 'direct_h5', browseUrl: action };
  }

  if (action.startsWith('fleamarket://')) {
    try {
      const url = new URL(action);
      const forwardUrl = url.searchParams.get('forward_url');
      if (forwardUrl && /^https?:\/\//i.test(forwardUrl)) {
        return { kind: 'goofish_h5', browseUrl: forwardUrl };
      }
      return { kind: 'goofish_app', browseUrl: '' };
    } catch {
      return { kind: 'goofish_app', browseUrl: '' };
    }
  }

  if (action.startsWith('alipays://')) {
    try {
      const url = new URL(action);
      const embeddedUrl = url.searchParams.get('url');
      if (embeddedUrl && /^https?:\/\//i.test(embeddedUrl)) {
        return { kind: 'alipay_h5', browseUrl: embeddedUrl };
      }
      const page = url.searchParams.get('page');
      if (page) {
        return { kind: 'alipay_miniapp', browseUrl: '' };
      }
      return { kind: 'alipay_app', browseUrl: '' };
    } catch {
      return { kind: 'alipay_app', browseUrl: '' };
    }
  }

  return { kind: 'unknown', browseUrl: '' };
}

function findApiName(url) {
  return Object.keys(API_NAME_MAP).find((apiName) => url.includes(apiName)) || null;
}

function readHarFile(harPath) {
  const content = fs.readFileSync(harPath, 'utf8');
  const har = JSON.parse(content);
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  return entries;
}

function normalizeEntry(entry) {
  const request = entry.request || {};
  const response = entry.response || {};
  const url = request.url || '';
  const apiName = findApiName(url);
  if (!apiName) {
    return null;
  }

  const formBody = decodeFormBody(request?.postData?.text || '');
  const requestData = safeJsonParse(formBody.data, formBody.data || null);
  const responseText = response?.content?.text || '';
  const responseJson = safeJsonParse(responseText, null);
  const headers = Object.fromEntries(
    (request.headers || []).map((item) => [String(item.name || '').toLowerCase(), item.value || ''])
  );

  return {
    apiName,
    apiKey: API_NAME_MAP[apiName],
    url,
    method: request.method || 'GET',
    requestData,
    formBody,
    headers,
    responseJson,
    responseText
  };
}

function buildTaskTitleMap(activities) {
  const taskTitleMap = new Map();
  for (const activity of activities) {
    for (const task of activity.tasks) {
      taskTitleMap.set(String(task.taskId), task.title);
    }
  }
  return taskTitleMap;
}

function buildTaskKey(activityId, taskId) {
  return `${String(activityId || '')}:${String(taskId || '')}`;
}

function getTriggerSampleScore(sample) {
  let score = 0;
  if (sample.success) {
    score += 10;
  }
  if (sample.triggerStatus === 'AWARD' && Number(sample.triggerStatusValue) === 1) {
    score += 100;
  } else if (sample.triggerStatus && sample.triggerStatus !== '-') {
    score += 50;
  }
  if (sample.taskTitle && sample.taskTitle !== '未知任务') {
    score += 5;
  }
  return score;
}

function extractActivities(records) {
  const activityMap = new Map();
  for (const record of records) {
    if (record.apiKey !== 'oliverShow' || !record.responseJson?.data?.activityDO) {
      continue;
    }

    const data = record.responseJson.data;
    const activityDO = data.activityDO || {};
    const taskList = Array.isArray(data.taskList) ? data.taskList : [];

    const tasks = taskList.map((task) => ({
      materialAction: task?.materialDTO?.action || '',
      taskId: String(task.taskInstanceId || ''),
      title: task?.materialDTO?.title || '未知任务',
      status: task?.idleTaskStatus || '-',
      statusValue: task?.idleTaskStatusValue ?? -1,
      pointNum: task?.extend?.pointNum ?? null,
      awardThreshold: task?.extend?.awardThreshold ?? null,
      taskType: task?.extend?.taskType || '-',
      browse: parseEmbeddedBrowseTarget(task?.materialDTO?.action || '')
    }));

    activityMap.set(String(activityDO.activityId || ''), {
      activityId: String(activityDO.activityId || ''),
      asac: activityDO.asac || '',
      pointBalance: activityDO.pointBalance || activityDO.availableTimes || '-',
      availableTimes: activityDO.availableTimes || '-',
      taskCount: tasks.length,
      tasks
    });
  }

  return Array.from(activityMap.values()).map((record) => {
    return {
      activityId: record.activityId,
      asac: record.asac,
      pointBalance: record.pointBalance,
      availableTimes: record.availableTimes,
      taskCount: record.taskCount,
      tasks: record.tasks
    };
  });
}

function extractAwardSamples(records, taskTitleMap) {
  return records
    .filter((record) => record.apiKey === 'taskAward')
    .map((record) => {
      const body = record.requestData || {};
      const responseData = record.responseJson?.data || {};
      const taskId = String(body.taskId || '');
      return {
        activityId: String(body.activityId || ''),
        asac: body.asac || '',
        taskId,
        taskTitle: taskTitleMap.get(taskId) || '未知任务',
        awardIndexList: body.awardIndexList || '',
        success: record.responseJson?.ret?.[0] === 'SUCCESS::调用成功',
        responseSummary: responseData?.awardTitle || responseData?.toast || record.responseJson?.ret?.[0] || '-',
        requestTemplate: {
          url: record.url,
          headers: {
            'user-agent': record.headers['user-agent'] || '',
            'x-sign': record.headers['x-sign'] || '',
            'x-mini-wua': record.headers['x-mini-wua'] || '',
            'x-sgext': record.headers['x-sgext'] || '',
            'x-t': record.headers['x-t'] || '',
            'x-umt': record.headers['x-umt'] || '',
            'x-appkey': record.headers['x-appkey'] || '',
            'x-ttid': record.headers['x-ttid'] || '',
            'content-type': record.headers['content-type'] || ''
          },
          body: record.formBody.data || ''
        }
      };
    });
}

function extractTriggerSamples(records, taskTitleMap) {
  const sampleMap = new Map();

  for (const record of records) {
    if (record.apiKey !== 'taskTrigger') {
      continue;
    }

      const body = record.requestData || {};
      const responseData = record.responseJson?.data?.idleTaskDTO || {};
      const taskId = String(body.taskInstanceId || '');
      const sample = {
        activityId: String(body.activityId || ''),
        taskId,
        taskTitle: taskTitleMap.get(taskId) || responseData?.materialDTO?.title || '未知任务',
        success: record.responseJson?.ret?.[0] === 'SUCCESS::调用成功',
        triggerStatus: responseData?.idleTaskStatus || '-',
        triggerStatusValue: responseData?.idleTaskStatusValue ?? '-',
        requestTemplate: {
          api: 'mtop.taobao.idle.cube.task.trigger',
          body: {
            taskInstanceId: taskId,
            idempotentKey: body.idempotentKey || '<Date.now()>',
            activityId: String(body.activityId || '')
          }
        }
      };
      const sampleKey = buildTaskKey(sample.activityId, sample.taskId);
      const existingSample = sampleMap.get(sampleKey);
      if (!existingSample || getTriggerSampleScore(sample) > getTriggerSampleScore(existingSample)) {
        sampleMap.set(sampleKey, sample);
      }
    }

  return Array.from(sampleMap.values());
}

function extractSummary(records) {
  const accountInfo = records.find((record) => record.apiKey === 'accountinfo');
  const signInHome = records.find((record) => record.apiKey === 'signInHome');
  const signIn = records.find((record) => record.apiKey === 'signIn');
  const alipaySignin = records.find((record) => record.apiKey === 'alipaySignin');

  return {
    balance: accountInfo?.responseJson?.data?.balance || '-',
    soonExpireValue: accountInfo?.responseJson?.data?.valueToExpire || '-',
    signInAwarded: signInHome?.responseJson?.data?.signInAwarded ?? null,
    signInDays: signIn?.responseJson?.data?.signInDays || '-',
    playSignSuccess: signIn?.responseJson?.data?.signInAwarded ?? null,
    alipayTaskCenterSignin: alipaySignin?.responseJson?.data?.result || '-'
  };
}

function printSummary(summary, activities, triggerSamples, awardSamples) {
  log(`金豆余额 => ${summary.balance}`);
  log(`即将过期金豆 => ${summary.soonExpireValue}`);
  log(`玩法签到首页状态 => signInAwarded=${summary.signInAwarded}`);
  log(`玩法签到结果 => success=${summary.playSignSuccess} | signInDays=${summary.signInDays}`);
  log(`支付宝任务中心签到 => ${summary.alipayTaskCenterSignin}`);
  log(`活动数 => ${activities.length}`);

  for (const activity of activities) {
    log(
      `活动 ${activity.activityId} => asac=${activity.asac} | 可用金豆=${activity.pointBalance} | 任务数=${activity.taskCount}`
    );
    for (const task of activity.tasks) {
      log(
        `  - ${task.title} | taskId=${task.taskId} | status=${task.status}/${task.statusValue} | point=${task.pointNum} | taskType=${task.taskType} | browseKind=${task.browse.kind}`
      );
    }
  }

  log(`trigger样本数 => ${triggerSamples.length}`);
  for (const sample of triggerSamples) {
    log(
      `  > ${sample.taskTitle} | taskId=${sample.taskId} | activityId=${sample.activityId} | success=${sample.success} | trigger=${sample.triggerStatus}/${sample.triggerStatusValue}`
    );
  }

  log(`直接领奖样本数 => ${awardSamples.length}`);
  for (const sample of awardSamples) {
    log(
      `  * ${sample.taskTitle} | taskId=${sample.taskId} | activityId=${sample.activityId} | success=${sample.success} | result=${sample.responseSummary}`
    );
  }
}

function getBrowseCandidateTasks(activities) {
  const candidates = [];
  for (const activity of activities) {
    for (const task of activity.tasks) {
      const isPending = task.status === 'ACCEPTED' && Number(task.statusValue) === 0;
      const isBrowseTask = task.taskType === 'click_task';
      const canSimulate = Boolean(task.browse.browseUrl);
      if (isPending && isBrowseTask && canSimulate) {
        candidates.push({
          activityId: activity.activityId,
          taskId: task.taskId,
          title: task.title,
          browseKind: task.browse.kind,
          browseUrl: task.browse.browseUrl
        });
      }
    }
  }
  return candidates;
}

function shouldSkipBrowseExperiment(template) {
  return template.awardSeenInHar && !template.triggerSeenInHar;
}

function buildBrowseFlowTemplates(activities, triggerSamples, awardSamples) {
  const triggerMap = new Map(
    triggerSamples.map((sample) => [
      buildTaskKey(sample.activityId, sample.taskId),
      {
        triggerStatus: sample.triggerStatus,
        triggerStatusValue: sample.triggerStatusValue,
        requestTemplate: sample.requestTemplate
      }
    ])
  );
  const awardMap = new Map(
    awardSamples.map((sample) => [
      buildTaskKey(sample.activityId, sample.taskId),
      {
        awardIndexList: sample.awardIndexList || '1'
      }
    ])
  );

  const templates = [];
  for (const activity of activities) {
    for (const task of activity.tasks) {
      const isPending = task.status === 'ACCEPTED' && Number(task.statusValue) === 0;
      const isBrowseTask = task.taskType === 'click_task';
      const canSimulate = Boolean(task.browse.browseUrl);
      if (!isPending || !isBrowseTask || !canSimulate) {
        continue;
      }

      const taskKey = buildTaskKey(activity.activityId, task.taskId);
      const triggerSample = triggerMap.get(taskKey) || null;
      const awardSample = awardMap.get(taskKey) || null;
      templates.push({
        activityId: activity.activityId,
        asac: activity.asac,
        taskId: task.taskId,
        title: task.title,
        pointNum: task.pointNum,
        browseKind: task.browse.kind,
        browseUrl: task.browse.browseUrl,
        waitMs: BROWSE_WAIT_MS,
        triggerSeenInHar: Boolean(triggerSample),
        triggerResultInHar: triggerSample
          ? `${triggerSample.triggerStatus}/${triggerSample.triggerStatusValue}`
          : '-',
        triggerRequest: triggerSample
          ? triggerSample.requestTemplate
          : {
              api: 'mtop.taobao.idle.cube.task.trigger',
              body: {
                taskInstanceId: task.taskId,
                idempotentKey: '<Date.now()>',
                activityId: activity.activityId
              }
            },
        awardSeenInHar: Boolean(awardSample),
        awardRequest: awardSample
          ? {
              api: 'mtop.taobao.idle.joy.community.activity.task.award',
              body: {
                taskId: task.taskId,
                activityId: activity.activityId,
                asac: activity.asac,
                awardIndexList: awardSample.awardIndexList
              }
            }
          : null,
        verifyRequest: {
          api: 'mtop.taobao.idle.oliver.show',
          body: {
            needDetails: true,
            needBenefits: true,
            activityId: activity.activityId,
            withInventoryDetail: false,
            needHadWin: true,
            showEmptyInventory: false
          }
        }
      });
    }
  }
  return templates.sort((left, right) => {
    const leftScore = Number(left.triggerSeenInHar) * 10 + Number(left.awardSeenInHar) * 20;
    const rightScore = Number(right.triggerSeenInHar) * 10 + Number(right.awardSeenInHar) * 20;
    return rightScore - leftScore;
  });
}

function printBrowseFlowTemplates(flowTemplates) {
  log(`动态浏览流程模板数 => ${flowTemplates.length}`);
  for (const template of flowTemplates) {
    let evidence = '仅生成浏览模板';
    if (template.triggerSeenInHar && template.awardSeenInHar) {
      evidence = 'HAR已见trigger+award';
    } else if (template.awardSeenInHar) {
      evidence = 'HAR已见award';
    } else if (template.triggerSeenInHar) {
      evidence = 'HAR已见trigger';
    }
    log(
      `  # ${template.title} | taskId=${template.taskId} | activityId=${template.activityId} | kind=${template.browseKind} | trigger=${template.triggerResultInHar} | triggerSeen=${template.triggerSeenInHar} | awardSeen=${template.awardSeenInHar} | ${evidence}`
    );
  }
}

async function simulateBrowseTasks(tasks) {
  if (!tasks.length) {
    log('可模拟浏览任务数 => 0');
    return [];
  }

  log(`可模拟浏览任务数 => ${tasks.length}`);
  const results = [];
  for (const task of tasks) {
    log(`开始浏览 => ${task.title} | taskId=${task.taskId} | kind=${task.browseKind}`);
    try {
      const response = await fetch(task.browseUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'user-agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Ariver/1.0.0 AliApp(AP/10.8.60.6000) NebulaSDK/1.8.100112 Nebula WK RVKType(1) AlipayDefined(nt:WIFI,ws:390|763|3.00) Language/zh-Hans Region/CN MiniProgram'
        }
      });
      log(`打开页面 => status=${response.status} | url=${response.url}`);
      await sleep(BROWSE_WAIT_MS);
      log(`浏览完成15s => ${task.title}`);
      results.push({
        ...task,
        ok: true,
        status: response.status,
        finalUrl: response.url
      });
    } catch (error) {
      log(`浏览失败 => ${task.title} | error=${error.message}`);
      results.push({
        ...task,
        ok: false,
        error: error.message
      });
    }
  }
  return results;
}

function writeReport(reportPath, payload) {
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function run() {
  const harPath = process.env.ALI_GOOFISH_HAR_PATH || DEFAULT_HAR_PATH;
  if (!fs.existsSync(harPath)) {
    throw new Error(`HAR 文件不存在：${harPath}`);
  }

  const entries = readHarFile(harPath);
  const records = entries.map(normalizeEntry).filter(Boolean);
  const activities = extractActivities(records);
  const taskTitleMap = buildTaskTitleMap(activities);
  const triggerSamples = extractTriggerSamples(records, taskTitleMap);
  const awardSamples = extractAwardSamples(records, taskTitleMap);
  const summary = extractSummary(records);
  const browseCandidates = getBrowseCandidateTasks(activities);
  const browseFlowTemplates = buildBrowseFlowTemplates(activities, triggerSamples, awardSamples);
  const executableBrowseCandidates = browseFlowTemplates
    .filter((template) => !shouldSkipBrowseExperiment(template))
    .map((template) => ({
      activityId: template.activityId,
      taskId: template.taskId,
      title: template.title,
      browseKind: template.browseKind,
      browseUrl: template.browseUrl
    }));

  printSummary(summary, activities, triggerSamples, awardSamples);
  printBrowseFlowTemplates(browseFlowTemplates);

  const reportPath = path.join(
    path.dirname(harPath),
    `${path.basename(harPath, path.extname(harPath))}_report.json`
  );

  writeReport(reportPath, {
    sourceHar: harPath,
    summary,
    activities,
    triggerSamples,
    browseCandidates,
    executableBrowseCandidates,
    browseFlowTemplates,
    awardSamples,
    note: [
      '这些 MTOP 请求使用的是支付宝/咸鱼容器签名头，不是普通 H5 sign。',
      'x-sign / x-mini-wua / x-sgext / x-umt / x-t 来自原生容器链路，不能直接在纯 Node 环境稳定复算。',
      '当前脚本用于沉淀 HAR 样本与任务结构，不假装自动化复现签名。'
    ]
  });

  log(`报告已写出 => ${reportPath}`);

  if (process.env.ALI_GOOFISH_SIMULATE_BROWSE === '1') {
    await simulateBrowseTasks(executableBrowseCandidates);
  }
}

run().catch((error) => {
  console.error(`[${SCRIPT_NAME}] 执行失败：${error.message}`);
  process.exitCode = 1;
});
