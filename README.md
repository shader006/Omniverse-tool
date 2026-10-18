### 3.4. Chi tiết các bước thực thi kỹ thuật xác thực (NestJS JWT Authentication)

Hệ thống bổ sung dịch vụ xác thực người dùng xây dựng trên nền tảng **NestJS**, hiện thực hóa chuẩn **Passport-JWT Authentication** theo tài liệu chính thức của NestJS, tích hợp mã hóa mật khẩu một chiều bằng **bcrypt** và cơ sở dữ liệu SQLite:

#### 1. Đăng ký tài khoản (`POST /api/v1/auth/register`)
- **Dữ liệu đầu vào (Payload):** `{ email, password, username }`.
- **Quy trình xử lý:**
  1. `RegisterDto` thực hiện kiểm tra cấu trúc dữ liệu đầu vào.
  2. `AuthService.register()` sử dụng thư viện **bcrypt** băm mật khẩu với hệ số muối `saltRounds = 10` thành chuỗi hash an toàn dạng `$2b$10$...` (tuyệt đối không lưu mật khẩu bản rõ).
  3. Gọi `UserService.registerWithPassword()` lưu thông tin người dùng mới vào SQLite.
  4. Cấp phát chuỗi `access_token` bằng `jwtService.sign(payload)` với payload gồm `{ sub: user.id, email, username, role }`.
- **Kết quả trả về:** HTTP 201 Created kèm thông tin người dùng và mã `access_token`.

#### 2. Đăng nhập (`POST /api/v1/auth/login`)
- **Dữ liệu đầu vào (Payload):** `{ email, password }`.
- **Quy trình xử lý:**
  1. `AuthService.jwtLogin()` tiếp nhận dữ liệu và gọi `validateUser(email, password)`.
  2. `UserService.findByEmail()` truy vấn người dùng trong database theo email.
  3. Sử dụng `bcrypt.compare(password, user.password)` để kiểm tra tính chính xác của mật khẩu.
  4. Nếu không khớp: Ném ngoại lệ `401 Unauthorized ('Email hoặc mật khẩu không chính xác.')`.
  5. Nếu khớp: Đóng gói payload `{ sub: user.id, email: user.email, username: user.username, role: user.role }`.
  6. Ký và tạo chuỗi JWT bằng secret key (`jwtConstants.secret`) với thời hạn hiệu lực 1 ngày (`expiresIn: '1d'`).
- **Kết quả trả về:** HTTP 200 OK kèm mã `access_token` và thông tin `user`.

#### 3. Gọi tài nguyên bảo mật (`GET /api/v1/auth/profile`)
- **Dữ liệu đầu vào:** Header HTTP `Authorization: Bearer <access_token>`.
- **Quy trình xử lý:**
  1. Request gửi đến endpoint `/auth/profile`, gặp decorator `@UseGuards(JwtAuthGuard)`.
  2. `JwtAuthGuard` (kế thừa `AuthGuard('jwt')` của Passport) bắt request và kích hoạt `JwtStrategy`.
  3. `JwtStrategy` tự động trích xuất chuỗi Bearer token từ Header và giải mã bằng `jwtConstants.secret`:
     - Nếu token không tồn tại, bị giả mạo hoặc đã hết hạn: Passport chặn lại ngay lập tức và phản hồi mã lỗi `401 Unauthorized`.
     - Nếu token hợp lệ: Hàm `validate(payload)` trích xuất thông tin `{ userId: payload.sub, email: payload.email, username: payload.username, role: payload.role }` và tự động gắn vào đối tượng `req.user`.
  4. Controller nhận request hợp lệ, lấy dữ liệu từ `req.user` và trả về profile người dùng.

