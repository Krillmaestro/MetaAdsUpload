"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Trash2, CalendarIcon, Loader2, ChevronDown, Save, X, LayoutTemplate, BookmarkPlus, FlaskConical } from "lucide-react";
import { AWARENESS_LEVELS } from "@/components/learning-loop/format";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  EditorAssignment,
  AssignmentPriority,
  ScriptContent,
} from "@/components/assignments/assignment-card";

// ─── Types ───────────────────────────────────────────────────────────────────

interface OptionItem {
  id: string;
  name: string;
  code?: string;
  description?: string | null;
  isActive?: boolean;
}

interface AllOptions {
  angles: OptionItem[];
  problems: OptionItem[];
  products: OptionItem[];
  formats: OptionItem[];
  countries: OptionItem[];
  offerTypes: OptionItem[];
  customerAvatars: OptionItem[];
  scriptStructures: OptionItem[];
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role?: string;
  userType?: string;
}

interface AssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment?: EditorAssignment | null;
  onSaved: () => void;
}

interface FormState {
  batchNumber: string;
  version: string;
  formatId: string;
  angleId: string;
  productId: string;
  countryId: string;
  offerTypeId: string;
  scriptStructureId: string;
  customerAvatarIds: string[];
  landingPage: string;
  assignedToId: string;
  creativeStrategistId: string;
  creativeStrategistName: string;
  priority: AssignmentPriority;
  dueDate: string | undefined;
  description: string;
  briefContent: string;
  references: Array<{ id: string; kind: "url" | "library" | "file"; value: string; label?: string; note?: string }>;
  // Learning Loop — the brief as a test
  problemId: string;
  hypothesis: string;
  variableTested: string;
  adType: string; // "" | "ideation" | "iteration"
  iterationOfId: string;
  awarenessLevel: string;
  publishTemplateId: number | null;
}

/** A saved brief template — every recurring field of the form, so one pick fills it all. */
interface BriefTemplate {
  id: string;
  name: string;
  briefContent: string | null;
  formatId: string | null;
  angleId: string | null;
  productId: string | null;
  countryId: string | null;
  offerTypeId: string | null;
  scriptStructureId: string | null;
  customerAvatarIds: string[] | null;
  estimatedMinutes: number | null;
  priority: string | null;
  references: FormState["references"] | null;
  scriptContent: ScriptContent | null;
  problemId: string | null;
  landingPage: string | null;
  assignedToId: string | null;
  creativeStrategistId: string | null;
  creativeStrategistName: string | null;
  description: string | null;
  hypothesis: string | null;
  variableTested: string | null;
  adType: string | null;
  awarenessLevel: string | null;
  publishTemplateId: number | null;
  useCount: number;
}

interface PublishTemplate { id: number; name: string; productName?: string | null }
interface AssignmentLite { id: string; batchNumber: number; autoName: string | null; title: string; status: string }

