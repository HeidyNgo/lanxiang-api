// ===== BỘ NÃO CỦA HỆ THỐNG - PHIÊN BẢN NÂNG CẤP LOGIC XUNG ĐỘT =====
import express from 'express';
import cors from 'cors';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheetId = process.env.GOOGLE_SHEET_ID;

async function accessSpreadsheet() {
  const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

function normalizeDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const trimmedDate = dateString.trim();
    if (trimmedDate.match(/^\d{4}-\d{2}-\d{2}$/)) return trimmedDate;
    if (trimmedDate.includes('/')) {
        const parts = trimmedDate.split('/');
        if (parts.length === 3) {
            let [day, month, year] = parts;
            if (year.length === 2) year = '20' + year;
            if (day.length === 4) [year, month, day] = parts;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
    }
    return trimmedDate;
}

// === API 1: LẤY TRẠNG THÁI NHÂN VIÊN (LOGIC VIẾT LẠI HOÀN TOÀN) ===
app.get('/api/staff-availability', async (req, res) => {
    try {
        const { date, startTime, duration } = req.query;
        if (!date || !startTime || !duration) {
            return res.status(400).json({ error: 'Date, startTime, and duration are required.' });
        }

        const newBookingStart = new Date(`${date}T${startTime}`);
        const newBookingEnd = new Date(newBookingStart.getTime() + parseInt(duration) * 60000);

        const doc = await accessSpreadsheet();
        const offDaysSheet = doc.sheetsByTitle['OffDays'];
        if (!offDaysSheet) throw new Error("Sheet 'OffDays' not found!");
        const offDaysRows = await offDaysSheet.getRows();
        const allStaffNames = [...new Set(offDaysRows.map(row => row.get('name')))].filter(Boolean);
        const offStaffNames = offDaysRows.filter(row => normalizeDate(row.get('off_date')) === date).map(row => row.get('name'));
        const workingStaffNames = allStaffNames.filter(name => !offStaffNames.includes(name));

        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        const walkinsSheet = doc.sheetsByTitle['Walkins'];
        if (!webBookingsSheet || !walkinsSheet) throw new Error("Sheets 'WebBookings' or 'Walkins' not found!");
        const webBookingsRows = await webBookingsSheet.getRows();
        const walkinsRows = await walkinsSheet.getRows();
        const allBookingsOnDate = [...webBookingsRows, ...walkinsRows].filter(row => normalizeDate(row.get('booking_date')) === date);

        const availabilityResult = workingStaffNames.map(staffName => {
            const staffBookings = allBookingsOnDate.filter(b => b.get('name') === staffName);
            let isAvailable = true;
            let nextAvailableTime = null;

            for (const booking of staffBookings) {
                const existingStart = new Date(`${date}T${booking.get('start_time')}`);
                const existingEnd = new Date(`${date}T${booking.get('end_time')}`);
                
                // Kiểm tra xung đột
                if (newBookingStart < existingEnd && newBookingEnd > existingStart) {
                    isAvailable = false;
                    const nextTime = new Date(existingEnd.getTime() + 1 * 60000); // Thêm 1 phút nghỉ
                    nextAvailableTime = `${('0' + nextTime.getHours()).slice(-2)}:${('0' + nextTime.getMinutes()).slice(-2)}`;
                    break; 
                }
            }

            return {
                name: staffName,
                is_available: isAvailable,
                next_available_time: nextAvailableTime,
            };
        });

        res.json({ staff_availability: availabilityResult });
    } catch (error) {
        console.error('Error in /api/staff-availability:', error);
        res.status(500).json({ error: 'An internal server error occurred.', details: error.message });
    }
});


// API 2: Ghi nhận booking mới (Giữ nguyên logic chống trùng lịch)
app.post('/api/bookings', async (req, res) => {
    // ... (logic này đã đúng, giữ nguyên)
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
