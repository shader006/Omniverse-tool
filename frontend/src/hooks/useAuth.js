import { useContext } from 'react';
import AuthContext from '../contexts/AuthContext';

/**
 * Custom hook để truy cập AuthContext trong bất kỳ component nào.
 * 
 * @example
 * const { user, isLoggedIn, loginEmail, loginGoogle, loginGitHub, logout } = useAuth();
 * 
 * @throws {Error} Nếu dùng ngoài <AuthProvider>
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth() phải được dùng bên trong <AuthProvider>');
  }
  return context;
}

export default useAuth;
