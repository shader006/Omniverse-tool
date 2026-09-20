// ============================================================
// Firebase Configuration & Initialization
// ============================================================
// Lấy các giá trị này từ:
// Firebase Console → Project Settings → General → Your apps → Web app
// ============================================================

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== 'undefined' &&
  firebaseConfig.apiKey !== 'YOUR_FIREBASE_API_KEY'
);

let app = null;
let auth = null;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (err) {
    console.warn('[Firebase] Initialization error (auth disabled):', err);
  }
} else {
  console.info('[Firebase] Firebase API key not provided. Running in guest mode without Firebase Auth.');
}

export { app, auth };
export default app;
