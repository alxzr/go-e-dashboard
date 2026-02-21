import express from "express";
import fetch from "node-fetch";
import config from "./config.js";

const CHARGER_HOST = config.chargerHost;
const PORT = config.port;
const PHASE_THRESHOLD = config.phaseThreshold;
const ENERGY_PRICE_EUR_PER_KWH = config.energyPriceEurPerKwh;
const REQUEST_TIMEOUT_MS = config.requestTimeoutMs;

const GOE_URL = `http://${CHARGER_HOST}/api/status`;
const GOE_SET_URL = GOE_URL.replace("/api/status", "/api/set");
const ALLOWED_PHASES = new Set([1, 3]);
const ALLOWED_CURRENTS = new Set([6, 10, 12, 14, 16]);

const CAR_STATUS_MAP = {
    0: { text: "Unknown", color: "gray" },
    1: { text: "Idle", color: "blue" },
    2: { text: "Charging", color: "green" },
    3: { text: "Waiting for car", color: "orange" },
    4: { text: "Complete", color: "green" },
    5: { text: "Error", color: "red" }
};

const HTTP_NO_COMPATIBLE_KEY_ERROR = "No compatible key accepted by charger";

const app = express();
app.disable("x-powered-by");
app.use(express.static("public"));
app.use(express.json());

function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function pickFirstFiniteNumber(values) {
    for (const value of values) {
        const numeric = toFiniteNumber(value);
        if (numeric !== null) {
            return numeric;
        }
    }
    return null;
}

function getWifiSignalDbm(data) {
    return pickFirstFiniteNumber([data.wss, data.rssi, data.wifi?.rssi]);
}

function getConfiguredPhases(data) {
    const fsp = toFiniteNumber(data.fsp);
    if (fsp === 1) return 1;
    if (fsp === 0) return 3;

    const psm = toFiniteNumber(data.psm);
    if (psm === 1) return 1;
    if (psm === 2 || psm === 3) return 3;

    const directCandidates = [data.frc, data.pha];
    for (const value of directCandidates) {
        const numeric = toFiniteNumber(value);
        if (numeric === 1 || numeric === 3) {
            return numeric;
        }
    }

    return null;
}

function getConfiguredCurrentAmp(data) {
    const numeric = pickFirstFiniteNumber([data.amp, data.amx]);
    if (numeric !== null && numeric > 0) {
        return numeric;
    }
    return null;
}

function getStatusPresentation(carValue) {
    if (carValue === null) {
        return { text: "Internal error", color: "red" };
    }

    const normalizedCar = toFiniteNumber(carValue);
    if (normalizedCar === null) {
        return { text: "Unknown", color: "gray" };
    }

    return CAR_STATUS_MAP[normalizedCar] ?? { text: "Unknown", color: "gray" };
}

function getPhaseSetValues(phases) {
    return {
        fsp: phases === 1 ? 1 : 0,
        psm: phases === 1 ? 1 : 2
    };
}

function getSetEndpointError(error, fallbackMessage) {
    if (error?.name === "AbortError") {
        return { status: 504, error: "Charger request timed out" };
    }

    if (error?.message === HTTP_NO_COMPATIBLE_KEY_ERROR) {
        return { status: 400, error: HTTP_NO_COMPATIBLE_KEY_ERROR };
    }

    return { status: 500, error: fallbackMessage };
}

function parseChargingDuration(cdi) {
    const toSeconds = (rawValue, isMilliseconds = false) => {
        const numeric = toFiniteNumber(rawValue);
        if (numeric === null) {
            return null;
        }
        const seconds = isMilliseconds ? numeric / 1000 : numeric;
        return Math.max(0, Math.floor(seconds));
    };

    if (cdi === null || cdi === undefined) {
        return { seconds: null, state: "not_charging" };
    }

    if (typeof cdi === "number") {
        return {
            seconds: toSeconds(cdi),
            state: "legacy_number"
        };
    }

    if (typeof cdi !== "object") {
        return { seconds: null, state: "invalid" };
    }

    const type = toFiniteNumber(cdi.type);
    const valueSeconds = toSeconds(cdi.value, type === 1);

    if (valueSeconds === null) {
        return { seconds: null, state: "invalid" };
    }

    const stateByType = {
        0: "counter",
        1: "duration_ms"
    };

    return {
        seconds: valueSeconds,
        state: stateByType[type] ?? "unknown_type"
    };
}

