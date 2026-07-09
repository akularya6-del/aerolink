'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Key, CheckCircle, XCircle, Loader2, Eye, EyeOff, RefreshCw, PowerOff, Power } from 'lucide-react';

interface KeyEntry {
  id: string;
  apiKey: string;
  status: string;
  requests: number;
  failures: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function SettingsPage() {
  const [keys, setKeys] = useState<KeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/keys`);
      const data = await res.json();
      setKeys(data);
    } catch {
      showToast('error', 'Failed to load keys from proxy.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleAdd = async () => {
    if (!newId.trim() || !newApiKey.trim()) {
      showToast('error', 'Both Key ID and API Key are required.');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/api/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newId.trim(), apiKey: newApiKey.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', data.message);
      setNewId('');
      setNewApiKey('');
      fetchKeys();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to add key.');
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (key: KeyEntry) => {
    const action = key.status === 'disabled' ? 'enable' : 'disable';
    if (action === 'disable' && !confirm(`Disable "${key.id}"? It will stop receiving requests.`)) return;
    setTogglingId(key.id);
    try {
      const res = await fetch(`${API_BASE}/api/keys/${encodeURIComponent(key.id)}/${action}`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', data.message);
      fetchKeys();
    } catch (err: any) {
      showToast('error', err.message || `Failed to ${action} key.`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(`Are you sure you want to remove "${id}" from the pool?`)) return;
    setRemovingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', data.message);
      fetchKeys();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to remove key.');
    } finally {
      setRemovingId(null);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'available': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'busy': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'cooling': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'disabled': return 'text-red-400 bg-red-400/10 border-red-400/20';
      default: return 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20';
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl border shadow-2xl backdrop-blur-sm transition-all duration-300 ${
          toast.type === 'success'
            ? 'bg-emerald-900/80 border-emerald-500/30 text-emerald-100'
            : 'bg-red-900/80 border-red-500/30 text-red-100'
        }`}>
          {toast.type === 'success'
            ? <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your API key pool at runtime</p>
        </div>
        <button
          onClick={fetchKeys}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Add Key Panel */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 backdrop-blur-sm p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Plus className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="font-semibold text-base">Add New API Key</h2>
            <p className="text-sm text-muted-foreground">Key is added to the live pool instantly — no restart needed.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Key ID</label>
            <input
              type="text"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              placeholder="e.g. AEROLINK_KEY_11"
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">API Key</label>
            <div className="relative">
              <input
                type={showNewKey ? 'text' : 'password'}
                value={newApiKey}
                onChange={e => setNewApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="aero_live_..."
                className="w-full px-3 py-2.5 pr-10 rounded-lg bg-zinc-800 border border-zinc-700 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all font-mono"
              />
              <button
                onClick={() => setShowNewKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showNewKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleAdd}
          disabled={adding || !newId.trim() || !newApiKey.trim()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm transition-all"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {adding ? 'Adding...' : 'Add Key'}
        </button>
      </div>

      {/* Current Keys List */}
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-3 p-5 border-b border-zinc-700/60">
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Key className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="font-semibold text-base">Active Key Pool</h2>
            <p className="text-sm text-muted-foreground">{keys.length} key{keys.length !== 1 ? 's' : ''} loaded</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading keys...</span>
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No keys in the pool. Add one above.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {keys.map(key => (
              <div key={key.id} className="flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors group">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                    <Key className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium font-mono truncate">{key.id}</p>
                    <p className="text-xs text-zinc-500 font-mono">{key.apiKey}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${statusColor(key.status)}`}>
                    {key.status}
                  </span>
                  <span className="text-xs text-zinc-500 hidden sm:block">{key.requests} reqs</span>
                  {/* Disable / Enable toggle */}
                  <button
                    onClick={() => handleToggle(key)}
                    disabled={togglingId === key.id}
                    className={`opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50 ${
                      key.status === 'disabled'
                        ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 text-amber-400'
                    }`}
                  >
                    {togglingId === key.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : key.status === 'disabled' ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    {togglingId === key.id ? '...' : key.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                  {/* Remove */}
                  <button
                    onClick={() => handleRemove(key.id)}
                    disabled={removingId === key.id}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium transition-all disabled:opacity-50"
                  >
                    {removingId === key.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                    {removingId === key.id ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
