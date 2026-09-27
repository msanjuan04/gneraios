"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import { MoneyInput, PercentInput } from "@/components/contracts/inputs";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bpsToInput } from "@/app/[org]/invoices/schema";
import { cn } from "@/lib/utils";
import type { ClientOption, RateOption, VendorOption } from "./types";

export { MoneyInput, PercentInput };

/**
 * Un cliente de la org (como el ClientPicker del CRM, pero sin crear clientes al vuelo: un gasto
 * se asigna a un cliente que ya existe). Los archivados solo salen si ya estaban elegidos.
 */
export function ClientSelect({
  id,
  clients,
  clientId,
  onChange,
  invalid,
  disabled,
}: {
  id?: string;
  clients: ClientOption[];
  clientId: string;
  onChange: (clientId: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("finance.allocationField");
  const [open, setOpen] = useState(false);
  const options = clients.filter((c) => !c.archived || c.id === clientId);
  const selected = options.find((c) => c.id === clientId);

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
          disabled={disabled}
          className={cn("w-full justify-between rounded-lg font-normal", !selected && "text-muted-foreground")}
        >
          <span className="truncate">{selected?.name ?? t("clientPlaceholder")}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={t("clientSearch")} />
          <CommandList>
            <CommandEmpty>{t("clientEmpty")}</CommandEmpty>
            <CommandGroup>
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.id}`}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn(c.id === clientId ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                  {c.archived && <span className="ml-auto text-[11px] text-muted-foreground">{t("clientArchived")}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Proveedor existente o uno nuevo escrito al vuelo (se crea al guardar). */
export function VendorPicker({
  id,
  vendors,
  vendorId,
  newVendorName,
  onChange,
  invalid,
  disabled,
}: {
  id?: string;
  vendors: VendorOption[];
  vendorId: string;
  newVendorName: string;
  onChange: (value: { vendorId: string; newVendorName: string }) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("finance.vendorPicker");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = vendors.filter((v) => !v.archived || v.id === vendorId);
  const selected = active.find((v) => v.id === vendorId);
  const label = selected?.name ?? (newVendorName ? t("new", { name: newVendorName }) : t("placeholder"));
  const typed = query.trim();
  const exact = active.some((v) => v.name.toLowerCase() === typed.toLowerCase());

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
          disabled={disabled}
          className={cn("w-full justify-between rounded-lg font-normal", !selected && !newVendorName && "text-muted-foreground")}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={t("search")} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            {typed && !exact && (
              <CommandGroup>
                <CommandItem
                  value={`__new__ ${typed}`}
                  onSelect={() => {
                    onChange({ vendorId: "", newVendorName: typed });
                    setOpen(false);
                  }}
                >
                  <Plus />
                  {t("create", { name: typed })}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {(vendorId || newVendorName) && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange({ vendorId: "", newVendorName: "" });
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  {t("none")}
                </CommandItem>
              )}
              {active.map((v) => (
                <CommandItem
                  key={v.id}
                  value={`${v.name} ${v.taxId ?? ""}`}
                  onSelect={() => {
                    onChange({ vendorId: v.id, newVendorName: "" });
                    setOpen(false);
                  }}
                >
                  <Check className={cn(v.id === vendorId ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{v.name}</span>
                  {v.taxId && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{v.taxId}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Porcentaje con los tipos de la org (tax_rates) a un clic. */
export function RateField({
  rates,
  value,
  onPick,
  disabled,
  ...props
}: ComponentProps<typeof PercentInput> & { rates: RateOption[]; value: string; onPick: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <PercentInput value={value} disabled={disabled} {...props} />
      {rates.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rates.map((rate) => {
            const text = bpsToInput(rate.rateBps);
            const active = value.trim().replace(".", ",") === text;
            return (
              <button
                key={rate.id}
                type="button"
                disabled={disabled}
                onClick={() => onPick(text)}
                title={rate.name}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular transition-colors disabled:opacity-50",
                  active ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {text} %
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
