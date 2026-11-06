/************************************************************
 * PI COMMERCE — SAFE MERCHANT INFORMATION SYNC
 *
 * Supports:
 * 1. Old sheet format
 * 2. New sheet format
 * 3. New format with an extra blank field
 *
 * Duplicate customer IDs are allowed.
 * The LAST occurrence in the sheet wins.
 *
 * Unknown/misaligned rows STOP the whole sync.
 *
 * Writes directly to Neon in batches of 2,000 (the old single
 * POST to Vercel hit Vercel's 4.5 MB limit -> 413 errors).
 * Needs script property: NEON_DATABASE_URL
 *
 * OUTLETS: every row's MID (the "PizzaW…"-style ID near column B)
 * is also saved with that row's merchant name in merchant_outlets,
 * so a merchant with several outlets under one customer ID shows
 * each outlet's own name on its onboarding case. A missing MID is
 * simply skipped; it never stops the sync.
 ************************************************************/


function normalizeCell(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!isFinite(value)) return null;
    return String(Math.trunc(value));
  }

  var s = String(value).trim();
  return s || null;
}


function digitsOnly(value) {
  var s = normalizeCell(value);
  if (!s) return '';
  return String(s).replace(/\D/g, '');
}


function looksLikePhone(value) {
  var d = digitsOnly(value);

  return (
    d.length === 10 ||
    (d.length === 11 && d.charAt(0) === '0') ||
    (d.length === 12 && d.indexOf('91') === 0)
  );
}


function normalizePhone(value) {
  var d = digitsOnly(value);

  if (!d) return null;

  if (d.length === 11 && d.charAt(0) === '0') {
    d = d.substring(1);
  }

  if (d.length === 12 && d.indexOf('91') === 0) {
    d = d.substring(2);
  }

  return d || null;
}


function looksLikeCustomerId(value) {
  var s = normalizeCell(value);
  if (!s) return false;
  return /^\d{5,15}$/.test(s);
}


function looksLikeMcc(value) {
  var s = normalizeCell(value);
  if (!s) return false;
  // Source has valid 3-digit and 4-digit MCCs.
  return /^\d{3,4}$/.test(s);
}


/*
 * MID of a row: letters and digits mixed, 10+ characters (e.g. PizzaW75532028120279).
 * Looked for in column B first, then A and C.
 */
function findMid_(row) {
  var cols = [1, 0, 2];
  for (var i = 0; i < cols.length; i++) {
    var v = normalizeCell(row[cols[i]]);
    if (v && /^[A-Za-z0-9]{10,}$/.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v)) return v;
  }
  return null;
}


/************************************************************
 * FINAL SAFETY CHECK
 ************************************************************/

function isMerchantRecordSafe(record) {
  if (!record) return false;

  if (!record.customer_id || !looksLikeCustomerId(record.customer_id)) {
    return false;
  }

  if (!record.merchant_name) {
    return false;
  }

  if (record.phone_number && !looksLikePhone(record.phone_number)) {
    return false;
  }

  // SMB is merchant type, never category.
  if (record.category && String(record.category).trim().toUpperCase() === 'SMB') {
    return false;
  }

  // Detect customer ID accidentally shifted into sub-category.
  if (record.sub_category && /^\d{5,15}$/.test(String(record.sub_category).trim())) {
    return false;
  }

  return true;
}


/************************************************************
 * DETECT THE THREE KNOWN SOURCE FORMATS
 ************************************************************/

