let clientData = {};

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

// 🗂️ Table Data Loader
function fetchAndUpdate(route, tableId) {
  fetch(route)
    .then(res => res.json())
    .then(data => {
      const table = document.getElementById(tableId).getElementsByTagName("tbody")[0];
      table.innerHTML = "";
      data.forEach(row => {
        const tr = document.createElement("tr");
        tr.classList.add(row.classification || "unclassified");
        if (row.flagged) tr.classList.add("flagged");

        const lastSeen = row.last_seen
          ? new Date(row.last_seen).toLocaleTimeString()
          : "—";

        tr.innerHTML = `
          <td>${row.ssid}</td>
          <td>${row.mac}</td>
          <td>${row.channel}</td>
          <td>${row.rssi}</td>
          <td>${row.visit_count}</td>
          <td>${lastSeen}</td>
          <td>${row.flagged ? "🔖" : ""}</td>
        `;

        tr.ondblclick = () => {
          fetch("/flag_mac", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac: row.mac, flagged: !row.flagged })
          }).then(() => tr.classList.toggle("flagged"));
        };

        table.appendChild(tr);
        clientData[row.mac] = row;
      });
    });
}

// 🚀 Auto-refresh on load
document.addEventListener("DOMContentLoaded", () => {
  if (location.pathname.includes("dynamic")) {
    setInterval(() => fetchAndUpdate("/api/dynamic", "dynamic-table"), 3000);
  } else if (location.pathname.includes("convoy")) {
    setInterval(() => fetchAndUpdate("/api/convoy", "convoy-table"), 4000);
  } else if (location.pathname.includes("all")) {
    setInterval(() => fetchAndUpdate("/api/all", "all-table"), 5000);
  }
});
