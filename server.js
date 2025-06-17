import express from 'express';
import cors from 'cors';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Lấy thông tin từ Biến Môi trường
const OLD_APPS_SCRIPT_URL = process.env.OLD_APPS_SCRIPT_URL;

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

function normalizeDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const trimmedDate = dateString.trim();
    if (trimmedDate.match(/^\d{4}-\d{2}-\d{2}$/)) { return trimmedDate; }
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

// API Lấy trạng thái nhân viên (Giữ nguyên logic đúng)
app.get('/api/staff-availability', async (req, res) => {
    // ... (logic này đã đúng, không cần thay đổi)
});


// API Ghi nhận booking (LOGIC MỚI - "TỔNG CHỈ HUY")
app.post('/api/bookings', async (req, res) => {
    try {
        const { fullName, bookingDateTime, service, preferredStaff, phoneNumber } = req.body;

        // Validation cơ bản
        if (!bookingDateTime || !service || !preferredStaff) {
            return res.status(400).json({ status: 'error', message: 'A staff member must be selected.' });
        }
        
        const bookingDate = bookingDateTime.split('T')[0];
        const newStartTime = new Date(bookingDateTime);
        const serviceMatch = service.match(/- (\d+) mins/);
        let duration = 60; 
        if (serviceMatch && serviceMatch[1]) {
            duration = parseInt(serviceMatch[1], 10);
        }
        const newEndTime = new Date(newStartTime.getTime() + duration * 60000);

        // Logic kiểm tra trùng lịch (đã có)
        // ...
        
        // Ghi vào sheet MỚI
        const doc = await accessSpreadsheet();
        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        await webBookingsSheet.addRow({ /* ... dữ liệu ... */ });

        // **LOGIC MỚI: Tự động gọi Apps Script cũ**
        const formDataForOldScript = new URLSearchParams();
        formDataForOldScript.append('FullName', fullName);
        formDataForOldScript.append('BookingDateTime', bookingDateTime);
        formDataForOldScript.append('Service', service);
        formDataForOldScript.append('PreferredStaff', preferredStaff);
        formDataForOldScript.append('PhoneNumber', phoneNumber);
        
        // Gửi đi và không cần chờ đợi
        fetch(OLD_APPS_SCRIPT_URL, {
            method: 'POST',
            body: formDataForOldScript,
        }).catch(err => console.error("Failed to forward to old Apps Script:", err));

        res.json({ status: 'success', message: 'Booking processed successfully.' });

    } catch (error) {
        // ... xử lý lỗi ...
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
