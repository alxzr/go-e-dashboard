import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = 3000;

const GOE_URL = "http://192.168.178.113/api/status";
const PHASE_THRESHOLD = 3;

app.use(express.static("public"));

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

        res.json({
            power_kw: (data.nrg[7] / 1000).toFixed(2),
            energy_kwh: (data.wh / 1000).toFixed(2),
            type2_temp: type2Temp,
            supply_temp: supplyTemp,
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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});