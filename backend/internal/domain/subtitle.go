package domain

import (
	"fmt"
	"math"
)

// SubtitleSegment đại diện cho một câu thoại kèm mốc thời gian chi tiết
// Khớp với đối tượng SubtitleSegment trong thiết kế README.md
type SubtitleSegment struct {
	StartTime float64 `json:"start_time"`
	EndTime   float64 `json:"end_time"`
	Text      string  `json:"text"`
}

// ToVTTTime định dạng thời gian giây sang chuẩn WebVTT (00:01:23.450)
func (s SubtitleSegment) ToVTTTime(seconds float64) string {
	hours := int(seconds) / 3600
	minutes := (int(seconds) % 3600) / 60
	secs := int(seconds) % 60
	millis := int(math.Round((seconds - math.Floor(seconds)) * 1000))
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, secs, millis)
}

// ToSRTTime định dạng thời gian giây sang chuẩn SubRip (00:01:23,450)
func (s SubtitleSegment) ToSRTTime(seconds float64) string {
	hours := int(seconds) / 3600
	minutes := (int(seconds) % 3600) / 60
	secs := int(seconds) % 60
	millis := int(math.Round((seconds - math.Floor(seconds)) * 1000))
	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, secs, millis)
}
