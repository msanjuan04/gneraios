// Proveedores tal como los pinta la UI (serializables: pasan de servidor a cliente). Los cargan
// src/server/vendors/queries.ts con la sesión del usuario (RLS). Las cifras salen de las vistas
// vendors_overview y vendor_costs_by_allocation: nada de lo que cuesta un proveedor se guarda.

import type { ExpenseListItem, FinanceConfig } from "@/components/finance/types";
import type { AllocationCostRow, VendorKind } from "@/domain/vendors";

export type { AllocationCostRow, VendorKind };

/** Una categoría de gasto para «Categoría habitual». */
export type VendorCategoryOption = { id: string; name: string; archived: boolean };

/** Los datos de un proveedor (lo que se edita en el panel). */
export type VendorProfile = {
  id: string;
  name: string;
  kind: VendorKind;
  taxId: string | null;
  countryCode: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  website: string | null;
  notes: string | null;
  defaultCategoryId: string | null;
  archived: boolean;
};

/** Lo que nos cuesta (derivado de sus gastos). */
export type VendorFigures = {
  expensesCount: number;
  /** Coste = base + IVA no deducible. */
  costCents: number;
  yearExpensesCount: number;
  yearCostCents: number;
  /** El total (base + IVA − IRPF) de lo que aún no se ha pagado. */
  pendingCents: number;
  pendingCount: number;
  overdueCents: number;
  overdueCount: number;
  clientsCount: number;
  firstExpenseOn: string | null;
  lastExpenseOn: string | null;
};

export type VendorListItem = VendorProfile & VendorFigures;

export type VendorsPageData = {
  vendors: VendorListItem[];
  categories: VendorCategoryOption[];
  /** El año en curso en la zona de la org («Este año»). */
  year: number;
};

export type VendorDetailData = {
  vendor: VendorListItem;
  /** Lo gastado para cada destino (empresa, cada cliente, webs alojadas). */
  allocation: AllocationCostRow[];
  /** Sus últimos gastos (los mismos de Finanzas → Gastos), del más reciente al más antiguo. */
  recentExpenses: ExpenseListItem[];
  categories: VendorCategoryOption[];
  /** Para el panel del gasto. */
  financeConfig: FinanceConfig;
  today: string;
  year: number;
};

/** Un proveedor que ha trabajado para un cliente y lo que ha costado. */
export type ClientVendorCost = {
  vendorId: string;
  name: string;
  kind: VendorKind;
  archived: boolean;
  expensesCount: number;
  costCents: number;
  yearCostCents: number;
  lastExpenseOn: string | null;
};

export type ClientVendorsData = {
  vendors: ClientVendorCost[];
  totals: { expensesCount: number; costCents: number; yearCostCents: number };
  year: number;
};
