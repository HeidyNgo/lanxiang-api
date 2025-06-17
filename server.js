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
    if (trimmedDate.match(/^\d{4}-\d{2}-\d{2}$/)) { 
        return trimmedDate;
    }
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

// API 1: Lấy trạng thái nhân viên (LOGIC ĐÚNG)
app.get('/api/staff-availability', async (req, res) => {
    try {
        const { date } = req.query; 
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ error: `Invalid date parameter. Format: yyyy-mm-dd` });
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
        const todayBookingsRaw = [...webBookingsRows, ...walkinsRows];
        const allTodayBookings = todayBookingsRaw.filter(row => normalizeDate(row.get('booking_date')) === date);

        const nowInVietnam = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const todayDateStr = nowInVietnam.getFullYear() + '-' + ('0' + (nowInVietnam.getMonth() + 1)).slice(-2) + '-' + ('0' + nowInVietnam.getDate()).slice(-2);
        const isToday = (date === todayDateStr);

        const availabilityResult = workingStaffNames.map(staffName => {
          const staffBookings = allTodayBookings.filter(b => b.get('name') === staffName);
          let currentStatus = 'Available';
          let waitTimeMinutes = 0;

          if (isToday) {
            for (const booking of staffBookings) {
              const startTimeStr = booking.get('start_time');
              const endTimeStr = booking.get('end_time');
              if (startTimeStr && endTimeStr) {
                const startTime = new Date(`${date}T${startTimeStr}:00`);
                const endTime = new Date(`${date}T${endTimeStr}:00`);
                if (nowInVietnam >= startTime && nowInVietnam < endTime) {
                  currentStatus = 'Busy';
                  waitTimeMinutes = Math.round((endTime - nowInVietnam) / (1000 * 60));
                  waitTimeMinutes = waitTimeMinutes > 0 ? waitTimeMinutes : 0;
                  break;
                }
              }
            }
          }
          return { name: staffName, status: currentStatus, wait_time_minutes: waitTimeMinutes };
        });

        res.json({ staff_availability: availabilityResult });
    } catch (error) {
        console.error('Error in /api/staff-availability:', error);
        res.status(500).json({ error: 'An internal server error occurred.', details: error.message });
    }
});


// API 2: Ghi nhận booking mới & CHỐNG TRÙNG LỊCH & Gọi Apps Script Cũ
app.post('/api/bookings', async (req, res) => {
    try {
        const { fullName, bookingDateTime, service, preferredStaff, phoneNumber } = req.body;

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
        if (preferredStaff !== 'Any') { // Chỉ kiểm tra trùng lịch nếu khách chọn một nhân viên cụ thể
            for (const booking of staffBookingsOnDate) {
                const existingStartTimeStr = booking.get('start_time');
                const existingEndTimeStr = booking.get('end_time');
                if (existingStartTimeStr && existingEndTimeStr) {
                    const existingStartTime = new Date(`${bookingDate}T${existingStartTimeStr}`);
                    const existingEndTime = new Date(`${bookingDate}T${existingEndTimeStr}`);
                    if (newStartTime < existingEndTime && newEndTime > existingStartTime) {
                        isConflict = true;
                        break;
                    }
                }
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
        
        // Gọi đến Apps Script cũ
        if (OLD_APPS_SCRIPT_URL) {
            const formDataForOldScript = new URLSearchParams();
            formDataForOldScript.append('FullName', fullName);
            formDataForOldScript.append('BookingDateTime', bookingDateTime);
            formDataForOldScript.append('Service', service);
            formDataForOldScript.append('PreferredStaff', preferredStaff);
            formDataForOldScript.append('PhoneNumber', phoneNumber);
            
            fetch(OLD_APPS_SCRIPT_URL, {
                method: 'POST',
                body: formDataForOldScript,
            }).catch(err => console.error("Failed to forward to old Apps Script:", err));
        }

        res.json({ status: 'success', message: 'Booking processed successfully.' });

    } catch (error) {
        console.error('Error in /api/bookings:', error);
        res.status(500).json({ status: 'error', message: 'Failed to save booking.', details: error.message });
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// ===== END OF FILE - Gemini Final Version =====
