import express from 'express';
import cors from 'cors';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { zonedTimeToUtc, format } from 'date-fns-tz';

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

app.get('/api/staff-availability', async (req, res) => {
    try {
        const { date, startTime, serviceName } = req.query;
        if (!date || !startTime || !serviceName) {
            return res.status(400).json({ error: 'Date, startTime, and serviceName are required.' });
        }

        const businessTimeZone = 'Asia/Ho_Chi_Minh';
        const doc = await accessSpreadsheet();
        
        const servicesSheet = doc.sheetsByTitle['Services'];
        if (!servicesSheet) throw new Error("Sheet 'Services' not found!");
        const servicesRows = await servicesSheet.getRows();
        const serviceInfo = servicesRows.find(row => row.get('service_name') === serviceName);
        if (!serviceInfo) throw new Error(`Service "${serviceName}" not found.`);
        const duration = parseInt(serviceInfo.get('duration_minutes'));
        if (isNaN(duration)) throw new Error(`Invalid duration for service "${serviceName}".`);

        const newBookingStart = zonedTimeToUtc(`${date}T${startTime}`, businessTimeZone);
        const newBookingEnd = new Date(newBookingStart.getTime() + duration * 60000);

        const staffSheet = doc.sheetsByTitle['Staff'];
        const offDaysSheet = doc.sheetsByTitle['OffDays'];
        if (!staffSheet || !offDaysSheet) throw new Error("Sheets 'Staff' or 'OffDays' not found!");
        const staffRows = await staffSheet.getRows();
        const allStaffNames = staffRows.map(row => row.get('staff_name')).filter(Boolean);
        
        const offDaysRows = await offDaysSheet.getRows();
        const offStaffOnDate = offDaysRows
            .filter(row => normalizeDate(row.get('off_date')) === date)
            .map(row => row.get('name'));

        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        const walkinsSheet = doc.sheetsByTitle['Services Today']; // <-- ĐÃ SỬA TÊN
        if (!webBookingsSheet || !walkinsSheet) throw new Error("Sheets 'WebBookings' or 'Services Today' not found!");
        
        const webBookingsRows = await webBookingsSheet.getRows();
        const walkinsRows = await walkinsSheet.getRows();
        
        const bookingDateParts = date.split('-');
        const bookingDateForSheet = `${bookingDateParts[2]}/${bookingDateParts[1]}/${bookingDateParts[0]}`;

        // Kết hợp cả booking tương lai và booking trong ngày
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
                const existingStart = zonedTimeToUtc(`${date}T${booking.get('start_time')}`, businessTimeZone);
                const existingEnd = zonedTimeToUtc(`${date}T${booking.get('end_time')}`, businessTimeZone);
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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
