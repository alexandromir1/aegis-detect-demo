/*
  Aegis Detect — MVP Demo Logic
  -----------------------------
  Requirements covered:
  - Leaflet map (CDN)
  - Simple "Select Area" rectangle draw mode (demo-level)
  - Store selected bounds in JS
  - "Run Detection" simulates analysis delay (2–3 seconds)
  - No detection results yet (foundation only)
*/

/* global L */

// ===== DOM helpers ===========================================================

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: #${id}`);
  return el;
}

// ===== UI elements ===========================================================

const selectAreaBtn = byId("selectAreaBtn");
const clearSelectionBtn = byId("clearSelectionBtn");
const runDetectionBtn = byId("runDetectionBtn");

const statusText = byId("statusText");
const statusValue = byId("statusValue");
const instructionText = byId("instructionText");
const selectionSummary = byId("selectionSummary");
const mapHint = byId("mapHint");
const detectionCard = byId("detectionCard");
const detectionConfidence = byId("detectionConfidence");
const detectionTime = byId("detectionTime");
const detectionDispositionTag = byId("detectionDispositionTag");
const confirmFireBtn = byId("confirmFireBtn");
const rejectDetectionBtn = byId("rejectDetectionBtn");
const incidentDetails = byId("incidentDetails");
const impactAssessment = byId("impactAssessment");
const impactRiskPill = byId("impactRiskPill");
const impactRiskText = byId("impactRiskText");
const impactAreaText = byId("impactAreaText");
const impactNotes = byId("impactNotes");
const exportIncidentBtn = byId("exportIncidentBtn");
const incidentEmpty = byId("incidentEmpty");
const incidentList = byId("incidentList");
const incidentControls = byId("incidentControls");
const incidentFocusLabel = byId("incidentFocusLabel");
const incidentStatusSelect = byId("incidentStatusSelect");
const detectionActionBar = byId("detectionActionBar");
const actionBarConfidence = byId("actionBarConfidence");
const actionConfirmBtn = byId("actionConfirmBtn");
const actionRejectBtn = byId("actionRejectBtn");
const panelDecisionActions = byId("panelDecisionActions");

// ===== Map setup =============================================================

// Default view: Western US (operationally plausible for wildfire monitoring).
const map = L.map("detectMap", {
  zoomControl: true,
  attributionControl: true,
  // Keep boxZoom enabled for normal browsing. We'll temporarily disable it in select mode.
});

// OpenStreetMap tiles (CDN). This is a demo-only basemap.
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// A calm default starting area.
map.setView([37.25, -119.6], 6);

// Optional scale (useful for operators).
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

// ===== Selection state =======================================================

/**
 * When true, the user can click-drag to draw a rectangle.
 * We also temporarily disable panning/zoom gestures to reduce accidental map movement.
 */
let isSelecting = false;

/** @type {L.LatLng|null} */
let dragStartLatLng = null;

/** @type {L.Rectangle|null} */
let selectionRect = null;

/** @type {L.LatLngBounds|null} */
let selectedBounds = null;

/** @type {L.Marker|null} */
let detectionMarker = null;

/** @type {L.Circle|null} */
let impactZone = null;

/** @type {null | {risk:"Low"|"Medium"|"High", radiusMeters:number, areaKm2:number, notes:string}} */
let lastImpactAssessment = null;

/**
 * The most recent AI detection (demo-only).
 * In production this would be a server-side record with an audit trail and operator identity.
 * @type {null | {
 *   id: string,
 *   bounds: L.LatLngBounds,
 *   location: L.LatLng,
 *   confidencePct: number,
 *   detectedAtIso: string,
 *   state: "unconfirmed" | "confirmed" | "rejected",
 *   confirmedAtIso?: string
 * }}
 */
let currentDetection = null;

