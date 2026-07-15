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

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  OAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, MICROSOFT_TENANT_ID } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

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
  return { activePunch: null, punches: [], interventions: [], updatedAt: 0 };
}

function normalizeState(data) {
  return {
    activePunch: data.activePunch || null,
    punches: Array.isArray(data.punches) ? data.punches : [],
    interventions: Array.isArray(data.interventions) ? data.interventions : [],
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

let userDocRef = null;
let applyingRemote = false;

// Horodatage de la dernière modification locale : sert à ignorer les échos
// Firestore périmés qui arriveraient après un ajout local plus récent (ce qui
// effaçait silencieusement l'ajout avant ce correctif — voir onSnapshot plus bas).
function save() {
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (userDocRef && !applyingRemote) {
    setDoc(userDocRef, state).catch((e) => console.error("Synchronisation Firestore échouée.", e));
  }
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
  filterToVerify: $("filter-to-verify"),
  btnExportReport: $("btn-export-report"),
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
  btnMergeInterventions: $("btn-merge-interventions"),
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
  fToVerify: $("f-to-verify"),
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
  ensureVisible(record.start);
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
  els.fToVerify.checked = !!opts.toVerify;
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
    toVerify: els.fToVerify.checked,
  };

  const idx = state.interventions.findIndex((i) => i.id === record.id);
  if (idx >= 0) state.interventions[idx] = record;
  else state.interventions.push(record);

  save();
  els.interventionDialog.close();
  ensureInterventionVisible(record);
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
    toVerify: i.toVerify,
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

// Ouvre le rapport complet de la période affichée (peu importe le filtre
// actif — aujourd'hui, semaine, mois, tout, personnalisée…), avec la
// section Interventions regroupée par numéro de billet plutôt que par
// semaine. Aucune donnée enregistrée n'est jamais modifiée : c'est toujours
// une simple vue de rapport, disponible en tout temps.
function mergeInterventions() {
  generateWeeklyReport(true);
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
    case "last-week": {
      const to = startOfWeek(now);
      const from = new Date(to);
      from.setDate(from.getDate() - 7);
      return [from.getTime(), to.getTime()];
    }
    case "2weeks": {
      const from = new Date(startOfWeek(now));
      from.setDate(from.getDate() - 7);
      return [from.getTime(), Infinity];
    }
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

// Bref avis visuel non bloquant (ex. quand le filtre change automatiquement).
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Si un enregistrement fraîchement ajouté tombe hors du filtre de période
// actif (ex. plage personnalisée périmée), on bascule sur « Tout » pour
// qu'il soit immédiatement visible, plutôt que de laisser croire qu'il n'a
// pas été enregistré.
function ensureVisible(recordStartMs) {
  const [from, to] = filterRange();
  if (recordStartMs >= from && recordStartMs < to) return;
  els.filterPeriod.value = "all";
  els.customRange.hidden = true;
  showToast("Filtre changé pour « Tout » afin d'afficher l'ajout le plus récent.");
}

// Variante pour les interventions : tient compte aussi du filtre client.
function ensureInterventionVisible(record) {
  const [from, to] = filterRange();
  const periodOk = record.start >= from && record.start < to;
  const clientFilter = els.filterClient.value;
  const clientOk = !clientFilter || clientFilter === record.client;
  if (periodOk && clientOk) return;
  els.filterPeriod.value = "all";
  els.customRange.hidden = true;
  els.filterClient.value = "";
  showToast("Filtre changé pour « Tout » afin d'afficher l'ajout le plus récent.");
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
  const toVerifyOnly = els.filterToVerify.checked;
  return state.interventions
    .filter(
      (i) =>
        i.start >= from &&
        i.start < to &&
        (!client || i.client === client) &&
        (!toVerifyOnly || i.toVerify)
    )
    .sort((a, b) => b.start - a.start);
}

function toggleInterventionVerify(id) {
  const i = state.interventions.find((x) => x.id === id);
  if (!i) return;
  i.toVerify = !i.toVerify;
  save();
  renderInterventionTable();
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

// Sous-lignes dépliables (segments) des interventions fusionnées : par
// défaut dépliées pour garder la durée de chaque intervention d'origine
// visible séparément. État par intervention, conservé pour la session.
const interventionSegmentsExpanded = new Map();

function isInterventionExpanded(id) {
  return interventionSegmentsExpanded.has(id) ? interventionSegmentsExpanded.get(id) : true;
}

function toggleInterventionSegments(id) {
  interventionSegmentsExpanded.set(id, !isInterventionExpanded(id));
  renderInterventionTable();
}

function renderInterventionTable() {
  const rows = filteredInterventions();
  els.interventionTbody.innerHTML = "";
  els.interventionEmpty.hidden = rows.length > 0;

  let total = 0;
  for (const i of rows) {
    const start = new Date(i.start);
    const end = new Date(i.end);
    const min = minutesBetween(i.start, i.end);
    total += min;

    const hasSegments = Array.isArray(i.segments) && i.segments.length > 1;
    const expanded = hasSegments && isInterventionExpanded(i.id);

    const tr = document.createElement("tr");
    if (hasSegments) tr.className = "merged-row";
    if (i.toVerify) tr.classList.add("to-verify-row");
    tr.innerHTML = `
      <td>${
        hasSegments
          ? `<span class="chevron" data-toggle-segments="${i.id}" title="Afficher ou masquer les ${i.segments.length} durées d'origine">${expanded ? "▾" : "▸"}</span>`
          : ""
      }${dateISO(start)}</td>
      <td>${timeHM(start)}</td>
      <td>${timeHM(end)}</td>
      <td>${fmtDuration(min)}${hasSegments ? ` <span class="muted">(${i.segments.length} durées)</span>` : ""}</td>
      <td>${escapeHtml(i.client) || "—"}</td>
      <td>${escapeHtml(i.ticket || "") || "—"}</td>
      <td>${escapeHtml(i.category)}</td>
      <td class="desc">${escapeHtml(i.description) || "—"}</td>
      <td>${i.billable ? "✓" : "—"}</td>
      <td class="center"><input type="checkbox" data-toggle-verify="${i.id}" title="À vérifier avant facturation" ${i.toVerify ? "checked" : ""}></td>
      <td>
        <span class="row-actions">
          <button class="icon-btn" data-edit-intervention="${i.id}" title="Modifier">✏️</button>
          <button class="icon-btn delete" data-delete-intervention="${i.id}" title="Supprimer">✕</button>
        </span>
      </td>`;
    els.interventionTbody.appendChild(tr);

    if (expanded) {
      for (const seg of i.segments) {
        const segStart = new Date(seg.start);
        const segEnd = new Date(seg.end);
        const segMin = minutesBetween(seg.start, seg.end);
        const trSeg = document.createElement("tr");
        trSeg.className = "segment-row";
        trSeg.innerHTML = `
          <td></td>
          <td>${timeHM(segStart)}</td>
          <td>${timeHM(segEnd)}</td>
          <td>${fmtDuration(segMin)}</td>
          <td>${escapeHtml(seg.client) || "—"}</td>
          <td>—</td>
          <td>${escapeHtml(seg.category)}</td>
          <td class="desc">${escapeHtml(seg.description) || "—"}</td>
          <td>${seg.billable ? "✓" : "—"}</td>
          <td></td>
          <td></td>`;
        els.interventionTbody.appendChild(trSeg);
      }
    }
  }

  els.interventionTotal.innerHTML =
    rows.length === 0
      ? ""
      : `${rows.length} intervention${rows.length > 1 ? "s" : ""} — total : ` +
        `<strong>${fmtDuration(total)}</strong> (${fmtDecimalHours(total)} h)`;
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
  const lines = ["Date;Début;Fin;Durée (min);Durée (h);Client;Billet;Catégorie;Description;Facturable;À vérifier"];
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
        i.toVerify ? "Oui" : "Non",
      ].join(";")
    );
  }
  downloadCsv(`interventions-${dateISO(new Date())}.csv`, lines);
}

/* ---------- Rapport hebdomadaire (impression / PDF) ---------- */

function isoWeekLabel(monday) {
  const sunday = new Date(monday.getTime() + 6 * 24 * 3600 * 1000);
  const fmtLong = (d) => d.toLocaleDateString("fr-CA", { day: "numeric", month: "long" });
  const range =
    monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()} au ${fmtLong(sunday)}`
      : `${fmtLong(monday)} au ${fmtLong(sunday)}`;
  return `Semaine du ${range} ${sunday.getFullYear()}`;
}

// Regroupe des interventions déjà filtrées par période par numéro de billet,
// peu importe la date. Vue de rapport uniquement, aucune donnée modifiée.
function buildTicketMergedInterventionSection(interventions) {
  const groups = new Map();
  for (const i of interventions) {
    const ticket = (i.ticket || "").trim();
    const key = ticket || `__sans-billet__${i.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }

  const rows = [...groups.values()]
    .map((items) => {
      items.sort((a, b) => a.start - b.start);
      const ticket = (items[0].ticket || "").trim();
      const min = items.reduce((sum, i) => sum + minutesBetween(i.start, i.end), 0);
      const toVerify = items.some((i) => i.toVerify);
      const billable = items.some((i) => i.billable);
      const clients = [...new Set(items.map((i) => i.client).filter(Boolean))];
      const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
      const dates = [...new Set(items.map((i) => dateISO(new Date(i.start))))].sort();
      const detail = items
        .map((i) => {
          const s = new Date(i.start);
          const e = new Date(i.end);
          const desc = i.description ? ` — ${escapeHtml(i.description)}` : "";
          return `${dateISO(s)} ${timeHM(s)}–${timeHM(e)}${desc}`;
        })
        .join("<br>");

      return {
        firstStart: items[0].start,
        html: `<tr${toVerify ? ' class="to-verify-row"' : ""}>
          <td>${dates.join(", ")}</td>
          <td>${escapeHtml(ticket) || "—"}</td>
          <td>${fmtDuration(min)}</td>
          <td>${escapeHtml(clients.join(" / ")) || "—"}</td>
          <td>${escapeHtml(categories.join(" / "))}</td>
          <td class="desc">${detail}</td>
          <td class="center">${billable ? "✓" : "—"}</td>
          <td class="center">${toVerify ? "⚠️" : "—"}</td>
        </tr>`,
      };
    })
    .sort((a, b) => a.firstStart - b.firstStart)
    .map((r) => r.html)
    .join("");

  return `
  <section class="week">
    <table>
      <thead><tr><th>Dates</th><th>Billet</th><th>Durée totale</th><th>Client(s)</th><th>Catégorie(s)</th><th>Détail</th><th>Fact.</th><th>Vérif.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

// mergeByTicket (uniquement pertinent en mode Période personnalisée) :
// remplace la répartition des interventions par semaine par un regroupement
// par numéro de billet, peu importe la date — mais toujours limité aux
// interventions de la période affichée, et sans modifier aucune donnée
// enregistrée (vue de rapport uniquement).
function generateWeeklyReport(mergeByTicket) {
  const [from, to] = filterRange();
  const punches = state.punches.filter((p) => p.start >= from && p.start < to).sort((a, b) => a.start - b.start);
  const interventions = state.interventions
    .filter((i) => i.start >= from && i.start < to)
    .sort((a, b) => a.start - b.start);

  if (punches.length === 0 && interventions.length === 0) {
    alert("Aucune donnée à inclure dans le rapport pour cette période.");
    return;
  }

  const weeks = new Map();
  const weekKeyOf = (ms) => startOfWeek(new Date(ms)).getTime();
  for (const p of punches) {
    const k = weekKeyOf(p.start);
    if (!weeks.has(k)) weeks.set(k, { monday: new Date(k), punches: [], interventions: [] });
    weeks.get(k).punches.push(p);
  }
  for (const i of interventions) {
    const k = weekKeyOf(i.start);
    if (!weeks.has(k)) weeks.set(k, { monday: new Date(k), punches: [], interventions: [] });
    weeks.get(k).interventions.push(i);
  }
  const sortedWeeks = [...weeks.values()].sort((a, b) => a.monday - b.monday);

  let grandPunchMin = 0;
  let grandInterventionMin = 0;
  let grandBillableMin = 0;
  const grandToVerifyCount = interventions.filter((i) => i.toVerify).length;

  // Deux parties distinctes plutôt qu'un mélange par semaine : toute la
  // feuille de temps d'abord, puis les interventions démarrent sur une
  // nouvelle page (rapport plus propre, chaque partie lisible d'un bloc).
  const punchWeekSections = sortedWeeks
    .map((w) => {
      const punchMin = w.punches.reduce((sum, p) => sum + minutesBetween(p.start, p.end), 0);
      grandPunchMin += punchMin;

      const punchRows = w.punches.length
        ? w.punches
            .map((p) => {
              const s = new Date(p.start);
              const e = new Date(p.end);
              return `<tr><td>${dateISO(s)}</td><td>${timeHM(s)}</td><td>${timeHM(e)}</td><td>${fmtDuration(minutesBetween(p.start, p.end))}</td></tr>`;
            })
            .join("")
        : `<tr><td colspan="4" class="empty-row">Aucune période travaillée</td></tr>`;

      return `
      <section class="week">
        <h3>${isoWeekLabel(w.monday)}</h3>
        <table>
          <thead><tr><th>Date</th><th>Début</th><th>Fin</th><th>Durée</th></tr></thead>
          <tbody>${punchRows}</tbody>
          <tfoot><tr><td colspan="3">Total de la semaine</td><td>${fmtDuration(punchMin)} (${fmtDecimalHours(punchMin)} h)</td></tr></tfoot>
        </table>
      </section>`;
    })
    .join("");

  grandInterventionMin = interventions.reduce((sum, i) => sum + minutesBetween(i.start, i.end), 0);
  grandBillableMin = interventions.filter((i) => i.billable).reduce((sum, i) => sum + minutesBetween(i.start, i.end), 0);

  const interventionSectionTitle = mergeByTicket ? "Interventions (fusionnées par billet)" : "Interventions";

  const interventionWeekSections = mergeByTicket
    ? buildTicketMergedInterventionSection(interventions)
    : sortedWeeks
        .map((w) => {
          const interventionMin = w.interventions.reduce((sum, i) => sum + minutesBetween(i.start, i.end), 0);
          const billableMin = w.interventions
            .filter((i) => i.billable)
            .reduce((sum, i) => sum + minutesBetween(i.start, i.end), 0);

          const interventionRows = w.interventions.length
            ? w.interventions
                .map((i) => {
                  const s = new Date(i.start);
                  const e = new Date(i.end);
                  const min = minutesBetween(i.start, i.end);
                  return `<tr>
                    <td>${dateISO(s)}</td>
                    <td>${timeHM(s)}–${timeHM(e)}</td>
                    <td>${fmtDuration(min)}</td>
                    <td>${escapeHtml(i.client) || "—"}</td>
                    <td>${escapeHtml(i.ticket || "") || "—"}</td>
                    <td>${escapeHtml(i.category)}</td>
                    <td>${escapeHtml(i.description) || "—"}</td>
                    <td class="center">${i.billable ? "✓" : "—"}</td>
                    <td class="center">${i.toVerify ? "⚠️" : "—"}</td>
                  </tr>`;
                })
                .join("")
            : `<tr><td colspan="9" class="empty-row">Aucune intervention</td></tr>`;

          return `
          <section class="week">
            <h3>${isoWeekLabel(w.monday)}</h3>
            <table>
              <thead><tr><th>Date</th><th>Heures</th><th>Durée</th><th>Client</th><th>Billet</th><th>Catégorie</th><th>Description</th><th>Fact.</th><th>Vérif.</th></tr></thead>
              <tbody>${interventionRows}</tbody>
              <tfoot><tr><td colspan="7">Total de la semaine (dont facturable : ${fmtDuration(billableMin)})</td><td colspan="2">${fmtDuration(interventionMin)}</td></tr></tfoot>
            </table>
          </section>`;
        })
        .join("");

  const periodFrom = sortedWeeks[0].monday;
  const periodTo = new Date(to === Infinity ? Date.now() : to - 1);
  const periodLabel = `${dateISO(periodFrom)} au ${dateISO(periodTo)}`;
  const generatedAt = new Date().toLocaleString("fr-CA");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport d'activité — TimeCalculator</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 32px; color: #1a1a1a; background: #fff; }
  .report-top { page-break-inside: avoid; break-inside: avoid; page-break-after: avoid; break-after: avoid; }
  .report-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1a3a5c; padding-bottom: 16px; margin-bottom: 24px; }
  .report-header h1 { margin: 0; font-size: 1.6rem; color: #1a3a5c; }
  .report-header .meta { text-align: right; font-size: 0.85rem; color: #555; line-height: 1.5; }
  .summary-bar { display: flex; gap: 16px; margin-bottom: 32px; }
  .summary-card { flex: 1; border: 1px solid #d8dee5; border-radius: 8px; padding: 14px 16px; background: #f7f9fb; }
  .summary-card .label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: #667; margin-bottom: 4px; }
  .summary-card .value { font-size: 1.3rem; font-weight: 700; color: #1a3a5c; }
  .summary-card.warning { background: #fff4e5; border-color: #f0b429; }
  .summary-card.warning .value { color: #9a5b00; }
  tr.to-verify-row td { background: #fff4e5; }
  .report-part h2 { font-size: 1.2rem; color: #1a3a5c; border-bottom: 2px solid #1a3a5c; padding-bottom: 8px; margin: 0 0 20px; }
  .report-part.page-break { page-break-before: always; break-before: page; }
  section.week { margin-bottom: 28px; page-break-inside: avoid; break-inside: avoid; }
  section.week:first-of-type { page-break-before: avoid; break-before: avoid; }
  section.week h3 { font-size: 0.9rem; color: #445; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.03em; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 4px; }
  th, td { border: 1px solid #e1e6eb; padding: 6px 8px; text-align: left; }
  th { background: #eef2f6; font-weight: 600; }
  tfoot td { background: #f7f9fb; font-weight: 700; }
  td.center { text-align: center; }
  td.empty-row { text-align: center; color: #888; font-style: italic; }
  .print-bar { margin-bottom: 24px; }
  .print-bar button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #1a3a5c; background: #1a3a5c; color: #fff; cursor: pointer; }
  @media print {
    .print-bar { display: none; }
    body { padding: 0; }
    .report-top { page-break-inside: avoid; break-inside: avoid; page-break-after: avoid; break-after: avoid; }
    .report-part.page-break { page-break-before: always; break-before: page; }
    section.week { page-break-inside: avoid; break-inside: avoid; }
    section.week:first-of-type { page-break-before: avoid; break-before: avoid; }
  }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="report-top">
    <div class="report-header">
      <h1>Rapport d'activité — TimeCalculator</h1>
      <div class="meta">
        Période : ${periodLabel}<br>
        Généré le ${generatedAt}
      </div>
    </div>
    <div class="summary-bar">
      <div class="summary-card"><div class="label">Temps travaillé</div><div class="value">${fmtDuration(grandPunchMin)}</div></div>
      <div class="summary-card"><div class="label">Interventions</div><div class="value">${fmtDuration(grandInterventionMin)}</div></div>
      <div class="summary-card"><div class="label">Dont facturable</div><div class="value">${fmtDuration(grandBillableMin)}</div></div>
      <div class="summary-card${grandToVerifyCount > 0 ? " warning" : ""}"><div class="label">À vérifier</div><div class="value">${grandToVerifyCount}</div></div>
    </div>
  </div>
  <div class="report-part">
    <h2>Feuille de temps</h2>
    ${punchWeekSections}
  </div>
  <div class="report-part page-break">
    <h2>${interventionSectionTitle}</h2>
    ${interventionWeekSections}
  </div>
</body>
</html>`;

  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    alert("Le navigateur a bloqué l'ouverture du rapport. Autorisez les fenêtres pop-up pour ce site.");
    return;
  }
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
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
els.filterToVerify.addEventListener("change", renderInterventionTable);

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
  const chevron = event.target.closest("[data-toggle-segments]");
  if (chevron) {
    toggleInterventionSegments(chevron.dataset.toggleSegments);
    return;
  }
  const btn = event.target.closest("button");
  if (!btn) return;
  if (btn.dataset.editIntervention) editIntervention(btn.dataset.editIntervention);
  if (btn.dataset.deleteIntervention) deleteIntervention(btn.dataset.deleteIntervention);
});

els.interventionTbody.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-toggle-verify]");
  if (checkbox) toggleInterventionVerify(checkbox.dataset.toggleVerify);
});

els.btnMergeInterventions.addEventListener("click", mergeInterventions);

els.btnExportPunches.addEventListener("click", exportPunchesCsv);
els.btnExportInterventions.addEventListener("click", exportInterventionsCsv);
els.btnExportReport.addEventListener("click", () => generateWeeklyReport(false));
els.btnExportJson.addEventListener("click", exportJson);
els.inputImport.addEventListener("change", () => {
  if (els.inputImport.files.length > 0) {
    importJson(els.inputImport.files[0]);
    els.inputImport.value = "";
  }
});

/* ---------- Authentification et synchronisation ---------- */

const elsAuth = {
  gate: $("auth-gate"),
  main: document.querySelector("main"),
  btnLogin: $("btn-login"),
  btnLogout: $("btn-logout"),
  error: $("auth-error"),
};

const provider = new OAuthProvider("microsoft.com");
provider.setCustomParameters({ tenant: MICROSOFT_TENANT_ID });

elsAuth.btnLogin.addEventListener("click", () => {
  elsAuth.error.hidden = true;
  signInWithPopup(auth, provider).catch((e) => {
    elsAuth.error.textContent = "Connexion échouée : " + e.message;
    elsAuth.error.hidden = false;
  });
});

