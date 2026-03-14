import csv
import io
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
jwt_secret = os.environ["JWT_SECRET"]

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

COLLEGE_ID = "shree-vedha"
DEFAULT_COLLEGE_NAME = "Shree Vedha College"
PHONE_REGEX = re.compile(r"^\+?\d{10,15}$")

app = FastAPI(title="Shree Vedha Attendance API")
api_router = APIRouter(prefix="/api")


class CollegeProfile(BaseModel):
    college_id: str
    college_name: str
    logo_base64: Optional[str] = ""
    updated_at: str


class CollegeProfileUpdate(BaseModel):
    college_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    logo_base64: Optional[str] = None


class UserPublic(BaseModel):
    user_id: str
    name: str
    phone_number: str
    role: Literal["admin", "student"]
    approved: bool
    semester_id: Optional[str] = None
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    message: str
    user: UserPublic


class SignUpInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone_number: str
    password: str = Field(min_length=6, max_length=80)
    role: Literal["admin", "student"]


class LoginInput(BaseModel):
    phone_number: str
    password: str = Field(min_length=6, max_length=80)


class ForgotPasswordAdminInput(BaseModel):
    phone_number: str
    new_password: str = Field(min_length=6, max_length=80)


class CreateAdminInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone_number: str
    password: str = Field(min_length=6, max_length=80)


class SemesterInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class SemesterOutput(BaseModel):
    semester_id: str
    name: str
    created_at: str


class SubjectInput(BaseModel):
    semester_id: str
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=1, max_length=30)


class SubjectOutput(BaseModel):
    subject_id: str
    semester_id: str
    name: str
    code: str
    created_at: str


class AssignSubjectsInput(BaseModel):
    student_id: str
    subject_ids: List[str]


class BulkAttendanceInput(BaseModel):
    subject_id: str
    date: str
    present_student_ids: List[str]


class AttendanceRecord(BaseModel):
    record_id: str
    subject_id: str
    subject_name: str
    student_id: str
    student_name: str
    date: str
    status: Literal["present", "absent"]
    marked_by: str
    created_at: str
    updated_at: Optional[str] = None


class SubjectPercent(BaseModel):
    subject_id: str
    subject_name: str
    present: int
    total: int
    percentage: float


class StudentInsight(BaseModel):
    semester_id: str
    semester_name: str
    student_id: str
    student_name: str
    subjects: List[SubjectPercent]


class AdminInsightsResponse(BaseModel):
    insights: List[StudentInsight]


class CsvImportInput(BaseModel):
    csv_text: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: str) -> str:
    return " ".join(value.strip().split())


def normalize_phone(value: str) -> str:
    phone = value.replace(" ", "").strip()
    if not PHONE_REGEX.match(phone):
        raise HTTPException(status_code=400, detail="Enter valid phone number")
    return phone


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_context.verify(password, hashed_password)


def create_token(user_id: str, role: str) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(hours=72)
    payload = {"sub": user_id, "role": role, "exp": expiry}
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def user_public_doc(user_doc: Dict) -> UserPublic:
    return UserPublic(
        user_id=user_doc["user_id"],
        name=user_doc["name"],
        phone_number=user_doc.get("phone_number", ""),
        role=user_doc["role"],
        approved=user_doc["approved"],
        semester_id=user_doc.get("semester_id"),
        created_at=user_doc["created_at"],
    )


async def fetch_user_by_id(user_id: str) -> Optional[Dict]:
    return await db.users.find_one({"user_id": user_id}, {"_id": 0})


async def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError as err:
        raise HTTPException(status_code=401, detail="Invalid token") from err

    user = await fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def admin_user(user: Dict = Depends(current_user)) -> Dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def approved_student_user(user: Dict = Depends(current_user)) -> Dict:
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student access required")
    if not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Approval pending")
    return user


async def ensure_college_profile() -> None:
    existing = await db.college_profile.find_one({"college_id": COLLEGE_ID}, {"_id": 0})
    if existing:
        return
    await db.college_profile.insert_one(
        {
            "college_id": COLLEGE_ID,
            "college_name": DEFAULT_COLLEGE_NAME,
            "logo_base64": "",
            "updated_at": utc_now_iso(),
        }
    )


