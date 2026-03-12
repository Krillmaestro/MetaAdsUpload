"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Upload, Image, Video, Search } from "lucide-react";
import { toast } from "sonner";

interface Creative {
  id: number;
  name: string;
  type: string;
  source: string;
  thumbnailUrl: string | null;
  fileSize: number | null;
  tags: string[];
  createdAt: string;
}

export default function CreativesPage() {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchCreatives = async () => {
    const res = await fetch("/api/meta/creatives");
    const data = await res.json();
    setCreatives(data.data || []);
  };

  useEffect(() => { fetchCreatives(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name);
      const res = await fetch("/api/meta/creatives", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      toast.success("Creative uploaded");
      fetchCreatives();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const filtered = creatives.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search creatives..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Uploading..." : "Upload Creative"}
          </Button>
          <input ref={fileRef} type="file" accept="video/*,image/*" className="hidden" onChange={handleUpload} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((c) => (
          <Card key={c.id} className="overflow-hidden">
            <div className="flex aspect-video items-center justify-center bg-muted">
              {c.thumbnailUrl ? (
                <img src={c.thumbnailUrl} alt={c.name} className="h-full w-full object-cover" />
              ) : c.type === "video" ? (
                <Video className="h-12 w-12 text-muted-foreground" />
              ) : (
                <Image className="h-12 w-12 text-muted-foreground" />
              )}
            </div>
            <CardContent className="p-3">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">{c.type}</Badge>
                <Badge variant="outline" className="text-xs">{c.source}</Badge>
              </div>
              {c.fileSize && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {(c.fileSize / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
              {c.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            {creatives.length === 0 ? "No creatives uploaded yet." : "No matches found."}
          </div>
        )}
      </div>
    </div>
  );
}
