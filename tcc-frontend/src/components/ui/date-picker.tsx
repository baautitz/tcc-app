import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CalendarDays } from "lucide-react";
import { ptBR } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function parseDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
    ? date
    : undefined;
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function maskDate(value: string): string {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function dateInputValue(value: string): string {
  const isoDate = parseDate(value);
  if (isoDate) {
    const day = String(isoDate.getDate()).padStart(2, "0");
    const month = String(isoDate.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${isoDate.getFullYear()}`;
  }
  return maskDate(value);
}

function formDateValue(value: string): string {
  if (!value) return "";
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return value;
  const [, day, month, year] = match;
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
    ? `${year}-${month}-${day}`
    : value;
}

function DatePicker({ value, onChange, onBlur, label }: { value: string; onChange: (value: string) => void; onBlur?: () => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => dateInputValue(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedDate = parseDate(value);

  useEffect(() => {
    setDraft(dateInputValue(value));
  }, [value]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const digitsBeforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, "").length;
    const nextDraft = maskDate(input.value);
    setDraft(nextDraft);
    onChange(formDateValue(nextDraft));

    requestAnimationFrame(() => {
      const element = inputRef.current;
      if (!element) return;
      let caret = 0;
      let digits = 0;
      while (caret < nextDraft.length && digits < digitsBeforeCaret) {
        if (/\d/.test(nextDraft[caret])) digits += 1;
        caret += 1;
      }
      if (digitsBeforeCaret >= 2 && nextDraft[caret] === "/") caret += 1;
      element.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        aria-label={label}
        placeholder="DD/MM/AAAA"
        value={draft}
        onChange={handleInputChange}
        onBlur={onBlur}
        className="pr-10"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button type="button" variant="ghost" size="icon" aria-label={`Abrir calendário para ${label}`} className="absolute top-0 right-0 h-8 w-8 border-l border-border" />
          }
        >
          <CalendarDays />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              onChange(date ? formatDateValue(date) : "");
              if (date) setOpen(false);
            }}
            locale={ptBR}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export { DatePicker };
