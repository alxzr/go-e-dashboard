# go-e Charger Dashboard

A lightweight Node.js dashboard for monitoring a go-e Charger using its local HTTP API.

This project provides a clean and responsive web interface showing live charging data directly from your charger within your local network.

## Features

- Live charging power (kW)
- Charged energy (kWh)
- Vehicle status indicator
- Automatic 1/3-phase detection with noise filtering
- Per-phase voltage and current display
- Active phase highlighting
- Type 2 temperature monitoring
- Internal power supply temperature monitoring
- Mobile responsive layout
- No external dependencies beyond Express

## Requirements

- Node.js 18+
- A go-e Charger accessible in your local network
- Charger IP address

## Installation

Clone the repository:

```bash
git clone https://github.com/yourusername/go-e-dashboard.git
cd go-e-dashboard