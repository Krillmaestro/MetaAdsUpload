"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  SlidersHorizontal,
  Tag,
  Package,
  Film,
  Globe,
  Gift,
  Users,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type OptionType = "angles" | "products" | "formats" | "countries" | "offerTypes" | "customerAvatars";

interface OptionItem {
  id: string;
  name: string;
  code?: string;
  description?: string | null;
  isActive: boolean;
  order: number;
}

interface AllOptions {
  angles: OptionItem[];
  products: OptionItem[];
  formats: OptionItem[];
  countries: OptionItem[];
  offerTypes: OptionItem[];
  customerAvatars: OptionItem[];
}

const TABS_CONFIG: {
  key: OptionType;
  label: string;
  icon: React.ElementType;
  hasCode: boolean;
  hasDescription: boolean;
}[] = [
  { key: "angles", label: "Angles", icon: Tag, hasCode: false, hasDescription: false },
  { key: "products", label: "Products", icon: Package, hasCode: true, hasDescription: false },
  { key: "formats", label: "Formats", icon: Film, hasCode: false, hasDescription: false },
  { key: "countries", label: "Countries", icon: Globe, hasCode: true, hasDescription: false },
  { key: "offerTypes", label: "Offer Types", icon: Gift, hasCode: false, hasDescription: false },
  { key: "customerAvatars", label: "Avatars", icon: Users, hasCode: true, hasDescription: true },
];

function getApiPath(type: OptionType): string {
  const map: Record<OptionType, string> = {
    angles: "angles",
    products: "products",
    formats: "formats",
    countries: "countries",
    offerTypes: "offer-types",
    customerAvatars: "customer-avatars",
  };
  return map[type];
}

