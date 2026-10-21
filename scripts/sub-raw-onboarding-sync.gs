/**
 * Pi Commerce — Sub Raw -> Onboarding T-1 Sync
 *
 * Sources: subscription data from the "Sub Raw" tab, ad data from the "AdsRun Raw" tab.
 *
 * Required headers in Sub Raw:
 *   merchant_cust_id
 *   sub_first_date
 *
 * Ad data from AdsRun Raw (one row per ad; header CustID for the merchant):
 *   - a merchant with no row in AdsRun Raw has not run an ad
 *   - first ad date   = earliest Ad_Start_Date across the merchant's rows
 *   - impressions     = sum of Impressions across the merchant's rows
 *   - spend           = sum of Spend across the merchant's rows
 *   - Ads ID          = header "Ads ID" (not the Meta ad ID); matched to the meta_failed_ads tab
 *
 * Failed ads from meta_failed_ads (optional tab; Ads ID in the "Ads ID" header, else column A):
 *   - the failure reason (first header containing "reason" / "error") is sent with the merchant
 *     and shown on a case reopened as "Ads Live Not Verified"
 *   - a failed ad with no impressions and no spend does not count as an ad run
 *   (columns are found by header name, so they can move)
 *
 * Optional headers (shown on each onboarding case: subscription pills, credits / subscribed
 * date / stage sorting and the stage filter; skipped if the column is missing):
 *   subscription_status
 *   cancelled_at
 *   current_wallet_balance
 *   last_completed_stage
 *   expected_renewal_due_date  (subscription expiry)
 *   plan name                  (header plan_name / plan / subscription_plan / plan_type;
 *                               if none of these exists, column CJ is used)
 *   plan amount                (header plan_amount / subscription_amount / amount; optional,
 *                               otherwise the portal uses the Silver / Gold / Platinum price)
 *   merchant MID               (header mid / merchant_mid / merchant_id; links CleverTap
 *                               payments that arrived without a Cust ID to the right case)
 *   communication_address      (state / PIN code: southern-state cases go to the onboarders
 *                               ticked "Language" in Teams)
 *
 * Ads Live verification (done by the portal on every sync):
 *   A case an onboarder marked Ads Live on or before the cutoff date is checked here.
 *   - 0 ads executed, 0 impressions, 0 spend  -> case is reopened ("Ads Live Not Verified")
 *   - anything else (including PAUSED) -> no change
 *
 * Required Script Properties:
 *   PI_COMMERCE_SUB_RAW_SYNC_URL
 *   PI_COMMERCE_SUB_RAW_SYNC_SECRET
 *
 * Apps Script timezone:
 *   Asia/Kolkata
 */

const SUB_RAW_SHEET = 'Sub Raw';
const ADS_RUN_SHEET = 'AdsRun Raw';
// AdsRun Raw columns, found by header name (columns can move): first ad date, impressions, spend.
const ADS_HEADERS = { custId: 'custid', firstDate: 'ad_start_date', impressions: 'impressions', spend: 'spend' };
const FAILED_ADS_SHEET = 'meta_failed_ads';
const LOG_SHEET = 'Onboarding Sync Log';
const TIMEZONE = 'Asia/Kolkata';
const BATCH_SIZE = 75;


/**
 * LIVE SYNC
 *
 * Reads Sub Raw.
 * Uses T-1 as the cutoff.
 * Makes actual changes in the Onboarding database.
 */
function runSubRawOnboardingSync() {
  return syncSubRawOnboarding_(false);
}


/**
 * DRY RUN
 *
 * Reads exactly the same data and applies exactly the same logic,
 * but does NOT make any database changes.
 *
 * Run this first whenever you want to verify the result.
 */
function previewSubRawOnboardingSync() {
  return syncSubRawOnboarding_(true);
}


/**
 * Run this ONCE.
 *
 * Creates the daily automatic trigger.
 * It will run once every day around 7:15 AM IST.
 */
function installDailySubRawSyncTrigger() {
  // Remove any previous trigger for this same function,
  // so running this installer twice does not create duplicate triggers.
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === 'runSubRawOnboardingSync';
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('runSubRawOnboardingSync')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(30)
    .inTimezone('Asia/Kolkata')
    .create();
}

/**
 * Main sync engine.
 */
