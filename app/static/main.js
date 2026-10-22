let clientData = {};

// 🗂️ Column definitions per page
const COLUMNS = {
  dynamic: [
    { key: "ssid",         label: "SSID" },
    { key: "mac",          label: "MAC" },
    { key: "vendor",       label: "Vendor" },
    { key: "channel",      label: "Channel" },
    { key: "rssi",         label: "RSSI" },
    { key: "visit_count",  label: "Visit Count" },
    { key: "flagged",      label: "Flagged" },
  ],
  all: [
    { key: "ssid",           label: "SSID" },
    { key: "mac",            label: "MAC" },
    { key: "vendor",         label: "Vendor" },
    { key: "channel",        label: "Channel" },
    { key: "rssi",           label: "RSSI" },
    { key: "visit_count",    label: "Visit Count" },
    { key: "classification", label: "Classification" },
    { key: "flagged",        label: "Flagged" },
  ],
  ghosts: [
    { key: "ssid",           label: "SSID" },
    { key: "mac",            label: "MAC" },
    { key: "vendor",         label: "Vendor" },
    { key: "channel",        label: "Channel" },
    { key: "rssi",           label: "RSSI" },
    { key: "visit_count",    label: "Visit Count" },
    { key: "classification", label: "Classification" },
    { key: "flagged",        label: "Flagged" },
  ],
};

// 🧠 Tooltip config for Chart.js or similar
const tooltipOptions = {
  callbacks: {
    label: function (context) {
      const mac = context.label;
      const meta = clientData[mac];

      if (!meta) return `MAC: ${mac}`;

      const lastSeen = meta.last_seen
        ? new Date(meta.last_seen).toLocaleString()
        : "Never";

      return [
        `📶 SSID: ${meta.ssid || "Hidden"}`,
        `🔁 Visits: ${meta.visit_count ?? 0}`,
        `🕒 Last Seen: ${lastSeen}`,
        `🏷️ Type: ${meta.classification || "—"}`
      ];
    }
  }
};

// ── Cell rendering helpers ──────────────────────────────────

function formatCell(key, value) {
  if (value === null || value === undefined) return "—";
  switch (key) {
    case "ssid":
      // The firmware never sends an SSID — prefer the one parsed from the frame.
      return value && value !== "Hidden" ? value : "Hidden";
    case "vendor":
      return value || "Unknown";
    case "flagged":
      return value ? "🔖" : "";
    case "last_seen":
    case "first_seen":
      return new Date(value).toLocaleTimeString();
    default:
      return String(value);
  }
}

function renderRow(row, columns) {
  const tr = document.createElement("tr");
  tr.classList.add(row.classification || "unclassified");
  if (row.flagged) tr.classList.add("flagged");

  for (const col of columns) {
    const td = document.createElement("td");
    if (col.key === "mac") {
      const link = document.createElement("a");
      link.href = "javascript:void(0)";
      link.className = "mac-link";
      link.textContent = row.mac || "—";
      link.title = "Click to view all known information for this MAC";
      link.addEventListener("click", () => showMacDetail(row.mac));
      td.appendChild(link);
    } else {
      td.textContent = formatCell(col.key, row[col.key]);
    }
    tr.appendChild(td);
  }

  tr.ondblclick = () => {
    fetch("/flag_mac", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac: row.mac, flagged: !row.flagged })
    }).then(() => tr.classList.toggle("flagged"));
  };

  clientData[row.mac] = row;
  return tr;
}

// ── Convoy table renderer (different schema) ─────────────────

function renderConvoyRow(c) {
  const tr = document.createElement("tr");
  const members = c.members ? c.members.join(", ") : "—";
  tr.innerHTML = `
    <td>${c.id ?? "—"}</td>
    <td>${c.formation_time ?? "—"}</td>
    <td>${c.duration ?? 0}</td>
    <td>${c.prediction ?? "—"}</td>
    <td>${members}</td>
  `;
  return tr;
}

// ── MAC detail modal ───────────────────────────────────────
let macRawViewOpen = false;

