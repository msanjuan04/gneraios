"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SetupClient } from "@/domain/invoice-import/match";
import { cn } from "@/lib/utils";

/** Buscador de clientes de la org por nombre, razón social o NIF. */
export function ClientSelect({
  id,
  clients,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  clients: readonly SetupClient[];
  value: string | null;
  onChange: (clientId: string) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("invoiceImport.client");
  const [open, setOpen] = useState(false);
  const selected = clients.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn("w-full justify-between rounded-lg font-normal", !selected && "text-muted-foreground")}
        >
          <span className="truncate">
            {selected ? selected.name : t("placeholder")}
            {selected?.taxId && <span className="ml-2 font-mono text-xs text-muted-foreground">{selected.taxId}</span>}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>{t("none")}</CommandEmpty>
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.legalName ?? ""} ${c.taxId ?? ""} ${c.id}`}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn(c.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.taxId && <span className="font-mono text-xs text-muted-foreground">{c.taxId}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
