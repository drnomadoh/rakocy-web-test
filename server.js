// server.js
const express = require('express');
const sql = require('mssql');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
// Scrape Silver Price from MoneyMetals
// ============================================
async function fetchSilverPriceFromMoneyMetals() {
    try {
        const { data } = await axios.get('https://www.moneymetals.com/silver-price', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(data);

        // Try multiple possible selectors (MoneyMetals sometimes changes layout)
        let priceText = '';

        // Common patterns on MoneyMetals
        priceText = $('[class*="price"]').first().text().trim() ||
                    $('h1, h2, h3').filter((i, el) => $(el).text().includes('$')).first().text().trim() ||
                    $('body').text().match(/\$[\d,.]+/)?.[0] || '';

        // Clean the price
        const priceMatch = priceText.match(/[\d,.]+/);
        if (!priceMatch) {
            throw new Error('Could not extract silver price from MoneyMetals');
        }

        const price = parseFloat(priceMatch[0].replace(',', ''));

        const timestamp = new Date();

        // Save to database
        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar(10), 'XAG')
            .input('Price', sql.Decimal(18, 4), price)
            .input('Timestamp', sql.DateTime2, timestamp)
            .query(`
                INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                VALUES (@Metal, @Price, @Timestamp, 'MoneyMetals')
            `);

        console.log(`✅ Silver price scraped from MoneyMetals: $${price}`);
        return { price, timestamp, source: 'MoneyMetals' };

    } catch (error) {
        console.error('Error scraping MoneyMetals:', error.message);
        throw error;
    }
}

// ============================================
// Routes
// ============================================

// Dashboard
app.get('/', async (req, res) => {
    try {
        const pool = await getPool();

        const latestResult = await pool.request().query(`
            SELECT TOP 1 Price, Timestamp, Source 
            FROM MetalPrices 
            WHERE Metal = 'XAG'
            ORDER BY Timestamp DESC
        `);

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
                body { font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 40px 20px; }
                .container { max-width: 920px; margin: 0 auto; }
                .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; }
                .silver-icon { width: 52px; height: 52px; }
                .card { background: white; border-radius: 16px; padding: 28px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); margin-bottom: 24px; }
                .price { font-size: 48px; font-weight: 700; color: #0f172a; margin: 12px 0; }
                .meta { color: #64748b; font-size: 15px; }
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
                    <h2>Silver Price - Last 3 Days</h2>
                    <canvas id="silverChart"></canvas>
                </div>
            </div>

            <script>
                new Chart(document.getElementById('silverChart'), {
                    type: 'line',
                    data: {
                        labels: ${JSON.stringify(labels)},
                        datasets: [{
                            label: 'Silver Price',
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
        res.status(500).send('Error loading dashboard');
    }
});

// Manually update silver price by scraping MoneyMetals
app.get('/update-silver', async (req, res) => {
    try {
        const result = await fetchSilverPriceFromMoneyMetals();
        res.json({ success: true, message: 'Silver price updated from MoneyMetals', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get latest silver price
app.get('/silver-price', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 1 * FROM MetalPrices 
            WHERE Metal = 'XAG' 
            ORDER BY Timestamp DESC
        `);
        res.json({ success: true, data: result.recordset[0] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Test DB
app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test');
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

process.on('SIGINT', async () => {
    if (poolPromise) await (await poolPromise).close();
    process.exit(0);
});