function showMacDetail(mac) {
  const modal = document.getElementById("mac-modal");
  const body = document.getElementById("mac-modal-body");
  const title = document.getElementById("mac-modal-title");
  const toggle = document.getElementById("mac-modal-raw-toggle");
  title.textContent = `MAC Detail — ${mac}`;
  body.innerHTML = "<span style=color:#888>Loading…</span>";
  macRawViewOpen = false;
  if (toggle) toggle.textContent = "📄 Raw Packet";
  modal.style.display = "block";
  fetch(`/api/seen?mac=${encodeURIComponent(mac)}`)
    .then(r => r.json())
    .then(d => {
      body.innerHTML = renderMacDetail(d);
      // Only offer the raw-packet view when there's actually a frame.
      if (toggle) toggle.style.display = d.frame_b64 ? "inline-block" : "none";
    })
    .catch(e => { body.innerHTML = `<span style="color:#c00;">Error: ${e}</span>`; });
}

// Toggle between the structured card and the raw packet / ASCII dump.
function toggleMacRawView() {
  const body = document.getElementById("mac-modal-body");
  const toggle = document.getElementById("mac-modal-raw-toggle");
  const mac = document.getElementById("mac-modal-title").textContent.replace(/^MAC Detail — /, "");
  if (!mac) return;

  if (macRawViewOpen) {
    // Re-render the structured card.
    macRawViewOpen = false;
    if (toggle) toggle.textContent = "📄 Raw Packet";
    fetch(`/api/seen?mac=${encodeURIComponent(mac)}`)
      .then(r => r.json())
      .then(d => { body.innerHTML = renderMacDetail(d); });
  } else {
    // Render the raw packet + ASCII dump.
    macRawViewOpen = true;
    if (toggle) toggle.textContent = "← Back to card";
    fetch(`/api/seen?mac=${encodeURIComponent(mac)}`)
      .then(r => r.json())
      .then(d => { body.innerHTML = renderMacRaw(d); })
      .catch(e => { body.innerHTML = `<span style="color:#c00;">Error: ${e}</span>`; });
  }
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
}

// Pretty-print a hex dump of the raw frame bytes.
function hexDump(raw) {
  const bytes = new Uint8Array(raw);
  let out = "";
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(chunk)
      .map(b => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
      .join("");
    out += `${i.toString(16).padStart(4, "0")}  ${hex.padEnd(48)}  ${ascii}\n`;
  }
  return out;
}

