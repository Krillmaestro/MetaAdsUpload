"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  from: Date;
  to: Date;
  onChange: (range: { from: Date; to: Date }) => void;
}

const presets = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.label}
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ from: subDays(new Date(), preset.days), to: new Date() })
          }
        >
          {preset.label}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" size="sm" className={cn("justify-start text-left font-normal")} />}>
          <CalendarIcon className="mr-2 h-4 w-4" />
          {format(from, "MMM d")} - {format(to, "MMM d, yyyy")}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={{ from, to }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                onChange({ from: range.from, to: range.to });
                setOpen(false);
              }
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
