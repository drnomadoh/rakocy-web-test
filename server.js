// server.js
const express = require('express');
const sql = require('mssql');
const axios = require('axios');           // You'll need to install this: npm install axios
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
// Fetch Silver Price from metals-api.com
// ============================================
async function fetchSilverPrice() {
    try {
        const response = await axios.get('https://api.metals-api.com/api/latest', {
            params: {
                access_key: METALS_API_KEY,
                base: 'USD',
                symbols: 'XAG'           // XAG = Silver
            }
        });

        if (!response.data.success) {
            throw new Error(response.data.error?.info || 'Failed to fetch from metals-api');
        }

        const price = response.data.rates.XAG;
        const timestamp = new Date(response.data.timestamp * 1000);

        // Save to database
        const pool = await getPool();
        await pool.request()
            .input('Metal', sql.VarChar, 'XAG')
            .input('Price', sql.Decimal(18, 4), price)
            .input('Timestamp', sql.DateTime2, timestamp)
            .query(`
                INSERT INTO MetalPrices (Metal, Price, Timestamp, Source)
                VALUES (@Metal, @Price, @Timestamp, 'metals-api.com')
            `);

        console.log(`✅ Silver price saved: $${price} at ${timestamp}`);
        return { price, timestamp };

    } catch (error) {
        console.error('Error fetching silver price:', error.message);
        throw error;
    }
}

// ============================================
// Routes
// ============================================

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Metals Pricing API' });
});

// Manually trigger price update
app.get('/update-silver', async (req, res) => {
    try {
        const result = await fetchSilverPrice();
        res.json({
            success: true,
            message: 'Silver price updated',
            data: result
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get latest silver price from database
app.get('/silver-price', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT TOP 1 Price, Timestamp 
            FROM MetalPrices 
            WHERE Metal = 'XAG'
            ORDER BY Timestamp DESC
        `);

        if (result.recordset.length === 0) {
            return res.json({ success: false, message: 'No silver price data found' });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });
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