// Render the raw packet view: hex dump + extracted ASCII strings.
function renderMacRaw(d) {
  if (!d || !d.found || !d.frame_b64) {
    return `<div style="color:#888;">No raw frame available for this MAC.</div>`;
  }

  let raw;
  try {
    raw = atob(d.frame_b64);
  } catch (e) {
    return `<span style="color:#c00;">Failed to decode base64 frame: ${e}</span>`;
  }

  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  let asciiStrings = [];
  try { asciiStrings = JSON.parse(d.frame_ascii || "[]"); } catch (e) { asciiStrings = []; }

  const asciiList = asciiStrings.length
    ? asciiStrings.map(s => `<div style="margin:1px 0;">${escapeHtml(s)}</div>`).join("")
    : `<span style="color:#999;font-style:italic;">no printable strings found</span>`;

  return `
    <div style="margin-bottom:10px;">
      <b>Frame length:</b> ${bytes.length} bytes &middot;
      <b>Frame type:</b> ${d.frame_type ?? "—"} &middot;
      <b>Frame (base64):</b> <span style="word-break:break-all;">${escapeHtml(d.frame_b64)}</span>
    </div>

    <div style="margin:10px 0 4px;font-weight:bold;border-bottom:1px solid #eee;padding-bottom:2px;">ASCII Vendor Clues</div>
    <div style="background:#fafafa;border:1px solid #eee;padding:8px;border-radius:4px;max-height:220px;overflow:auto;font-size:11px;">
      ${asciiList}
    </div>

    <div style="margin:14px 0 4px;font-weight:bold;border-bottom:1px solid #eee;padding-bottom:2px;">Hex Dump</div>
    <pre style="background:#1a1a1a;color:#d0d0d8;padding:10px;border-radius:4px;font-size:11px;overflow:auto;max-height:360px;">${escapeHtml(hexDump(bytes))}</pre>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Frame-type labels and preference ranks (mirror app/frame_pref.py).
// ESP32 wifi_promiscuous_pkt_type_t: 0=beacon/probe-response, 1/2=data,
// 3=control, 4=probe-request, 5=probe-response.
const FRAME_LABELS = { 0: "beacon/probe-response", 1: "data", 2: "data",
                        3: "control", 4: "probe-request", 5: "probe-response" };
const FRAME_RANK = { 0: 1, 5: 1, 4: 2, 1: 3, 2: 3, 3: 4 };

function frameRank(ft) {
  try { return FRAME_RANK[parseInt(ft)] ?? 5; }
  catch (e) { return 5; }
}
function frameTypeBadge(ft) {
  if (ft === null || ft === undefined) return "";
  const label = FRAME_LABELS[parseInt(ft)] ?? ("type " + ft);
  const rank = frameRank(ft);
  const color = rank === 1 ? "#8bc34a" : rank <= 2 ? "#d4c86a" : "#90a4ae";
  return ` <span style="background:#2a2a2a;color:${color};padding:1px 6px;border-radius:4px;font-size:10px;border:1px solid #444;">${label}</span>`;
}
function parseCounts(json) {
  try { const o = JSON.parse(json || "{}"); return typeof o === "object" && o ? o : {}; }
  catch (e) { return {}; }
}

// Channel labels: Wi-Fi 1-14 (2.4GHz), 36-164 (5GHz), 37-39 (BLE adv).
function channelBadge(ch) {
  if (ch === null || ch === undefined) return "";
  const n = parseInt(ch, 10);
  if (isNaN(n)) return "";
  const label = n >= 37 && n <= 39 ? `BLE adv ch ${n}`
            : n >= 1 && n <= 14 ? `2.4 GHz ch ${n}`
            : n >= 36 && n <= 164 ? `5 GHz ch ${n}`
            : `ch ${n}`;
  return ` <span style="background:#2a2a2a;color:#90a4ae;padding:1px 6px;border-radius:4px;font-size:10px;border:1px solid #444;">${label}</span>`;
}
function channelBreakdown(json) {
  try { const o = JSON.parse(json || "{}"); return typeof o === "object" && o ? o : {}; }
  catch (e) { return {}; }
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
}

// Grouped, human-readable rendering of every field the server knows.
function renderMacDetail(d) {
  if (!d || !d.found) {
    return `<div style="color:#888;">No record found for <b>${d ? d.mac : "—"}</b>.</div>`;
  }

  const label = (k) =>
    `<span style="display:inline-block;width:130px;color:#c2a5d8;">${k}:</span>`;

  const section = (heading, rows) =>
    `<div style="margin:10px 0 4px;font-weight:bold;color:#ffd700;border-bottom:1px solid #5c4672;padding-bottom:2px;">${heading}</div>` +
    rows.map(r => `<div style="margin:2px 0;">${r}</div>`).join("");

  const mac = d.mac || "—";
  const vendor = d.vendor || "Unknown";
  const vendorBadge =
    vendor !== "Unknown"
      ? `<span style="background:#3a2a5a;color:#c2a5d8;padding:1px 6px;border-radius:4px;font-size:11px;border:1px solid #5c4672;">🏷️ ${vendor}</span>`
      : `<span style="color:#888;font-style:italic;">not in OUI database</span>`;

  // MAC assignment: bit 1 of the first octet set = locally administered
  // (device-randomized).  Clear = globally administered (OUI-owned).
  const firstOctet = parseInt((d.mac || "").split(":")[0], 16) || 0;
  const locallyAdministered = !!(firstOctet & 0x02);
  const assignmentBadge = locallyAdministered
    ? `<span style="background:#4a2a2a;color:#ff8a65;padding:1px 6px;border-radius:4px;font-size:11px;border:1px solid #7a3a2a;">🔒 locally administered (randomized)</span>`
    : `<span style="background:#2a3a4a;color:#90a4ae;padding:1px 6px;border-radius:4px;font-size:11px;border:1px solid #3a4a5a;">🌐 globally administered (OUI-owned)</span>`;

  // MAC family: for locally-administered MACs the 4th:5th octet pair is stable
  // across the device's randomized addresses, so it groups "the same rando".
  const family = d.mac_family || null;
  const familyBadge = family
    ? `<span style="background:#3a2a5a;color:#c2a5d8;padding:1px 6px;border-radius:4px;font-size:11px;border:1px solid #5c4672;">🧬 family ${family}</span>`
    : `<span style="color:#888;font-style:italic;">no family</span>`;

  // The firmware never sends an SSID — it's parsed out of the frame body,
  // or inferred from sibling MACs in the same family.
  const ssid = d.ssid_parsed || d.ssid || d.inferred_ssid || "Hidden";
  const ssidSource = d.inferred_ssid && !d.ssid_parsed
    ? "inferred from family"
    : d.ssid_parsed
      ? "parsed from frame"
      : d.ssid
        ? "from ingest"
        : "none";
  const ssidBadge = d.inferred_ssid && !d.ssid_parsed
    ? `<span style="background:#3a3a2a;color:#d4c86a;padding:1px 6px;border-radius:4px;font-size:10px;border:1px solid #5a5a2a;">🧬 inferred from family</span>`
    : d.ssid_parsed
      ? `<span style="background:#2a4a2a;color:#8bc34a;padding:1px 6px;border-radius:4px;font-size:10px;border:1px solid #4a7a3a;">parsed from frame</span>`
      : `<span style="color:#888;font-style:italic;">${ssidSource}</span>`;

  const rows = [];

  rows.push(section("Identity", [
    `${label("MAC")}<b style="font-family:monospace;">${mac}</b>`,
    `${label("Assignment")}${assignmentBadge}`,
    `${label("MAC family")}${familyBadge}`,
    `${label("Vendor")}${vendorBadge}`,
    `${label("SSID")}<b style="font-family:monospace;">${escapeHtml(ssid)}</b> ${ssidBadge}`,
    `${label("Device type")}${d.device_type || "wifi"}`,
    `${label("BT address")}${d.bt_address || "—"}`,
    `${label("UID")}${d.uid || "—"}`,
  ]));

  // If this MAC belongs to a family, list the sibling addresses — that's how
  // you tell "the same rando" apart from unrelated devices.
  if (family && Array.isArray(d.family_members) && d.family_members.length > 1) {
    const members = d.family_members
      .map(m => `<span style="font-family:monospace;background:#2a2a2a;padding:1px 6px;border-radius:3px;margin:1px;display:inline-block;">${escapeHtml(m)}</span>`)
      .join("");
    rows.push(section("Same Rando (MAC family)", [
      `${label("Members")}<span style="font-family:monospace;">${d.family_member_count} addresses sharing ${family}</span>`,
      `<div style="margin:2px 0 2px 130px;">${members}</div>`,
    ]));
  }

  rows.push(section("Signal", [
    `${label("RSSI")}${d.rssi ?? "—"} dBm`,
    `${label("Channel")}${d.channel ?? "—"} ${channelBadge(d.channel)}`,
    `${label("Noise floor")}${d.noise_floor ?? "—"}`,
    `${label("Frame type")}${d.frame_type ?? "—"} ${frameTypeBadge(d.frame_type)}`,
    `${label("Frame len")}${d.frame_len ?? "—"}`,
    `${label("Rate")}${d.rate ?? "—"}`,
    `${label("Sig mode")}${d.sig_mode ?? "—"}`,
    `${label("MCS")}${d.mcs ?? "—"}`,
    `${label("40 MHz")}${d.cwb ?? "—"}`,
    `${label("Aggregation")}${d.aggregation ?? "—"}`,
    `${label("STBC")}${d.stbc ?? "—"}`,
    `${label("FEC coding")}${d.fec_coding ?? "—"}`,
    `${label("Short GI")}${d.sgi ?? "—"}`,
    `${label("AMPDU cnt")}${d.ampdu_cnt ?? "—"}`,
    `${label("RX state")}${d.rx_state ?? "—"}`,
  ]));

  // Channel history: a device can hop (roaming, band-steering, BLE adv
  // channels 37-39), so show how many observations we've seen on each channel.
  const chBreakdown = channelBreakdown(d.channel_history);
  const chKeys = Object.keys(chBreakdown);
  if (chKeys.length) {
    const chips = chKeys
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
      .map((c) => {
        const isCurrent = parseInt(c, 10) === (d.channel ?? -1);
        return `<span style="font-family:monospace;background:#2a2a2a;padding:1px 6px;border-radius:3px;margin:1px;display:inline-block;${isCurrent ? 'border:1px solid #8bc34a;' : ''}">ch${c} ×${chBreakdown[c]}${isCurrent ? ' ← current' : ''}</span>`;
      })
      .join("");
    rows.push(section("Channel history", [
      `${label("Channels")}${chips}`,
    ]));
  }

  // Frame-type breakdown: a single device sends beacons, probe requests,
  // probe responses, and data frames.  Show how many of each we've seen so
  // the "which frame is displayed" question is answerable.
  const counts = parseCounts(d.frame_type_counts);
  if (Object.keys(counts).length) {
    const breakdown = Object.entries(counts)
      .sort((a, b) => frameRank(b[0]) - frameRank(a[0]))
      .map(([ft, n]) => {
        const rank = frameRank(ft);
        const isDisplayed = parseInt(ft, 10) === (d.frame_type ?? -1);
        return `<span style="font-family:monospace;background:#2a2a2a;padding:1px 6px;border-radius:3px;margin:1px;display:inline-block;${isDisplayed ? 'border:1px solid #ffd700;' : ''}">${ft} ×${n}${isDisplayed ? ' ← displayed' : ''}</span>`;
      })
      .join("");
    rows.push(section("Frame types seen", [
      `${label("Breakdown")}${breakdown}`,
    ]));
  }

  rows.push(section("Activity", [
    `${label("Classification")}${d.classification || "—"}`,
    `${label("Visit count")}${d.visit_count ?? "—"}`,
    `${label("Flagged")}${d.flagged ? "🔖 Yes" : "No"}`,
    `${label("Hidden SSID")}${d.is_hidden ? "Yes" : "No"}`,
    `${label("Ghost")}${d.is_ghost ? "👻 Yes" : "No"}`,
    `${label("First seen")}${fmtTime(d.first_seen_iso)}`,
    `${label("Last seen")}${fmtTime(d.last_seen_iso)}`,
    `${label("RX timestamp")}${d.ts_us ?? "—"} µs`,
  ]));

  if (d.frame_b64) {
    rows.push(section("Raw Frame", [
      `${label("Frame (base64)")}<span style="font-family:monospace;word-break:break-all;">${escapeHtml(d.frame_b64)}</span>`,
    ]));

    // Surface the printable ASCII strings extracted from the frame as an
    // inline vendor-clue hint — the full hex dump lives on the Raw Packet view.
    let ascii = [];
    try { ascii = JSON.parse(d.frame_ascii || "[]"); } catch (e) { ascii = []; }
    if (ascii.length) {
      rows.push(section("ASCII Vendor Clues", [
        `${label("Strings")}<span style="font-family:monospace;">${ascii.length} found</span>`,
        ...ascii.slice(0, 6).map(s =>
          `<div style="margin:2px 0 2px 130px;font-family:monospace;font-size:11px;background:#f5f5f5;padding:1px 6px;border-radius:3px;">${escapeHtml(s)}</div>`
        ),
      ]));
    }
  }

  return rows.join("");
}

// 🗂️ Table Data Loader (generic, column-aware) with click-to-sort.
// Sort state is per-table: { tableId: { key, dir } } where dir is 1 (asc) or -1 (desc).
const sortState = {};

function setSort(tableId, key) {
  const cur = sortState[tableId] || { key: null, dir: 1 };
  if (cur.key === key) {
    cur.dir = -cur.dir;          // toggle direction on repeated clicks
  } else {
    cur.key = key;
    cur.dir = 1;
  }
  sortState[tableId] = cur;
  updateSortIndicators(tableId);
  return cur;
}

function updateSortIndicators(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const ths = table.getElementsByTagName("th");
  const cur = sortState[tableId] || { key: null, dir: 1 };
  for (const th of ths) {
    const key = th.getAttribute("data-sort");
    if (!key) continue;
    th.classList.remove("sorted-asc", "sorted-desc");
    if (cur.key === key) {
      th.classList.add(cur.dir === 1 ? "sorted-asc" : "sorted-desc");
    }
  }
}

// Stable sort that keeps MAC rows grouped by MAC when sorting by non-key fields.
function sortData(data, key, dir) {
  if (!key) return data;
  const a = (x) => {
    const v = x[key];
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return v;
    return String(v).toLowerCase();
  };
  return data.slice().sort((x, y) => {
    const ax = a(x), ay = a(y);
    if (ax < ay) return -dir;
    if (ax > ay) return dir;
    return 0;
  });
}

function fetchAndUpdate(route, tableId, columns) {
  const hours = getCurrentTimeWindow();
  const url = route + (route.includes("?") ? "&" : "?") + "hours=" + hours;
  fetch(url)
    .then(res => res.json())
    .then(data => {
      const table = document.getElementById(tableId);
      if (!table) {
        console.warn(`Table #${tableId} not found`);
        return;
      }
      const tbody = table.getElementsByTagName("tbody")[0];
      if (!tbody) return;

      // Apply current sort (if any) before rendering.
      const cur = sortState[tableId] || { key: null, dir: 1 };
      const sorted = sortData(data, cur.key, cur.dir);

      tbody.innerHTML = "";
      sorted.forEach(row => {
        if (columns === "convoy") {
          tbody.appendChild(renderConvoyRow(row));
        } else {
          tbody.appendChild(renderRow(row, columns));
        }
      });

      // Attach sort handlers to the header cells (idempotent).
      const ths = table.getElementsByTagName("th");
      for (const th of ths) {
        const key = th.getAttribute("data-sort");
        if (!key) continue;
        th.style.cursor = "pointer";
        th.style.userSelect = "none";
        th.title = "Click to sort";
        th.onclick = () => {
          setSort(tableId, key);
          fetchAndUpdate(route, tableId, columns);
        };
      }
      updateSortIndicators(tableId);
      updateCount(tableId, data.length);
    })
    .catch(err => console.error(`Fetch failed for ${route}:`, err));
}

