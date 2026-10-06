/**
 * Pi Commerce — SMB Daily Tracker -> CSM workspace daily sync
 *
 * Replaces the Kunal tracker script. Sends the full "Sub Raw" and "AdsRun Raw" tabs to the
 * portal every morning; the portal builds the CSM queues (Ads About to End, Ads Ended,
 * Cancelled & Expired) from them.
 *
 * Add this file to the same Apps Script project as the Sub Raw onboarding sync.
 * Script Properties required:
 *   PI_COMMERCE_CSM_SYNC_URL         e.g. https://<portal-domain>/api/internal/csm-sync
 *   PI_COMMERCE_SUB_RAW_SYNC_SECRET  (already set for the onboarding sync; same secret)
 *
 * Run installDailyCsmSyncTrigger() once. Use runCsmSync() any time to refresh by hand.
 */

const CSM_SYNC = {
  SUB_SHEET: 'Sub Raw',
  ADS_SHEET: 'AdsRun Raw',
  TIMEZONE: 'Asia/Kolkata',
  REFRESH_HOUR: 7,
  BATCH_SIZE: 500,
};

function runCsmSync() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('PI_COMMERCE_CSM_SYNC_URL') || '').trim();
  const secret = String(props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_SECRET') || '').trim();
  if (!url || !secret) {
    throw new Error('Missing PI_COMMERCE_CSM_SYNC_URL or PI_COMMERCE_SUB_RAW_SYNC_SECRET in Script Properties.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const subs = readSubs_(ss.getSheetByName(CSM_SYNC.SUB_SHEET));
  const ads = readAds_(ss.getSheetByName(CSM_SYNC.ADS_SHEET));

  const start = csmPost_(url, secret, { action: 'start' });
  const runId = start.runId;
  for (let i = 0; i < subs.length; i += CSM_SYNC.BATCH_SIZE) {
    csmPost_(url, secret, { action: 'subs', runId: runId, rows: subs.slice(i, i + CSM_SYNC.BATCH_SIZE) });
  }
  for (let i = 0; i < ads.length; i += CSM_SYNC.BATCH_SIZE) {
    csmPost_(url, secret, { action: 'ads', runId: runId, rows: ads.slice(i, i + CSM_SYNC.BATCH_SIZE) });
  }
  const done = csmPost_(url, secret, {
    action: 'finish', runId: runId, expectedSubs: subs.length, expectedAds: ads.length,
  });
  console.log('CSM sync complete: ' + JSON.stringify(done));
  return done;
}

function installDailyCsmSyncTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'runCsmSync'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runCsmSync')
    .timeBased()
    .everyDays(1)
    .atHour(CSM_SYNC.REFRESH_HOUR)
    .nearMinute(15)
    .inTimezone(CSM_SYNC.TIMEZONE)
    .create();
}

/** One row per merchant (the last Sub Raw row wins, as in the old tracker). */
function readSubs_(sheet) {
  if (!sheet) throw new Error('Tab "' + CSM_SYNC.SUB_SHEET + '" was not found.');
  const data = readTab_(sheet, ['merchant_cust_id', 'subscription_status']);
  const byCust = {};
  data.rows.forEach(function (row, i) {
    const custId = cell_(row, data.col, 'merchant_cust_id');
    if (!custId) return;
    byCust[custId] = {
      customerId: custId,
      status: cell_(row, data.col, 'subscription_status').toUpperCase(),
      merchantName: cell_(row, data.col, 'merchant_name'),
      phone: cell_(row, data.col, 'phone_number'),
      category: cell_(row, data.col, 'category'),
      subCategory: cell_(row, data.col, 'sub_category'),
      mcc: cell_(row, data.col, 'mcc_code'),
      subFirstDate: date_(data.raw[i][data.col.sub_first_date]),
      sourceRow: i + 2,
    };
  });
  return Object.keys(byCust).map(function (k) { return byCust[k]; });
}

/** Every ad row. */
function readAds_(sheet) {
  if (!sheet) throw new Error('Tab "' + CSM_SYNC.ADS_SHEET + '" was not found.');
  const data = readTab_(sheet, ['CustID', 'Ad_Status', 'Ad_End_Date', 'Clicks']);
  const out = [];
  data.rows.forEach(function (row, i) {
    const custId = cell_(row, data.col, 'CustID');
    if (!custId) return;
    const raw = data.raw[i];
    out.push({
      customerId: custId,
      clientId: cell_(row, data.col, 'Client_ID'),
      mid: cell_(row, data.col, 'MID'),
      merchantName: cell_(row, data.col, 'Merchant_Name'),
      phone: cell_(row, data.col, 'PhoneNo'),
      category: cell_(row, data.col, 'Category'),
      subCategory: cell_(row, data.col, 'Sub_Category'),
      onboardedDate: date_(raw[data.col.Onboarded_Date]),
      creativeName: cell_(row, data.col, 'Ad_Creative_Name'),
      description: cell_(row, data.col, 'Ad_Description'),
      adStatus: cell_(row, data.col, 'Ad_Status').toUpperCase(),
      budget: cell_(row, data.col, 'Ad_Budget'),
      startDate: date_(raw[data.col.Ad_Start_Date]),
      endDate: date_(raw[data.col.Ad_End_Date]),
      impressions: cell_(row, data.col, 'Impressions'),
      clicks: cell_(row, data.col, 'Clicks'),
      ctr: cell_(row, data.col, 'CTR'),
      reach: cell_(row, data.col, 'Reach'),
      spend: cell_(row, data.col, 'Spend'),
      sourceRow: i + 2,
    });
  });
  return out;
}

function readTab_(sheet, required) {
  const range = sheet.getDataRange();
  const display = range.getDisplayValues();
  const raw = range.getValues();
  if (display.length < 2) throw new Error('No data rows in "' + sheet.getName() + '".');
  const col = {};
  display[0].forEach(function (h, i) { const k = String(h || '').trim(); if (k) col[k] = i; });
  const missing = required.filter(function (h) { return col[h] === undefined; });
  if (missing.length) throw new Error('Missing columns in "' + sheet.getName() + '": ' + missing.join(', '));
  return { col: col, rows: display.slice(1), raw: raw.slice(1) };
}

function cell_(row, col, header) {
  return col[header] === undefined ? '' : String(row[col[header]] || '').trim();
}

function date_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, CSM_SYNC.TIMEZONE, 'yyyy-MM-dd');
  }
  const t = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  return isNaN(d) ? '' : Utilities.formatDate(d, CSM_SYNC.TIMEZONE, 'yyyy-MM-dd');
}

function csmPost_(url, secret, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sub-raw-sync-secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('CSM sync failed (' + payload.action + ', HTTP ' + code + '): ' + text);
  return JSON.parse(text);
}
