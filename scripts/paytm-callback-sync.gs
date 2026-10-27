/**
 * Pi Commerce — Merchant Callback Request ("Callbacks" tab) -> Req Call Back panes
 *
 * Paste into the "Merchant Callback Request" sheet: Extensions → Apps Script. Then:
 *   1. Project Settings → Script Properties → add
 *        PI_COMMERCE_PAYTM_CALLBACK_SYNC_URL  https://pi-commerce-call-center-disposition.vercel.app/api/internal/paytm-callback-sync
 *        PI_COMMERCE_SUB_RAW_SYNC_SECRET      (the same secret the Sub Raw / CSM syncs use)
 *   2. Run setupPaytmCallbackTrigger once (approve the permissions). It sends the tab now and then
 *      every 3 hours. Run syncPaytmCallbacks any time to push the latest requests.
 *
 * Reads, by header name: cust_id, id, mid, business_name, phone_number, requested_at, stage, reason,
 * subscription_status, ad_live_status, onboarding_stage. The portal only brings in requests from the
 * last 48 hours and handles each id once, so re-running is safe.
 */
const PCB_SHEET = 'Callbacks';
const PCB_BATCH = 1000;

function setupPaytmCallbackTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncPaytmCallbacks')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncPaytmCallbacks').timeBased().everyHours(3).create();
  syncPaytmCallbacks();
}

function syncPaytmCallbacks() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('PI_COMMERCE_PAYTM_CALLBACK_SYNC_URL');
  const secret = props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_SECRET');
  if (!url || !secret) throw new Error('Set PI_COMMERCE_PAYTM_CALLBACK_SYNC_URL and PI_COMMERCE_SUB_RAW_SYNC_SECRET in Script Properties');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PCB_SHEET);
  if (!sheet) throw new Error('Tab "' + PCB_SHEET + '" not found');
  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0].map(h => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const fields = ['cust_id', 'id', 'mid', 'business_name', 'phone_number', 'requested_at', 'stage', 'reason', 'subscription_status', 'ad_live_status', 'onboarding_stage'];
  const idx = {};
  fields.forEach(f => { idx[f] = header.indexOf(f); });
  ['id', 'phone_number', 'requested_at', 'subscription_status', 'ad_live_status'].forEach(f => {
    if (idx[f] < 0) throw new Error('Missing header: ' + f);
  });
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const v = values[r];
    if (!v[idx.id]) continue;
    const row = {};
    fields.forEach(f => { row[f] = idx[f] >= 0 ? v[idx[f]] : ''; });
    rows.push(row);
  }
  let created = 0, merged = 0;
  for (let i = 0; i < rows.length; i += PCB_BATCH) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-sub-raw-sync-secret': secret },
      payload: JSON.stringify({ rows: rows.slice(i, i + PCB_BATCH) })
    });
    if (res.getResponseCode() !== 200) throw new Error('Portal said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    const j = JSON.parse(res.getContentText()); created += j.created || 0; merged += j.merged || 0;
  }
  console.log('Paytm callback sync: ' + rows.length + ' rows, new requests ' + created + ', repeats within 24h ' + merged);
}
