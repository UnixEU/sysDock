import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { buildImage, fetchImages } from '@/lib/dockerApi'
import { toast } from 'sonner'
import { Download, Trash2, Hammer, X } from 'lucide-react'
import axios from 'axios'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/authStore'
import type { BuildImagePayload, ImageInfo } from '@/types/api'

const LIMIT = 50

export default function ImagesPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'administrator'
  const [page, setPage] = useState(0)
  const [selectedImage, setSelectedImage] = useState<ImageInfo | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isBuildOpen, setIsBuildOpen] = useState(false)
  const [dockerfileContent, setDockerfileContent] = useState('')
  const [imageTag, setImageTag] = useState('')

  const { data: images, isLoading } = useQuery({
    queryKey: ['images', page],
    queryFn: async () => {
      return fetchImages(page * LIMIT, LIMIT)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/docker/images/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
      toast.success('Image deleted')
      setIsDeleteOpen(false)
    },
    onError: () => {
      toast.error('Failed to delete image')
    }
  })

  const exportImage = async (image: ImageInfo) => {
    try {
      toast.info('Exporting image...')
      const response = await api.get(`/docker/images/${image.id}/export`, {
        responseType: 'blob'
      })

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const firstTag = image.tags && image.tags.length > 0 ? image.tags[0] : image.id
      const safeName = firstTag.replace(/[/:]/g, '_')
      link.setAttribute('download', `${safeName}.tar`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      toast.success('Image exported successfully')
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.detail ?? error.message
        : 'Failed to export image'
      toast.error(detail)
    }
  }

  const buildImageMutation = useMutation({
    mutationFn: (payload: BuildImagePayload) => buildImage(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
      toast.success('Image built successfully')
      setIsBuildOpen(false)
      setDockerfileContent('')
      setImageTag('')
    },
    onError: (error: unknown) => {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.detail ?? error.message
        : 'Failed to build image'
      toast.error(detail)
    }
  })

  const handleBuildImage = () => {
    if (!dockerfileContent.trim()) {
      toast.error('Dockerfile content is required')
      return
    }
    if (!imageTag.trim()) {
      toast.error('Image tag is required')
      return
    }
    toast.info('Building image...')
    buildImageMutation.mutate({ dockerfile_content: dockerfileContent, tag: imageTag })
  }

  if (isLoading) return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  )

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Images</h1>
          <p className="text-muted-foreground mt-1">Manage Docker images - build, export, and delete</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsBuildOpen(true)}
            disabled={!isAdmin}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            <Hammer size={16} />
            Build Image
          </button>
        </div>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-4">ID</th>
              <th className="text-left p-4">Tags</th>
              <th className="text-left p-4">Size</th>
              <th className="text-left p-4">Created</th>
              <th className="text-left p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {images?.map((image: ImageInfo) => (
              <tr key={image.id} className="border-t hover:bg-muted/50">
                <td className="p-4 font-mono text-sm">{image.id.substring(7, 19)}</td>
                <td className="p-4">
                  <div className="flex flex-wrap gap-1">
                    {image.tags && image.tags.length > 0 ? (
                      image.tags.map((tag: string, i: number) => (
                        <span key={i} className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 rounded text-xs">
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground text-sm">none</span>
                    )}
                  </div>
                </td>
                <td className="p-4">{(image.size / 1024 / 1024).toFixed(2)} MB</td>
                <td className="p-4">{new Date(image.created).toLocaleDateString()}</td>
                <td className="p-4">
                  <div className="flex gap-2">
                    {isAdmin ? (
                      <>
                        <button
                          onClick={() => exportImage(image)}
                          className="p-2 hover:bg-accent rounded transition-colors"
                          title="Export Image"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedImage(image)
                            setIsDeleteOpen(true)
                          }}
                          className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors text-red-600"
                          title="Delete Image"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Read only</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          disabled={page === 0}
          onClick={() => setPage(p => p - 1)}
          className="px-3 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <button
          disabled={!images || images.length < LIMIT}
          onClick={() => setPage(p => p + 1)}
          className="px-3 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Build Image Modal */}
      {isBuildOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsBuildOpen(false)}>
          <div className="bg-background rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Build Docker Image</h2>
              <button onClick={() => setIsBuildOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Image Tag</label>
                <input
                  type="text"
                  value={imageTag}
                  onChange={(e) => setImageTag(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  placeholder="myapp:latest"
                />
                <p className="text-xs text-muted-foreground mt-1">Format: name:tag (e.g., myapp:v1.0 or myapp:latest)</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Dockerfile Content</label>
                <textarea
                  value={dockerfileContent}
                  onChange={(e) => setDockerfileContent(e.target.value)}
                  className="w-full h-96 px-3 py-2 border rounded-md bg-background font-mono text-sm"
                  placeholder={`FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]`}
                />
              </div>
              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  onClick={() => setIsBuildOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBuildImage}
                  disabled={buildImageMutation.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  {buildImageMutation.isPending ? 'Building...' : 'Build Image'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteOpen && selectedImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsDeleteOpen(false)}>
          <div className="bg-background rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-bold">Delete Image?</h2>
              <p className="text-muted-foreground">
                Are you sure you want to delete this image?
              </p>
              <div className="bg-muted p-3 rounded text-sm">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{selectedImage.id}</span></div>
                <div><span className="text-muted-foreground">Tags:</span> {selectedImage.tags?.join(', ') || 'none'}</div>
              </div>
              <p className="text-sm text-red-600">This action cannot be undone.</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setIsDeleteOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(selectedImage.id)}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
