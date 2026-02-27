import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import pb from '@/lib/pocketbase'
import type { Tag } from '@/types/pocketbase'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

function getTagStyle(usageCount: number, maxCount: number) {
  const ratio = maxCount > 0 ? usageCount / maxCount : 0

  if (ratio > 0.6) {
    return 'text-base font-bold'
  }
  if (ratio > 0.3) {
    return 'text-sm font-semibold'
  }
  return 'text-xs font-normal'
}

function TagPillSkeleton({ width }: { width: string }) {
  return <Skeleton className={`h-8 rounded-md ${width}`} />
}

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchTags() {
      try {
        setLoading(true)
        setError(null)
        const result = await pb.collection('tags').getFullList<Tag>({
          sort: '-usage_count',
          requestKey: null,
        })
        if (!cancelled) {
          setTags(result)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          setError(`Failed to load tags: ${message}`)
          console.error(err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchTags()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return tags
    const q = search.toLowerCase()
    return tags.filter(t => t.name.toLowerCase().includes(q))
  }, [tags, search])

  const maxCount = useMemo(() => {
    return tags.length > 0 ? tags[0].usage_count : 0
  }, [tags])

  const skeletonWidths = ['w-16', 'w-24', 'w-20', 'w-14', 'w-28', 'w-18', 'w-22', 'w-16', 'w-20', 'w-24', 'w-14', 'w-28']

  return (
    <div className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Tags</h1>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search tags..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-10 bg-card pl-9"
        />
      </div>

      {loading ? (
        <div className="flex flex-wrap gap-2">
          {skeletonWidths.map((w, i) => (
            <TagPillSkeleton key={i} width={w} />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-destructive">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          {search ? 'No tags match your search.' : 'No tags found.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filtered.map(tag => (
            <Link key={tag.id} to={`/tags/${tag.id}`}>
              <Badge
                variant="secondary"
                className={`cursor-pointer transition-colors hover:bg-accent hover:text-primary ${getTagStyle(tag.usage_count, maxCount)}`}
              >
                {tag.name}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
