import { z } from "zod";

// Lo que llega del formulario de correo. Separado de las acciones para poder usarlo en el cliente.

/**
 * Un servidor de correo es un nombre de dominio de verdad: ni una IP ni «localhost». El servidor se
 * conecta a lo que se escriba aquí, así que no puede apuntarse a la red interna ni a un puerto suelto.
 */
const mailHost = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "host")
  .refine((host) => host !== "localhost" && !host.endsWith(".local") && !host.endsWith(".internal"), "host");

export const connectMailSchema = z.object({
  address: z.string().trim().toLowerCase().email().max(320),
  display_name: z.string().trim().max(120).default(""),
  imap_host: mailHost,
  imap_port: z.coerce.number().int().min(1).max(65535).default(993),
  smtp_host: mailHost,
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