def subject_code_from_name(name: str, index: int) -> str:
    initials = "".join([part[0] for part in name.split() if part]).upper()
    initials = initials[:4] if initials else "SUBJ"
    return f"{initials}{index:02d}"


@api_router.get("/")
async def root():
    return {"message": "Shree Vedha Attendance API running"}


@api_router.get("/college/profile", response_model=CollegeProfile)
async def get_college_profile():
    await ensure_college_profile()
    profile = await db.college_profile.find_one({"college_id": COLLEGE_ID}, {"_id": 0})
    return CollegeProfile(**profile)


@api_router.post("/auth/signup", response_model=AuthResponse)
async def signup(input_data: SignUpInput):
    phone = normalize_phone(input_data.phone_number)
    existing = await db.users.find_one({"phone_number": phone}, {"_id": 0, "user_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already registered")

    user_doc = {
        "user_id": str(uuid.uuid4()),
        "name": normalize_text(input_data.name),
        "phone_number": phone,
        "password_hash": hash_password(input_data.password),
        "role": input_data.role,
        "approved": input_data.role == "admin",
        "semester_id": None,
        "college_id": COLLEGE_ID,
        "created_at": utc_now_iso(),
    }
    await db.users.insert_one(user_doc.copy())

    token = create_token(user_doc["user_id"], user_doc["role"])
    message = "Account created" if user_doc["approved"] else "Signup done. Waiting for admin approval"
    return AuthResponse(access_token=token, message=message, user=user_public_doc(user_doc))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(input_data: LoginInput):
    phone = normalize_phone(input_data.phone_number)
    user = await db.users.find_one({"phone_number": phone}, {"_id": 0})
    if not user or not verify_password(input_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid phone or password")

    token = create_token(user["user_id"], user["role"])
    message = "Login successful" if user["approved"] else "Login successful. Approval pending"
    return AuthResponse(access_token=token, message=message, user=user_public_doc(user))


@api_router.post("/auth/forgot-password-admin")
async def forgot_password_admin(input_data: ForgotPasswordAdminInput):
    phone = normalize_phone(input_data.phone_number)
    result = await db.users.update_one(
        {"phone_number": phone, "role": "admin"},
        {"$set": {"password_hash": hash_password(input_data.new_password)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Admin not found")
    return {"message": "Admin password reset successful"}


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: Dict = Depends(current_user)):
    return user_public_doc(user)


@api_router.post("/admin/create-admin", response_model=UserPublic)
async def create_admin(input_data: CreateAdminInput, _: Dict = Depends(admin_user)):
    phone = normalize_phone(input_data.phone_number)
    existing = await db.users.find_one({"phone_number": phone}, {"_id": 0, "user_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already used")

    admin_doc = {
        "user_id": str(uuid.uuid4()),
        "name": normalize_text(input_data.name),
        "phone_number": phone,
        "password_hash": hash_password(input_data.password),
        "role": "admin",
        "approved": True,
        "semester_id": None,
        "college_id": COLLEGE_ID,
        "created_at": utc_now_iso(),
    }
    await db.users.insert_one(admin_doc.copy())
    return user_public_doc(admin_doc)


@api_router.patch("/admin/college-profile", response_model=CollegeProfile)
async def update_college_profile(input_data: CollegeProfileUpdate, _: Dict = Depends(admin_user)):
    await ensure_college_profile()
    update_doc = {}
    if input_data.college_name is not None:
        update_doc["college_name"] = normalize_text(input_data.college_name)
    if input_data.logo_base64 is not None:
        update_doc["logo_base64"] = input_data.logo_base64
    if not update_doc:
        raise HTTPException(status_code=400, detail="No changes provided")

    update_doc["updated_at"] = utc_now_iso()
    await db.college_profile.update_one({"college_id": COLLEGE_ID}, {"$set": update_doc})
    profile = await db.college_profile.find_one({"college_id": COLLEGE_ID}, {"_id": 0})
    return CollegeProfile(**profile)


@api_router.get("/admin/pending-students", response_model=List[UserPublic])
async def pending_students(_: Dict = Depends(admin_user)):
    students = await db.users.find(
        {"role": "student", "approved": False, "phone_number": {"$exists": True}},
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    return [user_public_doc(item) for item in students]


@api_router.post("/admin/approve-student/{student_id}")
async def approve_student(student_id: str, _: Dict = Depends(admin_user)):
    result = await db.users.update_one({"user_id": student_id, "role": "student"}, {"$set": {"approved": True}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"message": "Student approved"}


@api_router.get("/admin/students", response_model=List[UserPublic])
async def admin_students(_: Dict = Depends(admin_user)):
    students = await db.users.find(
        {"role": "student", "approved": True, "phone_number": {"$exists": True}},
        {"_id": 0, "password_hash": 0},
    ).to_list(2000)
    students.sort(key=lambda item: item["name"])
    return [user_public_doc(item) for item in students]


@api_router.post("/admin/semesters", response_model=SemesterOutput)
async def create_semester(input_data: SemesterInput, user: Dict = Depends(admin_user)):
    name = normalize_text(input_data.name)
    existing = await db.semesters.find_one({"name": name}, {"_id": 0, "semester_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="Semester already exists")

    doc = {
        "semester_id": str(uuid.uuid4()),
        "name": name,
        "created_by": user["user_id"],
        "created_at": utc_now_iso(),
    }
    await db.semesters.insert_one(doc.copy())
    return SemesterOutput(**{k: doc[k] for k in ["semester_id", "name", "created_at"]})


@api_router.get("/admin/semesters", response_model=List[SemesterOutput])
async def get_semesters(_: Dict = Depends(admin_user)):
    semesters = await db.semesters.find({}, {"_id": 0, "semester_id": 1, "name": 1, "created_at": 1}).to_list(1000)
    semesters.sort(key=lambda item: item["created_at"], reverse=True)
    return semesters


@api_router.post("/admin/subjects", response_model=SubjectOutput)
async def create_subject(input_data: SubjectInput, user: Dict = Depends(admin_user)):
    semester = await db.semesters.find_one({"semester_id": input_data.semester_id}, {"_id": 0, "semester_id": 1})
    if not semester:
        raise HTTPException(status_code=400, detail="Semester not found")

    name = normalize_text(input_data.name)
    code = normalize_text(input_data.code).upper()
    existing = await db.subjects.find_one(
        {"semester_id": input_data.semester_id, "$or": [{"name": name}, {"code": code}]},
        {"_id": 0, "subject_id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="Subject already exists")

    doc = {
        "subject_id": str(uuid.uuid4()),
        "semester_id": input_data.semester_id,
        "name": name,
        "code": code,
        "created_by": user["user_id"],
        "created_at": utc_now_iso(),
    }
    await db.subjects.insert_one(doc.copy())
    return SubjectOutput(**{k: doc[k] for k in ["subject_id", "semester_id", "name", "code", "created_at"]})


@api_router.get("/admin/subjects", response_model=List[SubjectOutput])
async def get_subjects(semester_id: Optional[str] = Query(default=None), _: Dict = Depends(admin_user)):
    query: Dict[str, str] = {}
    if semester_id:
        query["semester_id"] = semester_id
    subjects = await db.subjects.find(
        query,
        {"_id": 0, "subject_id": 1, "semester_id": 1, "name": 1, "code": 1, "created_at": 1},
    ).to_list(2000)
    subjects.sort(key=lambda item: (item["semester_id"], item["name"]))
    return subjects


@api_router.post("/admin/assign-subjects")
async def assign_subjects(input_data: AssignSubjectsInput, _: Dict = Depends(admin_user)):
    student = await db.users.find_one(
        {"user_id": input_data.student_id, "role": "student", "approved": True},
        {"_id": 0, "user_id": 1},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    subjects = await db.subjects.find({"subject_id": {"$in": input_data.subject_ids}}, {"_id": 0, "subject_id": 1, "semester_id": 1}).to_list(1000)
    if len(subjects) != len(set(input_data.subject_ids)):
        raise HTTPException(status_code=400, detail="One or more subjects invalid")

    semester_ids = {item["semester_id"] for item in subjects}
    semester_id = next(iter(semester_ids)) if semester_ids else None
    await db.users.update_one({"user_id": input_data.student_id}, {"$set": {"semester_id": semester_id}})

    await db.student_subject_assignments.update_one(
        {"student_id": input_data.student_id},
        {"$set": {"subject_ids": sorted(set(input_data.subject_ids)), "updated_at": utc_now_iso()}},
        upsert=True,
    )
    return {"message": "Subjects assigned"}


@api_router.get("/admin/subject-students", response_model=List[UserPublic])
async def get_subject_students(subject_id: str = Query(...), _: Dict = Depends(admin_user)):
    assignments = await db.student_subject_assignments.find(
        {"subject_ids": subject_id},
        {"_id": 0, "student_id": 1},
    ).to_list(2000)
    student_ids = [item["student_id"] for item in assignments]
    if not student_ids:
        return []

    students = await db.users.find(
        {
            "user_id": {"$in": student_ids},
            "role": "student",
            "approved": True,
            "phone_number": {"$exists": True},
        },
        {"_id": 0, "password_hash": 0},
    ).to_list(2000)
    students.sort(key=lambda item: item["name"])
    return [user_public_doc(item) for item in students]


@api_router.post("/admin/attendance/bulk")
async def mark_bulk_attendance(input_data: BulkAttendanceInput, user: Dict = Depends(admin_user)):
    subject = await db.subjects.find_one({"subject_id": input_data.subject_id}, {"_id": 0, "name": 1})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    assignments = await db.student_subject_assignments.find(
        {"subject_ids": input_data.subject_id},
        {"_id": 0, "student_id": 1},
    ).to_list(3000)
    assigned_ids = [item["student_id"] for item in assignments]
    if not assigned_ids:
        raise HTTPException(status_code=400, detail="No students assigned to this subject")

    students = await db.users.find(
        {"user_id": {"$in": assigned_ids}, "role": "student", "approved": True},
        {"_id": 0, "user_id": 1, "name": 1},
    ).to_list(3000)
    student_map = {item["user_id"]: item["name"] for item in students}

    now = utc_now_iso()
    present_set = set(input_data.present_student_ids)
    updated_records = 0
    for student_id in assigned_ids:
        if student_id not in student_map:
            continue
        status_value = "present" if student_id in present_set else "absent"
        existing = await db.attendance.find_one(
            {
                "subject_id": input_data.subject_id,
                "student_id": student_id,
                "date": input_data.date,
            },
            {"_id": 0, "record_id": 1},
        )
        if existing:
            await db.attendance.update_one(
                {"record_id": existing["record_id"]},
                {"$set": {"status": status_value, "updated_at": now, "marked_by": user["user_id"]}},
            )
        else:
            doc = {
                "record_id": str(uuid.uuid4()),
                "subject_id": input_data.subject_id,
                "subject_name": subject["name"],
                "student_id": student_id,
                "student_name": student_map[student_id],
                "date": input_data.date,
                "status": status_value,
                "marked_by": user["user_id"],
                "created_at": now,
                "updated_at": None,
            }
            await db.attendance.insert_one(doc.copy())
        updated_records += 1

    return {"message": "Bulk attendance saved", "updated_records": updated_records}


@api_router.get("/admin/attendance", response_model=List[AttendanceRecord])
async def admin_attendance(
    subject_id: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
    _: Dict = Depends(admin_user),
):
    query: Dict[str, str] = {}
    if subject_id:
        query["subject_id"] = subject_id
    if student_id:
        query["student_id"] = student_id
    records = await db.attendance.find(query, {"_id": 0}).to_list(10000)
    records.sort(key=lambda item: (item["date"], item["student_name"]), reverse=True)
    return [AttendanceRecord(**item) for item in records]


@api_router.post("/admin/import-csv")
async def import_csv(input_data: CsvImportInput, user: Dict = Depends(admin_user)):
    csv_text = input_data.csv_text.strip()
    if not csv_text:
        raise HTTPException(status_code=400, detail="CSV text empty")

    reader = csv.DictReader(io.StringIO(csv_text))
    required_columns = {"student_name", "phone_number", "password", "semester", "subjects"}
    if set(reader.fieldnames or []) != required_columns:
        raise HTTPException(status_code=400, detail="CSV columns must be: student_name,phone_number,password,semester,subjects")

    students_created = 0
    students_updated = 0
    subjects_created = 0

    for row in reader:
        student_name = normalize_text(row["student_name"])
        phone = normalize_phone(row["phone_number"])
        password = row["password"].strip()
        semester_name = normalize_text(row["semester"])
        subject_names = [normalize_text(item) for item in row["subjects"].split("|") if normalize_text(item)]
        if not password or not subject_names:
            continue

        semester = await db.semesters.find_one({"name": semester_name}, {"_id": 0, "semester_id": 1})
        if not semester:
            semester_doc = {
                "semester_id": str(uuid.uuid4()),
                "name": semester_name,
                "created_by": user["user_id"],
                "created_at": utc_now_iso(),
            }
            await db.semesters.insert_one(semester_doc.copy())
            semester_id = semester_doc["semester_id"]
        else:
            semester_id = semester["semester_id"]

        existing_student = await db.users.find_one({"phone_number": phone, "role": "student"}, {"_id": 0, "user_id": 1})
        if existing_student:
            student_id = existing_student["user_id"]
            await db.users.update_one(
                {"user_id": student_id},
                {
                    "$set": {
                        "name": student_name,
                        "semester_id": semester_id,
                        "approved": True,
                    }
                },
            )
            students_updated += 1
        else:
            student_id = str(uuid.uuid4())
            student_doc = {
                "user_id": student_id,
                "name": student_name,
                "phone_number": phone,
                "password_hash": hash_password(password),
                "role": "student",
                "approved": True,
                "semester_id": semester_id,
                "college_id": COLLEGE_ID,
                "created_at": utc_now_iso(),
            }
            await db.users.insert_one(student_doc.copy())
            students_created += 1

        subject_ids: List[str] = []
        for index, subject_name in enumerate(subject_names, start=1):
            existing_subject = await db.subjects.find_one(
                {"semester_id": semester_id, "name": subject_name},
                {"_id": 0, "subject_id": 1},
            )
            if existing_subject:
                subject_ids.append(existing_subject["subject_id"])
                continue

            subject_doc = {
                "subject_id": str(uuid.uuid4()),
                "semester_id": semester_id,
                "name": subject_name,
                "code": subject_code_from_name(subject_name, index),
                "created_by": user["user_id"],
                "created_at": utc_now_iso(),
            }
            await db.subjects.insert_one(subject_doc.copy())
            subject_ids.append(subject_doc["subject_id"])
            subjects_created += 1

        await db.student_subject_assignments.update_one(
            {"student_id": student_id},
            {"$set": {"subject_ids": sorted(set(subject_ids)), "updated_at": utc_now_iso()}},
            upsert=True,
        )

    return {
        "message": "CSV imported",
        "students_created": students_created,
        "students_updated": students_updated,
        "subjects_created": subjects_created,
    }


@api_router.get("/admin/insights", response_model=AdminInsightsResponse)
async def admin_insights(_: Dict = Depends(admin_user)):
    students = await db.users.find(
        {"role": "student", "approved": True},
        {"_id": 0, "user_id": 1, "name": 1, "semester_id": 1},
    ).to_list(3000)
    semesters = await db.semesters.find({}, {"_id": 0, "semester_id": 1, "name": 1}).to_list(1000)
    semester_map = {item["semester_id"]: item["name"] for item in semesters}
    subjects = await db.subjects.find({}, {"_id": 0, "subject_id": 1, "name": 1, "semester_id": 1}).to_list(4000)
    subject_map = {item["subject_id"]: item for item in subjects}
    assignments = await db.student_subject_assignments.find({}, {"_id": 0}).to_list(5000)
    attendance = await db.attendance.find(
        {"subject_id": {"$exists": True}},
        {"_id": 0, "student_id": 1, "subject_id": 1, "status": 1},
    ).to_list(50000)

    stats: Dict[str, Dict[str, Dict[str, int]]] = {}
    for record in attendance:
        student_id = record["student_id"]
        subject_id = record["subject_id"]
        if student_id not in stats:
            stats[student_id] = {}
        if subject_id not in stats[student_id]:
            stats[student_id][subject_id] = {"present": 0, "total": 0}
        stats[student_id][subject_id]["total"] += 1
        if record["status"] == "present":
            stats[student_id][subject_id]["present"] += 1

    assignment_map = {item["student_id"]: item.get("subject_ids", []) for item in assignments}
    insights: List[StudentInsight] = []
    for student in students:
        student_subjects = assignment_map.get(student["user_id"], [])
        subject_items: List[SubjectPercent] = []
        for subject_id in student_subjects:
            subject_info = subject_map.get(subject_id)
            if not subject_info:
                continue
            subject_stats = stats.get(student["user_id"], {}).get(subject_id, {"present": 0, "total": 0})
            total = subject_stats["total"]
            present = subject_stats["present"]
            percentage = round((present / total) * 100, 2) if total else 0.0
            subject_items.append(
                SubjectPercent(
                    subject_id=subject_id,
                    subject_name=subject_info["name"],
                    present=present,
                    total=total,
                    percentage=percentage,
                )
            )

        semester_id = student.get("semester_id") or "unassigned"
        if not subject_items:
            continue
        insights.append(
            StudentInsight(
                semester_id=semester_id,
                semester_name=semester_map.get(semester_id, "Unassigned"),
                student_id=student["user_id"],
                student_name=student["name"],
                subjects=subject_items,
            )
        )

    insights.sort(key=lambda item: (item.semester_name, item.student_name))
    return AdminInsightsResponse(insights=insights)


@api_router.get("/student/subjects", response_model=List[SubjectOutput])
async def student_subjects(user: Dict = Depends(approved_student_user)):
    assignment = await db.student_subject_assignments.find_one({"student_id": user["user_id"]}, {"_id": 0})
    subject_ids = assignment.get("subject_ids", []) if assignment else []
    if not subject_ids:
        return []
    subjects = await db.subjects.find(
        {"subject_id": {"$in": subject_ids}},
        {"_id": 0, "subject_id": 1, "semester_id": 1, "name": 1, "code": 1, "created_at": 1},
    ).to_list(1000)
    subjects.sort(key=lambda item: item["name"])
    return subjects


@api_router.get("/student/attendance", response_model=List[AttendanceRecord])
async def student_attendance(
    subject_id: Optional[str] = Query(default=None),
    user: Dict = Depends(approved_student_user),
):
    query: Dict[str, str] = {"student_id": user["user_id"]}
    if subject_id:
        query["subject_id"] = subject_id
    records = await db.attendance.find(query, {"_id": 0}).to_list(10000)
    records.sort(key=lambda item: item["date"], reverse=True)
    return [AttendanceRecord(**item) for item in records]


@api_router.get("/student/insights", response_model=List[SubjectPercent])
async def student_insights(user: Dict = Depends(approved_student_user)):
    assignment = await db.student_subject_assignments.find_one({"student_id": user["user_id"]}, {"_id": 0})
    subject_ids = assignment.get("subject_ids", []) if assignment else []
    if not subject_ids:
        return []

    subjects = await db.subjects.find(
        {"subject_id": {"$in": subject_ids}},
        {"_id": 0, "subject_id": 1, "name": 1},
    ).to_list(1000)
    subject_name_map = {item["subject_id"]: item["name"] for item in subjects}

    records = await db.attendance.find(
        {"student_id": user["user_id"], "subject_id": {"$in": subject_ids}},
        {"_id": 0, "subject_id": 1, "status": 1},
    ).to_list(20000)

    stats: Dict[str, Dict[str, int]] = {sid: {"present": 0, "total": 0} for sid in subject_ids}
    for record in records:
        sid = record["subject_id"]
        stats[sid]["total"] += 1
        if record["status"] == "present":
            stats[sid]["present"] += 1

    output: List[SubjectPercent] = []
    for sid in subject_ids:
        total = stats[sid]["total"]
        present = stats[sid]["present"]
        output.append(
            SubjectPercent(
                subject_id=sid,
                subject_name=subject_name_map.get(sid, "Unknown Subject"),
                present=present,
                total=total,
                percentage=round((present / total) * 100, 2) if total else 0.0,
            )
        )
    output.sort(key=lambda item: item.subject_name)
    return output


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_event():
    await ensure_college_profile()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
