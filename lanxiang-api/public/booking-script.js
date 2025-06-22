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
    const dateErrorMessageDiv = document.getElementById('dateErrorMessage');

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


    // === HÀM KIỂM TRA NGÀY ĐÃ ĐƯỢC SỬA LẠI CHO ĐƠN GIẢN VÀ CHÍNH XÁC HƠN ===
    function validateBookingDate() {
        if (!bookingDateField.value) {
            dateErrorMessageDiv.style.display = 'none';
            return true;
        }
       
        if (bookingDateField.value > bookingDateField.max) {
            dateErrorMessageDiv.style.display = 'block';
            return false;
        } else {
            dateErrorMessageDiv.style.display = 'none';
            return true;
        }
    }


    // === HÀM XỬ LÝ CHUNG KHI NGÀY THAY ĐỔI ===
    function handleDateChange() {
        const isDateValid = validateBookingDate();
        if (isDateValid) {
            fetchStaffAvailability();
        } else {
            staffContainer.style.display = 'none';
            endTimeDisplay.textContent = '--:--';
        }
    }


    // --- Gán sự kiện cho các ô input ---
    fullNameInput.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
    phoneInput.addEventListener('input', function() {
        phoneValidation.style.display = /^[0-9]{8,15}$/.test(this.value) ? 'none' : 'block';
    });
    bookingDateField.addEventListener('input', handleDateChange);
    serviceField.addEventListener('change', fetchStaffAvailability);


    // === HÀM LẤY DANH SÁCH NHÂN VIÊN (GIỮ NGUYÊN) ===
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
            const isoDate = new Date(dateTimeValue);
            const date = isoDate.toISOString().split('T')[0];
            const startTime = `${('0' + isoDate.getHours()).slice(-2)}:${('0' + isoDate.getMinutes()).slice(-2)}`;
           
            const serviceName = serviceField.options[serviceField.selectedIndex].text.split('(')[0].trim();
           
            const params = new URLSearchParams({ date, startTime, serviceName });
            const requestUrl = `/api/staff-availability?${params.toString()}`;

            const response = await fetch(requestUrl);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.details || result.error || 'Unknown server error');
            }
           
            endTimeDisplay.textContent = '...'; 
           
            displayStaff(result.staff_availability);

        } catch (error) {
            console.error('Error fetching staff availability:', error);
            staffLoading.style.display = 'block';
            staffListEl.innerHTML = '';
            staffLoading.innerHTML = `<p style="color:red;">Could not load staff list. Error: ${error.message}</p>`;
        }
    }

    // --- HÀM HIỂN THỊ DANH SÁCH NHÂN VIÊN (GIỮ NGUYÊN) ---
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
   
    // --- XỬ LÝ SUBMIT FORM (GIỮ NGUYÊN) ---
    bookingForm.addEventListener('submit', function(e) {
        e.preventDefault();
       
        if (!validateBookingDate()) {
            return;
        }

        if (!/^[0-9]{8,15}$/.test(phoneInput.value)) { phoneValidation.style.display = 'block'; return; }

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

        fetch(bookingForm.action, { method: 'POST', body: formData })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    document.getElementById('confirm_name').textContent = fullNameInput.value;
                    document.getElementById('confirm_datetime').textContent = bookingDateField.value.replace('T', ' ');
                    document.getElementById('confirm_service').textContent = serviceField.options[serviceField.selectedIndex].text;
                    document.getElementById('confirm_phone').textContent = phoneInput.value;
                    document.getElementById('confirm_masseuse').textContent = preferredStaffName;
                   
                    bookingForm.style.display = 'none';
                    successMessageDiv.style.display = 'block';

                    bookingForm.reset();

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

    // ================================================================= //
    // ===== BẮT ĐẦU PHẦN MÃ MỚI: TỰ ĐỘNG CHỌN DỊCH VỤ TỪ URL ===== //
    // ================================================================= //
    function selectServiceFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const serviceToSelect = urlParams.get('service');

        if (serviceToSelect) {
            // Giải mã giá trị từ URL để xử lý các ký tự đặc biệt như '%20' (dấu cách)
            const decodedService = decodeURIComponent(serviceToSelect);
            
            // Kiểm tra xem có option nào trong dropdown có value trùng khớp không
            const optionExists = Array.from(serviceField.options).some(option => option.value === decodedService);

            if (optionExists) {
                // Nếu có, đặt giá trị cho dropdown
                serviceField.value = decodedService;

                // Tự động kích hoạt sự kiện 'change' để gọi API load danh sách nhân viên
                // Cần một khoảng trễ nhỏ để đảm bảo mọi thứ đã sẵn sàng
                setTimeout(() => {
                    serviceField.dispatchEvent(new Event('change'));
                }, 100);
            } else {
                console.warn(`Service value "${decodedService}" from URL not found in dropdown.`);
            }
        }
    }

    // Gọi hàm này ngay khi trang booking.html được tải
    selectServiceFromUrl();
});