function normalizeMerchantRow(row) {

  // Zero-based: D=3 E=4 F=5 G=6 H=7 I=8 J=9 K=10
  var d = normalizeCell(row[3]);
  var e = normalizeCell(row[4]);
  var f = normalizeCell(row[5]);
  var g = normalizeCell(row[6]);
  var h = normalizeCell(row[7]);
  var i = normalizeCell(row[8]);
  var j = normalizeCell(row[9]);
  var k = normalizeCell(row[10]);

  /***********************
   * FORMAT 1 — OLD
   * D merchant, E phone, F customer ID, G category,
   * H sub-category, I MCC, J SMB
   ***********************/
  if (
    looksLikePhone(e) &&
    looksLikeCustomerId(f) &&
    g &&
    h &&
    looksLikeMcc(i) &&
    String(j || '').toUpperCase() === 'SMB'
  ) {
    var oldRecord = {
      format: 'old',
      customer_id: normalizeCell(f),
      merchant_name: normalizeCell(d),
      phone_number: normalizePhone(e),
      category: normalizeCell(g),
      sub_category: normalizeCell(h)
    };
    return isMerchantRecordSafe(oldRecord) ? oldRecord : null;
  }

  /***********************
   * FORMAT 2 — NEW
   * D merchant, E display name, F phone, G SMB,
   * H customer ID, I category, J sub-category
   ***********************/
  if (
    looksLikePhone(f) &&
    String(g || '').toUpperCase() === 'SMB' &&
    looksLikeCustomerId(h) &&
    i &&
    j
  ) {
    var newRecord = {
      format: 'new',
      customer_id: normalizeCell(h),
      merchant_name: normalizeCell(d),
      phone_number: normalizePhone(f),
      category: normalizeCell(i),
      sub_category: normalizeCell(j)
    };
    return isMerchantRecordSafe(newRecord) ? newRecord : null;
  }

  /***********************
   * FORMAT 3 — NEW + BLANK
   * D merchant, E display name, F blank, G phone, H SMB,
   * I customer ID, J category, K sub-category
   ***********************/
  if (
    !f &&
    looksLikePhone(g) &&
    String(h || '').toUpperCase() === 'SMB' &&
    looksLikeCustomerId(i) &&
    j &&
    k
  ) {
    var shiftedRecord = {
      format: 'new_shifted',
      customer_id: normalizeCell(i),
      merchant_name: normalizeCell(d),
      phone_number: normalizePhone(g),
      category: normalizeCell(j),
      sub_category: normalizeCell(k)
    };
    return isMerchantRecordSafe(shiftedRecord) ? shiftedRecord : null;
  }

  // Unknown structure = never guess.
  return null;
}


/************************************************************
 * BUILD COMPLETE SAFE PAYLOAD
 ************************************************************/

function buildMerchantRows() {

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName('Onboardings');

  if (!sheet) {
    throw new Error('Sheet named "Onboardings" not found.');
  }

  var values = sheet.getDataRange().getDisplayValues();

  if (values.length < 2) {
    throw new Error('No merchant rows found in Onboardings.');
  }

  // Keyed by customer ID: a later duplicate replaces an earlier one.
  var byCustomer = {};
  var customerOrder = [];
  var badRows = [];
  // Keyed by MID: each outlet's own name (one customer ID can have many MIDs).
  var byMid = {};

  var oldCount = 0;
  var newCount = 0;
  var shiftedNewCount = 0;
  var duplicateCount = 0;

  for (var r = 1; r < values.length; r++) {

    var sheetRowNumber = r + 1;
    var sourceRow = values[r];

    var allBlank = sourceRow.every(function(value) {
      return String(value || '').trim() === '';
    });

    if (allBlank) {
      continue;
    }

    var merchant = normalizeMerchantRow(sourceRow);

    if (!merchant) {
      badRows.push(sheetRowNumber);
      continue;
    }

    if (byCustomer[merchant.customer_id]) {
      duplicateCount++;
    } else {
      customerOrder.push(merchant.customer_id);
    }

    // IMPORTANT: last occurrence wins.
    byCustomer[merchant.customer_id] = {
      customer_id: merchant.customer_id,
      merchant_name: merchant.merchant_name,
      phone_number: merchant.phone_number,
      category: merchant.category,
      sub_category: merchant.sub_category
    };

    var mid = findMid_(sourceRow);
    if (mid) {
      byMid[mid] = { mid: mid, customer_id: merchant.customer_id, merchant_name: merchant.merchant_name };
    }

    if (merchant.format === 'old') oldCount++;
    if (merchant.format === 'new') newCount++;
    if (merchant.format === 'new_shifted') shiftedNewCount++;
  }

  /***********************
   * SAFETY STOP
   ***********************/
  if (badRows.length > 0) {
    throw new Error(
      'SYNC STOPPED. ' + badRows.length +
      ' populated rows have an unknown or misaligned structure. ' +
      'Nothing was sent to Neon. ' +
      'Example sheet rows: ' + badRows.slice(0, 25).join(', ')
    );
  }

  var rows = customerOrder.map(function(customerId) {
    return byCustomer[customerId];
  });

  if (rows.length < 100) {
    throw new Error(
      'SYNC STOPPED. Only ' + rows.length +
      ' unique valid merchants were found. Nothing was sent to Neon.'
    );
  }

  return {
    rows: rows,
    outlets: Object.keys(byMid).map(function(m) { return byMid[m]; }),
    oldCount: oldCount,
    newCount: newCount,
    shiftedNewCount: shiftedNewCount,
    duplicateCount: duplicateCount
  };
}


/************************************************************
 * SAFETY CUSTOMER CHECK
 ************************************************************/

function findSafetyCustomer_(rows) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].customer_id) === '1278049194') {
      return rows[i];
    }
  }
  return null;
}


