"use strict";

// Options page: shows the bridge connection and lets the user pair or unpair.
// All work happens in the background page; this page only sends messages.
const STRINGS = {
  en: {
    title: "Thunderbird AI Bridge",
    pairHeading: "Pair with SuperCli / NestCafe",
    pairHelp: "In SuperCli (Settings → Thunderbird, or /thunderbird pair in the terminal) or NestCafe (Settings → Integrations) click “Pair”. Enter the 16-character code shown there.",
    pairButton: "Pair",
    pairedHeading: "Paired programs",
    none: "None yet.",
    unpair: "Unpair",
    pairing: "Pairing…",
    paired: "Paired with {app}.",
    pairedAt: "paired {date}",
    version: "Extension {version}, protocol {protocol}",
    phase: {
      connected: "Connected",
      unpaired: "Not paired",
      no_host: "Waiting for SuperCli / NestCafe",
      host_not_paired: "Another program holds the bridge port",
      host_outdated: "Program on the bridge port is outdated",
      host_unknown: "Unknown program on the bridge port",
      host_impostor: "Untrusted program on the bridge port",
      pairing_revoked: "Pairing no longer accepted",
      auth_failed: "Authentication failed",
      connecting: "Connecting…",
      starting: "Starting…",
      error: "Error",
    },
  },
  pl: {
    title: "Thunderbird AI Bridge",
    pairHeading: "Parowanie z SuperCli / NestCafe",
    pairHelp: "W SuperCli (Ustawienia → Thunderbird albo /thunderbird pair w terminalu) lub w NestCafe (Ustawienia → Integracje) kliknij „Paruj”. Wpisz tutaj pokazany tam 16-znakowy kod.",
    pairButton: "Paruj",
    pairedHeading: "Sparowane programy",
    none: "Brak.",
    unpair: "Rozparuj",
    pairing: "Parowanie…",
    paired: "Sparowano z {app}.",
    pairedAt: "sparowano {date}",
    version: "Rozszerzenie {version}, protokół {protocol}",
    phase: {
      connected: "Połączono",
      unpaired: "Niesparowane",
      no_host: "Czekam na SuperCli / NestCafe",
      host_not_paired: "Port mostu zajmuje inny program",
      host_outdated: "Program na porcie mostu jest nieaktualny",
      host_unknown: "Nieznany program na porcie mostu",
      host_impostor: "Niezaufany program na porcie mostu",
      pairing_revoked: "Parowanie nie jest już akceptowane",
      auth_failed: "Uwierzytelnienie nieudane",
      connecting: "Łączenie…",
      starting: "Uruchamianie…",
      error: "Błąd",
    },
  },
};

const lang = String(navigator.language || "en").toLowerCase().startsWith("pl") ? "pl" : "en";
const t = STRINGS[lang];
const TONES = { connected: "ok", unpaired: "warn", no_host: "warn", connecting: "warn", starting: "warn" };

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function setMessage(text, tone = "") {
  const node = document.getElementById("pair-message");
  node.textContent = text;
  node.dataset.tone = tone;
}

async function refresh() {
  let report;
  try {
    report = await messenger.runtime.sendMessage({ type: "bridge-status" });
  } catch (error) {
    report = { phase: "error", detail: String(error?.message || error), pairings: [] };
  }
  const status = document.getElementById("status");
  status.dataset.tone = TONES[report.phase] || "bad";
  document.getElementById("status-title").textContent = t.phase[report.phase] || report.phase;
  let detail = report.detail || "";
  if (report.phase === "connected" && report.host) {
    detail = `${report.host.app || ""} ${report.host.appVersion || ""}${Number.isSafeInteger(report.host.pid) ? ` (pid ${report.host.pid})` : ""}`.trim();
  }
  document.getElementById("status-detail").textContent = detail;

  const list = document.getElementById("pairings");
  list.replaceChildren();
  if (!report.pairings?.length) {
    const item = document.createElement("li");
    item.textContent = t.none;
    list.append(item);
  }
  for (const pairing of report.pairings || []) {
    const item = document.createElement("li");
    const date = pairing.pairedAt ? new Date(pairing.pairedAt).toLocaleString() : "";
    item.textContent = `${pairing.app || "host"} ${pairing.appVersion || ""} — ${fill(t.pairedAt, { date })} `;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t.unpair;
    button.addEventListener("click", async () => {
      await messenger.runtime.sendMessage({ type: "bridge-unpair", hostId: pairing.hostId });
      refresh();
    });
    item.append(button);
    list.append(item);
  }
  document.getElementById("version").textContent = fill(t.version, { version: report.version || "", protocol: report.protocol || "" });
}

document.querySelectorAll("[data-i18n]").forEach((node) => {
  const value = t[node.dataset.i18n];
  if (typeof value === "string") node.textContent = value;
});

document.getElementById("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("code");
  const button = document.getElementById("pair-button");
  button.disabled = true;
  setMessage(t.pairing);
  try {
    const result = await messenger.runtime.sendMessage({ type: "bridge-pair", code: input.value });
    if (result?.ok) {
      input.value = "";
      setMessage(fill(t.paired, { app: result.host?.app || "host" }), "ok");
    } else {
      setMessage(result?.error || "Pairing failed.", "bad");
    }
  } finally {
    button.disabled = false;
    refresh();
  }
});

refresh();
setInterval(refresh, 2000);
