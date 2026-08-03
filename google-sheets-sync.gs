/**
 * CX Schedule → Google Sheets sync
 * ---------------------------------------------------------------------------
 * Pulls the schedule out of Supabase and writes it into this spreadsheet in the
 * same layout the team already reads (dates across, agents down).
 *
 * WHY APPS SCRIPT: writing to Sheets needs a credential. Anything shipped to the
 * browser is public, so the web app can never hold one. Apps Script runs on
 * Google's servers under your account, which is the correct place for it.
 *
 * SETUP (once)
 *  1. Open the sheet → Extensions → Apps Script.
 *  2. Paste this file in, save.
 *  3. Project Settings → Script properties → add:
 *       SUPABASE_URL          https://qaimveqjebgmermefsya.supabase.co
 *       SUPABASE_SERVICE_KEY  <service_role key from Supabase → Settings → API>
 *     Keep the service_role key here ONLY. Never put it in the web app.
 *  4. Reload the sheet → a "CX Schedule" menu appears → Sync a month.
 */

var SHEET_ID = '1obGJ8KlsziGhIVvaheQd3aiW0iG7peOjGSG3uFR_5TQ';

/**
 * Web-app endpoint so the CX Workforce admin can push a sync straight after
 * generating, instead of waiting for a timer.
 *
 * Deploy → New deployment → Web app, "Execute as: Me",
 * "Who has access: Anyone". Google requires "Anyone" for a non-Google caller;
 * the SYNC_TOKEN script property is what actually gates it, so set one.
 *
 * Body: {"token":"…","month":"2026-09","weeks":4}
 */
function doPost(e) {
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (!expected) return out({ ok: false, error: 'SYNC_TOKEN is not set on the script.' });
    if (body.token !== expected) return out({ ok: false, error: 'Bad token.' });
    if (!/^\d{4}-\d{2}$/.test(body.month || '')) return out({ ok: false, error: 'month must be YYYY-MM.' });
    var n = syncMonth(body.month, Number(body.weeks) || 4);
    return out({ ok: true, month: body.month, agents: n });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CX Schedule')
    .addItem('Sync a month…', 'promptSync')
    .addToUi();
}

function cfg_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing script property: ' + key + ' (see setup notes at the top).');
  return v;
}

/** Supabase REST GET with pagination past the 1000-row cap. */
function sb_(path, query, singlePage) {
  var base = cfg_('SUPABASE_URL') + '/rest/v1/' + path + '?' + query;
  var key = cfg_('SUPABASE_SERVICE_KEY');
  var out = [];
  var size = 1000;
  var maxPages = singlePage ? 1 : 100;
  for (var page = 0; page < maxPages; page++) {
    var url = base + '&limit=' + size + '&offset=' + (page * size);
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (res.getResponseCode() >= 300) {
      throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    var rows = JSON.parse(res.getContentText());
    out = out.concat(rows);
    if (rows.length < size) break;
  }
  return out;
}

/**
 * No-argument entry point — use this one when running from the Apps Script
 * editor or from a time-driven trigger (a standalone project has no menu).
 * Syncs the month that is currently next.
 */
function syncNextMonth() {
  var d = new Date();
  d.setMonth(d.getMonth() + 1);
  var month = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
  var n = syncMonth(month);
  Logger.log('Wrote ' + n + ' agent rows for ' + month);
  return n;
}

/**
 * Reports which Supabase key is configured, without printing the key.
 * A Supabase JWT carries its role in the (unsigned, non-secret) payload, so we
 * can read just that claim. Anon keys silently return 0 rows because RLS
 * filters them out — no error — which is easy to mistake for an empty database.
 */
function whichKey() {
  var key = cfg_('SUPABASE_SERVICE_KEY').trim();
  if (key.indexOf('sb_secret_') === 0) { Logger.log('Key looks like a NEW-style secret key — correct.'); return; }
  if (key.indexOf('sb_publishable_') === 0) { Logger.log('WRONG KEY: that is the publishable (public) key. You need the secret one.'); return; }
  var parts = key.split('.');
  if (parts.length !== 3) { Logger.log('Key is not in a recognised format — recopy it.'); return; }
  var role = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString()).role;
  Logger.log('Configured key role = ' + role);
  if (role !== 'service_role') {
    Logger.log('WRONG KEY. This is the "' + role + '" key, which RLS filters to 0 rows.');
    Logger.log('Get the right one: Supabase -> Project Settings -> API -> service_role -> Reveal.');
  } else {
    Logger.log('Correct key.');
  }
}

/**
 * Lists the configured property names with lengths — no secret values. Useful
 * when a saved key "doesn't take": usually a typo'd or duplicated property name
 * (a trailing space makes a second, unused entry) or an unsaved edit.
 * The 12-char prefix shown is the JWT header, identical for every Supabase key,
 * so it leaks nothing.
 */
