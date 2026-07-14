/*
 * TimeCalculator — feuille de temps (punch in/out) et journal des
 * interventions techniques.
 *
 * Deux registres indépendants :
 *  - punches : périodes travaillées, enregistrées sans aucune question
 *    au punch out — c'est la feuille de temps;
 *  - interventions : travaux décrits pour un client (client, catégorie,
 *    description, facturable), inscrits manuellement.
 *
 * Données conservées dans le localStorage du navigateur (clé "timecalculator.v1").
 */
"use strict";

const STORAGE_KEY = "timecalculator.v1";

/* ---------- État ---------- */

// state.activePunch : { start: ms } ou null
// state.punches : [{ id, start: ms, end: ms }]
// state.interventions : [{ id, start: ms, end: ms, client, ticket, category, description, billable }]
let state = load();
let timerInterval = null;

// Journée en cours : seule journée dépliée par défaut dans la feuille de
// temps. Les choix manuels (déplier/replier) valent pour la session.
let todayKey = dateISO(new Date());
const dayOverrides = new Map();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.interventions) || Array.isArray(data.punches)) {
        return normalizeState(data);
      }
    }
  } catch (e) {
    console.error("Données locales illisibles, réinitialisation.", e);
  }
  return { activePunch: null, punches: [], interventions: [] };
}

function normalizeState(data) {
  return {
    activePunch: data.activePunch || null,
    punches: Array.isArray(data.punches) ? data.punches : [],
    interventions: Array.isArray(data.interventions) ? data.interventions : [],
  };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function genId() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 7);
}

/* ---------- Utilitaires date/durée ---------- */

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeHM(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayLabel(d) {
  const s = d.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function minutesBetween(startMs, endMs) {
  return Math.round((endMs - startMs) / 60000);
}

function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${pad(m)}`;
}

function fmtDecimalHours(minutes) {
  return (minutes / 60).toFixed(2).replace(".", ",");
}

// Début de journée locale
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Début de semaine (lundi)
function startOfWeek(d) {
  const day = (d.getDay() + 6) % 7; // lundi = 0
  const s = startOfDay(d);
  s.setDate(s.getDate() - day);
  return s;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/* ---------- Éléments ---------- */

const $ = (id) => document.getElementById(id);

const els = {
  statusDot: $("status-dot"),
  statusLabel: $("status-label"),
  statusDetail: $("status-detail"),
  punchTimer: $("punch-timer"),
  btnPunchIn: $("btn-punch-in"),
  btnPunchOut: $("btn-punch-out"),
  btnCancelPunch: $("btn-cancel-punch"),
  statToday: $("stat-today"),
  statWeek: $("stat-week"),
  statMonth: $("stat-month"),
  filterPeriod: $("filter-period"),
  customRange: $("custom-range"),
  filterFrom: $("filter-from"),
  filterTo: $("filter-to"),
  filterClient: $("filter-client"),
  btnExportJson: $("btn-export-json"),
  inputImport: $("input-import"),
  // Feuille de temps
  btnAddPunch: $("btn-add-punch"),
  btnExportPunches: $("btn-export-punches"),
  punchTotal: $("punch-total"),
  punchTbody: $("punch-tbody"),
  punchEmpty: $("punch-empty"),
  punchDialog: $("punch-dialog"),
  punchDialogTitle: $("punch-dialog-title"),
  punchForm: $("punch-form"),
  pId: $("p-id"),
  pDate: $("p-date"),
  pStart: $("p-start"),
  pEnd: $("p-end"),
  pDuration: $("p-duration"),
  pError: $("p-error"),
  btnPunchDialogCancel: $("btn-punch-dialog-cancel"),
  // Interventions
  btnAddIntervention: $("btn-add-intervention"),
  btnExportInterventions: $("btn-export-interventions"),
  interventionTotal: $("intervention-total"),
  interventionTbody: $("intervention-tbody"),
  interventionEmpty: $("intervention-empty"),
  interventionDialog: $("intervention-dialog"),
  interventionDialogTitle: $("intervention-dialog-title"),
  interventionForm: $("intervention-form"),
  fId: $("f-id"),
  fDate: $("f-date"),
  fStart: $("f-start"),
  fEnd: $("f-end"),
  fDuration: $("f-duration"),
  fClient: $("f-client"),
  fTicket: $("f-ticket"),
  clientList: $("client-list"),
  fCategory: $("f-category"),
  fDescription: $("f-description"),
  fBillable: $("f-billable"),
  fError: $("f-error"),
  btnInterventionDialogCancel: $("btn-intervention-dialog-cancel"),
};

/* ---------- Punch in / out ---------- */

function punchIn() {
  if (state.activePunch) return;
  state.activePunch = { start: Date.now() };
  save();
  renderPunchCard();
}

// Le punch out enregistre la période directement, sans rien demander.
function punchOut() {
  if (!state.activePunch) return;
  const start = state.activePunch.start;
  // Minimum d'une minute pour qu'un punch très court reste visible.
  const end = Math.max(Date.now(), start + 60000);
  state.punches.push({ id: genId(), start, end });
  state.activePunch = null;
  save();
  render();
}

function cancelPunch() {
  if (!state.activePunch) return;
  if (!confirm("Annuler le punch en cours ? Aucune période ne sera enregistrée.")) return;
  state.activePunch = null;
  save();
  renderPunchCard();
}

function renderPunchCard() {
  const active = !!state.activePunch;
  els.statusDot.classList.toggle("active", active);
  els.btnPunchIn.hidden = active;
  els.btnPunchOut.hidden = !active;
  els.btnCancelPunch.hidden = !active;
  els.punchTimer.hidden = !active;

  if (active) {
    const start = new Date(state.activePunch.start);
    els.statusLabel.textContent = "Au travail";
    els.statusDetail.textContent = `Punch in à ${timeHM(start)} (${start.toLocaleDateString("fr-CA")})`;
    updateTimer();
    if (!timerInterval) timerInterval = setInterval(updateTimer, 1000);
  } else {
    els.statusLabel.textContent = "Hors service";
    els.statusDetail.textContent = "Appuyez sur « Punch In » pour commencer";
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }
}

function updateTimer() {
  if (!state.activePunch) return;
  const s = Math.max(0, Math.floor((Date.now() - state.activePunch.start) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  els.punchTimer.textContent = `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

/* ---------- Formulaires : outils communs ---------- */

// Reconstruit les timestamps à partir de champs date/début/fin.
// Une fin strictement antérieure au début est interprétée comme passant minuit.
function timesFromFields(dateEl, startEl, endEl) {
  const start = new Date(`${dateEl.value}T${startEl.value}`);
  let end = new Date(`${dateEl.value}T${endEl.value}`);
  if (isNaN(start) || isNaN(end)) return null;
  if (end < start) end = new Date(end.getTime() + 24 * 3600 * 1000);
  return { start: start.getTime(), end: end.getTime() };
}

function showDuration(el, times) {
  if (!times) {
    el.textContent = "Durée : —";
    return;
  }
  const min = minutesBetween(times.start, times.end);
  el.textContent = `Durée : ${fmtDuration(min)} (${fmtDecimalHours(min)} h)`;
}

const INVALID_DURATION_MSG = "Vérifiez la date et les heures : la durée doit être supérieure à zéro.";

/* ---------- Feuille de temps : dialogue et CRUD ---------- */

function openPunchDialog(opts) {
  els.punchDialogTitle.textContent = opts.title;
  els.pId.value = opts.id || "";
  els.pDate.value = opts.date;
  els.pStart.value = opts.start;
  els.pEnd.value = opts.end;
  els.pError.hidden = true;
  updatePunchFormDuration();
  els.punchDialog.showModal();
}

function updatePunchFormDuration() {
  showDuration(els.pDuration, timesFromFields(els.pDate, els.pStart, els.pEnd));
}

function submitPunchForm(event) {
  event.preventDefault();
  const t = timesFromFields(els.pDate, els.pStart, els.pEnd);
  if (!t || minutesBetween(t.start, t.end) <= 0) {
    els.pError.textContent = INVALID_DURATION_MSG;
    els.pError.hidden = false;
    return;
  }
  const record = { id: els.pId.value || genId(), start: t.start, end: t.end };
  const idx = state.punches.findIndex((p) => p.id === record.id);
  if (idx >= 0) state.punches[idx] = record;
  else state.punches.push(record);
  save();
  els.punchDialog.close();
  render();
}

function editPunch(id) {
  const p = state.punches.find((x) => x.id === id);
  if (!p) return;
  const start = new Date(p.start);
  const end = new Date(p.end);
  openPunchDialog({
    title: "Modifier la période",
    id: p.id,
    date: dateISO(start),
    start: timeHM(start),
    end: timeHM(end),
  });
}

function deletePunch(id) {
  const p = state.punches.find((x) => x.id === id);
  if (!p) return;
  const start = new Date(p.start);
  if (!confirm(`Supprimer la période du ${dateISO(start)} (${timeHM(start)}–${timeHM(new Date(p.end))}) ?`)) return;
  state.punches = state.punches.filter((x) => x.id !== id);
  save();
  render();
}

/* ---------- Interventions : dialogue et CRUD ---------- */

function openInterventionDialog(opts) {
  els.interventionDialogTitle.textContent = opts.title;
  els.fId.value = opts.id || "";
  els.fDate.value = opts.date;
  els.fStart.value = opts.start;
  els.fEnd.value = opts.end;
  els.fClient.value = opts.client || "";
  els.fTicket.value = opts.ticket || "";
  els.fCategory.value = opts.category || "Dépannage";
  els.fDescription.value = opts.description || "";
  els.fBillable.checked = opts.billable !== false;
  els.fError.hidden = true;
  refreshClientDatalist();
  updateInterventionFormDuration();
  els.interventionDialog.showModal();
}

function updateInterventionFormDuration() {
  showDuration(els.fDuration, timesFromFields(els.fDate, els.fStart, els.fEnd));
}

function submitInterventionForm(event) {
  event.preventDefault();
  const t = timesFromFields(els.fDate, els.fStart, els.fEnd);
  if (!t || minutesBetween(t.start, t.end) <= 0) {
    els.fError.textContent = INVALID_DURATION_MSG;
    els.fError.hidden = false;
    return;
  }
  const client = els.fClient.value.trim();
  const description = els.fDescription.value.trim();
  if (!client && !description) {
    els.fError.textContent = "Inscrivez au moins un client ou une explication.";
    els.fError.hidden = false;
    return;
  }

  const record = {
    id: els.fId.value || genId(),
    start: t.start,
    end: t.end,
    client,
    ticket: els.fTicket.value.trim(),
    category: els.fCategory.value,
    description,
    billable: els.fBillable.checked,
  };

  const idx = state.interventions.findIndex((i) => i.id === record.id);
  if (idx >= 0) state.interventions[idx] = record;
  else state.interventions.push(record);

  save();
  els.interventionDialog.close();
  render();
}

function editIntervention(id) {
  const i = state.interventions.find((x) => x.id === id);
  if (!i) return;
  const start = new Date(i.start);
  const end = new Date(i.end);
  openInterventionDialog({
    title: "Modifier l'intervention",
    id: i.id,
    date: dateISO(start),
    start: timeHM(start),
    end: timeHM(end),
    client: i.client,
    ticket: i.ticket,
    category: i.category,
    description: i.description,
    billable: i.billable,
  });
}

function deleteIntervention(id) {
  const i = state.interventions.find((x) => x.id === id);
  if (!i) return;
  const label = i.client ? ` (${i.client})` : "";
  if (!confirm(`Supprimer cette intervention${label} ?`)) return;
  state.interventions = state.interventions.filter((x) => x.id !== id);
  save();
  render();
}

function refreshClientDatalist() {
  const clients = uniqueClients();
  els.clientList.innerHTML = "";
  for (const c of clients) {
    const opt = document.createElement("option");
    opt.value = c;
    els.clientList.appendChild(opt);
  }
}

function uniqueClients() {
  const set = new Set();
  for (const i of state.interventions) {
    if (i.client) set.add(i.client);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

/* ---------- Filtres et rendu ---------- */

function filterRange() {
  const now = new Date();
  switch (els.filterPeriod.value) {
    case "today":
      return [startOfDay(now).getTime(), Infinity];
    case "week":
      return [startOfWeek(now).getTime(), Infinity];
    case "month":
      return [startOfMonth(now).getTime(), Infinity];
    case "last-month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = startOfMonth(now);
      return [from.getTime(), to.getTime()];
    }
    case "custom": {
      const from = els.filterFrom.value ? new Date(`${els.filterFrom.value}T00:00`) : null;
      const to = els.filterTo.value ? new Date(`${els.filterTo.value}T00:00`) : null;
      return [
        from ? from.getTime() : -Infinity,
        to ? to.getTime() + 24 * 3600 * 1000 : Infinity,
      ];
    }
    default:
      return [-Infinity, Infinity];
  }
}

function filteredPunches() {
  const [from, to] = filterRange();
  return state.punches
    .filter((p) => p.start >= from && p.start < to)
    .sort((a, b) => b.start - a.start);
}

function filteredInterventions() {
  const [from, to] = filterRange();
  const client = els.filterClient.value;
  return state.interventions
    .filter((i) => i.start >= from && i.start < to && (!client || i.client === client))
    .sort((a, b) => b.start - a.start);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render() {
  renderPunchCard();
  renderStats();
  renderPunchTable();
  renderClientFilter();
  renderInterventionTable();
}

// Le sommaire reflète la feuille de temps (les punchs).
function renderStats() {
  const now = new Date();
  const sums = { today: 0, week: 0, month: 0 };
  const dayStart = startOfDay(now).getTime();
  const weekStart = startOfWeek(now).getTime();
  const monthStart = startOfMonth(now).getTime();
  for (const p of state.punches) {
    const min = minutesBetween(p.start, p.end);
    if (p.start >= dayStart) sums.today += min;
    if (p.start >= weekStart) sums.week += min;
    if (p.start >= monthStart) sums.month += min;
  }
  els.statToday.textContent = fmtDuration(sums.today);
  els.statWeek.textContent = fmtDuration(sums.week);
  els.statMonth.textContent = fmtDuration(sums.month);
}

// La journée en cours est dépliée (détail des périodes); les journées
// terminées sont repliées sur leur total et se déplient d'un clic.
function isDayExpanded(day) {
  if (dayOverrides.has(day)) return dayOverrides.get(day);
  return day === todayKey;
}

function toggleDay(day) {
  dayOverrides.set(day, !isDayExpanded(day));
  renderPunchTable();
}

// Tableau de la feuille de temps, groupé par jour avec total quotidien.
function renderPunchTable() {
  const rows = filteredPunches();
  els.punchTbody.innerHTML = "";
  els.punchEmpty.hidden = rows.length > 0;

  const dayTotals = new Map();
  const dayCounts = new Map();
  let total = 0;
  for (const p of rows) {
    const day = dateISO(new Date(p.start));
    const min = minutesBetween(p.start, p.end);
    dayTotals.set(day, (dayTotals.get(day) || 0) + min);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    total += min;
  }

  let currentDay = null;
  for (const p of rows) {
    const start = new Date(p.start);
    const end = new Date(p.end);
    const day = dateISO(start);

    if (day !== currentDay) {
      currentDay = day;
      const expanded = isDayExpanded(day);
      const count = dayCounts.get(day);
      const trDay = document.createElement("tr");
      trDay.className = "day-row";
      trDay.dataset.day = day;
      trDay.title = "Cliquer pour afficher ou masquer le détail";
      trDay.innerHTML = `
        <td colspan="2"><span class="chevron">${expanded ? "▾" : "▸"}</span>${dayLabel(start)} · ${count} période${count > 1 ? "s" : ""}</td>
        <td colspan="2">Total : ${fmtDuration(dayTotals.get(day))}</td>`;
      els.punchTbody.appendChild(trDay);
    }

    if (!isDayExpanded(day)) continue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${timeHM(start)}</td>
      <td>${timeHM(end)}</td>
      <td>${fmtDuration(minutesBetween(p.start, p.end))}</td>
      <td>
        <span class="row-actions">
          <button class="icon-btn" data-edit-punch="${p.id}" title="Modifier">✏️</button>
          <button class="icon-btn delete" data-delete-punch="${p.id}" title="Supprimer">✕</button>
        </span>
      </td>`;
    els.punchTbody.appendChild(tr);
  }

  els.punchTotal.innerHTML =
    rows.length === 0
      ? ""
      : `${rows.length} période${rows.length > 1 ? "s" : ""} — total travaillé : ` +
        `<strong>${fmtDuration(total)}</strong> (${fmtDecimalHours(total)} h)`;
}

function renderClientFilter() {
  const current = els.filterClient.value;
  const clients = uniqueClients();
  els.filterClient.innerHTML = '<option value="">Tous les clients</option>';
  for (const c of clients) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    els.filterClient.appendChild(opt);
  }
  if (clients.includes(current)) els.filterClient.value = current;
}

function renderInterventionTable() {
  const rows = filteredInterventions();
  els.interventionTbody.innerHTML = "";
  els.interventionEmpty.hidden = rows.length > 0;

  let total = 0;
  let billableTotal = 0;
  for (const i of rows) {
    const start = new Date(i.start);
    const end = new Date(i.end);
    const min = minutesBetween(i.start, i.end);
    total += min;
    if (i.billable) billableTotal += min;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dateISO(start)}</td>
      <td>${timeHM(start)}</td>
      <td>${timeHM(end)}</td>
      <td>${fmtDuration(min)}</td>
      <td>${escapeHtml(i.client) || "—"}</td>
      <td>${escapeHtml(i.ticket || "") || "—"}</td>
      <td>${escapeHtml(i.category)}</td>
      <td class="desc">${escapeHtml(i.description) || "—"}</td>
      <td>${i.billable ? "✓" : "—"}</td>
      <td>
        <span class="row-actions">
          <button class="icon-btn" data-edit-intervention="${i.id}" title="Modifier">✏️</button>
          <button class="icon-btn delete" data-delete-intervention="${i.id}" title="Supprimer">✕</button>
        </span>
      </td>`;
    els.interventionTbody.appendChild(tr);
  }

  els.interventionTotal.innerHTML =
    rows.length === 0
      ? ""
      : `${rows.length} intervention${rows.length > 1 ? "s" : ""} — total : ` +
        `<strong>${fmtDuration(total)}</strong> (${fmtDecimalHours(total)} h), ` +
        `dont facturable : <strong>${fmtDuration(billableTotal)}</strong> (${fmtDecimalHours(billableTotal)} h)`;
}

/* ---------- Export / import ---------- */

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function csvField(value) {
  const s = String(value ?? "");
  if (/[;"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// BOM UTF-8 pour qu'Excel affiche correctement les accents
function downloadCsv(name, lines) {
  downloadFile(name, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

function exportPunchesCsv() {
  const rows = filteredPunches();
  if (rows.length === 0) {
    alert("Aucune période à exporter pour cette période.");
    return;
  }
  const lines = ["Date;Début;Fin;Durée (min);Durée (h)"];
  for (const p of [...rows].reverse()) {
    const start = new Date(p.start);
    const min = minutesBetween(p.start, p.end);
    lines.push([dateISO(start), timeHM(start), timeHM(new Date(p.end)), min, fmtDecimalHours(min)].join(";"));
  }
  downloadCsv(`feuille-de-temps-${dateISO(new Date())}.csv`, lines);
}

function exportInterventionsCsv() {
  const rows = filteredInterventions();
  if (rows.length === 0) {
    alert("Aucune intervention à exporter pour cette période.");
    return;
  }
  const lines = ["Date;Début;Fin;Durée (min);Durée (h);Client;Billet;Catégorie;Description;Facturable"];
  for (const i of [...rows].reverse()) {
    const start = new Date(i.start);
    const min = minutesBetween(i.start, i.end);
    lines.push(
      [
        dateISO(start),
        timeHM(start),
        timeHM(new Date(i.end)),
        min,
        fmtDecimalHours(min),
        csvField(i.client),
        csvField(i.ticket || ""),
        csvField(i.category),
        csvField(i.description),
        i.billable ? "Oui" : "Non",
      ].join(";")
    );
  }
  downloadCsv(`interventions-${dateISO(new Date())}.csv`, lines);
}

function exportJson() {
  downloadFile(
    `timecalculator-sauvegarde-${dateISO(new Date())}.json`,
    JSON.stringify(state, null, 2),
    "application/json"
  );
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || (!Array.isArray(data.interventions) && !Array.isArray(data.punches))) {
        throw new Error("format invalide");
      }
      const next = normalizeState(data);
      const nP = next.punches.length;
      const nI = next.interventions.length;
      if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${nP} période${nP > 1 ? "s" : ""}, ${nI} intervention${nI > 1 ? "s" : ""}) ?`)) {
        return;
      }
      state = next;
      save();
      render();
    } catch (e) {
      alert("Fichier de sauvegarde invalide : " + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- Événements ---------- */

els.btnPunchIn.addEventListener("click", punchIn);
els.btnPunchOut.addEventListener("click", punchOut);
els.btnCancelPunch.addEventListener("click", cancelPunch);

els.btnAddPunch.addEventListener("click", () => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
  openPunchDialog({
    title: "Ajouter une période travaillée",
    date: dateISO(now),
    start: timeHM(oneHourAgo),
    end: timeHM(now),
  });
});

els.punchForm.addEventListener("submit", submitPunchForm);
els.btnPunchDialogCancel.addEventListener("click", () => els.punchDialog.close());
for (const id of ["p-date", "p-start", "p-end"]) {
  $(id).addEventListener("input", updatePunchFormDuration);
}

els.btnAddIntervention.addEventListener("click", () => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
  openInterventionDialog({
    title: "Inscrire une intervention",
    date: dateISO(now),
    start: timeHM(oneHourAgo),
    end: timeHM(now),
  });
});

els.interventionForm.addEventListener("submit", submitInterventionForm);
els.btnInterventionDialogCancel.addEventListener("click", () => els.interventionDialog.close());
for (const id of ["f-date", "f-start", "f-end"]) {
  $(id).addEventListener("input", updateInterventionFormDuration);
}

els.filterPeriod.addEventListener("change", () => {
  els.customRange.hidden = els.filterPeriod.value !== "custom";
  renderPunchTable();
  renderInterventionTable();
});
els.filterFrom.addEventListener("change", () => { renderPunchTable(); renderInterventionTable(); });
els.filterTo.addEventListener("change", () => { renderPunchTable(); renderInterventionTable(); });
els.filterClient.addEventListener("change", renderInterventionTable);

els.punchTbody.addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (btn) {
    if (btn.dataset.editPunch) editPunch(btn.dataset.editPunch);
    if (btn.dataset.deletePunch) deletePunch(btn.dataset.deletePunch);
    return;
  }
  const dayRow = event.target.closest("tr.day-row");
  if (dayRow) toggleDay(dayRow.dataset.day);
});

els.interventionTbody.addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn) return;
  if (btn.dataset.editIntervention) editIntervention(btn.dataset.editIntervention);
  if (btn.dataset.deleteIntervention) deleteIntervention(btn.dataset.deleteIntervention);
});

els.btnExportPunches.addEventListener("click", exportPunchesCsv);
els.btnExportInterventions.addEventListener("click", exportInterventionsCsv);
els.btnExportJson.addEventListener("click", exportJson);
els.inputImport.addEventListener("change", () => {
  if (els.inputImport.files.length > 0) {
    importJson(els.inputImport.files[0]);
    els.inputImport.value = "";
  }
});

/* ---------- Démarrage ---------- */

// Au changement de jour, la journée qui se termine se replie et rejoint
// les autres journées de la semaine; le sommaire repart pour le nouveau jour.
setInterval(() => {
  const now = dateISO(new Date());
  if (now !== todayKey) {
    todayKey = now;
    dayOverrides.clear();
    render();
  }
}, 30000);

render();
