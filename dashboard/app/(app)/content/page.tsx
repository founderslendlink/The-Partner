'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, Instagram, Linkedin, Twitter, Facebook, Clock, CheckCircle, XCircle, FileEdit } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';

interface ContentPost {
  id: string;
  platform: string;
  content: string;
  status: string;
  scheduled_at?: string;
  published_at?: string;
  hashtags?: string[];
  performance?: Record<string, unknown>;
  created_at: string;
}

const PLATFORM_ICON: Record<string, React.ReactNode> = {
  instagram: <Instagram className="w-4 h-4" />,
  linkedin:  <Linkedin className="w-4 h-4" />,
  twitter:   <Twitter className="w-4 h-4" />,
  facebook:  <Facebook className="w-4 h-4" />,
};

const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-gray-700 text-gray-300',
  scheduled: 'bg-yellow-500/20 text-yellow-400',
  published: 'bg-green-500/20 text-green-400',
  failed:    'bg-red-500/20 text-red-400',
};

const PLATFORMS = ['instagram', 'linkedin', 'twitter', 'facebook'];

export default function ContentStudioPage() {
  const business = useBusiness();
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    content: '',
    platforms: [] as string[],
    scheduled_at: '',
  });

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('content_posts')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setPosts((data as ContentPost[]) || []);
    setLoading(false);
  }, [business]);

  useEffect(() => { load(); }, [load]);

  const togglePlatform = (p: string) => {
    setForm((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter((x) => x !== p)
        : [...prev.platforms, p],
    }));
  };

  const createPost = async () => {
    if (!business || !form.content || form.platforms.length === 0) return;
    const supabase = createClient();
    for (const platform of form.platforms) {
      await supabase.from('content_posts').insert({
        business_id: business.id,
        platform,
        content: form.content,
        status: form.scheduled_at ? 'scheduled' : 'draft',
        scheduled_at: form.scheduled_at || null,
      });
    }
    setShowForm(false);
    setForm({ content: '', platforms: [], scheduled_at: '' });
    load();
  };

  const drafts = posts.filter((p) => p.status === 'draft');
  const scheduled = posts.filter((p) => p.status === 'scheduled');
  const published = posts.filter((p) => p.status === 'published');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Content Studio</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {posts.length} posts · {scheduled.length} scheduled · {published.length} published
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Post
        </button>
      </div>

      {/* Create Post Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">New Post</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Caption / Content *</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Write your post content here…"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-2">Platforms *</label>
              <div className="flex gap-2 flex-wrap">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                      form.platforms.includes(p)
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    {PLATFORM_ICON[p]}
                    <span className="capitalize">{p}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Schedule Time (optional)</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={createPost}
                disabled={!form.content || form.platforms.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg"
              >
                {form.scheduled_at ? 'Schedule Post' : 'Save Draft'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-400 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drafts needing approval */}
      {drafts.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <FileEdit className="w-4 h-4" /> Drafts
            <span className="text-xs font-normal bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">{drafts.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {drafts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

      {/* Scheduled */}
      {scheduled.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Scheduled
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scheduled.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

      {/* Published */}
      {published.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" /> Published
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {published.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

      {!loading && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <p className="text-gray-600 text-sm">No content yet</p>
          <p className="text-gray-700 text-xs mt-1">Create your first post to get started</p>
        </div>
      )}
    </div>
  );
}

function PostCard({ post }: { post: ContentPost }) {
  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{PLATFORM_ICON[post.platform] ?? <FileEdit className="w-4 h-4" />}</span>
          <span className="text-xs font-medium text-gray-300 capitalize">{post.platform}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[post.status] ?? STATUS_STYLE.draft}`}>
          {post.status}
        </span>
      </div>
      <p className="text-sm text-gray-300 line-clamp-3 leading-relaxed">{post.content}</p>
      {post.scheduled_at && (
        <p className="text-xs text-gray-600 mt-2 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {new Date(post.scheduled_at).toLocaleString()}
        </p>
      )}
      {post.published_at && (
        <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          {new Date(post.published_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
