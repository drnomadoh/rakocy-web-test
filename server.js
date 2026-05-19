// server.js
const express = require('express');
const sql = require('mssql');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const METALS_API_KEY = process.env.METALS_API_KEY;

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
        trustServerCertificate: false,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let poolPromise;

async function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(config)
            .connect()
            .then(pool => {
                console.log('✅ Connected to Azure SQL via Private Endpoint');
                return pool;
            })
            .catch(err => {
                console.error('❌ Database Connection Failed:', err.message);
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

// ============================================
// Fetch Silver Price from metals-api.com and save to DB
// ============================================
async function fetchSilverPrice() {
    if (!METALS_API_KEY) {
        throw new Error('METALS_API_KEY environment variable is not set');
    }

    try {
        const response = await axios.get('https://api.metals-api.com/api/latest', {
            params: {
                access_key: METALS_API_KEY,
                base: 'USD',
                symbols: 'XAG'
            }
        });

        if (!response.data.success) {
            throw new Error(response.data.error?.info || 'Failed to fetch price from metals-api.com');
        }

        const price = response.data.rates.XAG;
        const timestamp = new Date(response.data.timestamp * 1000);

        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar(10), 'XAG')
            .input('Price', sql.Decimal(18, 4), price)
            .input('Timestamp', sql.DateTime2, timestamp)
            .query(`
                INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                VALUES (@Metal, @Price, @Timestamp, 'metals-api.com')
            `);

        console.log(`✅ Silver price saved: $${price}`);
        return { price, timestamp };

    } catch (error) {
        console.error('Error fetching silver price:', error.message);
        throw error;
    }
}

// ============================================
// Routes
// ============================================

// Main Dashboard (with chart)
app.get('/', async (req, res) => {
    try {
        const pool = await getPool();

        // Get latest price
        const latestResult = await pool.request().query(`
            SELECT TOP 1 Price, Timestamp, Source 
            FROM MetalPrices 
            WHERE Metal = 'XAG'
            ORDER BY Timestamp DESC
        `);

        // Get last 3 days of data
        const chartResult = await pool.request().query(`
            SELECT Price, Timestamp 
            FROM MetalPrices 
            WHERE Metal = 'XAG' 
              AND Timestamp >= DATEADD(day, -3, GETDATE())
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
                .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
                .silver-icon { width: 52px; height: 52px; }
                .card { background: white; border-radius: 16px; padding: 28px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); margin-bottom: 24px; }
                .price { font-size: 48px; font-weight: 700; color: #0f172a; margin: 12px 0; }
                .meta { color: #64748b; font-size: 15px; line-height: 1.5; }
                h1 { margin: 0; font-size: 28px; }
                h2 { margin-top: 0; color: #334155; }
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
                        <strong>Last updated:</strong> ${latest ? new Date(latest.Timestamp).toLocaleString() : 'No data'}<br>
                        <strong>Source:</strong> ${latest ? latest.Source : 'N/A'}
                    </div>
                </div>

                <div class="card">
                    <h2>Silver Price Trend - Last 3 Days</h2>
                    <canvas id="silverChart"></canvas>
                </div>
            </div>

            <script>
                const ctx = document.getElementById('silverChart');
                new Chart(ctx, {
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
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { title: { display: true, text: 'Price (USD)' } }
                        }
                    }
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

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test, GETDATE() AS currentTime');
        res.json({ success: true, message: 'Database connected', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Manually update silver price
app.get('/update-silver', async (req, res) => {
    try {
        const result = await fetchSilverPrice();
        res.json({ success: true, message: 'Silver price updated', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get latest silver price (JSON)
app.get('/silver-price', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 1 Price, Timestamp, Source 
            FROM MetalPrices 
            WHERE Metal = 'XAG'
            ORDER BY Timestamp DESC
        `);

        if (result.recordset.length === 0) {
            return res.json({ success: false, message: 'No data found' });
        }

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