elsAuth.btnLogout.addEventListener("click", () => signOut(auth));

let unsubscribeSnapshot = null;

onAuthStateChanged(auth, (user) => {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }

  if (!user) {
    userDocRef = null;
    elsAuth.gate.hidden = false;
    elsAuth.main.hidden = true;
    elsAuth.btnLogout.hidden = true;
    return;
  }

  elsAuth.gate.hidden = true;
  elsAuth.main.hidden = false;
  elsAuth.btnLogout.hidden = false;

  userDocRef = doc(db, "users", user.uid, "timecalculator", "state");

  // Affichage instantané depuis le cache local pendant que Firestore répond.
  state = load();
  render();

  unsubscribeSnapshot = onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      const incoming = normalizeState(snap.data());
      // Ignore les échos périmés (ex. confirmation tardive d'une écriture
      // antérieure) qui arriveraient après un ajout local plus récent : sans
      // cette garde, un ajout tout juste effectué pouvait être silencieusement
      // écrasé par une version plus vieille reçue en retard.
      if (incoming.updatedAt < state.updatedAt) return;
      applyingRemote = true;
      state = incoming;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      applyingRemote = false;
    } else {
      // Première connexion : on pousse le cache local existant vers Firestore.
      setDoc(userDocRef, state);
    }
  });
});

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
