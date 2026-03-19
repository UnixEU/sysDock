import { create } from 'zustand'
import api from '@/lib/api'

type UserRole = 'administrator' | 'viewer'

interface User {
  id: number
  username: string
  email: string
  full_name?: string
  role: UserRole
  is_active: boolean
  is_superuser: boolean
}

interface AuthState {
  user: User | null
  /** null = still checking session; true = logged in; false = not logged in */
  isAuthenticated: boolean | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string, fullName?: string) => Promise<User>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: null,
  isLoading: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true })
    try {
      const formData = new FormData()
      formData.append('username', username)
      formData.append('password', password)

      // Backend sets an httpOnly cookie; we don't receive/store the token here
      await api.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      // Fetch user profile after successful login
      const userResponse = await api.get('/auth/me')
      set({ user: userResponse.data, isAuthenticated: true, isLoading: false })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  register: async (username: string, email: string, password: string, fullName?: string) => {
    set({ isLoading: true })
    try {
      const response = await api.post('/auth/register', {
        username,
        email,
        password,
        full_name: fullName,
      })
      set({ isLoading: false })
      return response.data
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  logout: async () => {
    try {
      // Ask backend to clear the httpOnly cookie
      await api.post('/auth/logout')
    } catch {
      // Ignore errors — clear local state regardless
    }
    set({ user: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    try {
      const response = await api.get('/auth/me')
      set({ user: response.data, isAuthenticated: true })
    } catch {
      set({ user: null, isAuthenticated: false })
    }
  },
}))
