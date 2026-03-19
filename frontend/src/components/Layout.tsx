import { Outlet, NavLink } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useTheme } from '@/contexts/ThemeProvider'
import { Container, Image, Network, HardDrive, LayoutDashboard, Moon, Sun, LogOut, Users, Shield } from 'lucide-react'

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { theme, setTheme } = useTheme()

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Containers', href: '/containers', icon: Container },
    { name: 'Images', href: '/images', icon: Image },
    { name: 'Networks', href: '/networks', icon: Network },
    { name: 'Volumes', href: '/volumes', icon: HardDrive },
    ...(user?.is_superuser ? [{ name: 'Maintenance', href: '/maintenance', icon: Shield }] : []),
    ...(user?.is_superuser ? [{ name: 'Users', href: '/users', icon: Users }] : []),
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 bg-card border-r">
        <div className="flex flex-col h-full">
          <div className="p-6">
            <h1 className="text-2xl font-bold">sysDock</h1>
          </div>
          <nav className="flex-1 px-4 space-y-2">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`
                }
              >
                <item.icon size={20} />
                {item.name}
              </NavLink>
            ))}
          </nav>
          <div className="p-4 border-t">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">{user?.username}</span>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-2 rounded-lg hover:bg-accent"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm rounded-lg hover:bg-accent"
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="ml-64">
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
