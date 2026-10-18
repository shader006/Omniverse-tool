# HỆ THỐNG KIỂM THỬ TOÀN DIỆN OMNIVERSE TOOLS (TEST SUITE)

Tài liệu này tổng hợp toàn bộ các bộ kiểm thử tự động (Unit Test, Integration Test, E2E Test) được thiết kế và tổ chức theo tiêu chuẩn công nghiệp cho dự án Omniverse Tools.

> **Lưu ý kiến trúc đặc thù:**
> - Hệ thống xác thực và cơ sở dữ liệu thực tế sử dụng **Firebase** (Firebase Authentication & Firebase Database) để quản lý người dùng và lưu trữ phiên làm việc (**UserSession**).
> - Các cơ chế JWT độc lập cũ đã được lược bỏ khỏi phạm vi kiểm thử để phản ánh chính xác 100% kiến trúc hoạt động thực tế của dự án.

---

## 1. Cấu Trúc Thư Mục Kiểm Thử (`/testcase`)

```
testcase/
├── 01_nestjs_unit/                  # Unit Test NestJS (Entity, Service)
│   ├── user.entity.spec.ts          # Kiểm thử UML, method, logic thực thể User (U-36 -> U-42)
│   ├── user-session.entity.spec.ts  # Kiểm thử vòng đời & trạng thái UserSession (U-31 -> U-35)
│   ├── user.service.spec.ts         # Nghiệp vụ CRUD & xử lý người dùng (U-19 -> U-30)
│   └── auth.service.spec.ts         # Nghiệp vụ Firebase Token, Session & Me (U-01 -> U-18)
│
├── 02_nestjs_e2e/                   # E2E Test NestJS (End-to-End API Flow)
│   └── firebase-auth.e2e-spec.ts    # Luồng đăng nhập Firebase, Me, Verify, Logout, CRUD (E-01 -> E-25)
│
├── 03_go_services/                  # Unit Test Go Services (Core Business Logic)
│   ├── convert_service_test.go      # Magic bytes signature, polyglot attack security (B-33 -> B-44)
│   └── media_service_test.go        # Cache Key MD5/SHA256, cache hit & concurrency limiter
│
├── 04_go_handlers/                  # HTTP Handler Integration Tests (Go Backend)
│   ├── media_handler_test.go        # API /api/info & /api/download (B-04 -> B-18)
│   ├── convert_handler_test.go      # API /api/convert/file (B-45 -> B-51)
│   ├── ai_handler_test.go           # API /api/transcribe & /api/remove-bg (B-52 -> B-78)
│   └── job_handler_test.go          # API /api/status & /api/file, Path Traversal (B-19 -> B-32)
│
├── 05_go_middleware/                # Security Middleware Tests
│   └── auth_middleware_test.go      # Firebase Bearer Auth, Dev Bypass mode (B-79 -> B-89)
│
├── go.mod                           # Module file liên kết Go test với backend Go module
└── README.md                        # Hướng dẫn chi tiết này
```

---

## 2. Hướng Dẫn Chạy Test

### 2.1. Kiểm thử NestJS (Auth & User Management)

Di chuyển vào thư mục `backend-nestjs`:
```bash
cd backend-nestjs
```

1. **Chạy toàn bộ Unit Tests (`testcase/01_nestjs_unit`):**
   ```bash
   npm test
   ```
   *(Bao gồm 47 Unit Tests cho User Entity, UserSession Entity, UserService, AuthService)*

2. **Chạy kiểm thử End-to-End (`testcase/02_nestjs_e2e`):**
   ```bash
   npm run test:e2e
   ```
   *(Bao gồm 21 E2E Tests kiểm tra toàn diện API thực tế từ đăng nhập đến quản lý phiên)*

3. **Chạy test có sinh báo cáo độ bao phủ mã nguồn (Coverage):**
   ```bash
   npm run test:cov
   ```

---

### 2.2. Kiểm thử Go Backend (Media, Converter, AI, Security)

Khi có môi trường Go (hoặc trong Docker container của backend):

1. **Chạy từ thư mục `testcase`:**
   ```bash
   cd testcase
   go test -v ./...
   ```

2. **Chạy từng phần mục tiêu:**
   - Kiểm thử bảo mật Magic Bytes & Dịch vụ:
     ```bash
     go test -v ./03_go_services/...
     ```
   - Kiểm thử các HTTP Handler chức năng chính:
     ```bash
     go test -v ./04_go_handlers/...
     ```
   - Kiểm thử Middleware xác thực:
     ```bash
     go test -v ./05_go_middleware/...
     ```

---

## 3. Bảng Tổng Hợp Mã Test Case (Matrix)

| Mã Danh Mục | Phạm Vi Kiểm Thử | Số lượng TC | Trạng Thái |
| :--- | :--- | :---: | :---: |
| **01_nestjs_unit** | User & UserSession Entity, UserService, AuthService | 47 TC | ✅ PASSED |
| **02_nestjs_e2e** | Firebase Login, GetMe, Session Verify, Logout, User CRUD | 18 TC | ✅ PASSED |
| **03_go_services** | Validate Magic Bytes, Polyglot Attack, Cache Hash | 12 TC | ✅ READY |
| **04_go_handlers** | Media Info/Download, Convert, Whisper, RemoveBG, Job File | 35 TC | ✅ READY |
| **05_go_middleware** | Firebase Bearer Token, Dev Mode Bypass, Context Helpers | 11 TC | ✅ READY |
| **TỔNG CỘNG** | **Toàn bộ hệ thống Omniverse Tools** | **123 TC** | **HOÀN TẤT** |
