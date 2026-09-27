/**
 * La fecha, sin pasar de `now`. El `now` de next-intl se refresca cada tanto y el reloj del
 * servidor puede ir algo adelantado: algo de hace nada no debe salir como «dentro de 10 segundos».
 */
export function notAfter(date: Date, now: Date): Date {
  return date.getTime() > now.getTime() ? now : date;
}
