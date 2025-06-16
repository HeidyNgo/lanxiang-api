// ===== BỘ NÃO CỦA HỆ THỐNG - PHIÊN BẢN CUỐI CÙNG - XỬ LÝ MỌI ĐỊNH DẠNG NGÀY =====
// server.js

const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Cấu hình xác thực
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});
const sheetId = process.env.GOOGLE_SHEET_ID;

// Hàm helper để truy cập Google Sheet
async function accessSpreadsheet() {
  const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

// === HÀM MỚI: Tự động chuyển đổi các định dạng ngày khác nhau về YYYY-MM-DD ===
function normalizeDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    if (dateString.includes('-')) { // Đã là định dạng YYYY-MM-DD
        return dateString;
    }
    if (dateString.includes('/')) { // Chuyển đổi từ DD/MM/YYYY
        const parts = dateString.split('/');
        if (parts.length === 3) {
            const [day, month, year] = parts;
            return `<span class="math-inline">\{year\}\-</span>{month.padStart(2, '0')}-<span class="math-inline">\{day\.padStart\(2, '0'\)\}\`;
\}
\}
return</36\> dateString; // Trả về như cũ nếu không nhận diện được
\}
// \=\=\= API 1\: Lấy trạng thái nhân viên \=\=\=
app\.get\('/api/staff\-availability', async \(req, res\) \=\> \{
try \{
const \{ date \} \= req\.query; // date từ request luôn là YYYY\-MM\-DD
if \(\!date \|\| \!/^\\d\{4\}\-\\d\{2\}\-\\d\{2\}</span>/.test(date)) {
      return res.status(400).json({ error: 'Missing or invalid date parameter. Format:
