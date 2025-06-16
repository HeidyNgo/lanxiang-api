// ===== BỘ NÃO CỦA HỆ THỐNG - PHIÊN BẢN HOÀN CHỈNH, SỬA LỖI MÚI GIỜ & TRÙNG LỊCH =====
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

// Hàm mới: Tự động chuyển đổi các định dạng ngày khác nhau về YYYY-MM-DD
function normalizeDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const trimmedDate = dateString.trim();
    if (trimmedDate.includes('-')) { // Đã là định dạng YYYY-MM-DD
        return trimmedDate;
    }
    if (trimmedDate.includes('/')) { // Chuyển đổi từ DD/MM/YYYY
        const parts = trimmedDate.split('/');
        if (parts.length === 3) {
            const [day, month, year] = parts;
            // Đảm bảo năm là 4 chữ số
            const fullYear = year.length === 2 ? '20' + year : year;
            return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
    }
    return trimmedDate; // Trả về như cũ nếu không nhận diện được
}

// === API 1: Lấy trạng thái nhân viên ===
app.get('/api/staff-availability', async (req, res) => {
  try {
    const { date } = req.query; // date từ request luôn là YYYY-MM-DD
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: `Missing or invalid date parameter. Format: YYYY-MM-DD. Received: ${date}` });
    }

    const doc = await accessSpreadsheet();
    
    const offDaysSheet = doc.sheetsByTitle['OffDays'];
    if (!offDaysSheet) throw new Error("Sheet 'OffDays' not found!");
    const offDaysRows = await offDaysSheet.getRows();
    const allStaffNames = [...new Set(offDaysRows.map(row => row.get('name')))].filter(Boolean);

    const offStaffNames = offDaysRows
      .filter(row => normalizeDate(row.get('off_date')) === date)
      .map(row => row.get('name'));

    const workingStaffNames = allStaffNames.filter(name => !offStaffNames.includes(name));
    
    const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
    const walkinsSheet = doc.sheetsByTitle['Walkins'];
    if (!webBookingsSheet || !walkinsSheet) throw new Error("Sheets 'WebBookings' or 'Walkins' not found!");

    const webBookingsRows = await webBookingsSheet.getRows();
    const walkinsRows = await walkinsSheet.getRows();

    const todayWebBookings = webBookingsRows.filter(row => normalizeDate(row.get('booking_date')) === date);
    const todayWalkins = walkinsRows.filter(row => normalizeDate(row.get('booking_date')) === date);
    const allTodayBookings = [...todayWebBookings, ...todayWalkins];

    // Tính toán thời gian hiện tại theo múi giờ Việt Nam
    const now = new Date();
    const vietnamTimezoneOffset = 7 * 60 * 60 * 1000;
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const nowInVietnam = new Date(utc + vietnamTimezoneOffset);

    const todayDateStr = nowInVietnam.getFullYear() + '-' + ('0' + (nowInVietnam.getMonth() + 1)).slice(-2) + '-' + ('0' + nowInVietnam.getDate()).slice(-2);
    const isToday = (date === todayDateStr);

    const availabilityResult = workingStaffNames.map(staffName => {
      const staffBookings = allTodayBookings
        .filter(b => b.get('name') === staffName)
        .sort((a, b) => (a.get('start_time') || '').localeCompare(b.get('start_time') || ''));

      let lastBusyTime = null;
      if (staffBookings.length > 0) {
        const lastBooking = staffBookings[staffBookings.length - 1];
        const endTimeString = lastBooking.get('end_time');
        if(endTimeString) {
            const [endHour, endMinute] = endTimeString.split(':');
            lastBusyTime = new Date(`${date}T${endHour}:${endMinute}:00`);
        }
      }

      if (isToday && lastBusyTime && lastBusyTime > nowInVietnam) {
        const waitTimeMinutes = Math.round((lastBusyTime - nowInVietnam) / (1000 * 60));
        return {
          name: staffName,
          status: 'Busy',
          wait_time_minutes: waitTimeMinutes > 0 ? waitTimeMinutes : 0,
        };
      } else {
        return {
          name: staffName,
          status: 'Available',
          wait_time_minutes: 0,
        };
      }
    });

    res.json({ staff_availability: availabilityResult });

  } catch (error) {
    console.error('Error in /api/staff-availability:', error);
    res.status(500).json({ error: 'An internal server error occurred.', details: error.message });
  }
});

// === API 2: Ghi nhận booking mới & CHỐNG TRÙNG LỊCH ===
app.post('/api/bookings', async (req, res) => {
    try {
        const { bookingDateTime, service, preferredStaff } = req.body;

        if (!bookingDateTime || !service || !preferredStaff) {
            return res.status(400).json({ status: 'error', message: 'A staff member must be selected to check for conflicts.' });
        }
        
        const bookingDate = bookingDateTime.split('T')[0];
        const newStartTime = new Date(bookingDateTime);

        const serviceMatch = service.match(/- (\d+) mins/);
        let duration = 60; 
        if (serviceMatch && serviceMatch[1]) {
            duration = parseInt(serviceMatch[1], 10);
        }
        const newEndTime = new Date(newStartTime.getTime() + duration * 60000);

        const doc = await accessSpreadsheet();
        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        const walkinsSheet = doc.sheetsByTitle['Walkins'];
        if (!webBookingsSheet || !walkinsSheet) throw new Error("Booking sheets not found!");

        const webBookingsRows = await webBookingsSheet.getRows();
        const walkinsRows = await walkinsSheet.getRows();
        const allBookings = [...webBookingsRows, ...walkinsRows];

        const staffBookingsOnDate = allBookings.filter(row => 
            row.get('name') === preferredStaff && 
            normalizeDate(row.get('booking_date')) === bookingDate
        );

        let isConflict = false;
        for (const booking of staffBookingsOnDate) {
            const existingStartTime = new Date(`${normalizeDate(booking.get('booking_date'))}T${booking.get('start_time')}`);
            const existingEndTime = new Date(`${normalizeDate(booking.get('booking_date'))}T${booking.get('end_time')}`);

            if (newStartTime < existingEndTime && newEndTime > existingStartTime) {
                isConflict = true;
                break;
            }
        }

        if (isConflict) {
            return res.status(409).json({ status: 'error', message: 'This time slot is already booked for the selected staff.' });
        }
        
        const startTime = bookingDateTime.split('T')[1];
        const endTimeFormatted = `${('0' + newEndTime.getHours()).slice(-2)}:${('0' + newEndTime.getMinutes()).slice(-2)}`;
        
        await webBookingsSheet.addRow({
            name: preferredStaff,
            service_name: service,
            service_duration: duration,
            booking_date: bookingDate,
            start_time: startTime,
            end_time: endTimeFormatted,
        });

        res.json({ status: 'success', message: 'Booking saved to WebBookings sheet.' });

    } catch (error) {
        console.error('Error in /api/bookings:', error);
        res.status(500).json({ status: 'error', message: 'Failed to save booking.', details: error.message });
    }
});


// Khởi động server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Dòng cuối cùng của file.
