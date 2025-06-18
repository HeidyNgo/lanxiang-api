import express from 'express';
import cors from 'cors';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// KHÔNG CẦN IMPORT THƯ VIỆN BÊN NGOÀI NỮA

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

app.get('/', (req, res) => {
  res.redirect('/index1.html');
});

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

// =================================================================
// SỬA LỖI LỊCH TRÙNG BẰNG JAVASCRIPT NGUYÊN BẢN
// =================================================================
app.get('/api/staff-availability', async (req, res) => {
    try {
        const { date, startTime, serviceName } = req.query;
        if (!date || !startTime || !serviceName) {
            return res.status(400).json({ error: 'Date, startTime, and serviceName are required.' });
        }
        
        // Chỉ định rõ múi giờ GMT+7 của Việt Nam
        const TIMEZONE_OFFSET = '+07:00'; 
        const doc = await accessSpreadsheet();
        
        const servicesSheet = doc.sheetsByTitle['Services'];
        const servicesRows = await servicesSheet.getRows();
        const serviceInfo = servicesRows.find(row => row.get('service_name') === serviceName);
        if (!serviceInfo) throw new Error(`Service "${serviceName}" not found.`);
        const duration = parseInt(serviceInfo.get('duration_minutes'));
        if (isNaN(duration)) throw new Error(`Invalid duration for service "${serviceName}".`);
        
        // Tạo đối tượng Date với múi giờ chính xác
        const newBookingStart = new Date(`${date}T${startTime}:00.000${TIMEZONE_OFFSET}`);
        const newBookingEnd = new Date(newBookingStart.getTime() + duration * 60000);

        const staffSheet = doc.sheetsByTitle['Staff'];
        const allStaffNames = (await staffSheet.getRows()).map(row => row.get('staff_name')).filter(Boolean);
        
        const offDaysSheet = doc.sheetsByTitle['OffDays'];
        const offStaffOnDate = (await offDaysSheet.getRows())
            .filter(row => normalizeDate(row.get('off_date')) === date)
            .map(row => row.get('name'));

        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        const walkinsSheet = doc.sheetsByTitle['Walkins'];
        const webBookingsRows = await webBookingsSheet.getRows();
        const walkinsRows = await walkinsSheet.getRows();
        
        const bookingDateParts = date.split('-');
        const bookingDateForSheet = `${bookingDateParts[2]}/${bookingDateParts[1]}/${bookingDateParts[0]}`;

        const allBookingsOnDate = [...webBookingsRows, ...walkinsRows]
            .filter(row => row.get('booking_date') === bookingDateForSheet);

        const availabilityResult = allStaffNames.map(staffName => {
            if (offStaffOnDate.includes(staffName)) {
                return { name: staffName, is_available: false, next_available_time: null };
            }

            let isAvailable = true;
            let nextAvailableTime = null;

            const relevantBookings = allBookingsOnDate.filter(b => b.get('staff') === staffName || b.get('staff') === 'Any');

            for (const booking of relevantBookings) {
                // Tạo đối tượng Date cho các booking đã có với múi giờ chính xác
                const existingStart = new Date(`${date}T${booking.get('start_time')}:00.000${TIMEZONE_OFFSET}`);
                const existingEnd = new Date(`${date}T${booking.get('end_time')}:00.000${TIMEZONE_OFFSET}`);

                // So sánh chính xác
                if (newBookingStart < existingEnd && newBookingEnd > existingStart) {
                    isAvailable = false;
                    nextAvailableTime = booking.get('end_time');
                    break; 
                }
            }
            return { name: staffName, is_available: isAvailable, next_available_time: nextAvailableTime };
        });

        res.json({ staff_availability: availabilityResult });

    } catch (error) {
        console.error('Error in /api/staff-availability:', error);
        res.status(500).json({ error: 'An internal server error occurred.', details: error.message });
    }
});

// Các hàm khác giữ nguyên
app.post('/api/bookings', async (req, res) => {
    res.status(501).send('Not Implemented');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
