// server.js
const express = require('express');
const sql = require('mssql');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// ============================================
// Azure SQL Configuration
// ============================================
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

// ============================================
// Fetch Silver Price from Massive.com (REST)
// ============================================
async function fetchSilverPriceFromPolygon() {
    if (!POLYGON_API_KEY) {
        throw new Error('POLYGON_API_KEY environment variable is not set');
    }

    try {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 5);

        const fromStr = from.toISOString().split('T')[0];
        const toStr = to.toISOString().split('T')[0];

        const url = `https://api.massive.com/v2/aggs/ticker/X:XAGUSD/range/1/day/${fromStr}/${toStr}?apiKey=${POLYGON_API_KEY}`;

        const response = await axios.get(url, {
            timeout: 60000, // 60 seconds timeout
            headers: {
                'User-Agent': 'axios/1.6.0'
            }
        });

        if (!response.data.results || response.data.results.length === 0) {
            throw new Error('No data returned from Massive API');
        }

        const latestBar = response.data.results[response.data.results.length - 1];
        const price = latestBar.c;
        const timestamp = new Date(latestBar.t);

        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar(10), 'XAG')
            .input('Price', sql.Decimal(18, 4), price)
            .input('Timestamp', sql.DateTime2, timestamp)
            .query(`
                INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                VALUES (@Metal, @Price, @Timestamp, 'Massive')
            `);

        console.log(`✅ Silver price saved from Massive: $${price}`);
        return { price, timestamp, source: 'Massive' };

    } catch (error) {
        console.error('Error fetching from Massive:', error.message);
        throw error;
    }
}

// ============================================
// Routes
// ============================================

// Main Dashboard
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

        const chartResult = await pool.request()
            .input('Days', sql.Int, days)
            .query(`
                SELECT Price, Timestamp 
                FROM MetalPrices 
                WHERE Metal = 'XAG' 
                  AND Timestamp >= DATEADD(day, -@Days, GETDATE())
                ORDER BY Timestamp ASC
            `);

        const latest = latestResult.recordset[0];
        const chartData = chartResult.recordset;

        const labels = chartData.map(row =>
            new Date(row.Timestamp).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            })
        );
        const prices = chartData.map(row => row.Price);

        let tableRows = '';
        chartData.forEach(row => {
            const formattedTime = new Date(row.Timestamp).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
            tableRows += `<tr><td>${formattedTime}</td><td style="text-align:right;">$${row.Price}</td></tr>`;
        });

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Silver Price Dashboard</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 40px 20px; color: #1e2937; }
                .container { max-width: 920px; margin: 0 auto; }
                .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; }
                .silver-icon { width: 52px; height: 52px; }
                .card { background: white; border-radius: 16px; padding: 28px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); margin-bottom: 24px; }
                .price { font-size: 48px; font-weight: 700; color: #0f172a; margin: 12px 0; }
                .meta { color: #64748b; font-size: 15px; }
                .toggle-buttons a { padding: 8px 16px; margin-right: 8px; text-decoration: none; background: #e2e8f0; color: #334155; border-radius: 6px; font-size: 14px; }
                .toggle-buttons a.active { background: #64748b; color: white; }
                table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
                th { background: #f1f5f9; }
                .update-btn { background: #0f172a; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; }
                .update-btn:hover { background: #1e2937; }
                .update-btn:disabled { background: #94a3b8; cursor: not-allowed; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <svg class="silver-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="#64748b" stroke-width="2"/>
                            <circle cx="12" cy="12" r="6" fill="#94a3b8"/>
                            <text x="12" y="16" text-anchor="middle" fill="#1e2937" font-size="8" font-weight="bold">Ag</text>
                        </svg>
                        <h1>Silver Price Dashboard</h1>
                    </div>
                    <button id="updateBtn" class="update-btn" onclick="updateSilverPrice()">Update Now</button>
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
                        <a href="/?range=30d" class="${range === '30d' ? 'active' : ''}">30 Days</a>
                        <a href="/?range=3m" class="${range === '3m' ? 'active' : ''}">3 Months</a>
                    </div>
                    <canvas id="silverChart"></canvas>
                </div>

                <div class="card">
                    <h2>Price History</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Date / Time</th>
                                <th style="text-align: right;">Price (USD)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                async function updateSilverPrice() {
                    const btn = document.getElementById('updateBtn');
                    btn.disabled = true;
                    btn.textContent = 'Updating...';

                    try {
                        const response = await fetch('/update-silver');
                        const result = await response.json();

                        if (result.success) {
                            btn.textContent = 'Updated!';
                            setTimeout(() => window.location.reload(), 800);
                        } else {
                            alert('Update failed: ' + result.error);
                            btn.textContent = 'Update Now';
                            btn.disabled = false;
                        }
                    } catch (err) {
                        alert('Error updating price');
                        btn.textContent = 'Update Now';
                        btn.disabled = false;
                    }
                }

                new Chart(document.getElementById('silverChart'), {
                    type: 'line',
                    data: {
                        labels: ${JSON.stringify(labels)},
                        datasets: [{
                            label: 'Silver (USD)',
                            data: ${JSON.stringify(prices)},
                            borderColor: '#64748b',
                            backgroundColor: 'rgba(100, 116, 139, 0.1)',
                            borderWidth: 3,
                            tension: 0.3,
                            fill: true
                        }]
                    },
                    options: { responsive: true, plugins: { legend: { display: false } } }
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Error loading dashboard');
    }
});

// Manually update silver price
app.get('/update-silver', async (req, res) => {
    try {
        const result = await fetchSilverPriceFromPolygon();
        res.json({ success: true, message: 'Silver price updated from Massive', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get latest silver price (JSON)
app.get('/silver-price', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 1 * FROM MetalPrices WHERE Metal = 'XAG' ORDER BY Timestamp DESC
        `);
        res.json({ success: true, data: result.recordset[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Test database
app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test');
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    if (poolPromise) {
        const pool = await poolPromise;
        await pool.close();
    }
    process.exit(0);
});
