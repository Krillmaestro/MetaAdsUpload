"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Play, Zap } from "lucide-react";
import { toast } from "sonner";

interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  level: string;
  conditions: Array<{ metric: string; operator: string; value: number; timeRange: string }>;
  action: { type: string; value?: number };
  cooldownHours: number;
}

interface Execution {
  id: number;
  ruleId: number;
  entityId: string;
  actionTaken: string;
  executedAt: string;
}

const presetRules = [
  { name: "Scale Winner", level: "adset", conditions: [{ metric: "roas", operator: ">", value: 2.0, timeRange: "7d" }, { metric: "spend", operator: ">", value: 500, timeRange: "7d" }], action: { type: "adjust_budget", value: 20 }, cooldownHours: 24 },
  { name: "Pause Loser", level: "adset", conditions: [{ metric: "roas", operator: "<", value: 0.5, timeRange: "3d" }, { metric: "spend", operator: ">", value: 300, timeRange: "3d" }], action: { type: "pause" }, cooldownHours: 24 },
  { name: "High CPA Alert", level: "adset", conditions: [{ metric: "cpa", operator: ">", value: 200, timeRange: "7d" }, { metric: "purchases", operator: ">=", value: 3, timeRange: "7d" }], action: { type: "alert" }, cooldownHours: 48 },
  { name: "Reduce Underperformer", level: "adset", conditions: [{ metric: "roas", operator: "<", value: 1.0, timeRange: "7d" }, { metric: "spend", operator: ">", value: 200, timeRange: "7d" }], action: { type: "adjust_budget", value: -30 }, cooldownHours: 48 },
];

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    level: "adset",
    conditions: [{ metric: "roas", operator: ">", value: 2.0, timeRange: "7d" }],
    action: { type: "pause", value: undefined as number | undefined },
    cooldownHours: 24,
  });

  const fetch_ = async () => {
    const res = await fetch("/api/rules");
    const data = await res.json();
    setRules(data.rules || []);
    setExecutions(data.executions || []);
  };

  useEffect(() => { fetch_(); }, []);

  const createRule = async (ruleData?: typeof presetRules[0]) => {
    const payload = ruleData || form;
    try {
      await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success("Rule created");
      setDialogOpen(false);
      fetch_();
    } catch {
      toast.error("Failed to create rule");
    }
  };

  const toggleRule = async (id: number, enabled: boolean) => {
    await fetch("/api/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    fetch_();
  };

  const deleteRule = async (id: number) => {
    await fetch("/api/rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Rule deleted");
    fetch_();
  };

  const runRules = async () => {
    try {
      const res = await fetch("/api/cron/run-rules", { method: "POST" });
      const data = await res.json();
      toast.success(`Rules executed: ${data.results?.length || 0} actions taken`);
      fetch_();
    } catch {
      toast.error("Failed to run rules");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Automation Rules</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={runRules}>
            <Play className="mr-2 h-4 w-4" /> Run Now
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 h-4 w-4" /> New Rule
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Rule</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Rule Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Level</Label>
                  <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="campaign">Campaign</SelectItem>
                      <SelectItem value="adset">Ad Set</SelectItem>
                      <SelectItem value="ad">Ad</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select value={form.action.type} onValueChange={(v) => setForm({ ...form, action: { ...form.action, type: v } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pause">Pause</SelectItem>
                      <SelectItem value="activate">Activate</SelectItem>
                      <SelectItem value="adjust_budget">Adjust Budget</SelectItem>
                      <SelectItem value="alert">Alert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.action.type === "adjust_budget" && (
                  <div className="space-y-2">
                    <Label>Budget Change (%)</Label>
                    <Input type="number" value={form.action.value || 0} onChange={(e) => setForm({ ...form, action: { ...form.action, value: Number(e.target.value) } })} />
                  </div>
                )}
                <Button className="w-full" onClick={() => createRule()}>Create Rule</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Preset rules */}
      <Card>
        <CardHeader><CardTitle className="text-base">Quick Add Presets</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {presetRules.map((p) => (
            <Button key={p.name} variant="outline" size="sm" onClick={() => createRule(p)}>
              <Zap className="mr-1 h-3 w-3" /> {p.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Active rules */}
      <div className="grid gap-4 md:grid-cols-2">
        {rules.map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{r.name}</CardTitle>
              <div className="flex items-center gap-2">
                <Switch checked={r.enabled} onCheckedChange={(v) => toggleRule(r.id, v)} />
                <Button variant="ghost" size="sm" onClick={() => deleteRule(r.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Badge variant="outline">{r.level}</Badge>
                <Badge variant={r.enabled ? "default" : "secondary"}>{r.enabled ? "Active" : "Disabled"}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>If: {r.conditions.map((c) => `${c.metric} ${c.operator} ${c.value} (${c.timeRange})`).join(" AND ")}</p>
                <p>Then: {r.action.type}{r.action.value ? ` ${r.action.value}%` : ""}</p>
                <p>Cooldown: {r.cooldownHours}h</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Execution log */}
      {executions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Executions</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.slice(-20).reverse().map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{new Date(e.executedAt).toLocaleString("sv-SE")}</TableCell>
                    <TableCell className="text-sm font-mono">{e.entityId}</TableCell>
                    <TableCell className="text-sm">{e.actionTaken}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
