// server.js
const express = require('express');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Azure SQL Configuration (from Environment Variables)
// ============================================
const server   = process.env.DB_SERVER;
const database = process.env.DB_NAME;
const user     = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

if (!server || !database || !user || !password) {
    console.error("❌ FATAL ERROR: Missing database environment variables!");
    console.error("Required: DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD");
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
                console.log('✅ Connected to Azure SQL (via hostname)');
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
// Routes
// ============================================

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Node.js app running on Azure App Service'
    });
});

// Normal test route (uses hostname + Private DNS)
app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test, GETDATE() AS currentTime');

        res.json({
            success: true,
            message: 'Connected using hostname (should use Private DNS)',
            data: result.recordset[0]
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to connect to database',
            error: err.message
        });
    }
});

// ============================================
// TEST ROUTE: Direct connection using Private IP
// Use this to test if network path works
// ============================================
app.get('/test-db-direct', async (req, res) => {
    const directConfig = {
        server: '10.0.2.50',           // Private IP from DNS record
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        options: {
            encrypt: true,
            trustServerCertificate: false,
            enableArithAbort: true
        },
        pool: {
            max: 5,
            min: 0,
            idleTimeoutMillis: 30000
        }
    };

    try {
        const directPool = new sql.ConnectionPool(directConfig);
        await directPool.connect();

        const result = await directPool.request().query('SELECT 1 AS test, GETDATE() AS currentTime');
        await directPool.close();

        res.json({
            success: true,
            message: 'Successfully connected using PRIVATE IP directly (10.0.2.50)',
            data: result.recordset[0]
        });
    } catch (err) {
        console.error('Direct IP connection error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to connect using private IP',
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
    console.log('Shutting down...');
    if (poolPromise) {
        const pool = await poolPromise;
        await pool.close();
    }
    process.exit(0);
});
