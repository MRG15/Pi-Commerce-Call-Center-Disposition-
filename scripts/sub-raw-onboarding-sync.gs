/**
 * Pi Commerce — Sub Raw -> Onboarding T-1 Sync
 *
 * Source of truth: ONLY the "Sub Raw" tab.
 * Required headers:
 *   merchant_cust_id
 *   sub_first_date
 *   total_ads_executed
 *   first_ad_date
 *
 * Script Properties required:
 *   PI_COMMERCE_SUB_RAW_SYNC_URL
 *   PI_COMMERCE_SUB_RAW_SYNC_SECRET
 *
 * Recommended Apps Script project timezone: Asia/Kolkata
 */

const SUB_RAW_SHEET = 'Sub Raw';
const LOG_SHEET = 'Onboarding Sync Log';
const TIMEZONE = 'Asia/Kolkata';
const BATCH_SIZE = 75;

function runSubRawOnboardingSync() {
  return syncSubRawOnboarding_(false);
}

function previewSubRawOnboardingSync() {
  return syncSubRawOnboarding_(true);
}

function installDailySubRawSyncTrigger() {
  // Remove only this script's prior daily sync triggers so install is idempotent.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runSubRawOnboardingSync')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('runSubRawOnboardingSync')
    .timeBased()
    .everyDays(1)
    .atHour(11)
    .create();
}

function syncSubRawOnboarding_(dryRun) {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_URL') || '').trim();
  const secret = String(props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_SECRET') || '').trim();
  if (!url || !secret) {
    throw new Error('Missing PI_COMMERCE_SUB_RAW_SYNC_URL or PI_COMMERCE_SUB_RAW_SYNC_SECRET in Script Properties.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SUB_RAW_SHEET);
  if (!sheet) throw new Error('Sheet "' + SUB_RAW_SHEET + '" not found.');

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    writeSyncLog_(ss, {
      dryRun: dryRun,
      cutoffDate: getTMinusOneDate_(),
      sourceRows: 0,
      eligibleRows: 0,
      status: 'NO_DATA'
    });
    return;
  }

  const headers = values[0].map(h => String(h).trim().toLowerCase());
  const idx = {
    customerId: headers.indexOf('merchant_cust_id'),
    subFirstDate: headers.indexOf('sub_first_date'),
    totalAdsExecuted: headers.indexOf('total_ads_executed'),
    firstAdDate: headers.indexOf('first_ad_date')
  };

  Object.keys(idx).forEach(k => {
    if (idx[k] < 0) throw new Error('Required header missing in Sub Raw: ' + k);
  });

  const cutoffDate = getTMinusOneDate_();
  const deduped = {};
  const localErrors = [];

  for (let r = 1; r < values.length; r++) {
    const sourceRow = r + 1;
    const rawCustomerId = values[r][idx.customerId];
    const customerId = String(rawCustomerId == null ? '' : rawCustomerId).trim().replace(/\.0$/, '');
    const subFirstDate = normalizeSheetDate_(values[r][idx.subFirstDate]);
    const firstAdDate = normalizeSheetDate_(values[r][idx.firstAdDate]);
    const adsRaw = values[r][idx.totalAdsExecuted];
    const totalAdsExecuted = adsRaw === '' || adsRaw == null
      ? 0
      : Number(String(adsRaw).replace(/,/g, ''));

    if (!/^\d+$/.test(customerId)) {
      localErrors.push('Row ' + sourceRow + ': invalid customer ID');
      continue;
    }
    if (!subFirstDate) {
      localErrors.push('Row ' + sourceRow + ': invalid sub_first_date');
      continue;
    }
    if (!Number.isFinite(totalAdsExecuted) || totalAdsExecuted < 0) {
      localErrors.push('Row ' + sourceRow + ': invalid total_ads_executed');
      continue;
    }

    // T-1 hygiene: do not send subscriptions newer than yesterday.
    if (subFirstDate > cutoffDate) continue;

    deduped[customerId] = {
      customerId: customerId,
      subFirstDate: subFirstDate,
      totalAdsExecuted: totalAdsExecuted,
      firstAdDate: firstAdDate || '',
      sourceRow: sourceRow
    };
  }

  const rows = Object.keys(deduped).map(k => deduped[k]);
  const totals = {
    inputRows: 0,
    eligibleRows: 0,
    invalidRows: [],
    createdOpenDhruv: 0,
    createdOpenAshish: 0,
    createdExternalLive: 0,
    existingMarkedExternalLive: 0,
    alreadyAdsLive: 0,
    existingOpenNoChange: 0,
    lostNoChange: 0,
    otherNoChange: 0,
    missingFirstAdDate: 0,
    actions: []
  };

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-sub-raw-sync-secret': secret
      },
      payload: JSON.stringify({
        cutoffDate: cutoffDate,
        dryRun: dryRun,
        rows: batch
      }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const bodyText = response.getContentText();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      throw new Error('Sync API returned non-JSON response (' + code + '): ' + bodyText);
    }
    if (code < 200 || code >= 300 || !body.ok) {
      throw new Error('Sync API failed (' + code + '): ' + (body.error || bodyText));
    }

    mergeSummary_(totals, body);
  }

  writeSyncLog_(ss, {
    dryRun: dryRun,
    cutoffDate: cutoffDate,
    sourceRows: values.length - 1,
    eligibleRows: rows.length,
    localErrors: localErrors,
    totals: totals,
    status: 'SUCCESS'
  });

  Logger.log(JSON.stringify({
    cutoffDate: cutoffDate,
    dryRun: dryRun,
    localErrors: localErrors,
    totals: totals
  }, null, 2));

  return totals;
}

function mergeSummary_(target, source) {
  const numericKeys = [
    'inputRows','eligibleRows','createdOpenDhruv','createdOpenAshish',
    'createdExternalLive','existingMarkedExternalLive','alreadyAdsLive',
    'existingOpenNoChange','lostNoChange','otherNoChange','missingFirstAdDate'
  ];
  numericKeys.forEach(k => target[k] = Number(target[k] || 0) + Number(source[k] || 0));
  target.invalidRows = target.invalidRows.concat(source.invalidRows || []);
  target.actions = target.actions.concat(source.actions || []);
}

function getTMinusOneDate_() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return Utilities.formatDate(yesterday, TIMEZONE, 'yyyy-MM-dd');
}

function normalizeSheetDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  }

  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) {
    const dd = ('0' + m[1]).slice(-2);
    const mm = ('0' + m[2]).slice(-2);
    return m[3] + '-' + mm + '-' + dd;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  return '';
}

function writeSyncLog_(ss, data) {
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow([
      'Run Time IST','Mode','Cutoff Date','Source Rows','Eligible Rows',
      'New Open -> Dhruv','New Open -> Ashish',
      'New External Live','Existing -> External Live',
      'Already Ads Live','Open No Change','Lost No Change',
      'Missing First Ad Date','Errors','Status'
    ]);
    sheet.setFrozenRows(1);
  }

  const t = data.totals || {};
  const errors = (data.localErrors || []).concat(t.invalidRows || []);
  sheet.appendRow([
    Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    data.dryRun ? 'DRY RUN' : 'LIVE',
    data.cutoffDate || '',
    data.sourceRows || 0,
    data.eligibleRows || 0,
    t.createdOpenDhruv || 0,
    t.createdOpenAshish || 0,
    t.createdExternalLive || 0,
    t.existingMarkedExternalLive || 0,
    t.alreadyAdsLive || 0,
    t.existingOpenNoChange || 0,
    t.lostNoChange || 0,
    t.missingFirstAdDate || 0,
    errors.join(' | '),
    data.status || ''
  ]);
}
