// server.js
const express = require('express');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Azure SQL Configuration
// ============================================
const server   = process.env.DB_SERVER;
const database = process.env.DB_NAME;
const user     = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

if (!server || !database || !user || !password) {
    console.error("❌ Missing required database environment variables!");
    process.exit(1);
}

const config = {
    server: server,
    database: database,
    user: user,
    password: password,
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
// Middleware - Enforce HTTPS in production
// ============================================
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

// ============================================
// Routes
// ============================================

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Node.js API running on Azure App Service (Private Endpoint)'
    });
});

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test, GETDATE() AS currentTime');

        res.json({
            success: true,
            message: 'Connected using hostname via Private DNS',
            data: result.recordset[0]
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: err.message
        });
    }
});

// Get Silver Pricing data
app.get('/silver-pricing', async (req, res) => {
    try {
        const pool = await getPool();
        
        // TODO: Update this query based on your actual table name and columns
        const result = await pool.request().query(`
            SELECT TOP 50 * 
            FROM SilverPricing 
            ORDER BY CreatedDate DESC
        `);

        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        console.error('Error fetching silver pricing:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch silver pricing data',
            error: err.message
        });
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
