# go-e Charger WebUI Dashboard

A lightweight Node.js dashboard for monitoring and controlling a go-e charger via its local HTTP API.

## Features

- Live charging power hero card (kW) with status indicator
- Charging section with:
  - Charged energy (kWh)
  - Current cost (EUR)
  - Session time
- System section with:
  - WiFi signal strength (5 bars)
  - Type 2 temperature
  - Supply temperature
- Control section:
  - Charging start/stop
  - Phase switching (1 / 3)
  - Charging current presets (6 / 10 / 12 / 14 / 16 A)
- Live per-phase voltage/current values with active phase highlighting
- Firmware version footer
- In-app `Settings` button (bottom) with overlay for:
  - Charger IP/host
  - Energy price (EUR/kWh)
- Responsive UI for desktop and mobile

## Requirements

- Node.js 18+
- A go-e charger reachable in your local network

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure charger and pricing in `config.json`:

- `chargerHost` - charger IP/host in your LAN
- `energyPriceEurPerKwh` - electricity price used for cost display
- `requestTimeoutMs` - API timeout for charger requests

3. Start the dashboard:

```bash
npm start
```

4. Open `http://localhost:3000`.

## In-App Settings

Use the `Settings` button at the bottom of the dashboard to change:

- Charger IP/host
- Energy price (EUR/kWh)

These settings are saved to `config.json` via `/api/settings`, so they remain after restart.

## HTTP API (internal UI backend)

The frontend uses these endpoints exposed by `server.js`:

- `GET /api/status` - normalized live charger status for UI cards and controls
- `GET /api/settings` - current runtime settings (`charger_host`, `energy_price_eur_per_kwh`)
- `POST /api/settings` - persist charger host and energy price to `config.json`
- `POST /api/settings/charging` - start/stop charging
- `POST /api/settings/phases` - set configured phases (`1` or `3`)
- `POST /api/settings/current` - set charging current (`6|10|12|14|16`)

## Screenshot

![go-e Charger Dashboard](docs/screenshot.png)
