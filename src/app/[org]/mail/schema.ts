import { z } from "zod";

// Lo que llega del formulario de correo. Separado de las acciones para poder usarlo en el cliente.

export const connectMailSchema = z.object({
  address: z.string().trim().toLowerCase().email().max(320),
  display_name: z.string().trim().max(120).default(""),
  imap_host: z.string().trim().min(3).max(255),
  imap_port: z.coerce.number().int().min(1).max(65535).default(993),
  smtp_host: z.string().trim().min(3).max(255),
  smtp_port: z.coerce.number().int().min(1).max(65535).default(465),
  /** En IONOS el usuario es la propia dirección; se deja cambiar porque no en todos lo es. */
  username: z.string().trim().min(3).max(255),
  password: z.string().min(4).max(500),
});

export type ConnectMailInput = z.input<typeof connectMailSchema>;

export const sendMailSchema = z.object({
  to: z.string().trim().min(3).max(2000),
  cc: z.string().trim().max(2000).default(""),
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(100_000),
  /** Si se responde a un mensaje concreto, su id en nuestra copia. */
  reply_to_id: z.union([z.literal(""), z.guid()]).default(""),
  client_id: z.union([z.literal(""), z.guid()]).default(""),
});

export type SendMailInput = z.input<typeof sendMailSchema>;

/** Las direcciones de un campo escrito a mano: separadas por coma, punto y coma o espacios. */
export const splitAddresses = (value: string): string[] =>
  value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
