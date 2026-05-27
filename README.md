# Metals Price Dashboard

A lightweight web dashboard for viewing and manually managing historical price data for Gold (XAU), Silver (XAG), and Copper (XCU).

Data is entered manually through the web interface. There is no automatic data fetching.

## Features

- View daily OHLC price charts and tables for Gold, Silver, and Copper
- Manual price entry with timestamp
- Time range selection (3 days to 1 year)
- Remembers last viewed metal and time range per browser (cookies)
- Clean, responsive interface using ApexCharts

## Tech Stack

- Node.js + Express
- Azure SQL Server (`mssql`)
- ApexCharts (client-side)
- Vanilla JavaScript + HTML (no frontend framework)

## Prerequisites

- Node.js 18+
- Access to an Azure SQL Database (or compatible SQL Server)
- Ability to run `npm install`

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/drnomadoh/rakocy-web-test.git
cd rakocy-web-test
npm install
```

### 2. Configure Environment

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials.

### 3. Database Requirements

The application expects a table named `MetalPrices` with at least these columns:

```sql
Metal       VARCHAR(10)     -- 'XAU', 'XAG', or 'XCU'
Price       DECIMAL(18,4)
Timestamp   DATETIME2
Source      VARCHAR(50)     -- e.g. 'Manual Entry'
```

### 4. Run Locally

```bash
npm start
# or
npm run dev
```

Open http://localhost:3000

## Environment Variables

| Variable       | Required | Description                          |
|----------------|----------|--------------------------------------|
| DB_SERVER      | Yes      | Azure SQL server name                |
| DB_NAME        | Yes      | Database name                        |
| DB_USER        | Yes      | Database username                    |
| DB_PASSWORD    | Yes      | Database password                    |
| PORT           | No       | Port to run the app (default: 3000)  |

See `.env.example` for the full list with comments.

## Deployment

Currently deployed to Azure Web App ("SilverApp").

The project includes a GitHub Actions workflow (`.github/workflows/main_silverapp.yml`) that builds and deploys on push to `main`.

## Notes & Gotchas

- This application is **manual entry only**. There is no price scraping or external API integration.
- All timestamps are handled and displayed in **Eastern Time (America/New_York)**.
- The order of metals in the top tabs is intentionally: Gold → Silver → Copper.
- If you get database connection errors, double-check your `.env` values and firewall rules on the Azure SQL server.

## Project Structure

```
server.js           # Main application (routes + rendering)
.env.example        # Template for environment variables
.github/workflows/  # Azure deployment pipeline
```

---

**Maintained by:** Doug Rakocy