function syncSubRawOnboarding_(dryRun) {

  const props = PropertiesService.getScriptProperties();

  const url = String(
    props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_URL') || ''
  ).trim();

  const secret = String(
    props.getProperty('PI_COMMERCE_SUB_RAW_SYNC_SECRET') || ''
  ).trim();

  if (!url || !secret) {
    throw new Error(
      'Missing PI_COMMERCE_SUB_RAW_SYNC_URL or PI_COMMERCE_SUB_RAW_SYNC_SECRET in Script Properties.'
    );
  }


  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SUB_RAW_SHEET);

  if (!sheet) {
    throw new Error('Sheet "' + SUB_RAW_SHEET + '" not found.');
  }


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


  /**
   * Find columns using header names.
   *
   * This means it does NOT matter if the physical
   * columns move from F/U/AR/AZ later.
   */
  const headers = values[0].map(function(header) {
    return String(header).trim().toLowerCase();
  });

  const idx = {
    customerId: headers.indexOf('merchant_cust_id'),
    subFirstDate: headers.indexOf('sub_first_date')
  };

  // Optional columns: sent when present, skipped otherwise.
  const optionalIdx = {
    subscriptionStatus: headers.indexOf('subscription_status'),
    cancelledAt: headers.indexOf('cancelled_at'),
    credits: headers.indexOf('current_wallet_balance'),
    lastCompletedStage: headers.indexOf('last_completed_stage'),
    expiryDate: headers.indexOf('expected_renewal_due_date'),
    planName: firstHeader_(headers, ['plan_name', 'plan', 'subscription_plan', 'plan_type', 'sub_plan']),
    planAmount: firstHeader_(headers, ['plan_amount', 'subscription_amount', 'plan_price', 'amount']),
    mid: firstHeader_(headers, ['mid', 'merchant_mid', 'merchant_id', 'mid_id']),
    communicationAddress: firstHeader_(headers, ['communication_address', 'communication address', 'comm_address'])
  };

  // Plan name sits in column CJ (index 87) when its header is not one of the names above.
  if (optionalIdx.planName < 0 && headers.length > 87) optionalIdx.planName = 87;


  Object.keys(idx).forEach(function(key) {

    if (idx[key] < 0) {
      throw new Error(
        'Required header missing in Sub Raw: ' + key
      );
    }

  });


  // Ad data per merchant from AdsRun Raw (Ad_Start_Date / Impressions / Spend).
  const adsByCustomer = readAdsRunTotals_(ss);

  /**
   * Example:
   * Today = 18 Sep
   * cutoffDate = 17 Sep
   */
  const cutoffDate = getTMinusOneDate_();


  /**
   * Deduplicate merchants by customer ID.
   *
   * If the same customer somehow appears twice,
   * only one record is sent for processing.
   */
  const deduped = {};

  const localErrors = [];


  for (let r = 1; r < values.length; r++) {

    const sourceRow = r + 1;


    /**
     * Customer ID
     */
    const rawCustomerId = values[r][idx.customerId];

    const customerId = String(
      rawCustomerId == null ? '' : rawCustomerId
    )
      .trim()
      .replace(/\.0$/, '');


    /**
     * Subscription / Sale Date
     */
    const subFirstDate = normalizeSheetDate_(
      values[r][idx.subFirstDate]
    );


    /**
     * Ad data from AdsRun Raw: no row there = no ad run (0 ads, no first ad date, 0 impressions / spend).
     */
    const adsRow = adsByCustomer[customerId];

    const firstAdDate = adsRow ? adsRow.firstAdDate : '';

    const totalAdsExecuted = adsRow ? adsRow.ads : 0;

    const totalImpressions = adsRow ? adsRow.impressions : 0;

    const totalSpend = adsRow ? adsRow.spend : 0;

    const adFailReason = adsRow ? adsRow.failReason : '';


    /**
     * Validation
     */
    if (!/^\d+$/.test(customerId)) {

      localErrors.push(
        'Row ' + sourceRow + ': invalid customer ID'
      );

      continue;
    }


    if (!subFirstDate) {

      localErrors.push(
        'Row ' + sourceRow + ': invalid sub_first_date'
      );

      continue;
    }


    if (
      !Number.isFinite(totalAdsExecuted) ||
      totalAdsExecuted < 0
    ) {

      localErrors.push(
        'Row ' + sourceRow + ': invalid total_ads_executed'
      );

      continue;
    }


    /**
     * T-1 RULE
     *
     * Anything subscribed AFTER yesterday
     * is completely ignored today.
     *
     * Example:
     * Today = 18 Sep
     * Any 18 Sep subscription is ignored.
     */
    if (subFirstDate > cutoffDate) {
      continue;
    }


    deduped[customerId] = {

      customerId: customerId,

      subFirstDate: subFirstDate,

      totalAdsExecuted: totalAdsExecuted,

      firstAdDate: firstAdDate || '',

      totalImpressions: totalImpressions,

      totalSpend: totalSpend,

      adFailReason: adFailReason || '',

      sourceRow: sourceRow

    };

    if (optionalIdx.communicationAddress >= 0) {
      const addr = values[r][optionalIdx.communicationAddress];
      deduped[customerId].communicationAddress = String(addr == null ? '' : addr).trim().slice(0, 1000);
    }

    if (optionalIdx.mid >= 0) {
      deduped[customerId].mid = String(values[r][optionalIdx.mid] == null ? '' : values[r][optionalIdx.mid]).trim();
    }

    if (optionalIdx.subscriptionStatus >= 0) {
      const row = values[r];
      deduped[customerId].subscriptionStatus = String(row[optionalIdx.subscriptionStatus] == null ? '' : row[optionalIdx.subscriptionStatus]).trim().toUpperCase();
      deduped[customerId].cancelledAt = optionalIdx.cancelledAt >= 0 ? normalizeSheetDate_(row[optionalIdx.cancelledAt]) || '' : '';
      deduped[customerId].credits = optionalIdx.credits >= 0 ? String(row[optionalIdx.credits] == null ? '' : row[optionalIdx.credits]).trim() : '';
      deduped[customerId].lastCompletedStage = optionalIdx.lastCompletedStage >= 0 ? String(row[optionalIdx.lastCompletedStage] == null ? '' : row[optionalIdx.lastCompletedStage]).trim() : '';
      if (optionalIdx.expiryDate >= 0) deduped[customerId].expiryDate = normalizeSheetDate_(row[optionalIdx.expiryDate]) || '';
      if (optionalIdx.planName >= 0) {
        deduped[customerId].planName = String(row[optionalIdx.planName] == null ? '' : row[optionalIdx.planName]).trim();
        deduped[customerId].planAmount = optionalIdx.planAmount >= 0 ? String(row[optionalIdx.planAmount] == null ? '' : row[optionalIdx.planAmount]).trim() : '';
      }
    }
  }


  const rows = Object.keys(deduped).map(function(key) {
    return deduped[key];
  });


  /**
   * Aggregate results from all API batches.
   */
  const totals = {

    inputRows: 0,

    eligibleRows: 0,

    invalidRows: [],

    createdOpenDhruv: 0,

    createdOpenAshish: 0,

    createdExternalLive: 0,

    existingMarkedExternalLive: 0,

    alreadyAdsLive: 0,

    adsLiveReopened: 0,

    adFailedAfterLiveReopened: 0,

    existingOpenNoChange: 0,

    lostNoChange: 0,

    otherNoChange: 0,

    missingFirstAdDate: 0,

    actions: []

  };


  /**
   * Send records in small batches.
   *
   * Keeps Apps Script and the server request stable
   * even as the sheet becomes larger.
   */
  for (
    let i = 0;
    i < rows.length;
    i += BATCH_SIZE
  ) {

    const batch = rows.slice(
      i,
      i + BATCH_SIZE
    );


    const response = UrlFetchApp.fetch(
      url,
      {

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

      }
    );


    const code =
      response.getResponseCode();

    const bodyText =
      response.getContentText();


    let body;


    try {

      body = JSON.parse(bodyText);

    } catch (e) {

      throw new Error(
        'Sync API returned non-JSON response (' +
        code +
        '): ' +
        bodyText
      );

    }


    if (
      code < 200 ||
      code >= 300 ||
      !body.ok
    ) {

      throw new Error(
        'Sync API failed (' +
        code +
        '): ' +
        (body.error || bodyText)
      );

    }


    mergeSummary_(
      totals,
      body
    );
  }


  /**
   * Write an audit row inside the spreadsheet.
   */
  writeSyncLog_(ss, {

    dryRun: dryRun,

    cutoffDate: cutoffDate,

    sourceRows: values.length - 1,

    eligibleRows: rows.length,

    localErrors: localErrors,

    totals: totals,

    status: 'SUCCESS'

  });


  /**
   * Also show full details in Apps Script execution logs.
   */
  Logger.log(
    JSON.stringify(
      {

        cutoffDate: cutoffDate,

        dryRun: dryRun,

        localErrors: localErrors,

        totals: totals

      },
      null,
      2
    )
  );


  return totals;
}


