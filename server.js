import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

const GOE_URL = "http://192.168.178.113/api/status";
const GOE_SET_URL = GOE_URL.replace("/api/status", "/api/set");
const PHASE_THRESHOLD = 3;

app.use(express.static("public"));
app.use(express.json());

function getWifiSignalDbm(data) {
    const candidates = [
        data.wss,
        data.rssi,
        data.wifi?.rssi
    ];

    for (const value of candidates) {
        if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
            return Number(value);
        }
    }

    return null;
}

function getConfiguredPhases(data) {
    if (Number(data.fsp) === 1) return 1;
    if (Number(data.fsp) === 0) return 3;

    const psm = Number(data.psm);
    if (psm === 1) return 1;
    if (psm === 2 || psm === 3) return 3;

    const directCandidates = [data.frc, data.pha];
    for (const value of directCandidates) {
        const numeric = Number(value);
        if (numeric === 1 || numeric === 3) {
            return numeric;
        }
    }

    return null;
}

function getConfiguredCurrentAmp(data) {
    const candidates = [data.amp, data.amx];

    for (const value of candidates) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric;
        }
    }

    return null;
}

async function setFirstWorkingKey(candidates, value) {
    for (const key of candidates) {
        const url = `${GOE_SET_URL}?${key}=${encodeURIComponent(value)}`;
        const response = await fetch(url);
        if (!response.ok) {
            continue;
        }

        const data = await response.json();
        return { key, data };
    }

    throw new Error("No compatible key accepted by charger");
}

app.get("/api/status", async (req, res) => {
    try {
        const response = await fetch(GOE_URL);
        const data = await response.json();

        const carStatusMap = {
            0: { text: "Unknown", color: "gray" },
            1: { text: "Idle", color: "blue" },
            2: { text: "Charging", color: "green" },
            3: { text: "Waiting for car", color: "orange" },
            4: { text: "Complete", color: "green" },
            5: { text: "Error", color: "red" }
        };

        let statusText = "Unknown";
        let statusColor = "gray";

        if (data.car === null) {
            statusText = "Internal error";
            statusColor = "red";
        } else if (carStatusMap[data.car]) {
            statusText = carStatusMap[data.car].text;
            statusColor = carStatusMap[data.car].color;
        }

        const voltages = data.nrg.slice(0, 3);
        const currentsRaw = data.nrg.slice(3, 6);

        const currents = currentsRaw.map(a =>
            a > PHASE_THRESHOLD ? a : 0
        );

        const activePhases = currents.filter(a => a > 0).length;

        const type2Temp = data.tma?.[0] ?? null;
        const supplyTemp = data.tma?.[1] ?? null;
        const wifiSignalDbm = getWifiSignalDbm(data);
        const configuredPhases = getConfiguredPhases(data);
        const configuredCurrentAmp = getConfiguredCurrentAmp(data);

        res.json({
            power_kw: (data.nrg[7] / 1000).toFixed(2),
            energy_kwh: (data.wh / 1000).toFixed(2),
            type2_temp: type2Temp,
            supply_temp: supplyTemp,
            wifi_signal_dbm: wifiSignalDbm,
            configured_phases: configuredPhases,
            configured_current_amp: configuredCurrentAmp,
            status_text: statusText,
            status_color: statusColor,
            voltages: voltages.map(v => v.toFixed(1)),
            currents: currents.map(a => a.toFixed(2)),
            active_phases: activePhases
        });

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch go-e data" });
    }
});

app.post("/api/settings/phases", async (req, res) => {
    try {
        const phases = Number(req.body?.phases);
        if (phases !== 1 && phases !== 3) {
            return res.status(400).json({ error: "Invalid phases value" });
        }

        const phaseValueForFsp = phases === 1 ? 1 : 0;
        const phaseValueForPsm = phases === 1 ? 1 : 2;

        let result;
        try {
            result = await setFirstWorkingKey(["fsp"], phaseValueForFsp);
        } catch {
            result = await setFirstWorkingKey(["psm"], phaseValueForPsm);
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
        const allowed = new Set([6, 10, 12, 14, 16]);
        if (!allowed.has(currentAmp)) {
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
