"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Link2, Unlink, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface AdAccount {
  id: string;
  name: string;
  currency: string;
  status: number;
}

interface Page {
  id: string;
  name: string;
}

interface Connection {
  id: number;
  name: string;
  facebookUserId: string;
  adAccounts: AdAccount[];
  activeAdAccountId: string | null;
  pages: Page[];
  activePageId: string | null;
  pixelId: string | null;
  isActive: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="py-8 text-center text-muted-foreground">Loading...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [pixelInput, setPixelInput] = useState("");
  const searchParams = useSearchParams();

  const fetchConnections = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meta/connection");
      const data = await res.json();
      setConnections(data.connections || []);
    } catch {
      toast.error("Failed to fetch connections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (success === "connected") {
      toast.success("Meta account connected successfully!");
    }
    if (error) {
      toast.error(`Connection failed: ${error}`);
    }
  }, [searchParams]);

  const handleConnect = () => {
    window.location.href = "/api/meta/connect";
  };

  const handleUpdateConnection = async (id: number, updates: Record<string, unknown>) => {
    try {
      await fetch("/api/meta/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updates }),
      });
      toast.success("Settings updated");
      fetchConnections();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDisconnect = async (id: number) => {
    if (!confirm("Are you sure you want to disconnect this Meta account?")) return;
    try {
      await fetch("/api/meta/connection", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      toast.success("Account disconnected");
      fetchConnections();
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  const activeConnection = connections.find((c) => c.isActive);

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-lg font-semibold">Settings</h2>

      {/* Meta Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Meta Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeConnection ? (
            <>
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <p className="font-medium">{activeConnection.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Connected {new Date(activeConnection.createdAt).toLocaleDateString("sv-SE")}
                    {activeConnection.tokenExpiresAt && (
                      <> &middot; Token expires {new Date(activeConnection.tokenExpiresAt).toLocaleDateString("sv-SE")}</>
                    )}
                  </p>
                </div>
                <Badge variant="default" className="ml-auto">Connected</Badge>
              </div>

              <Separator />

              {/* Ad Account Selector */}
              <div className="space-y-2">
                <Label>Active Ad Account</Label>
                <Select
                  value={activeConnection.activeAdAccountId || ""}
                  onValueChange={(v) => handleUpdateConnection(activeConnection.id, { activeAdAccountId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select ad account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeConnection.adAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.id}) - {a.currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Page Selector */}
              <div className="space-y-2">
                <Label>Active Page</Label>
                <Select
                  value={activeConnection.activePageId || ""}
                  onValueChange={(v) => handleUpdateConnection(activeConnection.id, { activePageId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select page..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeConnection.pages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Pixel ID */}
              <div className="space-y-2">
                <Label>Pixel ID (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    value={pixelInput || activeConnection.pixelId || ""}
                    onChange={(e) => setPixelInput(e.target.value)}
                    placeholder="Enter your Meta Pixel ID"
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleUpdateConnection(activeConnection.id, { pixelId: pixelInput })}
                  >
                    Save
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleConnect}>
                  <Link2 className="mr-2 h-4 w-4" /> Reconnect
                </Button>
                <Button variant="destructive" onClick={() => handleDisconnect(activeConnection.id)}>
                  <Unlink className="mr-2 h-4 w-4" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="mb-2 font-medium">No Meta account connected</p>
              <p className="mb-4 text-sm text-muted-foreground">
                Connect your Meta account to start managing ads.
              </p>
              <Button onClick={handleConnect}>
                <ExternalLink className="mr-2 h-4 w-4" /> Connect Meta Account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Other connections */}
      {connections.filter((c) => !c.isActive).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Other Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {connections.filter((c) => !c.isActive).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.adAccounts.length} ad accounts
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleUpdateConnection(c.id, { isActive: true })}>
                    Activate
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDisconnect(c.id)}>
                    <Unlink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