/**
 * Combines results from multiple API batches.
 */
function mergeSummary_(target, source) {

  const numericKeys = [

    'inputRows',

    'eligibleRows',

    'createdOpenDhruv',

    'createdOpenAshish',

    'createdExternalLive',

    'existingMarkedExternalLive',

    'alreadyAdsLive',

    'adsLiveReopened',

    'adFailedAfterLiveReopened',

    'existingOpenNoChange',

    'lostNoChange',

    'otherNoChange',

    'missingFirstAdDate'

  ];


  numericKeys.forEach(function(key) {

    target[key] =
      Number(target[key] || 0) +
      Number(source[key] || 0);

  });


  target.invalidRows =
    target.invalidRows.concat(
      source.invalidRows || []
    );


  target.actions =
    target.actions.concat(
      source.actions || []
    );
}


/**
 * Converts a sheet cell to a number.
 * Blank or non-numeric cells become 0.
 */
function firstHeader_(headers, names) {
  for (let i = 0; i < names.length; i++) {
    const at = headers.indexOf(names[i]);
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * AdsRun Raw totals per merchant (found by header name): number of ad rows, earliest Ad_Start_Date,
 * sum of Impressions and sum of Spend.
 */
function normHead_(h) { return String(h).trim().toLowerCase().replace(/[\s-]+/g, '_'); }

function cleanId_(v) { return String(v == null ? '' : v).trim().replace(/\.0$/, ''); }

/** meta_failed_ads: Ads ID -> failure reason, plus Cust ID -> reason when the tab has a Cust ID column. */
function readFailedAds_(ss) {
  const out = { byAd: {}, byCustomer: {} };
  const sheet = ss.getSheetByName(FAILED_ADS_SHEET);
  if (!sheet) return out;
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return out;
  const head = values[0].map(normHead_);
  let adCol = firstHeader_(head, ['ads_id', 'ad_id', 'adsid', 'adid']);
  if (adCol < 0) adCol = 0;
  let reasonCol = -1;
  for (let c = 0; c < head.length && reasonCol < 0; c++) if (c !== adCol && /reason|error/.test(head[c])) reasonCol = c;
  const custCol = firstHeader_(head, ['custid', 'cust_id', 'customer_id', 'merchant_cust_id']);
  for (let r = 1; r < values.length; r++) {
    const adsId = cleanId_(values[r][adCol]);
    if (!adsId) continue;
    const reason = reasonCol >= 0 ? String(values[r][reasonCol] == null ? '' : values[r][reasonCol]).trim() : '';
    out.byAd[adsId] = reason || 'Failed (no reason given)';
    const cust = custCol >= 0 ? cleanId_(values[r][custCol]) : '';
    if (/^\d+$/.test(cust)) out.byCustomer[cust] = out.byAd[adsId];
  }
  return out;
}

function readAdsRunTotals_(ss) {
  const sheet = ss.getSheetByName(ADS_RUN_SHEET);
  if (!sheet) throw new Error('Sheet "' + ADS_RUN_SHEET + '" not found.');
  const values = sheet.getDataRange().getValues();
  const failed = readFailedAds_(ss);
  const out = {};
  // Merchants whose failed ad never reached AdsRun Raw still get the reason.
  Object.keys(failed.byCustomer).forEach(function(id) {
    out[id] = { ads: 0, firstAdDate: '', impressions: 0, spend: 0, failReason: failed.byCustomer[id] };
  });
  if (values.length < 2) return out;
  // "Ad Start Date" / "Ad_Start_Date" / "ad_start_date" all match.
  const head = values[0].map(normHead_);
  const col = {};
  Object.keys(ADS_HEADERS).forEach(function(k) {
    col[k] = head.indexOf(ADS_HEADERS[k]);
    if (col[k] < 0) throw new Error('Header "' + ADS_HEADERS[k] + '" missing in ' + ADS_RUN_SHEET);
  });
  // Ads ID: "Ads ID" / "Ad_ID" / "AdsID" header, else column U. Never Meta_AD_ID.
  let adsIdCol = firstHeader_(head, ['ads_id', 'ad_id', 'adsid', 'adid']);
  if (adsIdCol < 0 && head.length > 20) adsIdCol = 20;
  for (let r = 1; r < values.length; r++) {
    const id = cleanId_(values[r][col.custId]);
    if (!/^\d+$/.test(id)) continue;
    const t = out[id] || (out[id] = { ads: 0, firstAdDate: '', impressions: 0, spend: 0, failReason: '' });
    const impressions = toSheetNumber_(values[r][col.impressions]);
    const spend = toSheetNumber_(values[r][col.spend]);
    const reason = adsIdCol >= 0 ? failed.byAd[cleanId_(values[r][adsIdCol])] : '';
    if (reason) t.failReason = reason;
    // A failed ad that never delivered is not an ad run.
    if (reason && impressions === 0 && spend === 0) continue;
    t.ads++;
    const d = normalizeSheetDate_(values[r][col.firstDate]);
    if (d && (!t.firstAdDate || d < t.firstAdDate)) t.firstAdDate = d;
    t.impressions += impressions;
    t.spend += spend;
  }
  return out;
}


function toSheetNumber_(value) {

  if (value === '' || value == null) {
    return 0;
  }

  const n = Number(
    String(value).replace(/,/g, '')
  );

  return Number.isFinite(n) && n >= 0 ? n : 0;
}


/**
 * Returns yesterday in IST.
 *
 * Example:
 * Today = 2026-09-18
 * Returns = 2026-09-17
 */
function getTMinusOneDate_() {

  const now = new Date();

  const yesterday = new Date(
    now.getTime() -
    24 * 60 * 60 * 1000
  );

  return Utilities.formatDate(
    yesterday,
    TIMEZONE,
    'yyyy-MM-dd'
  );
}


/**
 * Converts dates from the Google Sheet
 * into YYYY-MM-DD format.
 */
function normalizeSheetDate_(value) {

  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {

    return Utilities.formatDate(
      value,
      TIMEZONE,
      'yyyy-MM-dd'
    );

  }


  const s = String(
    value == null ? '' : value
  ).trim();


  if (!s) {
    return '';
  }


  if (
    /^\d{4}-\d{2}-\d{2}$/.test(s)
  ) {

    return s;

  }


  /**
   * Handles DD/MM/YYYY or DD-MM-YYYY
   */
  const match = s.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
  );


  if (match) {

    const dd =
      ('0' + match[1]).slice(-2);

    const mm =
      ('0' + match[2]).slice(-2);


    return (
      match[3] +
      '-' +
      mm +
      '-' +
      dd
    );
  }


  /**
   * Final fallback.
   */
  const d = new Date(s);


  if (!isNaN(d.getTime())) {

    return Utilities.formatDate(
      d,
      TIMEZONE,
      'yyyy-MM-dd'
    );

  }


  return '';
}


/**
 * Maintains a simple daily audit log
 * inside the Google Sheet.
 */
function writeSyncLog_(ss, data) {

  let sheet =
    ss.getSheetByName(LOG_SHEET);


  /**
   * Create log sheet automatically
   * on the first run.
   */
  if (!sheet) {

    sheet =
      ss.insertSheet(LOG_SHEET);


    sheet.appendRow([

      'Run Time IST',

      'Mode',

      'Cutoff Date',

      'Source Rows',

      'Eligible Rows',

      'New Open -> Dhruv',

      'New Open -> Ashish',

      'New External Live',

      'Existing -> External Live',

      'Already Ads Live',

      'Open No Change',

      'Lost No Change',

      'Missing First Ad Date',

      'Errors',

      'Status',

      'Ads Live Reopened',

      'Ad Failed Reopened'

    ]);


    sheet.setFrozenRows(1);
  }


  /**
   * Older log sheets were created without the two verification columns.
   * Add their headers once (columns P and Q), without touching existing data.
   */
  if (sheet.getRange(1, 16).getValue() === '') {

    sheet.getRange(1, 16, 1, 2).setValues([
      ['Ads Live Reopened', 'Ad Failed Reopened']
    ]);

  }


  const t =
    data.totals || {};


  const errors =
    (data.localErrors || [])
      .concat(
        t.invalidRows || []
      );


  sheet.appendRow([

    Utilities.formatDate(
      new Date(),
      TIMEZONE,
      'yyyy-MM-dd HH:mm:ss'
    ),

    data.dryRun
      ? 'DRY RUN'
      : 'LIVE',

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

    data.status || '',

    t.adsLiveReopened || 0,

    t.adFailedAfterLiveReopened || 0

  ]);
}