async function fetchChargerStatus() {
    try {
        const response = await fetchWithTimeout(GOE_URL);
        if (!response.ok) {
            throw new Error(`Charger status request failed (${response.status})`);
        }
        return response.json();
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`Charger status request timed out (${REQUEST_TIMEOUT_MS}ms)`);
        }
        throw error;
    }
}

async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function requestSetKey(key, value) {
    const url = `${GOE_SET_URL}?${key}=${encodeURIComponent(value)}`;

    try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
            return { ok: false, reason: "http" };
        }

        const data = await response.json().catch(() => ({}));
        return { ok: true, key, data };
    } catch (error) {
        return { ok: false, reason: "network", error };
    }
}

async function setFirstWorkingKey(candidates, value) {
    let networkError = null;

    for (const key of candidates) {
        const result = await requestSetKey(key, value);
        if (result.ok) {
            return result;
        }

        if (result.reason === "network") {
            networkError = result.error;
        }
    }

    if (networkError) {
        throw networkError;
    }

    throw new Error(HTTP_NO_COMPATIBLE_KEY_ERROR);
}

function getArrayNumber(values, index, fallback = 0) {
    if (!Array.isArray(values)) return fallback;
    const numeric = toFiniteNumber(values[index]);
    return numeric === null ? fallback : numeric;
}

function getTemperatures(tmaValues) {
    const values = Array.isArray(tmaValues) ? tmaValues : [];
    return {
        type2Temp: toFiniteNumber(values[0]),
        supplyTemp: toFiniteNumber(values[1])
    };
}

function buildStatusResponse(data) {
    const status = getStatusPresentation(data.car);
    const voltages = [0, 1, 2].map(index => getArrayNumber(data.nrg, index));
    const currentsRaw = [3, 4, 5].map(index => getArrayNumber(data.nrg, index));
    const currents = currentsRaw.map(a => (a > PHASE_THRESHOLD ? a : 0));
    const activePhases = currents.filter(a => a > 0).length;
    const powerW = getArrayNumber(data.nrg, 7);
    const chargedWh = toFiniteNumber(data.wh) ?? 0;
    const sessionCostEur = Number.isFinite(chargedWh)
        ? (chargedWh / 1000) * ENERGY_PRICE_EUR_PER_KWH
        : null;
    const chargingDuration = parseChargingDuration(data.cdi);
    const temperatures = getTemperatures(data.tma);

    return {
        power_kw: (powerW / 1000).toFixed(2),
        energy_kwh: (chargedWh / 1000).toFixed(2),
        session_cost_eur: sessionCostEur,
        session_duration_sec: chargingDuration.seconds,
        session_duration_state: chargingDuration.state,
        type2_temp: temperatures.type2Temp,
        supply_temp: temperatures.supplyTemp,
        wifi_signal_dbm: getWifiSignalDbm(data),
        configured_phases: getConfiguredPhases(data),
        configured_current_amp: getConfiguredCurrentAmp(data),
        status_text: status.text,
        status_color: status.color,
        voltages: voltages.map(v => v.toFixed(1)),
        currents: currents.map(a => a.toFixed(2)),
        active_phases: activePhases
    };
}

app.get("/api/status", async (req, res) => {
    try {
        const data = await fetchChargerStatus();
        res.json(buildStatusResponse(data));
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch go-e data" });
    }
});

app.post("/api/settings/phases", async (req, res) => {
    try {
        const phases = Number(req.body?.phases);
        if (!ALLOWED_PHASES.has(phases)) {
            return res.status(400).json({ error: "Invalid phases value" });
        }

        const setValues = getPhaseSetValues(phases);

        let result;
        try {
            result = await setFirstWorkingKey(["fsp"], setValues.fsp);
        } catch {
            result = await setFirstWorkingKey(["psm"], setValues.psm);
        }

        return res.json({
            success: true,
            phases,
            used_key: result.key
        });
    } catch (error) {
        const responseError = getSetEndpointError(error, "Failed to update configured phases");
        return res.status(responseError.status).json({ error: responseError.error });
    }
});

app.post("/api/settings/current", async (req, res) => {
    try {
        const currentAmp = Number(req.body?.current_amp);
        if (!ALLOWED_CURRENTS.has(currentAmp)) {
            return res.status(400).json({ error: "Invalid current value" });
        }

        const result = await setFirstWorkingKey(["amp"], currentAmp);
        return res.json({
            success: true,
            current_amp: currentAmp,
            used_key: result.key
        });
    } catch (error) {
        const responseError = getSetEndpointError(error, "Failed to update configured current");
        return res.status(responseError.status).json({ error: responseError.error });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
