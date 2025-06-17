document.addEventListener('DOMContentLoaded', function() {
    // --- Lấy các phần tử từ DOM ---
    const bookingForm = document.getElementById('bookingForm');
    const submitButton = document.getElementById('submitButton');
    const submitBtnText = document.getElementById('submitBtnText');
    const errorMessageDiv = document.getElementById('errorMessage');
    const successMessageDiv = document.getElementById('successMessage');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const phoneInput = document.getElementById('phone');
    const phoneValidation = document.getElementById('phoneValidation');
    const bookingDateField = document.getElementById('bookingDateTime');
    const serviceField = document.getElementById('service');
    const staffContainer = document.getElementById('staff-availability-container');
    const staffListEl = document.getElementById('staff-list');
    const staffLoading = document.getElementById('staff-loading');
    const endTimeDisplay = document.getElementById('end-time-display');
    const fullNameInput = document.getElementById('fullName');
    const masseuseInput = document.getElementById('masseuse');

    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // --- Thiết lập giới hạn ngày giờ ---
    function setDateTimeLimits() {
        const now = new Date();
        const minDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        bookingDateField.min = minDate.toISOString().slice(0, 16);
        const maxDate = new Date(now);
        maxDate.setDate(now.getDate() + 10);
        const maxDateLocal = new Date(maxDate.getTime() - maxDate.getTimezoneOffset() * 60000);
        bookingDateField.max = maxDateLocal.toISOString().slice(0, 16);
    }
    setDateTimeLimits();

    // --- Gán sự kiện cho các ô input ---
    fullNameInput.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
    phoneInput.addEventListener('input', function() {
        phoneValidation.style.display = /^[0-9]{8,15}$/.test(this.value) ? 'none' : 'block';
    });
    bookingDateField.addEventListener('input', fetchStaffAvailability);
    serviceField.addEventListener('change', fetchStaffAvailability);

    // --- HÀM GỌI API ĐỂ LẤY DANH SÁCH NHÂN VIÊN (gọi vào server.js) ---
    async function fetchStaffAvailability() {
        const dateTimeValue = bookingDateField.value;
        const serviceValue = serviceField.value;

        if (!dateTimeValue || !serviceValue) {
            staffContainer.style.display = 'none';
            endTimeDisplay.textContent = '--:--';
            return;
        }

        staffContainer.style.display = 'block';
        staffListEl.innerHTML = '';
        staffLoading.style.display = 'block';
        staffLoading.innerHTML = '<p>Loading staff list...</p><p lang="zh-CN">正在加载员工列表...</p>';

        try {
            // Chuẩn bị các tham số cho API của server.js
            const isoDate = new Date(dateTimeValue);
            const date = isoDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
            const startTime = `${('0' + isoDate.getHours()).slice(-2)}:${('0' + isoDate.getMinutes()).slice(-2)}`;
            
            // Lấy duration từ tên dịch vụ
            const durationMatch = serviceField.options[serviceField.selectedIndex].text.match(/(\d+)\s*mins/);
            if (!durationMatch) throw new Error("Could not determine service duration.");
            const duration = durationMatch[1];
            
            // Cập nhật giờ kết thúc dự kiến trên UI
            const endDate = new Date(isoDate.getTime() + parseInt(duration) * 60000);
            endTimeDisplay.textContent = `${('0' + endDate.getHours()).slice(-2)}:${('0' + endDate.getMinutes()).slice(-2)}`;

            // Xây dựng URL để gọi vào API của chính bạn trên Render
            const params = new URLSearchParams({ date, startTime, duration });
            // Đường dẫn tương đối sẽ tự động gọi đến server của bạn
            const requestUrl = `/api/staff-availability?${params.toString()}`;

            const response = await fetch(requestUrl);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.details || result.error || 'Unknown server error');
            }
            
            displayStaff(result.staff_availability);

        } catch (error) {
            console.error('Error fetching staff availability:', error);
            staffLoading.style.display = 'block';
            staffListEl.innerHTML = '';
            staffLoading.innerHTML = `<p style="color:red;">Could not load staff list. Error: ${error.message}</p>`;
        }
    }

    // --- HÀM HIỂN THỊ DANH SÁCH NHÂN VIÊN ---
    function displayStaff(staffData) {
        staffLoading.style.display = 'none';
        staffListEl.innerHTML = ''; 

        let noPreferenceItem = document.createElement('li');
        noPreferenceItem.className = 'staff-item';
        noPreferenceItem.innerHTML = `
            <input type="radio" id="staff-any" name="staffChoice" value="Any" checked>
            <label for="staff-any" class="staff-name">No Preference / <span lang="zh-CN">随便</span></label>`;
        staffListEl.appendChild(noPreferenceItem);

        if (!Array.isArray(staffData) || staffData.length === 0) {
            staffListEl.innerHTML += '<li>No staff available at this time.</li>';
            return;
        }
        
        staffData.forEach(staff => {
            const listItem = document.createElement('li');
            listItem.className = 'staff-item';
            const isDisabled = !staff.is_available;
            const statusClass = isDisabled ? 'status-busy' : 'status-available';
            let statusText = 'Available / <span lang="zh-CN">空闲</span>';
            if (isDisabled) {
                statusText = staff.next_available_time 
                    ? `Busy until ${staff.next_available_time} / <span lang="zh-CN">忙碌直到 ${staff.next_available_time}</span>`
                    : 'OFF / <span lang="zh-CN">休息</span>';
            }
            
            const uniqueId = `staff-${staff.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
            listItem.innerHTML = `
                <input type="radio" id="${uniqueId}" name="staffChoice" value="${staff.name}" ${isDisabled ? 'disabled' : ''}>
                <label for="${uniqueId}" class="staff-name">${staff.name}</label>
                <span class="staff-status ${statusClass}">${statusText}</span>`;
            
            if (!isDisabled) {
                listItem.addEventListener('click', () => { document.getElementById(uniqueId).checked = true; });
            }
            staffListEl.appendChild(listItem);
        });
    }
    
    // --- XỬ LÝ SUBMIT FORM (Vẫn gửi đến Apps Script vì server.js chưa có API này) ---
    bookingForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // --- Validation ---
        if (!/^[0-9]{8,15}$/.test(phoneInput.value)) { phoneValidation.style.display = 'block'; return; }
        // (các validation khác giữ nguyên)

        submitButton.disabled = true;
        loadingSpinner.style.display = 'inline-block';
        submitBtnText.innerHTML = 'Sending... / <span lang="zh-CN">正在发送...</span>';

        const selectedStaffRadio = document.querySelector('input[name="staffChoice"]:checked');
        const preferredStaffName = selectedStaffRadio ? selectedStaffRadio.value : 'Any';
        const isoDate = new Date(bookingDateField.value);
        const bookingTimeForBackend = `${('0' + isoDate.getHours()).slice(-2)}:${('0' + isoDate.getMinutes()).slice(-2)} ${('0' + isoDate.getDate()).slice(-2)}/${('0' + (isoDate.getMonth() + 1)).slice(-2)}/${isoDate.getFullYear()}`;
        const serviceNameForBackend = serviceField.options[serviceField.selectedIndex].text.split('(')[0].trim();
        
        const formData = new FormData();
        formData.append('FullName', fullNameInput.value);
        formData.append('BookingDateTime', bookingTimeForBackend);
        formData.append('Service', serviceNameForBackend);
        formData.append('PreferredStaff', preferredStaffName);
        formData.append('PhoneNumber', phoneInput.value);
        formData.append('timezone', userTimeZone);

        // Vẫn dùng link của Apps Script cho việc POST booking
        fetch(bookingForm.action, { method: 'POST', body: formData })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    // ... (hiển thị thông báo thành công)
                } else {
                    alert('Error: ' + data.message);
                }
            })
            .catch(error => { console.error('Error:', error); alert('An error occurred.'); })
            .finally(() => {
                submitButton.disabled = false;
                loadingSpinner.style.display = 'none';
                submitBtnText.innerHTML = 'Send Booking Request / <span lang="zh-CN">发送预约请求</span>';
            });
    });
});
