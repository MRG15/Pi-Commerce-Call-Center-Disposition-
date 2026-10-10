/**
 * Pi Commerce — Sub Raw -> Onboarding T-1 Sync
 *
 * Source of truth: ONLY the "Sub Raw" tab.
 *
 * Required headers in Sub Raw:
 *   merchant_cust_id
 *   sub_first_date
 *   total_ads_executed
 *   first_ad_date
 *   total_impressions        (used to verify cases marked Ads Live)
 *   total_adinsight_spend    (used to verify cases marked Ads Live)
 *   latest_ad_status         (used to verify cases marked Ads Live)
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
 *
 * Ads Live verification (done by the portal on every sync):
 *   A case an onboarder marked Ads Live on or before the cutoff date is checked here.
 *   - 0 ads executed, 0 impressions, 0 spend  -> case is reopened ("Ads Live Not Verified")
 *   - 0 ads executed, but impressions or spend, latest status FAILED -> case is reopened ("Ad Failed After Live")
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
    subFirstDate: headers.indexOf('sub_first_date'),
    totalAdsExecuted: headers.indexOf('total_ads_executed'),
    firstAdDate: headers.indexOf('first_ad_date'),
    totalImpressions: headers.indexOf('total_impressions'),
    totalSpend: headers.indexOf('total_adinsight_spend'),
    latestAdStatus: headers.indexOf('latest_ad_status')
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
    mid: firstHeader_(headers, ['mid', 'merchant_mid', 'merchant_id', 'mid_id'])
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
     * First Ad Date
     */
    const firstAdDate = normalizeSheetDate_(
      values[r][idx.firstAdDate]
    );


    /**
     * Total Ads Executed
     */
    const adsRaw = values[r][idx.totalAdsExecuted];

    const totalAdsExecuted =
      adsRaw === '' || adsRaw == null
        ? 0
        : Number(
            String(adsRaw).replace(/,/g, '')
          );


    /**
     * Delivery fields, used by the portal to verify cases marked Ads Live.
     * Blank cells are sent as 0.
     */
    const totalImpressions = toSheetNumber_(values[r][idx.totalImpressions]);

    const totalSpend = toSheetNumber_(values[r][idx.totalSpend]);

    const latestAdStatus = String(
      values[r][idx.latestAdStatus] == null ? '' : values[r][idx.latestAdStatus]
    )
      .trim()
      .toUpperCase();


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

      latestAdStatus: latestAdStatus,

      sourceRow: sourceRow

    };

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