function safetyCustomerIsCorrect_(c) {
  return !!c &&
    c.customer_id === '1278049194' &&
    c.merchant_name === 'SHRI RAM ENERGY STATION' &&
    c.phone_number === '9827212623' &&
    c.category === 'Gas and Petrol' &&
    c.sub_category === 'IOCL Pump';
}


/************************************************************
 * SAFE PREVIEW — DOES NOT WRITE TO NEON
 ************************************************************/

function previewMerchantInformationSync() {

  var result = buildMerchantRows();

  console.log('==============================');
  console.log('MERCHANT SYNC PREVIEW SUCCESS');
  console.log('==============================');
  console.log('Unique merchants to sync: ' + result.rows.length);
  console.log('Duplicate source rows safely deduplicated: ' + result.duplicateCount);
  console.log('Old-format rows: ' + result.oldCount);
  console.log('New-format rows: ' + result.newCount);
  console.log('Shifted-new rows: ' + result.shiftedNewCount);
  console.log('Outlets (MIDs) found: ' + result.outlets.length);
  console.log('Pizza Wings outlets: ' + JSON.stringify(result.outlets.filter(function(o) { return o.customer_id === '1003024598'; })));

  var testCustomer = findSafetyCustomer_(result.rows);

  console.log('CHECK CUSTOMER 1278049194');
  console.log(JSON.stringify(testCustomer));

  if (!safetyCustomerIsCorrect_(testCustomer)) {
    throw new Error(
      'Preview failed: customer 1278049194 does not map correctly. ' +
      'DO NOT RUN LIVE SYNC.'
    );
  }

  console.log('TEST CUSTOMER IS CORRECT.');
  console.log('PREVIEW PASSED.');
  console.log('NO DATA WAS SENT TO NEON.');
}


/************************************************************
 * NEON CONNECTION
 ************************************************************/

var SYNC_BATCH_SIZE = 2000;

// Stop if the sheet suddenly has 10%+ fewer merchants than the
// last successful sync (protects against a half-pasted sheet).
var MAX_DROP_RATIO = 0.10;


function getNeonUrl_() {
  var cs = PropertiesService.getScriptProperties().getProperty('NEON_DATABASE_URL');
  if (!cs) {
    throw new Error('Missing script property NEON_DATABASE_URL.');
  }
  return cs.trim();
}


/*
 * Runs SQL over Neon's HTTPS endpoint.
 * body = { query, params }              -> one statement
 * body = { queries: [{query, params}] } -> one transaction
 */
function neonSql_(connectionString, body) {
  var afterAt = connectionString.substring(connectionString.lastIndexOf('@') + 1);
  var host = afterAt.split('/')[0].split('?')[0];

  var headers = {
    'Neon-Connection-String': connectionString,
    'Neon-Raw-Text-Output': 'true',
    'Neon-Array-Mode': 'true'
  };

  if (body.queries) {
    headers['Neon-Batch-Isolation-Level'] = 'ReadCommitted';
  }

  var response = UrlFetchApp.fetch('https://' + host + '/sql', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Neon query failed (' + code + '): ' + text.slice(0, 500));
  }

  return JSON.parse(text);
}


/************************************************************
 * READ-ONLY CONNECTION TEST
 ************************************************************/

function testNeonConnection() {
  var res = neonSql_(getNeonUrl_(), {
    query:
      'SELECT count(*), count(*) FILTER (WHERE active), ' +
      'max(last_synced_at)::text FROM merchant_information',
    params: []
  });

  var r = res.rows[0];
  console.log('Connected to Neon.');
  console.log('merchant_information total: ' + r[0] +
              ', active: ' + r[1] +
              ', last sync: ' + r[2]);
}


/************************************************************
 * LIVE FULL SYNC
 ************************************************************/

var UPSERT_SQL =
  'INSERT INTO merchant_information ' +
  '(customer_id, merchant_name, phone_number, category, sub_category, active, last_synced_at) ' +
  'SELECT r.customer_id, r.merchant_name, r.phone_number, r.category, r.sub_category, ' +
  'true, $2::timestamptz ' +
  'FROM json_to_recordset($1::json) AS r(' +
  'customer_id text, merchant_name text, phone_number text, category text, sub_category text) ' +
  'ON CONFLICT (customer_id) DO UPDATE SET ' +
  'merchant_name = EXCLUDED.merchant_name, ' +
  'phone_number = EXCLUDED.phone_number, ' +
  'category = EXCLUDED.category, ' +
  'sub_category = EXCLUDED.sub_category, ' +
  'active = true, ' +
  'last_synced_at = EXCLUDED.last_synced_at';