/**
 * Active incidents stored client-side (demo-only).
 * Note: This models an incident lifecycle for operational awareness,
 * not a task management system.
 *
 * A real deployment would persist these to a backend system-of-record.
 * @type {Array<{
 *   id: string,
 *   status: "Confirmed — Awaiting response" | "Confirmed — Response dispatched" | "Resolved",
 *   location: L.LatLng,
 *   confidencePct: number,
 *   detectedAtIso: string,
 *   confirmedAtIso: string,
 *   operatorNote: string,
 *   impact: {risk:"Low"|"Medium"|"High", radiusMeters:number, areaKm2:number, notes:string} | null,
 *   marker: L.Marker
 * }>}
 */
const incidents = [];

/** @type {string|null} */
let focusedIncidentId = null;

// Visual style for the selection rectangle (government-grade, restrained).
const selectionStyle = {
  color: "#7dd3fc",
  weight: 2,
  opacity: 0.95,
  fillColor: "#7dd3fc",
  fillOpacity: 0.12,
  dashArray: "6 6",
};

function setStatus(state, text) {
  // state: "idle" | "busy" | "alert" | "confirmed" | "rejected"
  statusText.textContent = text;

  const dot = statusValue.querySelector(".status-dot");
  if (dot) {
    dot.classList.toggle("idle", state === "idle");
    dot.classList.toggle("busy", state === "busy");
    dot.classList.toggle("alert", state === "alert");
    dot.classList.toggle("confirmed", state === "confirmed");
    dot.classList.toggle("rejected", state === "rejected");
  }
}

function setInstruction(text) {
  instructionText.textContent = text;
}

function hideDetectionCard() {
  detectionCard.hidden = true;
  detectionConfidence.textContent = "—";
  detectionTime.textContent = "—";
  detectionDispositionTag.textContent = "Detected";
  detectionDispositionTag.className = "tag tag-warning";
  incidentDetails.hidden = true;
  impactAssessment.hidden = true;
  exportIncidentBtn.disabled = true;
  // Panel decision buttons are not used (Action Bar is the operational interface).
  panelDecisionActions.hidden = true;
  confirmFireBtn.disabled = true;
  rejectDetectionBtn.disabled = true;
  detectionCard.classList.remove("confirmed", "rejected");
  currentDetection = null;
  lastImpactAssessment = null;
  hideActionBar();
}

function showActionBar(confidencePct) {
  // Operational UX: the most critical actions must be available without scrolling.
  detectionActionBar.hidden = false;
  actionBarConfidence.textContent = `Confidence ${confidencePct}%`;

  // Ensure there is no duplicate confirm/reject UI in the panel during "Detected" state.
  panelDecisionActions.hidden = true;
  confirmFireBtn.disabled = true;
  rejectDetectionBtn.disabled = true;
}

function hideActionBar() {
  detectionActionBar.hidden = true;
  actionBarConfidence.textContent = "Confidence —";
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable === true
  );
}

// Hotkeys (operational UX): when a detection requires a decision, allow fast actions.
// - C = Confirm fire
// - R = Reject detection
// Notes:
// - Only active when the action bar is visible AND the detection is unconfirmed.
// - Ignored while typing in form controls to avoid accidental actions.
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isEditableTarget(e.target)) return;
  if (detectionActionBar.hidden) return;
  if (!currentDetection || currentDetection.state !== "unconfirmed") return;

  const key = e.key.toLowerCase();
  if (key === "c") {
    e.preventDefault();
    actionConfirmBtn.click();
  } else if (key === "r") {
    e.preventDefault();
    actionRejectBtn.click();
  }
});