function listProps() {
  var p = PropertiesService.getScriptProperties().getProperties();
  var names = Object.keys(p);
  if (!names.length) { Logger.log('No script properties are set at all.'); return; }
  names.forEach(function (k) {
    Logger.log('"' + k + '"  length=' + p[k].length + '  starts="' + p[k].slice(0, 12) + '..."');
  });
}

/**
 * Diagnoses an empty sync without writing anything: shows the month/range the
 * script resolved, how many rows Supabase returns for it, and what the newest
 * dates in the table actually are. A range mismatch (wrong month, or a timezone
 * shifting the anchor by a day) shows up immediately here.
 */
function probeSchedules() {
  var tz = Session.getScriptTimeZone();
  var d = new Date();
  d.setMonth(d.getMonth() + 1);
  var month = Utilities.formatDate(d, tz, 'yyyy-MM');
  var parts = month.split('-');
  var start = anchorSunday_(Number(parts[0]), Number(parts[1]));
  var dates = [];
  for (var i = 0; i < 28; i++) {
    var x = new Date(start.getTime());
    x.setDate(x.getDate() + i);
    dates.push(x);
  }
  var from = fmt_(dates[0]);
  var to = fmt_(dates[dates.length - 1]);

  Logger.log('Script timezone : ' + tz);
  Logger.log('Today (script)  : ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
  Logger.log('Month resolved  : ' + month);
  Logger.log('Range queried   : ' + from + '  ->  ' + to);

  var rows = sb_('schedules', 'select=agent_id,date,shift_code&date=gte.' + from + '&date=lte.' + to);
  Logger.log('Rows in range   : ' + rows.length);
  if (rows.length) Logger.log('Sample          : ' + JSON.stringify(rows.slice(0, 3)));

  var latest = sb_('schedules', 'select=date&order=date.desc', true);
  var seen = {};
  var distinct = [];
  for (var j = 0; j < latest.length && distinct.length < 8; j++) {
    if (!seen[latest[j].date]) { seen[latest[j].date] = 1; distinct.push(latest[j].date); }
  }
  Logger.log('Newest dates in DB: ' + JSON.stringify(distinct));
}

/** Quick credential/connection check that writes nothing. */
function testConnection() {
  var agents = sb_('agents', 'select=id,name&active=eq.true&order=name');
  Logger.log('OK — Supabase returned ' + agents.length + ' active agents.');
  return agents.length;
}

function promptSync() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Sync month', 'Enter the month to pull (YYYY-MM):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var month = r.getResponseText().trim();
  if (!/^\d{4}-\d{2}$/.test(month)) { ui.alert('Expected YYYY-MM, e.g. 2026-09'); return; }
  var n = syncMonth(month);
  ui.alert('Done — wrote ' + n + ' agent rows for ' + month + '.');
}

/** Sunday closest to the 1st — matches how the sheets have always been anchored. */
function anchorSunday_(year, month) {
  var d = new Date(year, month - 1, 1);
  var dow = d.getDay();
  var fwd = (7 - dow) % 7;
  d.setDate(d.getDate() + (dow <= fwd ? -dow : fwd));
  return d;
}

function fmt_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ===========================================================================
 * Formatting, lifted from the August 2026 sheet so every generated month
 * looks identical to the ones the team already reads.
 * ======================================================================== */

var FONT_CODE  = 'Outfit';    // shift codes + date header
var FONT_NAME  = 'Comfortaa'; // agent names
var FONT_TITLE = 'Caveat';    // the "CX Schedule" wordmark
var GRID_LINE  = '#666666';
var PAPER      = '#f9f6f6';
var TITLE_INK  = '#b5838d';   // wordmark + date header text
var MONTH_INK  = '#849ec6';   // "Jun/2026" line

// Fill and ink per shift code — the muted June 2026 palette.
var CODE_FILL = {
  'S1': '#b5838d', 'S2': '#f4c2c2', 'S3': '#d8cfc4', 'S4': '#a1b7cd',
  'S5': '#9a8c98', 'S5.5': '#e9ecef', 'S6': '#7e6e63',
  'OFF': '#f9f6f6', 'AL': '#d8cfc4', 'SL': '#9faa74', 'DL': '#434343',
  'BIRTHDAY OFF': '#ead1dc', 'PUBLIC HOLIDAY': '#ead1dc',
  'EID OFF': '#ead1dc', 'TRAINING': '#ead1dc'
};
// Codes are black on their fill unless listed here.
var TEXT_OVERRIDE = {
  'S2': '#f3f3f3', 'S3': '#ffffff', 'DL': '#eaeef3',
  'BIRTHDAY OFF': '#a64d79',
  'PUBLIC HOLIDAY': '#75070c', 'EID OFF': '#75070c', 'TRAINING': '#75070c'
};

