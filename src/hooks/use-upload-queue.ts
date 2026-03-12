"use client";

import { useState, useCallback } from "react";

interface UploadJob {
  id: string;
  status: "pending" | "uploading" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
  config: Record<string, unknown>;
  error?: string;
}

export function useUploadQueue() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const addJob = useCallback((config: Record<string, unknown>) => {
    const job: UploadJob = {
      id: crypto.randomUUID(),
      status: "pending",
      currentStep: 0,
      totalSteps: 5,
      stepLabel: "Waiting...",
      config,
    };
    setJobs((prev) => [...prev, job]);
    return job.id;
  }, []);

  const startJob = useCallback(async (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "uploading" as const, stepLabel: "Starting..." } : j))
    );

    try {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      const res = await fetch("/api/meta/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.config),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const result = await res.json();
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: "completed" as const, currentStep: 5, stepLabel: "Done!", ...result }
            : j
        )
      );
    } catch (err) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, status: "failed" as const, error: err instanceof Error ? err.message : "Unknown error" }
            : j
        )
      );
    }
  }, [jobs]);

  const startAll = useCallback(async () => {
    const pending = jobs.filter((j) => j.status === "pending");
    for (const job of pending) {
      await startJob(job.id);
    }
  }, [jobs, startJob]);

  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const clearCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== "completed"));
  }, []);

  return { jobs, addJob, startJob, startAll, removeJob, clearCompleted };
}
