import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, UserCheck, Users } from 'lucide-react'
import axios from 'axios'
import api from '@/lib/api'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import type { UserInfo, UserRole } from '@/types/api'

function extractErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail ?? error.message ?? fallback
  }
  return fallback
}

export default function UsersPage() {
  const queryClient = useQueryClient()

  const { data: users, isLoading } = useQuery<UserInfo[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/auth/users')
      return data
    },
  })

  const approveMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: UserRole }) =>
      api.post(`/auth/users/${userId}/approve`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User approved')
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to approve user')),
  })

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: UserRole }) =>
      api.put(`/auth/users/${userId}/role`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Role updated')
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to update role')),
  })

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    )
  }

  const pendingUsers = users?.filter((user) => !user.is_active) ?? []
  const approvedUsers = users?.filter((user) => user.is_active) ?? []

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Users</h1>
        <p className="mt-1 text-muted-foreground">
          Approve registrations and manage application roles.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Pending approvals</p>
              <p className="mt-2 text-3xl font-semibold">{pendingUsers.length}</p>
            </div>
            <UserCheck className="h-5 w-5 text-amber-500" />
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Approved users</p>
              <p className="mt-2 text-3xl font-semibold">{approvedUsers.length}</p>
            </div>
            <Users className="h-5 w-5 text-sky-500" />
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Administrators</p>
              <p className="mt-2 text-3xl font-semibold">
                {approvedUsers.filter((user) => user.role === 'administrator').length}
              </p>
            </div>
            <Shield className="h-5 w-5 text-emerald-500" />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Pending Registrations</h2>
        </div>
        <div className="divide-y">
          {pendingUsers.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground">
              No pending users right now.
            </div>
          ) : (
            pendingUsers.map((user) => (
              <div key={user.id} className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-medium">{user.username}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                  {user.full_name ? (
                    <p className="mt-1 text-sm text-muted-foreground">{user.full_name}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => approveMutation.mutate({ userId: user.id, role: 'viewer' })}
                    disabled={approveMutation.isPending}
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Approve as Viewer
                  </button>
                  <button
                    onClick={() => approveMutation.mutate({ userId: user.id, role: 'administrator' })}
                    disabled={approveMutation.isPending}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Approve as Administrator
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Approved Users</h2>
        </div>
        <div className="divide-y">
          {approvedUsers.map((user) => (
            <div key={user.id} className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{user.username}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      user.role === 'administrator'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {user.role}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                {user.full_name ? (
                  <p className="mt-1 text-sm text-muted-foreground">{user.full_name}</p>
                ) : null}
              </div>
              <label className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Role</span>
                <select
                  value={user.role}
                  onChange={(event) =>
                    roleMutation.mutate({
                      userId: user.id,
                      role: event.target.value as UserRole,
                    })
                  }
                  disabled={roleMutation.isPending}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="administrator">Administrator</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
