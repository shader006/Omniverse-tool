package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"sync"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

// ─── Firebase Admin App (singleton) ──────────────────────────────────────────

var (
	firebaseApp  *firebase.App
	firebaseAuth *auth.Client
	firebaseOnce sync.Once
)

// initFirebase khởi tạo Firebase Admin App một lần duy nhất.
// Gọi hàm này từ main() khi server khởi động.
func initFirebase() {
	firebaseOnce.Do(func() {
		ctx := context.Background()

		projectID := os.Getenv("FIREBASE_PROJECT_ID")
		saFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")

		var app *firebase.App
		var err error

		if saFile != "" {
			// Dùng Service Account JSON file (production)
			app, err = firebase.NewApp(ctx, &firebase.Config{
				ProjectID: projectID,
			}, option.WithCredentialsFile(saFile))
		} else if projectID != "" {
			// Dùng Application Default Credentials (GCP environments)
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

// ─── Token Verification ───────────────────────────────────────────────────────

// verifyFirebaseToken xác minh Firebase ID Token và trả về thông tin user.
// Hoạt động offline — chỉ cần fetch Firebase public keys lần đầu (~1 lần/ngày).
func verifyFirebaseToken(ctx context.Context, idToken string) (*auth.Token, error) {
	return firebaseAuth.VerifyIDToken(ctx, idToken)
}

// ─── Context Keys & Helpers ───────────────────────────────────────────────────

type contextKey string

const (
	contextKeyUID   contextKey = "firebase_uid"
	contextKeyEmail contextKey = "firebase_email"
)

// GetUserUID lấy Firebase UID từ request context (sau khi qua authMiddleware).
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
