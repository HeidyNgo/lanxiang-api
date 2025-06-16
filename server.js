// ===== BỘ NÃO CỦA HỆ THỐNG - PHIÊN BẢN CẢI THIỆN LOGIC THỜI GIAN CHỜ =====
// server.js

const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});
const sheetId = process.env.GOOGLE_SHEET_ID;

async function accessSpreadsheet() {
  const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

// === API 1: Lấy trạng thái nhân viên ===
app.get('/api/staff-availability', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Missing or invalid date parameter. Format:
