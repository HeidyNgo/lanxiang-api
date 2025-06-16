// ===== BỘ NÃO CỦA HỆ THỐNG - PHIÊN BẢN SỬA LỖI CUỐI CÙNG =====
// server.js

const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Cấu hình xác thực với Google Service Account
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

// === API 1: Lấy trạng thái nhân viên ===
app.get('/api/staff-availability', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Missing or invalid date parameter. Format: YYYY-MM-DD' });
    }

    const doc = await accessSpreadsheet();
    
    // -- BƯỚC 1: Lấy danh sách toàn bộ nhân viên từ sheet OffDays --
    const offDaysSheet = doc.sheetsByTitle['OffDays'];
    if (!offDaysSheet) throw new Error("Sheet 'OffDays' not found!");
    const offDaysRows = await offDaysSheet.getRows();
    const allStaffNames = [...new Set(offDaysRows.map(row => row.get('name')))].filter(Boolean); // Lọc ra tên duy nhất và loại bỏ giá trị rỗng

    // -- BƯỚC 2: Lọc ra những nhân viên nghỉ trong ngày được yêu cầu --
    const offStaffNames = offDaysRows
      .filter(row => row.get('off_date') === date)
      .map(row => row.get('name'));

    const workingStaffNames = allStaffNames.filter(name => !offStaffNames.includes(name));
    
    // -- BƯỚC 3: Lấy toàn bộ lịch làm việc trong ngày từ cả 2 nguồn --
    const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
    const walkinsSheet = doc.sheetsByTitle['Walkins'];
    if (!webBookingsSheet) throw new Error("Sheet 'WebBookings' not found!");
    if (!walkinsSheet) throw new Error("Sheet 'Walkins' not found!");

    const webBookingsRows = await webBookingsSheet.getRows();
    const walkinsRows = await walkinsSheet.getRows();

    const todayWebBookings = webBookingsRows.filter(row => row.get('booking_date') === date);
    const todayWalkins = walkinsRows.filter(row => row.get('booking_date') === date);
    const allTodayBookings = [...todayWebBookings, ...todayWalkins];

    // -- BƯỚC 4: Tính toán trạng thái cho từng nhân viên --
    // Lấy múi giờ Singapore/VN
    const timeZone = 'Asia/Ho_Chi_Minh';
    const now = new Date(new Date().toLocaleString('en-US', { timeZone }));

    // Kiểm tra xem ngày yêu cầu có phải là hôm nay không
    const todayDateStr = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    const isToday = (date === todayDateStr);

    const availabilityResult = workingStaffNames.map(staffName => {
      const staffBookings = allTodayBookings
        .filter(b => b.get('name') === staffName)
        .sort((a, b) => a.get('start_time').localeCompare(b.get('start_time')));

      let lastBusyTime = null;
      if (staffBookings.length > 0) {
        const lastBooking = staffBookings[staffBookings.length - 1];
        const endTimeString = lastBooking.get('end_time');
        if(endTimeString) {
            const [endHour, endMinute] = endTimeString.split(':');
            lastBusyTime = new Date(`${date}T${endHour}:${endMinute}:00`);
        }
      }

      // Chỉ tính thời gian chờ nếu là ngày hôm nay và nhân viên còn bận trong tương lai
      if (isToday && lastBusyTime && lastBusyTime > now) {
        const waitTimeMinutes = Math.round((lastBusyTime - now) / (1000 * 60));
        return {
          name: staffName,
          status: 'Busy',
          wait_time_minutes: waitTimeMinutes > 0 ? waitTimeMinutes : 0,
        };
      } else {
        // Nếu là ngày tương lai, hoặc đã hết lịch cho hôm nay, thì coi là rảnh (cho việc đặt lịch mới)
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


// === API 2: Ghi nhận booking mới từ Website vào sheet WebBookings ===
app.post('/api/bookings', async (req, res) => {
    try {
        const { fullName, bookingDateTime, service, preferredStaff } = req.body;

        if (!bookingDateTime || !service) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields.' });
        }
        
        const bookingDate = bookingDateTime.split('T')[0];
        const startTime = bookingDateTime.split('T')[1];

        const serviceMatch = service.match(/- (\d+) mins/);
        let duration = 60; 
        if (serviceMatch && serviceMatch[1]) {
            duration = parseInt(serviceMatch[1], 10);
        }

        const start = new Date(bookingDateTime);
        const end = new Date(start.getTime() + duration * 60000);
        const endTime = `${('0' + end.getHours()).slice(-2)}:${('0' + end.getMinutes()).slice(-2)}`;

        const doc = await accessSpreadsheet();
        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        if (!webBookingsSheet) throw new Error("Sheet 'WebBookings' not found!");
        
        await webBookingsSheet.addRow({
            name: preferredStaff || 'Any',
            service_name: service,
            service_duration: duration,
            booking_date: bookingDate,
            start_time: startTime,
            end_time: endTime,
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
