/**
 * Pi Commerce — Meta Lead Form sheet -> Lead Gen Ads (Seller workspace)
 *
 * Paste into the lead sheet: Extensions → Apps Script. Then:
 *   1. Project Settings → Script Properties → add
 *        PI_COMMERCE_LEADGEN_SYNC_URL     https://pi-commerce-call-center-disposition.vercel.app/api/internal/leadgen-sync
 *        PI_COMMERCE_SUB_RAW_SYNC_SECRET  (the same secret the Sub Raw / CSM syncs use)
 *   2. Run setupLeadgenTrigger once (approve the permissions). It sends every row now and then
 *      only new rows every 5 minutes.
 *
 * Reads the first tab with these headers (row 1): id, created_time, ad_name, adset_name,
 * campaign_name, form_name, platform, full_name, phone_number. Repeated rows are fine: the
 * portal counts each Meta lead once, and one person submitting several times within 24 hours
 * as one lead.
 */

const LEADGEN_SHEET_NAME = ''; // leave empty to use the first tab
const LEADGEN_BATCH = 500;
const LEADGEN_FIELDS = ['id','created_time','ad_name','adset_name','campaign_name','form_name','platform','full_name','phone_number'];

function setupLeadgenTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncLeadgenLeads')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncLeadgenLeads').timeBased().everyMinutes(5).create();
  syncLeadgenLeads();
}

// Sends rows added since the last successful run.
function syncLeadgenLeads() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('PI_COMMERCE_LEADGEN_SYNC_URL');
    const secret = props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_SECRET');
    if (!url || !secret) throw new Error('Set PI_COMMERCE_LEADGEN_SYNC_URL and PI_COMMERCE_SUB_RAW_SYNC_SECRET in Script Properties');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = LEADGEN_SHEET_NAME ? ss.getSheetByName(LEADGEN_SHEET_NAME) : ss.getSheets()[0];
    const values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) return;
    const header = values[0].map(h => String(h).trim().toLowerCase());
    const idx = {};
    LEADGEN_FIELDS.forEach(f => { idx[f] = header.indexOf(f); });
    if (idx.id < 0 || idx.phone_number < 0 || idx.created_time < 0) throw new Error('Missing id / created_time / phone_number headers');

    const done = Number(props.getProperty('LEADGEN_LAST_ROW') || '1'); // sheet rows already sent (incl. header)
    const rows = [];
    for (let r = Math.max(done, 1); r < values.length; r++) {
      const row = {};
      LEADGEN_FIELDS.forEach(f => { row[f] = idx[f] >= 0 ? values[r][idx[f]] : ''; });
      if (row.id && row.phone_number) rows.push(row);
    }
    let summary = { created: 0, merged: 0, skipped: 0, linked: 0, assigned: 0 };
    for (let i = 0; i < rows.length || i === 0; i += LEADGEN_BATCH) {
      const res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-sub-raw-sync-secret': secret },
        payload: JSON.stringify({ rows: rows.slice(i, i + LEADGEN_BATCH) })
      });
      if (res.getResponseCode() !== 200) throw new Error('Portal said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
      const j = JSON.parse(res.getContentText());
      ['created','merged','skipped','linked','assigned'].forEach(k => { summary[k] += Number(j[k] || 0); });
      if (!rows.length) break;
    }
    props.setProperty('LEADGEN_LAST_ROW', String(values.length));
    console.log('Lead gen sync: ' + rows.length + ' rows sent ' + JSON.stringify(summary));
  } finally {
    lock.releaseLock();
  }
}

// Sends the whole sheet again (safe: leads already in the portal are skipped).
function resendAllLeadgenLeads() {
  PropertiesService.getScriptProperties().setProperty('LEADGEN_LAST_ROW', '1');
  syncLeadgenLeads();
}
