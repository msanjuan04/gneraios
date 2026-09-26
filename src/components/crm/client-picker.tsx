"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BoardOption } from "./board-types";

/** Cliente existente o uno nuevo escrito al vuelo (así nace un lead sin salir del deal). */
export function ClientPicker({
  clients,
  clientId,
  newClientName,
  onChange,
  invalid,
  disabled,
}: {
  clients: BoardOption[];
  clientId: string;
  newClientName: string;
  onChange: (value: { clientId: string; newClientName: string }) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("pipeline.sheet");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = clients.find((c) => c.id === clientId);
  const label = selected?.name ?? (newClientName ? t("newClient", { name: newClientName }) : t("clientPlaceholder"));
  const typed = query.trim();
  const exact = clients.some((c) => c.name.toLowerCase() === typed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className={cn(
            "w-full justify-between rounded-lg font-normal",
            !selected && !newClientName && "text-muted-foreground",
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={t("clientPlaceholder")} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t("noClients")}</CommandEmpty>
            {typed && !exact && (
              <CommandGroup>
                <CommandItem
                  value={`__new__ ${typed}`}
                  onSelect={() => {
                    onChange({ clientId: "", newClientName: typed });
                    setOpen(false);
                  }}
                >
                  <Plus />
                  {t("createClient", { name: typed })}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => {
                    onChange({ clientId: c.id, newClientName: "" });
                    setOpen(false);
                  }}
                >
                  <Check className={cn(c.id === clientId ? "opacity-100" : "opacity-0")} />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
