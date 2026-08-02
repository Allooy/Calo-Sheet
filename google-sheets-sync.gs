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
function sb_(path, query) {
  var base = cfg_('SUPABASE_URL') + '/rest/v1/' + path + '?' + query;
  var key = cfg_('SUPABASE_SERVICE_KEY');
  var out = [];
  var size = 1000;
  for (var page = 0; page < 100; page++) {
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

function syncMonth(month, weeks) {
  weeks = weeks || 4;
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

  var agents = sb_('agents', 'select=id,name,is_lead,active&active=eq.true&order=name');
  var rows = sb_('schedules', 'select=agent_id,date,shift_code&date=gte.' + from + '&date=lte.' + to);

  var byKey = {};
  for (var j = 0; j < rows.length; j++) {
    byKey[rows[j].agent_id + '|' + rows[j].date] = rows[j].shift_code;
  }

  var header = [Utilities.formatDate(monthFirst, Session.getScriptTimeZone(), 'MMMM')];
  for (var k = 0; k < dates.length; k++) {
    header.push(Utilities.formatDate(dates[k], Session.getScriptTimeZone(), 'EEEE-dd'));
  }

  var table = [header];
  for (var a = 0; a < agents.length; a++) {
    var line = [agents[a].name];
    for (var t = 0; t < dates.length; t++) {
      line.push(byKey[agents[a].id + '|' + fmt_(dates[t])] || '');
    }
    table.push(line);
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var title = Utilities.formatDate(monthFirst, Session.getScriptTimeZone(), 'MMMM yyyy');
  var sh = ss.getSheetByName(title) || ss.insertSheet(title);
  var filled = 0;
  for (var q = 0; q < rows.length; q++) filled++;
  Logger.log('Writing tab "' + title + '"  range ' + from + ' → ' + to +
             '  (' + agents.length + ' agents, ' + filled + ' shifts found)');
  sh.clear();
  sh.getRange(1, 1, table.length, header.length).setValues(table);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.autoResizeColumn(1);
  return agents.length;
}
