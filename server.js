// ===== BỘ NÃO CỦA HỆ THỐNG - PHIÊN BẢN LOGIC CUỐI CÙNG =====
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
    if (trimmedDate.includes('-')) {
        return trimmedDate;
    }
    if (trimmedDate.includes('/')) {
        const parts = trimmedDate.split('/');
        if (parts.length === 3) {
            const [day, month, year] = parts;
            const fullYear = year.length === 2 ? '20' + year : year;
            return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
    }
    return trimmedDate;
}

// === API 1: Lấy trạng thái nhân viên (LOGIC ĐÃ VIẾT LẠI HOÀN TOÀN) ===
app.get('/api/staff-availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: `Invalid date parameter. Format: YYYY-MM-DD` });
    }

    const doc = await accessSpreadsheet();
    
    // Lấy danh sách nhân viên và lịch nghỉ
    const offDaysSheet = doc.sheetsByTitle['OffDays'];
    if (!offDaysSheet) throw new Error("Sheet 'OffDays' not found!");
    const offDaysRows = await offDaysSheet.getRows();
    const allStaffNames = [...new Set(offDaysRows.map(row => row.get('name')))].filter(Boolean);
    const offStaffNames = offDaysRows
      .filter(row => normalizeDate(row.get('off_date')) === date)
      .map(row => row.get('name'));
    const workingStaffNames = allStaffNames.filter(name => !offStaffNames.includes(name));
    
    // Lấy toàn bộ lịch làm việc trong ngày
    const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
    const walkinsSheet = doc.sheetsByTitle['Walkins'];
    if (!webBookingsSheet || !walkinsSheet) throw new Error("Sheets 'WebBookings' or 'Walkins' not found!");
    const webBookingsRows = await webBookingsSheet.getRows();
    const walkinsRows = await walkinsSheet.getRows();
    const todayBookingsRaw = [...webBookingsRows, ...walkinsRows];
    const allTodayBookings = todayBookingsRaw.filter(row => normalizeDate(row.get('booking_date')) === date);

    // Lấy thời gian hiện tại theo múi giờ Việt Nam
    const nowInVietnam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const todayDateStr = nowInVietnam.getFullYear() + '-' + ('0' + (nowInVietnam.getMonth() + 1)).slice(-2) + '-' + ('0' + nowInVietnam.getDate()).slice(-2);
    const isToday = (date === todayDateStr);

    const availabilityResult = workingStaffNames.map(staffName => {
      const staffBookings = allTodayBookings.filter(b => b.get('name') === staffName);
      
      let currentStatus = 'Available';
      let waitTimeMinutes = 0;

      // Chỉ tính toán trạng thái "Bận" nếu xem lịch của ngày hôm nay
      if (isToday) {
        for (const booking of staffBookings) {
          const startTimeStr = booking.get('start_time');
          const endTimeStr = booking.get('end_time');

          if (startTimeStr && endTimeStr) {
            const startTime = new Date(`${date}T${startTimeStr}:00`);
            const endTime = new Date(`${date}T${endTimeStr}:00`);

            // Kiểm tra xem nhân viên có đang bận "ngay bây giờ" không
            if (nowInVietnam >= startTime && nowInVietnam < endTime) {
              currentStatus = 'Busy';
              waitTimeMinutes = Math.round((endTime - nowInVietnam) / (1000 * 60));
              waitTimeMinutes = waitTimeMinutes > 0 ? waitTimeMinutes : 0;
              break; // Tìm thấy lịch bận hiện tại, không cần tìm nữa
            }
          }
        }
      }
      
      return {
        name: staffName,
        status: currentStatus,
        wait_time_minutes: waitTimeMinutes,
      };
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
