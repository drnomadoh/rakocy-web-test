// server.js - FINAL ROBUST VERSION (May 26 Data Fix)
const express = require('express');
const sql = require('mssql');
const axios = require('axios');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: true,
        trustServerCertificate: false
    }
};

let poolPromise;

async function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(config).connect();
    }
    return poolPromise;
}

// Get start date for the range in Eastern Time
function getEasternStartDate(days) {
    const today = new Date();
    today.setDate(today.getDate() - days);
    return today.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function easternToUTC(easternDateTimeString) {
    const easternDate = new Date(easternDateTimeString);
    return new Date(easternDate.getTime() + (4 * 60 * 60 * 1000));
}

function formatEasternTime(date) {
    if (!date) return 'No data';
    return new Date(date).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
}

function getEasternDateTimeLocal() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(now);
    const get = (type) => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const METAL_TICKERS = { 'XAG': 'X:XAGUSD', 'XAU': 'X:XAUUSD', 'XCU': 'X:XCUUSD' };
const METAL_NAMES = { 'XAG': 'Silver', 'XAU': 'Gold', 'XCU': 'Copper' };
const METAL_THEMES = {
    'XAG': { primary: '#64748b', secondary: '#94a3b8', accent: '#475569' },
    'XAU': { primary: '#d4af37', secondary: '#f4d35e', accent: '#b8860b' },
    'XCU': { primary: '#b87333', secondary: '#cd7f32', accent: '#8b4513' }
};

async function fetchMetalPrice(metalCode) {
    if (!POLYGON_API_KEY) throw new Error('POLYGON_API_KEY is not set');
    const ticker = METAL_TICKERS[metalCode];
    if (!ticker) throw new Error('Invalid metal code');

    try {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 10);
        const fromStr = from.toISOString().split('T')[0];
        const toStr = to.toISOString().split('T')[0];

        const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?apiKey=${POLYGON_API_KEY}`;
        const response = await axios.get(url, { timeout: 60000 });

        if (!response.data.results?.length) throw new Error('No data from Massive');

        const latestBar = response.data.results.at(-1);
        const price = latestBar.c;
        const timestamp = new Date(latestBar.t);

        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar(10), metalCode)
            .input('Price', sql.Decimal(18, 4), price)
            .input('Timestamp', sql.DateTime2, timestamp)
            .query(`INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                    VALUES (@Metal, @Price, @Timestamp, 'Massive')`);

        return { price, timestamp, source: 'Massive', metal: metalCode };
    } catch (error) {
        console.error(`Error fetching ${metalCode}:`, error.message);
        throw error;
    }
}

app.get('/', async (req, res) => {
    try {
        const cookieMetal = req.cookies?.lastMetal || 'XAG';
        const cookieRange = req.cookies?.lastRange || '30d';

        const selectedMetal = (req.query.metal || cookieMetal).toUpperCase();
        const range = req.query.range || cookieRange;

        let days = 30;
        if (range === '3d') days = 3;
        if (range === '7d') days = 7;
        if (range === '30d') days = 30;
        if (range === '90d') days = 90;
        if (range === '180d') days = 180;
        if (range === '365d') days = 365;

        const theme = METAL_THEMES[selectedMetal] || METAL_THEMES['XAG'];
        const pool = await getPool();

        const latestResult = await pool.request()
            .input('Metal', sql.VarChar(10), selectedMetal)
            .query(`SELECT TOP 1 Price, Timestamp, Source FROM MetalPrices WHERE Metal = @Metal ORDER BY Timestamp DESC`);

        const startDate = getEasternStartDate(days);

        const rawResult = await pool.request()
            .input('Metal', sql.VarChar(10), selectedMetal)
            .input('StartDate', sql.Date, startDate)
            .query(`SELECT CAST(Timestamp AS DATE) as TradeDate, Price FROM MetalPrices 
                    WHERE Metal = @Metal AND CAST(Timestamp AS DATE) >= @StartDate 
                    ORDER BY Timestamp ASC`);

        const latest = latestResult.recordset[0];
        const rawData = rawResult.recordset;

        const dailyMap = {};
        rawData.forEach(row => {
            const easternDateStr = new Date(row.TradeDate).toLocaleDateString('en-CA', { 
                timeZone: 'America/New_York' 
            });
            const key = easternDateStr;

            if (!dailyMap[key]) {
                dailyMap[key] = { open: row.Price, high: row.Price, low: row.Price, close: row.Price, date: row.TradeDate };
            } else {
                dailyMap[key].high = Math.max(dailyMap[key].high, row.Price);
                dailyMap[key].low = Math.min(dailyMap[key].low, row.Price);
                dailyMap[key].close = row.Price;
            }
        });

        const sortedDates = Object.keys(dailyMap).sort();
        const dailyOHLC = sortedDates.map(date => dailyMap[date]);

        const apexCandlestick = dailyOHLC.map(d => ({
            x: d.date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }),
            y: [parseFloat(d.open.toFixed(2)), parseFloat(d.high.toFixed(2)), parseFloat(d.low.toFixed(2)), parseFloat(d.close.toFixed(2))]
        }));

        const apexLine = dailyOHLC.map(d => ({
            x: d.date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }),
            y: parseFloat(d.close.toFixed(2))
        }));

        let ohlcRows = '';
        dailyOHLC.forEach(d => {
            const dateLabel = d.date.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
            ohlcRows += `<tr><td>${dateLabel}</td>
                <td style="text-align:right;">$${d.open.toFixed(2)}</td>
                <td style="text-align:right;">$${d.high.toFixed(2)}</td>
                <td style="text-align:right;">$${d.low.toFixed(2)}</td>
                <td style="text-align:right;">$${d.close.toFixed(2)}</td></tr>`;
        });

        const metalName = METAL_NAMES[selectedMetal] || 'Metal';
        const metalOptions = ['XAG', 'XAU', 'XCU'];

        res.cookie('lastMetal', selectedMetal, { maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.cookie('lastRange', range, { maxAge: 30 * 24 * 60 * 60 * 1000 });

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Metals Price Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <style>
        body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 40px 20px; color: #1e2937; }
        .container { max-width: 1100px; margin: 0 auto; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; flex-wrap: wrap; gap: 12px; }
        .silver-icon { width: 52px; height: 52px; }
        .card { background: white; border-radius: 16px; padding: 28px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); margin-bottom: 24px; }
        .price { font-size: 48px; font-weight: 700; color: #0f172a; margin: 12px 0; }
        .meta { color: #64748b; font-size: 15px; }
        .metal-buttons a, .range-buttons a { padding: 8px 16px; margin-right: 8px; text-decoration: none; background: #e2e8f0; color: #334155; border-radius: 6px; font-size: 14px; font-weight: 500; }
        .metal-buttons a.active, .range-buttons a.active { background: ${theme.primary}; color: white; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; font-weight: 600; }
        #candlestickChart { min-height: 480px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="display: flex; align-items: center; gap: 16px;">
                <svg class="silver-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="${theme.primary}" stroke-width="2"/>
                    <circle cx="12" cy="12" r="6" fill="${theme.secondary}"/>
                    <text x="12" y="16" text-anchor="middle" fill="#1e2937" font-size="8" font-weight="bold">${selectedMetal}</text>
                </svg>
                <h1>Metals Price Dashboard</h1>
            </div>
            <div class="metal-buttons">
                ${metalOptions.map(m => `<a href="/?metal=${m}&range=${range}" class="${selectedMetal === m ? 'active' : ''}">${METAL_NAMES[m]}</a>`).join('')}
            </div>
        </div>

        <div class="card">
            <h2>Current ${metalName} Price (USD per oz)</h2>
            <div class="price">$${latest ? latest.Price : '—'}</div>
            <div class="meta">
                Last updated: ${formatEasternTime(latest ? latest.Timestamp : null)}<br>
                Source: ${latest ? latest.Source : 'N/A'}
            </div>
        </div>

        <div class="card">
            <h2>${metalName} Price Trend</h2>
            <div class="range-buttons" style="margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 6px;">
                <a href="/?metal=${selectedMetal}&range=3d" class="${range === '3d' ? 'active' : ''}">3 Days</a>
                <a href="/?metal=${selectedMetal}&range=7d" class="${range === '7d' ? 'active' : ''}">7 Days</a>
                <a href="/?metal=${selectedMetal}&range=30d" class="${range === '30d' ? 'active' : ''}">30 Days</a>
                <a href="/?metal=${selectedMetal}&range=90d" class="${range === '90d' ? 'active' : ''}">90 Days</a>
                <a href="/?metal=${selectedMetal}&range=180d" class="${range === '180d' ? 'active' : ''}">6 Months</a>
                <a href="/?metal=${selectedMetal}&range=365d" class="${range === '365d' ? 'active' : ''}">1 Year</a>
            </div>
            <div id="candlestickChart"></div>
        </div>

        <div class="card">
            <h2>Daily Price Summary (OHLC)</h2>
            <table>
                <thead><tr style="background:#e0e7ff;"><th>Date</th><th style="text-align:right;">Open</th><th style="text-align:right;">High</th><th style="text-align:right;">Low</th><th style="text-align:right;">Close</th></tr></thead>
                <tbody>${ohlcRows}</tbody>
            </table>
        </div>

        <div class="card">
            <h2>Manual Entry (${metalName})</h2>
            <form action="/manual-update" method="POST" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
                <input type="hidden" name="metal" value="${selectedMetal}">
                <input type="hidden" name="range" value="${range}">
                <div><label>Price (USD)</label><br><input type="number" step="0.01" name="price" value="${latest ? latest.Price.toFixed(2) : '0.00'}" required></div>
                <div><label>Timestamp</label><br><input type="datetime-local" name="timestamp" value="${getEasternDateTimeLocal()}" required></div>
                <button type="submit" style="background:#166534;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;">Add Entry</button>
            </form>
        </div>
    </div>

    <script>
        var options = {
            series: [
                { name: "Candlestick", type: "candlestick", data: ${JSON.stringify(apexCandlestick)} },
                { name: "Close Price", type: "line", data: ${JSON.stringify(apexLine)} }
            ],
            chart: {
                height: 480,
                type: "line",
                toolbar: { show: true, tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
                zoom: { enabled: true, type: "x" }
            },
            title: { text: "${metalName} Candlestick + Line", align: "left", style: { fontSize: "18px", fontWeight: "600" } },
            stroke: { width: [1, 3], curve: "smooth" },
            colors: ["#ef4444", "${theme.primary}"],
            xaxis: { type: "category", labels: { rotate: -45 } },
            yaxis: { tooltip: { enabled: true } },
            tooltip: { shared: true, intersect: false, y: { formatter: (val) => "$" + val.toFixed(2) } },
            legend: { show: true, position: "top" },
            plotOptions: { candlestick: { colors: { upward: "#22c55e", downward: "#ef4444" } } }
        };
        var chart = new ApexCharts(document.querySelector("#candlestickChart"), options);
        chart.render();
    </script>
</body>
</html>`;

        res.send(html);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading dashboard');
    }
});

app.post('/manual-update', async (req, res) => {
    try {
        const { metal, price, timestamp, range } = req.body;
        const pool = await getPool();
        const utcTimestamp = easternToUTC(timestamp);
        
        await pool.request()
            .input('Metal', sql.VarChar(10), metal || 'XAG')
            .input('Price', sql.Decimal(18, 4), parseFloat(price))
            .input('Timestamp', sql.DateTime2, utcTimestamp)
            .query(`INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                    VALUES (@Metal, @Price, @Timestamp, 'Manual Entry')`);
        
        res.redirect(`/?metal=${metal || 'XAG'}&range=${range || '30d'}`);
    } catch (err) {
        res.status(500).send('Failed to add entry');
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

process.on('SIGINT', async () => {
    if (poolPromise) await (await poolPromise).close();
    process.exit(0);
});
