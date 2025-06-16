// ===== BỘ NÃO CỦA HỆ THỐNG KIỂM TRA TRẠNG THÁI =====
// server.js

const express = require('express');
const cors = require('cors'); // Thêm thư viện CORS
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(cors()); // Cho phép truy cập từ tên miền khác
app.use(express.json()); // Cho phép API nhận dữ liệu dạng JSON

const PORT = process.env.PORT || 3000;

// Lấy thông tin credentials từ biến môi trường của Render
const creds = {
  client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};
const sheetId = process.env.GOOGLE_SHEET_ID; // ID của file MassageBooking

// Hàm helper để truy cập Google Sheet
async function accessSpreadsheet() {
  const doc = new GoogleSpreadsheet(sheetId);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc;
}

// === API 1: Lấy trạng thái nhân viên ===
app.get('/api/staff-availability', async (req, res) => {
  try {
    const { date } = req.query; // Ví dụ: ?date=2025-06-16

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Missing or invalid date parameter. Format: YYYY-MM-DD' });
    }

    const doc = await accessSpreadsheet();

    // -- BƯỚC 1: Lấy danh sách toàn bộ nhân viên từ sheet OffDays --
    const offDaysSheet = doc.sheetsByTitle['OffDays'];
    const offDaysRows = await offDaysSheet.getRows();
    const allStaffNames = [...new Set(offDaysRows.map(row => row.name))]; // Lấy tên duy nhất

    // -- BƯỚC 2: Lọc ra những nhân viên nghỉ trong ngày được yêu cầu --
    const offStaffNames = offDaysRows
      .filter(row => row.off_date === date)
      .map(row => row.name);

    const workingStaffNames = allStaffNames.filter(name => !offStaffNames.includes(name));
    
    // -- BƯỚC 3: Lấy toàn bộ lịch làm việc trong ngày từ cả 2 nguồn --
    const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
    const walkinsSheet = doc.sheetsByTitle['Walkins'];
    const webBookingsRows = await webBookingsSheet.getRows();
    const walkinsRows = await walkinsSheet.getRows();

    const todayWebBookings = webBookingsRows.filter(row => row.booking_date === date);
    const todayWalkins = walkinsRows.filter(row => row.booking_date === date);
    const allTodayBookings = [...todayWebBookings, ...todayWalkins];

    // -- BƯỚC 4: Tính toán trạng thái cho từng nhân viên --
    const now = new Date();

    const availabilityResult = workingStaffNames.map(staffName => {
      const staffBookings = allTodayBookings
        .filter(b => b.name === staffName)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      // Tìm thời điểm kết thúc công việc cuối cùng trong ngày
      let lastBusyTime = null;
      if (staffBookings.length > 0) {
        const lastBooking = staffBookings[staffBookings.length - 1];
        const [endHour, endMinute] = lastBooking.end_time.split(':');
        lastBusyTime = new Date(`${date}T${endHour}:${endMinute}:00`);
      }

      // Chỉ xem xét là bận nếu thời gian bận rộn cuối cùng là trong tương lai
      if (lastBusyTime && lastBusyTime > now) {
        const waitTimeMinutes = Math.round((lastBusyTime - now) / (1000 * 60));
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
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});


// === API 2: Ghi nhận booking mới từ Website vào sheet WebBookings ===
app.post('/api/bookings', async (req, res) => {
    try {
        const { fullName, bookingDateTime, service, preferredStaff } = req.body;

        if (!fullName || !bookingDateTime || !service) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields.' });
        }
        
        // Tách ngày và giờ
        const bookingDate = bookingDateTime.split('T')[0]; // YYYY-MM-DD
        const startTime = bookingDateTime.split('T')[1]; // HH:MM

        // Tách tên dịch vụ và thời lượng
        // Ví dụ: "Foot Massage - 60 mins ($25)" -> serviceName: "Foot Massage", duration: 60
        const serviceMatch = service.match(/(.+) - (\d+) mins/);
        let serviceName = service;
        let duration = 0; // Mặc định
        if (serviceMatch && serviceMatch.length >= 3) {
            serviceName = serviceMatch[1].trim();
            duration = parseInt(serviceMatch[2], 10);
        }

        // Tính toán thời gian kết thúc
        const start = new Date(bookingDateTime);
        const end = new Date(start.getTime() + duration * 60000);
        const endTime = `${('0' + end.getHours()).slice(-2)}:${('0' + end.getMinutes()).slice(-2)}`;

        // Ghi vào Google Sheet
        const doc = await accessSpreadsheet();
        const webBookingsSheet = doc.sheetsByTitle['WebBookings'];
        await webBookingsSheet.addRow({
            name: preferredStaff, // Ghi tên nhân viên được chọn
            service_name: serviceName,
            service_duration: duration,
            booking_date: bookingDate,
            start_time: startTime,
            end_time: endTime,
            // Thêm các cột khác nếu cần, ví dụ customer_name
        });

        res.json({ status: 'success', message: 'Booking saved to WebBookings sheet.' });

    } catch (error) {
        console.error('Error in /api/bookings:', error);
        res.status(500).json({ status: 'error', message: 'Failed to save booking.' });
    }
});


// Khởi động server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
