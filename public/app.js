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
    controlMessage: document.getElementById("control-message")
};

const wifiBars = Array.from(document.querySelectorAll("#wifi-bars .wifi-bar"));
const phaseButtons = Array.from(document.querySelectorAll("#phase-buttons button"));
const currentButtons = Array.from(document.querySelectorAll("#current-buttons button"));

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
        if (index < level) {
            bar.classList.add("on");
        } else {
            bar.classList.remove("on");
        }
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
    [...phaseButtons, ...currentButtons].forEach(button => {
        button.disabled = disabled;
    });
}

function setPhaseMeasurements(voltages, currents) {
    PHASES.forEach((phase, index) => {
        const voltage = voltages?.[index] ?? "-";
        const current = currents?.[index] ?? "-";
        const currentNumeric = toFiniteNumber(current);
        const phaseBox = document.getElementById("phase" + phase);

        setText(document.getElementById("v" + phase), voltage);
        setText(document.getElementById("a" + phase), current);

        if (!phaseBox) return;
        phaseBox.classList.toggle("active", currentNumeric !== null && currentNumeric > 0);
    });
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || "Request failed");
    }

    return body;
}

async function fetchStatus() {
    const response = await fetch("/api/status");
    if (!response.ok) {
        throw new Error("Failed to fetch status");
    }
    return response.json();
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

async function setPhases(phases) {
    try {
        setControlsDisabled(true);
        await postJson("/api/settings/phases", { phases });
        setControlMessage("");
        await loadStatus();
    } catch (error) {
        setControlMessage(error.message, true);
    } finally {
        setControlsDisabled(false);
    }
}

async function setCurrent(currentAmp) {
    try {
        setControlsDisabled(true);
        await postJson("/api/settings/current", { current_amp: currentAmp });
        setControlMessage("");
        await loadStatus();
    } catch (error) {
        setControlMessage(error.message, true);
    } finally {
        setControlsDisabled(false);
    }
}

function bindControlEvents() {
    phaseButtons.forEach(button => {
        button.addEventListener("click", () => {
            const phases = Number(button.dataset.phase);
            setPhases(phases);
        });
    });

    currentButtons.forEach(button => {
        button.addEventListener("click", () => {
            const currentAmp = Number(button.dataset.current);
            setCurrent(currentAmp);
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
