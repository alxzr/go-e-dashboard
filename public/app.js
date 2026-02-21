const POLL_INTERVAL_MS = 3000;
const PHASES = ["1", "2", "3"];

const els = {
    power: document.getElementById("power"),
    liveStatus: document.getElementById("live-status"),
    liveDot: document.querySelector(".live-dot"),
    status: document.getElementById("status"),
    energy: document.getElementById("energy"),
    sessionCost: document.getElementById("session-cost"),
    sessionTime: document.getElementById("session-time"),
    tempType2: document.getElementById("temp-type2"),
    tempSupply: document.getElementById("temp-supply"),
    wifiSignal: document.getElementById("wifi-signal"),
    controlMessage: document.getElementById("control-message"),
    openSettings: document.getElementById("open-settings"),
    settingsOverlay: document.getElementById("settings-overlay"),
    settingsHost: document.getElementById("settings-host"),
    settingsPrice: document.getElementById("settings-price"),
    saveSettings: document.getElementById("save-settings"),
    cancelSettings: document.getElementById("cancel-settings")
};

const wifiBars = Array.from(document.querySelectorAll("#wifi-bars .wifi-bar"));
const chargingButtons = Array.from(document.querySelectorAll("#charging-buttons button"));
const phaseButtons = Array.from(document.querySelectorAll("#phase-buttons button"));
const currentButtons = Array.from(document.querySelectorAll("#current-buttons button"));
const allControlButtons = [...chargingButtons, ...phaseButtons, ...currentButtons];
const phaseElements = PHASES.map(phase => ({
    box: document.getElementById(`phase${phase}`),
    voltage: document.getElementById(`v${phase}`),
    current: document.getElementById(`a${phase}`)
}));

let isPolling = false;

function setText(element, value) {
    if (!element) return;
    element.innerText = String(value);
}

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function wifiBarsFromDbm(dbm) {
    const value = toFiniteNumber(dbm);
    if (value === null) return 0;
    if (value >= -55) return 5;
    if (value >= -62) return 4;
    if (value >= -70) return 3;
    if (value >= -78) return 2;
    if (value >= -86) return 1;
    return 0;
}

function setWifiBars(dbm) {
    const level = wifiBarsFromDbm(dbm);
    wifiBars.forEach((bar, index) => {
        bar.classList.toggle("on", index < level);
    });
}

function setPowerMetaStatus(statusText) {
    const normalized = String(statusText || "Unknown");
    const isWaitingForCar = normalized === "Waiting for car";

    setText(els.liveStatus, normalized);
    if (!els.liveDot) return;

    els.liveDot.classList.toggle("offline", isWaitingForCar);
    els.liveDot.classList.toggle("online", !isWaitingForCar);
}

function setPowerMetaOffline() {
    setText(els.liveStatus, "Offline");
    if (!els.liveDot) return;
    els.liveDot.classList.add("offline");
    els.liveDot.classList.remove("online");
}

function setControlMessage(text, isError = false) {
    if (!els.controlMessage) return;

    if (!text) {
        els.controlMessage.innerText = "";
        els.controlMessage.className = "control-message hidden";
        return;
    }

    els.controlMessage.innerText = text;
    els.controlMessage.className = "control-message" + (isError ? " error" : "");
}

function formatDuration(seconds) {
    const total = toFiniteNumber(seconds);
    if (total === null || total < 0) return "--:--:--";

    const rounded = Math.floor(total);
    const h = Math.floor(rounded / 3600);
    const m = Math.floor((rounded % 3600) / 60);
    const s = rounded % 60;

    return (
        String(h).padStart(2, "0") + ":" +
        String(m).padStart(2, "0") + ":" +
        String(s).padStart(2, "0")
    );
}

function formatCostEur(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) return "( - EUR )";
    return `(${numeric.toFixed(2).replace(".", ",")} EUR)`;
}

function setActiveButton(buttons, dataAttr, selectedValue) {
    buttons.forEach(button => {
        if (button.dataset[dataAttr] === String(selectedValue)) {
            button.classList.add("selected");
        } else {
            button.classList.remove("selected");
        }
    });
}

function setControlsDisabled(disabled) {
    allControlButtons.forEach(button => {
        button.disabled = disabled;
    });
}

function setPhaseMeasurements(voltages, currents) {
    phaseElements.forEach((phaseElementsForIndex, index) => {
        const voltage = voltages?.[index] ?? "-";
        const current = currents?.[index] ?? "-";
        const currentNumeric = toFiniteNumber(current);

        setText(phaseElementsForIndex.voltage, voltage);
        setText(phaseElementsForIndex.current, current);
        phaseElementsForIndex.box?.classList.toggle("active", currentNumeric !== null && currentNumeric > 0);
    });
}

async function requestJson(url, options = {}) {
    const { method = "GET", payload, fallbackError = "Request failed" } = options;
    const requestOptions = { method };

    if (payload !== undefined) {
        requestOptions.headers = { "Content-Type": "application/json" };
        requestOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, requestOptions);
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(body.error || fallbackError);
    }

    return body;
}

