import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

const GOE_URL = "http://192.168.178.113/api/status";
const GOE_SET_URL = GOE_URL.replace("/api/status", "/api/set");
const PHASE_THRESHOLD = 3;
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
    return CAR_STATUS_MAP[carValue] ?? { text: "Unknown", color: "gray" };
}

function getPhaseSetValues(phases) {
    return {
        fsp: phases === 1 ? 1 : 0,
        psm: phases === 1 ? 1 : 2
    };
}

async function fetchChargerStatus() {
    const response = await fetch(GOE_URL);
    if (!response.ok) {
        throw new Error(`Charger status request failed (${response.status})`);
    }
    return response.json();
}

async function requestSetKey(key, value) {
    const url = `${GOE_SET_URL}?${key}=${encodeURIComponent(value)}`;
    const response = await fetch(url);
    if (!response.ok) {
        return null;
    }
    const data = await response.json().catch(() => ({}));
    return { key, data };
}

async function setFirstWorkingKey(candidates, value) {
    for (const key of candidates) {
        const result = await requestSetKey(key, value);
        if (result) {
            return result;
        }
    }
    throw new Error("No compatible key accepted by charger");
}

function buildStatusResponse(data) {
    const status = getStatusPresentation(data.car);
    const voltages = data.nrg.slice(0, 3);
    const currentsRaw = data.nrg.slice(3, 6);
    const currents = currentsRaw.map(a => (a > PHASE_THRESHOLD ? a : 0));
    const activePhases = currents.filter(a => a > 0).length;

    return {
        power_kw: (data.nrg[7] / 1000).toFixed(2),
        energy_kwh: (data.wh / 1000).toFixed(2),
        type2_temp: data.tma?.[0] ?? null,
        supply_temp: data.tma?.[1] ?? null,
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
        return res.status(500).json({ error: "Failed to update configured phases" });
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
        return res.status(500).json({ error: "Failed to update configured current" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
