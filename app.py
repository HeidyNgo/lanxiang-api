from collections import defaultdict
import os
import io
from flask import Flask, request, jsonify, render_template, Response, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from urllib.parse import quote
import google.generativeai as genai
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

# --- CẤU HÌNH ---
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
DATABASE_URL = os.getenv('DATABASE_URL')
genai.configure(api_key=GEMINI_API_KEY)

# --- KHỞI TẠO ỨNG DỤNG VÀ DATABASE ---
app = Flask(__name__)
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- MODEL ---
class Record(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    patient_name = db.Column(db.String(150), nullable=False)
    symptoms = db.Column(db.Text, nullable=False)
    treatment = db.Column(db.Text, nullable=False)
    ai_report = db.Column(db.Text, nullable=False)

with app.app_context():
    db.create_all()

# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate_tcm_report', methods=['POST'])
def generate_report():
    data = request.get_json()
    patient_name = data.get("Patient Name", "").title()
    time_reason = data.get("Time and Reason")
    symptoms = data.get("Symptoms")
    treatment_method = data.get("Treatment Method")
    session_num = data.get("Current Treatment Session Number")
    total_sessions = data.get("Planned Total Sessions")
    consultation_date = datetime.now().strftime("%B %d, %Y")

    prompt = f"""
    You are a medical assistant at a Traditional Chinese Medicine (TCM) clinic...
    **Patient Name:** {patient_name}
    **Symptoms:** {symptoms}
    **Treatment This Session:** {treatment_method}
    **Session:** {session_num} / {total_sessions}
    **Date of Consultation:** {consultation_date}
    ...
    """

    try:
        model = genai.GenerativeModel('gemini-1.5-flash-latest')
        response = model.generate_content(prompt)
        ai_response = response.text

        new_record = Record(
            patient_name=patient_name,
            symptoms=symptoms,
            treatment=treatment_method,
            ai_report=ai_response
        )
        db.session.add(new_record)
        db.session.commit()
        return jsonify({"ai_generated_report": ai_response.strip()})

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@app.route('/history')
def history():
    all_records = db.session.execute(db.select(Record).order_by(Record.created_at.desc())).scalars().all()
    grouped_records = defaultdict(list)
    for record in all_records:
        date_key = record.created_at.strftime('%Y-%m-%d')
        grouped_records[date_key].append(record)
    return render_template('history.html', grouped_records=grouped_records)

@app.route('/download/<int:record_id>')
def download_record(record_id):
    record = db.get_or_404(Record, record_id)

    buffer = io.BytesIO()
    p = canvas.Canvas(buffer, pagesize=letter)
    text = p.beginText(50, 750)

    text.setFont("Helvetica", 12)
    lines = [
        f"HỒ SƠ BỆNH ÁN #{record.id}",
        "===============================",
        f"Tên bệnh nhân: {record.patient_name}",
        f"Ngày tạo: {record.created_at.strftime('%d/%m/%Y %H:%M:%S')}",
        "",
        "Triệu chứng đã khai:",
        record.symptoms,
        "",
        "Phương pháp điều trị:",
        record.treatment,
        "",
        "--------------------------------",
        "BÁO CÁO TỪ AI:",
        "--------------------------------",
        record.ai_report
    ]

    for line in lines:
        for l in line.split("\n"):
            text.textLine(l)

    p.drawText(text)
    p.showPage()
    p.save()

    buffer.seek(0)
    filename = f"{record.created_at.strftime('%Y-%m-%d')}_{record.id}_{record.patient_name.replace(' ', '_')}.pdf"
    encoded_filename = quote(filename)

    return Response(
        buffer,
        mimetype="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"}
    )

@app.route('/delete_record/<int:record_id>', methods=['POST'])
def delete_record(record_id):
    correct_password = "1234"
    submitted_password = request.form.get('password')
    if submitted_password != correct_password:
        return "Mật khẩu không đúng. Không thể xóa hồ sơ.", 403

    record = db.get_or_404(Record, record_id)
    try:
        db.session.delete(record)
        db.session.commit()
        return redirect(url_for('history'))
    except Exception as e:
        db.session.rollback()
        return "Có lỗi xảy ra khi xóa hồ sơ.", 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)