function formatLatLng(latlng) {
  return `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function formatBounds(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return `SW (${formatLatLng(sw)}) → NE (${formatLatLng(ne)})`;
}

function updateSelectionUI() {
  if (!selectedBounds) {
    selectionSummary.textContent = "No area selected.";
    clearSelectionBtn.disabled = true;
    runDetectionBtn.disabled = true;
    return;
  }

  selectionSummary.textContent = formatBounds(selectedBounds);
  clearSelectionBtn.disabled = false;
  runDetectionBtn.disabled = false;
}

function clearDetectionOnMap() {
  if (detectionMarker) {
    map.removeLayer(detectionMarker);
    detectionMarker = null;
  }
}

function clearImpactZone() {
  if (impactZone) {
    map.removeLayer(impactZone);
    impactZone = null;
  }
}

function setSelectingUI(enabled) {
  document.body.classList.toggle("selecting", enabled);
  selectAreaBtn.textContent = enabled ? "Exit Select Mode" : "Select Area";

  // Disable map interactions that conflict with drag-select.
  if (enabled) {
    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    // Touch devices: avoid accidental pinch/drag while selecting.
    if (map.tap) map.tap.disable();
  } else {
    map.dragging.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    if (map.tap) map.tap.enable();
  }

  mapHint.textContent = enabled
    ? "Click and drag to draw a rectangle selection."
    : "Tip: Zoom and pan to your area of interest.";
}

function enterSelectMode() {
  isSelecting = true;
  dragStartLatLng = null;
  setSelectingUI(true);
  setInstruction("Select mode active. Click and drag on the map to define an area.");
}

function exitSelectMode() {
  isSelecting = false;
  dragStartLatLng = null;
  setSelectingUI(false);
  setInstruction(
    selectedBounds
      ? "Area selected. You may run detection when ready."
      : "Select an area on the map to begin detection."
  );
}

function clearSelection() {
  selectedBounds = null;
  dragStartLatLng = null;
  if (selectionRect) {
    map.removeLayer(selectionRect);
    selectionRect = null;
  }
  clearDetectionOnMap();
  clearImpactZone();
  hideDetectionCard();
  hideActionBar();
  focusedIncidentId = null;
  renderIncidentList();
  setIncidentControls(null);
  updateSelectionUI();
  setInstruction("Select an area on the map to begin detection.");
}

// ===== Map events (rectangle drawing) =======================================

map.on("mousedown touchstart", (e) => {
  if (!isSelecting) return;

  dragStartLatLng = e.latlng;

  // Remove any prior rectangle (this is a single-selection MVP).
  if (selectionRect) {
    map.removeLayer(selectionRect);
    selectionRect = null;
  }

  // Create a tiny rectangle to start; we'll expand it on mousemove.
  selectionRect = L.rectangle([dragStartLatLng, dragStartLatLng], selectionStyle).addTo(map);
});

map.on("mousemove touchmove", (e) => {
  if (!isSelecting || !dragStartLatLng || !selectionRect) return;

  const bounds = L.latLngBounds(dragStartLatLng, e.latlng);
  selectionRect.setBounds(bounds);
});

map.on("mouseup touchend", (e) => {
  if (!isSelecting || !dragStartLatLng) return;

  const bounds = L.latLngBounds(dragStartLatLng, e.latlng);

  // Ignore extremely small selections (e.g., a click without a drag).
  const isTiny =
    Math.abs(bounds.getNorth() - bounds.getSouth()) < 0.002 ||
    Math.abs(bounds.getEast() - bounds.getWest()) < 0.002;

  if (isTiny) {
    // Clean up the tiny rectangle if it exists.
    if (selectionRect) {
      map.removeLayer(selectionRect);
      selectionRect = null;
    }
    dragStartLatLng = null;
    setInstruction("Selection too small. Click and drag to define a larger area.");
    return;
  }

  selectedBounds = bounds;
  dragStartLatLng = null;
  updateSelectionUI();
  exitSelectMode();
});

// If the user releases the mouse outside the map, also end gracefully.
document.addEventListener("mouseup", () => {
  if (!isSelecting) return;
  // If a drag started on the map but ended elsewhere, clear the in-progress selection
  // rectangle to avoid leaving a "ghost" selection on screen.
  if (dragStartLatLng && selectionRect) {
    map.removeLayer(selectionRect);
    selectionRect = null;
    dragStartLatLng = null;
    setInstruction("Selection cancelled. Click and drag on the map to define an area.");
  }
});

// ===== Controls ==============================================================

selectAreaBtn.addEventListener("click", () => {
  if (isSelecting) {
    exitSelectMode();
  } else {
    enterSelectMode();
  }
});

clearSelectionBtn.addEventListener("click", () => {
  clearSelection();
});

function setControlsDisabled(disabled) {
  selectAreaBtn.disabled = disabled;
  clearSelectionBtn.disabled = disabled || !selectedBounds;
  runDetectionBtn.disabled = disabled || !selectedBounds;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Demo-only: generate a random point inside a LatLngBounds rectangle.
 * Note: In a real system, the detection would return precise geolocations (hotspots / polygons).
 * @param {L.LatLngBounds} bounds
 * @returns {L.LatLng}
 */
function randomPointInBounds(bounds) {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  const lat = randomBetween(south, north);
  const lng = randomBetween(west, east);
  return L.latLng(lat, lng);
}

function makeFireIcon() {
  // Use a simple emoji marker for a friendly demo effect.
  // Production would likely use a standardized icon set + severity coding.
  return L.divIcon({
    className: "fire-marker-wrap",
    html: '<div class="fire-marker detected" title="Detected (awaiting operator confirmation)">🔥</div>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function makeIncidentIcon(status) {
  const cls =
    status === "Confirmed — Awaiting response"
      ? "awaiting"
      : status === "Confirmed — Response dispatched"
        ? "dispatched"
        : "resolved";

  return L.divIcon({
    className: "fire-marker-wrap",
    html: `<div class="fire-marker ${cls}" title="${status}">🔥</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function showDetectionResult({ confidencePct, when, location }) {
  detectionConfidence.textContent = `${confidencePct}%`;
  detectionTime.textContent = when;
  detectionCard.hidden = false;
  incidentDetails.hidden = true;
  panelDecisionActions.hidden = true;
  confirmFireBtn.disabled = true;
  rejectDetectionBtn.disabled = true;
  detectionCard.classList.remove("confirmed", "rejected");
  detectionDispositionTag.textContent = "Detected";
  detectionDispositionTag.className = "tag tag-warning";
  impactAssessment.hidden = true;
  lastImpactAssessment = null;

  clearDetectionOnMap();
  detectionMarker = L.marker(location, {
    icon: makeFireIcon(),
    keyboard: false,
    title: "Potential wildfire detected (unconfirmed)",
  }).addTo(map);

  // Show the no-scroll action bar immediately after detection.
  showActionBar(confidencePct);
}

// Leaflet sizing: when using a fixed-height layout, ensure the map recalculates size.
requestAnimationFrame(() => map.invalidateSize());
window.addEventListener("resize", () => map.invalidateSize());

/*
  Human-in-the-loop confirmation
  ------------------------------
  For government-facing workflows, automated AI output must not be treated as a confirmed incident.
  A trained operator reviews evidence and explicitly confirms/rejects the detection.
  This provides accountability, reduces false alarms, and supports auditability.
*/

function confirmDetection() {
  if (!currentDetection || currentDetection.state !== "unconfirmed") return;

  // Once the operator makes a decision, hide the action bar (normal flow resumes).
  hideActionBar();

  // Human confirmation overrides AI output:
  // - The AI suggested a detection
  // - The operator makes the final decision to treat it as an active incident
  currentDetection.state = "confirmed";
  currentDetection.confirmedAtIso = new Date().toISOString();

  // Create a persistent incident record (client-side demo).
  const incidentId = currentDetection.id;
  const operatorNote = "Confirmed by operator";

  setStatus("confirmed", "Confirmed — Awaiting response");
  setInstruction("Confirmed by operator. Incident status: Confirmed — Awaiting response.");

  detectionDispositionTag.textContent = "Confirmed";
  detectionDispositionTag.className = "tag tag-confirmed";
  detectionCard.classList.add("confirmed");

  incidentDetails.hidden = false;
  confirmFireBtn.disabled = true;
  rejectDetectionBtn.disabled = true;

  // Convert the current detection marker into a persistent incident marker.
  if (!detectionMarker) return;

  /*
    Impact zone / spread assessment (demo-only placeholder)
    -------------------------------------------------------
    This is NOT a fire behavior model and does not predict real outcomes.
    It exists to demonstrate how an operator-confirmed incident could trigger
    downstream "impact assessment" modules in a government workflow.

    Future integration points could include:
    - Wind/terrain/fuel inputs from authoritative sources
    - Physics-based fire spread modeling or ML-based forecasting
    - Evacuation planning overlays and infrastructure impact analysis
  */
  const impact = generateImpactAssessment(currentDetection);
  renderImpactAssessment(impact);
  drawImpactZone(currentDetection.location, impact.radiusMeters);
  lastImpactAssessment = impact;

  const incident = {
    id: incidentId,
    status: "Confirmed — Awaiting response",
    location: currentDetection.location,
    confidencePct: currentDetection.confidencePct,
    detectedAtIso: currentDetection.detectedAtIso,
    confirmedAtIso: currentDetection.confirmedAtIso,
    operatorNote,
    impact,
    marker: detectionMarker,
  };

  // Update the marker appearance based on incident lifecycle status.
  incident.marker.setIcon(makeIncidentIcon(incident.status));
  incident.marker.options.title = incident.status;

  incidents.push(incident);
  detectionMarker = null; // Draft marker is now owned by the incident.

  // Focus the map + show controls for the newly confirmed incident.
  focusedIncidentId = incident.id;
  renderIncidentList();
  setIncidentControls(incident);
  focusIncidentOnMap(incident);
}

function rejectDetection() {
  if (!currentDetection || currentDetection.state !== "unconfirmed") return;

  // Once the operator makes a decision, hide the action bar (normal flow resumes).
  hideActionBar();

  // Human rejection overrides AI output:
  // - The AI suggested a detection
  // - The operator can reject it as a false positive
  currentDetection.state = "rejected";

  setStatus("rejected", "Detection rejected");
  setInstruction("Detection rejected by operator. Marked as false positive. You may run detection again.");

  detectionDispositionTag.textContent = "False positive";
  detectionDispositionTag.className = "tag tag-false";
  detectionCard.classList.add("rejected");

  incidentDetails.hidden = true;
  confirmFireBtn.disabled = true;
  rejectDetectionBtn.disabled = true;

  clearDetectionOnMap();
  clearImpactZone();
  lastImpactAssessment = null;
  // Allow the operator to run detection again without changing the selected bounds.
  setControlsDisabled(false);
}

// Action Bar is the primary operational interface for the "Detected" state.
actionConfirmBtn.addEventListener("click", confirmDetection);
actionRejectBtn.addEventListener("click", rejectDetection);

// Panel buttons remain in the DOM (accessibility / fallback), but are hidden/disabled in this MVP.
confirmFireBtn.addEventListener("click", confirmDetection);
rejectDetectionBtn.addEventListener("click", rejectDetection);

runDetectionBtn.addEventListener("click", async () => {
  if (!selectedBounds) {
    setInstruction("Select an area on the map to begin detection.");
    return;
  }

  setControlsDisabled(true);
  setStatus("busy", "Analyzing satellite imagery…");
  setInstruction("Analysis in progress. Please wait.");
  hideDetectionCard();
  hideActionBar();
  clearDetectionOnMap();
  clearImpactZone();

  // Demo-only delay: 2–3 seconds.
  const delayMs = 2000 + Math.floor(Math.random() * 1000);
  await sleep(delayMs);

  /*
    Where real AI analysis would integrate (future):
    - Fetch/ingest recent satellite imagery for the selected bounds + time window
    - Run an ML model / rules engine to detect hotspots/smoke signatures
    - Return geolocated detections (points/polygons), confidence, and evidence thumbnails
    - Surface those detections for human confirmation workflows

    This MVP simulates the output client-side only.
  */

  const confidencePct = 82 + Math.floor(Math.random() * 11); // 82–92%
  const now = new Date();
  const when = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const location = randomPointInBounds(selectedBounds);

  currentDetection = {
    id: `det_${now.getTime()}`,
    bounds: selectedBounds,
    location,
    confidencePct,
    detectedAtIso: now.toISOString(),
    state: "unconfirmed",
  };

  setStatus("alert", "Fire detected");
  setInstruction(
    "Potential wildfire detected by AI. Human confirmation is required before this becomes a confirmed incident."
  );
  showDetectionResult({ confidencePct, when, location });
  setControlsDisabled(false);
});

// Initialize UI.
setStatus("idle", "Idle");
updateSelectionUI();
setInstruction("Select an area on the map to begin detection.");
hideDetectionCard();
renderIncidentList();
setIncidentControls(null);

// ===== Active incidents UI (minimal list + lifecycle control) =================

function shortIncidentLabel(id) {
  // Keep it compact and readable (no dashboards).
  const tail = String(id).slice(-6);
  return `INC-${tail}`;
}

function statusToBadgeClass(status) {
  if (status === "Confirmed — Awaiting response") return "awaiting";
  if (status === "Confirmed — Response dispatched") return "dispatched";
  return "resolved";
}

function focusIncidentOnMap(incident) {
  // Focus view only; avoid permanent labels/popups to keep the map uncluttered.
  map.flyTo(incident.location, Math.max(map.getZoom(), 10), { duration: 0.6 });

  // To avoid map clutter, only show an impact zone for the currently focused incident.
  clearImpactZone();
  if (incident.impact) drawImpactZone(incident.location, incident.impact.radiusMeters);
}

function setIncidentControls(incident) {
  if (!incident) {
    incidentControls.hidden = true;
    incidentFocusLabel.textContent = "—";
    incidentStatusSelect.value = "Confirmed — Awaiting response";
    exportIncidentBtn.disabled = true;
    return;
  }

  incidentControls.hidden = false;
  incidentFocusLabel.textContent = `${shortIncidentLabel(incident.id)} • ${formatLatLng(incident.location)}`;
  incidentStatusSelect.value = incident.status;
  exportIncidentBtn.disabled = !incident.impact;
}

function renderIncidentList() {
  if (incidents.length === 0) {
    incidentEmpty.hidden = false;
    incidentList.hidden = true;
    incidentList.innerHTML = "";
    return;
  }

  incidentEmpty.hidden = true;
  incidentList.hidden = false;
  incidentList.innerHTML = "";

  // Newest first for quick operator scanning.
  const items = [...incidents].reverse();
  for (const incident of items) {
    const li = document.createElement("li");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "incident-row";
    btn.setAttribute("aria-label", `Focus ${shortIncidentLabel(incident.id)}`);
    btn.dataset.incidentId = incident.id;

    const idSpan = document.createElement("span");
    idSpan.className = "incident-id";
    idSpan.textContent = shortIncidentLabel(incident.id);

    const badge = document.createElement("span");
    badge.className = `status-badge ${statusToBadgeClass(incident.status)}`;
    badge.textContent = incident.status;

    btn.appendChild(idSpan);
    btn.appendChild(badge);

    btn.addEventListener("click", () => {
      focusedIncidentId = incident.id;
      setIncidentControls(incident);
      focusIncidentOnMap(incident);
      exportIncidentBtn.disabled = !incident.impact;
      setStatus("confirmed", incident.status);
      setInstruction("Focused incident. Lifecycle status is operator-managed and distinct from AI detection output.");
    });

    li.appendChild(btn);
    incidentList.appendChild(li);
  }
}

incidentStatusSelect.addEventListener("change", () => {
  const incident = incidents.find((i) => i.id === focusedIncidentId);
  if (!incident) return;

  /** @type {"Confirmed — Awaiting response" | "Confirmed — Response dispatched" | "Resolved"} */
  const nextStatus = incidentStatusSelect.value;
  incident.status = nextStatus;

  // Update marker appearance based on lifecycle status.
  incident.marker.setIcon(makeIncidentIcon(incident.status));

  // Keep the top status label in sync when the focused incident is updated.
  setStatus("confirmed", incident.status);
  setInstruction(
    "Lifecycle status updated by operator. This models incident lifecycle state (not an automated AI action)."
  );

  renderIncidentList();
});

// ===== Incident report export (demo-only, client-side) =======================

/**
 * Export as JSON (most reliable without libraries / backends).
 * If you later want a printable PDF, you can add a client-side PDF library — but JSON
 * is a better default for demos because it is deterministic and machine-readable.
 */
exportIncidentBtn.addEventListener("click", () => {
  // Do not allow export before confirmation.
  const incident = incidents.find((i) => i.id === focusedIncidentId);
  if (!incident) return;
  if (!incident.impact) return;

  const report = {
    incidentId: incident.id,
    timestamp: new Date().toISOString(),
    incidentStatus: "Confirmed Wildfire",
    lifecycleStatus: incident.status,
    aiDetection: {
      confidencePct: incident.confidencePct,
      detectedAtIso: incident.detectedAtIso,
    },
    location: {
      lat: Number(incident.location.lat.toFixed(6)),
      lng: Number(incident.location.lng.toFixed(6)),
    },
    impactAssessment: {
      spreadRiskLevel: incident.impact.risk,
      estimatedAffectedAreaKm2: Number(incident.impact.areaKm2.toFixed(2)),
    },
    operatorNote: incident.operatorNote,
    disclaimer: "Demo / Non-operational data",
  };

  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `aegis_detect_incident_${incident.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoke after a short delay to avoid interrupting the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ===== Impact assessment (illustrative, explainable) =========================

/**
 * Generate a simple, explainable impact assessment.
 * This is a placeholder only — no real prediction is performed.
 * @param {{confidencePct:number, location:L.LatLng, bounds:L.LatLngBounds}} detection
 * @returns {{risk:"Low"|"Medium"|"High", radiusMeters:number, areaKm2:number, notes:string}}
 */
function generateImpactAssessment(detection) {
  // Simple, explainable mapping:
  // - Higher confidence slightly increases the likelihood of higher risk.
  const confidenceNudge = (detection.confidencePct - 82) / 10; // 0..1
  const roll = Math.random() + confidenceNudge * 0.25;

  /** @type {"Low"|"Medium"|"High"} */
  let risk = "Medium";
  if (roll < 0.55) risk = "Low";
  else if (roll < 1.05) risk = "Medium";
  else risk = "High";

  // Choose an illustrative radius by risk band (meters).
  const baseRadius = risk === "Low" ? 900 : risk === "Medium" ? 1400 : 2200;
  const radiusMeters = Math.round(baseRadius + randomBetween(-120, 180));

  // Area for the circle: A = π r^2. Convert m^2 -> km^2 (divide by 1e6).
  const areaKm2 = Math.PI * radiusMeters * radiusMeters / 1_000_000;

  // Notes referencing wind and terrain (demo copy, not computed).
  const windNotes =
    risk === "Low"
      ? "Light winds are expected to limit short-term spread."
      : risk === "Medium"
        ? "Moderate winds may drive directional spread along exposed ridgelines."
        : "Strong gusts may accelerate spread and spotting downwind.";
  const terrainNotes =
    risk === "Low"
      ? "Terrain appears mixed; natural breaks may reduce continuity."
      : risk === "Medium"
        ? "Terrain and fuel continuity could support sustained spread."
        : "Complex terrain (canyons/ridges) can amplify local wind effects.";

  return {
    risk,
    radiusMeters,
    areaKm2,
    notes: `${windNotes} ${terrainNotes}`,
  };
}

/**
 * Render the impact assessment into the panel (shown only after operator confirmation).
 * @param {{risk:"Low"|"Medium"|"High", radiusMeters:number, areaKm2:number, notes:string}} impact
 */
function renderImpactAssessment(impact) {
  impactAssessment.hidden = false;
  impactRiskText.textContent = impact.risk;
  impactAreaText.textContent = `~${impact.areaKm2.toFixed(1)} km²`;
  impactNotes.textContent = impact.notes;

  // Risk pill styling
  impactRiskPill.textContent = impact.risk;
  impactRiskPill.classList.remove("low", "medium", "high");
  impactRiskPill.classList.add(impact.risk.toLowerCase());
}

/**
 * Draw a semi-transparent illustrative impact zone around the confirmed fire location.
 * @param {L.LatLng} center
 * @param {number} radiusMeters
 */
function drawImpactZone(center, radiusMeters) {
  clearImpactZone();
  impactZone = L.circle(center, {
    radius: radiusMeters,
    color: "#fb923c", // orange border
    weight: 2,
    opacity: 0.95,
    fillColor: "#ef4444", // red fill
    fillOpacity: 0.12,
    dashArray: "6 6",
  }).addTo(map);
}