// Read the time-window dropdown and cache it so re-fetches use the same value.
let currentTimeWindow = 24;
function getCurrentTimeWindow() {
  const sel = document.getElementById("time-window");
  if (sel) currentTimeWindow = parseFloat(sel.value) || 24;
  return currentTimeWindow;
}
function applyTimeFilter() {
  getCurrentTimeWindow();
  document.querySelectorAll("[data-route]").forEach((el) => {
    const route = el.getAttribute("data-route");
    const tableId = el.getAttribute("data-table");
    const cols = el.getAttribute("data-cols");
    const columns = cols ? JSON.parse(cols) : null;
    fetchAndUpdate(route, tableId, columns);
  });
}
function updateCount(tableId, n) {
  const el = document.getElementById("time-filter-count");
  if (el) el.textContent = `${n} rows`;
}

// 🚀 Auto-refresh on load
document.addEventListener("DOMContentLoaded", () => {
  // Fetch once immediately, then set interval
  if (location.pathname.includes("dynamic")) {
    fetchAndUpdate("/api/dynamic", "dynamic-table", COLUMNS.dynamic);
    setInterval(() => fetchAndUpdate("/api/dynamic", "dynamic-table", COLUMNS.dynamic), 1000);
  } else if (location.pathname.includes("convoy")) {
    fetchAndUpdate("/api/convoy", "convoy-table", "convoy");
    setInterval(() => fetchAndUpdate("/api/convoy", "convoy-table", "convoy"), 2000);
  } else if (location.pathname.includes("all")) {
    fetchAndUpdate("/api/all", "all-table", COLUMNS.all);
    setInterval(() => fetchAndUpdate("/api/all", "all-table", COLUMNS.all), 2000);
  } else if (location.pathname.includes("ghosts")) {
    fetchAndUpdate("/api/ghosts", "ghosts-table", COLUMNS.ghosts);
    setInterval(() => fetchAndUpdate("/api/ghosts", "ghosts-table", COLUMNS.ghosts), 2000);
  }
});
