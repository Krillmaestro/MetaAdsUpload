"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { X, Play, Trash2 } from "lucide-react";

interface Job {
  id: string;
  status: "pending" | "uploading" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  stepLabel: string;
  config: Record<string, unknown>;
  error?: string;
}

interface UploadQueueProps {
  jobs: Job[];
  onStartAll: () => void;
  onRemove: (id: string) => void;
  onClearCompleted: () => void;
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  uploading: "default",
  completed: "secondary",
  failed: "destructive",
};

export function UploadQueue({ jobs, onStartAll, onRemove, onClearCompleted }: UploadQueueProps) {
  if (jobs.length === 0) return null;

  const hasPending = jobs.some((j) => j.status === "pending");
  const hasCompleted = jobs.some((j) => j.status === "completed");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Upload Queue ({jobs.length})</CardTitle>
        <div className="flex gap-2">
          {hasCompleted && (
            <Button variant="outline" size="sm" onClick={onClearCompleted}>
              <Trash2 className="mr-2 h-3 w-3" />
              Clear Done
            </Button>
          )}
          {hasPending && (
            <Button size="sm" onClick={onStartAll}>
              <Play className="mr-2 h-3 w-3" />
              Upload All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-center gap-4 rounded-md border p-3">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {(job.config as Record<string, Record<string, string>>).campaign?.name || "Unnamed"}
                </span>
                <Badge variant={statusColors[job.status]}>{job.status}</Badge>
              </div>
              {job.status === "uploading" && (
                <>
                  <Progress value={(job.currentStep / job.totalSteps) * 100} className="h-1" />
                  <p className="text-xs text-muted-foreground">{job.stepLabel}</p>
                </>
              )}
              {job.error && (
                <p className="text-xs text-destructive">{job.error}</p>
              )}
            </div>
            {(job.status === "pending" || job.status === "failed") && (
              <Button variant="ghost" size="sm" onClick={() => onRemove(job.id)}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