function fetchStatus() {
    return requestJson("/api/status", { fallbackError: "Failed to fetch status" });
}

function fetchSettings() {
    return requestJson("/api/settings", { fallbackError: "Failed to fetch settings" });
}

function saveSettings(payload) {
    return requestJson("/api/settings", {
        method: "POST",
        payload,
        fallbackError: "Failed to save settings"
    });
}

function openSettingsOverlay() {
    if (!els.settingsOverlay) return;
    els.settingsOverlay.classList.remove("hidden");
    els.settingsOverlay.setAttribute("aria-hidden", "false");
}

function closeSettingsOverlay() {
    if (!els.settingsOverlay) return;
    els.settingsOverlay.classList.add("hidden");
    els.settingsOverlay.setAttribute("aria-hidden", "true");
}

async function showSettings() {
    try {
        const settings = await fetchSettings();
        if (els.settingsHost) {
            els.settingsHost.value = settings.charger_host ?? "";
        }
        if (els.settingsPrice) {
            els.settingsPrice.value = settings.energy_price_eur_per_kwh ?? "";
        }
        openSettingsOverlay();
    } catch (error) {
        setControlMessage(error.message, true);
    }
}

async function persistSettings() {
    try {
        const chargerHost = String(els.settingsHost?.value || "").trim();
        const energyPrice = Number(els.settingsPrice?.value);

        await saveSettings({
            charger_host: chargerHost,
            energy_price_eur_per_kwh: energyPrice
        });

        closeSettingsOverlay();
        setControlMessage("");
        await loadStatus();
    } catch (error) {
        setControlMessage(error.message, true);
    }
}

function applyStatus(data) {
    setText(els.power, data.power_kw ?? "-");
    setText(els.energy, data.energy_kwh ?? "-");
    setText(els.sessionCost, formatCostEur(data.session_cost_eur));

    if (data.session_duration_state === "not_charging") {
        setText(els.sessionTime, "--:--:--");
    } else {
        setText(els.sessionTime, formatDuration(data.session_duration_sec));
    }

    setText(els.tempType2, data.type2_temp ?? "-");
    setText(els.tempSupply, data.supply_temp ?? "-");

    const wifiDbm = toFiniteNumber(data.wifi_signal_dbm);
    setText(els.wifiSignal, wifiDbm === null ? "-" : wifiDbm.toFixed(0));
    setWifiBars(wifiDbm);

    setText(els.status, data.status_text ?? "Unknown");
    if (els.status) {
        els.status.className = "badge " + (data.status_color || "gray");
    }
    setPowerMetaStatus(data.status_text);

    const chargingState = data.charging_allowed === true ? "start" :
        data.charging_allowed === false ? "stop" : null;
    setActiveButton(chargingButtons, "charging", chargingState);
    setActiveButton(phaseButtons, "phase", data.configured_phases);
    setActiveButton(currentButtons, "current", data.configured_current_amp);
    setPhaseMeasurements(data.voltages, data.currents);
}

async function loadStatus() {
    if (isPolling) return;
    isPolling = true;

    try {
        const data = await fetchStatus();
        applyStatus(data);
    } catch (error) {
        console.error(error);
        setPowerMetaOffline();
    } finally {
        isPolling = false;
    }
}

async function runControlAction(url, payload) {
    try {
        setControlsDisabled(true);
        await requestJson(url, { method: "POST", payload });
        setControlMessage("");
        await loadStatus();
    } catch (error) {
        setControlMessage(error.message, true);
    } finally {
        setControlsDisabled(false);
    }
}

function bindControlEvents() {
    if (els.openSettings) {
        els.openSettings.addEventListener("click", showSettings);
    }
    if (els.saveSettings) {
        els.saveSettings.addEventListener("click", persistSettings);
    }
    if (els.cancelSettings) {
        els.cancelSettings.addEventListener("click", closeSettingsOverlay);
    }
    if (els.settingsOverlay) {
        els.settingsOverlay.addEventListener("click", event => {
            if (event.target === els.settingsOverlay) {
                closeSettingsOverlay();
            }
        });
    }

    chargingButtons.forEach(button => {
        button.addEventListener("click", () => {
            const action = button.dataset.charging;
            runControlAction("/api/settings/charging", { action });
        });
    });

    phaseButtons.forEach(button => {
        button.addEventListener("click", () => {
            const phases = Number(button.dataset.phase);
            runControlAction("/api/settings/phases", { phases });
        });
    });

    currentButtons.forEach(button => {
        button.addEventListener("click", () => {
            const currentAmp = Number(button.dataset.current);
            runControlAction("/api/settings/current", { current_amp: currentAmp });
        });
    });
}

async function startPolling() {
    bindControlEvents();

    while (true) {
        await loadStatus();
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

startPolling();
