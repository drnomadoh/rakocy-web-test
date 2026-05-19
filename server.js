// ============================================
// Main Dashboard Page (Root) - With SVG Icon
// ============================================
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

        // Get last 3 days of data for chart
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
                body {
                    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: #f8fafc;
                    margin: 0;
                    padding: 40px 20px;
                    color: #1e2937;
                }
                .container {
                    max-width: 920px;
                    margin: 0 auto;
                }
                .header {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    margin-bottom: 32px;
                }
                .silver-icon {
                    width: 52px;
                    height: 52px;
                }
                .card {
                    background: white;
                    border-radius: 16px;
                    padding: 28px;
                    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
                    margin-bottom: 24px;
                }
                .price {
                    font-size: 48px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 12px 0;
                }
                .meta {
                    color: #64748b;
                    font-size: 15px;
                    line-height: 1.5;
                }
                h1 {
                    margin: 0;
                    font-size: 28px;
                }
                h2 {
                    margin-top: 0;
                    color: #334155;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Header with SVG Icon -->
                <div class="header">
                    <svg class="silver-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" stroke="#64748b" stroke-width="2"/>
                        <circle cx="12" cy="12" r="6" fill="#94a3b8"/>
                        <text x="12" y="16" text-anchor="middle" fill="#1e2937" font-size="8" font-weight="bold">Ag</text>
                    </svg>
                    <h1>Silver Price Dashboard</h1>
                </div>

                <!-- Current Price Card -->
                <div class="card">
                    <h2>Current Silver Price (USD per oz)</h2>
                    <div class="price">$${latest ? latest.Price : '—'}</div>
                    <div class="meta">
                        <strong>Last updated:</strong> ${latest ? new Date(latest.Timestamp).toLocaleString() : 'No data available'}<br>
                        <strong>Source:</strong> ${latest ? latest.Source : 'N/A'}
                    </div>
                </div>

                <!-- Chart Card -->
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
                            fill: true,
                            pointRadius: 3,
                            pointHoverRadius: 5
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { display: false }
                        },
                        scales: {
                            y: {
                                title: { display: true, text: 'Price (USD)' }
                            }
                        }
                    }
                });
            </script>
        </body>
        </html>
        `;

        res.send(html);

    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Error loading Silver dashboard');
    }
});
