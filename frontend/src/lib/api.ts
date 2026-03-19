import axios from 'axios'

function getCookie(name: string): string | null {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  // Ensures the httpOnly session cookie is sent on every same-origin request.
  // No Authorization header needed — the cookie is handled automatically by the browser.
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase()
  if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCookie('csrf_token')
    if (csrfToken) {
      config.headers.set('X-CSRF-Token', csrfToken)
    }
  }
  return config
})

// Response interceptor: redirect to login on 401 (session expired / not authenticated)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Avoid redirect loop if already on the login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
