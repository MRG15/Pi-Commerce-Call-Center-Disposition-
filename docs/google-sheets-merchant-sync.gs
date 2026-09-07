/*
Pi Commerce merchant information nightly sync.
Attach this script to the Google Sheet that contains the Onboardings tab.

Script Properties required:
  PI_MERCHANT_SYNC_URL    e.g. https://<portal-domain>/api/admin/merchant-sync
  PI_MERCHANT_SYNC_SECRET same secret configured in Vercel as MERCHANT_SYNC_SECRET

Set the Apps Script project timezone to Asia/Kolkata.
Run createNightlyTrigger() once to schedule the daily sync around 2:30 AM IST.
*/

function normalizeCell(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  var s = String(value).trim();
  return s || null;
}

function syncMerchantInformation() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('PI_MERCHANT_SYNC_URL');
  var secret = props.getProperty('PI_MERCHANT_SYNC_SECRET');
  if (!url || !secret) throw new Error('Missing PI_MERCHANT_SYNC_URL or PI_MERCHANT_SYNC_SECRET script property');

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheets()[0]; // Tab 1 is authoritative.
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('No merchant rows found in Tab 1');

  var headers = values[0].map(function(v) { return String(v || '').trim(); });
  var index = {};
  headers.forEach(function(h, i) { index[h] = i; });

  var required = ['merchant_cust_id', 'merchant_name', 'phone_number', 'category', 'sub_category'];
  required.forEach(function(h) {
    if (index[h] === undefined) throw new Error('Missing required column: ' + h);
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var customerId = normalizeCell(values[r][index.merchant_cust_id]);
    if (!customerId) continue;
    rows.push({
      customer_id: customerId,
      merchant_name: normalizeCell(values[r][index.merchant_name]),
      phone_number: normalizeCell(values[r][index.phone_number]),
      category: normalizeCell(values[r][index.category]),
      sub_category: normalizeCell(values[r][index.sub_category])
    });
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-merchant-sync-secret': secret },
    payload: JSON.stringify({
      source: spreadsheet.getName() + ' / ' + sheet.getName(),
      rows: rows
    }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error('Merchant sync failed (' + code + '): ' + body);
  console.log('Merchant sync complete: ' + body);
}

function createNightlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncMerchantInformation') ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('syncMerchantInformation')
    .timeBased()
    .atHour(2)
    .nearMinute(30)
    .everyDays(1)
    .create();
}
