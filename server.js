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

        let statusText = "Unknown";
        let statusColor = "gray";

        switch (data.car) {
            case 1:
                statusText = "No vehicle";
                break;
            case 2:
                statusText = "Charging";
                statusColor = "green";
                break;
            case 3:
                statusText = "Connected";
                statusColor = "blue";
                break;
            case 4:
                statusText = "Error";
                statusColor = "red";
                break;
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