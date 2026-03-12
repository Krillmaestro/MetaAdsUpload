"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FolderOpen, Image } from "lucide-react";

interface CreativePickerProps {
  onFileSelect: (file: File | null, source: string) => void;
  onGdriveSelect?: (fileId: string, fileName: string) => void;
  selectedFile: File | null;
}

export function CreativePicker({ onFileSelect, selectedFile }: CreativePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file, "local");
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file, "local");
  };

  return (
    <Tabs defaultValue="local" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="local">
          <Upload className="mr-2 h-4 w-4" /> Local Upload
        </TabsTrigger>
        <TabsTrigger value="gdrive">
          <FolderOpen className="mr-2 h-4 w-4" /> Google Drive
        </TabsTrigger>
        <TabsTrigger value="library">
          <Image className="mr-2 h-4 w-4" /> Library
        </TabsTrigger>
      </TabsList>

      <TabsContent value="local">
        <Card
          className={`border-2 border-dashed transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <CardContent className="flex flex-col items-center justify-center py-12">
            {selectedFile ? (
              <div className="text-center">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => onFileSelect(null, "")}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="mb-2 text-sm font-medium">Drag & drop your creative here</p>
                <p className="mb-4 text-xs text-muted-foreground">
                  Supports MP4, MOV, JPG, PNG (max 4GB for video)
                </p>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Browse Files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,image/*"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="gdrive">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <FolderOpen className="mx-auto mb-4 h-12 w-12" />
            <p>Google Drive browser will be available after configuring the service account.</p>
            <p className="mt-2 text-xs">Set GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_DRIVE_ROOT_FOLDER env vars.</p>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="library">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Image className="mx-auto mb-4 h-12 w-12" />
            <p>Your uploaded creatives will appear here.</p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
