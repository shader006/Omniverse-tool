package domain

import "errors"

var (
	ErrJobNotFound        = errors.New("không tìm thấy tác vụ yêu cầu")
	ErrInvalidInput       = errors.New("dữ liệu đầu vào không hợp lệ")
	ErrUnsupportedFormat  = errors.New("định dạng tệp không được hỗ trợ")
	ErrWorkerUnavailable  = errors.New("dịch vụ worker hiện không khả dụng")
	ErrConcurrencyLimit   = errors.New("hệ thống đang bận xử lý nhiều tác vụ, vui lòng thử lại sau")
	ErrFileNotFound       = errors.New("không tìm thấy tệp yêu cầu")
	ErrFileTooLarge       = errors.New("kích thước tệp vượt quá giới hạn cho phép")
)
