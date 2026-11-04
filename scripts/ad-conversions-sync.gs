/**
 * Pi Commerce — SMB Ad Performance Data ("All customers" tab) -> CSM workspace conversations
 *
 * Paste into the "SMB Ad Performance Data" sheet: Extensions → Apps Script. Then:
 *   1. Project Settings → Script Properties → add
 *        PI_COMMERCE_AD_CONVERSIONS_SYNC_URL  https://pi-commerce-call-center-disposition.vercel.app/api/internal/ad-conversions-sync
 *        PI_COMMERCE_SUB_RAW_SYNC_SECRET      (the same secret the Sub Raw / CSM syncs use)
 *   2. Run setupAdConversionsTrigger once (approve the permissions). It sends the tab now and then
 *      every day at about 9:40 AM, alongside the CSM sync (set the Apps Script time zone to
 *      Asia/Kolkata in Project Settings). Run syncAdConversions any time to push the latest numbers.
 *
 * Reads, by header name, customer_id, adsrun_ad_id (the AdsRun "Ads ID" — NOT ad_id, which is Meta's
 * ID), ad_creative_name and conversations from the "All customers" tab. The portal matches each ad on
 * adsrun_ad_id = AdsRun Raw "Ads ID". Replaces the older sync on the Onboardings_Updated_List sheet.
 */
const ADCONV_SHEET = 'All customers';
const ADCONV_BATCH = 1000;

function setupAdConversionsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAdConversions')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAdConversions').timeBased().everyDays(1).atHour(9).nearMinute(40).create();
  syncAdConversions();
}

function syncAdConversions() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('PI_COMMERCE_AD_CONVERSIONS_SYNC_URL');
  const secret = props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_SECRET');
  if (!url || !secret) throw new Error('Set PI_COMMERCE_AD_CONVERSIONS_SYNC_URL and PI_COMMERCE_SUB_RAW_SYNC_SECRET in Script Properties');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ADCONV_SHEET);
  if (!sheet) throw new Error('Tab "' + ADCONV_SHEET + '" not found');
  const values = sheet.getDataRange().getDisplayValues();
  // adsrun_ad_id only: this sheet's ad_id column is Meta's ad ID and does not match the portal.
  const header = values[0].map(h => String(h).trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = names => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = { cust: col(['custid', 'customer_id']), ad: col(['adsrun_ad_id']), name: col(['ad_creative_name', 'ad_name']), conv: col(['conversations']) };
  if (c.cust < 0 || c.ad < 0 || c.conv < 0) throw new Error('Missing customer_id / adsrun_ad_id / conversations headers');
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const v = values[r];
    if (!v[c.cust] || !v[c.ad]) continue;
    rows.push({ customer_id: v[c.cust], ad_id: v[c.ad], ad_name: c.name >= 0 ? v[c.name] : '', conversions: v[c.conv] });
  }
  let saved = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += ADCONV_BATCH) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-sub-raw-sync-secret': secret },
      payload: JSON.stringify({ rows: rows.slice(i, i + ADCONV_BATCH) })
    });
    if (res.getResponseCode() !== 200) throw new Error('Portal said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    const j = JSON.parse(res.getContentText()); saved += j.saved || 0; skipped += j.skipped || 0;
  }
  console.log('Ad conversions sync: ' + rows.length + ' rows, saved ' + saved + ', skipped ' + skipped);
}
