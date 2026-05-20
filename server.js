// server.js
const express = require('express');
const sql = require('mssql');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

app.use(express.urlencoded({ extended: true }));

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

async function fetchSilverPriceFromPolygon() {
    if (!POLYGON_API_KEY) throw new Error('POLYGON_API_KEY is not set');
    try {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 10);
        const fromStr = from.toISOString().split('T')[0];
        const toStr = to.toISOString().split('T')[0];

        const url = `https://api.massive.com/v2/aggs/ticker/X:XAGUSD/range/1/day/${fromStr}/${toStr}?apiKey=${POLYGON_API_KEY}`;
        const response = await axios.get(url, { timeout: 60000 });

        if (!response.data.results?.length) throw new Error('No data from Massive');

        const latestBar = response.data.results.at(-1);
        const price = latestBar.c;
        const timestamp = new Date(latestBar.t);

        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar(10), 'XAG')
            .input('Price', sql.Decimal(18, 4), price)
            .input('Timestamp', sql.DateTime2, timestamp)
            .query(`INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                    VALUES (@Metal, @Price, @Timestamp, 'Massive')`);

        return { price, timestamp, source: 'Massive' };
    } catch (error) {
        console.error('Error fetching from Massive:', error.message);
        throw error;
    }
}

// ============================================
// Main Dashboard
// ============================================
app.get('/', async (req, res) => {
    try {
        const range = req.query.range || '3d';
        let days = 3;
        if (range === '7d') days = 7;
        if (range === '30d') days = 30;
        if (range === '3m') days = 90;

        const pool = await getPool();

        const latestResult = await pool.request().query(`
            SELECT TOP 1 Price, Timestamp, Source 
            FROM MetalPrices 
            WHERE Metal = 'XAG'
            ORDER BY Timestamp DESC
        `);

        const rawResult = await pool.request()
            .input('Days', sql.Int, days)
            .query(`
                SELECT CAST(Timestamp AS DATE) as TradeDate, Price 
                FROM MetalPrices 
                WHERE Metal = 'XAG' 
                  AND Timestamp >= DATEADD(day, -@Days, GETDATE())
                ORDER BY Timestamp ASC
            `);

        const latest = latestResult.recordset[0];
        const rawData = rawResult.recordset;

        // Group by day → daily OHLC
        const dailyMap = {};
        rawData.forEach(row => {
            const key = row.TradeDate.toISOString().split('T')[0];
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

        // X-axis labels (date only)
        const labels = dailyOHLC.map(d => 
            d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );

        // Data for candlestick
        const candlestickData = dailyOHLC.map(d => ({
            x: d.date.getTime(),
            o: d.open,
            h: d.high,
            l: d.low,
            c: d.close
        }));

        // Close prices for fallback line chart
        const closePrices = dailyOHLC.map(d => d.close);

        // OHLC table
        let ohlcRows = '';
        dailyOHLC.forEach(d => {
            const dateLabel = d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            ohlcRows += `
                <tr>
                    <td>${dateLabel}</td>
                    <td style="text-align:right;">$${d.open.toFixed(2)}</td>
                    <td style="text-align:right;">$${d.high.toFixed(2)}</td>
                    <td style="text-align:right;">$${d.low.toFixed(2)}</td>
                    <td style="text-align:right;">$${d.close.toFixed(2)}</td>
                </tr>`;
        });

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Silver Price Dashboard</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
            <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-financial@0.2.1/dist/chartjs-chart-financial.min.js"></script>
            <style>
                body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 40px 20px; color: #1e2937; }
                .container { max-width: 1000px; margin: 0 auto; }
                .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
                .silver-icon { width: 52px; height: 52px; }
                .card { background: white; border-radius: 16px; padding: 28px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); margin-bottom: 24px; }
                .price { font-size: 48px; font-weight: 700; color: #0f172a; margin: 12px 0; }
                .meta { color: #64748b; font-size: 15px; }
                .toggle-buttons a { padding: 8px 16px; margin-right: 8px; text-decoration: none; background: #e2e8f0; color: #334155; border-radius: 6px; font-size: 14px; }
                .toggle-buttons a.active { background: #64748b; color: white; }
                table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
                th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
                th { background: #f1f5f9; font-weight: 600; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <svg class="silver-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" stroke="#64748b" stroke-width="2"/>
                        <circle cx="12" cy="12" r="6" fill="#94a3b8"/>
                        <text x="12" y="16" text-anchor="middle" fill="#1e2937" font-size="8" font-weight="bold">Ag</text>
                    </svg>
                    <h1>Silver Price Dashboard</h1>
                </div>

                <div class="card">
                    <h2>Current Silver Price (USD per oz)</h2>
                    <div class="price">$${latest ? latest.Price : '—'}</div>
                    <div class="meta">
                        Last updated: ${latest ? new Date(latest.Timestamp).toLocaleString() : 'No data'}<br>
                        Source: ${latest ? latest.Source : 'N/A'}
                    </div>
                </div>

                <div class="card">
                    <h2>Silver Price Trend</h2>
                    <div class="toggle-buttons">
                        <a href="/?range=3d" class="${range === '3d' || !req.query.range ? 'active' : ''}">3 Days</a>
                        <a href="/?range=7d" class="${range === '7d' ? 'active' : ''}">7 Days</a>
                        <a href="/?range=30d" class="${range === '30d' ? 'active' : ''}">1 Month</a>
                        <a href="/?range=3m" class="${range === '3m' ? 'active' : ''}">3 Months</a>
                    </div>
                    <canvas id="silverChart"></canvas>
                </div>

                <div class="card">
                    <h2>Daily Price Summary (OHLC)</h2>
                    <table>
                        <thead>
                            <tr style="background:#e0e7ff;">
                                <th>Date</th>
                                <th style="text-align:right;">Open</th>
                                <th style="text-align:right;">High</th>
                                <th style="text-align:right;">Low</th>
                                <th style="text-align:right;">Close</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ohlcRows}
                        </tbody>
                    </table>
                </div>

                <div class="card">
                    <h2>Manual Entry</h2>
                    <form action="/manual-update" method="POST" style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
                        <div>
                            <label>Price (USD)</label><br>
                            <input type="number" step="0.01" name="price" value="76.89" required>
                        </div>
                        <div>
                            <label>Timestamp</label><br>
                            <input type="datetime-local" name="timestamp" value="${new Date().toISOString().slice(0,16)}" required>
                        </div>
                        <button type="submit" style="background:#166534;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;">Add Entry</button>
                    </form>
                </div>
            </div>

            <script>
                // Try to use candlestick chart, fall back to line if plugin fails
                const useCandlestick = typeof ChartFinancial !== 'undefined';

                if (useCandlestick) {
                    Chart.register(ChartFinancial.CandlestickController, ChartFinancial.CandlestickElement);
                }

                new Chart(document.getElementById('silverChart'), {
                    type: useCandlestick ? 'candlestick' : 'line',
                    data: {
                        datasets: [{
                            label: useCandlestick ? 'Silver (OHLC)' : 'Close Price',
                            data: useCandlestick 
                                ? ${JSON.stringify(candlestickData)}
                                : ${JSON.stringify(closePrices.map((p, i) => ({ x: dailyOHLC[i].date.getTime(), y: p })))}
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: {
                                type: 'time',
                                time: { unit: 'day' },
                                ticks: { maxRotation: 45, minRotation: 0 }
                            },
                            y: { beginAtZero: false }
                        }
                    }
                });

                if (!useCandlestick) {
                    console.warn('%c[Candlestick] Plugin not loaded. Falling back to line chart.', 'color: orange');
                }
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading dashboard');
    }
});

// Update silver price (future use)
app.get('/update-silver', async (req, res) => {
    try {
        const result = await fetchSilverPriceFromPolygon();
        res.json({ success: true, message: 'Updated', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Manual entry
app.post('/manual-update', async (req, res) => {
    try {
        const { price, timestamp } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar(10), 'XAG')
            .input('Price', sql.Decimal(18, 4), parseFloat(price))
            .input('Timestamp', sql.DateTime2, new Date(timestamp))
            .query(`INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                    VALUES (@Metal, @Price, @Timestamp, 'Manual Entry')`);
        res.redirect('/');
    } catch (err) {
        res.status(500).send('Failed to add entry');
    }
});

app.get('/silver-price', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`SELECT TOP 1 * FROM MetalPrices WHERE Metal = 'XAG' ORDER BY Timestamp DESC`);
        res.json({ success: true, data: result.recordset[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test');
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

process.on('SIGINT', async () => {
    if (poolPromise) await (await poolPromise).close();
    process.exit(0);
});