// Name-cell colour encodes job title, matching the source sheet.
var NAME_LEAD       = { bg: '#d5a6bd', fg: '#000000' }; // CX Shift Lead
var NAME_SPECIALIST = { bg: '#bde0fe', fg: '#000000' }; // CX Specialist
var NAME_NORMAL     = { bg: '#f9f6f6', fg: '#b5838d' }; // CX Agent

// Daily headcount printed under the roster, so cover can be read per column.
var SUMMARY = [
  { label: 'Morning',   codes: ['S1', 'S2', 'S3'],   bg: '#b5838d' },
  { label: 'Evening',   codes: ['S4', 'S5', 'S5.5'], bg: '#a1b7cd' },
  { label: 'Graveyard', codes: ['S6'],               bg: '#7e6e63' }
];

// Legend block printed under the roster, matching the source sheet.
var LEGEND = [
  ['S1', '6:00am - 3:00pm'], ['S2', '8:00am - 5:00pm'], ['S3', '10:00am - 7:00pm'],
  ['S4', '1:00pm - 10:00pm'], ['S5', '3:00pm - 12:00am'], ['S5.5', '8:00pm - 4:00am'],
  ['S6', '10:30pm - 6:30am'], ['OFF', ''], ['Annual Leave', ''], ['Sick Leave', '']
];
var LEGEND_FILL = {
  'OFF': '#f9f6f6', 'Annual Leave': '#d8cfc4', 'Sick Leave': '#9faa74'
};

function fillFor_(code) {
  return CODE_FILL[String(code || '').trim().toUpperCase()] || null;
}
function inkFor_(code) {
  return TEXT_OVERRIDE[String(code || '').trim().toUpperCase()] || '#000000';
}

