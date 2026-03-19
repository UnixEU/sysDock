import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/contexts/ThemeProvider'
import { useAuthStore } from '@/stores/authStore'
import LoginPage from '@/pages/LoginPage'
import Layout from '@/components/Layout'
import { Skeleton } from '@/components/ui/skeleton'

// Route-level code splitting — each page bundle is only loaded on first navigation
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const ContainersPage = lazy(() => import('@/pages/ContainersPage'))
const ImagesPage = lazy(() => import('@/pages/ImagesPage'))
const NetworksPage = lazy(() => import('@/pages/NetworksPage'))
const VolumesPage = lazy(() => import('@/pages/VolumesPage'))
const MaintenancePage = lazy(() => import('@/pages/MaintenancePage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function PageLoader() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  // Still verifying session on initial load — show nothing yet
  if (isAuthenticated === null) {
    return <PageLoader />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  if (isAuthenticated === null) {
    return <PageLoader />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (!user?.is_superuser) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth)

  // Verify session via /auth/me on every app mount (cookie-based — no localStorage needed)
  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system">
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="containers" element={<ContainersPage />} />
                <Route path="images" element={<ImagesPage />} />
                <Route path="networks" element={<NetworksPage />} />
                <Route path="volumes" element={<VolumesPage />} />
                <Route
                  path="maintenance"
                  element={
                    <AdminRoute>
                      <MaintenancePage />
                    </AdminRoute>
                  }
                />
                <Route
                  path="users"
                  element={
                    <AdminRoute>
                      <UsersPage />
                    </AdminRoute>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
