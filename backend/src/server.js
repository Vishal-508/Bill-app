require('dotenv').config();

const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;
const startedAt = Date.now();

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: (Date.now() - startedAt) / 1000,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