function syncMonth(month, weeks) {
  weeks = weeks || 4;
  var tz = Session.getScriptTimeZone();
  var parts = month.split('-');
  var start = anchorSunday_(Number(parts[0]), Number(parts[1]));
  // Label from the requested month, never from the anchor Sunday: the anchor
  // often falls in the previous month (Sep 2026 anchors to Aug 30), which would
  // name the tab after — and overwrite — the wrong month.
  var monthFirst = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  var dates = [];
  for (var i = 0; i < weeks * 7; i++) {
    var d = new Date(start.getTime());
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  var from = fmt_(dates[0]);
  var to = fmt_(dates[dates.length - 1]);

  var agents = sb_('agents', 'select=id,name,is_lead,is_specialist,active&active=eq.true&order=name');
  var rows = sb_('schedules', 'select=agent_id,date,shift_code&date=gte.' + from + '&date=lte.' + to);
  var byKey = {};
  for (var j = 0; j < rows.length; j++) {
    byKey[rows[j].agent_id + '|' + rows[j].date] = rows[j].shift_code;
  }

  var nCols = dates.length + 1;
  var HEADER_ROW = 6;
  var FIRST_AGENT = 7;
  var nRows = HEADER_ROW + agents.length + SUMMARY.length + LEGEND.length;

  // Blank canvas, then fill — simpler than tracking every cell individually.
  var values = [], bgs = [], fgs = [];
  for (var r = 0; r < nRows; r++) {
    values.push(new Array(nCols).fill(''));
    bgs.push(new Array(nCols).fill(null));
    fgs.push(new Array(nCols).fill('#000000'));
  }

  // Title + month
  values[0][1] = 'CX Schedule';
  values[4][1] = Utilities.formatDate(monthFirst, tz, 'MMM/yyyy');
  for (var t = 0; t < 5; t++) for (var c = 0; c < nCols; c++) bgs[t][c] = PAPER;
  fgs[0][1] = TITLE_INK;
  fgs[4][1] = MONTH_INK;

  // Date header
  values[HEADER_ROW - 1][0] = Utilities.formatDate(monthFirst, tz, 'MMM').toUpperCase();
  for (var k = 0; k < dates.length; k++) {
    values[HEADER_ROW - 1][k + 1] = Utilities.formatDate(dates[k], tz, 'EEEE-dd');
  }
  for (var c2 = 0; c2 < nCols; c2++) { bgs[HEADER_ROW - 1][c2] = PAPER; fgs[HEADER_ROW - 1][c2] = TITLE_INK; }

  // Agents
  for (var a = 0; a < agents.length; a++) {
    var row = HEADER_ROW + a;
    var skin = agents[a].is_lead ? NAME_LEAD
              : (agents[a].is_specialist ? NAME_SPECIALIST : NAME_NORMAL);
    values[row][0] = agents[a].name;
    bgs[row][0] = skin.bg;
    fgs[row][0] = skin.fg;
    for (var t2 = 0; t2 < dates.length; t2++) {
      var code = byKey[agents[a].id + '|' + fmt_(dates[t2])] || '';
      values[row][t2 + 1] = code;
      if (code) {
        bgs[row][t2 + 1] = fillFor_(code);
        fgs[row][t2 + 1] = inkFor_(code);
      }
    }
  }

  // Daily headcount per band, read straight down each date column.
  var summaryTop = HEADER_ROW + agents.length;
  for (var S = 0; S < SUMMARY.length; S++) {
    var srow = summaryTop + S;
    values[srow][0] = SUMMARY[S].label;
    bgs[srow][0] = SUMMARY[S].bg;
    fgs[srow][0] = '#ffffff';
    for (var t3 = 0; t3 < dates.length; t3++) {
      var n = 0;
      for (var a3 = 0; a3 < agents.length; a3++) {
        var cd = String(values[HEADER_ROW + a3][t3 + 1] || '').trim().toUpperCase();
        if (SUMMARY[S].codes.indexOf(cd) >= 0) n++;
      }
      values[srow][t3 + 1] = n;
      bgs[srow][t3 + 1] = PAPER;
      fgs[srow][t3 + 1] = '#000000';
    }
  }

  // Legend, with the time repeated once per week the way the source sheet does
  var legendTop = summaryTop + SUMMARY.length;
  for (var L = 0; L < LEGEND.length; L++) {
    var lrow = legendTop + L;
    var label = LEGEND[L][0], time = LEGEND[L][1];
    values[lrow][0] = label;
    bgs[lrow][0] = LEGEND_FILL[label] || fillFor_(label) || PAPER;
    fgs[lrow][0] = bgs[lrow][0] === PAPER ? '#000000' : inkFor_(label);
    if (time) {
      for (var w = 0; w < weeks; w++) {
        values[lrow][w * 7 + 1] = time;
        fgs[lrow][w * 7 + 1] = '#20124d';
      }
    }
  }

  // ── write ──
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var title = Utilities.formatDate(monthFirst, tz, 'MMMM yyyy');
  var sh = ss.getSheetByName(title) || ss.insertSheet(title);
  Logger.log('Writing tab "' + title + '"  range ' + from + ' -> ' + to +
             '  (' + agents.length + ' agents, ' + rows.length + ' shifts found)');

  sh.clear();
  // Unfreeze before restructuring: a merge that straddles the freeze line is
  // rejected ("can't merge frozen and non-frozen rows"), and an existing tab
  // still carries whatever freeze the previous run left behind.
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  // clear() does not remove merges — break them or the next write throws
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  var rng = sh.getRange(1, 1, nRows, nCols);
  rng.setValues(values).setBackgrounds(bgs).setFontColors(fgs)
     .setVerticalAlignment('bottom');

  // Typography
  rng.setFontFamily(FONT_CODE).setFontSize(11).setFontWeight('bold')
     .setHorizontalAlignment('center');
  sh.getRange(1, 1, nRows, 1).setFontFamily(FONT_NAME).setHorizontalAlignment('left');
  sh.getRange(1, 2, 1, nCols - 1).setHorizontalAlignment('center');
  sh.getRange(1, 2).setFontSize(47).setFontFamily(FONT_TITLE);
  sh.getRange(5, 2).setFontSize(18);
  sh.getRange(HEADER_ROW, 1, 1, nCols).setFontSize(12);
  sh.getRange(FIRST_AGENT, 1, agents.length, 1).setFontSize(11);
  // Legend times read as normal-weight body text, not codes
  sh.getRange(legendTop + 1, 2, LEGEND.length, nCols - 1)
    .setFontWeight('normal').setFontColor('#20124d');

  // Grid lines only around the schedule body, as in the source
  sh.getRange(HEADER_ROW, 1, agents.length + SUMMARY.length + 1, nCols)
    .setBorder(true, true, true, true, true, true, GRID_LINE, SpreadsheetApp.BorderStyle.SOLID);

  // Title spans the full width across rows 1-4, month across row 5 (as in the source)
  sh.getRange(1, 1, 4, 1).merge();
  sh.getRange(1, 2, 4, nCols - 1).merge().setVerticalAlignment('middle');
  sh.getRange(5, 2, 1, nCols - 1).merge();

  sh.setFrozenRows(HEADER_ROW);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 170);
  for (var cw = 2; cw <= nCols; cw++) sh.setColumnWidth(cw, 92);
  sh.setRowHeights(1, nRows, 21);
  sh.getRange(1, 2).setFontWeight('bold');

  return agents.length;
}
