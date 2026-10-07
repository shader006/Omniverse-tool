package middleware

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

type contextKey string

const (
	contextKeyUID   contextKey = "firebase_uid"
	contextKeyEmail contextKey = "firebase_email"
)

var (
	firebaseApp  *firebase.App
	firebaseAuth *auth.Client
	firebaseOnce sync.Once
)

// InitFirebase khởi tạo Firebase Admin App một lần duy nhất.
func InitFirebase() {
	firebaseOnce.Do(func() {
		ctx := context.Background()

		projectID := os.Getenv("FIREBASE_PROJECT_ID")
		saFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")

		var app *firebase.App
		var err error

		if saFile != "" {
			app, err = firebase.NewApp(ctx, &firebase.Config{
				ProjectID: projectID,
			}, option.WithCredentialsFile(saFile))
		} else if projectID != "" {
			app, err = firebase.NewApp(ctx, &firebase.Config{
				ProjectID: projectID,
			})
		} else {
			log.Println("⚠️  [Firebase] FIREBASE_PROJECT_ID và GOOGLE_APPLICATION_CREDENTIALS chưa được cấu hình.")
			log.Println("⚠️  [Firebase] Auth middleware sẽ chạy ở chế độ BYPASS (dev mode).")
			return
		}

		if err != nil {
			log.Printf("❌ [Firebase] Không thể khởi tạo Firebase App: %v", err)
			return
		}

		firebaseApp = app

		authClient, err := app.Auth(ctx)
		if err != nil {
			log.Printf("❌ [Firebase] Không thể khởi tạo Auth client: %v", err)
			return
		}

		firebaseAuth = authClient
		log.Printf("✅ [Firebase] Firebase Admin SDK đã khởi tạo thành công (project: %s)", projectID)
	})
}

func verifyFirebaseToken(ctx context.Context, idToken string) (*auth.Token, error) {
	return firebaseAuth.VerifyIDToken(ctx, idToken)
}

// GetUserUID lấy Firebase UID từ request context.
func GetUserUID(r *http.Request) string {
	if uid, ok := r.Context().Value(contextKeyUID).(string); ok {
		return uid
	}
	return ""
}

// GetUserEmail lấy email từ request context.
func GetUserEmail(r *http.Request) string {
	if email, ok := r.Context().Value(contextKeyEmail).(string); ok {
		return email
	}
	return ""
}

// AuthMiddleware bảo vệ route — yêu cầu Firebase Bearer token hợp lệ.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if firebaseAuth == nil {
			log.Printf("⚠️  [Auth] BYPASS %s (dev mode — cấu hình FIREBASE_PROJECT_ID để bật)", r.URL.Path)
			next.ServeHTTP(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeAuthError(w, "Yêu cầu đăng nhập để sử dụng tính năng này.", http.StatusUnauthorized)
			return
		}

		idToken := strings.TrimPrefix(authHeader, "Bearer ")
		if idToken == "" {
			writeAuthError(w, "Token không hợp lệ.", http.StatusUnauthorized)
			return
		}

		decoded, err := verifyFirebaseToken(r.Context(), idToken)
		if err != nil {
			log.Printf("🔒 [Auth] Token verify thất bại từ %s: %v", getClientIP(r), err)
			writeAuthError(w, "Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), contextKeyUID, decoded.UID)
		if email, ok := decoded.Claims["email"].(string); ok {
			ctx = context.WithValue(ctx, contextKeyEmail, email)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func writeAuthError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   message,
		"code":    "AUTH_REQUIRED",
	})
}