export default function OptionsPage() {
  const [options, setOptions] = useState<AllOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OptionType>("angles");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ name: "", code: "", description: "" });

  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", code: "", description: "" });
  const [creating, setCreating] = useState(false);

  const fetchOptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/options");
      if (!res.ok) throw new Error("Failed to fetch options");
      const data = await res.json();
      setOptions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);

  const currentConfig = TABS_CONFIG.find((t) => t.key === activeTab)!;
  const currentItems = options ? (options[activeTab] as OptionItem[]) || [] : [];

  const handleCreate = async () => {
    if (!newItem.name.trim()) return;
    if (currentConfig.hasCode && !newItem.code.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, string | undefined> = { name: newItem.name };
      if (currentConfig.hasCode) body.code = newItem.code;
      if (currentConfig.hasDescription) body.description = newItem.description || undefined;
      const res = await fetch(`/api/options/${getApiPath(activeTab)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create");
      setNewItem({ name: "", code: "", description: "" });
      setShowCreate(false);
      fetchOptions();
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      const body: Record<string, string | undefined> = { name: editValues.name };
      if (currentConfig.hasCode) body.code = editValues.code;
      if (currentConfig.hasDescription) body.description = editValues.description || undefined;
      const res = await fetch(`/api/options/${getApiPath(activeTab)}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");
      setEditingId(null);
      fetchOptions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/options/${getApiPath(activeTab)}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
      fetchOptions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this option?")) return;
    try {
      const res = await fetch(`/api/options/${getApiPath(activeTab)}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      fetchOptions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReorder = async (id: string, direction: "up" | "down") => {
    const idx = currentItems.findIndex((item) => item.id === id);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === currentItems.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const swapItem = currentItems[swapIdx];
    try {
      await Promise.all([
        fetch(`/api/options/${getApiPath(activeTab)}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: swapItem.order }),
        }),
        fetch(`/api/options/${getApiPath(activeTab)}/${swapItem.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: currentItems[idx].order }),
        }),
      ]);
      fetchOptions();
    } catch (err) {
      console.error(err);
    }
  };

  const startEdit = (item: OptionItem) => {
    setEditingId(item.id);
    setEditValues({ name: item.name, code: item.code || "", description: item.description || "" });
  };

  if (loading && !options) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (error && !options) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="rounded-xl border border-white/5 bg-[#111827] p-8 text-center">
          <AlertCircle className="h-12 w-12 text-yellow-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Could not load options</h2>
          <p className="text-slate-500 mb-4">{error}</p>
          <button
            onClick={fetchOptions}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <SlidersHorizontal className="h-6 w-6 text-cyan-400" />
            Options Manager
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage dropdown options for assignments</p>
        </div>
        <button
          onClick={fetchOptions}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/5">
        {TABS_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const count = options ? (options[tab.key] as OptionItem[])?.length || 0 : 0;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all",
                active
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              <span className={cn(
                "text-[10px] px-1.5 py-0 rounded-full ml-0.5",
                active ? "bg-cyan-500/20 text-cyan-400" : "bg-white/5 text-slate-500"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{currentConfig.label}</h3>
          <button
            onClick={() => {
              setShowCreate(true);
              setNewItem({ name: "", code: "", description: "" });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-xs font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {currentConfig.label.replace(/s$/, "")}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Name</th>
                {currentConfig.hasCode && (
                  <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Code</th>
                )}
                {currentConfig.hasDescription && (
                  <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Description</th>
                )}
                <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3 w-[80px]">Active</th>
                <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3 w-[80px]">Order</th>
                <th className="text-right text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3 w-[120px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + (currentConfig.hasCode ? 1 : 0) + (currentConfig.hasDescription ? 1 : 0)}
                    className="text-center py-8 text-slate-500"
                  >
                    No {currentConfig.label.toLowerCase()} yet
                  </td>
                </tr>
              ) : (
                currentItems.map((item, i) => (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-white/5 hover:bg-white/[0.02] transition-colors",
                      !item.isActive && "opacity-50",
                      i % 2 === 0 ? "bg-white/[0.01]" : ""
                    )}
                  >
                    <td className="px-4 py-3">
                      {editingId === item.id ? (
                        <Input
                          value={editValues.name}
                          onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                          className="h-8 bg-white/5 border-white/10"
                        />
                      ) : (
                        <span className="font-medium text-white">{item.name}</span>
                      )}
                    </td>
                    {currentConfig.hasCode && (
                      <td className="px-4 py-3">
                        {editingId === item.id ? (
                          <Input
                            value={editValues.code}
                            onChange={(e) => setEditValues({ ...editValues, code: e.target.value })}
                            className="h-8 w-24 bg-white/5 border-white/10"
                          />
                        ) : (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
                            {item.code}
                          </span>
                        )}
                      </td>
                    )}
                    {currentConfig.hasDescription && (
                      <td className="px-4 py-3">
                        {editingId === item.id ? (
                          <Input
                            value={editValues.description}
                            onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                            className="h-8 bg-white/5 border-white/10"
                          />
                        ) : (
                          <span className="text-sm text-slate-500">{item.description || "-"}</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Switch
                        checked={item.isActive}
                        onCheckedChange={(checked) => handleToggleActive(item.id, checked)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => handleReorder(item.id, "up")}
                          className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleReorder(item.id, "down")}
                          className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === item.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleUpdate(item.id)}
                            className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-400 transition-all"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded hover:bg-white/5 text-slate-400 transition-all"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(item)}
                            className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 rounded hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="w-[92vw] sm:max-w-md bg-[#111827] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Add {currentConfig.label.replace(/s$/, "")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Name</label>
              <Input
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                placeholder="Name"
                autoFocus
                className="bg-white/5 border-white/10 placeholder:text-slate-600"
              />
            </div>
            {currentConfig.hasCode && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Code</label>
                <Input
                  value={newItem.code}
                  onChange={(e) => setNewItem({ ...newItem, code: e.target.value })}
                  placeholder="Code (e.g. SE, LP)"
                  className="bg-white/5 border-white/10 placeholder:text-slate-600"
                />
              </div>
            )}
            {currentConfig.hasDescription && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Description</label>
                <Input
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  placeholder="Description (optional)"
                  className="bg-white/5 border-white/10 placeholder:text-slate-600"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