const PRIORITIES: { value: AssignmentPriority; label: string; color: string }[] = [
  { value: "URGENT", label: "Urgent", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { value: "HIGH", label: "High", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { value: "MEDIUM", label: "Medium", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "LOW", label: "Low", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
];

const DRAFT_KEY_PREFIX = "assignment-draft";

function getDraftKey(assignmentId?: string | null) {
  return assignmentId ? `${DRAFT_KEY_PREFIX}-${assignmentId}` : `${DRAFT_KEY_PREFIX}-new`;
}

function saveDraft(key: string, form: FormState, script: ScriptContent) {
  try {
    localStorage.setItem(key, JSON.stringify({ form, script, savedAt: Date.now() }));
  } catch { /* quota exceeded, ignore */ }
}

function loadDraft(key: string): { form: FormState; script: ScriptContent; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Discard drafts older than 24h
    if (Date.now() - data.savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

const emptyForm: FormState = {
  batchNumber: "",
  version: "1",
  formatId: "",
  angleId: "",
  productId: "",
  countryId: "",
  offerTypeId: "",
  scriptStructureId: "",
  customerAvatarIds: [],
  landingPage: "",
  assignedToId: "",
  creativeStrategistId: "",
  creativeStrategistName: "",
  priority: "MEDIUM",
  dueDate: undefined,
  description: "",
  briefContent: "",
  references: [],
  problemId: "",
  hypothesis: "",
  variableTested: "",
  adType: "",
  iterationOfId: "",
  awarenessLevel: "",
  publishTemplateId: null,
};

/** Learning Loop fields read from a saved assignment (all optional on older rows). */
function loopFields(a: EditorAssignment): Pick<FormState, "problemId" | "hypothesis" | "variableTested" | "adType" | "iterationOfId" | "awarenessLevel" | "publishTemplateId"> {
  return {
    problemId: a.problemId || "",
    hypothesis: a.hypothesis || "",
    variableTested: a.variableTested || "",
    adType: a.adType || "",
    iterationOfId: a.iterationOfId || "",
    awarenessLevel: a.awarenessLevel || "",
    publishTemplateId: typeof a.publishTemplateId === "number" ? a.publishTemplateId : null,
  };
}

const emptyScript: ScriptContent = {
  hooks: [{ id: "h1", label: "H1", eng: "", se: "" }],
  body: { eng: "", se: "" },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function AddOptionPopover({
  type, label, needsCode, onCreated,
}: {
  type: string; label: string; needsCode?: boolean; onCreated: (item: OptionItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    if (needsCode && !code.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, string> = { name: name.trim() };
      if (needsCode) body.code = code.trim();
      const res = await fetch(`/api/options/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      const item = await res.json();
      onCreated(item);
      setName(""); setCode(""); setOpen(false);
      toast.success(`${label} created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally { setSaving(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="h-7 w-7 rounded-md border border-dashed border-white/10 flex items-center justify-center text-slate-500 hover:text-cyan-400 hover:border-cyan-500/30 transition-all shrink-0"
        title={`Add new ${label.toLowerCase()}`}
      >
        <Plus className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-64 bg-[#111827] border-white/10 p-3" align="end">
        <p className="text-xs font-medium text-slate-400 mb-2">New {label}</p>
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            className="h-7 text-xs bg-white/5 border-white/10" autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
          {needsCode && (
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (e.g. SE)"
              className="h-7 text-xs bg-white/5 border-white/10"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
          )}
          <Button type="button" size="sm" className="w-full h-7 text-xs bg-cyan-600 hover:bg-cyan-500 text-white"
            onClick={handleCreate} disabled={saving || !name.trim() || (needsCode && !code.trim())}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionSelect({
  value, onChange, items, placeholder, label, apiType, needsCode,
  onOptionsRefresh, showCode, required,
}: {
  value: string; onChange: (v: string) => void; items: OptionItem[];
  placeholder: string; label: string; apiType: string; needsCode?: boolean;
  onOptionsRefresh: () => void; showCode?: boolean; required?: boolean;
}) {
  const selectedItem = items.find((i) => i.id === value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {label}{required && <span className="text-cyan-400 ml-0.5">*</span>}
        </Label>
        <AddOptionPopover type={apiType} label={label} needsCode={needsCode}
          onCreated={() => onOptionsRefresh()} />
      </div>
      <Select value={value || "___none___"} onValueChange={(v) => onChange(v === "___none___" ? "" : v)}>
        <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10">
          <span className={!selectedItem ? "text-slate-600" : "text-white"}>
            {selectedItem
              ? showCode && selectedItem.code ? `${selectedItem.code} — ${selectedItem.name}` : selectedItem.name
              : placeholder}
          </span>
        </SelectTrigger>
        <SelectContent className="bg-[#111827] border-white/10">
          <SelectItem value="___none___" className="text-slate-600">— None —</SelectItem>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {showCode && item.code ? `${item.code} — ${item.name}` : item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AssignmentModal({ open, onOpenChange, assignment, onSaved }: AssignmentModalProps) {
  const [options, setOptions] = useState<AllOptions | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [showAvatars, setShowAvatars] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [script, setScript] = useState<ScriptContent>(emptyScript);
  const [uploadingRef, setUploadingRef] = useState(false);
  const refFileInput = useRef<HTMLInputElement>(null);

  // Upload raw source material (video/image) to the cloud and attach as reference
  const uploadRefFile = async (file: File) => {
    setUploadingRef(true);
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          purpose: "brief",
          assignmentId: assignment?.id,
        }),
      });
      if (!presignRes.ok) throw new Error("Could not prepare upload");
      const { uploadUrl, publicUrl } = await presignRes.json();
      const putRes = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      setForm((prev) => ({
        ...prev,
        references: [...prev.references, { id: crypto.randomUUID(), kind: "file" as const, value: publicUrl, label: file.name }],
      }));
      scheduleDraftSave();
      toast.success(`${file.name} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingRef(false);
      if (refFileInput.current) refFileInput.current.value = "";
    }
  };

  const draftKey = getDraftKey(assignment?.id);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  const scriptRef = useRef(script);
  formRef.current = form;
  scriptRef.current = script;

  // ─── Auto-save to server (for existing assignments) ───
  const saveToServer = useCallback(async () => {
    if (!assignment) return;
    const f = formRef.current;
    const s = scriptRef.current;
    const hasScriptContent = s.hooks.some((h) => h.eng || h.se) || s.body.eng || s.body.se;

    const payload: Record<string, unknown> = {};
    if (f.batchNumber && parseInt(f.batchNumber) > 0) payload.batchNumber = parseInt(f.batchNumber);
    if (parseInt(f.version) > 0) payload.version = parseInt(f.version);
    payload.formatId = f.formatId || null;
    payload.angleId = f.angleId || null;
    payload.productId = f.productId || null;
    payload.countryId = f.countryId || null;
    payload.offerTypeId = f.offerTypeId || null;
    payload.scriptStructureId = f.scriptStructureId || null;
    payload.customerAvatarIds = f.customerAvatarIds;
    payload.landingPage = f.landingPage || null;
    if (f.assignedToId) payload.assignedToId = f.assignedToId;
    payload.creativeStrategistId = f.creativeStrategistId || null;
    payload.creativeStrategistName = f.creativeStrategistName || null;
    payload.priority = f.priority;
    payload.dueDate = f.dueDate ? new Date(f.dueDate).toISOString().split("T")[0] : null;
    payload.description = f.description || null;
    payload.briefContent = f.briefContent || null;
    payload.references = f.references;
    payload.scriptContent = hasScriptContent ? s : null;
    payload.problemId = f.problemId || null;
    payload.hypothesis = f.hypothesis || null;
    payload.variableTested = f.variableTested || null;
    payload.adType = f.adType || null;
    payload.iterationOfId = f.adType === "iteration" ? f.iterationOfId || null : null;
    payload.awarenessLevel = f.awarenessLevel || null;
    payload.publishTemplateId = f.publishTemplateId;

    try {
      await fetch(`/api/assignments/${assignment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch { /* silent auto-save failure */ }
  }, [assignment]);

  // ─── Auto-save draft to localStorage + server ───
  const scheduleDraftSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(draftKey, formRef.current, scriptRef.current);
    }, 500);

    // Also auto-save to server when editing an existing assignment
    if (assignment) {
      if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
      serverSaveTimerRef.current = setTimeout(() => {
        saveToServer();
      }, 1000);
    }
  }, [draftKey, assignment, saveToServer]);

  // Update form with auto-save
  const updateForm = useCallback((updates: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    scheduleDraftSave();
  }, [scheduleDraftSave]);

  const updateScript = useCallback((updater: (prev: ScriptContent) => ScriptContent) => {
    setScript((prev) => {
      const next = updater(prev);
      return next;
    });
    scheduleDraftSave();
  }, [scheduleDraftSave]);

  // ─── Fetch options + users (+ templates for the template bar) ───
  const fetchOptions = () => fetch("/api/options").then((r) => r.json());

  const [briefTemplates, setBriefTemplates] = useState<BriefTemplate[]>([]);
  const [publishTemplates, setPublishTemplates] = useState<PublishTemplate[]>([]);
  const [allAssignments, setAllAssignments] = useState<AssignmentLite[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const fetchBriefTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/brief-templates");
      if (res.ok) setBriefTemplates(((await res.json()).templates ?? []) as BriefTemplate[]);
    } catch { /* template bar just stays empty */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    setOptionsLoading(true);
    setSelectedTemplateId("");
    Promise.all([fetchOptions(), fetch("/api/users").then((r) => r.json())])
      .then(([opts, usersData]) => { setOptions(opts); setUsers(usersData.users || []); })
      .catch(console.error)
      .finally(() => setOptionsLoading(false));
    fetchBriefTemplates();
    fetch("/api/templates").then((r) => r.json()).then((d) => setPublishTemplates((d.data ?? []) as PublishTemplate[])).catch(() => {});
    fetch("/api/assignments").then((r) => r.json()).then((d) => setAllAssignments(Array.isArray(d) ? d.filter((a: AssignmentLite) => a.status !== "DRAFT") : [])).catch(() => {});
  }, [open, fetchBriefTemplates]);

  // ─── Template bar: apply / save / delete ───
  const templateFromForm = (name: string) => {
    const f = formRef.current;
    const s = scriptRef.current;
    const hasScript = s.hooks.some((h) => h.eng || h.se) || s.body.eng || s.body.se;
    return {
      name,
      briefContent: f.briefContent || null,
      formatId: f.formatId || null,
      angleId: f.angleId || null,
      productId: f.productId || null,
      countryId: f.countryId || null,
      offerTypeId: f.offerTypeId || null,
      scriptStructureId: f.scriptStructureId || null,
      customerAvatarIds: f.customerAvatarIds,
      priority: f.priority.toLowerCase(),
      references: f.references,
      scriptContent: hasScript ? s : null,
      problemId: f.problemId || null,
      landingPage: f.landingPage || null,
      assignedToId: f.assignedToId || null,
      creativeStrategistId: f.creativeStrategistId || null,
      creativeStrategistName: f.creativeStrategistName || null,
      description: f.description || null,
      hypothesis: f.hypothesis || null,
      variableTested: f.variableTested || null,
      adType: f.adType || null,
      awarenessLevel: f.awarenessLevel || null,
      publishTemplateId: f.publishTemplateId,
    };
  };

  const applyTemplate = (t: BriefTemplate) => {
    // Everything except batch number, version and due date — those are per brief.
    updateForm({
      formatId: t.formatId ?? "",
      angleId: t.angleId ?? "",
      productId: t.productId ?? "",
      countryId: t.countryId ?? "",
      offerTypeId: t.offerTypeId ?? "",
      scriptStructureId: t.scriptStructureId ?? "",
      customerAvatarIds: t.customerAvatarIds ?? [],
      landingPage: t.landingPage ?? "",
      assignedToId: t.assignedToId ?? formRef.current.assignedToId,
      creativeStrategistId: t.creativeStrategistId ?? "",
      creativeStrategistName: t.creativeStrategistName ?? "",
      priority: ((t.priority ?? "medium").toUpperCase() as AssignmentPriority),
      description: t.description ?? "",
      briefContent: t.briefContent ?? "",
      references: (t.references ?? []).map((r) => ({ ...r, id: crypto.randomUUID() })),
      problemId: t.problemId ?? "",
      hypothesis: t.hypothesis ?? "",
      variableTested: t.variableTested ?? "",
      adType: t.adType ?? "",
      awarenessLevel: t.awarenessLevel ?? "",
      publishTemplateId: t.publishTemplateId ?? null,
    });
    if (t.scriptContent) setScript(t.scriptContent);
    if (t.customerAvatarIds?.length) setShowAvatars(true);
    setSelectedTemplateId(t.id);
    void fetch(`/api/brief-templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ used: true }) });
    toast.success(`Mall "${t.name}" ifylld`, { description: "Fyll i batch och datum, justera vid behov." });
  };

  const saveTemplate = async (existingId?: string) => {
    const name = (existingId ? briefTemplates.find((t) => t.id === existingId)?.name : templateName)?.trim();
    if (!name) return;
    setSavingTemplate(true);
    try {
      const res = await fetch(existingId ? `/api/brief-templates/${existingId}` : "/api/brief-templates", {
        method: existingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateFromForm(name)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara mallen");
      const saved = await res.json();
      await fetchBriefTemplates();
      setSelectedTemplateId(saved.id ?? existingId ?? "");
      setTemplateName("");
      setTemplatePopoverOpen(false);
      toast.success(existingId ? `Mallen "${name}" uppdaterad` : `Mall "${name}" sparad`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara mallen");
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    const t = briefTemplates.find((x) => x.id === id);
    if (!t || !window.confirm(`Ta bort mallen "${t.name}"?`)) return;
    try {
      const res = await fetch(`/api/brief-templates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Kunde inte ta bort");
      setSelectedTemplateId("");
      await fetchBriefTemplates();
      toast.success("Mall borttagen");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte ta bort");
    }
  };

  const selectedTemplate = briefTemplates.find((t) => t.id === selectedTemplateId) ?? null;

  // ─── Initialize form state ───
  useEffect(() => {
    if (!open) return;

    if (assignment && assignment.status === "DRAFT") {
      // Draft assignment — show empty form but with assignment ID linked
      // Try restoring localStorage draft for this draft ID first
      const draft = loadDraft(getDraftKey(assignment.id));
      if (draft) {
        setForm(draft.form);
        setScript(draft.script);
        setDraftRestored(true);
        if (draft.form.customerAvatarIds?.length) setShowAvatars(true);
      } else {
        // No local draft — fall back to server-saved values (drafts auto-save
        // to the server), so reopening a draft doesn't look like work was lost.
        const briefContent = (assignment as { briefContent?: string | null }).briefContent || "";
        const references = (assignment as { references?: FormState["references"] }).references || [];
        const hasSavedContent =
          assignment.batchNumber > 0 || !!briefContent || !!assignment.description ||
          !!assignment.formatId || !!assignment.scriptContent || references.length > 0;
        if (hasSavedContent) {
          setForm({
            batchNumber: assignment.batchNumber > 0 ? assignment.batchNumber.toString() : "",
            version: assignment.version.toString(),
            formatId: assignment.formatId || "",
            angleId: assignment.angleId || "",
            productId: assignment.productId || "",
            countryId: assignment.countryId || "",
            offerTypeId: assignment.offerTypeId || "",
            scriptStructureId: assignment.scriptStructureId || "",
            customerAvatarIds: assignment.customerAvatars || [],
            landingPage: assignment.landingPage || "",
            // Drafts are auto-assigned to their creator; don't prefill that as the editor
            assignedToId: assignment.assignedToId === assignment.assignedById ? "" : assignment.assignedToId,
            creativeStrategistId: assignment.creativeStrategistId || "",
            creativeStrategistName: assignment.creativeStrategistName || "",
            priority: assignment.priority,
            dueDate: assignment.dueDate ? new Date(assignment.dueDate).toISOString() : undefined,
            description: assignment.description || "",
            briefContent,
            references,
            ...loopFields(assignment),
          });
          setScript(assignment.scriptContent || { ...emptyScript, hooks: [{ id: "h1", label: "H1", eng: "", se: "" }] });
          if (assignment.customerAvatars?.length) setShowAvatars(true);
        } else {
          setForm({ ...emptyForm });
          setScript({ ...emptyScript, hooks: [{ id: "h1", label: "H1", eng: "", se: "" }] });
        }
        setDraftRestored(false);
      }
    } else if (assignment) {
      setForm({
        batchNumber: assignment.batchNumber.toString(),
        version: assignment.version.toString(),
        formatId: assignment.formatId || "",
        angleId: assignment.angleId || "",
        productId: assignment.productId || "",
        countryId: assignment.countryId || "",
        offerTypeId: assignment.offerTypeId || "",
        scriptStructureId: assignment.scriptStructureId || "",
        customerAvatarIds: assignment.customerAvatars || [],
        landingPage: assignment.landingPage || "",
        assignedToId: assignment.assignedToId,
        creativeStrategistId: assignment.creativeStrategistId || "",
        creativeStrategistName: assignment.creativeStrategistName || "",
        priority: assignment.priority,
        dueDate: assignment.dueDate ? new Date(assignment.dueDate).toISOString() : undefined,
        description: assignment.description || "",
        briefContent: (assignment as { briefContent?: string | null }).briefContent || "",
        references: (assignment as { references?: FormState["references"] }).references || [],
        ...loopFields(assignment),
      });
      if (assignment.scriptContent) {
        setScript(assignment.scriptContent);
      } else {
        setScript({ ...emptyScript, hooks: [{ id: "h1", label: "H1", eng: "", se: "" }] });
      }
      if (assignment.customerAvatars?.length) setShowAvatars(true);
    } else {
      // New assignment — try restoring draft first, then last-submitted values
      const draft = loadDraft(getDraftKey(null));
      if (draft) {
        setForm(draft.form);
        setScript(draft.script);
        setDraftRestored(true);
        if (draft.form.customerAvatarIds?.length) setShowAvatars(true);
        toast.info("Draft restored", { description: "Your previous unsaved work was recovered." });
      } else {
        // Check for last-submitted values to prefill
        let prefilled = false;
        try {
          const lastRaw = localStorage.getItem("assignment-last-submitted");
          if (lastRaw) {
            const { form: lastForm, script: lastScript } = JSON.parse(lastRaw);
            setForm({ ...lastForm, batchNumber: "", description: "", dueDate: undefined });
            setScript(lastScript);
            if (lastForm.customerAvatarIds?.length) setShowAvatars(true);
            prefilled = true;
          }
        } catch { /* ignore parse errors */ }
        if (!prefilled) {
          setForm({ ...emptyForm });
          setScript({ ...emptyScript, hooks: [{ id: "h1", label: "H1", eng: "", se: "" }] });
        }
        setDraftRestored(false);
      }
    }
  }, [assignment, open]);

  // ─── Cleanup timers on unmount ───
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (serverSaveTimerRef.current) clearTimeout(serverSaveTimerRef.current);
    };
  }, []);

  const refreshOptions = async () => { const opts = await fetchOptions(); setOptions(opts); };

  const allEditors = users.filter((u) => u.role?.toLowerCase() === "editor" || u.role?.toLowerCase() === "employee");
  const videoEditors = allEditors.filter((u) => !u.userType || u.userType === "video_editor" || u.userType === "editor");
  const creativeStrategists = allEditors.filter((u) => u.userType === "creative_strategist");
  const admins = users.filter((u) => u.role?.toLowerCase() === "admin");
  const selectedEditor = users.find((u) => u.id === form.assignedToId);
  const selectedStrategist = users.find((u) => u.id === form.creativeStrategistId);

  // ─── Hook helpers ───
  const addHook = () => {
    const num = script.hooks.length + 1;
    updateScript((prev) => ({
      ...prev,
      hooks: [...prev.hooks, { id: `h${Date.now()}`, label: `H${num}`, eng: "", se: "" }],
    }));
  };

  const removeHook = (id: string) => {
    updateScript((prev) => ({ ...prev, hooks: prev.hooks.filter((h) => h.id !== id) }));
  };

  const updateHook = (id: string, field: "eng" | "se", value: string) => {
    updateScript((prev) => ({
      ...prev,
      hooks: prev.hooks.map((h) => (h.id === id ? { ...h, [field]: value } : h)),
    }));
  };

  const toggleCustomerAvatar = (avatarId: string) => {
    updateForm({
      customerAvatarIds: form.customerAvatarIds.includes(avatarId)
        ? form.customerAvatarIds.filter((a) => a !== avatarId)
        : [...form.customerAvatarIds, avatarId],
    });
  };

  const isDraftAssignment = assignment?.status === "DRAFT";

  // ─── Submit ───
  const handleSubmit = async () => {
    if (!form.batchNumber || !form.assignedToId) {
      toast.error("Batch number and editor are required");
      return;
    }

    setSaving(true);
    const hasScriptContent = script.hooks.some((h) => h.eng || h.se) || script.body.eng || script.body.se;

    const payload = {
      batchNumber: parseInt(form.batchNumber),
      version: parseInt(form.version) || 1,
      formatId: form.formatId || undefined,
      angleId: form.angleId || undefined,
      productId: form.productId || undefined,
      countryId: form.countryId || undefined,
      offerTypeId: form.offerTypeId || undefined,
      scriptStructureId: form.scriptStructureId || undefined,
      customerAvatarIds: form.customerAvatarIds,
      landingPage: form.landingPage || undefined,
      assignedToId: form.assignedToId,
      creativeStrategistId: form.creativeStrategistId || undefined,
      creativeStrategistName: form.creativeStrategistName || undefined,
      priority: form.priority,
      dueDate: form.dueDate ? format(new Date(form.dueDate), "yyyy-MM-dd") : undefined,
      description: form.description || undefined,
      briefContent: form.briefContent || undefined,
      references: form.references,
      scriptContent: hasScriptContent ? script : undefined,
      problemId: form.problemId || undefined,
      hypothesis: form.hypothesis || undefined,
      variableTested: form.variableTested || undefined,
      adType: form.adType || undefined,
      iterationOfId: form.adType === "iteration" ? form.iterationOfId || undefined : undefined,
      awarenessLevel: form.awarenessLevel || undefined,
      publishTemplateId: form.publishTemplateId ?? undefined,
    };

    try {
      const url = assignment ? `/api/assignments/${assignment.id}` : "/api/assignments";
      const method = assignment ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Save failed");
      }

      // If this was a draft, move it to ready_for_editing
      if (isDraftAssignment && assignment) {
        const statusRes = await fetch(`/api/assignments/${assignment.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "READY_FOR_EDITING" }),
        });
        if (!statusRes.ok) {
          const data = await statusRes.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Saved, but could not move out of Draft");
        }
      }

      toast.success(isDraftAssignment ? "Assignment created" : assignment ? "Assignment updated" : "Assignment created");
      clearDraft(draftKey);
      // Save last-submitted values for prefilling next new assignment
      if (!assignment) {
        try {
          const lastSubmitted = { ...formRef.current, batchNumber: "", description: "", dueDate: undefined };
          localStorage.setItem("assignment-last-submitted", JSON.stringify({ form: lastSubmitted, script: scriptRef.current }));
        } catch { /* quota exceeded, ignore */ }
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  };

  // ─── Keyboard shortcut: Cmd+Enter to save ───
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ─── Handle close with confirmation ───
  const handleClose = () => {
    // Draft is already auto-saved, just close
    onOpenChange(false);
  };

  if (!open) return null;

  // ─── Render ───
  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal — bypassing the base Dialog entirely to avoid grid/overflow issues */}
      <div className="absolute inset-3 flex items-stretch justify-center">
        <div className="relative w-full bg-[#0d1117] border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>

          {/* ─── Header ─── */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-white/[0.06] shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {isDraftAssignment ? "New Assignment" : assignment ? "Edit Assignment" : "New Assignment"}
              </h2>
              {isDraftAssignment && (
                <p className="text-xs text-cyan-400/70 mt-0.5">Auto-saving to database — your work is safe</p>
              )}
              {draftRestored && !assignment && (
                <p className="text-xs text-cyan-400/70 mt-0.5">Draft restored from previous session</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600">
                {"\u2318"}+Enter to save
              </span>
              <Button type="button" variant="outline" onClick={handleClose}
                className="bg-white/[0.03] border-white/[0.06] text-slate-400 hover:bg-white/[0.06] h-9 px-4 text-sm">
                {isDraftAssignment ? "Close" : "Cancel"}
              </Button>
              <Button onClick={handleSubmit} disabled={saving}
                className="bg-cyan-600 hover:bg-cyan-500 text-white h-9 px-6 text-sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? "Saving..." : isDraftAssignment ? "Create Assignment" : assignment ? "Update" : "Create Assignment"}
              </Button>
            </div>
          </div>

          {/* ─── Body ─── */}
          {optionsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="px-8 py-6 space-y-8">

                {/* ─── Template bar: one pick fills the whole form ─── */}
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] px-4 py-3">
                  <LayoutTemplate className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300/80">Mall</span>
                  <Select
                    value={selectedTemplateId || "___none___"}
                    onValueChange={(v) => {
                      if (v === "___none___") { setSelectedTemplateId(""); return; }
                      const t = briefTemplates.find((x) => x.id === v);
                      if (t) applyTemplate(t);
                    }}
                  >
                    <SelectTrigger className="h-9 w-[320px] max-w-full bg-white/[0.03] border-white/[0.06] text-sm">
                      <span className={selectedTemplate ? "text-white" : "text-slate-500"}>
                        {selectedTemplate?.name ?? (briefTemplates.length ? "Välj mall — fyller i allt utom batch & datum" : "Inga mallar än — spara den här briefen som mall")}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="___none___" className="text-slate-500">— Ingen mall —</SelectItem>
                      {briefTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}{t.useCount > 0 ? ` · ${t.useCount}×` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <button type="button" onClick={() => deleteTemplate(selectedTemplate.id)} title="Ta bort mall"
                      className="h-8 w-8 rounded-md flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div className="ml-auto">
                    <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
                      <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs text-slate-300 hover:bg-white/[0.06] transition-colors">
                        <BookmarkPlus className="h-3.5 w-3.5" /> Spara som mall
                      </PopoverTrigger>
                      <PopoverContent className="w-80 bg-[#111827] border-white/10 p-3 space-y-2" align="end">
                        <p className="text-xs text-slate-400">
                          Sparar produkt, landing, format, angle, problem, editor, strateg, hypotes, brief, referenser och script. Batch, version och datum sparas inte.
                        </p>
                        <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder='t.ex. "Probiotika LP12 + PP"' autoFocus
                          className="h-8 text-xs bg-white/5 border-white/10"
                          onKeyDown={(e) => e.key === "Enter" && saveTemplate()} />
                        <Button type="button" size="sm" className="w-full h-8 text-xs bg-cyan-600 hover:bg-cyan-500 text-white"
                          onClick={() => saveTemplate()} disabled={savingTemplate || !templateName.trim()}>
                          {savingTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : "Spara ny mall"}
                        </Button>
                        {selectedTemplate && (
                          <Button type="button" size="sm" variant="outline" className="w-full h-8 text-xs bg-white/[0.03] border-white/10 text-slate-300"
                            onClick={() => saveTemplate(selectedTemplate.id)} disabled={savingTemplate}>
                            Uppdatera &quot;{selectedTemplate.name}&quot; med det som står nu
                          </Button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* ─── Top Row: Key Fields ─── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                  {/* Batch */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Batch<span className="text-cyan-400 ml-0.5">*</span>
                    </Label>
                    <Input type="number" value={form.batchNumber}
                      onChange={(e) => updateForm({ batchNumber: e.target.value })}
                      placeholder="146" className="h-10 bg-white/[0.03] border-white/[0.06] text-sm" />
                  </div>
                  {/* Version */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Version</Label>
                    <Input type="number" value={form.version}
                      onChange={(e) => updateForm({ version: e.target.value })}
                      min="1" className="h-10 bg-white/[0.03] border-white/[0.06] text-sm" />
                  </div>
                  {/* Editor */}
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Editor<span className="text-cyan-400 ml-0.5">*</span>
                    </Label>
                    <Select value={form.assignedToId || "___none___"}
                      onValueChange={(v) => updateForm({ assignedToId: v === "___none___" ? "" : v })}>
                      <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10">
                        <span className={!selectedEditor ? "text-slate-600" : "text-white"}>
                          {selectedEditor?.name || "Select editor..."}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="bg-[#111827] border-white/10">
                        <SelectItem value="___none___" className="text-slate-600">— Select —</SelectItem>
                        {videoEditors.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                        {admins.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} (Admin)</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Priority */}
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Priority</Label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {PRIORITIES.map((p) => (
                        <button key={p.value} type="button"
                          onClick={() => updateForm({ priority: p.value })}
                          className={cn(
                            "h-10 rounded-lg border text-sm font-medium transition-all",
                            form.priority === p.value ? p.color
                              : "border-white/[0.06] text-slate-600 hover:border-white/10 hover:text-slate-400"
                          )}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ─── Two-column: Creative Brief + Sidebar ─── */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">

                  {/* ─── Left: Creative Brief ─── */}
                  <div className="space-y-6">
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-4">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Creative Brief</h3>
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <OptionSelect value={form.countryId} onChange={(v) => updateForm({ countryId: v })}
                          items={options?.countries || []} placeholder="Select country..."
                          label="Country" apiType="countries" needsCode showCode onOptionsRefresh={refreshOptions} />
                        <OptionSelect value={form.productId} onChange={(v) => updateForm({ productId: v })}
                          items={options?.products || []} placeholder="Select product..."
                          label="Product" apiType="products" needsCode showCode onOptionsRefresh={refreshOptions} />
                        <OptionSelect value={form.formatId} onChange={(v) => updateForm({ formatId: v })}
                          items={options?.formats || []} placeholder="Select format..."
                          label="Format" apiType="formats" onOptionsRefresh={refreshOptions} />
                        <OptionSelect value={form.angleId} onChange={(v) => updateForm({ angleId: v })}
                          items={options?.angles || []} placeholder="Select angle..."
                          label="Angle" apiType="angles" onOptionsRefresh={refreshOptions} />
                        <OptionSelect value={form.offerTypeId} onChange={(v) => updateForm({ offerTypeId: v })}
                          items={options?.offerTypes || []} placeholder="Select offer type..."
                          label="Offer Type" apiType="offer-types" onOptionsRefresh={refreshOptions} />
                        <OptionSelect value={form.scriptStructureId} onChange={(v) => updateForm({ scriptStructureId: v })}
                          items={options?.scriptStructures || []} placeholder="Select structure..."
                          label="Script Structure" apiType="script-structures" onOptionsRefresh={refreshOptions} />
                      </div>
                    </div>

                    {/* ─── Learning Loop: the brief as a test ─── */}
                    <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-violet-300/90 uppercase tracking-wider flex items-center gap-2">
                          <FlaskConical className="h-3.5 w-3.5" /> Learning Loop · testet
                        </h3>
                        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] p-0.5">
                          {[{ v: "ideation", l: "💡 Ideation" }, { v: "iteration", l: "🔄 Iteration" }].map((o) => (
                            <button key={o.v} type="button"
                              onClick={() => updateForm({ adType: form.adType === o.v ? "" : o.v })}
                              className={cn("rounded-md px-2.5 py-1 text-xs transition-colors",
                                form.adType === o.v ? "bg-violet-500/20 text-violet-200" : "text-slate-500 hover:text-slate-300")}>
                              {o.l}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="lg:col-span-2 space-y-1.5">
                          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Hypotes — varför gör vi den här annonsen?</Label>
                          <Textarea value={form.hypothesis} onChange={(e) => updateForm({ hypothesis: e.target.value })} rows={3}
                            placeholder={"WHY: vad i datan/marknaden säger att det här kan funka?\nWHAT: vad handlar annonsen om?\nHOW: hur gör vi den? Vad förväntar vi oss (ROAS/CPA)?"}
                            className="bg-white/[0.03] border-white/[0.06] text-sm resize-none" />
                        </div>
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Variabel som testas</Label>
                            <Input value={form.variableTested} onChange={(e) => updateForm({ variableTested: e.target.value })}
                              placeholder="det ENDA vi ändrar: hook, LP, format…" className="h-10 bg-white/[0.03] border-white/[0.06] text-sm" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Awareness</Label>
                            <Select value={form.awarenessLevel || "___none___"} onValueChange={(v) => updateForm({ awarenessLevel: v === "___none___" ? "" : v })}>
                              <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10">
                                <span className={form.awarenessLevel ? "text-white" : "text-slate-600"}>
                                  {AWARENESS_LEVELS.find((l) => l.value === form.awarenessLevel)?.label ?? "Välj nivå..."}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="bg-[#111827] border-white/10">
                                <SelectItem value="___none___" className="text-slate-600">— None —</SelectItem>
                                {AWARENESS_LEVELS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        <OptionSelect value={form.problemId} onChange={(v) => updateForm({ problemId: v })}
                          items={options?.problems || []} placeholder="Select problem..."
                          label="Problem" apiType="problems" onOptionsRefresh={refreshOptions} />
                        {form.adType === "iteration" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Iteration av</Label>
                            <Select value={form.iterationOfId || "___none___"} onValueChange={(v) => updateForm({ iterationOfId: v === "___none___" ? "" : v })}>
                              <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10">
                                <span className={form.iterationOfId ? "text-white" : "text-slate-600"}>
                                  {(() => { const a = allAssignments.find((x) => x.id === form.iterationOfId); return a ? `#${a.batchNumber} ${a.autoName || a.title}` : "Välj ursprunglig brief..."; })()}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="bg-[#111827] border-white/10">
                                <SelectItem value="___none___" className="text-slate-600">— None —</SelectItem>
                                {allAssignments.filter((a) => a.id !== assignment?.id).sort((a, b) => b.batchNumber - a.batchNumber).slice(0, 200).map((a) => (
                                  <SelectItem key={a.id} value={a.id}>#{a.batchNumber} {a.autoName || a.title}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Publiceringsmall</Label>
                          <Select value={form.publishTemplateId != null ? String(form.publishTemplateId) : "___none___"}
                            onValueChange={(v) => updateForm({ publishTemplateId: v === "___none___" ? null : Number(v) })}>
                            <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10">
                              <span className={form.publishTemplateId != null ? "text-white" : "text-slate-600"}>
                                {publishTemplates.find((t) => t.id === form.publishTemplateId)?.name ?? "Copy + landing pages vid publicering..."}
                              </span>
                            </SelectTrigger>
                            <SelectContent className="bg-[#111827] border-white/10">
                              <SelectItem value="___none___" className="text-slate-600">— None —</SelectItem>
                              {publishTemplates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* ─── Script Editor — Always visible ─── */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          Script
                          {script.hooks.filter(h => h.eng || h.se).length > 0 && (
                            <span className="text-emerald-400 ml-2 normal-case font-normal">
                              ({script.hooks.filter(h => h.eng || h.se).length} hooks)
                            </span>
                          )}
                        </h3>
                        <button type="button" onClick={addHook}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-400 transition-colors px-2.5 py-1.5 rounded-lg border border-dashed border-white/[0.08] hover:border-cyan-500/30">
                          <Plus className="h-3.5 w-3.5" /> Add hook
                        </button>
                      </div>

                      {/* Column Headers */}
                      <div className="grid grid-cols-[40px_1fr_1fr_36px] gap-3 text-[10px] font-medium text-slate-600 uppercase tracking-wider px-1">
                        <div />
                        <div>English</div>
                        <div>Swedish</div>
                        <div />
                      </div>

                      {/* Hooks — native inputs to bypass Base UI focus issues */}
                      <div className="space-y-2">
                        {script.hooks.map((hook) => (
                          <div key={hook.id} className="grid grid-cols-[40px_1fr_1fr_36px] gap-3 items-center">
                            <span className="text-xs font-bold text-slate-500 text-center bg-white/[0.03] rounded py-2">
                              {hook.label}
                            </span>
                            <input
                              type="text"
                              value={hook.eng}
                              onChange={(e) => updateHook(hook.id, "eng", e.target.value)}
                              placeholder="English hook..."
                              className="h-10 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
                            />
                            <input
                              type="text"
                              value={hook.se}
                              onChange={(e) => updateHook(hook.id, "se", e.target.value)}
                              placeholder="Svensk hook..."
                              className="h-10 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
                            />
                            <button type="button"
                              className="h-10 w-9 flex items-center justify-center rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all"
                              onClick={() => removeHook(hook.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Body — native textareas */}
                      <div className="border-t border-white/[0.04] pt-4">
                        <div className="grid grid-cols-[40px_1fr_1fr_36px] gap-3 text-[10px] font-medium text-slate-600 uppercase tracking-wider px-1 mb-2">
                          <div />
                          <div>English body</div>
                          <div>Swedish body</div>
                          <div />
                        </div>
                        <div className="grid grid-cols-[40px_1fr_1fr_36px] gap-3">
                          <div className="flex items-start justify-center pt-2.5">
                            <span className="text-xs font-bold text-slate-500">Body</span>
                          </div>
                          <textarea
                            value={script.body.eng}
                            onChange={(e) => updateScript((prev) => ({ ...prev, body: { ...prev.body, eng: e.target.value } }))}
                            placeholder="English body text..."
                            rows={4}
                            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 resize-none transition-colors"
                          />
                          <textarea
                            value={script.body.se}
                            onChange={(e) => updateScript((prev) => ({ ...prev, body: { ...prev.body, se: e.target.value } }))}
                            placeholder="Svensk brodtext..."
                            rows={4}
                            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 resize-none transition-colors"
                          />
                          <div />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ─── Right Sidebar ─── */}
                  <div className="space-y-6">
                    {/* Due Date */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-3">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Due Date</Label>
                      <Popover>
                        <PopoverTrigger className={cn(
                          "flex items-center w-full justify-start text-left h-10 rounded-lg border px-3 text-sm bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]",
                          !form.dueDate && "text-slate-600"
                        )}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {form.dueDate ? format(new Date(form.dueDate), "d MMM yyyy") : "Pick a date..."}
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-[#111827] border-white/10">
                          <Calendar mode="single"
                            selected={form.dueDate ? new Date(form.dueDate) : undefined}
                            onSelect={(date) => updateForm({ dueDate: date ? date.toISOString() : undefined })}
                            initialFocus />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Landing Page + Creative Strategist */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Landing Page</Label>
                        <Input value={form.landingPage}
                          onChange={(e) => updateForm({ landingPage: e.target.value })}
                          placeholder="LP, LP3..."
                          className="h-10 bg-white/[0.03] border-white/[0.06] text-sm" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Creative Strategist</Label>
                        <Select value={form.creativeStrategistId || "___none___"}
                          onValueChange={(v) => {
                            const user = users.find((u) => u.id === v);
                            updateForm({
                              creativeStrategistId: v === "___none___" ? "" : v,
                              creativeStrategistName: user?.name || "",
                            });
                          }}>
                          <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-sm h-10">
                            <span className={!selectedStrategist ? "text-slate-600" : "text-white"}>
                              {selectedStrategist?.name || "Select strategist..."}
                            </span>
                          </SelectTrigger>
                          <SelectContent className="bg-[#111827] border-white/10">
                            <SelectItem value="___none___" className="text-slate-600">— None —</SelectItem>
                            {creativeStrategists.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            {admins.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} (Admin)</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Description */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-3">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Notes / Instructions</Label>
                      <Textarea value={form.description}
                        onChange={(e) => updateForm({ description: e.target.value })}
                        rows={4} placeholder="Anything the editor needs to know..."
                        className="bg-white/[0.03] border-white/[0.06] text-sm resize-none" />
                    </div>

                    {/* Full Brief (Notion replacement) */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-3">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Full Brief</Label>
                      <Textarea value={form.briefContent}
                        onChange={(e) => updateForm({ briefContent: e.target.value })}
                        rows={10} placeholder={"The complete brief (markdown supported):\n\n## Concept\n## Hook direction\n## Must-include shots\n## Don'ts"}
                        className="bg-white/[0.03] border-white/[0.06] text-sm font-mono resize-y" />
                    </div>

                    {/* References / inspiration links */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-3">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        References {form.references.length > 0 && <span className="text-cyan-400 normal-case font-normal">({form.references.length})</span>}
                      </Label>
                      <div className="space-y-2">
                        {form.references.map((ref, i) => (
                          <div key={ref.id} className="flex gap-2 items-start">
                            {ref.kind === "file" ? (
                              <a href={ref.value} target="_blank" rel="noopener noreferrer"
                                className="flex-[2] text-xs text-cyan-400 hover:underline truncate self-center">
                                📎 {ref.label || ref.value}
                              </a>
                            ) : (
                              <Input value={ref.value}
                                onChange={(e) => {
                                  const next = [...form.references];
                                  next[i] = { ...next[i], value: e.target.value };
                                  updateForm({ references: next });
                                }}
                                placeholder="https:// link (ad, video, swipe, drive...)"
                                className="bg-white/[0.03] border-white/[0.06] text-xs flex-[2]" />
                            )}
                            <Input value={ref.note || ""}
                              onChange={(e) => {
                                const next = [...form.references];
                                next[i] = { ...next[i], note: e.target.value };
                                updateForm({ references: next });
                              }}
                              placeholder="Why it matters"
                              className="bg-white/[0.03] border-white/[0.06] text-xs flex-1" />
                            <button type="button"
                              onClick={() => updateForm({ references: form.references.filter((_, j) => j !== i) })}
                              className="text-slate-600 hover:text-red-400 text-xs px-2 py-2">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-4">
                        <button type="button"
                          onClick={() => updateForm({ references: [...form.references, { id: crypto.randomUUID(), kind: "url", value: "" }] })}
                          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">+ Add link</button>
                        <button type="button" disabled={uploadingRef}
                          onClick={() => refFileInput.current?.click()}
                          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors disabled:opacity-50">
                          {uploadingRef ? "Uploading…" : "📎 Upload file (raw material)"}
                        </button>
                        <input ref={refFileInput} type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRefFile(f); }} />
                      </div>
                    </div>

                    {/* Customer Avatars */}
                    <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-5 space-y-3">
                      <button type="button" onClick={() => setShowAvatars(!showAvatars)}
                        className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-300 transition-colors w-full">
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAvatars && "rotate-180")} />
                        Customer Avatars
                        {form.customerAvatarIds.length > 0 && (
                          <span className="text-cyan-400 normal-case font-normal">({form.customerAvatarIds.length})</span>
                        )}
                      </button>
                      {showAvatars && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {options?.customerAvatars.map((avatar) => (
                            <button key={avatar.id} type="button" onClick={() => toggleCustomerAvatar(avatar.id)}
                              className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all",
                                form.customerAvatarIds.includes(avatar.id)
                                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                                  : "border-white/[0.06] text-slate-500 hover:border-white/10 hover:text-slate-300"
                              )}>
                              <Checkbox checked={form.customerAvatarIds.includes(avatar.id)}
                                className="pointer-events-none h-4 w-4" />
                              {avatar.code ? `${avatar.code} — ${avatar.name}` : avatar.name}
                            </button>
                          ))}
                          <AddOptionPopover type="customer-avatars" label="Avatar" needsCode
                            onCreated={() => refreshOptions()} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Close button */}
          <button onClick={handleClose}
            className="absolute top-5 right-5 h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