var OUTLETS_SQL =
  'INSERT INTO merchant_outlets (mid, customer_id, merchant_name, synced_at) ' +
  'SELECT r.mid, r.customer_id, r.merchant_name, now() ' +
  'FROM json_to_recordset($1::json) AS r(mid text, customer_id text, merchant_name text) ' +
  'ON CONFLICT (mid) DO UPDATE SET ' +
  'customer_id = EXCLUDED.customer_id, ' +
  'merchant_name = EXCLUDED.merchant_name, ' +
  'synced_at = now()';


function syncMerchantInformation() {
  var cs = getNeonUrl_();

  var result = buildMerchantRows();
  var rows = result.rows;

  if (!safetyCustomerIsCorrect_(findSafetyCustomer_(rows))) {
    throw new Error(
      'LIVE SYNC STOPPED. Safety customer 1278049194 does not map correctly. ' +
      'Nothing was sent to Neon.'
    );
  }

  var sourceName = SpreadsheetApp.getActiveSpreadsheet().getName() + ' / Onboardings';

  // Drop guard
  var last = neonSql_(cs, {
    query:
      "SELECT row_count FROM merchant_sync_runs " +
      "WHERE status = 'success' ORDER BY started_at DESC LIMIT 1",
    params: []
  });

  if (last.rows.length) {
    var lastCount = parseInt(last.rows[0][0], 10);
    if (rows.length < lastCount * (1 - MAX_DROP_RATIO)) {
      throw new Error(
        'SYNC STOPPED. Sheet has ' + rows.length + ' merchants vs ' + lastCount +
        ' in the last sync. Nothing was sent to Neon.'
      );
    }
  }

  // Upsert in batches
  var runStart = new Date().toISOString();
  var batches = Math.ceil(rows.length / SYNC_BATCH_SIZE);

  console.log('Sending ' + rows.length + ' unique validated merchants in ' +
              batches + ' batches...');

  for (var b = 0; b < batches; b++) {
    var chunk = rows.slice(b * SYNC_BATCH_SIZE, (b + 1) * SYNC_BATCH_SIZE);

    neonSql_(cs, {
      query: UPSERT_SQL,
      params: [JSON.stringify(chunk), runStart]
    });

    console.log('Batch ' + (b + 1) + '/' + batches + ' done (' + chunk.length + ').');
  }

  // Verify every merchant was written before deactivating anyone
  var check = neonSql_(cs, {
    query: 'SELECT count(*) FROM merchant_information WHERE last_synced_at = $1::timestamptz',
    params: [runStart]
  });

  var written = parseInt(check.rows[0][0], 10);

  if (written !== rows.length) {
    throw new Error(
      'SYNC STOPPED BEFORE DEACTIVATION. Expected ' + rows.length +
      ', found ' + written + '. No merchants were deactivated. Run again.'
    );
  }

  // Deactivate merchants no longer in the sheet + log the run (one transaction)
  var finalRes = neonSql_(cs, {
    queries: [
      {
        query:
          'UPDATE merchant_information SET active = false ' +
          'WHERE active AND last_synced_at < $1::timestamptz',
        params: [runStart]
      },
      {
        query:
          'INSERT INTO merchant_sync_runs ' +
          '(started_at, completed_at, row_count, source_name, status) ' +
          "VALUES ($1::timestamptz, now(), $2::int, $3, 'success')",
        params: [runStart, rows.length, sourceName]
      }
    ]
  });

  var deactivated =
    (finalRes.results && finalRes.results[0] && finalRes.results[0].rowCount) || 0;

  // Outlet names per MID. Never stops the merchant sync if it fails.
  var outletsSaved = 0;
  try {
    var outlets = result.outlets;
    for (var o = 0; o < outlets.length; o += SYNC_BATCH_SIZE) {
      var part = outlets.slice(o, o + SYNC_BATCH_SIZE);
      neonSql_(cs, { query: OUTLETS_SQL, params: [JSON.stringify(part)] });
      outletsSaved += part.length;
    }
  } catch (err) {
    console.log('Outlet names not saved (merchant sync itself succeeded): ' + err);
  }

  console.log('==============================');
  console.log('MERCHANT SYNC SUCCESS');
  console.log('Upserted ' + rows.length + ' unique merchants.');
  console.log('Marked inactive (no longer in sheet): ' + deactivated);
  console.log('Duplicate sheet rows deduplicated: ' + result.duplicateCount);
  console.log('Outlet names saved (by MID): ' + outletsSaved);
  console.log('==============================');
}


/************************************************************
 * NIGHTLY TRIGGER
 ************************************************************/

function createNightlyTrigger() {

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncMerchantInformation') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger('syncMerchantInformation')
    .timeBased()
    .atHour(2)
    .nearMinute(30)
    .everyDays(1)
    .create();

  console.log('Nightly merchant sync trigger created.');
}
