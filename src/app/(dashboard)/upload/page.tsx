"use client";

import { UploadWizard } from "@/components/upload/upload-wizard";
import { UploadQueue } from "@/components/upload/upload-queue";
import { useUploadQueue } from "@/hooks/use-upload-queue";
import { toast } from "sonner";

export default function UploadPage() {
  const { jobs, addJob, startAll, removeJob, clearCompleted } = useUploadQueue();

  const handleAddToQueue = (config: Record<string, unknown>) => {
    addJob(config);
    toast.success("Added to upload queue");
  };

  const handleSaveTemplate = async (data: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save template");
      toast.success("Template saved");
    } catch {
      toast.error("Failed to save template");
    }
  };

  return (
    <div className="space-y-6">
      <UploadWizard onAddToQueue={handleAddToQueue} onSaveTemplate={handleSaveTemplate} />
      <UploadQueue
        jobs={jobs}
        onStartAll={startAll}
        onRemove={removeJob}
        onClearCompleted={clearCompleted}
      />
    </div>
  );
}
